from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from threading import Barrier
from uuid import uuid4, UUID

import pytest
from comandei.core.repository import execute
from comandei.core.service_db import service_engine
from comandei.worker import run_once

pytestmark = pytest.mark.integration


def ok(response, status=200):
    assert response.status_code == status, response.text
    return response.json()


def open_tab(api, role="owner", **body):
    return ok(api["call"]("POST", "tabs", body, role=role), 201)


def product(api):
    return ok(api["call"]("GET", f"products/{api['a']['product']}"))


def order(api, tab, quantity="1.000", role="owner", key=None):
    p = product(api)
    return api["call"](
        "POST",
        f"tabs/{tab['id']}/orders",
        {
            "expected_version": tab["version"],
            "items": [{"product_id": p["id"], "catalog_version": p["version"], "quantity": quantity}],
        },
        role=role,
        key=key,
    )


def new_cash(api, role="owner"):
    register = ok(api["call"]("POST", "cash-registers", {"code": str(uuid4()), "name": "Test register"}), 201)
    return ok(api["call"]("POST", "cash-sessions", {"register_id": register["id"]}, role=role), 201)


def closing_tab(api):
    tab = open_tab(api)
    result = ok(order(api, tab), 201)
    return ok(
        api["call"]("POST", f"tabs/{tab['id']}/start-closing", {"expected_version": result["version"]})
    )["tab"]


def test_tenant_isolation_and_permissions(api):
    assert api["call"]("GET", "tables", role="owner_b").status_code == 404
    assert api["call"]("GET", "tables", role="blocked").status_code == 404
    assert api["call"]("GET", f"products/{api['b']['product']}").status_code == 404
    assert (
        api["call"](
            "POST",
            "products",
            {"category_id": str(api["a"]["category"]), "name": "Forbidden", "price_cents": 1},
            role="waiter",
        ).status_code
        == 403
    )
    assert api["call"]("GET", "audit-events", role="waiter").status_code == 403
    assert api["call"]("GET", "tables", role="both").status_code == 200
    assert api["call"]("GET", "tables", role="both", tenant="b").status_code == 200
    mine = ok(api["call"]("GET", "/v1/me/tenants", role="both"))
    assert len(mine["items"]) == 2


def test_crud_pagination_versions_and_cross_reference(api):
    created = ok(api["call"]("POST", "tables", {"code": str(uuid4()), "name": "New table"}), 201)
    response = api["call"](
        "PATCH", f"tables/{created['id']}", {"expected_version": created["version"], "name": "Renamed"}
    )
    updated = ok(response)
    assert updated["version"] == created["version"] + 1
    assert (
        api["call"](
            "PATCH", f"tables/{created['id']}", {"expected_version": created["version"], "name": "Stale"}
        ).status_code
        == 409
    )
    first = ok(api["call"]("GET", "tables?limit=1"))
    assert first["next_cursor"]
    second = ok(api["call"]("GET", f"tables?limit=1&cursor={first['next_cursor']}"))
    assert first["items"][0]["id"] != second["items"][0]["id"]
    assert (
        api["call"](
            "POST",
            "products",
            {"category_id": str(api["b"]["category"]), "name": "Cross", "price_cents": 100},
        ).status_code
        == 404
    )
    assert (
        api["call"](
            "POST", "tables", {"code": "x", "name": "x", "tenant_id": str(api["tenants"]["b"])}
        ).status_code
        == 422
    )


