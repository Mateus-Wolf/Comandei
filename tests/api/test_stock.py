from uuid import uuid4
import pytest
from sqlalchemy import event
from comandei.core.db import engine

pytestmark = pytest.mark.integration


def test_stock_overview_filters_pagination_and_isolation(api):
    category = api["call"]("POST", "categories", {"name": "Bebidas " + str(uuid4())})
    assert category.status_code == 201, category.text
    category_id = category.json()["id"]
    for name, available, active in [("Água A", True, True), ("Água B", False, True), ("Água C", True, False)]:
        created = api["call"](
            "POST",
            "products",
            {
                "category_id": category_id,
                "name": name,
                "sku": name,
                "price_cents": 1250,
                "unit": "unit",
                "available": available,
                "active": active,
            },
        )
        assert created.status_code == 201, created.text
    statements = []

    def count_statement(*args):
        statements.append(args[2])

    event.listen(engine, "before_cursor_execute", count_statement)
    try:
        page = api["call"]("GET", f"stock?limit=1&category_id={category_id}")
    finally:
        event.remove(engine, "before_cursor_execute", count_statement)
    assert page.status_code == 200, page.text
    assert len(statements) <= 5
    data = page.json()
    assert data["items"][0]["name"] == "Água A"
    assert data["items"][0]["price_cents"] == 1250
    assert data["next_cursor"]
    assert category_id in [item["id"] for item in data["categories"]]
    next_page = api["call"]("GET", f"stock?limit=1&category_id={category_id}&cursor={data['next_cursor']}")
    assert next_page.status_code == 200, next_page.text
    assert next_page.json()["items"][0]["name"] == "Água B"
    assert (
        api["call"]("GET", f"stock?category_id={category_id}&status=unavailable").json()["items"][0]["name"]
        == "Água B"
    )
    assert (
        api["call"]("GET", f"stock?category_id={category_id}&status=inactive").json()["items"][0]["name"]
        == "Água C"
    )
    searched = api["call"]("GET", "stock?search=%C3%81gua%20B")
    assert searched.status_code == 200, searched.text
    assert [item["name"] for item in searched.json()["items"]] == ["Água B"]
    assert api["call"]("GET", "stock?search=%25").json()["items"] == []
    assert api["call"]("GET", f"stock?status=inactive&cursor={data['next_cursor']}").status_code == 422
    assert (
        api["call"](
            "GET", f"stock?category_id={category_id}&cursor={data['next_cursor']}", role="owner_b", tenant="b"
        ).status_code
        == 422
    )
    assert api["call"]("GET", "stock", role="waiter").status_code == 403
    assert api["call"]("GET", "stock", role="owner_b").status_code == 404
    other = api["call"]("GET", "stock", role="owner_b", tenant="b")
    assert other.status_code == 200, other.text
    assert category_id not in [item["id"] for item in other.json()["categories"]]
    manager = api["call"]("GET", f"stock?category_id={category_id}", role="manager")
    assert manager.status_code == 200, manager.text
    assert len(manager.json()["items"]) == 3
