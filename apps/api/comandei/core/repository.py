"""Only trusted module code supplies SQL or identifiers; request values are bound."""

import re
from sqlalchemy import text, bindparam
from sqlalchemy.dialects.postgresql import JSONB
from .errors import missing

TABLES = frozenset(
    "tenants profiles memberships invitations tenant_entitlements dining_tables categories products modifier_groups modifier_options product_modifier_groups tabs orders order_items order_item_modifiers adjustments approval_requests tab_settlements payment_entries cash_registers cash_sessions cash_movements audit_events outbox_events idempotency_records background_jobs".split()
)


def identifier(value):
    if not re.fullmatch("[a-z_][a-z_0-9]*", value):
        raise ValueError("Invalid internal identifier")
    return value


def execute(connection, sql, params=None):
    params = params or {}
    statement = text(sql)
    for key, value in params.items():
        if isinstance(value, (dict, list)):
            statement = statement.bindparams(bindparam(key, type_=JSONB))
    return connection.execute(statement, params)


class Repository:
    def __init__(self, connection, tenant_id):
        self.connection, self.tenant_id = connection, tenant_id

    def query(self, sql, **params):
        return execute(self.connection, sql, {"tenant": self.tenant_id, **params})

    def one(self, table, resource_id, lock=False):
        assert table in TABLES
        row = (
            self.query(
                f"select * from app.{table} where tenant_id=:tenant and id=:id"
                + (" for update" if lock else ""),
                id=resource_id,
            )
            .mappings()
            .first()
        )
        if row is None:
            missing()
        return dict(row)

    def insert(self, table, values):
        assert table in TABLES
        values = {**values, "tenant_id": self.tenant_id}
        columns = ",".join(identifier(k) for k in values)
        binds = ",".join(":" + k for k in values)
        return dict(
            execute(
                self.connection, f"insert into app.{table} ({columns}) values ({binds}) returning *", values
            )
            .mappings()
            .one()
        )

    def update(self, table, resource_id, values):
        assert table in TABLES and values
        assert not {"tenant_id", "id"} & values.keys()
        assigns = ",".join(f"{identifier(k)}=:{k}" for k in values)
        row = (
            self.query(
                f"update app.{table} set {assigns} where tenant_id=:tenant and id=:resource_id returning *",
                resource_id=resource_id,
                **values,
            )
            .mappings()
            .first()
        )
        if row is None:
            missing()
        return dict(row)
