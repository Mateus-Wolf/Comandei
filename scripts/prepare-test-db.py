"""Replay migrations in an empty, explicitly local test database for CI."""

import os
from pathlib import Path
from secrets import token_urlsafe
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from comandei.core.config import db_connect_args

url = make_url(os.environ["SUPABASE_DB_URL"]).set(drivername="postgresql+psycopg")
if (
    os.getenv("APP_ENV") != "test"
    or url.host not in ("localhost", "127.0.0.1")
    or url.database != "comandei_test"
):
    raise RuntimeError("This bootstrap only runs against loopback comandei_test with APP_ENV=test.")
engine = create_engine(url, connect_args=db_connect_args(url), hide_parameters=True)
env = []
with engine.begin() as c:
    c.exec_driver_sql(Path("tests/bootstrap-postgres.sql").read_text(encoding="utf-8"))
    for migration in sorted(Path("supabase/migrations").glob("*.sql")):
        c.exec_driver_sql(migration.read_text(encoding="utf-8"))
    for role, key in [
        ("api", "DATABASE_URL"),
        ("worker", "WORKER_DATABASE_URL"),
        ("platform", "PLATFORM_DATABASE_URL"),
    ]:
        password = token_urlsafe(32)
        sql = c.execute(
            text(
                "select format('alter role %I login password %L',cast(:role as text),cast(:password as text))"
            ),
            {"role": f"comandei_{role}", "password": password},
        ).scalar_one()
        c.exec_driver_sql(sql)
        role_url = url.set(drivername="postgresql", username=f"comandei_{role}", password=password)
        env.append(f"{key}={role_url.render_as_string(hide_password=False)}")
with open(os.environ["GITHUB_ENV"], "a", encoding="utf-8") as output:
    output.write("\n".join(env) + "\n")
print("Empty test database migrated; separate runtime/service credentials configured.")
