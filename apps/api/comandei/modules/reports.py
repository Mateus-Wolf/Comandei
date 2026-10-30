from datetime import date, datetime, timedelta, timezone
import csv
import io
from comandei.core.errors import APIError, missing
from comandei.domain.finance import business_date, csv_cell


def validate_period(start: date, end: date):
    if end < start or (end - start).days > 30:
        raise APIError(422, "INVALID_PERIOD", "Use um período de até 31 dias em ordem crescente.")


def daily(uow, day):
    uow.allow("reports.read")
    methods = [
        dict(r)
        for r in uow.repo.query(
            "select p.method, coalesce(sum(p.amount_cents) filter(where p.type='receipt'),0) as receipts_cents, coalesce(sum(p.amount_cents) filter(where p.type='refund'),0) as refunds_cents from app.payment_entries p join app.cash_sessions c on c.tenant_id=p.tenant_id and c.id=p.cash_session_id where p.tenant_id=:tenant and c.business_date=:day group by p.method order by p.method",
            day=day,
        ).mappings()
    ]
    sales = dict(
        uow.repo.query(
            "select count(*) as closed_tabs,coalesce(sum(s.subtotal_cents),0) as subtotal_cents,coalesce(sum(s.discount_cents),0) as discount_cents,coalesce(sum(s.service_cents),0) as service_cents,coalesce(sum(s.total_cents),0) as total_cents from app.tabs t join app.tab_settlements s on s.tenant_id=t.tenant_id and s.tab_id=t.id and s.status='settled' where t.tenant_id=:tenant and t.business_date=:day and t.status='closed'",
            day=day,
        )
        .mappings()
        .one()
    )
    # Monetary aggregate NUMERIC values are safe integer cents in the JSON contract.
    methods = [{k: int(v) if k.endswith("_cents") else v for k, v in row.items()} for row in methods]
    sales = {k: int(v) for k, v in sales.items()}
    return {
        "business_date": day,
        "currency": "BRL",
        "sales": sales,
        "payments_by_method": methods,
        "net_received_cents": sum(r["receipts_cents"] - r["refunds_cents"] for r in methods),
        "document_type": "NON_FISCAL_OPERATIONAL_REPORT",
    }


