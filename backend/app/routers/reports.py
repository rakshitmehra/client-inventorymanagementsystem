from datetime import date, timedelta
from decimal import Decimal

from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import case, func, literal, select
from sqlalchemy.orm import aliased

from ..deps import AdminUserDep, CurrentUserDep, DbSession, as_date, assert_kitchen_access
from ..errors import not_found
from ..models import (
    Category,
    ConsumptionRecord,
    InventoryAdjustment,
    InventoryTransfer,
    InventoryTransferItem,
    Item,
    Kitchen,
    KitchenInventory,
    MainInventory,
    MovementType,
    Product,
    ProductionRecord,
    StockMovement,
    Supplier,
    Unit,
    User,
    WastageRecord,
)
from ..sqlfuncs import greatest
from ..schemas import dt, f

router = APIRouter(prefix="/reports", tags=["reports"])

# CockroachDB type-checks CASE branches strictly: a decimal column and an
# integer literal in the same expression is rejected, so the fallback is a
# decimal too.
ZERO = Decimal("0")

MAIN_QTY = func.coalesce(MainInventory.quantity, Decimal("0"))
EFFECTIVE_MIN = greatest(KitchenInventory.min_stock_level, Item.min_stock_level)


def _window(from_: str | None, to: str | None) -> tuple[str, str]:
    """Shared date-window handling, defaulting to the last 30 days."""
    end = to or date.today().isoformat()
    start = from_ or (date.today() - timedelta(days=29)).isoformat()
    return start, end


def _kitchen_filter(user, column, kitchen_id: int | None) -> tuple[list, bool]:
    """Kitchen filter honouring the caller's own access."""
    filters = []
    if not user.is_admin:
        if not user.kitchen_ids:
            return filters, False
        filters.append(column.in_(user.kitchen_ids))
    if kitchen_id:
        assert_kitchen_access(user, kitchen_id)
        filters.append(column == kitchen_id)
    return filters, True


# -------------------------------------------------------------- low stock ---
@router.get("/low-stock")
def low_stock(
    db: DbSession, user: CurrentUserDep, scope: str | None = None, kitchen_id: int | None = None
):
    scope = scope or ("ALL" if user.is_admin else "KITCHEN")
    result: dict = {"main": [], "kitchens": []}

    if user.is_admin and scope in ("ALL", "MAIN"):
        rows = db.execute(
            select(Item, Unit.code, Category.name, Supplier.name, MAIN_QTY.label("quantity"))
            .join(Unit, Unit.id == Item.unit_id)
            .outerjoin(MainInventory, MainInventory.item_id == Item.id)
            .outerjoin(Category, Category.id == Item.category_id)
            .outerjoin(Supplier, Supplier.id == Item.default_supplier_id)
            .where(Item.is_active.is_(True), MAIN_QTY <= Item.min_stock_level)
            .order_by((Item.min_stock_level - MAIN_QTY).desc(), Item.name)
        ).all()

        result["main"] = [
            {
                "item_id": item.id,
                "sku": item.sku,
                "item_name": item.name,
                "min_stock_level": f(item.min_stock_level),
                "reorder_quantity": f(item.reorder_quantity),
                "unit_cost": f(item.unit_cost),
                "unit_code": unit_code,
                "category_name": category,
                "supplier_name": supplier,
                "quantity": f(quantity),
                "shortfall": f(item.min_stock_level - quantity),
                "stock_status": "OUT" if quantity <= 0 else "LOW",
            }
            for item, unit_code, category, supplier, quantity in rows
        ]

    if scope in ("ALL", "KITCHEN"):
        filters, allowed = _kitchen_filter(user, KitchenInventory.kitchen_id, kitchen_id)
        if allowed:
            rows = db.execute(
                select(
                    Kitchen,
                    Item,
                    KitchenInventory.quantity,
                    Unit.code,
                    Category.name,
                    EFFECTIVE_MIN.label("min_level"),
                    MAIN_QTY.label("main_available"),
                )
                .select_from(KitchenInventory)
                .join(Kitchen, Kitchen.id == KitchenInventory.kitchen_id)
                .join(Item, Item.id == KitchenInventory.item_id)
                .join(Unit, Unit.id == Item.unit_id)
                .outerjoin(Category, Category.id == Item.category_id)
                .outerjoin(MainInventory, MainInventory.item_id == Item.id)
                .where(
                    Kitchen.is_active.is_(True),
                    Item.is_active.is_(True),
                    KitchenInventory.quantity <= EFFECTIVE_MIN,
                    *filters,
                )
                .order_by((EFFECTIVE_MIN - KitchenInventory.quantity).desc(), Kitchen.name, Item.name)
            ).all()

            result["kitchens"] = [
                {
                    "kitchen_id": kitchen.id,
                    "kitchen_name": kitchen.name,
                    "kitchen_code": kitchen.code,
                    "item_id": item.id,
                    "sku": item.sku,
                    "item_name": item.name,
                    "unit_cost": f(item.unit_cost),
                    "quantity": f(quantity),
                    "unit_code": unit_code,
                    "category_name": category,
                    "min_level": f(min_level),
                    "shortfall": f(min_level - quantity),
                    "main_available": f(main_available),
                    "stock_status": "OUT" if quantity <= 0 else "LOW",
                }
                for kitchen, item, quantity, unit_code, category, min_level, main_available in rows
            ]

    return {"data": result}


