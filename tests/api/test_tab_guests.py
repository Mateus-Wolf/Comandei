from types import SimpleNamespace
from uuid import uuid4

import pytest
from pydantic import ValidationError

from comandei.core.auth import Identity
from comandei.core.errors import APIError
from comandei.core.uow import UnitOfWork
from comandei.modules.attendance import calculate, prepare_guests
from comandei.schemas import TabGuest, TabOpen


class Result:
    def __init__(self, value):
        self.value = value

    def mappings(self):
        return self

    def all(self):
        return self.value

    def scalar_one(self):
        return self.value


def unit(products=None):
    products = products or {}
    def one(table, resource):
        if table == "categories":
            return {"active": True}
        return products[resource]
    return SimpleNamespace(
        tenant={"id": uuid4(), "service_rate_bps": 1000},
        repo=SimpleNamespace(one=one, query=lambda sql, **params: Result([] if "from app.order_items i" in sql else 0)),
    )


def guest(quantity, product=None, complimentary=False):
    return TabGuest(label="Aniversariante" if complimentary else "Pagantes", quantity=quantity,
                    product_id=product, complimentary=complimentary)


@pytest.mark.parametrize("capacity,normal,premium,courtesy,expected", [(4,3,0,0,15000), (8,1,5,1,45000)])
def test_mixed_rodizios_courtesies_and_empty_seats(capacity, normal, premium, courtesy, expected):
    a, b = uuid4(), uuid4()
    uow = unit({a: {"name": "Normal", "price_cents": 5000, "category_id": "c", "active": True, "available": True},
                b: {"name": "Premium", "price_cents": 8000, "category_id": "c", "active": True, "available": True}})
    entries = [guest(normal, a)]
    if premium:
        entries.append(guest(premium, b))
    if courtesy:
        entries.append(guest(courtesy, b, True))
    prepared = prepare_guests(uow, entries, {"capacity": capacity})
    amounts = calculate(uow, {"id": "tab", "service_accepted": False, "guests": prepared})
    assert amounts["subtotal_cents"] == expected
    assert sum(g["quantity"] for g in prepared) == capacity - 1
    assert amounts["total_cents"] == expected


def test_over_capacity_and_missing_product_are_rejected():
    with pytest.raises(APIError) as error:
        prepare_guests(unit(), [guest(5, complimentary=True)], {"capacity": 4})
    assert error.value.code == "TABLE_CAPACITY"
    with pytest.raises(APIError) as error:
        prepare_guests(unit(), [guest(1)], {"capacity": 4})
    assert error.value.code == "GUEST_PRODUCT_REQUIRED"


def test_guest_prices_preserved_when_catalog_changes():
    product = uuid4()
    previous = [{"product_id": str(product), "name_snapshot": "Normal", "unit_price_cents": 5000}]
    prepared = prepare_guests(unit(), [guest(3, product)], {"capacity": 4}, previous)
    assert prepared[0]["unit_price_cents"] == 5000


@pytest.mark.parametrize("quantity", [0, -1, 1.5, True, "3"])
def test_guest_count_requires_positive_integer(quantity):
    with pytest.raises(ValidationError):
        guest(quantity)


def test_client_cannot_set_guest_prices():
    with pytest.raises(ValidationError):
        TabOpen.model_validate({"guests": [{"label": "Normal", "quantity": 1, "unit_price_cents": 1}]})


@pytest.mark.parametrize("role,override,allowed", [
    ("cashier", None, True), ("waiter", None, False), ("manager", None, False),
    ("waiter", ["waiter"], True), ("cashier", [], False), ("owner", [], True),
])
def test_reopening_follows_restaurant_settings(role, override, allowed):
    tenant = {"id": uuid4(), "status": "active"}
    if override is not None:
        tenant["tab_reopen_roles"] = override
    uow = UnitOfWork(None, Identity(uuid4(), {}), tenant, role, uuid4())
    if allowed:
        uow.allow("tabs.resume")
    else:
        with pytest.raises(APIError) as error:
            uow.allow("tabs.resume")
        assert error.value.status == 403


@pytest.mark.parametrize("role", ["waiter", "cashier", "manager", "owner"])
@pytest.mark.parametrize("change", ["empty", "courtesy", "quantity", "replacement"])
def test_guest_reduction_requires_management_and_reason(role, change):
    from comandei.core.permissions import require
    from comandei.modules.attendance import update_guests
    product = str(uuid4())
    previous = [{"product_id": product, "quantity": 3, "unit_price_cents": 5000,
                 "complimentary": False, "name_snapshot": "Normal", "label": "Pagantes"}]
    other = uuid4()
    uow = unit({other: {"name": "Other", "price_cents": 5000, "category_id": "c",
                        "active": True, "available": True}})
    tab = {"id": uuid4(), "version": 1, "status": "open", "table_id": None, "guests": previous}
    original_one = uow.repo.one
    uow.repo.one = lambda table, resource, **kw: tab if table == "tabs" else original_one(table, resource)
    uow.repo.update = lambda *a, **k: pytest.fail("Unauthorized reduction must not write")
    uow.allow = lambda action, **kw: require(role, action)
    uow.version = lambda *a: None
    entries = {"empty": [], "courtesy": [guest(3, complimentary=True)],
               "quantity": [guest(2, product)], "replacement": [guest(3, other)]}[change]
    body = SimpleNamespace(guests=entries, expected_version=1, reason=None)
    with pytest.raises(APIError) as error:
        update_guests(uow, tab["id"], body)
    assert error.value.status == (403 if role in ("waiter", "cashier") else 422)


def test_paid_rodizio_cannot_be_cancelled_as_empty():
    from comandei.modules.attendance import cancel_tab
    tab = {"id": uuid4(), "version": 1, "status": "open", "guests": [
        {"product_id": str(uuid4()), "quantity": 2, "unit_price_cents": 5000, "complimentary": False}]}
    uow = SimpleNamespace(allow=lambda *a: None, version=lambda *a: None,
        repo=SimpleNamespace(one=lambda *a, **kw: tab,
            query=lambda *a, **kw: SimpleNamespace(first=lambda: None),
            update=lambda *a: pytest.fail("Must not cancel paid rodizio")))
    with pytest.raises(APIError) as error:
        cancel_tab(uow, tab["id"], SimpleNamespace(expected_version=1, reason="Cancelamento"))
    assert error.value.code == "TAB_HAS_HISTORY"
