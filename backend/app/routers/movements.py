from decimal import Decimal

from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import case, func, literal, or_, select
from sqlalchemy.orm import aliased

from ..deps import CurrentUserDep, DbSession, PaginationDep, as_date
from ..errors import not_found
from ..models import Category, Item, Kitchen, MovementType, StockMovement, Unit, User
from ..schemas import dt, f
from ..services.inventory import item_stock_breakdown

router = APIRouter(prefix="/movements", tags=["movements"])

# CockroachDB type-checks CASE branches strictly: a decimal column and an
# integer literal in the same expression is rejected, so the fallback is a
# decimal too.
ZERO = Decimal("0")

LocationKitchen = aliased(Kitchen, name="location_kitchen")
CounterKitchen = aliased(Kitchen, name="counterparty_kitchen")

LOCATION_LABEL = case(
    (StockMovement.location_type == "MAIN", literal("Main Inventory")),
    else_=LocationKitchen.name,
)


def _movement_row(movement, location_label, counterparty_name, performer_name, extra=None):
    row = {
        "id": movement.id,
        "movement_no": movement.movement_no,
        "movement_type": movement.movement_type,
        "direction": movement.direction,
        "item_id": movement.item_id,
        "quantity": f(movement.quantity),
        "location_type": movement.location_type,
        "kitchen_id": movement.kitchen_id,
        "location_label": location_label,
        "balance_before": f(movement.balance_before),
        "balance_after": f(movement.balance_after),
        "counterparty_type": movement.counterparty_type,
        "counterparty_kitchen_name": counterparty_name,
        "counterparty_label": movement.counterparty_label,
        "reference_type": movement.reference_type,
        "reference_id": movement.reference_id,
        "reference_no": movement.reference_no,
        "unit_cost": f(movement.unit_cost),
        "total_cost": f(movement.total_cost),
        "notes": movement.notes,
        "performed_by_name": performer_name,
        "created_at": dt(movement.created_at),
    }
    if extra:
        row.update(extra)
    return row


@router.get("")
def list_movements(
    db: DbSession,
    user: CurrentUserDep,
    page: PaginationDep,
    item_id: int | None = None,
    kitchen_id: int | None = None,
    location_type: str | None = None,
    movement_type: str | None = None,
    direction: str | None = None,
    reference_no: str | None = None,
    performed_by: int | None = None,
    category_id: int | None = None,
    search: str | None = None,
    from_: Annotated[str | None, Query(alias="from")] = None,
    to: str | None = None,
):
    """
    The complete movement ledger, filterable every way the reports need it.
    Kitchen managers see only rows belonging to their own kitchens.
    """
    base = (
        select(
            StockMovement,
            Item,
            Unit.code,
            Category.name,
            LOCATION_LABEL.label("location_label"),
            CounterKitchen.name.label("counterparty_kitchen_name"),
            User.full_name.label("performed_by_name"),
            User.username.label("performed_by_username"),
        )
        .join(Item, Item.id == StockMovement.item_id)
        .join(Unit, Unit.id == Item.unit_id)
        .outerjoin(Category, Category.id == Item.category_id)
        .outerjoin(LocationKitchen, LocationKitchen.id == StockMovement.kitchen_id)
        .outerjoin(CounterKitchen, CounterKitchen.id == StockMovement.counterparty_kitchen_id)
        .outerjoin(User, User.id == StockMovement.performed_by)
    )

    if not user.is_admin:
        if not user.kitchen_ids:
            return {"data": [], "meta": page.meta(0, total_in=0.0, total_out=0.0)}
        base = base.where(StockMovement.kitchen_id.in_(user.kitchen_ids))

    if item_id:
        base = base.where(StockMovement.item_id == item_id)
    if kitchen_id:
        base = base.where(StockMovement.kitchen_id == kitchen_id)
    if location_type:
        base = base.where(StockMovement.location_type == location_type.upper())
    if movement_type:
        types = [t.strip().upper() for t in movement_type.split(",") if t.strip()]
        base = base.where(StockMovement.movement_type.in_(types))
    if direction:
        base = base.where(StockMovement.direction == direction.upper())
    if reference_no:
        base = base.where(StockMovement.reference_no == reference_no)
    if performed_by:
        base = base.where(StockMovement.performed_by == performed_by)
    if category_id:
        base = base.where(Item.category_id == category_id)
    if search:
        like = f"%{search.strip()}%"
        base = base.where(
            or_(
                Item.name.ilike(like),
                Item.sku.ilike(like),
                StockMovement.movement_no.ilike(like),
                StockMovement.reference_no.ilike(like),
            )
        )
    if from_:
        base = base.where(func.date(StockMovement.created_at) >= as_date(from_))
    if to:
        base = base.where(func.date(StockMovement.created_at) <= as_date(to))

    total = db.execute(
        base.with_only_columns(func.count(StockMovement.id)).order_by(None)
    ).scalar_one()

    totals = db.execute(
        base.with_only_columns(
            func.coalesce(
                func.sum(case((StockMovement.direction == "IN", StockMovement.quantity), else_=ZERO)),
                Decimal("0"),
            ).label("total_in"),
            func.coalesce(
                func.sum(case((StockMovement.direction == "OUT", StockMovement.quantity), else_=ZERO)),
                Decimal("0"),
            ).label("total_out"),
        ).order_by(None)
    ).one()

    rows = db.execute(
        base.order_by(StockMovement.created_at.desc(), StockMovement.id.desc())
        .limit(page.page_size)
        .offset(page.offset)
    ).all()

    data = [
        _movement_row(
            m,
            location_label,
            counterparty_name,
            performer_name,
            {
                "item_name": item.name,
                "sku": item.sku,
                "unit_code": unit_code,
                "category_name": category_name,
                "performed_by_username": performer_username,
            },
        )
        for (
            m,
            item,
            unit_code,
            category_name,
            location_label,
            counterparty_name,
            performer_name,
            performer_username,
        ) in rows
    ]

    return {
        "data": data,
        "meta": page.meta(total, total_in=f(totals.total_in), total_out=f(totals.total_out)),
    }