# --------------------------------------------------------- kitchen stock ----
@router.get("/kitchen-stock")
def kitchen_stock(db: DbSession, user: CurrentUserDep, kitchen_id: int | None = None):
    filters, allowed = _kitchen_filter(user, KitchenInventory.kitchen_id, kitchen_id)
    if not allowed:
        return {"data": [], "meta": {"total_value": 0.0}}

    rows = db.execute(
        select(Kitchen, Item, KitchenInventory.quantity, Unit.code, Category.name, EFFECTIVE_MIN)
        .select_from(KitchenInventory)
        .join(Kitchen, Kitchen.id == KitchenInventory.kitchen_id)
        .join(Item, Item.id == KitchenInventory.item_id)
        .join(Unit, Unit.id == Item.unit_id)
        .outerjoin(Category, Category.id == Item.category_id)
        .where(*filters)
        .order_by(Kitchen.name, Item.name)
    ).all()

    # Pivot into one block per kitchen for the report table.
    buckets: dict[int, dict] = {}
    for kitchen, item, quantity, unit_code, category, min_level in rows:
        bucket = buckets.setdefault(
            kitchen.id,
            {
                "kitchen_id": kitchen.id,
                "kitchen_name": kitchen.name,
                "kitchen_code": kitchen.code,
                "is_active": kitchen.is_active,
                "items": [],
                "stock_value": Decimal("0"),
            },
        )
        value = quantity * item.unit_cost
        bucket["stock_value"] += value
        bucket["items"].append(
            {
                "kitchen_id": kitchen.id,
                "item_id": item.id,
                "sku": item.sku,
                "item_name": item.name,
                "unit_cost": f(item.unit_cost),
                "quantity": f(quantity),
                "unit_code": unit_code,
                "category_name": category,
                "min_level": f(min_level),
                "stock_value": f(value),
            }
        )

    data = []
    for bucket in buckets.values():
        bucket["stock_value"] = f(bucket["stock_value"])
        data.append(bucket)

    return {
        "data": data,
        "meta": {"total_value": round(sum(b["stock_value"] for b in data), 2)},
    }


