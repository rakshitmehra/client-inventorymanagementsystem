"""
Domain model for the multi-kitchen inventory system.

Notes on the CockroachDB mapping
--------------------------------
* Primary keys come from explicit sequences, not SERIAL: CockroachDB backs
  SERIAL with ``unique_rowid()``, whose values exceed JavaScript's safe
  integer range and would lose precision in the browser.
* Quantities and money are DECIMAL, never floating point. Stock is counted in
  each item's base unit with four decimal places.
* "Only one active row" rules are enforced with a nullable ``active_key``
  column inside a plain UNIQUE constraint. NULLs do not collide in a unique
  index, so at most one row per group can hold ``TRUE``. This keeps the
  constraint portable instead of relying on dialect-specific partial indexes.
* CHECK constraints keep stock from going negative even if the service layer is
  bypassed.
"""

from __future__ import annotations

import enum
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    Sequence,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base

# BIGSERIAL on CockroachDB/Postgres, plain INTEGER rowid on the SQLite fallback.
IdType = BigInteger().with_variant(Integer, "sqlite")

Qty = Numeric(18, 4)
Money = Numeric(14, 2)
Rate = Numeric(14, 4)


def _pk(table: str) -> Mapped[int]:
    """
    Primary key backed by an explicit sequence.

    CockroachDB's default SERIAL uses ``unique_rowid()``, which returns values
    far beyond JavaScript's safe integer range (2^53-1). Those ids would lose
    precision the moment the browser parsed the JSON, so every table draws from
    a real sequence instead and keeps its ids small enough to survive the trip.

    The sequence is attached both as the column's generator and as its server
    default, so the database fills the id in whether the insert comes from the
    ORM or from plain SQL.
    """
    # Bound to the metadata so create_all() emits every CREATE SEQUENCE before
    # the tables that reference them.
    sequence = Sequence(f"seq_{table}", metadata=Base.metadata)
    return mapped_column(
        IdType, sequence, primary_key=True, server_default=sequence.next_value()
    )


def _fk(target: str, **kwargs) -> Mapped[int]:
    return mapped_column(IdType, ForeignKey(target, **kwargs))


def _now() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# ---------------------------------------------------------------------------
# enumerations (stored as text with CHECK constraints)
# ---------------------------------------------------------------------------
class RoleCode(str, enum.Enum):
    ADMIN = "ADMIN"
    KITCHEN_MANAGER = "KITCHEN_MANAGER"


class LocationType(str, enum.Enum):
    MAIN = "MAIN"
    KITCHEN = "KITCHEN"


class Direction(str, enum.Enum):
    IN = "IN"
    OUT = "OUT"


class MovementType(str, enum.Enum):
    PURCHASE_RECEIPT = "PURCHASE_RECEIPT"
    TRANSFER_OUT = "TRANSFER_OUT"
    TRANSFER_IN = "TRANSFER_IN"
    PRODUCTION_CONSUMPTION = "PRODUCTION_CONSUMPTION"
    WASTAGE = "WASTAGE"
    ADJUSTMENT_INCREASE = "ADJUSTMENT_INCREASE"
    ADJUSTMENT_DECREASE = "ADJUSTMENT_DECREASE"
    OPENING_BALANCE = "OPENING_BALANCE"


class CounterpartyType(str, enum.Enum):
    MAIN = "MAIN"
    KITCHEN = "KITCHEN"
    SUPPLIER = "SUPPLIER"
    PRODUCTION = "PRODUCTION"
    WASTAGE = "WASTAGE"
    ADJUSTMENT = "ADJUSTMENT"
    OPENING = "OPENING"


class WastageReason(str, enum.Enum):
    EXPIRED = "EXPIRED"
    DAMAGED = "DAMAGED"
    SPOILED = "SPOILED"
    SPILLAGE = "SPILLAGE"
    OVER_PRODUCTION = "OVER_PRODUCTION"
    QUALITY_REJECT = "QUALITY_REJECT"
    OTHER = "OTHER"


class AdjustmentReason(str, enum.Enum):
    STOCK_COUNT = "STOCK_COUNT"
    DATA_ENTRY_ERROR = "DATA_ENTRY_ERROR"
    FOUND_STOCK = "FOUND_STOCK"
    MISSING_STOCK = "MISSING_STOCK"
    OPENING_BALANCE = "OPENING_BALANCE"
    OTHER = "OTHER"


class ListPurpose(str, enum.Enum):
    """
    What a standard list is for, which decides what running it does.

    REFILL buys stock into the main store, so running it writes a goods
    receipt. DELIVERY sends stock out to one kitchen, so running it writes a
    transfer. The two are kept apart because the quantities mean different
    things - a month's purchasing is not a week's delivery - and because a
    list pointed at the wrong end of the business would move stock the wrong
    way.
    """

    REFILL = "REFILL"
    DELIVERY = "DELIVERY"


class RequestStatus(str, enum.Enum):
    """
    Lifecycle of a kitchen's request to the main store.

    PENDING is the only state an administrator can act on, and every other
    state is final: once a request has become a transfer, or been turned down,
    re-deciding it would move stock a second time.
    """

    PENDING = "PENDING"
    APPROVED = "APPROVED"
    DECLINED = "DECLINED"
    CANCELLED = "CANCELLED"


