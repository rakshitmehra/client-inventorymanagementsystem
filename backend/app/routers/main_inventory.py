from decimal import Decimal

from typing import Annotated

from fastapi import APIRouter, Query, Request
from sqlalchemy import func, or_, select

from ..database import run_in_transaction
from ..deps import AdminUserDep, DbSession, PaginationDep, as_date, sort_clause
from ..errors import not_found
from ..models import (
    Category,
    Item,
    KitchenInventory,
    MainInventory,
    StockReceipt,
    StockReceiptItem,
    Supplier,
    Unit,
    User,
)
from ..schemas import GoodsReceiptRequest, dt, f
from ..security import q
from ..services.audit import log_audit
from ..services.operations import receive_stock

router = APIRouter(prefix="/main-inventory", tags=["main-inventory"])

MAIN_QTY = func.coalesce(MainInventory.quantity, Decimal("0"))
IN_KITCHENS = (
    select(func.coalesce(func.sum(KitchenInventory.quantity), Decimal("0")))
    .where(KitchenInventory.item_id == Item.id)
    .scalar_subquery()
)

SORTS = {
    "name": Item.name,
    "sku": Item.sku,
    "category": Category.name,
    "quantity": MAIN_QTY,
    "value": MAIN_QTY * Item.unit_cost,
    "min_level": Item.min_stock_level,
    "updated_at": MainInventory.updated_at,
}


# ------------------------------------------------- main inventory listing ---
@router.get("")
def list_main_inventory(
    db: DbSession,
    _admin: AdminUserDep,
    page: PaginationDep,
    search: str | None = None,
    category_id: int | None = None,
    supplier_id: int | None = None,
    stock_status: str | None = None,
    include_inactive: bool = False,
    sort: str | None = "name",
    order: str | None = "asc",
):
    base = (
        select(Item, Unit, Category, Supplier, MAIN_QTY.label("qty"), IN_KITCHENS.label("in_kitchens"))
        .join(Unit, Unit.id == Item.unit_id)
        .outerjoin(MainInventory, MainInventory.item_id == Item.id)
        .outerjoin(Category, Category.id == Item.category_id)
        .outerjoin(Supplier, Supplier.id == Item.default_supplier_id)
    )

    if not include_inactive:
        base = base.where(Item.is_active.is_(True))
    if search:
        like = f"%{search.strip()}%"
        base = base.where(or_(Item.name.ilike(like), Item.sku.ilike(like)))
    if category_id:
        base = base.where(Item.category_id == category_id)
    if supplier_id:
        base = base.where(Item.default_supplier_id == supplier_id)
    if stock_status == "low":
        base = base.where(MAIN_QTY > 0, MAIN_QTY <= Item.min_stock_level)
    elif stock_status == "out":
        base = base.where(MAIN_QTY <= 0)
    elif stock_status == "in":
        base = base.where(MAIN_QTY > Item.min_stock_level)

    total = db.execute(base.with_only_columns(func.count(Item.id)).order_by(None)).scalar_one()
    stock_value = db.execute(
        base.with_only_columns(
            func.coalesce(func.sum(MAIN_QTY * Item.unit_cost), Decimal("0"))
        ).order_by(None)
    ).scalar_one()

    rows = db.execute(
        base.order_by(sort_clause(sort, order, SORTS, "name"))
        .limit(page.page_size)
        .offset(page.offset)
    ).all()

    data = []
    for item, unit, category, supplier, qty, in_kitchens in rows:
        if qty <= 0:
            status = "OUT"
        elif qty <= item.min_stock_level:
            status = "LOW"
        else:
            status = "OK"

        data.append(
            {
                "item_id": item.id,
                "sku": item.sku,
                "item_name": item.name,
                "quantity": f(qty),
                "in_kitchens": f(in_kitchens),
                "min_stock_level": f(item.min_stock_level),
                "max_stock_level": (
                    f(item.max_stock_level) if item.max_stock_level is not None else None
                ),
                "reorder_quantity": f(item.reorder_quantity),
                "unit_cost": f(item.unit_cost),
                "unit_id": unit.id,
                "unit_code": unit.code,
                "unit_name": unit.name,
                "category_id": category.id if category else None,
                "category_name": category.name if category else None,
                "supplier_name": supplier.name if supplier else None,
                "stock_value": f(q(qty * item.unit_cost)),
                "stock_status": status,
                "is_active": item.is_active,
                "is_perishable": item.is_perishable,
                "updated_at": None,
            }
        )

    # Fill in the last-movement timestamp for the rows on this page.
    item_ids = [row["item_id"] for row in data]
    if item_ids:
        stamps = dict(
            db.execute(
                select(MainInventory.item_id, MainInventory.updated_at).where(
                    MainInventory.item_id.in_(item_ids)
                )
            ).all()
        )
        for row in data:
            row["updated_at"] = dt(stamps.get(row["item_id"]))

    return {"data": data, "meta": page.meta(total, stock_value=f(stock_value))}


