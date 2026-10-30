from datetime import datetime, timezone, timedelta
from decimal import Decimal
from hashlib import sha256
from collections import Counter

from comandei.core.errors import APIError, conflict, missing
from comandei.core.serialization import canonical
from comandei.domain.finance import business_date, cents, line_total, totals
from .catalog import catalog_lock


def require_open(tab):
    if tab["status"] != "open":
        conflict("TAB_NOT_OPEN", "A comanda não está aberta para consumo ou ajustes.")


def bump(uow, tab, action, reason=None):
    tab = uow.repo.update("tabs", tab["id"], {"version": tab["version"] + 1})
    uow.event(action, "tab", tab["id"], tab["version"], reason)
    return tab


def prepare_guests(uow, guests, table=None, previous=()):
    if table and table["capacity"] and sum(g.quantity for g in guests) > table["capacity"]:
        raise APIError(422, "TABLE_CAPACITY", "A quantidade de pessoas excede os assentos da mesa.")
    catalog_lock(uow, shared=True)
    snapshots = {g["product_id"]: g for g in previous if g.get("product_id")}
    prepared = []
    for guest in guests:
        entry = guest.model_dump(mode="json")
        if not guest.complimentary and not guest.product_id:
            raise APIError(422, "GUEST_PRODUCT_REQUIRED", "Selecione o rodízio de cada grupo pagante.")
        snapshot = snapshots.get(str(guest.product_id))
        if guest.product_id and not snapshot:
            product = uow.repo.one("products", guest.product_id)
            category = uow.repo.one("categories", product["category_id"])
            if not product["active"] or not product["available"] or not category["active"]:
                conflict("PRODUCT_UNAVAILABLE", "Rodízio indisponível no catálogo.")
            snapshot = {"name_snapshot": product["name"], "unit_price_cents": product["price_cents"]}
        entry.update(name_snapshot=snapshot["name_snapshot"] if snapshot else guest.label,
                     unit_price_cents=snapshot["unit_price_cents"] if snapshot else 0)
        prepared.append(entry)
    cents(Decimal(sum(g["quantity"] * g["unit_price_cents"] for g in prepared if not g["complimentary"])))
    return prepared


def update_guests(uow, tab_id, body):
    uow.allow("orders.submit", new_operation=True)
    tab = uow.repo.one("tabs", tab_id, lock=True)
    uow.version(tab, body.expected_version)
    require_open(tab)
    catalog_lock(uow, shared=True)
    table = uow.repo.one("dining_tables", tab["table_id"]) if tab["table_id"] else None
    guests = prepare_guests(uow, body.guests, table, tab.get("guests", []))
    previous = tab.get("guests", [])
    # Compare charges per product, so adding another group cannot hide a removal.
    before = guest_charges(previous)
    after = guest_charges(guests)
    if any(after[key] < amount for key, amount in before.items()):
        uow.allow("items.cancel")
        if not body.reason or len(body.reason.strip()) < 3:
            raise APIError(422, "GUEST_REDUCTION_REASON_REQUIRED", "Informe o motivo da redução de cobrança.")
    tab = uow.repo.update("tabs", tab_id, {"guests": guests})
    calculate(uow, tab)
    tab = uow.repo.update("tabs", tab_id, {"version": tab["version"] + 1})
    uow.event("tabs.guests_updated", "tab", tab_id, tab["version"], body.reason,
              summary={"previous_guests": previous, "guests": guests})
    return tab


def guest_charges(guests):
    charges = Counter()
    for guest in guests:
        if not guest["complimentary"]:
            charges[guest.get("product_id")] += guest["quantity"] * guest["unit_price_cents"]
    return charges