class UnitDimension(str, enum.Enum):
    MASS = "MASS"
    VOLUME = "VOLUME"
    COUNT = "COUNT"


def _in(column: str, values: type[enum.Enum]) -> str:
    joined = ", ".join(f"'{member.value}'" for member in values)
    return f"{column} IN ({joined})"


# ---------------------------------------------------------------------------
# identity
# ---------------------------------------------------------------------------
class Role(Base):
    __tablename__ = "roles"
    __table_args__ = (CheckConstraint(_in("code", RoleCode), name="ck_roles_code"),)

    id: Mapped[int] = _pk("roles")
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)

    users: Mapped[list[User]] = relationship(back_populates="role")


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = _pk("users")
    username: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String(160), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(30))
    role_id: Mapped[int] = _fk("roles.id", ondelete="RESTRICT")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[int | None] = mapped_column(IdType, ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = _now()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    role: Mapped[Role] = relationship(back_populates="users")
    assignments: Mapped[list[KitchenManager]] = relationship(
        back_populates="user", foreign_keys="KitchenManager.user_id"
    )


class Kitchen(Base):
    __tablename__ = "kitchens"

    id: Mapped[int] = _pk("kitchens")
    code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    location: Mapped[str | None] = mapped_column(String(200))
    phone: Mapped[str | None] = mapped_column(String(30))
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_by: Mapped[int | None] = _fk("users.id", ondelete="SET NULL")
    created_at: Mapped[datetime] = _now()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    managers: Mapped[list[KitchenManager]] = relationship(
        back_populates="kitchen", cascade="all, delete-orphan"
    )
    inventory: Mapped[list[KitchenInventory]] = relationship(
        back_populates="kitchen", cascade="all, delete-orphan"
    )


class KitchenManager(Base):
    """Assignment history. ``active_key`` is TRUE while active, else NULL."""

    __tablename__ = "kitchen_managers"
    __table_args__ = (
        UniqueConstraint("kitchen_id", "user_id", "active_key", name="uq_kitchen_manager_active"),
        Index("ix_km_user_active", "user_id", "is_active"),
    )

    id: Mapped[int] = _pk("kitchen_managers")
    kitchen_id: Mapped[int] = _fk("kitchens.id", ondelete="CASCADE")
    user_id: Mapped[int] = _fk("users.id", ondelete="CASCADE")
    is_primary: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    active_key: Mapped[bool | None] = mapped_column(Boolean, default=True)
    assigned_at: Mapped[datetime] = _now()
    assigned_by: Mapped[int | None] = mapped_column(
        IdType, ForeignKey("users.id", ondelete="SET NULL")
    )
    unassigned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    kitchen: Mapped[Kitchen] = relationship(back_populates="managers")
    user: Mapped[User] = relationship(back_populates="assignments", foreign_keys=[user_id])

    def deactivate(self) -> None:
        self.is_active = False
        self.active_key = None
        self.unassigned_at = datetime.now()


# ---------------------------------------------------------------------------
# catalogue
# ---------------------------------------------------------------------------
class Unit(Base):
    """
    Units grouped by dimension, each with a factor to that dimension's base
    unit. This is what lets a recipe say "500 g of flour" while the warehouse
    stocks flour in kg.
    """

    __tablename__ = "units"
    __table_args__ = (
        CheckConstraint(_in("dimension", UnitDimension), name="ck_units_dimension"),
        CheckConstraint("factor > 0", name="ck_units_factor"),
    )

    id: Mapped[int] = _pk("units")
    code: Mapped[str] = mapped_column(String(16), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(48), nullable=False)
    dimension: Mapped[str] = mapped_column(String(16), nullable=False)
    factor: Mapped[Decimal] = mapped_column(Numeric(18, 6), nullable=False)
    is_base: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = _pk("categories")
    name: Mapped[str] = mapped_column(String(60), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = _now()


class Supplier(Base):
    __tablename__ = "suppliers"

    id: Mapped[int] = _pk("suppliers")
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    contact_person: Mapped[str | None] = mapped_column(String(120))
    phone: Mapped[str | None] = mapped_column(String(30))
    email: Mapped[str | None] = mapped_column(String(160))
    address: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = _now()


class Item(Base):
    __tablename__ = "items"
    __table_args__ = (
        CheckConstraint("min_stock_level >= 0", name="ck_items_min_level"),
        CheckConstraint("reorder_quantity >= 0", name="ck_items_reorder"),
        CheckConstraint("unit_cost >= 0", name="ck_items_cost"),
        Index("ix_items_category", "category_id"),
        Index("ix_items_name", "name"),
    )

    id: Mapped[int] = _pk("items")
    sku: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    category_id: Mapped[int | None] = _fk("categories.id", ondelete="SET NULL")
    unit_id: Mapped[int] = _fk("units.id", ondelete="RESTRICT")
    min_stock_level: Mapped[Decimal] = mapped_column(Qty, default=Decimal("0"), nullable=False)
    max_stock_level: Mapped[Decimal | None] = mapped_column(Qty)
    reorder_quantity: Mapped[Decimal] = mapped_column(Qty, default=Decimal("0"), nullable=False)
    unit_cost: Mapped[Decimal] = mapped_column(Rate, default=Decimal("0"), nullable=False)
    default_supplier_id: Mapped[int | None] = _fk("suppliers.id", ondelete="SET NULL")
    is_perishable: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = _now()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    unit: Mapped[Unit] = relationship()
    category: Mapped[Category | None] = relationship()
    supplier: Mapped[Supplier | None] = relationship()


# ---------------------------------------------------------------------------
# stock on hand
# ---------------------------------------------------------------------------
class MainInventory(Base):
    __tablename__ = "main_inventory"
    __table_args__ = (CheckConstraint("quantity >= 0", name="ck_main_inventory_non_negative"),)

    id: Mapped[int] = _pk("main_inventory")
    item_id: Mapped[int] = mapped_column(
        IdType, ForeignKey("items.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    quantity: Mapped[Decimal] = mapped_column(Qty, default=Decimal("0"), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    item: Mapped[Item] = relationship()


class KitchenInventory(Base):
    __tablename__ = "kitchen_inventory"
    __table_args__ = (
        UniqueConstraint("kitchen_id", "item_id", name="uq_kitchen_item"),
        CheckConstraint("quantity >= 0", name="ck_kitchen_inventory_non_negative"),
        CheckConstraint("min_stock_level >= 0", name="ck_kitchen_inventory_min_level"),
        Index("ix_kitchen_inventory_kitchen", "kitchen_id"),
    )

    id: Mapped[int] = _pk("kitchen_inventory")
    kitchen_id: Mapped[int] = _fk("kitchens.id", ondelete="CASCADE")
    item_id: Mapped[int] = _fk("items.id", ondelete="CASCADE")
    quantity: Mapped[Decimal] = mapped_column(Qty, default=Decimal("0"), nullable=False)
    min_stock_level: Mapped[Decimal] = mapped_column(Qty, default=Decimal("0"), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    kitchen: Mapped[Kitchen] = relationship(back_populates="inventory")
    item: Mapped[Item] = relationship()


# ---------------------------------------------------------------------------
# the universal ledger
# ---------------------------------------------------------------------------
class StockMovement(Base):
    """Every change to any balance - main or kitchen - writes exactly one row."""

    __tablename__ = "stock_movements"
    __table_args__ = (
        CheckConstraint(_in("movement_type", MovementType), name="ck_movement_type"),
        CheckConstraint(_in("direction", Direction), name="ck_movement_direction"),
        CheckConstraint(_in("location_type", LocationType), name="ck_movement_location"),
        CheckConstraint(_in("counterparty_type", CounterpartyType), name="ck_movement_counterparty"),
        CheckConstraint("quantity > 0", name="ck_movement_quantity"),
        CheckConstraint(
            "(location_type = 'MAIN' AND kitchen_id IS NULL) "
            "OR (location_type = 'KITCHEN' AND kitchen_id IS NOT NULL)",
            name="ck_movement_kitchen_presence",
        ),
        Index("ix_movement_item_time", "item_id", "created_at"),
        Index("ix_movement_kitchen_time", "kitchen_id", "created_at"),
        Index("ix_movement_reference", "reference_type", "reference_id"),
        Index("ix_movement_created", "created_at"),
    )

    id: Mapped[int] = _pk("stock_movements")
    movement_no: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    movement_type: Mapped[str] = mapped_column(String(32), nullable=False)
    direction: Mapped[str] = mapped_column(String(4), nullable=False)
    item_id: Mapped[int] = _fk("items.id", ondelete="RESTRICT")
    quantity: Mapped[Decimal] = mapped_column(Qty, nullable=False)

    # the balance this row moved
    location_type: Mapped[str] = mapped_column(String(10), nullable=False)
    kitchen_id: Mapped[int | None] = _fk("kitchens.id", ondelete="RESTRICT")
    balance_before: Mapped[Decimal] = mapped_column(Qty, nullable=False)
    balance_after: Mapped[Decimal] = mapped_column(Qty, nullable=False)

    # where the stock came from / went to
    counterparty_type: Mapped[str] = mapped_column(String(16), nullable=False)
    counterparty_kitchen_id: Mapped[int | None] = mapped_column(
        IdType, ForeignKey("kitchens.id", ondelete="SET NULL")
    )
    counterparty_supplier_id: Mapped[int | None] = _fk("suppliers.id", ondelete="SET NULL")
    counterparty_label: Mapped[str | None] = mapped_column(String(200))

    reference_type: Mapped[str | None] = mapped_column(String(24))
    reference_id: Mapped[int | None] = mapped_column(IdType)
    reference_no: Mapped[str | None] = mapped_column(String(32))

    unit_cost: Mapped[Decimal] = mapped_column(Rate, default=Decimal("0"), nullable=False)
    total_cost: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    performed_by: Mapped[int | None] = _fk("users.id", ondelete="SET NULL")
    created_at: Mapped[datetime] = _now()

    item: Mapped[Item] = relationship()
    kitchen: Mapped[Kitchen | None] = relationship(foreign_keys=[kitchen_id])
    counterparty_kitchen: Mapped[Kitchen | None] = relationship(
        foreign_keys=[counterparty_kitchen_id]
    )
    performer: Mapped[User | None] = relationship()


# ---------------------------------------------------------------------------
# goods receipts
# ---------------------------------------------------------------------------
class StockReceipt(Base):
    __tablename__ = "stock_receipts"

    id: Mapped[int] = _pk("stock_receipts")
    receipt_no: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    supplier_id: Mapped[int | None] = _fk("suppliers.id", ondelete="SET NULL")
    invoice_no: Mapped[str | None] = mapped_column(String(60))
    received_at: Mapped[datetime] = _now()
    total_items: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_cost: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[int | None] = _fk("users.id", ondelete="SET NULL")
    created_at: Mapped[datetime] = _now()

    supplier: Mapped[Supplier | None] = relationship()
    creator: Mapped[User | None] = relationship()
    items: Mapped[list[StockReceiptItem]] = relationship(
        back_populates="receipt", cascade="all, delete-orphan"
    )


class StockReceiptItem(Base):
    __tablename__ = "stock_receipt_items"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_receipt_item_quantity"),
        CheckConstraint("base_quantity > 0", name="ck_receipt_item_base_quantity"),
        Index("ix_receipt_items_receipt", "receipt_id"),
    )

    id: Mapped[int] = _pk("stock_receipt_items")
    receipt_id: Mapped[int] = _fk("stock_receipts.id", ondelete="CASCADE")
    item_id: Mapped[int] = _fk("items.id", ondelete="RESTRICT")
    quantity: Mapped[Decimal] = mapped_column(Qty, nullable=False)
    unit_id: Mapped[int] = _fk("units.id", ondelete="RESTRICT")
    base_quantity: Mapped[Decimal] = mapped_column(Qty, nullable=False)
    unit_cost: Mapped[Decimal] = mapped_column(Rate, default=Decimal("0"), nullable=False)
    total_cost: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"), nullable=False)
    batch_no: Mapped[str | None] = mapped_column(String(60))
    expiry_date: Mapped[str | None] = mapped_column(String(20))
    notes: Mapped[str | None] = mapped_column(Text)

    receipt: Mapped[StockReceipt] = relationship(back_populates="items")
    item: Mapped[Item] = relationship()
    unit: Mapped[Unit] = relationship()


# ---------------------------------------------------------------------------
# transfers
# ---------------------------------------------------------------------------
class InventoryTransfer(Base):
    __tablename__ = "inventory_transfers"
    __table_args__ = (
        CheckConstraint(_in("from_location_type", LocationType), name="ck_transfer_from_location"),
        CheckConstraint(_in("to_location_type", LocationType), name="ck_transfer_to_location"),
        CheckConstraint("status IN ('COMPLETED', 'CANCELLED')", name="ck_transfer_status"),
        CheckConstraint(
            "(from_location_type = 'MAIN' AND from_kitchen_id IS NULL) "
            "OR (from_location_type = 'KITCHEN' AND from_kitchen_id IS NOT NULL)",
            name="ck_transfer_from_kitchen",
        ),
        CheckConstraint(
            "(to_location_type = 'MAIN' AND to_kitchen_id IS NULL) "
            "OR (to_location_type = 'KITCHEN' AND to_kitchen_id IS NOT NULL)",
            name="ck_transfer_to_kitchen",
        ),
        Index("ix_transfer_to_kitchen", "to_kitchen_id"),
        Index("ix_transfer_date", "transfer_date"),
    )

    id: Mapped[int] = _pk("inventory_transfers")
    transfer_no: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    from_location_type: Mapped[str] = mapped_column(String(10), nullable=False)
    from_kitchen_id: Mapped[int | None] = _fk("kitchens.id", ondelete="RESTRICT")
    to_location_type: Mapped[str] = mapped_column(String(10), nullable=False)
    to_kitchen_id: Mapped[int | None] = mapped_column(
        IdType, ForeignKey("kitchens.id", ondelete="RESTRICT")
    )
    status: Mapped[str] = mapped_column(String(16), default="COMPLETED", nullable=False)
    transfer_date: Mapped[datetime] = _now()
    total_items: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_cost: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[int | None] = _fk("users.id", ondelete="SET NULL")
    created_at: Mapped[datetime] = _now()

    from_kitchen: Mapped[Kitchen | None] = relationship(foreign_keys=[from_kitchen_id])
    to_kitchen: Mapped[Kitchen | None] = relationship(foreign_keys=[to_kitchen_id])
    creator: Mapped[User | None] = relationship()
    items: Mapped[list[InventoryTransferItem]] = relationship(
        back_populates="transfer", cascade="all, delete-orphan"
    )


class InventoryTransferItem(Base):
    __tablename__ = "inventory_transfer_items"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_transfer_item_quantity"),
        CheckConstraint("base_quantity > 0", name="ck_transfer_item_base_quantity"),
        Index("ix_transfer_items_transfer", "transfer_id"),
    )

    id: Mapped[int] = _pk("inventory_transfer_items")
    transfer_id: Mapped[int] = _fk("inventory_transfers.id", ondelete="CASCADE")
    item_id: Mapped[int] = _fk("items.id", ondelete="RESTRICT")
    quantity: Mapped[Decimal] = mapped_column(Qty, nullable=False)
    unit_id: Mapped[int] = _fk("units.id", ondelete="RESTRICT")
    base_quantity: Mapped[Decimal] = mapped_column(Qty, nullable=False)
    unit_cost: Mapped[Decimal] = mapped_column(Rate, default=Decimal("0"), nullable=False)
    total_cost: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)

    transfer: Mapped[InventoryTransfer] = relationship(back_populates="items")
    item: Mapped[Item] = relationship()
    unit: Mapped[Unit] = relationship()


# ---------------------------------------------------------------------------
# stock requests (kitchen asks the main store for stock)
# ---------------------------------------------------------------------------
class StockRequest(Base):
    """
    A kitchen manager asking the main store to send them stock.

    This is a request, not a movement: nothing leaves the main store until an
    administrator approves it, and approving is what creates the transfer. The
    link to that transfer is kept so the paper trail runs both ways - from the
    request to the stock that satisfied it, and back again.
    """

    __tablename__ = "stock_requests"
    __table_args__ = (
        CheckConstraint(_in("status", RequestStatus), name="ck_request_status"),
        CheckConstraint(
            "(status = 'APPROVED' AND decided_at IS NOT NULL) OR status <> 'APPROVED'",
            name="ck_request_approved_has_decision",
        ),
        Index("ix_request_kitchen", "kitchen_id"),
        Index("ix_request_status", "status"),
    )

    id: Mapped[int] = _pk("stock_requests")
    request_no: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    kitchen_id: Mapped[int] = _fk("kitchens.id", ondelete="RESTRICT")
    status: Mapped[str] = mapped_column(String(16), default="PENDING", nullable=False)
    needed_by: Mapped[date | None] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(Text)

    requested_by: Mapped[int | None] = _fk("users.id", ondelete="SET NULL")
    requested_at: Mapped[datetime] = _now()

    decided_by: Mapped[int | None] = mapped_column(
        IdType, ForeignKey("users.id", ondelete="SET NULL")
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decision_note: Mapped[str | None] = mapped_column(Text)

    # Set when approval turns this into real stock movement.
    transfer_id: Mapped[int | None] = mapped_column(
        IdType, ForeignKey("inventory_transfers.id", ondelete="SET NULL")
    )

    kitchen: Mapped[Kitchen] = relationship()
    requester: Mapped[User | None] = relationship(foreign_keys=[requested_by])
    decider: Mapped[User | None] = relationship(foreign_keys=[decided_by])
    transfer: Mapped[InventoryTransfer | None] = relationship()
    items: Mapped[list[StockRequestItem]] = relationship(
        back_populates="request", cascade="all, delete-orphan"
    )


class StockRequestItem(Base):
    """
    One line of a request.

    ``quantity`` is what the kitchen asked for and never changes, so the
    original ask stays on the record. ``approved_quantity`` is what the
    administrator actually agreed to send, and is what the transfer uses. A
    line cut to zero is a line refused while the rest of the request goes
    through.
    """

    __tablename__ = "stock_request_items"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_request_item_quantity"),
        CheckConstraint(
            "approved_quantity IS NULL OR approved_quantity >= 0",
            name="ck_request_item_approved_quantity",
        ),
        UniqueConstraint("request_id", "item_id", name="uq_request_item"),
        Index("ix_request_items_request", "request_id"),
    )

    id: Mapped[int] = _pk("stock_request_items")
    request_id: Mapped[int] = _fk("stock_requests.id", ondelete="CASCADE")
    item_id: Mapped[int] = _fk("items.id", ondelete="RESTRICT")
    unit_id: Mapped[int] = _fk("units.id", ondelete="RESTRICT")
    quantity: Mapped[Decimal] = mapped_column(Qty, nullable=False)
    approved_quantity: Mapped[Decimal | None] = mapped_column(Qty)
    notes: Mapped[str | None] = mapped_column(Text)

    request: Mapped[StockRequest] = relationship(back_populates="items")
    item: Mapped[Item] = relationship()
    unit: Mapped[Unit] = relationship()


# ---------------------------------------------------------------------------
# standard lists
# ---------------------------------------------------------------------------
class StandardList(Base):
    """
    A saved list of items and quantities that gets used again and again.

    The monthly refill of the main store is the same eighty lines every month,
    and each kitchen takes roughly the same delivery every week. Typing that
    in line by line is slow and it is where mistakes come from, so the list is
    stored once and run whenever it is needed.

    Running a list does not do anything new: it fills in the ordinary goods
    receipt or transfer and hands it to the same service the manual screens
    use. So a list cannot move stock in a way somebody could not have moved it
    by hand, and everything it does lands in the ledger, the audit log and the
    printed note exactly as usual. The list is a shortcut, never a side door.
    """

    __tablename__ = "standard_lists"
    __table_args__ = (
        CheckConstraint(_in("purpose", ListPurpose), name="ck_list_purpose"),
        # A delivery has to know which kitchen it is for; a refill must not
        # name one, because it is buying into the main store.
        CheckConstraint(
            "(purpose = 'DELIVERY' AND kitchen_id IS NOT NULL) "
            "OR (purpose = 'REFILL' AND kitchen_id IS NULL)",
            name="ck_list_kitchen_matches_purpose",
        ),
        UniqueConstraint("name", name="uq_standard_list_name"),
        Index("ix_standard_list_purpose", "purpose"),
        Index("ix_standard_list_kitchen", "kitchen_id"),
    )

    id: Mapped[int] = _pk("standard_lists")
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    purpose: Mapped[str] = mapped_column(String(16), nullable=False)
    kitchen_id: Mapped[int | None] = mapped_column(
        IdType, ForeignKey("kitchens.id", ondelete="CASCADE")
    )
    supplier_id: Mapped[int | None] = mapped_column(
        IdType, ForeignKey("suppliers.id", ondelete="SET NULL")
    )
    notes: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    created_by: Mapped[int | None] = _fk("users.id", ondelete="SET NULL")
    created_at: Mapped[datetime] = _now()
    updated_at: Mapped[datetime] = _now()
    # Answers "did anyone actually run the refill this month?" without
    # trawling the receipts.
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    kitchen: Mapped[Kitchen | None] = relationship()
    supplier: Mapped[Supplier | None] = relationship()
    creator: Mapped[User | None] = relationship()
    items: Mapped[list[StandardListItem]] = relationship(
        back_populates="standard_list",
        cascade="all, delete-orphan",
        order_by="StandardListItem.id",
    )


class StandardListItem(Base):
    """
    One line of a standard list: an item and how much of it normally goes.

    The quantity is the usual amount, not a commitment. Whoever runs the list
    can change any line or drop it for that run without touching the list
    itself, which is the difference between "we normally take 20 kg" and "send
    20 kg today".
    """

    __tablename__ = "standard_list_items"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_standard_list_item_quantity"),
        UniqueConstraint("list_id", "item_id", name="uq_standard_list_item"),
        Index("ix_standard_list_items_list", "list_id"),
    )

    id: Mapped[int] = _pk("standard_list_items")
    list_id: Mapped[int] = _fk("standard_lists.id", ondelete="CASCADE")
    item_id: Mapped[int] = _fk("items.id", ondelete="RESTRICT")
    unit_id: Mapped[int] = _fk("units.id", ondelete="RESTRICT")
    quantity: Mapped[Decimal] = mapped_column(Qty, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)

    standard_list: Mapped[StandardList] = relationship(back_populates="items")
    item: Mapped[Item] = relationship()
    unit: Mapped[Unit] = relationship()


# ---------------------------------------------------------------------------
# products and recipes
# ---------------------------------------------------------------------------
class Product(Base):
    __tablename__ = "products"
    __table_args__ = (CheckConstraint("selling_price >= 0", name="ck_product_price"),)

    id: Mapped[int] = _pk("products")
    sku: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    category_id: Mapped[int | None] = _fk("categories.id", ondelete="SET NULL")
    unit_id: Mapped[int] = _fk("units.id", ondelete="RESTRICT")
    selling_price: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_by: Mapped[int | None] = _fk("users.id", ondelete="SET NULL")
    created_at: Mapped[datetime] = _now()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    unit: Mapped[Unit] = relationship()
    category: Mapped[Category | None] = relationship()
    recipes: Mapped[list[Recipe]] = relationship(
        back_populates="product", cascade="all, delete-orphan"
    )


class Recipe(Base):
    """``active_key`` is TRUE for the live version, NULL for superseded ones."""

    __tablename__ = "recipes"
    __table_args__ = (
        UniqueConstraint("product_id", "version", name="uq_recipe_version"),
        UniqueConstraint("product_id", "active_key", name="uq_recipe_active"),
        CheckConstraint("yield_quantity > 0", name="ck_recipe_yield"),
    )

    id: Mapped[int] = _pk("recipes")
    product_id: Mapped[int] = _fk("products.id", ondelete="CASCADE")
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    yield_quantity: Mapped[Decimal] = mapped_column(Qty, default=Decimal("1"), nullable=False)
    yield_unit_id: Mapped[int] = _fk("units.id", ondelete="RESTRICT")
    prep_time_mins: Mapped[int | None] = mapped_column(Integer)
    instructions: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    active_key: Mapped[bool | None] = mapped_column(Boolean, default=True)
    created_by: Mapped[int | None] = _fk("users.id", ondelete="SET NULL")
    created_at: Mapped[datetime] = _now()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    product: Mapped[Product] = relationship(back_populates="recipes")
    yield_unit: Mapped[Unit] = relationship()
    creator: Mapped[User | None] = relationship()
    ingredients: Mapped[list[RecipeIngredient]] = relationship(
        back_populates="recipe", cascade="all, delete-orphan"
    )

    def activate(self) -> None:
        self.is_active = True
        self.active_key = True

    def deactivate(self) -> None:
        self.is_active = False
        self.active_key = None


class RecipeIngredient(Base):
    __tablename__ = "recipe_ingredients"
    __table_args__ = (
        UniqueConstraint("recipe_id", "item_id", name="uq_recipe_ingredient"),
        CheckConstraint("quantity > 0", name="ck_ingredient_quantity"),
        CheckConstraint("base_quantity > 0", name="ck_ingredient_base_quantity"),
        Index("ix_recipe_ingredients_recipe", "recipe_id"),
    )

    id: Mapped[int] = _pk("recipe_ingredients")
    recipe_id: Mapped[int] = _fk("recipes.id", ondelete="CASCADE")
    item_id: Mapped[int] = _fk("items.id", ondelete="RESTRICT")
    quantity: Mapped[Decimal] = mapped_column(Qty, nullable=False)
    unit_id: Mapped[int] = _fk("units.id", ondelete="RESTRICT")
    base_quantity: Mapped[Decimal] = mapped_column(Qty, nullable=False)
    is_optional: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)

    recipe: Mapped[Recipe] = relationship(back_populates="ingredients")
    item: Mapped[Item] = relationship()
    unit: Mapped[Unit] = relationship()


