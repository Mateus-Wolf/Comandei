from datetime import datetime, time, timezone
from decimal import Decimal
from uuid import uuid4
import pytest
from pydantic import ValidationError
from comandei.core.errors import APIError
from comandei.core.permissions import require
from comandei.domain.finance import business_date, cents, csv_cell, line_total, totals
from comandei.schemas import OrderItem, Payment, ProductCreate


def test_reference_amounts():
    subtotal = line_total(Decimal("2"), 2500, 300) + line_total(Decimal("1"), 800)
    assert totals(subtotal, 400, 1000) == {
        "subtotal_cents": 6400,
        "discount_cents": 400,
        "service_cents": 600,
        "total_cents": 6600,
        "service_rate_bps": 1000,
    }
    assert 6600 - 4000 - 2600 == 0


@pytest.mark.parametrize(
    "qty,price,expected", [("0.125", 4, 1), ("0.125", 3, 0), ("1.001", 500, 501), ("2.000", 2800, 5600)]
)
def test_half_up(qty, price, expected):
    assert line_total(Decimal(qty), price) == expected


def test_zero_discount_and_optional_service():
    assert totals(100, 100, 1000)["total_cents"] == 0
    assert totals(100, 0, 1000, False)["service_cents"] == 0
    assert totals(0, 0, 1000)["total_cents"] == 0


@pytest.mark.parametrize(
    "subtotal,discount,rate", [(100, 101, 1000), (100, -1, 1000), (100, 0, 10001), (100, 0, -1)]
)
def test_invalid_adjustments(subtotal, discount, rate):
    with pytest.raises(APIError):
        totals(subtotal, discount, rate)


@pytest.mark.parametrize("value", [-1, 9007199254740992])
def test_money_range(value):
    with pytest.raises(APIError):
        cents(value)


def test_business_date_across_midnight():
    assert (
        str(business_date("America/Sao_Paulo", time(4), datetime(2026, 10, 27, 5, 0, tzinfo=timezone.utc)))
        == "2026-10-26"
    )
    assert (
        str(business_date("America/Sao_Paulo", time(4), datetime(2026, 10, 27, 7, 0, tzinfo=timezone.utc)))
        == "2026-10-27"
    )


@pytest.mark.parametrize("value", ["=SUM(A1:A2)", "+1", "-2", "@cmd", " \t=1", "\r\n+5"])
def test_csv_formulas(value):
    assert csv_cell(value).startswith("'")


def test_csv_ordinary_values():
    assert csv_cell(None) == ""
    assert csv_cell("Pix") == "Pix"


@pytest.mark.parametrize(
    "role,action,allowed",
    [
        ("waiter", "read", True),
        ("waiter", "catalog.write", False),
        ("waiter", "payments.record", False),
        ("waiter", "items.prepare", False),
        ("waiter", "approval.request", True),
        ("cashier", "payments.record", True),
        ("cashier", "payments.refund", False),
        ("cashier", "tabs.resume", False),
        ("cashier", "items.prepare", True),
        ("cashier", "items.cancel", False),
        ("manager", "members.invite", True),
        ("manager", "settings.write", False),
        ("manager", "exports.create", False),
        ("manager", "payments.refund", True),
        ("manager", "items.cancel", True),
        ("owner", "settings.write", True),
        ("owner", "exports.create", True),
        ("owner", "catalog.write", True),
    ],
)
def test_documented_permissions(role, action, allowed):
    if allowed:
        require(role, action)
    else:
        with pytest.raises(APIError) as error:
            require(role, action)
        assert error.value.status == 403


def test_unknown_permission_denied():
    with pytest.raises(APIError):
        require("owner", "made_up")


@pytest.mark.parametrize("quantity", [1, 1.5, 0, "0", "-1", "NaN", "Infinity", "0.0001"])
def test_quantity_contract(quantity):
    with pytest.raises(ValidationError):
        OrderItem(product_id=uuid4(), catalog_version=1, quantity=quantity)


def test_security_fields_and_integer_money():
    with pytest.raises(ValidationError):
        ProductCreate(category_id=uuid4(), name="Test", price_cents=1, tenant_id=uuid4())
    with pytest.raises(ValidationError):
        ProductCreate(category_id=uuid4(), name="Test", price_cents=1.5)
    with pytest.raises(ValidationError):
        Payment(
            expected_version=1,
            cash_session_id=uuid4(),
            amount_cents=1,
            method="cash",
            operation_key=uuid4(),
            confirmed=False,
        )
