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
