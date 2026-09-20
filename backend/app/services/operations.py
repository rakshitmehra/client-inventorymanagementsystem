"""
Business transactions built on top of the stock engine.

Each public function here is one complete, atomic operation: it validates
everything up front, then writes the document, its line items and the ledger
entries in a single transaction. If any line fails, nothing is written.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..deps import CurrentUser
from ..errors import InsufficientStockError, bad_request, conflict, not_found
from ..models import (
    ConsumptionRecord,
    CounterpartyType,
    Direction,
    InventoryAdjustment,
    InventoryTransfer,
    InventoryTransferItem,
    Item,
    Kitchen,
    MovementType,
    Product,
    ProductionRecord,
    Recipe,
    RecipeIngredient,
    StockReceipt,
    StockReceiptItem,
    Supplier,
    Unit,
    WastageRecord,
)
from ..security import D, money, q, rate
from .inventory import (
    EPSILON,
    KITCHEN,
    MAIN,
    apply_movement,
    ensure_balance_row,
    find_shortages,
    get_balance,
    get_item,
)
from .numbering import next_number
from .units import convert, to_item_unit


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def location_label(db: Session, location_type: str, kitchen_id: int | None) -> str:
    if location_type == MAIN:
        return "Main Inventory"
    kitchen = db.get(Kitchen, kitchen_id)
    return kitchen.name if kitchen else f"Kitchen {kitchen_id}"


def require_active_kitchen(db: Session, kitchen_id: int | None) -> Kitchen:
    kitchen = db.get(Kitchen, kitchen_id)
    if kitchen is None:
        raise not_found(f"Kitchen {kitchen_id}")
    if not kitchen.is_active:
        raise conflict(
            f"{kitchen.name} is deactivated and cannot take part in stock operations"
        )
    return kitchen


@dataclass
class PreparedLine:
    item: Item
    quantity: Decimal
    unit_id: int
    base_quantity: Decimal
    unit_cost: Decimal
    total_cost: Decimal
    batch_no: str | None = None
    expiry_date: str | None = None
    notes: str | None = None

    @property
    def item_id(self) -> int:
        return self.item.id


def prepare_lines(db: Session, lines: list[Any], *, allow_cost: bool = True) -> list[PreparedLine]:
    """
    Normalise incoming document lines: resolve the item, convert the entered
    quantity into the item's stocking unit, and merge duplicate item rows so a
    document can never contain the same item twice with conflicting amounts.
    """
    if not lines:
        raise bad_request("Add at least one item")

    merged: dict[int, PreparedLine] = {}

    for index, line in enumerate(lines, start=1):
        data = line if isinstance(line, dict) else line.model_dump()

        item_id = data.get("item_id")
        if item_id is None:
            raise bad_request(f"Line {index}: choose an item")

        item = get_item(db, int(item_id))
        if not item.is_active:
            raise bad_request(f"{item.name} is archived and cannot be used")

        quantity = D(data.get("quantity"))
        if quantity <= 0:
            raise bad_request(f"Line {index} ({item.name}): quantity must be greater than zero")

        base_quantity, entered_unit_id = to_item_unit(db, quantity, data.get("unit_id"), item)

        raw_cost = data.get("unit_cost")
        unit_cost = rate(raw_cost) if (allow_cost and raw_cost is not None) else rate(item.unit_cost)
        if unit_cost < 0:
            raise bad_request(f"Line {index} ({item.name}): unit cost is not valid")

        existing = merged.get(item.id)
        if existing is not None:
            # Same item twice - only mergeable when entered in the same unit.
            if existing.unit_id != entered_unit_id:
                raise bad_request(f"{item.name} appears more than once with different units")
            existing.quantity = q(existing.quantity + quantity)
            existing.base_quantity = q(existing.base_quantity + base_quantity)
            existing.total_cost = money(existing.unit_cost * existing.base_quantity)
        else:
            merged[item.id] = PreparedLine(
                item=item,
                quantity=q(quantity),
                unit_id=entered_unit_id,
                base_quantity=base_quantity,
                unit_cost=unit_cost,
                total_cost=money(unit_cost * base_quantity),
                batch_no=data.get("batch_no"),
                expiry_date=data.get("expiry_date"),
                notes=data.get("notes"),
            )

    return list(merged.values())


def _timestamp(value) -> datetime | None:
    """Accept an ISO string or datetime for a back-dated document."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value
    text = str(value).strip().replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        try:
            return datetime.fromisoformat(text[:10])
        except ValueError as exc:
            raise bad_request(f"'{value}' is not a valid date") from exc