def open_tab(uow, body):
    uow.allow("tabs.open", new_operation=True)
    catalog_lock(uow, shared=True)
    table = None
    if body.table_id:
        table = uow.repo.one("dining_tables", body.table_id, lock=True)
        if not table["active"]:
            conflict("TABLE_INACTIVE", "Mesa desativada.")
        occupied = uow.repo.query(
            "select 1 from app.tabs where tenant_id=:tenant and table_id=:table and status in ('open','closing')",
            table=body.table_id,
        ).first()
        if occupied:
            conflict("TABLE_OCCUPIED", "Esta mesa já possui uma comanda em atendimento.")
    guests = prepare_guests(uow, body.guests, table)
    day = business_date(uow.tenant["timezone"], uow.tenant["business_day_cutoff"])
    uow.repo.query(
        "select pg_advisory_xact_lock(hashtextextended(:key,0))", key=f"tab-number:{uow.tenant['id']}:{day}"
    )
    number = uow.repo.query(
        "select coalesce(max(number),0)+1 from app.tabs where tenant_id=:tenant and business_date=:day",
        day=day,
    ).scalar_one()
    tab = uow.repo.insert(
        "tabs",
        {
            "table_id": body.table_id,
            "guests": guests,
            "number": number,
            "opened_by": uow.identity.user_id,
            "business_date": day,
        },
    )
    uow.event("tabs.opened", "tab", tab["id"], tab["version"])
    return tab


def calculate(uow, tab):
    items = (
        uow.repo.query(
            "select i.quantity,i.unit_price_cents,coalesce(m.price_cents,0) as modifiers_cents "
            "from app.order_items i join app.orders o on o.tenant_id=i.tenant_id and o.id=i.order_id "
            "left join lateral (select sum(m.unit_price_cents::numeric*m.quantity) as price_cents "
            "from app.order_item_modifiers m where m.tenant_id=i.tenant_id and m.item_id=i.id) m on true "
            "where i.tenant_id=:tenant and o.tab_id=:tab and i.status<>'cancelled' order by i.id",
            tab=tab["id"],
        )
        .mappings()
        .all()
    )
    subtotal = sum(g["quantity"] * g["unit_price_cents"] for g in tab.get("guests", [])
                   if not g["complimentary"])
    for item in items:
        # Keep per-line rounding and range checks in the domain calculation.
        subtotal += line_total(item["quantity"], item["unit_price_cents"], item["modifiers_cents"])
    subtotal = cents(Decimal(subtotal))
    discount = int(
        uow.repo.query(
            "select coalesce(sum(amount_cents),0) from app.adjustments where tenant_id=:tenant and tab_id=:tab and type='discount' and voided_at is null",
            tab=tab["id"],
        ).scalar_one()
    )
    if discount > subtotal:
        conflict(
            "DISCOUNT_EXCEEDS_SUBTOTAL",
            "O desconto excede o consumo. Revise o ajuste antes de cancelar itens.",
        )
    result = totals(subtotal, discount, uow.tenant["service_rate_bps"], tab["service_accepted"])
    received = int(
        uow.repo.query(
            "select coalesce(sum(case when type='receipt' then amount_cents else -amount_cents end),0) from app.payment_entries where tenant_id=:tenant and tab_id=:tab",
            tab=tab["id"],
        ).scalar_one()
    )
    result.update(received_cents=received, balance_cents=result["total_cents"] - received)
    return result