@router.get("/item/{item_id}")
def item_movements(
    item_id: int,
    db: DbSession,
    user: CurrentUserDep,
    page: PaginationDep,
    kitchen_id: int | None = None,
    from_: Annotated[str | None, Query(alias="from")] = None,
    to: str | None = None,
):
    """
    Item-wise movement history: received, transferred, used, wasted and what is
    on hand right now, broken down per location.
    """
    row = db.execute(
        select(Item, Unit, Category)
        .join(Unit, Unit.id == Item.unit_id)
        .outerjoin(Category, Category.id == Item.category_id)
        .where(Item.id == item_id)
    ).first()
    if row is None:
        raise not_found("Item")

    item, unit, category = row
    item_payload = {
        "id": item.id,
        "sku": item.sku,
        "name": item.name,
        "unit_code": unit.code,
        "unit_name": unit.name,
        "category_name": category.name if category else None,
        "min_stock_level": f(item.min_stock_level),
        "unit_cost": f(item.unit_cost),
    }

    filters = [StockMovement.item_id == item_id]
    if not user.is_admin:
        if not user.kitchen_ids:
            return {
                "data": {
                    "item": item_payload,
                    "stock": None,
                    "summary": {},
                    "movements": [],
                    "meta": page.meta(0),
                }
            }
        filters.append(StockMovement.kitchen_id.in_(user.kitchen_ids))
    if kitchen_id:
        filters.append(StockMovement.kitchen_id == kitchen_id)
    if from_:
        filters.append(func.date(StockMovement.created_at) >= as_date(from_))
    if to:
        filters.append(func.date(StockMovement.created_at) <= as_date(to))

    def total_for(*types, location=None):
        condition = StockMovement.movement_type.in_(types)
        if location:
            condition = condition & (StockMovement.location_type == location)
        return func.coalesce(
            func.sum(case((condition, StockMovement.quantity), else_=ZERO)), Decimal("0")
        )

    summary = db.execute(
        select(
            total_for(MovementType.PURCHASE_RECEIPT.value).label("received"),
            total_for(MovementType.TRANSFER_OUT.value, location="MAIN").label(
                "transferred_out_of_main"
            ),
            total_for(MovementType.TRANSFER_IN.value, location="KITCHEN").label(
                "transferred_to_kitchens"
            ),
            total_for(MovementType.PRODUCTION_CONSUMPTION.value).label("consumed"),
            total_for(MovementType.WASTAGE.value).label("wasted"),
            total_for(MovementType.ADJUSTMENT_INCREASE.value).label("adjusted_up"),
            total_for(MovementType.ADJUSTMENT_DECREASE.value).label("adjusted_down"),
            func.count(StockMovement.id).label("movement_count"),
        ).where(*filters)
    ).one()

    total = db.execute(
        select(func.count(StockMovement.id)).where(*filters)
    ).scalar_one()

    rows = db.execute(
        select(
            StockMovement,
            LOCATION_LABEL.label("location_label"),
            CounterKitchen.name.label("counterparty_kitchen_name"),
            User.full_name.label("performed_by_name"),
        )
        .outerjoin(LocationKitchen, LocationKitchen.id == StockMovement.kitchen_id)
        .outerjoin(CounterKitchen, CounterKitchen.id == StockMovement.counterparty_kitchen_id)
        .outerjoin(User, User.id == StockMovement.performed_by)
        .where(*filters)
        .order_by(StockMovement.created_at.desc(), StockMovement.id.desc())
        .limit(page.page_size)
        .offset(page.offset)
    ).all()

    return {
        "data": {
            "item": item_payload,
            "stock": item_stock_breakdown(db, item_id) if user.is_admin else None,
            "summary": {
                "received": f(summary.received),
                "transferred_out_of_main": f(summary.transferred_out_of_main),
                "transferred_to_kitchens": f(summary.transferred_to_kitchens),
                "consumed": f(summary.consumed),
                "wasted": f(summary.wasted),
                "adjusted_up": f(summary.adjusted_up),
                "adjusted_down": f(summary.adjusted_down),
                "movement_count": summary.movement_count,
            },
            "movements": [
                _movement_row(m, location_label, counterparty_name, performer_name)
                for m, location_label, counterparty_name, performer_name in rows
            ],
            "meta": page.meta(total),
        }
    }