# ---------------------------------------------------------------------------
# production
# ---------------------------------------------------------------------------
class ProductionRecord(Base):
    __tablename__ = "production_records"
    __table_args__ = (
        CheckConstraint("batch_quantity > 0", name="ck_production_batches"),
        CheckConstraint("output_quantity > 0", name="ck_production_output"),
        Index("ix_production_kitchen_time", "kitchen_id", "produced_at"),
    )

    id: Mapped[int] = _pk("production_records")
    production_no: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    kitchen_id: Mapped[int] = _fk("kitchens.id", ondelete="RESTRICT")
    product_id: Mapped[int] = _fk("products.id", ondelete="RESTRICT")
    recipe_id: Mapped[int] = _fk("recipes.id", ondelete="RESTRICT")
    batch_quantity: Mapped[Decimal] = mapped_column(Numeric(18, 6), nullable=False)
    output_quantity: Mapped[Decimal] = mapped_column(Qty, nullable=False)
    output_unit_id: Mapped[int] = _fk("units.id", ondelete="RESTRICT")
    status: Mapped[str] = mapped_column(String(16), default="COMPLETED", nullable=False)
    total_cost: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"), nullable=False)
    produced_at: Mapped[datetime] = _now()
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[int | None] = _fk("users.id", ondelete="SET NULL")
    created_at: Mapped[datetime] = _now()

    kitchen: Mapped[Kitchen] = relationship()
    product: Mapped[Product] = relationship()
    recipe: Mapped[Recipe] = relationship()
    output_unit: Mapped[Unit] = relationship()
    creator: Mapped[User | None] = relationship()
    consumption: Mapped[list[ConsumptionRecord]] = relationship(
        back_populates="production", cascade="all, delete-orphan"
    )


