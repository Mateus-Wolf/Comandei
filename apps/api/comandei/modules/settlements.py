from datetime import datetime, timezone
from comandei.core.auth import require_sensitive
from comandei.core.errors import APIError, conflict
from .attendance import calculate, require_open, bump


def start_closing(uow, tab_id, body):
    uow.allow("tabs.start_closing")
    tab = uow.repo.one("tabs", tab_id, lock=True)
    uow.version(tab, body.expected_version)
    require_open(tab)
    tab = uow.repo.update("tabs", tab_id, {"service_accepted": body.service_accepted})
    amounts = calculate(uow, tab)
    settlement = freeze_settlement(uow, tab_id, amounts)
    tab = uow.repo.update("tabs", tab_id, {"status": "closing", "version": tab["version"] + 1})
    uow.event("tabs.closing", "tab", tab_id, tab["version"])
    return {"tab": tab, "settlement": settlement}


def freeze_settlement(uow, tab_id, amounts):
    revision = uow.repo.query(
        "select coalesce(max(revision),0)+1 from app.tab_settlements where tenant_id=:tenant and tab_id=:tab",
        tab=tab_id,
    ).scalar_one()
    settlement = uow.repo.insert(
        "tab_settlements",
        {
            "tab_id": tab_id,
            "revision": revision,
            **{
                k: amounts[k]
                for k in (
                    "subtotal_cents",
                    "discount_cents",
                    "service_cents",
                    "total_cents",
                    "service_rate_bps",
                )
            },
        },
    )
    return settlement


def resume(uow, tab_id, body):
    uow.allow("tabs.resume")
    tab = uow.repo.one("tabs", tab_id, lock=True)
    uow.version(tab, body.expected_version)
    if tab["status"] != "closing":
        conflict("TAB_NOT_CLOSING", "Somente comandas em fechamento podem ser reabertas.")
    paid = uow.repo.query(
        "select 1 from app.payment_entries where tenant_id=:tenant and tab_id=:tab limit 1", tab=tab_id
    ).first()
    if paid:
        conflict("TAB_HAS_PAYMENTS", "Comanda com recebimentos não pode ser reaberta.")
    uow.repo.query(
        "update app.tab_settlements set status='superseded' where tenant_id=:tenant and tab_id=:tab and status='active'",
        tab=tab_id,
    )
    tab = uow.repo.update("tabs", tab_id, {"status": "open", "version": tab["version"] + 1})
    uow.event("tabs.resumed", "tab", tab_id, tab["version"])
    return tab


def active_settlement(uow, tab_id):
    settlement = (
        uow.repo.query(
            "select * from app.tab_settlements where tenant_id=:tenant and tab_id=:tab and status='active' for update",
            tab=tab_id,
        )
        .mappings()
        .first()
    )
    if settlement is None:
        conflict("NO_ACTIVE_SETTLEMENT", "Liquidação ativa não encontrada.")
    return dict(settlement)


def received(uow, tab_id):
    return int(
        uow.repo.query(
            "select coalesce(sum(case when type='receipt' then amount_cents else -amount_cents end),0) from app.payment_entries where tenant_id=:tenant and tab_id=:tab",
            tab=tab_id,
        ).scalar_one()
    )


def cash_session(uow, session_id):
    session = uow.repo.one("cash_sessions", session_id, lock=True)
    if session["status"] != "open":
        conflict("CASH_SESSION_NOT_OPEN", "O turno de caixa não está aberto.")
    if uow.role == "cashier" and session["operator_id"] != uow.identity.user_id:
        raise APIError(403, "OWN_SESSION_REQUIRED", "Você só pode operar o próprio turno.")
    return session