def test_order_idempotency_and_price_changes(api):
    tab = open_tab(api, role="waiter")
    key = str(uuid4())
    first = ok(order(api, tab, role="waiter", key=key), 201)
    for _ in range(3):
        replay = order(api, tab, role="waiter", key=key)
        assert ok(replay, 201) == first
        assert replay.headers["idempotency-replayed"] == "true"
    assert order(api, tab, quantity="2.000", role="waiter", key=key).status_code == 409
    p = product(api)
    ok(api["call"]("PATCH", f"products/{p['id']}", {"expected_version": p["version"], "price_cents": 2500}))
    current = ok(api["call"]("GET", f"tabs/{tab['id']}"))
    stale = api["call"](
        "POST",
        f"tabs/{tab['id']}/orders",
        {
            "expected_version": current["version"],
            "items": [{"product_id": p["id"], "catalog_version": p["version"], "quantity": "1"}],
        },
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "PRICE_CHANGED"


def test_reference_financial_flow_and_refund(api):
    group = ok(api["call"]("POST", "modifier-groups", {"name": "Extras", "max_choices": 1}), 201)
    option = ok(
        api["call"](
            "POST", "modifier-options", {"group_id": group["id"], "name": "Extra", "price_cents": 300}
        ),
        201,
    )
    p = product(api)
    ok(api["call"]("POST", "product-modifier-groups", {"product_id": p["id"], "group_id": group["id"]}), 201)
    drink = ok(
        api["call"](
            "POST",
            "products",
            {"category_id": str(api["a"]["category"]), "name": "Drink", "price_cents": 800},
        ),
        201,
    )
    p = product(api)
    tab = open_tab(api)
    submitted = ok(
        api["call"](
            "POST",
            f"tabs/{tab['id']}/orders",
            {
                "expected_version": tab["version"],
                "items": [
                    {
                        "product_id": p["id"],
                        "catalog_version": p["version"],
                        "quantity": "2",
                        "modifier_option_ids": [option["id"]],
                    },
                    {"product_id": drink["id"], "catalog_version": drink["version"], "quantity": "1"},
                ],
            },
        ),
        201,
    )
    assert submitted["amounts"]["subtotal_cents"] == 6400
    discounted = ok(
        api["call"](
            "POST",
            f"tabs/{tab['id']}/adjustments",
            {
                "expected_version": submitted["version"],
                "type": "discount",
                "amount_cents": 400,
                "reason": "Test discount",
            },
        )
    )
    frozen = ok(
        api["call"]("POST", f"tabs/{tab['id']}/start-closing", {"expected_version": discounted["version"]})
    )
    assert frozen["settlement"]["total_cents"] == 6600
    assert frozen["settlement"]["service_cents"] == 600
    session = new_cash(api)
    first = ok(
        api["call"](
            "POST",
            f"tabs/{tab['id']}/payments",
            {
                "expected_version": frozen["tab"]["version"],
                "cash_session_id": session["id"],
                "method": "cash",
                "amount_cents": 4000,
                "tendered_cents": 5000,
                "operation_key": str(uuid4()),
                "confirmed": True,
            },
        ),
        201,
    )
    assert first["change_cents"] == 1000
    assert first["balance_cents"] == 2600
    assert (
        api["call"]("POST", f"tabs/{tab['id']}/resume", {"expected_version": first["version"]}).status_code
        == 409
    )
    second = ok(
        api["call"](
            "POST",
            f"tabs/{tab['id']}/payments",
            {
                "expected_version": first["version"],
                "cash_session_id": session["id"],
                "method": "pix",
                "amount_cents": 2600,
                "operation_key": str(uuid4()),
                "confirmed": True,
            },
        ),
        201,
    )
    assert second["balance_cents"] == 0
    closed = ok(api["call"]("POST", f"tabs/{tab['id']}/close", {"expected_version": second["version"]}))
    assert closed["status"] == "closed"
    refunded = ok(
        api["call"](
            "POST",
            f"payments/{first['payment']['id']}/refunds",
            {
                "cash_session_id": session["id"],
                "amount_cents": 1000,
                "reason": "Partial refund",
                "operation_key": str(uuid4()),
                "confirmed": True,
            },
        ),
        201,
    )
    assert refunded["type"] == "refund"
    assert (
        api["call"](
            "POST",
            f"payments/{first['payment']['id']}/refunds",
            {
                "cash_session_id": session["id"],
                "amount_cents": 4000,
                "reason": "Too much",
                "operation_key": str(uuid4()),
                "confirmed": True,
            },
        ).status_code
        == 409
    )
    session_state = ok(api["call"]("GET", f"cash-sessions/{session['id']}"))
    assert session_state["expected_cash_cents"] == 3000
    detail = ok(api["call"]("GET", f"tabs/{tab['id']}"))
    assert detail["amounts"]["balance_cents"] == 0
    assert detail["amounts"]["refunded_cents"] == 1000


def test_approval_and_rollback(api):
    tab = open_tab(api)
    ok(order(api, tab), 201)
    detail = ok(api["call"]("GET", f"tabs/{tab['id']}"))
    item = detail["orders"][0]["items"][0]
    request = ok(
        api["call"](
            "POST",
            f"items/{item['id']}/cancel-requests",
            {"expected_version": item["version"], "reason": "Guest changed mind"},
            role="waiter",
        )
    )
    assert request["status"] == "pending"
    assert (
        api["call"]("POST", f"approvals/{request['approval_id']}/approve", role="waiter").status_code == 403
    )
    result = ok(api["call"]("POST", f"approvals/{request['approval_id']}/approve", role="manager"))
    assert result["status"] == "cancelled"
    assert (
        api["call"]("POST", f"approvals/{request['approval_id']}/approve", role="manager").status_code == 409
    )
    tab = open_tab(api)
    before = ok(api["call"]("GET", f"tabs/{tab['id']}"))
    p = product(api)
    bad = api["call"](
        "POST",
        f"tabs/{tab['id']}/orders",
        {
            "expected_version": tab["version"],
            "items": [
                {"product_id": p["id"], "catalog_version": p["version"], "quantity": "1"},
                {"product_id": str(uuid4()), "catalog_version": 1, "quantity": "1"},
            ],
        },
    )
    assert bad.status_code == 404
    after = ok(api["call"]("GET", f"tabs/{tab['id']}"))
    assert after["orders"] == [] and after["version"] == before["version"]


def test_last_owner_and_invite(api):
    assert (
        api["call"](
            "PATCH", f"members/{api['users']['owner']}", {"role": "manager", "status": "active"}
        ).status_code
        == 409
    )
    assert (
        api["call"](
            "PATCH",
            f"members/{api['users']['owner']}",
            {"role": "waiter", "status": "blocked"},
            role="manager",
        ).status_code
        == 403
    )
    invitation = ok(
        api["call"](
            "POST",
            "invitations",
            {"email": f"api-test-{api['users']['invitee']}@example.invalid", "role": "waiter"},
            role="manager",
        ),
        201,
    )
    accepted = ok(
        api["call"]("POST", "/v1/invitations/accept", {"token": invitation["token"]}, role="invitee")
    )
    assert accepted["tenant_id"] == str(api["tenants"]["a"])
    assert (
        api["call"](
            "POST", "/v1/invitations/accept", {"token": invitation["token"]}, role="invitee"
        ).status_code
        == 403
    )


@pytest.mark.concurrency
def test_concurrent_payments(api):
    tab = closing_tab(api)
    session = new_cash(api)
    barrier = Barrier(2)

    def pay(_):
        barrier.wait(timeout=10)
        return api["call"](
            "POST",
            f"tabs/{tab['id']}/payments",
            {
                "expected_version": tab["version"],
                "cash_session_id": session["id"],
                "method": "cash",
                "amount_cents": 2750,
                "operation_key": str(uuid4()),
                "confirmed": True,
            },
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(pay, range(2)))
    assert sorted(r.status_code for r in responses) == [201, 409]
    detail = ok(api["call"]("GET", f"tabs/{tab['id']}"))
    assert len(detail["payments"]) == 1


@pytest.mark.concurrency
def test_concurrent_idempotency(api):
    tab = open_tab(api)
    key = str(uuid4())
    barrier = Barrier(2)

    def send(_):
        barrier.wait(timeout=10)
        return order(api, tab, key=key)

    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(send, range(2)))
    assert all(r.status_code == 201 for r in responses), [r.text for r in responses]
    assert responses[0].json() == responses[1].json()
    assert len(ok(api["call"]("GET", f"tabs/{tab['id']}"))["orders"]) == 1


