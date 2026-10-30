"""Opt-in screen benchmarks using only disposable integration fixtures."""

from time import perf_counter
from uuid import uuid4

import pytest
from sqlalchemy import event

from comandei.core.db import engine
from comandei.core.repository import execute

pytestmark = pytest.mark.integration


def test_restaurant_screen_query_budget(api):
    with api["admin"].begin() as connection:
        execute(
            connection,
            "insert into app.dining_tables(tenant_id,code,name,capacity) "
            "select :tenant, 'perf-'||n, 'Mesa teste '||n, 4 from generate_series(1,12) n",
            {"tenant": api["tenants"]["a"]},
        )
    statements = []

    def count_statement(*args):
        statements.append(args[2])

    event.listen(engine, "before_cursor_execute", count_statement)
    try:
        for name, method, path, body in [
            ("restaurants", "GET", "/v1/restaurants", None),
            ("tables_13", "GET", "tables?limit=100", None),
            (
                "create_table",
                "POST",
                "tables",
                {"code": str(uuid4()), "name": "Mesa benchmark", "capacity": 4},
            ),
        ]:
            statements.clear()
            started = perf_counter()
            response = api["call"](method, path, body)
            elapsed = (perf_counter() - started) * 1000
            assert response.status_code in (200, 201), response.text
            print(f"BENCH {name}: {elapsed:.0f} ms, {len(statements)} SQL statements")
            assert len(statements) <= {"restaurants": 2, "tables_13": 5, "create_table": 12}[name]
            if name == "tables_13":
                assert len(response.json()["items"]) == 13
                assert all(item["active_tab"] is None for item in response.json()["items"])
    finally:
        event.remove(engine, "before_cursor_execute", count_statement)


def test_failed_commands_charge_limit_without_leaking_connection_context(api):
    response = api["call"]("POST", "tables", {"code": "denied", "name": "Mesa"}, role="waiter")
    assert response.status_code == 403
    with api["admin"].begin() as connection:
        hits = execute(
            connection,
            "select requests from app.request_buckets where key=:key",
            {"key": f"{api['users']['waiter']}:global"},
        ).scalar_one()
        assert hits == 1
    with engine.connect() as connection:
        row = execute(
            connection, "select current_setting('app.user_id',true),current_setting('app.tenant_id',true)"
        ).one()
        assert row[0] in (None, "")
        assert row[1] in (None, "")
        assert execute(connection, "select count(*) from app.dining_tables").scalar_one() == 0


def test_table_occupancy_survives_pagination(api):
    table_id = str(api["a"]["table"])
    opened = api["call"]("POST", "tabs", {"table_id": table_id})
    assert opened.status_code == 201, opened.text
    occupied = []
    cursor = None
    while True:
        response = api["call"]("GET", "tables?limit=5" + (f"&cursor={cursor}" if cursor else ""))
        assert response.status_code == 200, response.text
        occupied.extend(item for item in response.json()["items"] if item["active_tab"])
        cursor = response.json()["next_cursor"]
        if not cursor:
            break
    assert len(occupied) == 1
    assert occupied[0]["id"] == table_id
    assert occupied[0]["active_tab"]["id"] == opened.json()["id"]


def test_team_overview_is_private_and_uses_one_context(api):
    email = f"benchmark-{uuid4()}@example.invalid"
    invitation = api["call"]("POST", "invitations", {"email": email, "role": "waiter"})
    assert invitation.status_code == 201, invitation.text
    statements = []

    def count_statement(*args):
        statements.append(args[2])

    event.listen(engine, "before_cursor_execute", count_statement)
    try:
        result = api["call"]("GET", "team")
    finally:
        event.remove(engine, "before_cursor_execute", count_statement)
    assert result.status_code == 200, result.text
    assert len(statements) <= 5
    assert any(item["user_id"] == str(api["users"]["owner"]) for item in result.json()["members"])
    row = next(item for item in result.json()["invitations"] if item["email"] == email)
    assert set(row) == {"id", "email", "role", "expires_at"}
    assert invitation.json()["token"] not in result.text
    assert api["call"]("GET", "team", role="waiter").status_code == 403
    other = api["call"]("GET", "team", role="owner_b", tenant="b")
    assert other.status_code == 200, other.text
    assert email not in other.text