class ConsumptionRecord(Base):
    """One row per ingredient per run: every item is tracked separately."""

    __tablename__ = "consumption_records"
    __table_args__ = (
        CheckConstraint("required_quantity > 0", name="ck_consumption_required"),
        CheckConstraint("consumed_quantity > 0", name="ck_consumption_consumed"),
        Index("ix_consumption_production", "production_id"),
        Index("ix_consumption_item_time", "item_id", "created_at"),
    )

    id: Mapped[int] = _pk("consumption_records")
    production_id: Mapped[int] = _fk("production_records.id", ondelete="CASCADE")
    kitchen_id: Mapped[int] = _fk("kitchens.id", ondelete="RESTRICT")
    item_id: Mapped[int] = _fk("items.id", ondelete="RESTRICT")
    required_quantity: Mapped[Decimal] = mapped_column(Qty, nullable=False)
    consumed_quantity: Mapped[Decimal] = mapped_column(Qty, nullable=False)
    unit_id: Mapped[int] = _fk("units.id", ondelete="RESTRICT")
    balance_after: Mapped[Decimal] = mapped_column(Qty, nullable=False)
    unit_cost: Mapped[Decimal] = mapped_column(Rate, default=Decimal("0"), nullable=False)
    total_cost: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"), nullable=False)
    created_at: Mapped[datetime] = _now()

    production: Mapped[ProductionRecord] = relationship(back_populates="consumption")
    item: Mapped[Item] = relationship()
    unit: Mapped[Unit] = relationship()


