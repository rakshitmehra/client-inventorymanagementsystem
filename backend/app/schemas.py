"""
Request schemas.

Responses are assembled as plain dictionaries in the routers: the UI needs
joined, derived and aggregated shapes that do not map cleanly onto ORM rows, so
declaring response models for each of them would add noise without adding
safety. Decimals are converted to float at the boundary so the JSON stays
numeric.
"""

from __future__ import annotations

import re
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

SKU_PATTERN = re.compile(r"^[A-Z0-9-]+$")
USERNAME_PATTERN = re.compile(r"^[a-z0-9._-]+$")

Quantity = Annotated[float, Field(gt=0)]
NonNegative = Annotated[float, Field(ge=0)]


class Schema(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="ignore")


# ---------------------------------------------------------------------------
# auth
# ---------------------------------------------------------------------------
class LoginRequest(Schema):
    username: str = Field(min_length=3, max_length=60)
    password: str = Field(min_length=1)


class ChangePasswordRequest(Schema):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=8, max_length=128)
    confirm_password: str

    @model_validator(mode="after")
    def passwords_match(self):
        if self.new_password != self.confirm_password:
            raise ValueError("The two passwords do not match")
        return self


# ---------------------------------------------------------------------------
# users
# ---------------------------------------------------------------------------
class UserBase(Schema):
    username: str = Field(min_length=3, max_length=40)
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=120)
    phone: str | None = Field(default=None, max_length=30)
    role_id: int

    @field_validator("username")
    @classmethod
    def check_username(cls, value: str) -> str:
        value = value.lower()
        if not USERNAME_PATTERN.match(value):
            raise ValueError(
                "Username may only contain letters, numbers, dots, dashes and underscores"
            )
        return value


class UserCreate(UserBase):
    password: str = Field(min_length=8, max_length=128)
    kitchen_ids: list[int] = Field(default_factory=list)


class UserUpdate(UserBase):
    pass


class StatusUpdate(Schema):
    is_active: bool
    force: bool = False


class ResetPasswordRequest(Schema):
    new_password: str = Field(min_length=8, max_length=128)


# ---------------------------------------------------------------------------
# kitchens
# ---------------------------------------------------------------------------
class KitchenBase(Schema):
    code: str = Field(min_length=2, max_length=20)
    name: str = Field(min_length=2, max_length=120)
    location: str | None = Field(default=None, max_length=200)
    phone: str | None = Field(default=None, max_length=30)
    description: str | None = Field(default=None, max_length=500)

    @field_validator("code")
    @classmethod
    def check_code(cls, value: str) -> str:
        value = value.upper()
        if not SKU_PATTERN.match(value):
            raise ValueError("Code may only contain letters, numbers and dashes")
        return value


class KitchenCreate(KitchenBase):
    manager_ids: list[int] = Field(default_factory=list)


class KitchenUpdate(KitchenBase):
    pass


class AssignManagerRequest(Schema):
    user_id: int


class MinLevelRequest(Schema):
    min_stock_level: NonNegative


# ---------------------------------------------------------------------------
# catalogue
# ---------------------------------------------------------------------------
class CategoryCreate(Schema):
    name: str = Field(min_length=2, max_length=60)
    description: str | None = Field(default=None, max_length=300)


class CategoryUpdate(CategoryCreate):
    is_active: bool = True


class SupplierBase(Schema):
    name: str = Field(min_length=2, max_length=120)
    contact_person: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=30)
    email: str | None = Field(default=None, max_length=160)
    address: str | None = Field(default=None, max_length=300)
    notes: str | None = Field(default=None, max_length=500)


class SupplierCreate(SupplierBase):
    pass


class SupplierUpdate(SupplierBase):
    is_active: bool = True


class ItemBase(Schema):
    sku: str = Field(min_length=2, max_length=40)
    name: str = Field(min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=400)
    category_id: int | None = None
    unit_id: int
    min_stock_level: NonNegative = 0
    max_stock_level: NonNegative | None = None
    reorder_quantity: NonNegative = 0
    unit_cost: NonNegative = 0
    default_supplier_id: int | None = None
    is_perishable: bool = False

    @field_validator("sku")
    @classmethod
    def check_sku(cls, value: str) -> str:
        value = value.upper()
        if not SKU_PATTERN.match(value):
            raise ValueError("SKU may only contain letters, numbers and dashes")
        return value

    @model_validator(mode="after")
    def check_levels(self):
        if self.max_stock_level is not None and self.max_stock_level < self.min_stock_level:
            raise ValueError("Maximum must be greater than the minimum stock level")
        return self


class ItemCreate(ItemBase):
    pass


class ItemUpdate(ItemBase):
    is_active: bool = True