# ---------------------------------------------------------------------------
# 1. Goods receipt - stock arriving from a supplier into the Main Inventory
# ---------------------------------------------------------------------------
def receive_stock(db: Session, payload: Any, user: CurrentUser) -> dict[str, Any]:
    data = payload if isinstance(payload, dict) else payload.model_dump()
    lines = prepare_lines(db, data.get("items") or [])

    supplier_id = data.get("supplier_id")
    supplier: Supplier | None = None
    if supplier_id:
        supplier = db.get(Supplier, int(supplier_id))
        if supplier is None:
            raise not_found(f"Supplier {supplier_id}")

    receipt_no = next_number(db, "RECEIPT")
    total_cost = money(sum((line.total_cost for line in lines), Decimal("0")))

    receipt = StockReceipt(
        receipt_no=receipt_no,
        supplier_id=supplier.id if supplier else None,
        invoice_no=data.get("invoice_no"),
        total_items=len(lines),
        total_cost=total_cost,
        notes=data.get("notes"),
        created_by=user.id,
    )
    received_at = _timestamp(data.get("received_at"))
    if received_at:
        receipt.received_at = received_at
    db.add(receipt)
    db.flush()

    for line in lines:
        db.add(
            StockReceiptItem(
                receipt_id=receipt.id,
                item_id=line.item_id,
                quantity=line.quantity,
                unit_id=line.unit_id,
                base_quantity=line.base_quantity,
                unit_cost=line.unit_cost,
                total_cost=line.total_cost,
                batch_no=line.batch_no,
                expiry_date=line.expiry_date,
                notes=line.notes,
            )
        )

        movement = apply_movement(
            db,
            item_id=line.item_id,
            quantity=line.base_quantity,
            direction=Direction.IN.value,
            movement_type=MovementType.PURCHASE_RECEIPT.value,
            location_type=MAIN,
            counterparty_type=CounterpartyType.SUPPLIER.value,
            counterparty_supplier_id=supplier.id if supplier else None,
            counterparty_label=supplier.name if supplier else "External supplier",
            reference_type="RECEIPT",
            reference_id=receipt.id,
            reference_no=receipt_no,
            unit_cost=line.unit_cost,
            notes=line.notes,
            performed_by=user.id,
        )
        if received_at:
            movement.created_at = received_at

        # Keep the item's standard cost aligned with the latest purchase price.
        if line.unit_cost > 0:
            line.item.unit_cost = line.unit_cost

    db.flush()
    return {
        "id": receipt.id,
        "receipt_no": receipt_no,
        "total_items": len(lines),
        "total_cost": float(total_cost),
    }


