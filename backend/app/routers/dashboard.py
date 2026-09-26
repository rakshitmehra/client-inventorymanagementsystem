from datetime import UTC, datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter
from sqlalchemy import case, func, select

from ..deps import AdminUserDep, CurrentUserDep, DbSession, assert_kitchen_access
from ..models import (
    AuditLog,
    Category,
    ConsumptionRecord,
    InventoryAdjustment,
    InventoryTransfer,
    Item,
    Kitchen,
    KitchenInventory,
    KitchenManager,
    MainInventory,
    Product,
    ProductionRecord,
    Role,
    RoleCode,
    StockMovement,
    StockReceipt,
    Supplier,
    Unit,
    User,
    WastageRecord,
)
from ..sqlfuncs import greatest
from ..schemas import dt, f

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

MAIN_QTY = func.coalesce(MainInventory.quantity, Decimal("0"))
EFFECTIVE_MIN = greatest(KitchenInventory.min_stock_level, Item.min_stock_level)


def _since(days: int) -> datetime:
    return datetime.now(UTC) - timedelta(days=days)


def _primary_manager_name(kitchen_id_column):
    return (
        select(User.full_name)
        .select_from(KitchenManager)
        .join(User, User.id == KitchenManager.user_id)
        .where(
            KitchenManager.kitchen_id == kitchen_id_column,
            KitchenManager.is_active.is_(True),
        )
        .order_by(KitchenManager.is_primary.desc())
        .limit(1)
        .scalar_subquery()
    )


