from dataclasses import dataclass, field
from functools import cached_property
from uuid import UUID, uuid4
from fastapi import Depends, Request
from .auth import Identity, current_identity
from .db import engine
from .errors import APIError, conflict
from .permissions import require
from .repository import Repository, execute
from .serialization import encode


@dataclass
class UnitOfWork:
    connection: object
    identity: Identity
    tenant: dict
    role: str
    request_id: UUID

    rollback_actions: list = field(default_factory=list)

    @property
    def repo(self):
        return Repository(self.connection, self.tenant["id"])

    @cached_property
    def entitlements(self):
        # The unit of work lasts one request; never cache authorization across requests.
        row = (
            self.repo.query("select * from app.tenant_entitlements where tenant_id=:tenant")
            .mappings()
            .first()
        )
        return dict(row) if row else None

    def allow(self, action, new_operation=False):
        if action == "tabs.resume":
            from .errors import forbidden

            if self.role != "owner" and self.role not in self.tenant.get("tab_reopen_roles", ["cashier"]):
                forbidden()
        else:
            require(self.role, action)
        if not new_operation:
            return
        if new_operation and self.tenant["status"] != "active":
            raise APIError(
                403, "TENANT_RESTRICTED", "Novas operações estão suspensas; encerre as contas existentes."
            )
        entitlements = self.entitlements
        if new_operation and entitlements:
            from datetime import datetime, timezone

            expired = entitlements["ends_at"] and entitlements["ends_at"] < datetime.now(timezone.utc)
            if entitlements["status"] != "active" or expired:
                raise APIError(
                    403,
                    "PLAN_RESTRICTED",
                    "O plano restringe novas operações. Contas em andamento podem ser encerradas.",
                )

    def event(self, action, resource_type, resource_id, version=1, reason=None, summary=None):
        # Audit and outbox remain atomic with the business command in one round trip.
        execute(
            self.connection,
            "with audit as (insert into app.audit_events "
            "(tenant_id,actor_id,action,resource_type,resource_id,after_summary,reason,request_id) "
            "values(:tenant,:actor_id,:action,:resource_type,:resource_id,:after_summary,:reason,:request_id) returning id) "
            "insert into app.outbox_events(tenant_id,type,aggregate_id,aggregate_version,payload) "
            "select :tenant,:action,:resource_id,:version,:payload from audit",
            {
                "tenant": self.tenant["id"],
                "actor_id": self.identity.user_id,
                "action": action,
                "resource_type": resource_type,
                "resource_id": resource_id,
                "after_summary": encode(summary or {}),
                "reason": reason,
                "request_id": self.request_id,
                "version": version,
                "payload": {"aggregate_type": resource_type},
            },
        )

    def version(self, row, expected):
        if row["version"] != expected:
            conflict(
                "VERSION_CONFLICT",
                "O recurso foi atualizado. Revise os dados.",
                current_version=row["version"],
            )


def get_uow(request: Request, tenant_id: UUID, identity: Identity = Depends(current_identity)):
    # A failed business command must still consume its rate-limit budget.
    # One independently committed statement still charges failed business commands.
    # Materialization evaluates the transaction-local context before the guarded function.
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as limiter:
        allowed = execute(
            limiter,
            "with context as materialized (select set_config('app.user_id',:user,true) as actor) "
            "select app.consume_rate_limit(:key) from context where actor=:user",
            # A single account budget prevents arbitrary tenant UUIDs creating new buckets.
            {"user": str(identity.user_id), "key": f"{identity.user_id}:global"},
        ).scalar_one()
    if not allowed:
        raise APIError(429, "RATE_LIMITED", "Limite de requisições. Tente novamente em um minuto.")
    with engine.begin() as connection:
        if request.method == "GET":
            execute(connection, "set transaction isolation level repeatable read")
        execute(
            connection,
            "select set_config('app.user_id',:user,true),set_config('app.tenant_id',:tenant,true),set_config('statement_timeout','15000',true),set_config('lock_timeout','5000',true)",
            {"user": str(identity.user_id), "tenant": str(tenant_id)},
        )
        tenant = (
            execute(
                connection,
                "select t.*,m.role as membership_role from app.tenants t "
                "join app.memberships m on m.tenant_id=t.id "
                "where t.id=:tenant and m.user_id=:user and m.status='active'",
                {"tenant": tenant_id, "user": identity.user_id},
            )
            .mappings()
            .first()
        )
        if tenant is None:
            raise APIError(404, "NOT_FOUND", "Restaurante não encontrado.")
        if tenant["status"] == "closed":
            raise APIError(403, "TENANT_CLOSED", "Restaurante encerrado.")
        tenant = dict(tenant)
        membership = tenant.pop("membership_role")
        uow = UnitOfWork(
            connection, identity, tenant, membership, getattr(request.state, "request_id", uuid4())
        )
        try:
            yield uow
            connection.commit()
        except BaseException:
            connection.rollback()
            for cleanup in reversed(uow.rollback_actions):
                try:
                    cleanup()
                except Exception:
                    import logging
                    logging.getLogger("comandei").error("employee_login_cleanup_failed")
            raise