# ---------------------------------------------------------------------------
# 2. Transfer - Main Inventory to a kitchen, or a kitchen back to Main
# ---------------------------------------------------------------------------
def create_transfer(db: Session, payload: Any, user: CurrentUser) -> dict[str, Any]:
    data = payload if isinstance(payload, dict) else payload.model_dump()

    from_type = KITCHEN if data.get("from_location_type") == KITCHEN else MAIN
    to_type = KITCHEN if data.get("to_location_type") == KITCHEN else MAIN
    from_kitchen_id = int(data["from_kitchen_id"]) if from_type == KITCHEN and data.get("from_kitchen_id") else None
    to_kitchen_id = int(data["to_kitchen_id"]) if to_type == KITCHEN and data.get("to_kitchen_id") else None

    if from_type == MAIN and to_type == MAIN:
        raise bad_request("A transfer must involve at least one kitchen")
    if from_type == to_type and from_kitchen_id == to_kitchen_id:
        raise bad_request("The source and destination must be different")
    if from_type == KITCHEN:
        require_active_kitchen(db, from_kitchen_id)
    if to_type == KITCHEN:
        require_active_kitchen(db, to_kitchen_id)

    lines = prepare_lines(db, data.get("items") or [])

    # Check every line before moving anything, so a partly-filled transfer is
    # never written - the caller gets one complete list of what is short.
    shortages = find_shortages(
        db,
        from_type,
        from_kitchen_id,
        [{"item_id": line.item_id, "quantity": line.base_quantity} for line in lines],
    )
    if shortages:
        raise InsufficientStockError(shortages)

    transfer_no = next_number(db, "TRANSFER")
    total_cost = money(sum((line.total_cost for line in lines), Decimal("0")))
    from_label = location_label(db, from_type, from_kitchen_id)
    to_label = location_label(db, to_type, to_kitchen_id)

    transfer = InventoryTransfer(
        transfer_no=transfer_no,
        from_location_type=from_type,
        from_kitchen_id=from_kitchen_id,
        to_location_type=to_type,
        to_kitchen_id=to_kitchen_id,
        status="COMPLETED",
        total_items=len(lines),
        total_cost=total_cost,
        notes=data.get("notes"),
        created_by=user.id,
    )
    transfer_date = _timestamp(data.get("transfer_date"))
    if transfer_date:
        transfer.transfer_date = transfer_date
    db.add(transfer)
    db.flush()

    for line in lines:
        db.add(
            InventoryTransferItem(
                transfer_id=transfer.id,
                item_id=line.item_id,
                quantity=line.quantity,
                unit_id=line.unit_id,
                base_quantity=line.base_quantity,
                unit_cost=line.unit_cost,
                total_cost=line.total_cost,
                notes=line.notes,
            )
        )

        # Out of the source ...
        out_movement = apply_movement(
            db,
            item_id=line.item_id,
            quantity=line.base_quantity,
            direction=Direction.OUT.value,
            movement_type=MovementType.TRANSFER_OUT.value,
            location_type=from_type,
            kitchen_id=from_kitchen_id,
            counterparty_type=to_type,
            counterparty_kitchen_id=to_kitchen_id,
            counterparty_label=to_label,
            reference_type="TRANSFER",
            reference_id=transfer.id,
            reference_no=transfer_no,
            unit_cost=line.unit_cost,
            notes=line.notes,
            performed_by=user.id,
        )

        # ... and into the destination, as a separate ledger row.
        in_movement = apply_movement(
            db,
            item_id=line.item_id,
            quantity=line.base_quantity,
            direction=Direction.IN.value,
            movement_type=MovementType.TRANSFER_IN.value,
            location_type=to_type,
            kitchen_id=to_kitchen_id,
            counterparty_type=from_type,
            counterparty_kitchen_id=from_kitchen_id,
            counterparty_label=from_label,
            reference_type="TRANSFER",
            reference_id=transfer.id,
            reference_no=transfer_no,
            unit_cost=line.unit_cost,
            notes=line.notes,
            performed_by=user.id,
        )

        if transfer_date:
            out_movement.created_at = transfer_date
            in_movement.created_at = transfer_date

    db.flush()
    return {
        "id": transfer.id,
        "transfer_no": transfer_no,
        "total_items": len(lines),
        "total_cost": float(total_cost),
        "from_label": from_label,
        "to_label": to_label,
    }


# ---------------------------------------------------------------------------
# 3. Production - scale a recipe, check the kitchen, consume every ingredient
# ---------------------------------------------------------------------------
def resolve_recipe(db: Session, product_id: int, recipe_id: int | None) -> Recipe:
    if recipe_id:
        recipe = db.execute(
            select(Recipe).where(Recipe.id == recipe_id, Recipe.product_id == product_id)
        ).scalar_one_or_none()
    else:
        recipe = db.execute(
            select(Recipe).where(Recipe.product_id == product_id, Recipe.is_active.is_(True))
        ).scalar_one_or_none()

    if recipe is None:
        raise bad_request(
            "This product has no active recipe. Add one before recording production."
        )
    return recipe