def test_cash_ownership_and_suspension(api):
    session = new_cash(api, role="cashier")
    assert api["call"]("GET", f"cash-sessions/{session['id']}", role="waiter").status_code == 403
    state = ok(api["call"]("GET", f"cash-sessions/{session['id']}", role="cashier"))
    assert (
        api["call"](
            "POST",
            f"cash-sessions/{session['id']}/close",
            {"expected_version": state["version"], "declared_cents": 100},
            role="cashier",
        ).status_code
        == 422
    )
    ok(
        api["call"](
            "POST",
            f"cash-sessions/{session['id']}/close",
            {"expected_version": state["version"], "declared_cents": 0},
            role="cashier",
        )
    )
    tab = closing_tab(api)
    another = new_cash(api)
    with api["admin"].begin() as c:
        execute(c, "update app.tenants set status='suspended' where id=:id", {"id": api["tenants"]["a"]})
    try:
        assert api["call"]("POST", "tabs", {}).status_code == 403
        assert api["call"]("GET", f"tabs/{tab['id']}").status_code == 200
        assert (
            api["call"](
                "POST",
                f"tabs/{tab['id']}/payments",
                {
                    "expected_version": tab["version"],
                    "cash_session_id": another["id"],
                    "method": "pix",
                    "amount_cents": 2750,
                    "operation_key": str(uuid4()),
                    "confirmed": True,
                },
            ).status_code
            == 201
        )
    finally:
        with api["admin"].begin() as c:
            execute(c, "update app.tenants set status='active' where id=:id", {"id": api["tenants"]["a"]})