# ---------------------------------------------------------- goods receipts --
@router.get("/receipts")
def list_receipts(
    db: DbSession,
    _admin: AdminUserDep,
    page: PaginationDep,
    supplier_id: int | None = None,
    search: str | None = None,
    from_: Annotated[str | None, Query(alias="from")] = None,
    to: str | None = None,
):
    base = (
        select(StockReceipt, Supplier, User)
        .outerjoin(Supplier, Supplier.id == StockReceipt.supplier_id)
        .outerjoin(User, User.id == StockReceipt.created_by)
    )

    if supplier_id:
        base = base.where(StockReceipt.supplier_id == supplier_id)
    if search:
        like = f"%{search.strip()}%"
        base = base.where(
            or_(StockReceipt.receipt_no.ilike(like), StockReceipt.invoice_no.ilike(like))
        )
    if from_:
        base = base.where(func.date(StockReceipt.received_at) >= as_date(from_))
    if to:
        base = base.where(func.date(StockReceipt.received_at) <= as_date(to))

    total = db.execute(
        base.with_only_columns(func.count(StockReceipt.id)).order_by(None)
    ).scalar_one()

    rows = db.execute(
        base.order_by(StockReceipt.received_at.desc(), StockReceipt.id.desc())
        .limit(page.page_size)
        .offset(page.offset)
    ).all()

    return {
        "data": [
            {
                "id": receipt.id,
                "receipt_no": receipt.receipt_no,
                "supplier_id": receipt.supplier_id,
                "supplier_name": supplier.name if supplier else None,
                "invoice_no": receipt.invoice_no,
                "received_at": dt(receipt.received_at),
                "total_items": receipt.total_items,
                "total_cost": f(receipt.total_cost),
                "notes": receipt.notes,
                "created_by_name": user.full_name if user else None,
            }
            for receipt, supplier, user in rows
        ],
        "meta": page.meta(total),
    }


@router.get("/receipts/{receipt_id}")
def get_receipt(receipt_id: int, db: DbSession, _admin: AdminUserDep):
    row = db.execute(
        select(StockReceipt, Supplier, User)
        .outerjoin(Supplier, Supplier.id == StockReceipt.supplier_id)
        .outerjoin(User, User.id == StockReceipt.created_by)
        .where(StockReceipt.id == receipt_id)
    ).first()
    if row is None:
        raise not_found("Goods receipt")

    receipt, supplier, user = row
    item_unit = Unit.__table__.alias("item_unit")

    lines = db.execute(
        select(StockReceiptItem, Item, Unit.code, item_unit.c.code)
        .join(Item, Item.id == StockReceiptItem.item_id)
        .join(Unit, Unit.id == StockReceiptItem.unit_id)
        .join(item_unit, item_unit.c.id == Item.unit_id)
        .where(StockReceiptItem.receipt_id == receipt_id)
        .order_by(Item.name)
    ).all()

    return {
        "data": {
            "id": receipt.id,
            "receipt_no": receipt.receipt_no,
            "supplier_name": supplier.name if supplier else None,
            "contact_person": supplier.contact_person if supplier else None,
            "supplier_phone": supplier.phone if supplier else None,
            "invoice_no": receipt.invoice_no,
            "received_at": dt(receipt.received_at),
            "total_items": receipt.total_items,
            "total_cost": f(receipt.total_cost),
            "notes": receipt.notes,
            "created_by_name": user.full_name if user else None,
            "items": [
                {
                    "id": line.id,
                    "item_id": item.id,
                    "item_name": item.name,
                    "sku": item.sku,
                    "quantity": f(line.quantity),
                    "unit_code": unit_code,
                    "base_quantity": f(line.base_quantity),
                    "item_unit_code": base_code,
                    "unit_cost": f(line.unit_cost),
                    "total_cost": f(line.total_cost),
                    "batch_no": line.batch_no,
                    "expiry_date": line.expiry_date,
                    "notes": line.notes,
                }
                for line, item, unit_code, base_code in lines
            ],
        }
    }


@router.post("/receipts", status_code=201)
def create_receipt(
    payload: GoodsReceiptRequest, request: Request, db: DbSession, admin: AdminUserDep
):
    def work(session):
        result = receive_stock(session, payload, admin)
        log_audit(
            session,
            request=request,
            user=admin,
            action="STOCK_RECEIVED",
            entity_type="RECEIPT",
            entity_id=result["id"],
            entity_label=result["receipt_no"],
            description=(
                f"Received {result['total_items']} item(s) into the Main Inventory "
                f"({result['receipt_no']})"
            ),
            metadata={
                "supplier_id": payload.supplier_id,
                "total_cost": result["total_cost"],
            },
        )
        return result

    result = run_in_transaction(db, work)
    return {"data": result, "message": f"Goods receipt {result['receipt_no']} recorded"}
