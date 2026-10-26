from datetime import date
from hashlib import sha256
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Request
from fastapi.responses import JSONResponse, Response
from comandei import schemas as s
from comandei.core import config
from comandei.core.auth import Identity, current_identity, require_sensitive
from comandei.core.db import engine
from comandei.core.errors import APIError, forbidden
from comandei.core.idempotency import command
from comandei.core.repository import execute
from comandei.core.serialization import encode, canonical
from comandei.core.uow import UnitOfWork, get_uow
from comandei.modules import attendance, cash, catalog, identity, reports, settlements

router = APIRouter(prefix="/v1")
Uow = Annotated[UnitOfWork, Depends(get_uow, scope="function")]
User = Annotated[Identity, Depends(current_identity)]
Key = Annotated[str, Header(alias="Idempotency-Key", min_length=8, max_length=128)]
Limit = Annotated[int, Query(ge=1, le=100)]
Cursor = Annotated[str | None, Query(max_length=1024)]


def write(uow, request, key, body, action, operation, status=200, new=False):
    uow.allow(action)

    def guarded():
        uow.allow(action, new_operation=new)
        return operation()

    result, status, replay = command(uow, key, f"{request.method} {request.url.path}", body, guarded, status)
    return JSONResponse(
        encode(result), status_code=status, headers={"Idempotency-Replayed": str(replay).lower()}
    )


@router.get("/me/tenants", tags=["Identity"])
def my_tenants(user: User):
    with engine.begin() as c:
        execute(c, "select set_config('app.user_id',:user,true)", {"user": str(user.user_id)})
        return {"items": encode([dict(r) for r in execute(c, "select * from app.my_tenants()").mappings()])}


@router.get("/restaurants", tags=["Restaurants"])
def restaurants(user: User):
    with engine.begin() as c:
        execute(c, "select set_config('app.user_id',:user,true)", {"user": str(user.user_id)})
        return {
            "items": encode(execute(c, "select app.my_restaurants()").scalar_one()),
            "can_create": execute(c, "select app.can_register_restaurant()").scalar_one(),
        }


@router.post("/restaurants", status_code=201, tags=["Restaurants"])
def create_restaurant(body: s.RestaurantCreate, user: User, key: Key):
    values = body.model_dump(mode="json")
    with engine.begin() as c:
        execute(c, "select set_config('app.user_id',:user,true)", {"user": str(user.user_id)})
        result = execute(
            c,
            "select app.register_restaurant(:body,:key,:hash)",
            {"body": values, "key": key, "hash": sha256(canonical(values).encode()).hexdigest()},
        ).scalar_one()
        return JSONResponse(
            {"id": result["id"]},
            status_code=201,
            headers={"Idempotency-Replayed": str(result["replayed"]).lower()},
        )


@router.post("/invitations/accept", tags=["Identity"])
def accept_invitation(body: s.InvitationAccept, user: User):
    with engine.begin() as c:
        execute(c, "select set_config('app.user_id',:user,true)", {"user": str(user.user_id)})
        tenant = execute(
            c, "select app.accept_invitation(:hash)", {"hash": sha256(body.token.encode()).hexdigest()}
        ).scalar_one()
        execute(c, "select set_config('app.tenant_id',:tenant,true)", {"tenant": str(tenant)})
        execute(
            c,
            "insert into app.audit_events(tenant_id,actor_id,action,resource_type,resource_id,request_id) values(:tenant,:actor,'members.accepted','tenant',:tenant,gen_random_uuid())",
            {"tenant": tenant, "actor": user.user_id},
        )
        return {"tenant_id": str(tenant)}