# ---------------------------------------------------------------------------
# wastage and adjustments
# ---------------------------------------------------------------------------
class WastageRecord(Base):
    __tablename__ = "wastage_records"
    __table_args__ = (
        CheckConstraint(_in("location_type", LocationType), name="ck_wastage_location"),
        CheckConstraint(_in("reason_code", WastageReason), name="ck_wastage_reason"),
        CheckConstraint("quantity > 0", name="ck_wastage_quantity"),
        CheckConstraint("base_quantity > 0", name="ck_wastage_base_quantity"),
        CheckConstraint(
            "(location_type = 'MAIN' AND kitchen_id IS NULL) "
            "OR (location_type = 'KITCHEN' AND kitchen_id IS NOT NULL)",
            name="ck_wastage_kitchen_presence",
        ),
        Index("ix_wastage_kitchen_time", "kitchen_id", "recorded_at"),
    )

    id: Mapped[int] = _pk("wastage_records")
    wastage_no: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    location_type: Mapped[str] = mapped_column(String(10), nullable=False)
    kitchen_id: Mapped[int | None] = _fk("kitchens.id", ondelete="RESTRICT")
    item_id: Mapped[int] = _fk("items.id", ondelete="RESTRICT")
    quantity: Mapped[Decimal] = mapped_column(Qty, nullable=False)
    unit_id: Mapped[int] = _fk("units.id", ondelete="RESTRICT")
    base_quantity: Mapped[Decimal] = mapped_column(Qty, nullable=False)
    reason_code: Mapped[str] = mapped_column(String(24), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text)
    estimated_cost: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"), nullable=False)
    recorded_at: Mapped[datetime] = _now()
    recorded_by: Mapped[int | None] = _fk("users.id", ondelete="SET NULL")
    created_at: Mapped[datetime] = _now()

    kitchen: Mapped[Kitchen | None] = relationship()
    item: Mapped[Item] = relationship()
    unit: Mapped[Unit] = relationship()
    recorder: Mapped[User | None] = relationship()


