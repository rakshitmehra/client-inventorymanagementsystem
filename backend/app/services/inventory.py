"""
The stock engine.

Every change to any balance - main or kitchen - goes through apply_movement().
It is the only function in the system that writes to main_inventory or
kitchen_inventory, and it always writes a matching stock_movements row in the
same transaction.

Balance rows are read with SELECT ... FOR UPDATE, so two kitchens drawing on the
same Main Inventory line serialise against each other instead of both reading a
stale quantity. On CockroachDB a conflicting transaction surfaces as a 40001
retry error, which run_in_transaction() replays.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..errors import InsufficientStockError, bad_request, not_found
from ..models import (
    CounterpartyType,
    Direction,
    Item,
    Kitchen,
    KitchenInventory,
    LocationType,
    MainInventory,
    MovementType,
    StockMovement,
)
from ..security import D, money, q, rate
from .numbering import next_number

MAIN = LocationType.MAIN.value
KITCHEN = LocationType.KITCHEN.value

# Tolerance for comparing quantised decimals.
EPSILON = Decimal("0.00005")


def get_item(db: Session, item_id: int) -> Item:
    item = db.get(Item, item_id)
    if item is None:
        raise not_found(f"Item {item_id}")
    return item


def ensure_balance_row(
    db: Session, location_type: str, kitchen_id: int | None, item_id: int, *, lock: bool = False
):
    """Make sure a balance row exists for this location/item pair, then return it."""
    if location_type == MAIN:
        stmt = select(MainInventory).where(MainInventory.item_id == item_id)
        if lock:
            stmt = stmt.with_for_update()
        row = db.execute(stmt).scalar_one_or_none()
        if row is None:
            row = MainInventory(item_id=item_id, quantity=Decimal("0"))
            db.add(row)
            db.flush()
        return row

    kitchen = db.get(Kitchen, kitchen_id)
    if kitchen is None:
        raise not_found(f"Kitchen {kitchen_id}")

    stmt = select(KitchenInventory).where(
        KitchenInventory.kitchen_id == kitchen_id, KitchenInventory.item_id == item_id
    )
    if lock:
        stmt = stmt.with_for_update()
    row = db.execute(stmt).scalar_one_or_none()
    if row is None:
        item = get_item(db, item_id)
        row = KitchenInventory(
            kitchen_id=kitchen_id,
            item_id=item_id,
            quantity=Decimal("0"),
            min_stock_level=item.min_stock_level or Decimal("0"),
        )
        db.add(row)
        db.flush()
    return row


def get_balance(db: Session, location_type: str, kitchen_id: int | None, item_id: int) -> Decimal:
    """Current quantity on hand at a location, in the item's stocking unit."""
    if location_type == MAIN:
        value = db.execute(
            select(MainInventory.quantity).where(MainInventory.item_id == item_id)
        ).scalar_one_or_none()
    else:
        value = db.execute(
            select(KitchenInventory.quantity).where(
                KitchenInventory.kitchen_id == kitchen_id,
                KitchenInventory.item_id == item_id,
            )
        ).scalar_one_or_none()
    return q(value or 0)


def find_shortages(
    db: Session, location_type: str, kitchen_id: int | None, lines: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """
    Check a batch of requirements against a location before touching anything.
    Returns the list of shortages, empty when everything is available.
    """
    shortages: list[dict[str, Any]] = []
    for line in lines:
        item = get_item(db, line["item_id"])
        available = get_balance(db, location_type, kitchen_id, item.id)
        required = q(line["quantity"])
        if available + EPSILON < required:
            shortages.append(
                {
                    "item_id": item.id,
                    "item_name": item.name,
                    "sku": item.sku,
                    "unit_code": item.unit.code,
                    "required": float(required),
                    "available": float(available),
                    "shortfall": float(q(required - available)),
                }
            )
    return shortages


def apply_movement(
    db: Session,
    *,
    item_id: int,
    quantity,
    direction: str,
    movement_type: str,
    location_type: str,
    kitchen_id: int | None = None,
    counterparty_type: str,
    counterparty_kitchen_id: int | None = None,
    counterparty_supplier_id: int | None = None,
    counterparty_label: str | None = None,
    reference_type: str | None = None,
    reference_id: int | None = None,
    reference_no: str | None = None,
    unit_cost=Decimal("0"),
    notes: str | None = None,
    performed_by: int | None = None,
) -> StockMovement:
    """
    Move stock in or out of a single location and record it in the ledger.
    Must run inside a transaction.
    """
    amount = q(quantity)
    if amount <= 0:
        raise bad_request("Movement quantity must be greater than zero")
    if location_type == KITCHEN and not kitchen_id:
        raise bad_request("A kitchen must be supplied for a kitchen movement")

    item = get_item(db, item_id)
    row = ensure_balance_row(db, location_type, kitchen_id, item_id, lock=True)

    before = q(row.quantity)
    after = q(before + amount) if direction == Direction.IN.value else q(before - amount)

    if after < 0:
        raise InsufficientStockError(
            [
                {
                    "item_id": item.id,
                    "item_name": item.name,
                    "sku": item.sku,
                    "unit_code": item.unit.code,
                    "required": float(amount),
                    "available": float(before),
                    "shortfall": float(q(amount - before)),
                }
            ]
        )

    row.quantity = after
    db.flush()

    cost = rate(unit_cost or 0)
    movement = StockMovement(
        movement_no=next_number(db, "MOVEMENT"),
        movement_type=movement_type,
        direction=direction,
        item_id=item.id,
        quantity=amount,
        location_type=location_type,
        kitchen_id=kitchen_id if location_type == KITCHEN else None,
        balance_before=before,
        balance_after=after,
        counterparty_type=counterparty_type,
        counterparty_kitchen_id=counterparty_kitchen_id,
        counterparty_supplier_id=counterparty_supplier_id,
        counterparty_label=counterparty_label,
        reference_type=reference_type,
        reference_id=reference_id,
        reference_no=reference_no,
        unit_cost=cost,
        total_cost=money(D(cost) * amount),
        notes=notes,
        performed_by=performed_by,
    )
    db.add(movement)
    db.flush()
    return movement


def item_stock_breakdown(db: Session, item_id: int) -> dict[str, Any]:
    """Stock on hand for an item across the main store and every kitchen."""
    main = get_balance(db, MAIN, None, item_id)

    rows = db.execute(
        select(
            Kitchen.id,
            Kitchen.name,
            Kitchen.code,
            KitchenInventory.quantity,
            KitchenInventory.min_stock_level,
        )
        .join(KitchenInventory, KitchenInventory.kitchen_id == Kitchen.id)
        .where(KitchenInventory.item_id == item_id)
        .order_by(Kitchen.name)
    ).all()

    kitchens = [
        {
            "kitchen_id": r.id,
            "kitchen_name": r.name,
            "kitchen_code": r.code,
            "quantity": float(q(r.quantity)),
            "min_stock_level": float(q(r.min_stock_level)),
        }
        for r in rows
    ]
    kitchen_total = q(sum((D(r.quantity) for r in rows), Decimal("0")))

    return {
        "main_quantity": float(main),
        "kitchen_quantity": float(kitchen_total),
        "total_quantity": float(q(main + kitchen_total)),
        "kitchens": kitchens,
    }


__all__ = [
    "MAIN",
    "KITCHEN",
    "MovementType",
    "Direction",
    "CounterpartyType",
    "apply_movement",
    "ensure_balance_row",
    "find_shortages",
    "get_balance",
    "get_item",
    "item_stock_breakdown",
]
