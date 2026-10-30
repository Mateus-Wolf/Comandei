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


def team(uow):
    uow.allow("members.manage")
    # Both sections use the same authorized request and database snapshot.
    row = (
        uow.repo.query(
            "select coalesce((select jsonb_agg(s) from app.staff_list(:tenant) s),'[]'::jsonb) as members,"
            "coalesce((select jsonb_agg(jsonb_build_object('id',id,'email',email,'role',role,'expires_at',expires_at) "
            "order by created_at desc,id) from app.invitations where tenant_id=:tenant "
            "and consumed_at is null and expires_at>now()),'[]'::jsonb) as invitations"
        )
        .mappings()
        .one()
    )
    return dict(row)


def invitations(uow):
    uow.allow("members.manage")
    return {
        "items": [
            dict(r)
            for r in uow.repo.query(
                "select id,email,role,expires_at from app.invitations "
                "where tenant_id=:tenant and consumed_at is null and expires_at>now() order by created_at desc"
            ).mappings()
        ]
    }


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


def create_employee_login(uow, body):
    from uuid import UUID
    import httpx
    from comandei.core import config
    from comandei.core.errors import APIError
    from comandei.core.auth import http

    uow.allow("members.manage", new_operation=True)
    if not config.SUPABASE_SECRET_KEY:
        raise APIError(503, "LOGIN_SETUP_REQUIRED", "A criação de logins precisa ser configurada no servidor.")
    # Validate and lock the tenant before creating any external account.
    uow.repo.query("select app.check_employee_login(:tenant)").scalar_one()
    headers = {"apikey": config.SUPABASE_SECRET_KEY,
               "Authorization": "Bearer " + config.SUPABASE_SECRET_KEY}
    try:
        response = http.post(config.ISSUER + "/admin/users", headers=headers, json={
            "email": body.username + "@staff.comandei.internal",
            "password": body.password,
            "email_confirm": True,
            "user_metadata": {"display_name": body.display_name},
        })
    except httpx.HTTPError as exc:
        raise APIError(503, "AUTH_UNAVAILABLE", "Não foi possível criar o login. Tente novamente.") from exc
    if response.status_code in (400, 422):
        code = response.json().get("error_code", response.json().get("code", ""))
        if code in ("email_exists", "user_already_exists"):
            raise APIError(409, "USERNAME_TAKEN", "Este usuário já está em uso. Escolha outro.")
        raise APIError(422, "LOGIN_INVALID", "Confira o usuário e escolha uma senha mais forte.")
    if response.status_code >= 300:
        raise APIError(503, "AUTH_UNAVAILABLE", "Não foi possível criar o login. Tente novamente.")
    user_id = UUID(response.json()["id"])

    def cleanup():
        result = http.delete(config.ISSUER + f"/admin/users/{user_id}", headers=headers)
        result.raise_for_status()

    uow.rollback_actions.append(cleanup)
    result = uow.repo.query("select app.add_employee_login(:tenant,:user,:role)",
                            user=user_id, role=body.role).scalar_one()
    uow.event("members.created", "membership", result, summary={"role": body.role})
    return {"user_id": user_id, "username": body.username, "role": body.role, "status": "active"}