# ------------------------------------------------------ kitchen activity ----
@router.get("/kitchen-activity")
def kitchen_activity(
    db: DbSession,
    user: CurrentUserDep,
    kitchen_id: int | None = None,
    from_: str | None = Query(None, alias="from"),
    to: str | None = None,
):
    """
    One line per item per kitchen: what was sent, what was used, what is left.

    The three questions a kitchen gets asked - how much did we send them, what
    did they do with it, and what are they about to run out of - are answered
    on three different screens today: the transfer list, the production and
    wastage records, and the stock page. Nobody can hold all three side by
    side, so this puts them on one row.

    Sent, used and wasted are counted over the chosen window and come from the
    stock ledger, which is the same record the item history is drawn from.
    "In stock" is deliberately not windowed - it is what is on the shelf right
    now, because a level that was true three weeks ago is not a thing anyone
    can act on.
    """
    start, end = _window(from_, to)
    filters, allowed = _kitchen_filter(user, KitchenInventory.kitchen_id, kitchen_id)
    if not allowed:
        return {"data": [], "meta": _empty_activity_meta(start, end)}

    # Everything a kitchen holds, with the level that counts as low for it.
    stock_rows = db.execute(
        select(Kitchen, Item, KitchenInventory.quantity, Unit.code, Category.name, EFFECTIVE_MIN)
        .select_from(KitchenInventory)
        .join(Kitchen, Kitchen.id == KitchenInventory.kitchen_id)
        .join(Item, Item.id == KitchenInventory.item_id)
        .join(Unit, Unit.id == Item.unit_id)
        .outerjoin(Category, Category.id == Item.category_id)
        .where(*filters)
        .order_by(Kitchen.name, Item.name)
    ).all()

    # The ledger, folded down to a total per kitchen, item and movement type.
    move_filters, _ = _kitchen_filter(user, StockMovement.kitchen_id, kitchen_id)
    moved = db.execute(
        select(
            StockMovement.kitchen_id,
            StockMovement.item_id,
            StockMovement.movement_type,
            func.sum(StockMovement.quantity),
        )
        .where(
            StockMovement.location_type == "KITCHEN",
            func.date(StockMovement.created_at) >= as_date(start),
            func.date(StockMovement.created_at) <= as_date(end),
            *move_filters,
        )
        .group_by(StockMovement.kitchen_id, StockMovement.item_id, StockMovement.movement_type)
    ).all()

    totals: dict[tuple[int, int], dict[str, Decimal]] = {}
    for k_id, item_id, kind, amount in moved:
        totals.setdefault((k_id, item_id), {})[kind] = amount or Decimal("0")

    data = []
    for kitchen, item, quantity, unit_code, category, min_level in stock_rows:
        seen = totals.get((kitchen.id, item.id), {})
        sent = seen.get("TRANSFER_IN", Decimal("0"))
        returned = seen.get("TRANSFER_OUT", Decimal("0"))
        used = seen.get("PRODUCTION_CONSUMPTION", Decimal("0"))
        wasted = seen.get("WASTAGE", Decimal("0"))

        if quantity <= 0:
            status = "OUT"
        elif min_level and quantity <= min_level:
            status = "LOW"
        else:
            status = "OK"

        data.append(
            {
                "kitchen_id": kitchen.id,
                "kitchen_name": kitchen.name,
                "item_id": item.id,
                "sku": item.sku,
                "item_name": item.name,
                "category_name": category,
                "unit_code": unit_code,
                "sent": f(sent),
                "returned": f(returned),
                "used": f(used),
                "wasted": f(wasted),
                "quantity": f(quantity),
                "min_level": f(min_level),
                "stock_status": status,
                "stock_value": f(quantity * item.unit_cost),
                "wasted_value": f(wasted * item.unit_cost),
            }
        )

    return {
        "data": data,
        "meta": {
            "from": start,
            "to": end,
            "total": len(data),
            "low": sum(1 for r in data if r["stock_status"] == "LOW"),
            "out": sum(1 for r in data if r["stock_status"] == "OUT"),
            "stock_value": round(sum(r["stock_value"] for r in data), 2),
            "wasted_value": round(sum(r["wasted_value"] for r in data), 2),
        },
    }


def _empty_activity_meta(start, end):
    return {
        "from": start,
        "to": end,
        "total": 0,
        "low": 0,
        "out": 0,
        "stock_value": 0.0,
        "wasted_value": 0.0,
    }