class InventoryAdjustment(Base):
    __tablename__ = "inventory_adjustments"
    __table_args__ = (
        CheckConstraint(_in("location_type", LocationType), name="ck_adjustment_location"),
        CheckConstraint(_in("reason_code", AdjustmentReason), name="ck_adjustment_reason"),
        CheckConstraint(
            "adjustment_type IN ('INCREASE', 'DECREASE')", name="ck_adjustment_type"
        ),
        CheckConstraint("previous_quantity >= 0", name="ck_adjustment_previous"),
        CheckConstraint("new_quantity >= 0", name="ck_adjustment_new"),
        CheckConstraint(
            "(location_type = 'MAIN' AND kitchen_id IS NULL) "
            "OR (location_type = 'KITCHEN' AND kitchen_id IS NOT NULL)",
            name="ck_adjustment_kitchen_presence",
        ),
        Index("ix_adjustment_kitchen_time", "kitchen_id", "adjusted_at"),
    )

    id: Mapped[int] = _pk("inventory_adjustments")
    adjustment_no: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    location_type: Mapped[str] = mapped_column(String(10), nullable=False)
    kitchen_id: Mapped[int | None] = _fk("kitchens.id", ondelete="RESTRICT")
    item_id: Mapped[int] = _fk("items.id", ondelete="RESTRICT")
    previous_quantity: Mapped[Decimal] = mapped_column(Qty, nullable=False)
    new_quantity: Mapped[Decimal] = mapped_column(Qty, nullable=False)
    difference: Mapped[Decimal] = mapped_column(Qty, nullable=False)
    adjustment_type: Mapped[str] = mapped_column(String(10), nullable=False)
    reason_code: Mapped[str] = mapped_column(String(24), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text)
    adjusted_at: Mapped[datetime] = _now()
    created_by: Mapped[int | None] = _fk("users.id", ondelete="SET NULL")
    created_at: Mapped[datetime] = _now()

    kitchen: Mapped[Kitchen | None] = relationship()
    item: Mapped[Item] = relationship()
    creator: Mapped[User | None] = relationship()


