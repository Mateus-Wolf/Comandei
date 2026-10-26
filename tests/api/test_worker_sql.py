import os
from uuid import uuid4
import pytest
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError
from comandei.core.config import db_connect_args
from comandei.core.repository import execute


@pytest.mark.integration
def test_worker_publish_and_stale_lease_in_rollback():
    if os.getenv("RUN_DB_TESTS") != "1" or not os.getenv("SUPABASE_DB_URL"):
        pytest.skip("Enable RUN_DB_TESTS for PostgreSQL integration tests")
    url = make_url(os.environ["SUPABASE_DB_URL"]).set(drivername="postgresql+psycopg")
    engine = create_engine(url, connect_args=db_connect_args(url), hide_parameters=True)
    tenant, owner, event_id = uuid4(), uuid4(), uuid4()
    try:
        with engine.connect() as c:
            notices = []
            c.connection.driver_connection.add_notice_handler(
                lambda diag: notices.append(diag.message_primary)
            )
            transaction = c.begin()
            try:
                execute(
                    c,
                    "insert into app.tenants(id,name,slug) values(:id,'Worker test',:slug)",
                    {"id": tenant, "slug": f"worker-test-{tenant}"},
                )
                execute(
                    c,
                    "insert into app.outbox_events(id,tenant_id,type,aggregate_id,aggregate_version,payload) values(:id,:tenant,'test',:tenant,1,:payload)",
                    {"id": event_id, "tenant": tenant, "payload": {"aggregate_type": "tenant"}},
                )
                execute(c, "set local role comandei_worker")
                rows = (
                    execute(
                        c,
                        "select * from app.claim_outbox(:owner,:tenant)",
                        {"owner": owner, "tenant": tenant},
                    )
                    .mappings()
                    .all()
                )
                assert len(rows) == 1
                assert (
                    execute(
                        c, "select app.publish_outbox(:id,:owner)", {"id": event_id, "owner": uuid4()}
                    ).scalar_one()
                    is False
                )
                try:
                    assert (
                        execute(
                            c, "select app.publish_outbox(:id,:owner)", {"id": event_id, "owner": owner}
                        ).scalar_one()
                        is True
                    )
                except Exception as exc:
                    if notices:
                        raise AssertionError("; ".join(notices)) from exc
                    raise
                execute(c, "reset role")
                assert execute(
                    c, "select delivered_at is not null from app.outbox_events where id=:id", {"id": event_id}
                ).scalar_one()
                assert (
                    execute(
                        c,
                        "select count(*) from realtime.messages where topic=:topic",
                        {"topic": f"tenant:{tenant}:operations"},
                    ).scalar_one()
                    == 1
                )
            finally:
                transaction.rollback()
    finally:
        engine.dispose()


@pytest.mark.integration
def test_realtime_private_tenant_scope_and_no_client_publish():
    if os.getenv("RUN_DB_TESTS") != "1" or not os.getenv("SUPABASE_DB_URL"):
        pytest.skip("Enable RUN_DB_TESTS for PostgreSQL integration tests")
    url = make_url(os.environ["SUPABASE_DB_URL"]).set(drivername="postgresql+psycopg")
    engine = create_engine(url, connect_args=db_connect_args(url), hide_parameters=True)
    user, tenant_a, tenant_b = uuid4(), uuid4(), uuid4()
    topic_a, topic_b = f"tenant:{tenant_a}:operations", f"tenant:{tenant_b}:operations"
    try:
        with engine.connect() as c:
            transaction = c.begin()
            try:
                execute(c, "insert into auth.users(id) values(:id)", {"id": user})
                for tenant in (tenant_a, tenant_b):
                    execute(
                        c,
                        "insert into app.tenants(id,name,slug) values(:id,'Realtime test',:slug)",
                        {"id": tenant, "slug": f"rt-test-{tenant}"},
                    )
                    execute(
                        c,
                        "select realtime.send('{}'::jsonb,'invalidate',:topic,true)",
                        {"topic": f"tenant:{tenant}:operations"},
                    )
                execute(
                    c,
                    "insert into app.memberships(tenant_id,user_id,role) values(:tenant,:user,'waiter')",
                    {"tenant": tenant_a, "user": user},
                )
                execute(c, "set local role authenticated")
                execute(
                    c,
                    "select set_config('request.jwt.claim.sub',:user,true),set_config('realtime.topic',:topic,true)",
                    {"user": str(user), "topic": topic_a},
                )
                assert (
                    execute(
                        c, "select count(*) from realtime.messages where topic=:topic", {"topic": topic_a}
                    ).scalar_one()
                    == 1
                )
                assert (
                    execute(
                        c, "select count(*) from realtime.messages where topic=:topic", {"topic": topic_b}
                    ).scalar_one()
                    == 0
                )
                execute(c, "select set_config('realtime.topic',:topic,true)", {"topic": topic_b})
                assert (
                    execute(
                        c, "select count(*) from realtime.messages where topic=:topic", {"topic": topic_b}
                    ).scalar_one()
                    == 0
                )
                with pytest.raises(DBAPIError):
                    execute(
                        c,
                        "insert into realtime.messages(topic,extension,private,payload,event) values(:topic,'broadcast',true,'{}','invalidate')",
                        {"topic": topic_a},
                    )
            finally:
                transaction.rollback()
    finally:
        engine.dispose()
