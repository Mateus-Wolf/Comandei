from datetime import datetime, timezone
from comandei.core.errors import APIError, conflict
from comandei.domain.finance import business_date, cents
from .settlements import cash_session


def open_session(uow, body):
    uow.allow("cash.write", new_operation=True)
    register = uow.repo.one("cash_registers", body.register_id, lock=True)
    if not register["active"]:
        conflict("REGISTER_INACTIVE", "Terminal de caixa desativado.")
    day = business_date(uow.tenant["timezone"], uow.tenant["business_day_cutoff"])
    result = uow.repo.insert(
        "cash_sessions",
        {
            "register_id": body.register_id,
            "operator_id": uow.identity.user_id,
            "business_date": day,
            "initial_balance_cents": body.initial_balance_cents,
        },
    )
    uow.event("cash.opened", "cash_session", result["id"], result["version"])
    return result


def expected_cash(uow, session):
    payments = uow.repo.query(
        "select coalesce(sum(case when type='receipt' then amount_cents else -amount_cents end),0) from app.payment_entries where tenant_id=:tenant and cash_session_id=:id and method='cash'",
        id=session["id"],
    ).scalar_one()
    movements = uow.repo.query(
        "select coalesce(sum(case when type='supply' then amount_cents else -amount_cents end),0) from app.cash_movements where tenant_id=:tenant and session_id=:id",
        id=session["id"],
    ).scalar_one()
    return int(session["initial_balance_cents"] + payments + movements)


def detail(uow, session_id):
    uow.allow("cash.write")
    session = uow.repo.one("cash_sessions", session_id)
    if uow.role == "cashier" and session["operator_id"] != uow.identity.user_id:
        raise APIError(403, "OWN_SESSION_REQUIRED", "Você só pode consultar o próprio turno.")
    return {**session, "expected_cash_cents": expected_cash(uow, session)}


def movement(uow, session_id, body):
    uow.allow("cash.write")
    session = cash_session(uow, session_id)
    uow.version(session, body.expected_version)
    if body.type == "withdrawal" and body.amount_cents > expected_cash(uow, session):
        conflict("INSUFFICIENT_CASH", "Sangria excede o saldo físico esperado.")
    if body.type == "supply":
        cents(expected_cash(uow, session) + body.amount_cents)
    result = uow.repo.insert(
        "cash_movements",
        {
            "session_id": session_id,
            "type": body.type,
            "amount_cents": body.amount_cents,
            "reason": body.reason,
            "actor_id": uow.identity.user_id,
            "operation_key": body.operation_key,
        },
    )
    session = uow.repo.update("cash_sessions", session_id, {"version": session["version"] + 1})
    uow.event("cash.movement", "cash_session", session_id, session["version"], body.reason)
    return {
        "movement": result,
        "version": session["version"],
        "expected_cash_cents": expected_cash(uow, session),
    }


def close(uow, session_id, body):
    uow.allow("cash.write")
    session = cash_session(uow, session_id)
    uow.version(session, body.expected_version)
    expected = expected_cash(uow, session)
    if (
        abs(body.declared_cents - expected) > uow.tenant["cash_difference_tolerance_cents"]
        and not body.reason
    ):
        raise APIError(422, "DIFFERENCE_REASON_REQUIRED", "Justifique a divergência na contagem do caixa.")
    result = uow.repo.update(
        "cash_sessions",
        session_id,
        {
            "status": "closed",
            "closed_at": datetime.now(timezone.utc),
            "declared_cents": body.declared_cents,
            "expected_cents": expected,
            "closing_reason": body.reason,
            "version": session["version"] + 1,
        },
    )
    uow.event(
        "cash.closed",
        "cash_session",
        session_id,
        result["version"],
        body.reason,
        summary={"difference_cents": result["difference_cents"]},
    )
    return result
