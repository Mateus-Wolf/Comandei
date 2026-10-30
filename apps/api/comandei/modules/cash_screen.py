"""Authorized read model for the cash screen; mutations use the existing cash module."""

from comandei.core.errors import APIError


def overview(uow, session_id=None, tab_search=""):
    uow.allow("cash.write")
    scope = " and s.operator_id=:actor" if uow.role == "cashier" else ""
    row = (
        uow.repo.query(
            "with visible as not materialized (select s.*,r.name as register_name,r.code as register_code "
            "from app.cash_sessions s join app.cash_registers r on r.tenant_id=s.tenant_id and r.id=s.register_id "
            f"where s.tenant_id=:tenant{scope}), "
            "recent as (select * from visible order by (status='open') desc,opened_at desc,id desc limit 20),"
            "chosen as (select * from visible where (cast(:session as uuid) is null or id=:session) "
            "order by (status='open') desc,opened_at desc,id desc limit 1),"
            "payments as (select p.* from app.payment_entries p join chosen s on p.cash_session_id=s.id where p.tenant_id=:tenant),"
            "movements as (select m.* from app.cash_movements m join chosen s on m.session_id=s.id where m.tenant_id=:tenant) "
            "select coalesce((select jsonb_agg(x order by x.name,x.id) from (select r.*,exists(select 1 from app.cash_sessions s "
            "where s.tenant_id=r.tenant_id and s.register_id=r.id and s.status in ('open','closing')) as occupied "
            "from app.cash_registers r where r.tenant_id=:tenant) x),'[]'::jsonb) as registers,"
            "coalesce((select jsonb_agg(s order by (s.status='open') desc,s.opened_at desc,s.id desc) from recent s),'[]'::jsonb) as sessions,"
            "(select to_jsonb(s) from chosen s) as session,"
            "jsonb_build_object('receipts_cents',(select coalesce(sum(case when type='receipt' then amount_cents else -amount_cents end),0) from payments),"
            "'cash_cents',(select coalesce(sum(case when type='receipt' then amount_cents else -amount_cents end),0) from payments where method='cash'),"
            "'supply_cents',(select coalesce(sum(amount_cents),0) from movements where type='supply'),"
            "'withdrawal_cents',(select coalesce(sum(amount_cents),0) from movements where type='withdrawal')) as totals,"
            "coalesce((select jsonb_agg(x order by x.occurred_at desc,x.id desc) from ("
            "select p.id,p.type as kind,p.method,p.amount_cents,p.created_at as occurred_at,p.reason,t.number as tab_number "
            "from payments p join app.tabs t on t.tenant_id=p.tenant_id and t.id=p.tab_id "
            "union all select m.id,m.type,null,m.amount_cents,m.created_at,m.reason,null from movements m "
            "order by occurred_at desc,id desc limit 100) x),'[]'::jsonb) as activity,"
            "coalesce((select jsonb_agg(x order by x.number,x.id) from (select t.id,t.number,t.status,t.version,d.code as table_code "
            "from app.tabs t left join app.dining_tables d on d.tenant_id=t.tenant_id and d.id=t.table_id "
            "where t.tenant_id=:tenant and t.status in ('open','closing') "
            "and (strpos(t.number::text,:search)>0 or strpos(lower(coalesce(d.code,'')),lower(:search))>0) "
            "order by t.number,t.id limit 50) x),'[]'::jsonb) as tabs",
            session=session_id,
            actor=uow.identity.user_id,
            search=tab_search.strip(),
        )
        .mappings()
        .one()
    )
    result = dict(row)
    if session_id and result["session"] is None:
        raise APIError(404, "NOT_FOUND", "Turno não encontrado ou indisponível para sua conta.")
    session = result["session"]
    totals = result["totals"]
    totals["expected_cash_cents"] = (
        session["expected_cents"]
        if session and session["status"] == "closed"
        else (session["initial_balance_cents"] if session else 0)
        + totals["cash_cents"]
        + totals["supply_cents"]
        - totals["withdrawal_cents"]
    )
    return {
        **result,
        "timezone": uow.tenant["timezone"],
        "difference_tolerance_cents": uow.tenant["cash_difference_tolerance_cents"],
    }