# ------------------------------------------------------------- transfers ----
@router.get("/transfers")
def transfers_report(
    db: DbSession,
    _admin: AdminUserDep,
    from_: Annotated[str | None, Query(alias="from")] = None,
    to: str | None = None,
    kitchen_id: int | None = None,
):
    start, end = _window(from_, to)
    filters = [func.date(InventoryTransfer.transfer_date).between(as_date(start), as_date(end))]
    if kitchen_id:
        filters.append(
            (InventoryTransfer.from_kitchen_id == kitchen_id)
            | (InventoryTransfer.to_kitchen_id == kitchen_id)
        )

    by_kitchen = db.execute(
        select(
            Kitchen.id,
            Kitchen.name,
            Kitchen.code,
            func.count(func.distinct(InventoryTransfer.id)).label("transfer_count"),
            func.sum(InventoryTransferItem.base_quantity).label("total_quantity"),
            func.sum(InventoryTransferItem.total_cost).label("total_value"),
            func.count(func.distinct(InventoryTransferItem.item_id)).label("distinct_items"),
        )
        .select_from(InventoryTransfer)
        .join(InventoryTransferItem, InventoryTransferItem.transfer_id == InventoryTransfer.id)
        .join(Kitchen, Kitchen.id == InventoryTransfer.to_kitchen_id)
        .where(
            *filters,
            InventoryTransfer.to_location_type == "KITCHEN",
            InventoryTransfer.status == "COMPLETED",
        )
        .group_by(Kitchen.id, Kitchen.name, Kitchen.code)
        .order_by(func.sum(InventoryTransferItem.total_cost).desc())
    ).all()

    by_item = db.execute(
        select(
            Item.id,
            Item.sku,
            Item.name,
            Unit.code,
            func.sum(InventoryTransferItem.base_quantity).label("total_quantity"),
            func.sum(InventoryTransferItem.total_cost).label("total_value"),
            func.count(func.distinct(InventoryTransfer.id)).label("transfer_count"),
        )
        .select_from(InventoryTransfer)
        .join(InventoryTransferItem, InventoryTransferItem.transfer_id == InventoryTransfer.id)
        .join(Item, Item.id == InventoryTransferItem.item_id)
        .join(Unit, Unit.id == Item.unit_id)
        .where(*filters, InventoryTransfer.status == "COMPLETED")
        .group_by(Item.id, Item.sku, Item.name, Unit.code)
        .order_by(func.sum(InventoryTransferItem.base_quantity).desc())
    ).all()

    FromKitchen = aliased(Kitchen, name="from_kitchen")
    ToKitchen = aliased(Kitchen, name="to_kitchen")

    listing = db.execute(
        select(InventoryTransfer, User.full_name, FromKitchen.name, ToKitchen.name)
        .outerjoin(User, User.id == InventoryTransfer.created_by)
        .outerjoin(FromKitchen, FromKitchen.id == InventoryTransfer.from_kitchen_id)
        .outerjoin(ToKitchen, ToKitchen.id == InventoryTransfer.to_kitchen_id)
        .where(*filters)
        .order_by(InventoryTransfer.transfer_date.desc())
        .limit(500)
    ).all()

    return {
        "data": {
            "by_kitchen": [
                {
                    "kitchen_id": r.id,
                    "kitchen_name": r.name,
                    "kitchen_code": r.code,
                    "transfer_count": r.transfer_count,
                    "total_quantity": f(r.total_quantity),
                    "total_value": f(r.total_value),
                    "distinct_items": r.distinct_items,
                }
                for r in by_kitchen
            ],
            "by_item": [
                {
                    "item_id": r.id,
                    "sku": r.sku,
                    "item_name": r.name,
                    "unit_code": r.code,
                    "total_quantity": f(r.total_quantity),
                    "total_value": f(r.total_value),
                    "transfer_count": r.transfer_count,
                }
                for r in by_item
            ],
            "transfers": [
                {
                    "id": t.id,
                    "transfer_no": t.transfer_no,
                    "transfer_date": dt(t.transfer_date),
                    "total_items": t.total_items,
                    "total_cost": f(t.total_cost),
                    "status": t.status,
                    "created_by_name": creator,
                    "source_label": (
                        "Main Inventory" if t.from_location_type == "MAIN" else from_name
                    ),
                    "destination_label": (
                        "Main Inventory" if t.to_location_type == "MAIN" else to_name
                    ),
                }
                for t, creator, from_name, to_name in listing
            ],
        },
        "meta": {"from": start, "to": end, "total_transfers": len(listing)},
    }


