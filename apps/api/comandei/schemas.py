from datetime import date, time, datetime
from decimal import Decimal
from typing import Annotated, Literal, Generic, TypeVar, Any
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator

Money = Annotated[int, Field(strict=True, ge=0, le=9007199254740991)]
PositiveMoney = Annotated[int, Field(strict=True, ge=1, le=9007199254740991)]
Version = Annotated[int, Field(strict=True, ge=1, le=9007199254740991)]
Name = Annotated[str, Field(min_length=1, max_length=160, pattern=r".*\S.*")]
Reason = Annotated[str, Field(min_length=3, max_length=1000, pattern=r".*\S.*")]
Role = Literal["owner", "manager", "cashier", "waiter"]
Unit = Literal["unit", "kg", "g", "l", "ml"]


class DTO(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, allow_inf_nan=False)


class Expected(DTO):
    expected_version: Version


class RestaurantCreate(DTO):
    name: Name
    address: Annotated[str, Field(min_length=3, max_length=500)]
    cnpj: Annotated[str, Field(min_length=14, max_length=24)]
    opens_at: time
    closes_at: time
    service_type: Literal["rodizio", "alacarte", "both"]

    @field_validator("cnpj")
    @classmethod
    def cnpj_digits(cls, value):
        from comandei.domain.registration import normalize_cnpj

        return normalize_cnpj(value)

    @field_validator("opens_at", "closes_at")
    @classmethod
    def wall_time(cls, value):
        if value.tzinfo is not None:
            raise ValueError("Use horário local sem fuso.")
        return value


class TableCreate(DTO):
    code: Annotated[str, Field(min_length=1, max_length=40)]
    name: Name
    capacity: Annotated[int, Field(strict=True, ge=1, le=1000)] | None = None
    active: bool = True


class TablePatch(Expected):
    code: Annotated[str, Field(min_length=1, max_length=40)] | None = None
    name: Name | None = None
    capacity: Annotated[int, Field(strict=True, ge=1, le=1000)] | None = None
    active: bool | None = None


class CategoryCreate(DTO):
    name: Name
    position: Annotated[int, Field(strict=True, ge=0, le=10000)] = 0
    active: bool = True


class CategoryPatch(Expected):
    name: Name | None = None
    position: Annotated[int, Field(strict=True, ge=0, le=10000)] | None = None
    active: bool | None = None


class ProductCreate(DTO):
    category_id: UUID
    sku: Annotated[str, Field(min_length=1, max_length=80)] | None = None
    name: Name
    price_cents: Money
    unit: Unit = "unit"
    available: bool = True
    active: bool = True


class ProductPatch(Expected):
    category_id: UUID | None = None
    sku: Annotated[str, Field(min_length=1, max_length=80)] | None = None
    name: Name | None = None
    price_cents: Money | None = None
    unit: Unit | None = None
    available: bool | None = None
    active: bool | None = None


class ModifierGroupCreate(DTO):
    name: Name
    min_choices: Annotated[int, Field(strict=True, ge=0, le=50)] = 0
    max_choices: Annotated[int, Field(strict=True, ge=0, le=50)] = 1
    active: bool = True


class ModifierGroupPatch(Expected):
    name: Name | None = None
    min_choices: Annotated[int, Field(strict=True, ge=0, le=50)] | None = None
    max_choices: Annotated[int, Field(strict=True, ge=0, le=50)] | None = None
    active: bool | None = None


class ModifierOptionCreate(DTO):
    group_id: UUID
    name: Name
    price_cents: Money = 0
    active: bool = True


class ModifierOptionPatch(Expected):
    name: Name | None = None
    price_cents: Money | None = None
    active: bool | None = None


class ProductGroupCreate(DTO):
    product_id: UUID
    group_id: UUID
    position: Annotated[int, Field(strict=True, ge=0, le=10000)] = 0
    active: bool = True


class ProductGroupPatch(Expected):
    position: Annotated[int, Field(strict=True, ge=0, le=10000)] | None = None
    active: bool | None = None


class RegisterCreate(DTO):
    code: Annotated[str, Field(min_length=1, max_length=40)]
    name: Name
    active: bool = True


class RegisterPatch(Expected):
    code: Annotated[str, Field(min_length=1, max_length=40)] | None = None
    name: Name | None = None
    active: bool | None = None


class SettingsPatch(Expected):
    name: Name | None = None
    address: Annotated[str, Field(min_length=3, max_length=500)] | None = None
    cnpj: Annotated[str, Field(min_length=14, max_length=24)] | None = None
    opens_at: time | None = None
    closes_at: time | None = None
    service_type: Literal["rodizio", "alacarte", "both"] | None = None
    photo_path: Annotated[str, Field(pattern=r"^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$")] | None = None
    timezone: str | None = None
    business_day_cutoff: time | None = None
    service_rate_bps: Annotated[int, Field(strict=True, ge=0, le=10000)] | None = None
    cashier_discount_limit_bps: Annotated[int, Field(strict=True, ge=0, le=10000)] | None = None
    manager_discount_limit_bps: Annotated[int, Field(strict=True, ge=0, le=10000)] | None = None
    cash_difference_tolerance_cents: Money | None = None

    @field_validator("cnpj")
    @classmethod
    def cnpj_digits(cls, value):
        from comandei.domain.registration import normalize_cnpj

        return normalize_cnpj(value) if value is not None else None

    @field_validator("timezone")
    @classmethod
    def valid_zone(cls, value):
        if value is not None:
            try:
                ZoneInfo(value)
            except (ZoneInfoNotFoundError, ValueError) as exc:
                raise ValueError("Fuso IANA inválido.") from exc
        return value

    @field_validator("business_day_cutoff", "opens_at", "closes_at")
    @classmethod
    def local_time(cls, value):
        if value is not None and value.tzinfo is not None:
            raise ValueError("Use horário local sem fuso.")
        return value