def test_exports_and_worker(api):
    day = str(datetime.now(timezone.utc).date())
    job = ok(api["call"]("POST", "exports", {"start_date": day, "end_date": day}), 202)
    assert api["call"]("GET", f"exports/{job['id']}/download").status_code == 409
    run_once(tenant_id=api["tenants"]["a"])
    assert ok(api["call"]("GET", f"exports/{job['id']}"))["status"] == "completed"
    result = api["call"]("GET", f"exports/{job['id']}/download")
    assert result.status_code == 200 and "text/csv" in result.headers["content-type"]
    assert "payment_id" in result.text
    assert api["call"]("GET", f"exports/{job['id']}", role="owner_b", tenant="b").status_code == 404
    assert (
        api["call"]("POST", "exports", {"start_date": day, "end_date": day}, role="manager").status_code
        == 403
    )
    with api["admin"].begin() as c:
        observed = (
            execute(
                c,
                "select private,payload from realtime.messages where topic=:topic",
                {"topic": f"tenant:{api['tenants']['a']}:operations"},
            )
            .mappings()
            .all()
        )
    if not observed:
        # Surface an actual publisher error instead of only the worker's sanitized failure state.
        owner = uuid4()
        with api["admin"].begin() as c:
            execute(
                c,
                "update app.outbox_events set available_at=now() where tenant_id=:tenant",
                {"tenant": api["tenants"]["a"]},
            )
        with service_engine("worker").begin() as c:
            events = (
                execute(
                    c,
                    "select * from app.claim_outbox(:owner,:tenant)",
                    {"owner": owner, "tenant": api["tenants"]["a"]},
                )
                .mappings()
                .all()
            )
            assert events
            assert execute(
                c, "select app.publish_outbox(:id,:owner)", {"id": events[0]["id"], "owner": owner}
            ).scalar_one()
    assert observed
    for message in observed:
        assert message["private"] is True
        assert set(message["payload"]) <= {
            "id",
            "event_id",
            "aggregate_type",
            "aggregate_id",
            "aggregate_version",
            "occurred_at",
        }


def test_daily_report(api):
    response = ok(api["call"]("GET", f"reports/daily?day={date.today()}"))
    assert response["currency"] == "BRL"
    assert response["document_type"] == "NON_FISCAL_OPERATIONAL_REPORT"


def test_discount_approval_limit_and_zero_total(api):
    tab = open_tab(api)
    submitted = ok(order(api, tab), 201)
    request = ok(
        api["call"](
            "POST",
            f"tabs/{tab['id']}/adjustments",
            {
                "expected_version": submitted["version"],
                "type": "discount",
                "amount_cents": 2500,
                "reason": "Full courtesy",
            },
            role="cashier",
        )
    )
    assert request["status"] == "pending"
    assert (
        api["call"]("POST", f"approvals/{request['approval_id']}/approve", role="manager").status_code == 403
    )
    adjusted = ok(api["call"]("POST", f"approvals/{request['approval_id']}/approve"))
    assert adjusted["amounts"]["total_cents"] == 0
    closing = ok(
        api["call"]("POST", f"tabs/{tab['id']}/start-closing", {"expected_version": adjusted["version"]})
    )
    closed = ok(
        api["call"]("POST", f"tabs/{tab['id']}/close", {"expected_version": closing["tab"]["version"]})
    )
    assert closed["status"] == "closed"
    assert (
        ok(api["call"]("GET", f"tabs/{tab['id']}/receipt"))["document_type"]
        == "NON_FISCAL_OPERATIONAL_RECEIPT"
    )


