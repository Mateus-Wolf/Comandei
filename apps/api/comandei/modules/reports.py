from datetime import date, datetime, timezone
import csv
import io
from comandei.core.errors import APIError, missing
from comandei.domain.finance import csv_cell


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
