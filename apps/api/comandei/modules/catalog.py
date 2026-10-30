import base64
import json
from uuid import UUID
from comandei.core.errors import APIError, conflict

CATALOG = {
    "tables": "dining_tables",
    "categories": "categories",
    "products": "products",
    "modifier-groups": "modifier_groups",
    "modifier-options": "modifier_options",
    "product-modifier-groups": "product_modifier_groups",
    "cash-registers": "cash_registers",
}


def catalog_lock(uow, shared=False):
    suffix = "_shared" if shared else ""
    uow.repo.query(
        f"select pg_advisory_xact_lock{suffix}(hashtextextended(:key,0))", key=f"catalog:{uow.tenant['id']}"
    )


def page(uow, table, limit=50, cursor=None, status=None):
    uow.allow("read")
    after = None
    if cursor:
        try:
            data = json.loads(base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)))
            if data["table"] != table or data["tenant"] != str(uow.tenant["id"]):
                raise ValueError()
            after = UUID(data["id"])
        except (ValueError, KeyError, TypeError, UnicodeError):
            raise APIError(422, "INVALID_CURSOR", "Cursor inválido.")
    where = "tenant_id=:tenant"
    params = {"limit": limit + 1}
    if after:
        where += " and id>:after"
        params["after"] = after
    if status:
        where += " and status=:status"
        params["status"] = status
    if table == "cash_sessions" and uow.role == "cashier":
        where += " and operator_id=:operator"
        params["operator"] = uow.identity.user_id
    assert table in {
        *CATALOG.values(),
        "tabs",
        "orders",
        "approval_requests",
        "cash_sessions",
        "audit_events",
        "background_jobs",
    }
    # Background job results are downloaded through a separate authorization check.
    cols = "id,type,status,attempts,created_at,expires_at" if table == "background_jobs" else "*"
    if table == "dining_tables":
        # Return occupancy in the same query, using the unique active-table index.
        cols = (
            "dining_tables.*, (select jsonb_build_object('id',a.id,'number',a.number,"
            "'status',a.status,'version',a.version) from app.tabs a "
            "where a.tenant_id=dining_tables.tenant_id and a.table_id=dining_tables.id "
            "and a.status in ('open','closing')) as active_tab"
        )
    rows = [
        dict(r)
        for r in uow.repo.query(
            f"select {cols} from app.{table} where {where} order by id limit :limit", **params
        ).mappings()
    ]
    next_cursor = None
    if len(rows) > limit:
        rows = rows[:limit]
        next_cursor = (
            base64.urlsafe_b64encode(
                json.dumps(
                    {"table": table, "tenant": str(uow.tenant["id"]), "id": str(rows[-1]["id"])}
                ).encode()
            )
            .decode()
            .rstrip("=")
        )
    return {"items": rows, "next_cursor": next_cursor}


def touch_products(uow):
    # All catalog mutations invalidate cached quotes, including modifier prices/selection rules.
    uow.repo.query("update app.products set version=version+1 where tenant_id=:tenant")


def mutate(uow, table, body, resource_id=None):
    uow.allow("tables.write" if table == "dining_tables" else "catalog.write", new_operation=True)
    catalog_lock(uow)
    values = body.model_dump(exclude_unset=resource_id is not None)
    expected = values.pop("expected_version", None)
    for k, v in values.items():
        if v is None and k not in ("sku", "capacity"):
            raise APIError(422, "NULL_NOT_ALLOWED", f"O campo {k} não pode ser nulo.")
    if resource_id:
        old = uow.repo.one(table, resource_id, lock=True)
        uow.version(old, expected)
        values["version"] = old["version"] + 1
    else:
        old = {}
        if table == "dining_tables" and values.get("active", True):
            enforce_limit(uow, "max_tables", table)
    combined = {**old, **values}
    if table == "modifier_groups" and combined["max_choices"] < combined["min_choices"]:
        raise APIError(422, "INVALID_CHOICES", "Máximo de escolhas deve ser maior ou igual ao mínimo.")
    for column, parent in [
        ("category_id", "categories"),
        ("group_id", "modifier_groups"),
        ("product_id", "products"),
    ]:
        if column in values:
            linked = uow.repo.one(parent, values[column])
            if not linked["active"]:
                conflict("INACTIVE_REFERENCE", "O cadastro relacionado está desativado.")
    if resource_id and table == "dining_tables" and values.get("active") is True and not old["active"]:
        enforce_limit(uow, "max_tables", table)
    if resource_id and table in ("dining_tables", "cash_registers") and values.get("active") is False:
        if table == "dining_tables":
            busy = uow.repo.query(
                "select 1 from app.tabs where tenant_id=:tenant and table_id=:id and status in ('open','closing')",
                id=resource_id,
            ).first()
        else:
            busy = uow.repo.query(
                "select 1 from app.cash_sessions where tenant_id=:tenant and register_id=:id and status<>'closed'",
                id=resource_id,
            ).first()
        if busy:
            conflict("RESOURCE_BUSY", "Encerre a operação ativa antes de desativar o cadastro.")
    result = uow.repo.update(table, resource_id, values) if resource_id else uow.repo.insert(table, values)
    if table in ("products", "categories", "modifier_groups", "modifier_options", "product_modifier_groups"):
        touch_products(uow)
        if table == "products":
            result = uow.repo.one(table, result["id"])
    uow.event(
        "catalog.updated", table, result["id"], result["version"], summary={"active": result.get("active")}
    )
    return result


