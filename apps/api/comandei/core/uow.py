from dataclasses import dataclass
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

    @property
    def repo(self):
        return Repository(self.connection, self.tenant["id"])

    def allow(self, action, new_operation=False):
        require(self.role, action)
        if new_operation and self.tenant["status"] != "active":
            raise APIError(
                403, "TENANT_RESTRICTED", "Novas operações estão suspensas; encerre as contas existentes."
            )
        entitlements = (
            self.repo.query("select * from app.tenant_entitlements where tenant_id=:tenant")
            .mappings()
            .first()
        )
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
        self.repo.insert(
            "audit_events",
            {
                "actor_id": self.identity.user_id,
                "action": action,
                "resource_type": resource_type,
                "resource_id": resource_id,
                "after_summary": encode(summary or {}),
                "reason": reason,
                "request_id": self.request_id,
            },
        )
        self.repo.insert(
            "outbox_events",
            {
                "type": action,
                "aggregate_id": resource_id,
                "aggregate_version": version,
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
    with engine.begin() as limiter:
        execute(limiter, "select set_config('app.user_id',:user,true)", {"user": str(identity.user_id)})
        allowed = execute(
            limiter, "select app.consume_rate_limit(:key)", {"key": f"{identity.user_id}:{tenant_id}"}
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
        membership = execute(
            connection,
            "select role from app.memberships where user_id=:user and tenant_id=:tenant and status='active'",
            {"user": identity.user_id, "tenant": tenant_id},
        ).scalar_one_or_none()
        if membership is None:
            raise APIError(404, "NOT_FOUND", "Restaurante não encontrado.")
        tenant = (
            execute(connection, "select * from app.tenants where id=:tenant", {"tenant": tenant_id})
            .mappings()
            .first()
        )
        if tenant is None or tenant["status"] == "closed":
            raise APIError(403, "TENANT_CLOSED", "Restaurante encerrado.")
        yield UnitOfWork(
            connection, identity, dict(tenant), membership, getattr(request.state, "request_id", uuid4())
        )
