import pytest
from pydantic import ValidationError
from comandei.domain.registration import normalize_cnpj
from comandei.core.permissions import require
from comandei.core.errors import APIError
from comandei.schemas import RestaurantCreate


@pytest.mark.parametrize(
    "value,expected",
    [
        ("11.222.333/0001-81", "11222333000181"),
        ("12.ABC.345/01DE-35", "12ABC34501DE35"),
    ],
)
def test_cnpj_check_digits(value, expected):
    assert normalize_cnpj(value) == expected


@pytest.mark.parametrize(
    "value", ["00000000000000", "11222333000182", "12ABC34501DE00", "11<script>22", "123"]
)
def test_invalid_cnpj_rejected(value):
    with pytest.raises(ValueError):
        normalize_cnpj(value)


def test_local_hours_and_overnight():
    data = dict(
        name="Casa",
        address="Rua 1",
        cnpj="11222333000181",
        opens_at="18:00",
        closes_at="02:00",
        service_type="both",
    )
    assert RestaurantCreate(**data).closes_at.hour == 2
    with pytest.raises(ValidationError):
        RestaurantCreate(**{**data, "opens_at": "18:00:00Z"})


@pytest.mark.parametrize("role", ["manager", "cashier", "waiter"])
def test_only_administrator_can_edit_tables(role):
    with pytest.raises(APIError) as error:
        require(role, "tables.write")
    assert error.value.status == 403
    require("owner", "tables.write")


ADDRESS = dict(
    postal_code="01001000", state="SP", city="São Paulo", neighborhood="Sé", street="Praça da Sé", number="10"
)


def test_structured_address():
    from comandei.schemas import RestaurantAddress

    address = RestaurantAddress(**ADDRESS)
    assert address.complement == ""
    assert address.display() == "Praça da Sé, 10 - Sé, São Paulo/SP - 01001-000"
    assert "Sala 1" in RestaurantAddress(**ADDRESS, complement="Sala 1").display()


@pytest.mark.parametrize(
    "changes",
    [dict(postal_code="123"), dict(state="XX"), dict(city=" "), dict(number=""), dict(complement="x" * 161)],
)
def test_invalid_structured_address(changes):
    from comandei.schemas import RestaurantAddress

    with pytest.raises(ValidationError):
        RestaurantAddress(**{**ADDRESS, **changes})