def register_catalog(resource, table, create_dto, patch_dto):
    path = "/tenants/{tenant_id}/" + resource

    def listing(uow: Uow, limit: Limit = 50, cursor: Cursor = None):
        return encode(catalog.page(uow, table, limit, cursor))

    def get(resource_id: UUID, uow: Uow):
        uow.allow("read")
        return encode(uow.repo.one(table, resource_id))

    def create(body, request: Request, uow: Uow, key: Key):
        return write(
            uow,
            request,
            key,
            body.model_dump(mode="json"),
            "tables.write" if table == "dining_tables" else "catalog.write",
            lambda: catalog.mutate(uow, table, body),
            status=201,
            new=True,
        )

    def patch(resource_id: UUID, body, request: Request, uow: Uow, key: Key):
        return write(
            uow,
            request,
            key,
            body.model_dump(mode="json"),
            "tables.write" if table == "dining_tables" else "catalog.write",
            lambda: catalog.mutate(uow, table, body, resource_id),
            new=True,
        )

    create.__annotations__["body"] = create_dto
    patch.__annotations__["body"] = patch_dto
    read_dto = {
        "dining_tables": s.TableRead,
        "categories": s.CategoryRead,
        "products": s.ProductRead,
        "modifier_groups": s.ModifierGroupRead,
        "modifier_options": s.ModifierOptionRead,
        "product_modifier_groups": s.ProductGroupRead,
        "cash_registers": s.RegisterRead,
    }[table]
    router.add_api_route(
        path,
        listing,
        methods=["GET"],
        tags=["Catalog"],
        name=f"list_{table}",
        response_model=s.Page[read_dto],
    )
    router.add_api_route(
        path + "/{resource_id}",
        get,
        methods=["GET"],
        tags=["Catalog"],
        name=f"get_{table}",
        response_model=read_dto,
    )
    router.add_api_route(
        path,
        create,
        methods=["POST"],
        tags=["Catalog"],
        status_code=201,
        name=f"create_{table}",
        response_model=read_dto,
    )
    router.add_api_route(
        path + "/{resource_id}",
        patch,
        methods=["PATCH"],
        tags=["Catalog"],
        name=f"update_{table}",
        response_model=read_dto,
    )


for args in [
    ("tables", "dining_tables", s.TableCreate, s.TablePatch),
    ("categories", "categories", s.CategoryCreate, s.CategoryPatch),
    ("products", "products", s.ProductCreate, s.ProductPatch),
    ("modifier-groups", "modifier_groups", s.ModifierGroupCreate, s.ModifierGroupPatch),
    ("modifier-options", "modifier_options", s.ModifierOptionCreate, s.ModifierOptionPatch),
    ("product-modifier-groups", "product_modifier_groups", s.ProductGroupCreate, s.ProductGroupPatch),
    ("cash-registers", "cash_registers", s.RegisterCreate, s.RegisterPatch),
]:
    register_catalog(*args)


@router.get("/tenants/{tenant_id}/catalog", tags=["Catalog"], response_model=s.Page[s.ProductRead])
def get_catalog(uow: Uow, limit: Limit = 50, cursor: Cursor = None):
    return encode(catalog.catalog(uow, limit, cursor))


@router.get("/tenants/{tenant_id}/settings", tags=["Administration"])
def get_settings(uow: Uow):
    uow.allow("read")
    return encode(uow.tenant)


@router.patch("/tenants/{tenant_id}/settings", tags=["Administration"])
def patch_settings(body: s.SettingsPatch, request: Request, uow: Uow, key: Key):
    return write(
        uow,
        request,
        key,
        body.model_dump(mode="json"),
        "settings.write",
        lambda: catalog.settings(uow, body),
        new=True,
    )


@router.get("/tenants/{tenant_id}/tabs", tags=["Attendance"])
def list_tabs(
    uow: Uow,
    limit: Limit = 50,
    cursor: Cursor = None,
    status: Annotated[str | None, Query(pattern="^(open|closing|closed|cancelled)$")] = None,
):
    return encode(catalog.page(uow, "tabs", limit, cursor, status))


@router.post("/tenants/{tenant_id}/tabs", status_code=201, tags=["Attendance"], response_model=s.TabRead)
def open_tab(body: s.TabOpen, request: Request, uow: Uow, key: Key):
    return write(
        uow,
        request,
        key,
        body.model_dump(mode="json"),
        "tabs.open",
        lambda: attendance.open_tab(uow, body),
        201,
        new=True,
    )


@router.get("/tenants/{tenant_id}/tabs/{tab_id}", tags=["Attendance"])
def tab_detail(tab_id: UUID, uow: Uow):
    return encode(attendance.tab_detail(uow, tab_id))


@router.get("/tenants/{tenant_id}/tabs/{tab_id}/prebill", tags=["Payments"])
def prebill(tab_id: UUID, uow: Uow):
    detail = attendance.tab_detail(uow, tab_id)
    return encode({k: detail[k] for k in ("id", "number", "version", "amounts", "document_type")})


