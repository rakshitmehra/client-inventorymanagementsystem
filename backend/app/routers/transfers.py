from typing import Annotated

from fastapi import APIRouter, Query, Request
from sqlalchemy import func, or_, select
from sqlalchemy.orm import aliased

from ..database import run_in_transaction
from ..deps import AdminUserDep, CurrentUserDep, DbSession, PaginationDep, as_date
from ..errors import forbidden, not_found
from ..models import (
    Category,
    InventoryTransfer,
    InventoryTransferItem,
    Item,
    Kitchen,
    StockMovement,
    Unit,
    User,
)
from ..schemas import TransferRequest, dt, f
from ..services.audit import log_audit
from ..services.operations import create_transfer

router = APIRouter(prefix="/transfers", tags=["transfers"])

FromKitchen = aliased(Kitchen, name="from_kitchen")
ToKitchen = aliased(Kitchen, name="to_kitchen")


def _labels(transfer: InventoryTransfer, from_kitchen, to_kitchen) -> tuple[str, str]:
    source = "Main Inventory" if transfer.from_location_type == "MAIN" else (
        from_kitchen.name if from_kitchen else "-"
    )
    destination = "Main Inventory" if transfer.to_location_type == "MAIN" else (
        to_kitchen.name if to_kitchen else "-"
    )
    return source, destination


def _assert_visible(user, transfer: InventoryTransfer) -> None:
    """A manager may read a transfer only if one of its ends is their kitchen."""
    if user.is_admin:
        return
    mine = user.kitchen_ids
    touches_mine = (
        transfer.from_location_type == "KITCHEN" and transfer.from_kitchen_id in mine
    ) or (transfer.to_location_type == "KITCHEN" and transfer.to_kitchen_id in mine)
    if not touches_mine:
        raise forbidden("This transfer does not involve your kitchen")


@router.get("")
def list_transfers(
    db: DbSession,
    user: CurrentUserDep,
    page: PaginationDep,
    kitchen_id: int | None = None,
    direction: str | None = None,
    search: str | None = None,
    item_id: int | None = None,
    from_: Annotated[str | None, Query(alias="from")] = None,
    to: str | None = None,
):
    base = (
        select(InventoryTransfer, FromKitchen, ToKitchen, User)
        .outerjoin(FromKitchen, FromKitchen.id == InventoryTransfer.from_kitchen_id)
        .outerjoin(ToKitchen, ToKitchen.id == InventoryTransfer.to_kitchen_id)
        .outerjoin(User, User.id == InventoryTransfer.created_by)
    )

    if not user.is_admin:
        if not user.kitchen_ids:
            return {"data": [], "meta": page.meta(0)}
        base = base.where(
            or_(
                InventoryTransfer.from_kitchen_id.in_(user.kitchen_ids),
                InventoryTransfer.to_kitchen_id.in_(user.kitchen_ids),
            )
        )

    if kitchen_id:
        base = base.where(
            or_(
                InventoryTransfer.from_kitchen_id == kitchen_id,
                InventoryTransfer.to_kitchen_id == kitchen_id,
            )
        )
    if direction == "to_kitchen":
        base = base.where(InventoryTransfer.from_location_type == "MAIN")
    elif direction == "to_main":
        base = base.where(InventoryTransfer.to_location_type == "MAIN")
    if search:
        base = base.where(InventoryTransfer.transfer_no.ilike(f"%{search.strip()}%"))
    if from_:
        base = base.where(func.date(InventoryTransfer.transfer_date) >= as_date(from_))
    if to:
        base = base.where(func.date(InventoryTransfer.transfer_date) <= as_date(to))
    if item_id:
        base = base.where(
            select(InventoryTransferItem.id)
            .where(
                InventoryTransferItem.transfer_id == InventoryTransfer.id,
                InventoryTransferItem.item_id == item_id,
            )
            .exists()
        )

    total = db.execute(
        base.with_only_columns(func.count(InventoryTransfer.id)).order_by(None)
    ).scalar_one()

    rows = db.execute(
        base.order_by(InventoryTransfer.transfer_date.desc(), InventoryTransfer.id.desc())
        .limit(page.page_size)
        .offset(page.offset)
    ).all()

    data = []
    for transfer, from_kitchen, to_kitchen, creator in rows:
        source, destination = _labels(transfer, from_kitchen, to_kitchen)
        data.append(
            {
                "id": transfer.id,
                "transfer_no": transfer.transfer_no,
                "from_location_type": transfer.from_location_type,
                "from_kitchen_id": transfer.from_kitchen_id,
                "from_kitchen_name": from_kitchen.name if from_kitchen else None,
                "to_location_type": transfer.to_location_type,
                "to_kitchen_id": transfer.to_kitchen_id,
                "to_kitchen_name": to_kitchen.name if to_kitchen else None,
                "source_label": source,
                "destination_label": destination,
                "status": transfer.status,
                "transfer_date": dt(transfer.transfer_date),
                "total_items": transfer.total_items,
                "total_cost": f(transfer.total_cost),
                "notes": transfer.notes,
                "created_by_name": creator.full_name if creator else None,
            }
        )

    return {"data": data, "meta": page.meta(total)}


