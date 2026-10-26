from datetime import datetime, timezone, timedelta
from decimal import Decimal, ROUND_HALF_UP
from zoneinfo import ZoneInfo
from comandei.core.errors import APIError

MAX_CENTS = 9007199254740991


def cents(value: Decimal | int) -> int:
    result = int(Decimal(value).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    if not 0 <= result <= MAX_CENTS:
        raise APIError(422, "MONEY_RANGE", "Valor monetário fora do limite permitido.")
    return result


def line_total(quantity: Decimal, unit_price: int, modifiers: int = 0) -> int:
    return cents(quantity * (Decimal(unit_price) + modifiers))


def totals(subtotal: int, discount: int, rate_bps: int, service_accepted: bool = True) -> dict:
    if not 0 <= discount <= subtotal or not 0 <= rate_bps <= 10000:
        raise APIError(422, "INVALID_ADJUSTMENT", "Desconto ou taxa de serviço inválido.")
    base = subtotal - discount
    service = cents(Decimal(base) * rate_bps / 10000) if service_accepted else 0
    return {
        "subtotal_cents": subtotal,
        "discount_cents": discount,
        "service_cents": service,
        "total_cents": cents(Decimal(base) + service),
        "service_rate_bps": rate_bps if service_accepted else 0,
    }


def business_date(zone: str, cutoff, now: datetime | None = None):
    local = (now or datetime.now(timezone.utc)).astimezone(ZoneInfo(zone))
    return local.date() - timedelta(days=int(local.time().replace(tzinfo=None) < cutoff))


def csv_cell(value):
    value = "" if value is None else str(value)
    # Ignore leading whitespace/control characters when detecting spreadsheet formulas.
    return "'" + value if value.lstrip(" \t\r\n").startswith(("=", "+", "-", "@")) else value