def financial(uow, start_date=None, end_date=None, period="week"):
    uow.allow("reports.read")
    today = business_date(uow.tenant["timezone"], uow.tenant["business_day_cutoff"])
    if (start_date is None) != (end_date is None):
        raise APIError(422, "INVALID_PERIOD", "Informe a data inicial e a data final.")
    if start_date is None:
        end_date = today
        start_date = (
            today.replace(day=1)
            if period == "month"
            else today - timedelta(days=6)
            if period == "week"
            else today
        )
    validate_period(start_date, end_date)
    # Aggregate each source before combining it. Joining raw payments with sales
    # or movements would multiply amounts for tabs paid in multiple methods.
    # One statement covers the whole period, including days without activity.
    row = dict(
        uow.repo.query(
            "with sessions as materialized (select id,business_date,status,difference_cents "
            "from app.cash_sessions where tenant_id=:tenant and business_date between :start and :end),"
            "payments as materialized (select c.business_date,p.method,p.type,p.amount_cents "
            "from app.payment_entries p join sessions c on c.id=p.cash_session_id "
            "where p.tenant_id=:tenant),"
            "payment_days as (select business_date,"
            "coalesce(sum(amount_cents) filter(where type='receipt'),0) as receipts_cents,"
            "coalesce(sum(amount_cents) filter(where type='refund'),0) as refunds_cents "
            "from payments group by business_date),"
            "sales as (select t.business_date,count(*) as closed_tabs,sum(s.subtotal_cents) as subtotal_cents,"
            "sum(s.discount_cents) as discount_cents,sum(s.service_cents) as service_cents,"
            "sum(s.total_cents) as sales_cents from app.tabs t join app.tab_settlements s "
            "on s.tenant_id=t.tenant_id and s.tab_id=t.id and s.status='settled' "
            "where t.tenant_id=:tenant and t.status='closed' and t.business_date between :start and :end "
            "group by t.business_date),"
            "days as (select cast(:start as date)+n as business_date "
            "from generate_series(0,cast(:days as integer)) n),"
            "series as (select d.business_date,coalesce(s.closed_tabs,0) as closed_tabs,"
            "coalesce(s.sales_cents,0) as sales_cents,coalesce(s.subtotal_cents,0) as subtotal_cents,"
            "coalesce(s.discount_cents,0) as discount_cents,coalesce(s.service_cents,0) as service_cents,"
            "coalesce(p.receipts_cents,0) as receipts_cents,coalesce(p.refunds_cents,0) as refunds_cents,"
            "coalesce(p.receipts_cents,0)-coalesce(p.refunds_cents,0) as net_received_cents "
            "from days d left join sales s using(business_date) left join payment_days p using(business_date)) "
            "select (select jsonb_agg(s order by business_date) from series s) as days,"
            "coalesce((select jsonb_agg(m order by m.method) from (select method,"
            "coalesce(sum(amount_cents) filter(where type='receipt'),0) as receipts_cents,"
            "coalesce(sum(amount_cents) filter(where type='refund'),0) as refunds_cents "
            "from payments group by method) m),'[]'::jsonb) as payments_by_method,"
            "jsonb_build_object("
            "'supply_cents',coalesce(sum(m.amount_cents) filter(where m.type='supply'),0),"
            "'withdrawal_cents',coalesce(sum(m.amount_cents) filter(where m.type='withdrawal'),0),"
            "'closed_sessions',(select count(*) from sessions where status='closed'),"
            "'open_sessions',(select count(*) from sessions where status in ('open','closing')),"
            "'difference_cents',(select coalesce(sum(difference_cents),0) from sessions where status='closed')) "
            "as cash from app.cash_movements m join sessions c on c.id=m.session_id where m.tenant_id=:tenant",
            start=start_date,
            end=end_date,
            days=(end_date - start_date).days,
        )
        .mappings()
        .one()
    )
    days = row["days"]
    sales = {
        field: sum(int(day[field]) for day in days)
        for field in ("closed_tabs", "subtotal_cents", "discount_cents", "service_cents", "sales_cents")
    }
    closed = sales["closed_tabs"]
    return {
        **row,
        "start_date": start_date,
        "end_date": end_date,
        "current_business_date": today,
        "timezone": uow.tenant["timezone"],
        "currency": "BRL",
        "sales": sales,
        "receipts_cents": sum(int(day["receipts_cents"]) for day in days),
        "refunds_cents": sum(int(day["refunds_cents"]) for day in days),
        "net_received_cents": sum(int(day["net_received_cents"]) for day in days),
        "average_ticket_cents": (sales["sales_cents"] + closed // 2) // closed if closed else 0,
        "document_type": "NON_FISCAL_OPERATIONAL_REPORT",
    }


def request_export(uow, body):
    uow.allow("exports.create")
    validate_period(body.start_date, body.end_date)
    result = uow.repo.insert(
        "background_jobs",
        {
            "type": "payments_csv",
            "requested_by": uow.identity.user_id,
            "payload": body.model_dump(mode="json"),
        },
    )
    uow.event("exports.requested", "job", result["id"])
    return {k: result[k] for k in ("id", "status", "expires_at")}


def get_export(uow, job_id, download=False):
    uow.allow("exports.create")
    job = uow.repo.one("background_jobs", job_id)
    if job["requested_by"] != uow.identity.user_id:
        missing()
    if job["expires_at"] <= datetime.now(timezone.utc):
        raise APIError(410, "EXPORT_EXPIRED", "A exportação expirou. Solicite outra.")
    if download:
        if job["status"] != "completed" or job["result_data"] is None:
            raise APIError(409, "EXPORT_NOT_READY", "A exportação ainda não está disponível.")
        return job["result_data"]
    return {
        k: job[k] for k in ("id", "type", "status", "attempts", "expires_at", "created_at", "sanitized_error")
    }


def render_csv(rows):
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\r\n")
    fields = [
        "business_date",
        "payment_id",
        "tab_number",
        "type",
        "method",
        "amount_cents",
        "external_reference",
    ]
    writer.writerow(fields)
    for row in rows:
        writer.writerow([csv_cell(row.get(k)) for k in fields])
    return "\ufeff" + output.getvalue()