# ------------------------------------------------------- admin dashboard ----
@router.get("/admin")
def admin_dashboard(db: DbSession, _admin: AdminUserDep, days: int = 30):
    days = min(365, max(1, days))
    since = _since(days)

    main = db.execute(
        select(
            func.count(Item.id).label("item_count"),
            func.coalesce(func.sum(MAIN_QTY * Item.unit_cost), Decimal("0")).label("stock_value"),
            func.coalesce(func.sum(case((MAIN_QTY <= 0, 1), else_=0)), Decimal("0")).label("out_of_stock"),
            func.coalesce(
                func.sum(case(((MAIN_QTY > 0) & (MAIN_QTY <= Item.min_stock_level), 1), else_=0)),
                Decimal("0"),
            ).label("low_stock"),
        )
        .select_from(Item)
        .outerjoin(MainInventory, MainInventory.item_id == Item.id)
        .where(Item.is_active.is_(True))
    ).one()

    kitchen_value = db.execute(
        select(func.coalesce(func.sum(KitchenInventory.quantity * Item.unit_cost), Decimal("0")))
        .select_from(KitchenInventory)
        .join(Item, Item.id == KitchenInventory.item_id)
        .join(Kitchen, Kitchen.id == KitchenInventory.kitchen_id)
        .where(Kitchen.is_active.is_(True))
    ).scalar_one()

    counts = {
        "active_kitchens": db.execute(
            select(func.count(Kitchen.id)).where(Kitchen.is_active.is_(True))
        ).scalar_one(),
        "inactive_kitchens": db.execute(
            select(func.count(Kitchen.id)).where(Kitchen.is_active.is_(False))
        ).scalar_one(),
        "managers": db.execute(
            select(func.count(User.id))
            .join(Role, Role.id == User.role_id)
            .where(Role.code == RoleCode.KITCHEN_MANAGER.value, User.is_active.is_(True))
        ).scalar_one(),
        "items": db.execute(
            select(func.count(Item.id)).where(Item.is_active.is_(True))
        ).scalar_one(),
        "products": db.execute(
            select(func.count(Product.id)).where(Product.is_active.is_(True))
        ).scalar_one(),
        "suppliers": db.execute(
            select(func.count(Supplier.id)).where(Supplier.is_active.is_(True))
        ).scalar_one(),
    }

    period = {
        "transfers": db.execute(
            select(func.count(InventoryTransfer.id)).where(
                InventoryTransfer.transfer_date >= since
            )
        ).scalar_one(),
        "production_runs": db.execute(
            select(func.count(ProductionRecord.id)).where(ProductionRecord.produced_at >= since)
        ).scalar_one(),
        "units_produced": f(
            db.execute(
                select(
                    func.coalesce(func.sum(ProductionRecord.output_quantity), Decimal("0"))
                ).where(ProductionRecord.produced_at >= since)
            ).scalar_one()
        ),
        "wastage_cost": f(
            db.execute(
                select(
                    func.coalesce(func.sum(WastageRecord.estimated_cost), Decimal("0"))
                ).where(WastageRecord.recorded_at >= since)
            ).scalar_one()
        ),
        "wastage_events": db.execute(
            select(func.count(WastageRecord.id)).where(WastageRecord.recorded_at >= since)
        ).scalar_one(),
        "receipts": db.execute(
            select(func.count(StockReceipt.id)).where(StockReceipt.received_at >= since)
        ).scalar_one(),
        "adjustments": db.execute(
            select(func.count(InventoryAdjustment.id)).where(
                InventoryAdjustment.adjusted_at >= since
            )
        ).scalar_one(),
    }

    runs_in_period = (
        select(func.count(ProductionRecord.id))
        .where(ProductionRecord.kitchen_id == Kitchen.id, ProductionRecord.produced_at >= since)
        .scalar_subquery()
    )

    kitchen_rows = db.execute(
        select(
            Kitchen,
            func.coalesce(func.sum(KitchenInventory.quantity * Item.unit_cost), Decimal("0")).label(
                "stock_value"
            ),
            func.count(KitchenInventory.id).label("item_count"),
            func.coalesce(
                func.sum(case((KitchenInventory.quantity <= 0, 1), else_=0)), Decimal("0")
            ).label("out_of_stock"),
            func.coalesce(
                func.sum(
                    case(
                        (
                            (KitchenInventory.quantity > 0)
                            & (KitchenInventory.quantity <= EFFECTIVE_MIN),
                            1,
                        ),
                        else_=0,
                    )
                ),
                Decimal("0"),
            ).label("low_stock"),
            _primary_manager_name(Kitchen.id).label("manager_name"),
            runs_in_period.label("production_runs"),
        )
        .outerjoin(KitchenInventory, KitchenInventory.kitchen_id == Kitchen.id)
        .outerjoin(Item, Item.id == KitchenInventory.item_id)
        .group_by(Kitchen.id)
        .order_by(Kitchen.is_active.desc(), Kitchen.name)
    ).all()

    low_stock_main = db.execute(
        select(Item, Unit.code, Category.name, MAIN_QTY.label("quantity"))
        .join(Unit, Unit.id == Item.unit_id)
        .outerjoin(MainInventory, MainInventory.item_id == Item.id)
        .outerjoin(Category, Category.id == Item.category_id)
        .where(Item.is_active.is_(True), MAIN_QTY <= Item.min_stock_level)
        .order_by((MAIN_QTY - Item.min_stock_level), Item.name)
        .limit(12)
    ).all()

    low_stock_kitchens = db.execute(
        select(Kitchen.id, Kitchen.name, Item.name, Item.sku, KitchenInventory.quantity, Unit.code, EFFECTIVE_MIN)
        .select_from(KitchenInventory)
        .join(Kitchen, Kitchen.id == KitchenInventory.kitchen_id)
        .join(Item, Item.id == KitchenInventory.item_id)
        .join(Unit, Unit.id == Item.unit_id)
        .where(
            Kitchen.is_active.is_(True),
            Item.is_active.is_(True),
            KitchenInventory.quantity <= EFFECTIVE_MIN,
        )
        .order_by((KitchenInventory.quantity - EFFECTIVE_MIN), Kitchen.name, Item.name)
        .limit(12)
    ).all()

    top_consumed = db.execute(
        select(
            Item.id,
            Item.name,
            Item.sku,
            Unit.code,
            func.sum(ConsumptionRecord.consumed_quantity).label("consumed"),
            func.sum(ConsumptionRecord.total_cost).label("cost"),
        )
        .join(Item, Item.id == ConsumptionRecord.item_id)
        .join(Unit, Unit.id == Item.unit_id)
        .where(ConsumptionRecord.created_at >= since)
        .group_by(Item.id, Item.name, Item.sku, Unit.code)
        .order_by(func.sum(ConsumptionRecord.consumed_quantity).desc())
        .limit(8)
    ).all()

    top_products = db.execute(
        select(
            Product.id,
            Product.name,
            Product.sku,
            func.sum(ProductionRecord.output_quantity).label("produced"),
            func.count(ProductionRecord.id).label("runs"),
            func.sum(ProductionRecord.total_cost).label("cost"),
        )
        .join(Product, Product.id == ProductionRecord.product_id)
        .where(ProductionRecord.produced_at >= since)
        .group_by(Product.id, Product.name, Product.sku)
        .order_by(func.sum(ProductionRecord.output_quantity).desc())
        .limit(8)
    ).all()

    trend = db.execute(
        select(
            func.date(StockMovement.created_at).label("day"),
            func.sum(case((StockMovement.direction == "IN", 1), else_=0)).label("inbound"),
            func.sum(case((StockMovement.direction == "OUT", 1), else_=0)).label("outbound"),
        )
        .where(StockMovement.created_at >= since)
        .group_by(func.date(StockMovement.created_at))
        .order_by(func.date(StockMovement.created_at))
    ).all()

    activity = db.execute(
        select(AuditLog, User.full_name)
        .outerjoin(User, User.id == AuditLog.user_id)
        .where(AuditLog.action.not_in(["LOGIN", "LOGOUT"]))
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .limit(12)
    ).all()

    return {
        "data": {
            "period_days": days,
            "main_inventory": {
                "item_count": main.item_count,
                "stock_value": f(main.stock_value),
                "low_stock": main.low_stock,
                "out_of_stock": main.out_of_stock,
            },
            "kitchen_stock_value": f(kitchen_value),
            "total_stock_value": f(main.stock_value + kitchen_value),
            "counts": counts,
            "period": period,
            "kitchens": [
                {
                    "id": k.id,
                    "code": k.code,
                    "name": k.name,
                    "location": k.location,
                    "is_active": k.is_active,
                    "stock_value": f(value),
                    "item_count": item_count,
                    "out_of_stock": out_of_stock,
                    "low_stock": low_stock,
                    "manager_name": manager,
                    "production_runs": runs,
                }
                for k, value, item_count, out_of_stock, low_stock, manager, runs in kitchen_rows
            ],
            "low_stock_main": [
                {
                    "item_id": item.id,
                    "sku": item.sku,
                    "item_name": item.name,
                    "min_stock_level": f(item.min_stock_level),
                    "reorder_quantity": f(item.reorder_quantity),
                    "unit_code": unit_code,
                    "category_name": category_name,
                    "quantity": f(quantity),
                    "stock_status": "OUT" if quantity <= 0 else "LOW",
                }
                for item, unit_code, category_name, quantity in low_stock_main
            ],
            "low_stock_kitchens": [
                {
                    "kitchen_id": kid,
                    "kitchen_name": kname,
                    "item_name": iname,
                    "sku": sku,
                    "quantity": f(quantity),
                    "unit_code": unit_code,
                    "min_level": f(min_level),
                    "stock_status": "OUT" if quantity <= 0 else "LOW",
                }
                for kid, kname, iname, sku, quantity, unit_code, min_level in low_stock_kitchens
            ],
            "top_consumed": [
                {
                    "item_id": iid,
                    "item_name": name,
                    "sku": sku,
                    "unit_code": unit_code,
                    "consumed": f(consumed),
                    "cost": f(cost),
                }
                for iid, name, sku, unit_code, consumed, cost in top_consumed
            ],
            "top_products": [
                {
                    "id": pid,
                    "name": name,
                    "sku": sku,
                    "produced": f(produced),
                    "runs": runs,
                    "cost": f(cost),
                }
                for pid, name, sku, produced, runs, cost in top_products
            ],
            "movement_trend": [
                {"day": str(day), "inbound": inbound, "outbound": outbound}
                for day, inbound, outbound in trend
            ],
            "recent_activity": [
                {
                    "action": entry.action,
                    "entity_type": entry.entity_type,
                    "entity_label": entry.entity_label,
                    "description": entry.description,
                    "created_at": dt(entry.created_at),
                    "username": entry.username,
                    "full_name": full_name,
                }
                for entry, full_name in activity
            ],
        }
    }


