from hashlib import sha256
from secrets import token_urlsafe
from comandei.core.auth import require_sensitive
from comandei.core.errors import missing


def invite(uow, body):
    uow.allow("members.invite", new_operation=True)
    if body.role == "owner":
        require_sensitive(uow.identity, uow.connection)
    token = token_urlsafe(48)
    result = uow.repo.query(
        "select app.invite_member(:tenant,:email,:role,:hash)",
        email=body.email.lower(),
        role=body.role,
        hash=sha256(token.encode()).hexdigest(),
    ).scalar_one()
    uow.event("members.invited", "invitation", result, summary={"role": body.role})
    # Delivery is explicit and assisted: API does not send unsolicited email.
    return {"id": result, "token": token, "expires_in_seconds": 172800}


def members(uow):
    uow.allow("members.manage")
    return {"items": [dict(r) for r in uow.repo.query("select * from app.staff_list(:tenant)").mappings()]}


def change_member(uow, user_id, body):
    uow.allow("members.manage")
    staff = uow.repo.query("select * from app.staff_list(:tenant)").mappings().all()
    existing = next((m for m in staff if m["user_id"] == user_id), None)
    if existing is None:
        missing()
    if body.role == "owner" or existing["role"] == "owner":
        require_sensitive(uow.identity, uow.connection)
    result = uow.repo.query(
        "select app.change_member(:tenant,:user,:role,:status)",
        user=user_id,
        role=body.role,
        status=body.status,
    ).scalar_one()
    uow.event("members.changed", "membership", result, summary={"role": body.role, "status": body.status})
    return {"user_id": user_id, "role": body.role, "status": body.status}