def payment(uow, tab_id, body):
    uow.allow("payments.record")
    tab = uow.repo.one("tabs", tab_id, lock=True)
    uow.version(tab, body.expected_version)
    if tab["status"] != "closing":
        conflict("TAB_NOT_CLOSING", "Inicie o fechamento antes de receber.")
    settlement = active_settlement(uow, tab_id)
    session = cash_session(uow, body.cash_session_id)  # Global order: tab, then cash session.
    balance = settlement["total_cents"] - received(uow, tab_id)
    if body.amount_cents > balance:
        conflict("PAYMENT_EXCEEDS_BALANCE", "O recebimento excede o saldo.", balance_cents=balance)
    if body.tendered_cents is not None and (body.method != "cash" or body.tendered_cents < body.amount_cents):
        raise APIError(422, "INVALID_TENDER", "Valor entregue deve ser em dinheiro e cobrir o recebimento.")
    if body.method == "cash":
        from .cash import expected_cash
        from comandei.domain.finance import cents

        cents(expected_cash(uow, session) + body.amount_cents)
    entry = uow.repo.insert(
        "payment_entries",
        {
            "tab_id": tab_id,
            "settlement_id": settlement["id"],
            "cash_session_id": session["id"],
            "type": "receipt",
            "method": body.method,
            "amount_cents": body.amount_cents,
            "tendered_cents": body.tendered_cents,
            "operation_key": body.operation_key,
            "external_reference": body.external_reference,
            "recorded_by": uow.identity.user_id,
        },
    )
    uow.repo.update("cash_sessions", session["id"], {"version": session["version"] + 1})
    tab = bump(uow, tab, "payments.recorded")
    return {
        "payment": entry,
        "version": tab["version"],
        "balance_cents": balance - body.amount_cents,
        "change_cents": (body.tendered_cents or body.amount_cents) - body.amount_cents,
    }


def close_tab(uow, tab_id, body):
    uow.allow("tabs.close")
    tab = uow.repo.one("tabs", tab_id, lock=True)
    uow.version(tab, body.expected_version)
    if tab["status"] != "closing":
        conflict("TAB_NOT_CLOSING", "A comanda não está em fechamento.")
    settlement = active_settlement(uow, tab_id)
    balance = settlement["total_cents"] - received(uow, tab_id)
    if balance != 0:
        conflict("OUTSTANDING_BALANCE", "Existe saldo pendente.", balance_cents=balance)
    uow.repo.update("tab_settlements", settlement["id"], {"status": "settled"})
    tab = uow.repo.update(
        "tabs",
        tab_id,
        {
            "status": "closed",
            "closed_by": uow.identity.user_id,
            "closed_at": datetime.now(timezone.utc),
            "version": tab["version"] + 1,
        },
    )
    uow.event("tabs.closed", "tab", tab_id, tab["version"])
    return tab


def refund(uow, payment_id, body):
    uow.allow("payments.refund")
    require_sensitive(uow.identity, uow.connection)
    entry = uow.repo.one("payment_entries", payment_id)
    tab = uow.repo.one("tabs", entry["tab_id"], lock=True)
    if entry["type"] != "receipt" or tab["status"] != "closed":
        conflict("INVALID_REFUND", "Estorno exige recebimento original de uma comanda encerrada.")
    refunded = int(
        uow.repo.query(
            "select coalesce(sum(amount_cents),0) from app.payment_entries where tenant_id=:tenant and original_entry_id=:id and type='refund'",
            id=payment_id,
        ).scalar_one()
    )
    if body.amount_cents > entry["amount_cents"] - refunded:
        conflict(
            "REFUND_EXCEEDS_AVAILABLE",
            "Valor excede a parcela ainda estornável.",
            refundable_cents=entry["amount_cents"] - refunded,
        )
    session = cash_session(uow, body.cash_session_id)
    if entry["method"] == "cash":
        from .cash import expected_cash

        if body.amount_cents > expected_cash(uow, session):
            conflict("INSUFFICIENT_CASH", "Saldo físico do turno insuficiente para a devolução.")
    result = uow.repo.insert(
        "payment_entries",
        {
            "tab_id": tab["id"],
            "settlement_id": entry["settlement_id"],
            "cash_session_id": session["id"],
            "type": "refund",
            "method": entry["method"],
            "amount_cents": body.amount_cents,
            "operation_key": body.operation_key,
            "original_entry_id": payment_id,
            "recorded_by": uow.identity.user_id,
            "approved_by": uow.identity.user_id,
            "reason": body.reason,
        },
    )
    uow.repo.update("cash_sessions", session["id"], {"version": session["version"] + 1})
    bump(uow, tab, "payments.refunded", body.reason)
    return result