def preview_production(db: Session, payload: Any) -> dict[str, Any]:
    """
    Work out what a production run needs and whether the kitchen can cover it.
    Pure read - nothing is written, so the UI can call it as the user types.
    """
    data = payload if isinstance(payload, dict) else payload.model_dump()

    kitchen = require_active_kitchen(db, int(data["kitchen_id"]))
    product = db.get(Product, int(data["product_id"]))
    if product is None:
        raise not_found(f"Product {data['product_id']}")
    if not product.is_active:
        raise bad_request(f"{product.name} is archived")

    recipe = resolve_recipe(db, product.id, data.get("recipe_id"))

    output_quantity = D(data.get("output_quantity"))
    if output_quantity <= 0:
        raise bad_request("Enter how many units you are producing")

    # How many times the recipe is being run.
    batches = D(output_quantity) / D(recipe.yield_quantity)

    ingredients = db.execute(
        select(RecipeIngredient)
        .where(RecipeIngredient.recipe_id == recipe.id)
        .order_by(RecipeIngredient.sort_order, RecipeIngredient.id)
    ).scalars().all()

    if not ingredients:
        raise bad_request(f'Recipe "{recipe.name}" has no ingredients')

    requirements: list[dict[str, Any]] = []
    total_cost = Decimal("0")

    for ingredient in ingredients:
        item = ingredient.item
        required = q(D(ingredient.base_quantity) * batches)
        available = get_balance(db, KITCHEN, kitchen.id, item.id)
        line_cost = money(required * D(item.unit_cost))
        total_cost += line_cost
        sufficient = available + EPSILON >= required

        requirements.append(
            {
                "item_id": item.id,
                "item_name": item.name,
                "sku": item.sku,
                "unit_code": item.unit.code,
                "unit_id": item.unit_id,
                "per_batch_quantity": float(q(ingredient.base_quantity)),
                "recipe_quantity": float(q(ingredient.quantity)),
                "recipe_unit_code": ingredient.unit.code,
                "required_quantity": float(required),
                "available_quantity": float(available),
                "remaining_after": float(q(available - required)),
                "shortfall": 0.0 if sufficient else float(q(required - available)),
                "is_sufficient": sufficient,
                "is_optional": ingredient.is_optional,
                "unit_cost": float(rate(item.unit_cost)),
                "total_cost": float(line_cost),
                "notes": ingredient.notes,
            }
        )

    shortages = [r for r in requirements if not r["is_sufficient"]]

    return {
        "kitchen": {"id": kitchen.id, "name": kitchen.name, "code": kitchen.code},
        "product": {
            "id": product.id,
            "name": product.name,
            "sku": product.sku,
            "unit_code": product.unit.code,
            "unit_id": product.unit_id,
        },
        "recipe": {
            "id": recipe.id,
            "name": recipe.name,
            "version": recipe.version,
            "yield_quantity": float(q(recipe.yield_quantity)),
            "instructions": recipe.instructions,
            "prep_time_mins": recipe.prep_time_mins,
        },
        "output_quantity": float(q(output_quantity)),
        "batch_quantity": float(round(batches, 6)),
        "requirements": requirements,
        "estimated_cost": float(money(total_cost)),
        "can_produce": not shortages,
        "shortages": shortages,
    }


