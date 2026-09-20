"""
Wastage and adjustments.

Both happen either at the Main Inventory (admin only) or at a kitchen (admin, or
that kitchen's manager), so they share the same access rules and list shape.
"""

from decimal import Decimal

from typing import Annotated

from fastapi import APIRouter, Query, Request
from sqlalchemy import case, func, literal, or_, select

from ..database import run_in_transaction
from ..deps import CurrentUserDep, DbSession, PaginationDep, as_date, assert_location_access
from ..errors import forbidden, not_found
from ..models import (
    InventoryAdjustment,
    Item,
    Kitchen,
    Unit,
    User,
    WastageRecord,
)
from ..schemas import AdjustmentRequest, WastageRequest, dt, f
from ..services.audit import log_audit
from ..services.operations import create_adjustment, record_wastage

router = APIRouter(tags=["stock-records"])


def _scope(user, model, base):
    """Restrict a list query to the caller's own kitchens."""
    if user.is_admin:
        return base, True
    if not user.kitchen_ids:
        return base, False
    return base.where(model.kitchen_id.in_(user.kitchen_ids)), True


def _location_label(model, kitchen_alias):
    return case(
        (model.location_type == "MAIN", literal("Main Inventory")),
        else_=kitchen_alias.name,
    )


# --------------------------------------------------------------- wastage ----
@router.post("/wastage", status_code=201)
def create_wastage(
    payload: WastageRequest, request: Request, db: DbSession, user: CurrentUserDep
):
    assert_location_access(user, payload.location_type, payload.kitchen_id)

    item = db.get(Item, payload.item_id)
    place = (
        "Main Inventory"
        if payload.location_type == "MAIN"
        else (db.get(Kitchen, payload.kitchen_id).name if payload.kitchen_id else "-")
    )

    def work(session):
        result = record_wastage(session, payload, user)
        log_audit(
            session,
            request=request,
            user=user,
            action="WASTAGE_RECORDED",
            entity_type="WASTAGE",
            entity_id=result["id"],
            entity_label=result["wastage_no"],
            description=(
                f"Recorded wastage of {payload.quantity} "
                f"{item.name if item else payload.item_id} at {place} "
                f"({payload.reason_code})"
            ),
            metadata={**payload.model_dump(), "estimated_cost": result["estimated_cost"]},
        )
        return result

    result = run_in_transaction(db, work)
    return {"data": result, "message": f"Wastage {result['wastage_no']} recorded"}


@router.get("/wastage")
def list_wastage(
    db: DbSession,
    user: CurrentUserDep,
    page: PaginationDep,
    kitchen_id: int | None = None,
    location_type: str | None = None,
    item_id: int | None = None,
    reason_code: str | None = None,
    search: str | None = None,
    from_: Annotated[str | None, Query(alias="from")] = None,
    to: str | None = None,
):
    base = (
        select(WastageRecord, Item, Unit.code, Kitchen, User)
        .join(Item, Item.id == WastageRecord.item_id)
        .join(Unit, Unit.id == WastageRecord.unit_id)
        .outerjoin(Kitchen, Kitchen.id == WastageRecord.kitchen_id)
        .outerjoin(User, User.id == WastageRecord.recorded_by)
    )

    base, allowed = _scope(user, WastageRecord, base)
    if not allowed:
        return {"data": [], "meta": page.meta(0, total_cost=0.0)}

    if kitchen_id:
        base = base.where(WastageRecord.kitchen_id == kitchen_id)
    if location_type:
        base = base.where(WastageRecord.location_type == location_type.upper())
    if item_id:
        base = base.where(WastageRecord.item_id == item_id)
    if reason_code:
        base = base.where(WastageRecord.reason_code == reason_code.upper())
    if search:
        like = f"%{search.strip()}%"
        base = base.where(or_(WastageRecord.wastage_no.ilike(like), Item.name.ilike(like)))
    if from_:
        base = base.where(func.date(WastageRecord.recorded_at) >= as_date(from_))
    if to:
        base = base.where(func.date(WastageRecord.recorded_at) <= as_date(to))

    total = db.execute(
        base.with_only_columns(func.count(WastageRecord.id)).order_by(None)
    ).scalar_one()
    total_cost = db.execute(
        base.with_only_columns(
            func.coalesce(func.sum(WastageRecord.estimated_cost), Decimal("0"))
        ).order_by(None)
    ).scalar_one()

    rows = db.execute(
        base.order_by(WastageRecord.recorded_at.desc(), WastageRecord.id.desc())
        .limit(page.page_size)
        .offset(page.offset)
    ).all()

    return {
        "data": [
            {
                "id": record.id,
                "wastage_no": record.wastage_no,
                "location_type": record.location_type,
                "location_label": (
                    "Main Inventory" if record.location_type == "MAIN" else (kitchen.name if kitchen else None)
                ),
                "kitchen_id": record.kitchen_id,
                "kitchen_name": kitchen.name if kitchen else None,
                "item_id": item.id,
                "item_name": item.name,
                "sku": item.sku,
                "quantity": f(record.quantity),
                "unit_code": unit_code,
                "base_quantity": f(record.base_quantity),
                "reason_code": record.reason_code,
                "reason": record.reason,
                "estimated_cost": f(record.estimated_cost),
                "recorded_at": dt(record.recorded_at),
                "recorded_by_name": recorder.full_name if recorder else None,
            }
            for record, item, unit_code, kitchen, recorder in rows
        ],
        "meta": page.meta(total, total_cost=f(total_cost)),
    }