# ---------------------------------------------------------------------------
# audit and documents
# ---------------------------------------------------------------------------
class AuditLog(Base):
    __tablename__ = "audit_logs"
    __table_args__ = (
        CheckConstraint("status IN ('SUCCESS', 'FAILURE')", name="ck_audit_status"),
        Index("ix_audit_user_time", "user_id", "created_at"),
        Index("ix_audit_entity", "entity_type", "entity_id"),
        Index("ix_audit_created", "created_at"),
    )

    id: Mapped[int] = _pk("audit_logs")
    user_id: Mapped[int | None] = _fk("users.id", ondelete="SET NULL")
    username: Mapped[str | None] = mapped_column(String(40))
    role_code: Mapped[str | None] = mapped_column(String(32))
    action: Mapped[str] = mapped_column(String(48), nullable=False)
    entity_type: Mapped[str | None] = mapped_column(String(32))
    entity_id: Mapped[int | None] = mapped_column(IdType)
    entity_label: Mapped[str | None] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    audit_metadata: Mapped[str | None] = mapped_column("metadata", Text)
    ip_address: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(10), default="SUCCESS", nullable=False)
    created_at: Mapped[datetime] = _now()

    user: Mapped[User | None] = relationship()


class DocumentPrint(Base):
    __tablename__ = "document_prints"
    __table_args__ = (
        CheckConstraint(
            "document_type IN ('TRANSFER', 'PRODUCTION', 'WASTAGE', 'RECEIPT', 'ADJUSTMENT')",
            name="ck_print_document_type",
        ),
        Index("ix_print_document", "document_type", "document_id"),
    )

    id: Mapped[int] = _pk("document_prints")
    document_type: Mapped[str] = mapped_column(String(16), nullable=False)
    document_id: Mapped[int] = mapped_column(IdType, nullable=False)
    document_no: Mapped[str] = mapped_column(String(32), nullable=False)
    kitchen_id: Mapped[int | None] = _fk("kitchens.id", ondelete="SET NULL")
    printed_by: Mapped[int | None] = _fk("users.id", ondelete="SET NULL")
    printed_at: Mapped[datetime] = _now()


class DocumentSequence(Base):
    """Document numbering (TRF-00001, PRD-00001, ...).

    Named to avoid shadowing SQLAlchemy's ``Sequence``, which backs the
    primary keys above.
    """

    __tablename__ = "doc_sequences"

    name: Mapped[str] = mapped_column(String(32), primary_key=True)
    prefix: Mapped[str] = mapped_column(String(8), nullable=False)
    next_value: Mapped[int] = mapped_column(BigInteger, default=1, nullable=False)
    padding: Mapped[int] = mapped_column(Integer, default=5, nullable=False)


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