def execute_production(db: Session, payload: Any, user: CurrentUser) -> dict[str, Any]:
    """Commit a production run: deduct each ingredient and record it separately."""
    data = payload if isinstance(payload, dict) else payload.model_dump()
    preview = preview_production(db, data)

    if not preview["can_produce"]:
        raise InsufficientStockError(
            [
                {
                    "item_id": s["item_id"],
                    "item_name": s["item_name"],
                    "sku": s["sku"],
                    "unit_code": s["unit_code"],
                    "required": s["required_quantity"],
                    "available": s["available_quantity"],
                    "shortfall": s["shortfall"],
                }
                for s in preview["shortages"]
            ]
        )

    production_no = next_number(db, "PRODUCTION")

    record = ProductionRecord(
        production_no=production_no,
        kitchen_id=preview["kitchen"]["id"],
        product_id=preview["product"]["id"],
        recipe_id=preview["recipe"]["id"],
        batch_quantity=D(preview["batch_quantity"]),
        output_quantity=q(preview["output_quantity"]),
        output_unit_id=preview["product"]["unit_id"],
        status="COMPLETED",
        total_cost=money(preview["estimated_cost"]),
        notes=data.get("notes"),
        created_by=user.id,
    )
    produced_at = _timestamp(data.get("produced_at"))
    if produced_at:
        record.produced_at = produced_at
    db.add(record)
    db.flush()

    # One deduction and one consumption row per ingredient - the finished
    # product is never recorded as a single opaque line.
    for requirement in preview["requirements"]:
        movement = apply_movement(
            db,
            item_id=requirement["item_id"],
            quantity=requirement["required_quantity"],
            direction=Direction.OUT.value,
            movement_type=MovementType.PRODUCTION_CONSUMPTION.value,
            location_type=KITCHEN,
            kitchen_id=preview["kitchen"]["id"],
            counterparty_type=CounterpartyType.PRODUCTION.value,
            counterparty_label=f"{preview['product']['name']} x {preview['output_quantity']}",
            reference_type="PRODUCTION",
            reference_id=record.id,
            reference_no=production_no,
            unit_cost=requirement["unit_cost"],
            notes=data.get("notes"),
            performed_by=user.id,
        )
        if produced_at:
            movement.created_at = produced_at

        consumption = ConsumptionRecord(
            production_id=record.id,
            kitchen_id=preview["kitchen"]["id"],
            item_id=requirement["item_id"],
            required_quantity=q(requirement["required_quantity"]),
            consumed_quantity=q(requirement["required_quantity"]),
            unit_id=requirement["unit_id"],
            balance_after=movement.balance_after,
            unit_cost=rate(requirement["unit_cost"]),
            total_cost=money(requirement["total_cost"]),
        )
        if produced_at:
            consumption.created_at = produced_at
        db.add(consumption)

    db.flush()
    return {
        "id": record.id,
        "production_no": production_no,
        "output_quantity": preview["output_quantity"],
        "total_cost": preview["estimated_cost"],
        "ingredients_consumed": len(preview["requirements"]),
    }


# ---------------------------------------------------------------------------
# 4. Wastage
# ---------------------------------------------------------------------------
def record_wastage(db: Session, payload: Any, user: CurrentUser) -> dict[str, Any]:
    data = payload if isinstance(payload, dict) else payload.model_dump()

    location_type = KITCHEN if data.get("location_type") == KITCHEN else MAIN
    kitchen_id = int(data["kitchen_id"]) if location_type == KITCHEN and data.get("kitchen_id") else None
    if location_type == KITCHEN:
        require_active_kitchen(db, kitchen_id)

    item = get_item(db, int(data["item_id"]))
    quantity = D(data.get("quantity"))
    if quantity <= 0:
        raise bad_request("Quantity must be greater than zero")

    base_quantity, entered_unit_id = to_item_unit(db, quantity, data.get("unit_id"), item)

    wastage_no = next_number(db, "WASTAGE")
    estimated_cost = money(base_quantity * D(item.unit_cost))

    record = WastageRecord(
        wastage_no=wastage_no,
        location_type=location_type,
        kitchen_id=kitchen_id,
        item_id=item.id,
        quantity=q(quantity),
        unit_id=entered_unit_id,
        base_quantity=base_quantity,
        reason_code=data["reason_code"],
        reason=data.get("reason"),
        estimated_cost=estimated_cost,
        recorded_by=user.id,
    )
    recorded_at = _timestamp(data.get("recorded_at"))
    if recorded_at:
        record.recorded_at = recorded_at
    db.add(record)
    db.flush()

    movement = apply_movement(
        db,
        item_id=item.id,
        quantity=base_quantity,
        direction=Direction.OUT.value,
        movement_type=MovementType.WASTAGE.value,
        location_type=location_type,
        kitchen_id=kitchen_id,
        counterparty_type=CounterpartyType.WASTAGE.value,
        counterparty_label=data["reason_code"],
        reference_type="WASTAGE",
        reference_id=record.id,
        reference_no=wastage_no,
        unit_cost=item.unit_cost,
        notes=data.get("reason"),
        performed_by=user.id,
    )
    if recorded_at:
        movement.created_at = recorded_at

    db.flush()
    return {
        "id": record.id,
        "wastage_no": wastage_no,
        "estimated_cost": float(estimated_cost),
    }