@router.get("/{transfer_id}")
def get_transfer(transfer_id: int, db: DbSession, user: CurrentUserDep):
    row = db.execute(
        select(InventoryTransfer, FromKitchen, ToKitchen, User)
        .outerjoin(FromKitchen, FromKitchen.id == InventoryTransfer.from_kitchen_id)
        .outerjoin(ToKitchen, ToKitchen.id == InventoryTransfer.to_kitchen_id)
        .outerjoin(User, User.id == InventoryTransfer.created_by)
        .where(InventoryTransfer.id == transfer_id)
    ).first()
    if row is None:
        raise not_found("Transfer")

    transfer, from_kitchen, to_kitchen, creator = row
    _assert_visible(user, transfer)
    source, destination = _labels(transfer, from_kitchen, to_kitchen)

    item_unit = Unit.__table__.alias("item_unit")
    lines = db.execute(
        select(InventoryTransferItem, Item, Unit.code, item_unit.c.code, Category.name)
        .join(Item, Item.id == InventoryTransferItem.item_id)
        .join(Unit, Unit.id == InventoryTransferItem.unit_id)
        .join(item_unit, item_unit.c.id == Item.unit_id)
        .outerjoin(Category, Category.id == Item.category_id)
        .where(InventoryTransferItem.transfer_id == transfer_id)
        .order_by(Item.name)
    ).all()

    movements = db.execute(
        select(StockMovement, Item.name)
        .join(Item, Item.id == StockMovement.item_id)
        .where(
            StockMovement.reference_type == "TRANSFER",
            StockMovement.reference_id == transfer_id,
        )
        .order_by(StockMovement.id)
    ).all()

    return {
        "data": {
            "id": transfer.id,
            "transfer_no": transfer.transfer_no,
            "from_location_type": transfer.from_location_type,
            "from_kitchen_id": transfer.from_kitchen_id,
            "from_kitchen_name": from_kitchen.name if from_kitchen else None,
            "from_kitchen_code": from_kitchen.code if from_kitchen else None,
            "to_location_type": transfer.to_location_type,
            "to_kitchen_id": transfer.to_kitchen_id,
            "to_kitchen_name": to_kitchen.name if to_kitchen else None,
            "to_kitchen_code": to_kitchen.code if to_kitchen else None,
            "to_kitchen_location": to_kitchen.location if to_kitchen else None,
            "source_label": source,
            "destination_label": destination,
            "status": transfer.status,
            "transfer_date": dt(transfer.transfer_date),
            "total_items": transfer.total_items,
            "total_cost": f(transfer.total_cost),
            "notes": transfer.notes,
            "created_by_name": creator.full_name if creator else None,
            "created_by_username": creator.username if creator else None,
            "items": [
                {
                    "id": line.id,
                    "item_id": item.id,
                    "item_name": item.name,
                    "sku": item.sku,
                    "category_name": category,
                    "quantity": f(line.quantity),
                    "unit_code": unit_code,
                    "base_quantity": f(line.base_quantity),
                    "item_unit_code": base_code,
                    "unit_cost": f(line.unit_cost),
                    "total_cost": f(line.total_cost),
                    "notes": line.notes,
                }
                for line, item, unit_code, base_code, category in lines
            ],
            "movements": [
                {
                    "id": m.id,
                    "movement_no": m.movement_no,
                    "movement_type": m.movement_type,
                    "direction": m.direction,
                    "item_name": item_name,
                    "quantity": f(m.quantity),
                    "location_type": m.location_type,
                    "kitchen_id": m.kitchen_id,
                    "balance_before": f(m.balance_before),
                    "balance_after": f(m.balance_after),
                    "created_at": dt(m.created_at),
                }
                for m, item_name in movements
            ],
        }
    }


@router.post("", status_code=201)
def post_transfer(
    payload: TransferRequest, request: Request, db: DbSession, admin: AdminUserDep
):
    def work(session):
        result = create_transfer(session, payload, admin)
        log_audit(
            session,
            request=request,
            user=admin,
            action="STOCK_TRANSFERRED",
            entity_type="TRANSFER",
            entity_id=result["id"],
            entity_label=result["transfer_no"],
            description=(
                f"Transferred {result['total_items']} item(s) from {result['from_label']} "
                f"to {result['to_label']} ({result['transfer_no']})"
            ),
            metadata={
                "from": result["from_label"],
                "to": result["to_label"],
                "total_cost": result["total_cost"],
                "items": [line.model_dump() for line in payload.items],
            },
        )
        return result

    result = run_in_transaction(db, work)
    return {
        "data": result,
        "message": (
            f"Transfer {result['transfer_no']} completed - {result['total_items']} "
            f"item(s) moved to {result['to_label']}"
        ),
    }
