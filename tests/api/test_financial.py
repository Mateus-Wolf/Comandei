from datetime import date, time, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import event

from comandei.core.db import engine
from comandei.core.errors import APIError
from comandei.modules import reports
from comandei.schemas import FinancialOverview


@pytest.mark.parametrize(
    "start,end",
    [
        (date(2026, 10, 2), date(2026, 10, 1)),
        (date(2026, 10, 1), date(2026, 11, 1)),
        (date(2026, 10, 1), None),
        (None, date(2026, 10, 1)),
    ],
)
def test_financial_rejects_invalid_period_before_query(start, end):
    uow = SimpleNamespace(
        allow=lambda action: None,
        tenant={"timezone": "America/Sao_Paulo", "business_day_cutoff": time(4)},
    )
    with pytest.raises(APIError) as error:
        reports.financial(uow, start, end)
    assert error.value.code == "INVALID_PERIOD"


@pytest.mark.parametrize(
    "period,start",
    [("today", date(2026, 10, 27)), ("week", date(2026, 10, 21)), ("month", date(2026, 10, 1))],
)
def test_financial_defaults_and_integer_aggregates(monkeypatch, period, start):
    monkeypatch.setattr(reports, "business_date", lambda zone, cutoff: date(2026, 10, 27))
    calls = []

    def query(sql, **params):
        calls.append(params)
        days = []
        for n in range(params["days"] + 1):
            days.append(
                {
                    "business_date": params["start"] + timedelta(days=n),
                    "closed_tabs": 2 if n == 0 else 0,
                    "sales_cents": 2501 if n == 0 else 0,
                    "subtotal_cents": 2501 if n == 0 else 0,
                    "discount_cents": 0,
                    "service_cents": 0,
                    "receipts_cents": 2501 if n == 0 else 0,
                    "refunds_cents": 300 if n == 0 else 0,
                    "net_received_cents": 2201 if n == 0 else 0,
                }
            )
        return SimpleNamespace(
            mappings=lambda: SimpleNamespace(
                one=lambda: {
                    "days": days,
                    "payments_by_method": [{"method": "pix", "receipts_cents": 2501, "refunds_cents": 300}],
                    "cash": {
                        "supply_cents": 0,
                        "withdrawal_cents": 0,
                        "open_sessions": 1,
                        "closed_sessions": 0,
                        "difference_cents": 0,
                    },
                }
            )
        )

    permissions = []
    uow = SimpleNamespace(
        allow=permissions.append,
        tenant={"timezone": "America/Sao_Paulo", "business_day_cutoff": time(4)},
        repo=SimpleNamespace(query=query),
    )
    result = FinancialOverview.model_validate(reports.financial(uow, period=period))
    assert permissions == ["reports.read"]
    assert len(calls) == 1
    assert calls[0]["start"] == start
    assert result.start_date == start
    assert result.end_date == date(2026, 10, 27)
    assert result.average_ticket_cents == 1251
    assert result.sales.sales_cents == 2501
    assert result.sales.closed_tabs == 2
    assert result.net_received_cents == 2201


def ok(response, status=200):
    assert response.status_code == status, response.text
    return response.json()


@pytest.mark.integration
def test_financial_period_permissions_empty_days_and_query_budget(api):
    statements = []

    def capture(*args):
        statements.append(args[2])

    event.listen(engine, "before_cursor_execute", capture)
    try:
        data = ok(api["call"]("GET", "reports/financial?start_date=2020-01-01&end_date=2020-01-31"))
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert len(statements) <= 5
    assert len(data["days"]) == 31
    assert data["days"][0]["business_date"] == "2020-01-01"
    assert data["days"][-1]["business_date"] == "2020-01-31"
    assert data["net_received_cents"] == data["average_ticket_cents"] == 0
    assert data["payments_by_method"] == []
    assert all(day["sales_cents"] == day["net_received_cents"] == 0 for day in data["days"])
    for role in ["owner", "manager", "cashier"]:
        today = ok(api["call"]("GET", "reports/financial?period=today", role=role))
        assert today["start_date"] == today["end_date"] == today["current_business_date"]
    week = ok(api["call"]("GET", "reports/financial"))
    assert len(week["days"]) == 7
    assert date.fromisoformat(week["end_date"]) - date.fromisoformat(week["start_date"]) == timedelta(days=6)
    month = ok(api["call"]("GET", "reports/financial?period=month"))
    assert date.fromisoformat(month["start_date"]).day == 1
    assert api["call"]("GET", "reports/financial", role="waiter").status_code == 403
    assert api["call"]("GET", "reports/financial", role="owner_b").status_code == 404
    for query in [
        "start_date=2020-01-01",
        "start_date=2020-01-02&end_date=2020-01-01",
        "start_date=2020-01-01&end_date=2020-02-01",
        "period=invalid",
    ]:
        assert api["call"]("GET", "reports/financial?" + query).status_code == 422