@router.get("/tenants/{tenant_id}/tabs/{tab_id}/receipt", tags=["Payments"])
def receipt(tab_id: UUID, uow: Uow):
    detail = attendance.tab_detail(uow, tab_id)
    if detail["status"] != "closed":
        raise APIError(409, "TAB_NOT_CLOSED", "O recibo exige uma comanda encerrada.")
    detail["document_type"] = "NON_FISCAL_OPERATIONAL_RECEIPT"
    return encode(detail)


@router.get("/tenants/{tenant_id}/entitlements", tags=["Administration"])
def entitlements(uow: Uow):
    uow.allow("settings.write")
    row = uow.repo.query("select * from app.tenant_entitlements where tenant_id=:tenant").mappings().first()
    return encode(dict(row) if row else {})


@router.post(
    "/tenants/{tenant_id}/tabs/{tab_id}/orders",
    status_code=201,
    tags=["Attendance"],
    response_model=s.OrderSubmitted,
)
def submit_order(tab_id: UUID, body: s.OrderSubmit, request: Request, uow: Uow, key: Key):
    return write(
        uow,
        request,
        key,
        body.model_dump(mode="json"),
        "orders.submit",
        lambda: attendance.submit_order(uow, tab_id, body),
        201,
        new=True,
    )


@router.post("/tenants/{tenant_id}/items/{item_id}/transitions", tags=["Attendance"])
def transition(item_id: UUID, body: s.Transition, request: Request, uow: Uow, key: Key):
    action = "items.deliver" if body.status == "delivered" else "items.prepare"
    return write(
        uow,
        request,
        key,
        body.model_dump(mode="json"),
        action,
        lambda: attendance.transition(uow, item_id, body),
    )


@router.post("/tenants/{tenant_id}/items/{item_id}/cancel-requests", tags=["Approvals"])
def cancel_request(item_id: UUID, body: s.CancelRequest, request: Request, uow: Uow, key: Key):
    return write(
        uow,
        request,
        key,
        body.model_dump(mode="json"),
        "approval.request",
        lambda: attendance.cancel_request(uow, item_id, body),
    )


@router.get("/tenants/{tenant_id}/approvals", tags=["Approvals"])
def approvals(uow: Uow, limit: Limit = 50, cursor: Cursor = None):
    uow.allow("approval.execute")
    return encode(catalog.page(uow, "approval_requests", limit, cursor))


@router.post("/tenants/{tenant_id}/approvals/{approval_id}/approve", tags=["Approvals"])
def approve(approval_id: UUID, request: Request, uow: Uow, key: Key):
    return write(uow, request, key, {}, "approval.execute", lambda: attendance.approve(uow, approval_id))


@router.post("/tenants/{tenant_id}/tabs/{tab_id}/adjustments", tags=["Payments"])
def adjustment(tab_id: UUID, body: s.Adjustment, request: Request, uow: Uow, key: Key):
    return write(
        uow,
        request,
        key,
        body.model_dump(mode="json"),
        "discount" if body.type == "discount" else "tabs.close",
        lambda: attendance.add_adjustment(uow, tab_id, body),
    )


@router.post(
    "/tenants/{tenant_id}/tabs/{tab_id}/start-closing", tags=["Payments"], response_model=s.FrozenSettlement
)
def start_closing(tab_id: UUID, body: s.StartClosing, request: Request, uow: Uow, key: Key):
    return write(
        uow,
        request,
        key,
        body.model_dump(mode="json"),
        "tabs.close",
        lambda: settlements.start_closing(uow, tab_id, body),
    )


@router.post("/tenants/{tenant_id}/tabs/{tab_id}/adjustments/{adjustment_id}/void", tags=["Payments"])
def void_adjustment(
    tab_id: UUID, adjustment_id: UUID, body: s.CancelRequest, request: Request, uow: Uow, key: Key
):
    return write(
        uow,
        request,
        key,
        body.model_dump(mode="json"),
        "discount.void",
        lambda: attendance.void_adjustment(uow, tab_id, adjustment_id, body),
    )


@router.post("/tenants/{tenant_id}/tabs/{tab_id}/resume", tags=["Payments"])
def resume(tab_id: UUID, body: s.Expected, request: Request, uow: Uow, key: Key):
    return write(
        uow,
        request,
        key,
        body.model_dump(mode="json"),
        "tabs.resume",
        lambda: settlements.resume(uow, tab_id, body),
    )


