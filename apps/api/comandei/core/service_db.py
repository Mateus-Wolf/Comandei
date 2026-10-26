from functools import lru_cache
import os
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from .config import db_connect_args
from .errors import APIError


@lru_cache(maxsize=2)
def service_engine(name):
    assert name in ("worker", "platform")
    raw = os.getenv(f"{name.upper()}_DATABASE_URL")
    if not raw:
        raise APIError(503, "SERVICE_NOT_CONFIGURED", "Este serviço ainda não foi configurado.")
    url = make_url(raw).set(drivername="postgresql+psycopg")
    if (url.username or "").split(".", 1)[0] != f"comandei_{name}":
        raise RuntimeError("Invalid service database role")
    return create_engine(
        url,
        pool_size=2,
        max_overflow=0,
        pool_pre_ping=True,
        hide_parameters=True,
        connect_args=db_connect_args(url),
    )