# --------------------------------------------------------------- wastage ----
@router.get("/wastage")
def wastage_report(
    db: DbSession,
    user: CurrentUserDep,
    from_: Annotated[str | None, Query(alias="from")] = None,
    to: str | None = None,
    kitchen_id: int | None = None,
):
    start, end = _window(from_, to)
    filters, allowed = _kitchen_filter(user, WastageRecord.kitchen_id, kitchen_id)
    if not allowed:
        return {"data": {}, "meta": {"from": start, "to": end, "total_cost": 0.0}}

    filters.append(func.date(WastageRecord.recorded_at).between(as_date(start), as_date(end)))

    by_item = db.execute(
        select(
            Item.id,
            Item.sku,
            Item.name,
            Unit.code,
            func.sum(WastageRecord.base_quantity).label("total_quantity"),
            func.sum(WastageRecord.estimated_cost).label("total_cost"),
            func.count(WastageRecord.id).label("events"),
        )
        .join(Item, Item.id == WastageRecord.item_id)
        .join(Unit, Unit.id == Item.unit_id)
        .where(*filters)
        .group_by(Item.id, Item.sku, Item.name, Unit.code)
        .order_by(func.sum(WastageRecord.estimated_cost).desc())
    ).all()

    by_reason = db.execute(
        select(
            WastageRecord.reason_code,
            func.count(WastageRecord.id).label("events"),
            func.sum(WastageRecord.estimated_cost).label("total_cost"),
        )
        .where(*filters)
        .group_by(WastageRecord.reason_code)
        .order_by(func.sum(WastageRecord.estimated_cost).desc())
    ).all()

    by_location = db.execute(
        select(
            WastageRecord.location_type,
            WastageRecord.kitchen_id,
            Kitchen.name,
            func.count(WastageRecord.id).label("events"),
            func.sum(WastageRecord.estimated_cost).label("total_cost"),
        )
        .outerjoin(Kitchen, Kitchen.id == WastageRecord.kitchen_id)
        .where(*filters)
        .group_by(WastageRecord.location_type, WastageRecord.kitchen_id, Kitchen.name)
        .order_by(func.sum(WastageRecord.estimated_cost).desc())
    ).all()

    total_cost = sum(float(r.total_cost or 0) for r in by_item)

    return {
        "data": {
            "by_item": [
                {
                    "item_id": r.id,
                    "sku": r.sku,
                    "item_name": r.name,
                    "unit_code": r.code,
                    "total_quantity": f(r.total_quantity),
                    "total_cost": f(r.total_cost),
                    "events": r.events,
                }
                for r in by_item
            ],
            "by_reason": [
                {"reason_code": r.reason_code, "events": r.events, "total_cost": f(r.total_cost)}
                for r in by_reason
            ],
            "by_location": [
                {
                    "location_type": r.location_type,
                    "kitchen_id": r.kitchen_id,
                    "location_label": (
                        "Main Inventory" if r.location_type == "MAIN" else r.name
                    ),
                    "events": r.events,
                    "total_cost": f(r.total_cost),
                }
                for r in by_location
            ],
        },
        "meta": {"from": start, "to": end, "total_cost": round(total_cost, 2)},
    }


# ----------------------------------------------------------- adjustments ----
@router.get("/adjustments")
def adjustments_report(
    db: DbSession,
    user: CurrentUserDep,
    from_: Annotated[str | None, Query(alias="from")] = None,
    to: str | None = None,
    kitchen_id: int | None = None,
):
    start, end = _window(from_, to)
    filters, allowed = _kitchen_filter(user, InventoryAdjustment.kitchen_id, kitchen_id)
    if not allowed:
        return {"data": [], "meta": {"from": start, "to": end}}

    filters.append(func.date(InventoryAdjustment.adjusted_at).between(as_date(start), as_date(end)))

    rows = db.execute(
        select(InventoryAdjustment, Item, Unit.code, Kitchen.name, User.full_name)
        .join(Item, Item.id == InventoryAdjustment.item_id)
        .join(Unit, Unit.id == Item.unit_id)
        .outerjoin(Kitchen, Kitchen.id == InventoryAdjustment.kitchen_id)
        .outerjoin(User, User.id == InventoryAdjustment.created_by)
        .where(*filters)
        .order_by(InventoryAdjustment.adjusted_at.desc())
    ).all()

    data = []
    net_impact = Decimal("0")
    increases = decreases = 0

    for record, item, unit_code, kitchen_name, creator in rows:
        impact = record.difference * item.unit_cost
        net_impact += impact
        if record.adjustment_type == "INCREASE":
            increases += 1
        else:
            decreases += 1

        data.append(
            {
                "id": record.id,
                "adjustment_no": record.adjustment_no,
                "adjusted_at": dt(record.adjusted_at),
                "location_type": record.location_type,
                "location_label": (
                    "Main Inventory" if record.location_type == "MAIN" else kitchen_name
                ),
                "item_id": item.id,
                "sku": item.sku,
                "item_name": item.name,
                "unit_code": unit_code,
                "previous_quantity": f(record.previous_quantity),
                "new_quantity": f(record.new_quantity),
                "difference": f(record.difference),
                "adjustment_type": record.adjustment_type,
                "reason_code": record.reason_code,
                "reason": record.reason,
                "created_by_name": creator,
                "value_impact": f(impact),
            }
        )

    return {
        "data": data,
        "meta": {
            "from": start,
            "to": end,
            "net_value_impact": f(net_impact),
            "increases": increases,
            "decreases": decreases,
        },
    }