@router.get("/wastage/{wastage_id}")
def get_wastage(wastage_id: int, db: DbSession, user: CurrentUserDep):
    row = db.execute(
        select(WastageRecord, Item, Unit.code, Kitchen, User)
        .join(Item, Item.id == WastageRecord.item_id)
        .join(Unit, Unit.id == WastageRecord.unit_id)
        .outerjoin(Kitchen, Kitchen.id == WastageRecord.kitchen_id)
        .outerjoin(User, User.id == WastageRecord.recorded_by)
        .where(WastageRecord.id == wastage_id)
    ).first()
    if row is None:
        raise not_found("Wastage record")

    record, item, unit_code, kitchen, recorder = row
    if not user.is_admin and record.kitchen_id not in user.kitchen_ids:
        raise forbidden("This record belongs to another location")

    return {
        "data": {
            "id": record.id,
            "wastage_no": record.wastage_no,
            "location_type": record.location_type,
            "location_label": (
                "Main Inventory" if record.location_type == "MAIN" else (kitchen.name if kitchen else None)
            ),
            "kitchen_name": kitchen.name if kitchen else None,
            "kitchen_code": kitchen.code if kitchen else None,
            "item_name": item.name,
            "sku": item.sku,
            "quantity": f(record.quantity),
            "unit_code": unit_code,
            "base_quantity": f(record.base_quantity),
            "item_unit_code": item.unit.code,
            "reason_code": record.reason_code,
            "reason": record.reason,
            "estimated_cost": f(record.estimated_cost),
            "recorded_at": dt(record.recorded_at),
            "recorded_by_name": recorder.full_name if recorder else None,
        }
    }


# ----------------------------------------------------------- adjustments ----
@router.post("/adjustments", status_code=201)
def create_adjustment_route(
    payload: AdjustmentRequest, request: Request, db: DbSession, user: CurrentUserDep
):
    assert_location_access(user, payload.location_type, payload.kitchen_id)

    item = db.get(Item, payload.item_id)
    place = (
        "Main Inventory"
        if payload.location_type == "MAIN"
        else (db.get(Kitchen, payload.kitchen_id).name if payload.kitchen_id else "-")
    )

    def work(session):
        result = create_adjustment(session, payload, user)
        log_audit(
            session,
            request=request,
            user=user,
            action="STOCK_ADJUSTED",
            entity_type="ADJUSTMENT",
            entity_id=result["id"],
            entity_label=result["adjustment_no"],
            description=(
                f"Adjusted {item.name if item else payload.item_id} at {place} from "
                f"{result['previous_quantity']} to {result['new_quantity']} "
                f"({payload.reason_code})"
            ),
            metadata=result,
        )
        return result

    result = run_in_transaction(db, work)
    return {"data": result, "message": f"Adjustment {result['adjustment_no']} recorded"}


@router.get("/adjustments")
def list_adjustments(
    db: DbSession,
    user: CurrentUserDep,
    page: PaginationDep,
    kitchen_id: int | None = None,
    location_type: str | None = None,
    item_id: int | None = None,
    adjustment_type: str | None = None,
    reason_code: str | None = None,
    search: str | None = None,
    from_: Annotated[str | None, Query(alias="from")] = None,
    to: str | None = None,
):
    base = (
        select(InventoryAdjustment, Item, Unit.code, Kitchen, User)
        .join(Item, Item.id == InventoryAdjustment.item_id)
        .join(Unit, Unit.id == Item.unit_id)
        .outerjoin(Kitchen, Kitchen.id == InventoryAdjustment.kitchen_id)
        .outerjoin(User, User.id == InventoryAdjustment.created_by)
    )

    base, allowed = _scope(user, InventoryAdjustment, base)
    if not allowed:
        return {"data": [], "meta": page.meta(0)}

    if kitchen_id:
        base = base.where(InventoryAdjustment.kitchen_id == kitchen_id)
    if location_type:
        base = base.where(InventoryAdjustment.location_type == location_type.upper())
    if item_id:
        base = base.where(InventoryAdjustment.item_id == item_id)
    if adjustment_type:
        base = base.where(InventoryAdjustment.adjustment_type == adjustment_type.upper())
    if reason_code:
        base = base.where(InventoryAdjustment.reason_code == reason_code.upper())
    if search:
        like = f"%{search.strip()}%"
        base = base.where(
            or_(InventoryAdjustment.adjustment_no.ilike(like), Item.name.ilike(like))
        )
    if from_:
        base = base.where(func.date(InventoryAdjustment.adjusted_at) >= as_date(from_))
    if to:
        base = base.where(func.date(InventoryAdjustment.adjusted_at) <= as_date(to))

    total = db.execute(
        base.with_only_columns(func.count(InventoryAdjustment.id)).order_by(None)
    ).scalar_one()

    rows = db.execute(
        base.order_by(InventoryAdjustment.adjusted_at.desc(), InventoryAdjustment.id.desc())
        .limit(page.page_size)
        .offset(page.offset)
    ).all()

    return {
        "data": [
            {
                "id": record.id,
                "adjustment_no": record.adjustment_no,
                "location_type": record.location_type,
                "location_label": (
                    "Main Inventory" if record.location_type == "MAIN" else (kitchen.name if kitchen else None)
                ),
                "kitchen_id": record.kitchen_id,
                "kitchen_name": kitchen.name if kitchen else None,
                "item_id": item.id,
                "item_name": item.name,
                "sku": item.sku,
                "unit_code": unit_code,
                "previous_quantity": f(record.previous_quantity),
                "new_quantity": f(record.new_quantity),
                "difference": f(record.difference),
                "adjustment_type": record.adjustment_type,
                "reason_code": record.reason_code,
                "reason": record.reason,
                "adjusted_at": dt(record.adjusted_at),
                "created_by_name": creator.full_name if creator else None,
            }
            for record, item, unit_code, kitchen, creator in rows
        ],
        "meta": page.meta(total),
    }