def test_cash_movements_and_resume(api):
    session = new_cash(api)
    moved = ok(
        api["call"](
            "POST",
            f"cash-sessions/{session['id']}/movements",
            {
                "expected_version": session["version"],
                "type": "supply",
                "amount_cents": 2000,
                "reason": "Opening float",
                "operation_key": str(uuid4()),
            },
        ),
        201,
    )
    assert moved["expected_cash_cents"] == 2000
    withdrawn = ok(
        api["call"](
            "POST",
            f"cash-sessions/{session['id']}/movements",
            {
                "expected_version": moved["version"],
                "type": "withdrawal",
                "amount_cents": 500,
                "reason": "Safe deposit",
                "operation_key": str(uuid4()),
            },
        ),
        201,
    )
    assert withdrawn["expected_cash_cents"] == 1500
    assert (
        api["call"](
            "POST",
            f"cash-sessions/{session['id']}/movements",
            {
                "expected_version": withdrawn["version"],
                "type": "withdrawal",
                "amount_cents": 2000,
                "reason": "Too much",
                "operation_key": str(uuid4()),
            },
        ).status_code
        == 409
    )
    closed = ok(
        api["call"](
            "POST",
            f"cash-sessions/{session['id']}/close",
            {"expected_version": withdrawn["version"], "declared_cents": 1400, "reason": "Count variance"},
        )
    )
    assert closed["difference_cents"] == -100
    tab = closing_tab(api)
    resumed = ok(api["call"]("POST", f"tabs/{tab['id']}/resume", {"expected_version": tab["version"]}))
    assert resumed["status"] == "open"
    assert api["call"]("GET", f"tabs/{tab['id']}/receipt").status_code == 409


@pytest.mark.concurrency
def test_concurrent_open_table(api):
    table = ok(api["call"]("POST", "tables", {"code": str(uuid4()), "name": "Concurrent table"}), 201)
    barrier = Barrier(2)

    def send(_):
        barrier.wait(timeout=10)
        return api["call"]("POST", "tabs", {"table_id": table["id"]})

    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(send, range(2)))
    assert sorted(r.status_code for r in responses) == [201, 409]


@pytest.mark.concurrency
def test_closing_versus_order(api):
    tab = open_tab(api)
    barrier = Barrier(2)
    p = product(api)

    def send_order():
        barrier.wait(timeout=10)
        return api["call"](
            "POST",
            f"tabs/{tab['id']}/orders",
            {
                "expected_version": tab["version"],
                "items": [{"product_id": p["id"], "catalog_version": p["version"], "quantity": "1"}],
            },
        )

    def close():
        barrier.wait(timeout=10)
        return api["call"]("POST", f"tabs/{tab['id']}/start-closing", {"expected_version": tab["version"]})

    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(send_order)
        second = executor.submit(close)
        responses = [first.result(), second.result()]
    assert sum(200 <= r.status_code < 300 for r in responses) == 1
    assert sum(r.status_code == 409 for r in responses) == 1
    detail = ok(api["call"]("GET", f"tabs/{tab['id']}"))
    assert (detail["status"] == "closing" and not detail["orders"]) or (
        detail["status"] == "open" and len(detail["orders"]) == 1
    )


