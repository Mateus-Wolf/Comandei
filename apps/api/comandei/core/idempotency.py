from hashlib import sha256
from .serialization import canonical, encode
from .errors import APIError, conflict


def command(uow, key, endpoint, body, operation, status=200):
    if not key or not 8 <= len(key) <= 128:
        raise APIError(422, "IDEMPOTENCY_REQUIRED", "Envie Idempotency-Key entre 8 e 128 caracteres.")
    scoped = f"{uow.tenant['id']}:{uow.identity.user_id}:{endpoint}:{key}"
    # Transaction advisory lock serializes identical commands before any business mutation.
    uow.repo.query("select pg_advisory_xact_lock(hashtextextended(:key,0))", key=scoped)
    fingerprint = sha256(canonical(body).encode()).hexdigest()
    previous = (
        uow.repo.query(
            "select * from app.idempotency_records where tenant_id=:tenant and user_id=:user and endpoint=:endpoint and key=:key",
            user=uow.identity.user_id,
            endpoint=endpoint,
            key=key,
        )
        .mappings()
        .first()
    )
    if previous:
        if previous["body_hash"] != fingerprint:
            conflict("IDEMPOTENCY_MISMATCH", "A chave já foi usada com outro conteúdo.")
        return previous["result"], previous["http_status"], True
    result = encode(operation())
    uow.repo.insert(
        "idempotency_records",
        {
            "user_id": uow.identity.user_id,
            "endpoint": endpoint,
            "key": key,
            "body_hash": fingerprint,
            "result": result,
            "http_status": status,
        },
    )
    return result, status, False