@pytest.mark.integration
def test_financial_sales_split_payments_refunds_and_cash_without_double_counting(api):
    session = ok(
        api["call"](
            "POST",
            "cash-sessions",
            {
                "register_id": str(api["a"]["register"]),
                "initial_balance_cents": 10000,
            },
        ),
        201,
    )
    day = session["business_date"]
    path = f"cash-sessions/{session['id']}"
    for kind, amount in [("supply", 2000), ("withdrawal", 1000)]:
        session = {
            **session,
            **ok(
                api["call"](
                    "POST",
                    path + "/movements",
                    {
                        "expected_version": session["version"],
                        "type": kind,
                        "amount_cents": amount,
                        "reason": "Teste dashboard financeiro",
                        "operation_key": str(uuid4()),
                    },
                ),
                201,
            ),
        }
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
    version = frozen["tab"]["version"]
    entries = []
    for method, amount in [("pix", total // 2), ("cash", total - total // 2)]:
        paid = ok(
            api["call"](
                "POST",
                f"tabs/{tab['id']}/payments",
                {
                    "expected_version": version,
                    "cash_session_id": session["id"],
                    "method": method,
                    "amount_cents": amount,
                    "confirmed": True,
                    "operation_key": str(uuid4()),
                    **({"tendered_cents": amount} if method == "cash" else {}),
                },
            ),
            201,
        )
        entries.append(paid["payment"])
        version = paid["version"]
    ok(api["call"]("POST", f"tabs/{tab['id']}/close", {"expected_version": version}))
    ok(
        api["call"](
            "POST",
            f"payments/{entries[0]['id']}/refunds",
            {
                "cash_session_id": session["id"],
                "amount_cents": 500,
                "reason": "Devolução parcial teste dashboard",
                "operation_key": str(uuid4()),
            },
        ),
        201,
    )
    view = ok(api["call"]("GET", f"cash-overview?session_id={session['id']}"))
    ok(
        api["call"](
            "POST",
            path + "/close",
            {
                "expected_version": view["session"]["version"],
                "declared_cents": view["totals"]["expected_cash_cents"] - 100,
                "reason": "Diferença de conferência teste dashboard",
            },
        )
    )
    data = ok(api["call"]("GET", f"reports/financial?start_date={day}&end_date={day}"))
    assert data["sales"]["closed_tabs"] == 1
    assert data["sales"]["sales_cents"] == total
    assert data["receipts_cents"] == total
    assert data["refunds_cents"] == 500
    assert data["net_received_cents"] == total - 500
    assert data["average_ticket_cents"] == total
    assert data["cash"] == {
        "supply_cents": 2000,
        "withdrawal_cents": 1000,
        "closed_sessions": 1,
        "open_sessions": 0,
        "difference_cents": -100,
    }
    assert len(data["payments_by_method"]) == 2
    daily = ok(api["call"]("GET", f"reports/daily?day={day}"))
    assert daily["net_received_cents"] == data["net_received_cents"]
    assert daily["payments_by_method"] == data["payments_by_method"]
    assert daily["sales"]["total_cents"] == data["sales"]["sales_cents"]
    other = ok(
        api["call"]("GET", f"reports/financial?start_date={day}&end_date={day}", tenant="b", role="owner_b")
    )
    assert other["receipts_cents"] == other["sales"]["closed_tabs"] == 0