class TabOpen(DTO):
    table_id: UUID | None = None


class OrderItem(DTO):
    product_id: UUID
    catalog_version: Version
    quantity: Annotated[Decimal, Field(gt=0, max_digits=12, decimal_places=3)]
    modifier_option_ids: Annotated[list[UUID], Field(max_length=50)] = []
    notes: Annotated[str, Field(max_length=1000)] | None = None

    @field_validator("quantity", mode="before")
    @classmethod
    def decimal_string(cls, value):
        if not isinstance(value, str):
            raise ValueError("Quantidade deve ser uma string decimal.")
        return value


class OrderSubmit(Expected):
    items: Annotated[list[OrderItem], Field(min_length=1, max_length=100)]


class Transition(Expected):
    status: Literal["preparing", "ready", "delivered"]


class CancelRequest(Expected):
    reason: Reason


class Adjustment(Expected):
    type: Literal["discount", "service"]
    amount_cents: Money = 0
    accepted: bool | None = None
    reason: Reason


class StartClosing(Expected):
    service_accepted: bool = True


class Payment(Expected):
    cash_session_id: UUID
    method: Literal["cash", "pix", "credit_card", "debit_card", "other"]
    amount_cents: PositiveMoney
    tendered_cents: PositiveMoney | None = None
    operation_key: UUID
    external_reference: Annotated[str, Field(min_length=1, max_length=160)] | None = None
    confirmed: Literal[True]


class Refund(DTO):
    cash_session_id: UUID
    amount_cents: PositiveMoney
    reason: Reason
    operation_key: UUID
    confirmed: Literal[True]


class CashOpen(DTO):
    register_id: UUID
    initial_balance_cents: Money = 0


class CashMovement(Expected):
    type: Literal["supply", "withdrawal"]
    amount_cents: PositiveMoney
    reason: Reason
    operation_key: UUID


class CashClose(Expected):
    declared_cents: Money
    reason: Reason | None = None


class InvitationCreate(DTO):
    email: Annotated[str, Field(min_length=3, max_length=254, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$")]
    role: Role


class InvitationAccept(DTO):
    token: Annotated[str, Field(min_length=32, max_length=256)]


class MemberPatch(DTO):
    role: Role
    status: Literal["active", "blocked", "revoked"]


class ExportCreate(DTO):
    start_date: date
    end_date: date


class TenantCreate(DTO):
    name: Name
    slug: Annotated[str, Field(min_length=1, max_length=80, pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$")]
    owner_user_id: UUID


class PlanUpdate(DTO):
    status: Literal["active", "suspended", "closed"]
    plan: Annotated[str, Field(min_length=1, max_length=80)]
    max_users: Annotated[int, Field(strict=True, ge=1, le=10000)] = 25
    max_tables: Annotated[int, Field(strict=True, ge=1, le=10000)] = 100


class ErrorContent(DTO):
    code: str
    message: str
    request_id: UUID
    details: dict[str, Any] = {}


class ErrorEnvelope(DTO):
    error: ErrorContent


class Entity(DTO):
    id: UUID
    tenant_id: UUID
    created_at: datetime
    updated_at: datetime


class VersionedEntity(Entity):
    version: Version


class TableRead(TableCreate, VersionedEntity):
    active_tab: dict[str, Any] | None = None


class CategoryRead(CategoryCreate, VersionedEntity):
    pass


class ProductRead(ProductCreate, VersionedEntity):
    modifier_groups: list[dict[str, Any]] | None = None


class ModifierGroupRead(ModifierGroupCreate, VersionedEntity):
    pass


class ModifierOptionRead(ModifierOptionCreate, VersionedEntity):
    pass


class ProductGroupRead(ProductGroupCreate, VersionedEntity):
    pass


class RegisterRead(RegisterCreate, VersionedEntity):
    pass


T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    items: list[T]
    next_cursor: str | None


class TabRead(VersionedEntity):
    table_id: UUID | None
    number: int
    status: Literal["open", "closing", "closed", "cancelled"]
    opened_by: UUID
    closed_by: UUID | None
    opened_at: datetime
    closed_at: datetime | None
    business_date: date
    service_accepted: bool


class Amounts(DTO):
    subtotal_cents: Money
    discount_cents: Money
    service_cents: Money
    total_cents: Money
    service_rate_bps: int
    received_cents: int
    balance_cents: int


class OrderSubmitted(DTO):
    order_id: UUID
    tab_id: UUID
    version: Version
    submitted_at: datetime
    amounts: Amounts


class SettlementRead(Entity):
    tab_id: UUID
    revision: int
    subtotal_cents: Money
    discount_cents: Money
    service_cents: Money
    service_rate_bps: int
    total_cents: Money
    status: Literal["active", "settled", "superseded"]


class FrozenSettlement(DTO):
    tab: TabRead
    settlement: SettlementRead


class PaymentRead(Entity):
    tab_id: UUID
    settlement_id: UUID
    cash_session_id: UUID
    type: Literal["receipt", "refund"]
    method: Literal["cash", "pix", "credit_card", "debit_card", "other"]
    amount_cents: PositiveMoney
    tendered_cents: PositiveMoney | None
    status: Literal["confirmed"]
    external_reference: str | None
    operation_key: UUID
    original_entry_id: UUID | None
    recorded_by: UUID
    approved_by: UUID | None
    reason: str | None


class PaymentRecorded(DTO):
    payment: PaymentRead
    version: Version
    balance_cents: Money
    change_cents: Money