def tab_detail(uow, tab_id):
    uow.allow("read")
    tab = uow.repo.one("tabs", tab_id)
    orders = [
        dict(o)
        for o in uow.repo.query(
            "select * from app.orders where tenant_id=:tenant and tab_id=:tab order by sequence", tab=tab_id
        ).mappings()
    ]
    # Fetch each collection once, preserving row types and ordering in the DTO.
    by_order = {order["id"]: order for order in orders}
    for order in orders:
        order["items"] = []
    by_item = {}
    if orders:
        for row in uow.repo.query(
            "select i.* from app.order_items i join app.orders o "
            "on o.tenant_id=i.tenant_id and o.id=i.order_id "
            "where i.tenant_id=:tenant and o.tab_id=:tab order by i.created_at,i.id",
            tab=tab_id,
        ).mappings():
            item = {**row, "modifiers": []}
            # A new order can commit between the collection reads.
            if item["order_id"] in by_order:
                by_order[item["order_id"]]["items"].append(item)
                by_item[item["id"]] = item
    if by_item:
        for row in uow.repo.query(
            "select m.* from app.order_item_modifiers m join app.order_items i "
            "on i.tenant_id=m.tenant_id and i.id=m.item_id join app.orders o "
            "on o.tenant_id=i.tenant_id and o.id=i.order_id "
            "where m.tenant_id=:tenant and o.tab_id=:tab order by m.id",
            tab=tab_id,
        ).mappings():
            if row["item_id"] in by_item:
                by_item[row["item_id"]]["modifiers"].append(dict(row))
    settlement = (
        uow.repo.query(
            "select * from app.tab_settlements where tenant_id=:tenant and tab_id=:tab and status in ('active','settled') order by revision desc limit 1",
            tab=tab_id,
        )
        .mappings()
        .first()
    )
    amounts = (
        dict(settlement) if settlement and tab["status"] in ("closing", "closed") else calculate(uow, tab)
    )
    if settlement and tab["status"] in ("closing", "closed"):
        received = int(
            uow.repo.query(
                "select coalesce(sum(case when type='receipt' then amount_cents else -amount_cents end),0) from app.payment_entries where tenant_id=:tenant and tab_id=:tab",
                tab=tab_id,
            ).scalar_one()
        )
        amounts.update(
            received_cents=received,
            balance_cents=amounts["total_cents"] - received if tab["status"] != "closed" else 0,
        )
        amounts["refunded_cents"] = int(
            uow.repo.query(
                "select coalesce(sum(amount_cents),0) from app.payment_entries where tenant_id=:tenant and tab_id=:tab and type='refund'",
                tab=tab_id,
            ).scalar_one()
        )
    payments = [
        dict(p)
        for p in uow.repo.query(
            "select * from app.payment_entries where tenant_id=:tenant and tab_id=:tab order by created_at,id",
            tab=tab_id,
        ).mappings()
    ]
    adjustments = [
        dict(a)
        for a in uow.repo.query(
            "select * from app.adjustments where tenant_id=:tenant and tab_id=:tab order by created_at,id",
            tab=tab_id,
        ).mappings()
    ]
    return {
        **tab,
        "orders": orders,
        "amounts": amounts,
        "payments": payments,
        "adjustments": adjustments,
        "document_type": "NON_FISCAL_OPERATIONAL_STATEMENT",
    }


def submit_order(uow, tab_id, body):
    uow.allow("orders.submit", new_operation=True)
    tab = uow.repo.one("tabs", tab_id, lock=True)
    uow.version(tab, body.expected_version)
    require_open(tab)
    catalog_lock(uow, shared=True)
    prepared = []
    for entry in body.items:
        product = uow.repo.one("products", entry.product_id)
        category = uow.repo.one("categories", product["category_id"])
        if not product["active"] or not product["available"] or not category["active"]:
            conflict("PRODUCT_UNAVAILABLE", "Produto indisponível.", product_id=str(product["id"]))
        if product["version"] != entry.catalog_version:
            conflict(
                "PRICE_CHANGED",
                "O catálogo mudou. Revise o preço antes de confirmar.",
                product_id=str(product["id"]),
                price_cents=product["price_cents"],
                catalog_version=product["version"],
            )
        if product["unit"] == "unit" and entry.quantity != entry.quantity.to_integral_value():
            raise APIError(422, "INTEGER_QUANTITY_REQUIRED", "Este produto exige quantidade inteira.")
        if len(set(entry.modifier_option_ids)) != len(entry.modifier_option_ids):
            raise APIError(422, "DUPLICATE_MODIFIER", "Não repita o mesmo adicional.")
        groups = {
            g["id"]: dict(g)
            for g in uow.repo.query(
                "select g.* from app.modifier_groups g join app.product_modifier_groups p on p.tenant_id=g.tenant_id and p.group_id=g.id where g.tenant_id=:tenant and p.product_id=:id and g.active and p.active",
                id=product["id"],
            ).mappings()
        }
        options = []
        count = Counter()
        for option_id in entry.modifier_option_ids:
            option = uow.repo.one("modifier_options", option_id)
            if not option["active"] or option["group_id"] not in groups:
                raise APIError(422, "INVALID_MODIFIER", "Adicional não permitido para este produto.")
            count[option["group_id"]] += 1
            options.append(option)
        for group in groups.values():
            if not group["min_choices"] <= count[group["id"]] <= group["max_choices"]:
                raise APIError(
                    422,
                    "MODIFIER_CHOICES",
                    "Confira o mínimo e máximo de adicionais.",
                    {"group_id": str(group["id"])},
                )
        line_total(entry.quantity, product["price_cents"], sum(o["price_cents"] for o in options))
        prepared.append((entry, product, options))
    sequence = uow.repo.query(
        "select coalesce(max(sequence),0)+1 from app.orders where tenant_id=:tenant and tab_id=:tab",
        tab=tab_id,
    ).scalar_one()
    order = uow.repo.insert(
        "orders", {"tab_id": tab_id, "sequence": sequence, "submitted_by": uow.identity.user_id}
    )
    for entry, product, options in prepared:
        item = uow.repo.insert(
            "order_items",
            {
                "order_id": order["id"],
                "product_id": product["id"],
                "name_snapshot": product["name"],
                "unit_price_cents": product["price_cents"],
                "unit_snapshot": product["unit"],
                "quantity": entry.quantity,
                "notes": entry.notes,
            },
        )
        for option in options:
            uow.repo.insert(
                "order_item_modifiers",
                {
                    "item_id": item["id"],
                    "option_id": option["id"],
                    "name_snapshot": option["name"],
                    "unit_price_cents": option["price_cents"],
                    "quantity": 1,
                },
            )
    tab = bump(uow, tab, "orders.submitted")
    return {
        "order_id": order["id"],
        "tab_id": tab_id,
        "version": tab["version"],
        "submitted_at": order["submitted_at"],
        "amounts": calculate(uow, tab),
    }


