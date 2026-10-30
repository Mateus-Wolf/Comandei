"""Read budgets must not grow with the number of orders or items."""

from decimal import Decimal
from types import SimpleNamespace

import pytest

from comandei.core.errors import APIError
from comandei.modules.attendance import calculate, tab_detail


class Result:
    def __init__(self, rows):
        self.rows = rows

    def mappings(self):
        return self

    def all(self):
        return self.rows

    def first(self):
        return next(iter(self.rows), None)

    def scalar_one(self):
        return self.rows

    def __iter__(self):
        return iter(self.rows)


def unit(query):
    return SimpleNamespace(
        repo=SimpleNamespace(query=query),
        tenant={"service_rate_bps": 1000},
        allow=lambda permission: None,
    )


@pytest.mark.parametrize("count", [0, 1, 50])
def test_calculation_uses_three_reads_and_rounds_each_line(count):
    calls = []

    def query(sql, **params):
        calls.append(sql)
        if "from app.order_items i" in sql:
            return Result(
                [
                    {"quantity": Decimal("0.125"), "unit_price_cents": 3, "modifiers_cents": Decimal(1)}
                    for _ in range(count)
                ]
            )
        return Result(0)

    amounts = calculate(unit(query), {"id": "tab", "service_accepted": False})
    assert amounts["subtotal_cents"] == count  # Round 0.5 per line, not after summing.
    assert amounts["balance_cents"] == count
    assert len(calls) == 3


def test_calculation_preserves_discount_guard():
    def query(sql, **params):
        return Result([] if "from app.order_items i" in sql else 1)

    with pytest.raises(APIError) as error:
        calculate(unit(query), {"id": "tab", "service_accepted": True})
    assert error.value.code == "DISCOUNT_EXCEEDS_SUBTOTAL"


@pytest.mark.parametrize("count", [1, 50])
@pytest.mark.parametrize("status", ["open", "closing", "closed"])
def test_detail_batches_orders_items_and_modifiers(count, status):
    calls = []
    orders = [{"id": n, "sequence": n} for n in range(count)]
    items = [{"id": n, "order_id": n, "quantity": Decimal(1)} for n in range(count)]
    modifiers = [{"id": n, "item_id": n} for n in range(count)]

    def query(sql, **params):
        calls.append(sql)
        if "select * from app.orders" in sql:
            return Result(orders)
        if "select i.*" in sql:
            # Concurrent inserts absent from the first order snapshot are ignored.
            return Result([*items, {"id": -1, "order_id": -1}])
        if "select m.*" in sql:
            return Result([*modifiers, {"id": -1, "item_id": -1}])
        if "from app.tab_settlements" in sql:
            return Result([] if status == "open" else [{"total_cents": 100}])
        if "from app.order_items i" in sql:
            return Result([])
        if "sum(" in sql:
            return Result(0)
        return Result([])

    uow = unit(query)
    uow.repo.one = lambda table, resource: {"id": "tab", "status": status, "service_accepted": False}
    detail = tab_detail(uow, "tab")
    assert len(detail["orders"]) == count
    for n, order in enumerate(detail["orders"]):
        assert order["items"] == [{**items[n], "modifiers": [modifiers[n]]}]
    assert len(calls) == (9 if status == "open" else 8)
    assert detail["amounts"]["balance_cents"] == (100 if status == "closing" else 0)