def enforce_limit(uow, key, table):
    # Serialize limit checks with other creations and membership provisioning.
    uow.repo.query("select id from app.tenants where id=:tenant for update")
    row = (
        uow.repo.query(
            f"select coalesce((select limits from app.tenant_entitlements where tenant_id=:tenant),'{{}}'::jsonb) as limits,"
            f"(select count(*) from app.{table} where tenant_id=:tenant and active) as count"
        )
        .mappings()
        .one()
    )
    maximum = row["limits"].get(key, 100)
    count = row["count"]
    if count >= maximum:
        raise APIError(403, "PLAN_LIMIT", "Limite do plano atingido.")


def settings(uow, body):
    uow.allow("settings.write", new_operation=True)
    row = dict(uow.repo.query("select * from app.tenants where id=:tenant for update").mappings().one())
    uow.version(row, body.expected_version)
    values = body.model_dump(exclude_unset=True)
    values.pop("expected_version")
    if any(v is None for k, v in values.items() if k != "photo_path"):
        raise APIError(422, "NULL_NOT_ALLOWED", "Configuração não pode ser nula.")
    if values.get("photo_path") and not values["photo_path"].startswith(str(uow.tenant["id"]) + "/"):
        raise APIError(422, "INVALID_PHOTO", "A foto deve pertencer a este restaurante.")
    details = values.pop("address_details", None)
    if details is not None:
        values["address"] = body.address_details.display()
        uow.repo.query(
            "insert into app.restaurant_addresses(tenant_id,postal_code,state,city,neighborhood,street,number,complement) "
            "values(:tenant,:postal_code,:state,:city,:neighborhood,:street,:number,:complement) "
            "on conflict(tenant_id) do update set postal_code=excluded.postal_code,state=excluded.state,"
            "city=excluded.city,neighborhood=excluded.neighborhood,street=excluded.street,"
            "number=excluded.number,complement=excluded.complement",
            **details,
        )
    values["version"] = row["version"] + 1
    from comandei.core.repository import execute, identifier

    assigns = ",".join(
        f"{identifier(k)}=array(select jsonb_array_elements_text(:{k}))"
        if k == "tab_reopen_roles" else f"{identifier(k)}=:{k}"
        for k in values
    )
    result = dict(
        execute(
            uow.connection,
            f"update app.tenants set {assigns} where id=:id returning *",
            {**values, "id": uow.tenant["id"]},
        )
        .mappings()
        .one()
    )
    result["address_details"] = uow.repo.query(
        "select to_jsonb(a) - 'tenant_id' - 'created_at' - 'updated_at' from app.restaurant_addresses a where tenant_id=:tenant"
    ).scalar_one_or_none()
    uow.event("settings.updated", "tenant", result["id"], result["version"])
    return result


def catalog(uow, limit, cursor):
    result = page(uow, "products", limit, cursor)
    for product in result["items"]:
        groups = [
            dict(g)
            for g in uow.repo.query(
                "select g.* from app.modifier_groups g join app.product_modifier_groups p on p.tenant_id=g.tenant_id and p.group_id=g.id where g.tenant_id=:tenant and p.product_id=:id and g.active and p.active order by p.position,g.id",
                id=product["id"],
            ).mappings()
        ]
        for group in groups:
            group["options"] = [
                dict(o)
                for o in uow.repo.query(
                    "select * from app.modifier_options where tenant_id=:tenant and group_id=:id and active order by id",
                    id=group["id"],
                ).mappings()
            ]
        product["modifier_groups"] = groups
    return result