def lock_item(uow, item_id):
    item = uow.repo.one("order_items", item_id)
    order = uow.repo.one("orders", item["order_id"])
    tab = uow.repo.one("tabs", order["tab_id"], lock=True)
    return tab, order, uow.repo.one("order_items", item_id, lock=True)


def derive_order(uow, order_id):
    states = [
        r[0]
        for r in uow.repo.query(
            "select status from app.order_items where tenant_id=:tenant and order_id=:id", id=order_id
        )
    ]
    live = [s for s in states if s != "cancelled"]
    status = (
        "cancelled"
        if not live
        else "completed"
        if all(s == "delivered" for s in live)
        else "submitted"
        if all(s == "submitted" for s in live)
        else "in_progress"
    )
    order = uow.repo.one("orders", order_id, lock=True)
    uow.repo.update("orders", order_id, {"status": status, "version": order["version"] + 1})


def transition(uow, item_id, body):
    uow.allow("items.deliver" if body.status == "delivered" else "items.prepare")
    tab, order, item = lock_item(uow, item_id)
    if tab["status"] not in ("open", "closing"):
        conflict("TAB_FINAL", "A comanda já foi encerrada.")
    uow.version(item, body.expected_version)
    if {"submitted": "preparing", "preparing": "ready", "ready": "delivered"}.get(
        item["status"]
    ) != body.status:
        conflict("INVALID_TRANSITION", "Transição de item não permitida.")
    result = uow.repo.update("order_items", item_id, {"status": body.status, "version": item["version"] + 1})
    derive_order(uow, order["id"])
    bump(uow, tab, "items.transitioned")
    return result


def cancel_item(uow, tab, item, reason):
    require_open(tab)
    if item["status"] in ("cancelled", "delivered"):
        conflict(
            "ITEM_NOT_CANCELLABLE",
            "Item entregue exige compensação gerencial; item cancelado não pode ser cancelado novamente.",
        )
    result = uow.repo.update(
        "order_items",
        item["id"],
        {
            "status": "cancelled",
            "version": item["version"] + 1,
            "cancelled_at": datetime.now(timezone.utc),
            "cancellation_reason": reason,
            "cancelled_by": uow.identity.user_id,
        },
    )
    calculate(uow, tab)  # Cancelling cannot leave the existing discounts larger than consumption.
    derive_order(uow, item["order_id"])
    bump(uow, tab, "items.cancelled", reason)
    return result