# ---------------------------------------------------------------------------
# 5. Adjustment - set a counted quantity, ledger the difference
# ---------------------------------------------------------------------------
def create_adjustment(db: Session, payload: Any, user: CurrentUser) -> dict[str, Any]:
    data = payload if isinstance(payload, dict) else payload.model_dump()

    location_type = KITCHEN if data.get("location_type") == KITCHEN else MAIN
    kitchen_id = int(data["kitchen_id"]) if location_type == KITCHEN and data.get("kitchen_id") else None
    if location_type == KITCHEN:
        require_active_kitchen(db, kitchen_id)

    item = get_item(db, int(data["item_id"]))
    new_quantity = D(data.get("new_quantity"))
    if new_quantity < 0:
        raise bad_request("The counted quantity cannot be negative")

    ensure_balance_row(db, location_type, kitchen_id, item.id, lock=True)
    previous = get_balance(db, location_type, kitchen_id, item.id)
    target = q(new_quantity)
    difference = q(target - previous)

    if difference == 0:
        raise bad_request(
            "The counted quantity matches the current stock - nothing to adjust"
        )

    adjustment_no = next_number(db, "ADJUSTMENT")
    adjustment_type = "INCREASE" if difference > 0 else "DECREASE"

    record = InventoryAdjustment(
        adjustment_no=adjustment_no,
        location_type=location_type,
        kitchen_id=kitchen_id,
        item_id=item.id,
        previous_quantity=previous,
        new_quantity=target,
        difference=difference,
        adjustment_type=adjustment_type,
        reason_code=data["reason_code"],
        reason=data.get("reason"),
        created_by=user.id,
    )
    adjusted_at = _timestamp(data.get("adjusted_at"))
    if adjusted_at:
        record.adjusted_at = adjusted_at
    db.add(record)
    db.flush()

    movement = apply_movement(
        db,
        item_id=item.id,
        quantity=abs(difference),
        direction=Direction.IN.value if difference > 0 else Direction.OUT.value,
        movement_type=(
            MovementType.ADJUSTMENT_INCREASE.value
            if difference > 0
            else MovementType.ADJUSTMENT_DECREASE.value
        ),
        location_type=location_type,
        kitchen_id=kitchen_id,
        counterparty_type=CounterpartyType.ADJUSTMENT.value,
        counterparty_label=data["reason_code"],
        reference_type="ADJUSTMENT",
        reference_id=record.id,
        reference_no=adjustment_no,
        unit_cost=item.unit_cost,
        notes=data.get("reason"),
        performed_by=user.id,
    )
    if adjusted_at:
        movement.created_at = adjusted_at

    db.flush()
    return {
        "id": record.id,
        "adjustment_no": adjustment_no,
        "previous_quantity": float(previous),
        "new_quantity": float(target),
        "difference": float(difference),
        "adjustment_type": adjustment_type,
    }


# ---------------------------------------------------------------------------
# recipes
# ---------------------------------------------------------------------------
def prepare_ingredients(db: Session, lines: list[Any]) -> list[dict[str, Any]]:
    """Validate and normalise ingredient lines into the item's stocking unit."""
    if not lines:
        raise bad_request("A recipe needs at least one ingredient")

    seen: set[int] = set()
    prepared: list[dict[str, Any]] = []

    for index, line in enumerate(lines):
        data = line if isinstance(line, dict) else line.model_dump()
        item_id = data.get("item_id")
        if item_id is None:
            raise bad_request(f"Ingredient {index + 1}: choose an item")
        item_id = int(item_id)

        item = get_item(db, item_id)
        if item_id in seen:
            raise bad_request(
                f'"{item.name}" is listed more than once - combine the quantities'
            )
        seen.add(item_id)

        quantity = D(data.get("quantity"))
        if quantity <= 0:
            raise bad_request(
                f"Ingredient {index + 1} ({item.name}): quantity must be greater than zero"
            )

        unit_id = int(data["unit_id"]) if data.get("unit_id") else item.unit_id
        base_quantity = convert(db, quantity, unit_id, item.unit_id)
        if base_quantity <= 0:
            raise bad_request(
                f"Ingredient {index + 1} ({item.name}): quantity is too small for {item.unit.code}"
            )

        prepared.append(
            {
                "item_id": item_id,
                "quantity": q(quantity),
                "unit_id": unit_id,
                "base_quantity": base_quantity,
                "is_optional": bool(data.get("is_optional")),
                "sort_order": index,
                "notes": data.get("notes"),
            }
        )

    return prepared
