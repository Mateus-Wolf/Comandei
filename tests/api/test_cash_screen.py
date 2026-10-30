from uuid import uuid4
import pytest
from sqlalchemy import event
from comandei.core.db import engine

pytestmark = pytest.mark.integration


def ok(response, status=200):
    assert response.status_code == status, response.text
    return response.json()


def test_cash_screen_balances_receipts_closing_and_ownership(api):
    session = ok(
        api["call"](
            "POST",
            "cash-sessions",
            {"register_id": str(api["a"]["register"]), "initial_balance_cents": 10000},
        ),
        201,
    )
    path = f"cash-sessions/{session['id']}"
    supply = ok(
        api["call"](
            "POST",
            path + "/movements",
            {
                "expected_version": session["version"],
                "type": "supply",
                "amount_cents": 2500,
                "reason": "Troco inicial de teste",
                "operation_key": str(uuid4()),
            },
        ),
        201,
    )
    ok(
        api["call"](
            "POST",
            path + "/movements",
            {
                "expected_version": supply["version"],
                "type": "withdrawal",
                "amount_cents": 1000,
                "reason": "Retirada de teste",
                "operation_key": str(uuid4()),
            },
        ),
        201,
    )
    statements = []

    def capture(*args):
        statements.append(args[2])

    event.listen(engine, "before_cursor_execute", capture)
    try:
        data = ok(api["call"]("GET", f"cash-overview?session_id={session['id']}"))
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert len(statements) <= 5
    assert data["totals"]["expected_cash_cents"] == 11500
    assert len(data["activity"]) == 2
    assert next(r for r in data["registers"] if r["id"] == str(api["a"]["register"]))["occupied"]
    assert api["call"]("GET", f"cash-overview?session_id={session['id']}", role="cashier").status_code == 404
    assert api["call"]("GET", "cash-overview", role="waiter").status_code == 403
    assert api["call"]("GET", "cash-overview", role="owner_b").status_code == 404
    assert ok(api["call"]("GET", "cash-overview", role="owner_b", tenant="b"))["session"] is None
    register = ok(
        api["call"]("POST", "cash-registers", {"code": str(uuid4()), "name": "Terminal do operador"}), 201
    )
    own = ok(api["call"]("POST", "cash-sessions", {"register_id": register["id"]}, role="cashier"), 201)
    own_view = ok(api["call"]("GET", "cash-overview", role="cashier"))
    assert [s["id"] for s in own_view["sessions"]] == [own["id"]]
    assert own_view["session"]["id"] == own["id"]
    tab = ok(api["call"]("POST", "tabs", {}), 201)
    product = ok(api["call"]("GET", f"products/{api['a']['product']}"))
    ordered = ok(
        api["call"](
            "POST",
            f"tabs/{tab['id']}/orders",
            {
                "expected_version": tab["version"],
                "items": [
                    {"product_id": product["id"], "catalog_version": product["version"], "quantity": "1.000"}
                ],
            },
        ),
        201,
    )
    frozen = ok(
        api["call"]("POST", f"tabs/{tab['id']}/start-closing", {"expected_version": ordered["version"]})
    )
    total = frozen["settlement"]["total_cents"]
    pix = total // 2
    paid = ok(
        api["call"](
            "POST",
            f"tabs/{tab['id']}/payments",
            {
                "expected_version": frozen["tab"]["version"],
                "cash_session_id": session["id"],
                "method": "pix",
                "amount_cents": pix,
                "confirmed": True,
                "operation_key": str(uuid4()),
            },
        ),
        201,
    )
    after_pix = ok(api["call"]("GET", f"cash-overview?session_id={session['id']}"))
    assert after_pix["totals"]["expected_cash_cents"] == 11500
    cash = total - pix
    cash_paid = ok(
        api["call"](
            "POST",
            f"tabs/{tab['id']}/payments",
            {
                "expected_version": paid["version"],
                "cash_session_id": session["id"],
                "method": "cash",
                "amount_cents": cash,
                "tendered_cents": cash + 500,
                "confirmed": True,
                "operation_key": str(uuid4()),
            },
        ),
        201,
    )
    assert cash_paid["change_cents"] == 500
    final = ok(api["call"]("GET", f"cash-overview?session_id={session['id']}"))
    assert final["totals"]["receipts_cents"] == total
    assert final["totals"]["cash_cents"] == cash
    assert final["totals"]["expected_cash_cents"] == 11500 + cash
    assert len(final["activity"]) == 4
    search = ok(api["call"]("GET", f"cash-overview?tab_search={tab['number']}"))
    assert any(t["id"] == tab["id"] for t in search["tabs"])
    ok(api["call"]("POST", f"tabs/{tab['id']}/close", {"expected_version": cash_paid["version"]}))
    expected = final["totals"]["expected_cash_cents"]
    closed = ok(
        api["call"](
            "POST",
            path + "/close",
            {
                "expected_version": final["session"]["version"],
                "declared_cents": expected + 100,
                "reason": "Divergência sintética conferida",
            },
        )
    )
    assert closed["difference_cents"] == 100
    history = ok(api["call"]("GET", f"cash-overview?session_id={session['id']}"))
    assert history["session"]["status"] == "closed"
    assert history["totals"]["expected_cash_cents"] == expected