def request_approval(uow, action, resource_type, resource_id, version, payload):
    result = uow.repo.insert(
        "approval_requests",
        {
            "action": action,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "expected_version": version,
            "payload": payload,
            "payload_hash": sha256(canonical(payload).encode()).hexdigest(),
            "requested_by": uow.identity.user_id,
            "expires_at": datetime.now(timezone.utc) + timedelta(minutes=15),
        },
    )
    uow.event("approval.requested", "approval", result["id"], reason=payload.get("reason"))
    return {"approval_id": result["id"], "status": "pending", "expires_at": result["expires_at"]}


def cancel_request(uow, item_id, body):
    uow.allow("approval.request")
    tab, order, item = lock_item(uow, item_id)
    require_open(tab)
    uow.version(item, body.expected_version)
    if item["status"] in ("delivered", "cancelled"):
        conflict("ITEM_NOT_CANCELLABLE", "Este item não pode ser cancelado.")
    if uow.role in ("manager", "owner"):
        return cancel_item(uow, tab, item, body.reason)
    return request_approval(
        uow,
        "items.cancel",
        "item",
        item_id,
        item["version"],
        {"reason": body.reason, "tab_id": str(tab["id"]), "tab_version": tab["version"]},
    )


def add_adjustment(uow, tab_id, body, requested_by=None):
    uow.allow("discount" if body.type == "discount" else "tabs.close")
    tab = uow.repo.one("tabs", tab_id, lock=True)
    uow.version(tab, body.expected_version)
    closing_discount = tab["status"] == "closing" and body.type == "discount"
    if closing_discount:
        if uow.repo.query(
            "select 1 from app.payment_entries where tenant_id=:tenant and tab_id=:tab limit 1", tab=tab_id
        ).first():
            conflict("TAB_HAS_PAYMENTS", "Aplique descontos antes do primeiro recebimento.")
    else:
        require_open(tab)
    amount = calculate(uow, tab)
    if body.type == "discount":
        total_discount = amount["discount_cents"] + body.amount_cents
        if total_discount > amount["subtotal_cents"]:
            raise APIError(422, "INVALID_DISCOUNT", "Desconto não pode exceder o subtotal.")
        limit = 10000 if uow.role == "owner" else uow.tenant[f"{uow.role}_discount_limit_bps"]
        if total_discount * 10000 > amount["subtotal_cents"] * limit:
            if requested_by:
                raise APIError(
                    403, "APPROVER_LIMIT", "Este desconto exige aprovação de um perfil com limite maior."
                )
            return request_approval(
                uow, "tabs.discount", "tab", tab_id, tab["version"], body.model_dump(mode="json")
            )
        value = body.amount_cents
    else:
        if body.accepted is None or body.amount_cents != 0:
            raise APIError(
                422, "INVALID_SERVICE", "Informe accepted; o valor do serviço é calculado pelo servidor."
            )
        tab = uow.repo.update("tabs", tab_id, {"service_accepted": body.accepted})
        value = totals(
            amount["subtotal_cents"], amount["discount_cents"], uow.tenant["service_rate_bps"], body.accepted
        )["service_cents"]
    adjustment = uow.repo.insert(
        "adjustments",
        {
            "tab_id": tab_id,
            "type": body.type,
            "base_cents": amount["subtotal_cents"] - amount["discount_cents"]
            if body.type == "service"
            else amount["subtotal_cents"],
            "rule_snapshot": {"rate_bps": uow.tenant["service_rate_bps"]}
            if body.type == "service"
            else {"kind": "fixed_cents"},
            "amount_cents": value,
            "reason": body.reason,
            "requested_by": requested_by or uow.identity.user_id,
            "approved_by": uow.identity.user_id,
        },
    )
    tab = bump(uow, tab, "tabs.adjusted", body.reason)
    amounts = calculate(uow, tab)
    if closing_discount:
        from .settlements import freeze_settlement

        uow.repo.query(
            "update app.tab_settlements set status='superseded' where tenant_id=:tenant and tab_id=:tab and status='active'",
            tab=tab_id,
        )
        freeze_settlement(uow, tab_id, amounts)
    return {
        "tab_id": tab_id,
        "version": tab["version"],
        "amounts": amounts,
        "adjustment": adjustment,
    }