@router.post(
    "/tenants/{tenant_id}/tabs/{tab_id}/payments",
    status_code=201,
    tags=["Payments"],
    response_model=s.PaymentRecorded,
)
def payment(tab_id: UUID, body: s.Payment, request: Request, uow: Uow, key: Key):
    return write(
        uow,
        request,
        key,
        body.model_dump(mode="json"),
        "payments.record",
        lambda: settlements.payment(uow, tab_id, body),
        201,
    )


@router.post("/tenants/{tenant_id}/tabs/{tab_id}/close", tags=["Payments"], response_model=s.TabRead)
def close_tab(tab_id: UUID, body: s.Expected, request: Request, uow: Uow, key: Key):
    return write(
        uow,
        request,
        key,
        body.model_dump(mode="json"),
        "tabs.close",
        lambda: settlements.close_tab(uow, tab_id, body),
    )


@router.post("/tenants/{tenant_id}/tabs/{tab_id}/cancel", tags=["Attendance"])
def cancel_tab(tab_id: UUID, body: s.CancelRequest, request: Request, uow: Uow, key: Key):
    return write(
        uow,
        request,
        key,
        body.model_dump(mode="json"),
        "tabs.close",
        lambda: attendance.cancel_tab(uow, tab_id, body),
    )


@router.post(
    "/tenants/{tenant_id}/payments/{payment_id}/refunds",
    status_code=201,
    tags=["Payments"],
    response_model=s.PaymentRead,
)
def refund(payment_id: UUID, body: s.Refund, request: Request, uow: Uow, key: Key):
    uow.allow("payments.refund")
    require_sensitive(uow.identity, uow.connection)
    return write(
        uow,
        request,
        key,
        body.model_dump(mode="json"),
        "payments.refund",
        lambda: settlements.refund(uow, payment_id, body),
        201,
    )


@router.post("/tenants/{tenant_id}/cash-sessions", status_code=201, tags=["Cash"])
def open_session(body: s.CashOpen, request: Request, uow: Uow, key: Key):
    return write(
        uow,
        request,
        key,
        body.model_dump(mode="json"),
        "cash.write",
        lambda: cash.open_session(uow, body),
        201,
        new=True,
    )


@router.get("/tenants/{tenant_id}/cash-sessions", tags=["Cash"])
def sessions(uow: Uow, limit: Limit = 50, cursor: Cursor = None):
    uow.allow("cash.write")
    result = catalog.page(uow, "cash_sessions", limit, cursor)
    return encode(result)


@router.get("/tenants/{tenant_id}/cash-sessions/{session_id}", tags=["Cash"])
def session_detail(session_id: UUID, uow: Uow):
    return encode(cash.detail(uow, session_id))


@router.post("/tenants/{tenant_id}/cash-sessions/{session_id}/movements", status_code=201, tags=["Cash"])
def movement(session_id: UUID, body: s.CashMovement, request: Request, uow: Uow, key: Key):
    return write(
        uow,
        request,
        key,
        body.model_dump(mode="json"),
        "cash.write",
        lambda: cash.movement(uow, session_id, body),
        201,
    )


@router.post("/tenants/{tenant_id}/cash-sessions/{session_id}/close", tags=["Cash"])
def close_session(session_id: UUID, body: s.CashClose, request: Request, uow: Uow, key: Key):
    return write(
        uow,
        request,
        key,
        body.model_dump(mode="json"),
        "cash.write",
        lambda: cash.close(uow, session_id, body),
    )


@router.get("/tenants/{tenant_id}/reports/daily", tags=["Reports"])
def daily_report(day: date, uow: Uow):
    return encode(reports.daily(uow, day))


@router.post("/tenants/{tenant_id}/exports", status_code=202, tags=["Reports"])
def export(body: s.ExportCreate, request: Request, uow: Uow, key: Key):
    return write(
        uow,
        request,
        key,
        body.model_dump(mode="json"),
        "exports.create",
        lambda: reports.request_export(uow, body),
        202,
    )


@router.get("/tenants/{tenant_id}/exports/{job_id}", tags=["Reports"])
def export_status(job_id: UUID, uow: Uow):
    return encode(reports.get_export(uow, job_id))