@pytest.mark.concurrency
def test_cash_closing_versus_payment(api):
    tab = closing_tab(api)
    session = new_cash(api)
    barrier = Barrier(2)

    def pay():
        barrier.wait(timeout=10)
        return api["call"](
            "POST",
            f"tabs/{tab['id']}/payments",
            {
                "expected_version": tab["version"],
                "cash_session_id": session["id"],
                "method": "cash",
                "amount_cents": 2750,
                "operation_key": str(uuid4()),
                "confirmed": True,
            },
        )

    def close():
        barrier.wait(timeout=10)
        return api["call"](
            "POST",
            f"cash-sessions/{session['id']}/close",
            {"expected_version": session["version"], "declared_cents": 0},
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(pay)
        second = executor.submit(close)
        responses = [first.result(), second.result()]
    assert sum(200 <= r.status_code < 300 for r in responses) == 1
    assert sum(r.status_code == 409 for r in responses) == 1


def test_sensitive_session_revocation(api):
    with api["admin"].begin() as c:
        old = execute(
            c, "select not_after from auth.sessions where id=:id", {"id": api["sessions"]["owner"]}
        ).scalar_one()
        execute(
            c,
            "update auth.sessions set not_after=now()-interval '1 minute' where id=:id",
            {"id": api["sessions"]["owner"]},
        )
    try:
        response = api["call"](
            "POST",
            f"payments/{uuid4()}/refunds",
            {
                "cash_session_id": str(uuid4()),
                "amount_cents": 100,
                "reason": "Revocation check",
                "operation_key": str(uuid4()),
                "confirmed": True,
            },
        )
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "SESSION_REVOKED"
    finally:
        with api["admin"].begin() as c:
            execute(
                c,
                "update auth.sessions set not_after=:expires where id=:id",
                {"id": api["sessions"]["owner"], "expires": old},
            )


def test_failure_after_write_rolls_back(api, monkeypatch):
    from comandei.core.errors import APIError
    from comandei.core.uow import UnitOfWork

    with api["admin"].begin() as c:
        before = execute(
            c, "select count(*) from app.tabs where tenant_id=:tenant", {"tenant": api["tenants"]["a"]}
        ).scalar_one()
    key = str(uuid4())

    def fail(*args, **kwargs):
        raise APIError(503, "TEST_FAILURE", "Synthetic failure before commit")

    with monkeypatch.context() as patch:
        patch.setattr(UnitOfWork, "event", fail)
        assert api["call"]("POST", "tabs", {}, key=key).status_code == 503
    with api["admin"].begin() as c:
        after = execute(
            c, "select count(*) from app.tabs where tenant_id=:tenant", {"tenant": api["tenants"]["a"]}
        ).scalar_one()
    assert before == after
    assert api["call"]("POST", "tabs", {}, key=key).status_code == 201


def test_platform_separate_scope_and_onboarding(api, monkeypatch):
    from comandei.core import config

    assert api["call"]("GET", "/v1/platform/tenants").status_code == 403
    monkeypatch.setattr(config, "PLATFORM_OPERATORS", frozenset({str(api["users"]["owner"])}))
    created = ok(
        api["call"](
            "POST",
            "/v1/platform/tenants",
            {
                "name": "Platform fixture",
                "slug": f"platform-test-{uuid4()}",
                "owner_user_id": str(api["users"]["invitee"]),
            },
        ),
        201,
    )
    tenant = UUID(created["tenant_id"])
    api["tenants"]["platform"] = tenant
    listed = ok(api["call"]("GET", "/v1/platform/tenants"))
    assert str(tenant) in {t["id"] for t in listed["items"]}
    ok(
        api["call"](
            "PATCH",
            f"/v1/platform/tenants/{tenant}/plan",
            {"status": "suspended", "plan": "pilot", "max_users": 10, "max_tables": 20},
        )
    )
    assert api["call"]("GET", f"/v1/tenants/{tenant}/tabs").status_code == 404
    assert api["call"]("GET", f"/v1/tenants/{tenant}/tabs", role="invitee").status_code == 200
    assert api["call"]("POST", f"/v1/tenants/{tenant}/tabs", {}, role="invitee").status_code == 403


def test_void_discount_before_correcting_consumption(api):
    tab = open_tab(api)
    submitted = ok(order(api, tab), 201)
    discounted = ok(
        api["call"](
            "POST",
            f"tabs/{tab['id']}/adjustments",
            {
                "expected_version": submitted["version"],
                "type": "discount",
                "amount_cents": 2500,
                "reason": "Courtesy discount",
            },
        )
    )
    adjustment_id = discounted["adjustment"]["id"]
    detail = ok(api["call"]("GET", f"tabs/{tab['id']}"))
    item = detail["orders"][0]["items"][0]
    assert (
        api["call"](
            "POST",
            f"items/{item['id']}/cancel-requests",
            {"expected_version": item["version"], "reason": "Correct consumption"},
            role="manager",
        ).status_code
        == 409
    )
    path = f"tabs/{tab['id']}/adjustments/{adjustment_id}/void"
    body = {"expected_version": discounted["version"], "reason": "Remove obsolete discount"}
    assert api["call"]("POST", path, body, role="cashier").status_code == 403
    voided = ok(api["call"]("POST", path, body, role="manager"))
    assert voided["amounts"]["discount_cents"] == 0
    assert voided["adjustment"]["voided_by"] == str(api["users"]["manager"])
    assert (
        api["call"](
            "POST", path, {"expected_version": voided["version"], "reason": "Repeat void"}
        ).status_code
        == 409
    )
    cancelled = ok(
        api["call"](
            "POST",
            f"items/{item['id']}/cancel-requests",
            {"expected_version": item["version"], "reason": "Correct consumption"},
            role="manager",
        )
    )
    assert cancelled["status"] == "cancelled"
    final = ok(api["call"]("GET", f"tabs/{tab['id']}"))
    assert final["amounts"]["total_cents"] == 0
    assert final["adjustments"][0]["amount_cents"] == 2500
    assert final["adjustments"][0]["voided_at"] is not None