# ------------------------------------------------------------- valuation ----
@router.get("/valuation")
def valuation(db: DbSession, _admin: AdminUserDep):
    kitchen_qty = (
        select(func.coalesce(func.sum(KitchenInventory.quantity), Decimal("0")))
        .where(KitchenInventory.item_id == Item.id)
        .scalar_subquery()
    )

    rows = db.execute(
        select(Item, Unit.code, Category.name, MAIN_QTY.label("main_qty"), kitchen_qty.label("kitchen_qty"))
        .join(Unit, Unit.id == Item.unit_id)
        .outerjoin(MainInventory, MainInventory.item_id == Item.id)
        .outerjoin(Category, Category.id == Item.category_id)
        .where(Item.is_active.is_(True))
    ).all()

    per_item = []
    categories: dict[str, dict] = {}
    total_value = Decimal("0")

    for item, unit_code, category_name, main_qty, kitchen_qty_value in rows:
        label = category_name or "Uncategorised"
        main_value = main_qty * item.unit_cost
        kitchen_value = kitchen_qty_value * item.unit_cost
        item_value = main_value + kitchen_value
        total_value += item_value

        bucket = categories.setdefault(
            label,
            {
                "category_name": label,
                "item_count": 0,
                "main_value": Decimal("0"),
                "kitchen_value": Decimal("0"),
            },
        )
        bucket["item_count"] += 1
        bucket["main_value"] += main_value
        bucket["kitchen_value"] += kitchen_value

        per_item.append(
            {
                "item_id": item.id,
                "sku": item.sku,
                "item_name": item.name,
                "unit_cost": f(item.unit_cost),
                "unit_code": unit_code,
                "category_name": category_name,
                "main_quantity": f(main_qty),
                "kitchen_quantity": f(kitchen_qty_value),
                "total_value": f(item_value),
            }
        )

    per_item.sort(key=lambda row: row["total_value"], reverse=True)

    by_category = [
        {
            "category_name": bucket["category_name"],
            "item_count": bucket["item_count"],
            "main_value": f(bucket["main_value"]),
            "kitchen_value": f(bucket["kitchen_value"]),
            "total_value": f(bucket["main_value"] + bucket["kitchen_value"]),
        }
        for bucket in categories.values()
    ]
    by_category.sort(key=lambda row: row["total_value"], reverse=True)

    return {
        "data": {"by_category": by_category, "by_item": per_item},
        "meta": {"total_value": f(total_value)},
    }


