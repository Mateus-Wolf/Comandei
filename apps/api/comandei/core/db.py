"""TLS connection and transaction-local isolation; no schema auto-creation."""

from contextlib import contextmanager
import os
from pathlib import Path
from uuid import UUID

from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from .config import db_connect_args

ROOT = Path(__file__).resolve().parents[4]
load_dotenv(ROOT / ".env.local")
url = make_url(os.environ["DATABASE_URL"]).set(drivername="postgresql+psycopg")
if (url.username or "").split(".", 1)[0] != "comandei_api":
    raise RuntimeError("A API exige a credencial restrita comandei_api.")
ca_path = Path(os.getenv("SUPABASE_DB_CA", "certs/supabase-ca.crt"))
if not ca_path.is_absolute():
    ca_path = ROOT / ca_path
engine = create_engine(
    url,
    pool_size=5,
    max_overflow=0,
    pool_timeout=10,
    pool_pre_ping=True,
    hide_parameters=True,
    connect_args=db_connect_args(url),
)


@contextmanager
def tenant_transaction(verified_user_id: UUID, tenant_id: UUID):
    """Caller MUST verify the JWT first and enforce action permissions separately.

    Never pass a user ID from request body/headers. This checks current membership
    in the database; context expires on both commit and rollback.
    """
    with engine.begin() as connection:
        connection.execute(
            text("select set_config('app.user_id', :user_id, true)"), {"user_id": str(verified_user_id)}
        )
        membership = connection.execute(
            text(
                "select role from app.memberships where user_id = :user_id "
                "and tenant_id = :tenant_id and status = 'active'"
            ),
            {"user_id": verified_user_id, "tenant_id": tenant_id},
        ).scalar_one_or_none()
        if membership is None:
            raise PermissionError("Vínculo ativo com o restaurante é obrigatório.")
        connection.execute(
            text("select set_config('app.tenant_id', :tenant_id, true)"), {"tenant_id": str(tenant_id)}
        )
        status = connection.execute(
            text("select status from app.tenants where id = :id"), {"id": tenant_id}
        ).scalar_one_or_none()
        if status == "closed":
            raise PermissionError("Restaurante indisponível para operação.")
        yield connection


def check_database() -> None:
    with engine.connect() as connection:
        row = connection.execute(
            text("select current_user, rolsuper, rolbypassrls from pg_roles where rolname=current_user")
        ).one()
        if row[0] != "comandei_api" or row[1] or row[2]:
            raise RuntimeError("Privilégios de runtime inválidos.")
        assert connection.execute(text("select count(*) from app.dining_tables")).scalar_one() == 0


if __name__ == "__main__":
    from sqlalchemy.exc import DBAPIError

    try:
        check_database()
    except DBAPIError:
        raise SystemExit("Banco indisponível. Confira a rede e as credenciais locais.") from None
    print("OK: backend SQLAlchemy/psycopg conectado com TLS e credencial restrita.")