# ----------------------------------------------------- kitchen dashboard ----
@router.get("/kitchen/{kitchen_id}")
def kitchen_dashboard(kitchen_id: int, db: DbSession, user: CurrentUserDep, days: int = 30):
    assert_kitchen_access(user, kitchen_id)
    days = min(365, max(1, days))
    since = _since(days)

    kitchen = db.execute(
        select(Kitchen, _primary_manager_name(Kitchen.id).label("manager_name")).where(
            Kitchen.id == kitchen_id
        )
    ).first()
    kitchen_row, manager_name = kitchen

    stock = db.execute(
        select(
            func.count(KitchenInventory.id).label("item_count"),
            func.coalesce(
                func.sum(KitchenInventory.quantity * Item.unit_cost), Decimal("0")
            ).label("stock_value"),
            func.coalesce(
                func.sum(case((KitchenInventory.quantity <= 0, 1), else_=0)), Decimal("0")
            ).label("out_of_stock"),
            func.coalesce(
                func.sum(
                    case(
                        (
                            (KitchenInventory.quantity > 0)
                            & (KitchenInventory.quantity <= EFFECTIVE_MIN),
                            1,
                        ),
                        else_=0,
                    )
                ),
                Decimal("0"),
            ).label("low_stock"),
        )
        .select_from(KitchenInventory)
        .join(Item, Item.id == KitchenInventory.item_id)
        .where(KitchenInventory.kitchen_id == kitchen_id)
    ).one()

    period = {
        "production_runs": db.execute(
            select(func.count(ProductionRecord.id)).where(
                ProductionRecord.kitchen_id == kitchen_id, ProductionRecord.produced_at >= since
            )
        ).scalar_one(),
        "units_produced": f(
            db.execute(
                select(
                    func.coalesce(func.sum(ProductionRecord.output_quantity), Decimal("0"))
                ).where(
                    ProductionRecord.kitchen_id == kitchen_id,
                    ProductionRecord.produced_at >= since,
                )
            ).scalar_one()
        ),
        "transfers_in": db.execute(
            select(func.count(InventoryTransfer.id)).where(
                InventoryTransfer.to_kitchen_id == kitchen_id,
                InventoryTransfer.transfer_date >= since,
            )
        ).scalar_one(),
        "wastage_cost": f(
            db.execute(
                select(
                    func.coalesce(func.sum(WastageRecord.estimated_cost), Decimal("0"))
                ).where(
                    WastageRecord.kitchen_id == kitchen_id, WastageRecord.recorded_at >= since
                )
            ).scalar_one()
        ),
        "consumption_cost": f(
            db.execute(
                select(
                    func.coalesce(func.sum(ConsumptionRecord.total_cost), Decimal("0"))
                ).where(
                    ConsumptionRecord.kitchen_id == kitchen_id,
                    ConsumptionRecord.created_at >= since,
                )
            ).scalar_one()
        ),
    }

    low_stock = db.execute(
        select(Item, KitchenInventory.quantity, Unit.code, Category.name, EFFECTIVE_MIN)
        .select_from(KitchenInventory)
        .join(Item, Item.id == KitchenInventory.item_id)
        .join(Unit, Unit.id == Item.unit_id)
        .outerjoin(Category, Category.id == Item.category_id)
        .where(
            KitchenInventory.kitchen_id == kitchen_id,
            Item.is_active.is_(True),
            KitchenInventory.quantity <= EFFECTIVE_MIN,
        )
        .order_by((KitchenInventory.quantity - EFFECTIVE_MIN), Item.name)
        .limit(15)
    ).all()

    recent_transfers = db.execute(
        select(InventoryTransfer, User.full_name, Kitchen.name)
        .outerjoin(User, User.id == InventoryTransfer.created_by)
        .outerjoin(Kitchen, Kitchen.id == InventoryTransfer.from_kitchen_id)
        .where(InventoryTransfer.to_kitchen_id == kitchen_id)
        .order_by(InventoryTransfer.transfer_date.desc())
        .limit(8)
    ).all()

    ingredient_count = (
        select(func.count(ConsumptionRecord.id))
        .where(ConsumptionRecord.production_id == ProductionRecord.id)
        .scalar_subquery()
    )

    recent_production = db.execute(
        select(ProductionRecord, Product.name, Unit.code, User.full_name, ingredient_count)
        .join(Product, Product.id == ProductionRecord.product_id)
        .join(Unit, Unit.id == ProductionRecord.output_unit_id)
        .outerjoin(User, User.id == ProductionRecord.created_by)
        .where(ProductionRecord.kitchen_id == kitchen_id)
        .order_by(ProductionRecord.produced_at.desc())
        .limit(8)
    ).all()

    top_consumed = db.execute(
        select(
            Item.name,
            Item.sku,
            Unit.code,
            func.sum(ConsumptionRecord.consumed_quantity).label("consumed"),
            func.sum(ConsumptionRecord.total_cost).label("cost"),
        )
        .join(Item, Item.id == ConsumptionRecord.item_id)
        .join(Unit, Unit.id == Item.unit_id)
        .where(ConsumptionRecord.kitchen_id == kitchen_id, ConsumptionRecord.created_at >= since)
        .group_by(Item.id, Item.name, Item.sku, Unit.code)
        .order_by(func.sum(ConsumptionRecord.consumed_quantity).desc())
        .limit(8)
    ).all()

    return {
        "data": {
            "kitchen": {
                "id": kitchen_row.id,
                "code": kitchen_row.code,
                "name": kitchen_row.name,
                "location": kitchen_row.location,
                "manager_name": manager_name,
            },
            "period_days": days,
            "stock": {
                "item_count": stock.item_count,
                "stock_value": f(stock.stock_value),
                "low_stock": stock.low_stock,
                "out_of_stock": stock.out_of_stock,
            },
            "period": period,
            "low_stock": [
                {
                    "item_id": item.id,
                    "sku": item.sku,
                    "item_name": item.name,
                    "quantity": f(quantity),
                    "unit_code": unit_code,
                    "category_name": category_name,
                    "min_level": f(min_level),
                    "stock_status": "OUT" if quantity <= 0 else "LOW",
                }
                for item, quantity, unit_code, category_name, min_level in low_stock
            ],
            "recent_transfers": [
                {
                    "id": transfer.id,
                    "transfer_no": transfer.transfer_no,
                    "transfer_date": dt(transfer.transfer_date),
                    "total_items": transfer.total_items,
                    "status": transfer.status,
                    "created_by_name": creator,
                    "source_label": (
                        "Main Inventory"
                        if transfer.from_location_type == "MAIN"
                        else from_name
                    ),
                }
                for transfer, creator, from_name in recent_transfers
            ],
            "recent_production": [
                {
                    "id": record.id,
                    "production_no": record.production_no,
                    "produced_at": dt(record.produced_at),
                    "output_quantity": f(record.output_quantity),
                    "total_cost": f(record.total_cost),
                    "product_name": product_name,
                    "unit_code": unit_code,
                    "created_by_name": creator,
                    "ingredient_count": ingredients,
                }
                for record, product_name, unit_code, creator, ingredients in recent_production
            ],
            "top_consumed": [
                {
                    "item_name": name,
                    "sku": sku,
                    "unit_code": unit_code,
                    "consumed": f(consumed),
                    "cost": f(cost),
                }
                for name, sku, unit_code, consumed, cost in top_consumed
            ],
        }
    }