# ------------------------------------------- item movement (stock ledger) ---
@router.get("/item-movement/{item_id}")
def item_movement(
    item_id: int,
    db: DbSession,
    user: CurrentUserDep,
    from_: Annotated[str | None, Query(alias="from")] = None,
    to: str | None = None,
):
    start, end = _window(from_, to)

    row = db.execute(
        select(Item, Unit.code, Category.name)
        .join(Unit, Unit.id == Item.unit_id)
        .outerjoin(Category, Category.id == Item.category_id)
        .where(Item.id == item_id)
    ).first()
    if row is None:
        raise not_found("Item")

    item, unit_code, category_name = row
    item_payload = {
        "id": item.id,
        "sku": item.sku,
        "name": item.name,
        "unit_code": unit_code,
        "category_name": category_name,
        "unit_cost": f(item.unit_cost),
        "min_stock_level": f(item.min_stock_level),
    }

    filters = [
        StockMovement.item_id == item_id,
        func.date(StockMovement.created_at).between(as_date(start), as_date(end)),
    ]
    if not user.is_admin:
        if not user.kitchen_ids:
            return {"data": {"item": item_payload, "by_location": [], "movements": [], "balances": []}}
        filters.append(StockMovement.kitchen_id.in_(user.kitchen_ids))

    def total_for(movement_type):
        return func.coalesce(
            func.sum(
                case((StockMovement.movement_type == movement_type, StockMovement.quantity), else_=ZERO)
            ),
            Decimal("0"),
        )

    by_location = db.execute(
        select(
            StockMovement.location_type,
            StockMovement.kitchen_id,
            Kitchen.name,
            total_for(MovementType.PURCHASE_RECEIPT.value).label("received"),
            total_for(MovementType.TRANSFER_IN.value).label("transferred_in"),
            total_for(MovementType.TRANSFER_OUT.value).label("transferred_out"),
            total_for(MovementType.PRODUCTION_CONSUMPTION.value).label("consumed"),
            total_for(MovementType.WASTAGE.value).label("wasted"),
            total_for(MovementType.ADJUSTMENT_INCREASE.value).label("adjusted_up"),
            total_for(MovementType.ADJUSTMENT_DECREASE.value).label("adjusted_down"),
        )
        .outerjoin(Kitchen, Kitchen.id == StockMovement.kitchen_id)
        .where(*filters)
        .group_by(StockMovement.location_type, StockMovement.kitchen_id, Kitchen.name)
        .order_by(StockMovement.location_type, Kitchen.name)
    ).all()

    movements = db.execute(
        select(StockMovement, Kitchen.name, User.full_name)
        .outerjoin(Kitchen, Kitchen.id == StockMovement.kitchen_id)
        .outerjoin(User, User.id == StockMovement.performed_by)
        .where(*filters)
        .order_by(StockMovement.created_at.desc(), StockMovement.id.desc())
        .limit(1000)
    ).all()

    balances = []
    if user.is_admin:
        main_qty = db.execute(
            select(MainInventory.quantity).where(MainInventory.item_id == item_id)
        ).scalar_one_or_none()
        balances.append({"location_label": "Main Inventory", "quantity": f(main_qty or 0)})
        balances.extend(
            {"location_label": name, "quantity": f(quantity)}
            for name, quantity in db.execute(
                select(Kitchen.name, KitchenInventory.quantity)
                .join(Kitchen, Kitchen.id == KitchenInventory.kitchen_id)
                .where(KitchenInventory.item_id == item_id)
                .order_by(Kitchen.name)
            ).all()
        )

    return {
        "data": {
            "item": item_payload,
            "by_location": [
                {
                    "location_type": r.location_type,
                    "kitchen_id": r.kitchen_id,
                    "location_label": (
                        "Main Inventory" if r.location_type == "MAIN" else r.name
                    ),
                    "received": f(r.received),
                    "transferred_in": f(r.transferred_in),
                    "transferred_out": f(r.transferred_out),
                    "consumed": f(r.consumed),
                    "wasted": f(r.wasted),
                    "adjusted_up": f(r.adjusted_up),
                    "adjusted_down": f(r.adjusted_down),
                }
                for r in by_location
            ],
            "movements": [
                {
                    "id": m.id,
                    "movement_no": m.movement_no,
                    "movement_type": m.movement_type,
                    "direction": m.direction,
                    "quantity": f(m.quantity),
                    "location_type": m.location_type,
                    "location_label": (
                        "Main Inventory" if m.location_type == "MAIN" else kitchen_name
                    ),
                    "balance_before": f(m.balance_before),
                    "balance_after": f(m.balance_after),
                    "reference_no": m.reference_no,
                    "performed_by_name": performer,
                    "created_at": dt(m.created_at),
                }
                for m, kitchen_name, performer in movements
            ],
            "balances": balances,
        },
        "meta": {"from": start, "to": end},
    }