def void_adjustment(uow, tab_id, adjustment_id, body):
    uow.allow("discount.void")
    tab = uow.repo.one("tabs", tab_id, lock=True)
    uow.version(tab, body.expected_version)
    require_open(tab)
    adjustment = uow.repo.one("adjustments", adjustment_id, lock=True)
    if adjustment["tab_id"] != tab_id:
        missing()
    if adjustment["type"] != "discount" or adjustment["voided_at"] is not None:
        conflict("ADJUSTMENT_NOT_VOIDABLE", "Somente um desconto ativo pode ser anulado por esta operação.")
    adjustment = uow.repo.update(
        "adjustments",
        adjustment_id,
        {
            "voided_at": datetime.now(timezone.utc),
            "voided_by": uow.identity.user_id,
            "void_reason": body.reason,
        },
    )
    tab = bump(uow, tab, "adjustments.voided", body.reason)
    return {
        "tab_id": tab_id,
        "version": tab["version"],
        "amounts": calculate(uow, tab),
        "adjustment": adjustment,
    }


def approve(uow, approval_id):
    uow.allow("approval.execute")
    initial = uow.repo.one("approval_requests", approval_id)
    tab_id = initial["resource_id"] if initial["resource_type"] == "tab" else initial["payload"].get("tab_id")
    if tab_id is None:
        conflict("INVALID_APPROVAL", "Solicitação inválida.")
    tab = uow.repo.one("tabs", tab_id, lock=True)
    approval = uow.repo.one("approval_requests", approval_id, lock=True)
    if approval["status"] != "pending" or approval["expires_at"] <= datetime.now(timezone.utc):
        conflict("APPROVAL_UNAVAILABLE", "A aprovação já foi usada, invalidada ou expirou.")
    if sha256(canonical(approval["payload"]).encode()).hexdigest() != approval["payload_hash"]:
        conflict("INVALID_APPROVAL", "Conteúdo da aprovação inválido.")
    if approval["action"] == "items.cancel":
        item = uow.repo.one("order_items", approval["resource_id"], lock=True)
        uow.version(item, approval["expected_version"])
        uow.version(tab, approval["payload"]["tab_version"])
        result = cancel_item(uow, tab, item, approval["payload"]["reason"])
    elif approval["action"] == "tabs.discount":
        from comandei.schemas import Adjustment

        result = add_adjustment(
            uow, tab["id"], Adjustment.model_validate(approval["payload"]), approval["requested_by"]
        )
    else:
        conflict("INVALID_APPROVAL", "Ação de aprovação desconhecida.")
    uow.repo.update(
        "approval_requests",
        approval_id,
        {
            "status": "executed",
            "approved_by": uow.identity.user_id,
            "executed_at": datetime.now(timezone.utc),
        },
    )
    uow.event("approval.executed", "approval", approval_id, reason=approval["payload"].get("reason"))
    return result


def cancel_tab(uow, tab_id, body):
    uow.allow("tabs.close")
    tab = uow.repo.one("tabs", tab_id, lock=True)
    uow.version(tab, body.expected_version)
    require_open(tab)
    consumed = uow.repo.query(
        "select 1 from app.orders where tenant_id=:tenant and tab_id=:tab limit 1", tab=tab_id
    ).first()
    paid = uow.repo.query(
        "select 1 from app.payment_entries where tenant_id=:tenant and tab_id=:tab limit 1", tab=tab_id
    ).first()
    if consumed or paid or sum(guest_charges(tab.get("guests", [])).values()) > 0:
        conflict("TAB_HAS_HISTORY", "Somente comandas sem consumo e recebimentos podem ser canceladas.")
    result = uow.repo.update(
        "tabs",
        tab_id,
        {
            "status": "cancelled",
            "closed_at": datetime.now(timezone.utc),
            "closed_by": uow.identity.user_id,
            "version": tab["version"] + 1,
        },
    )
    uow.event("tabs.cancelled", "tab", tab_id, result["version"], body.reason)
    return result