# ---------------------------------------------------------------------------
# products and recipes
# ---------------------------------------------------------------------------
class ProductBase(Schema):
    sku: str = Field(min_length=2, max_length=40)
    name: str = Field(min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    category_id: int | None = None
    unit_id: int
    selling_price: NonNegative = 0

    @field_validator("sku")
    @classmethod
    def check_sku(cls, value: str) -> str:
        value = value.upper()
        if not SKU_PATTERN.match(value):
            raise ValueError("SKU may only contain letters, numbers and dashes")
        return value


class ProductCreate(ProductBase):
    pass


class ProductUpdate(ProductBase):
    is_active: bool = True


class IngredientLine(Schema):
    item_id: int
    quantity: Quantity
    unit_id: int | None = None
    is_optional: bool = False
    notes: str | None = Field(default=None, max_length=200)


class RecipeRequest(Schema):
    name: str = Field(min_length=2, max_length=120)
    yield_quantity: Quantity = 1
    yield_unit_id: int
    prep_time_mins: int | None = Field(default=None, ge=0)
    instructions: str | None = Field(default=None, max_length=4000)
    ingredients: list[IngredientLine] = Field(min_length=1)


# ---------------------------------------------------------------------------
# stock documents
# ---------------------------------------------------------------------------
class DocumentLine(Schema):
    item_id: int
    quantity: Quantity
    unit_id: int | None = None
    unit_cost: NonNegative | None = None
    batch_no: str | None = Field(default=None, max_length=60)
    expiry_date: str | None = Field(default=None, max_length=20)
    notes: str | None = Field(default=None, max_length=200)


class GoodsReceiptRequest(Schema):
    supplier_id: int | None = None
    invoice_no: str | None = Field(default=None, max_length=60)
    received_at: str | None = None
    notes: str | None = Field(default=None, max_length=500)
    items: list[DocumentLine] = Field(min_length=1)


class TransferRequest(Schema):
    from_location_type: Literal["MAIN", "KITCHEN"]
    from_kitchen_id: int | None = None
    to_location_type: Literal["MAIN", "KITCHEN"]
    to_kitchen_id: int | None = None
    transfer_date: str | None = None
    notes: str | None = Field(default=None, max_length=500)
    items: list[DocumentLine] = Field(min_length=1)

    @model_validator(mode="after")
    def check_endpoints(self):
        if self.from_location_type == "KITCHEN" and not self.from_kitchen_id:
            raise ValueError("Choose the source kitchen")
        if self.to_location_type == "KITCHEN" and not self.to_kitchen_id:
            raise ValueError("Choose the destination kitchen")
        return self


class ProductionPreviewRequest(Schema):
    kitchen_id: int
    product_id: int
    recipe_id: int | None = None
    output_quantity: Quantity


class ProductionRequest(ProductionPreviewRequest):
    produced_at: str | None = None
    notes: str | None = Field(default=None, max_length=500)


WastageReasonCode = Literal[
    "EXPIRED", "DAMAGED", "SPOILED", "SPILLAGE", "OVER_PRODUCTION", "QUALITY_REJECT", "OTHER"
]

AdjustmentReasonCode = Literal[
    "STOCK_COUNT", "DATA_ENTRY_ERROR", "FOUND_STOCK", "MISSING_STOCK", "OPENING_BALANCE", "OTHER"
]


class WastageRequest(Schema):
    location_type: Literal["MAIN", "KITCHEN"]
    kitchen_id: int | None = None
    item_id: int
    quantity: Quantity
    unit_id: int | None = None
    reason_code: WastageReasonCode
    reason: str | None = Field(default=None, max_length=500)
    recorded_at: str | None = None

    @model_validator(mode="after")
    def check_kitchen(self):
        if self.location_type == "KITCHEN" and not self.kitchen_id:
            raise ValueError("Choose the kitchen")
        return self


class AdjustmentRequest(Schema):
    location_type: Literal["MAIN", "KITCHEN"]
    kitchen_id: int | None = None
    item_id: int
    new_quantity: NonNegative
    reason_code: AdjustmentReasonCode
    reason: str | None = Field(default=None, max_length=500)
    adjusted_at: str | None = None

    @model_validator(mode="after")
    def check_kitchen(self):
        if self.location_type == "KITCHEN" and not self.kitchen_id:
            raise ValueError("Choose the kitchen")
        return self


# ---------------------------------------------------------------------------
# helpers used by the routers when shaping responses
# ---------------------------------------------------------------------------
def f(value: Any) -> float:
    """Decimal/None -> float, for JSON responses."""
    return float(value) if value is not None else 0.0


def dt(value: Any) -> str | None:
    """datetime -> ISO 8601 string."""
    return value.isoformat() if value is not None else None