@router.get("/tenants/{tenant_id}/exports/{job_id}/download", tags=["Reports"])
def export_download(job_id: UUID, uow: Uow):
    return Response(
        reports.get_export(uow, job_id, download=True),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="comandei-{job_id}.csv"'},
    )


@router.get("/tenants/{tenant_id}/members", tags=["Administration"])
def list_members(uow: Uow):
    return encode(identity.members(uow))


@router.post("/tenants/{tenant_id}/invitations", status_code=201, tags=["Administration"])
def invite(body: s.InvitationCreate, request: Request, uow: Uow, key: Key):
    uow.allow("members.invite")
    if body.role == "owner":
        require_sensitive(uow.identity, uow.connection)
    return write(
        uow,
        request,
        key,
        body.model_dump(mode="json"),
        "members.invite",
        lambda: identity.invite(uow, body),
        201,
        new=True,
    )


@router.patch("/tenants/{tenant_id}/members/{user_id}", tags=["Administration"])
def change_member(user_id: UUID, body: s.MemberPatch, request: Request, uow: Uow, key: Key):
    uow.allow("members.manage")
    if body.role == "owner":
        require_sensitive(uow.identity, uow.connection)
    return write(
        uow,
        request,
        key,
        body.model_dump(mode="json"),
        "members.manage",
        lambda: identity.change_member(uow, user_id, body),
    )


@router.get("/tenants/{tenant_id}/audit-events", tags=["Administration"])
def audit_events(uow: Uow, limit: Limit = 50, cursor: Cursor = None):
    uow.allow("audit.read")
    return encode(catalog.page(uow, "audit_events", limit, cursor))


@router.post("/tenants/{tenant_id}/outbox/{event_id}/retry", tags=["Administration"])
def retry_outbox(event_id: UUID, request: Request, uow: Uow, key: Key):
    def operation():
        row = uow.repo.one("outbox_events", event_id, lock=True)
        if row["failed_at"] is None:
            raise APIError(
                409, "EVENT_NOT_FAILED", "Somente avisos com falha definitiva podem ser reprocessados."
            )
        result = uow.repo.update(
            "outbox_events",
            event_id,
            {"failed_at": None, "attempts": 0, "lease_owner": None, "lease_until": None, "last_error": None},
        )
        uow.event("outbox.retried", "event", event_id)
        return {"id": result["id"], "status": "pending"}

    return write(uow, request, key, {}, "exports.create", operation)


def platform_connection(user):
    if str(user.user_id) not in config.PLATFORM_OPERATORS:
        forbidden()
    from comandei.core.service_db import service_engine

    return service_engine("platform")


@router.get("/platform/tenants", tags=["Platform"])
def platform_tenants(user: User):
    with platform_connection(user).begin() as c:
        execute(c, "select set_config('app.user_id',:user,true)", {"user": str(user.user_id)})
        require_sensitive(user, c)
        return {
            "items": encode([dict(r) for r in execute(c, "select * from app.platform_tenants()").mappings()])
        }


@router.post("/platform/tenants", status_code=201, tags=["Platform"])
def platform_provision(body: s.TenantCreate, user: User):
    with platform_connection(user).begin() as c:
        execute(c, "select set_config('app.user_id',:user,true)", {"user": str(user.user_id)})
        require_sensitive(user, c)
        result = execute(
            c,
            "select app.platform_provision(:name,:slug,:owner)",
            {"name": body.name, "slug": body.slug, "owner": body.owner_user_id},
        ).scalar_one()
        return {"tenant_id": str(result)}


@router.patch("/platform/tenants/{tenant_id}/plan", tags=["Platform"])
def platform_plan(tenant_id: UUID, body: s.PlanUpdate, user: User):
    with platform_connection(user).begin() as c:
        execute(c, "select set_config('app.user_id',:user,true)", {"user": str(user.user_id)})
        require_sensitive(user, c)
        execute(
            c,
            "select app.platform_plan(:tenant,:status,:plan,:limits)",
            {
                "tenant": tenant_id,
                "status": body.status,
                "plan": body.plan,
                "limits": {"max_users": body.max_users, "max_tables": body.max_tables},
            },
        )
        return {"tenant_id": str(tenant_id), "status": body.status, "plan": body.plan}
