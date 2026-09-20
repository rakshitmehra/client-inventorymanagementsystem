"""
Printable documents.

Each builder returns a uniform envelope (header, parties, lines, totals,
signatures) so one print component on the client can render a transfer slip, a
production slip, a goods receipt, a wastage note and an adjustment note.
"""

from datetime import UTC, datetime
from decimal import Decimal

from fastapi import APIRouter
from sqlalchemy import func, select
from sqlalchemy.orm import aliased

from ..deps import CurrentUser, CurrentUserDep, DbSession
from ..errors import bad_request, forbidden, not_found
from ..models import (
    Category,
    ConsumptionRecord,
    DocumentPrint,
    InventoryAdjustment,
    InventoryTransfer,
    InventoryTransferItem,
    Item,
    Kitchen,
    KitchenManager,
    Product,
    ProductionRecord,
    Recipe,
    Setting,
    StockReceipt,
    StockReceiptItem,
    Supplier,
    Unit,
    User,
    WastageRecord,
)
from ..schemas import dt, f

router = APIRouter(prefix="/documents", tags=["documents"])


def _company(db) -> dict:
    rows = db.execute(select(Setting).where(Setting.key.like("company_%"))).scalars().all()
    values = {row.key: row.value for row in rows}
    return {
        "name": values.get("company_name") or "KitchenStock",
        "address": values.get("company_address") or "",
        "phone": values.get("company_phone") or "",
        "email": values.get("company_email") or "",
        "currency": values.get("company_currency") or "INR",
    }


def _kitchen_of(db, kitchen_id: int | None) -> dict | None:
    if not kitchen_id:
        return None
    kitchen = db.get(Kitchen, kitchen_id)
    if kitchen is None:
        return None

    manager = db.execute(
        select(User)
        .join(KitchenManager, KitchenManager.user_id == User.id)
        .where(KitchenManager.kitchen_id == kitchen_id, KitchenManager.is_active.is_(True))
        .order_by(KitchenManager.is_primary.desc())
        .limit(1)
    ).scalar_one_or_none()

    return {
        "id": kitchen.id,
        "code": kitchen.code,
        "name": kitchen.name,
        "location": kitchen.location,
        "phone": kitchen.phone,
        "manager_name": manager.full_name if manager else None,
        "manager_phone": manager.phone if manager else None,
    }


def _assert_visible(user: CurrentUser, kitchen_ids: list[int | None]) -> None:
    if user.is_admin:
        return
    relevant = [kid for kid in kitchen_ids if kid]
    if not any(kid in user.kitchen_ids for kid in relevant):
        raise forbidden("This document does not belong to your kitchen")


# ------------------------------------------------------------- transfer -----
def _build_transfer(db, user: CurrentUser, document_id: int) -> dict:
    FromKitchen = aliased(Kitchen, name="from_kitchen")
    ToKitchen = aliased(Kitchen, name="to_kitchen")

    row = db.execute(
        select(InventoryTransfer, FromKitchen.name, ToKitchen.name, User)
        .outerjoin(FromKitchen, FromKitchen.id == InventoryTransfer.from_kitchen_id)
        .outerjoin(ToKitchen, ToKitchen.id == InventoryTransfer.to_kitchen_id)
        .outerjoin(User, User.id == InventoryTransfer.created_by)
        .where(InventoryTransfer.id == document_id)
    ).first()
    if row is None:
        raise not_found("Transfer")

    transfer, from_name, to_name, creator = row
    _assert_visible(user, [transfer.from_kitchen_id, transfer.to_kitchen_id])

    source = "Main Inventory" if transfer.from_location_type == "MAIN" else from_name
    destination = "Main Inventory" if transfer.to_location_type == "MAIN" else to_name

    item_unit = Unit.__table__.alias("item_unit")
    lines = db.execute(
        select(InventoryTransferItem, Item, Unit.code, item_unit.c.code, Category.name)
        .join(Item, Item.id == InventoryTransferItem.item_id)
        .join(Unit, Unit.id == InventoryTransferItem.unit_id)
        .join(item_unit, item_unit.c.id == Item.unit_id)
        .outerjoin(Category, Category.id == Item.category_id)
        .where(InventoryTransferItem.transfer_id == document_id)
        .order_by(Item.name)
    ).all()

    # The slip is addressed to the kitchen involved in the move.
    kitchen_id = (
        transfer.to_kitchen_id
        if transfer.to_location_type == "KITCHEN"
        else transfer.from_kitchen_id
    )

    return {
        "document_type": "TRANSFER",
        "title": (
            "Stock Transfer Slip"
            if transfer.to_location_type == "KITCHEN"
            else "Stock Return Slip"
        ),
        "document_no": transfer.transfer_no,
        "document_date": dt(transfer.transfer_date),
        "status": transfer.status,
        "kitchen": _kitchen_of(db, kitchen_id),
        "parties": {"source": source, "destination": destination},
        "performed_by": {
            "name": creator.full_name if creator else None,
            "username": creator.username if creator else None,
        },
        "notes": transfer.notes,
        "lines": [
            {
                "item_name": item.name,
                "sku": item.sku,
                "category": category,
                "quantity": f(line.quantity),
                "unit_code": unit_code,
                "base_quantity": f(line.base_quantity),
                "base_unit_code": base_code,
                "unit_cost": f(line.unit_cost),
                "total_cost": f(line.total_cost),
                "notes": line.notes,
            }
            for line, item, unit_code, base_code, category in lines
        ],
        "totals": {"line_count": len(lines), "total_cost": f(transfer.total_cost)},
        "signatures": ["Issued by", "Received by"],
        "kitchen_id": kitchen_id,
    }


# ----------------------------------------------------------- production -----
def _build_production(db, user: CurrentUser, document_id: int) -> dict:
    row = db.execute(
        select(ProductionRecord, Product, Recipe, Unit.code, User)
        .join(Product, Product.id == ProductionRecord.product_id)
        .join(Recipe, Recipe.id == ProductionRecord.recipe_id)
        .join(Unit, Unit.id == ProductionRecord.output_unit_id)
        .outerjoin(User, User.id == ProductionRecord.created_by)
        .where(ProductionRecord.id == document_id)
    ).first()
    if row is None:
        raise not_found("Production record")

    record, product, recipe, output_unit, creator = row
    _assert_visible(user, [record.kitchen_id])

    lines = db.execute(
        select(ConsumptionRecord, Item, Unit.code, Category.name)
        .join(Item, Item.id == ConsumptionRecord.item_id)
        .join(Unit, Unit.id == ConsumptionRecord.unit_id)
        .outerjoin(Category, Category.id == Item.category_id)
        .where(ConsumptionRecord.production_id == document_id)
        .order_by(Item.name)
    ).all()

    return {
        "document_type": "PRODUCTION",
        "title": "Production Slip",
        "document_no": record.production_no,
        "document_date": dt(record.produced_at),
        "status": record.status,
        "kitchen": _kitchen_of(db, record.kitchen_id),
        "product": {
            "name": product.name,
            "sku": product.sku,
            "output_quantity": f(record.output_quantity),
            "unit_code": output_unit,
            "recipe": f"{recipe.name} (v{recipe.version})",
            "batches": f(record.batch_quantity),
        },
        "performed_by": {
            "name": creator.full_name if creator else None,
            "username": creator.username if creator else None,
        },
        "notes": record.notes,
        "lines": [
            {
                "item_name": item.name,
                "sku": item.sku,
                "category": category,
                "quantity": f(line.consumed_quantity),
                "unit_code": unit_code,
                "balance_after": f(line.balance_after),
                "unit_cost": f(line.unit_cost),
                "total_cost": f(line.total_cost),
            }
            for line, item, unit_code, category in lines
        ],
        "totals": {"line_count": len(lines), "total_cost": f(record.total_cost)},
        "signatures": ["Prepared by", "Verified by"],
        "kitchen_id": record.kitchen_id,
    }


# -------------------------------------------------------------- receipt -----
def _build_receipt(db, user: CurrentUser, document_id: int) -> dict:
    if not user.is_admin:
        raise forbidden("Goods receipts are visible to administrators only")

    row = db.execute(
        select(StockReceipt, Supplier, User)
        .outerjoin(Supplier, Supplier.id == StockReceipt.supplier_id)
        .outerjoin(User, User.id == StockReceipt.created_by)
        .where(StockReceipt.id == document_id)
    ).first()
    if row is None:
        raise not_found("Goods receipt")

    receipt, supplier, creator = row
    item_unit = Unit.__table__.alias("item_unit")

    lines = db.execute(
        select(StockReceiptItem, Item, Unit.code, item_unit.c.code, Category.name)
        .join(Item, Item.id == StockReceiptItem.item_id)
        .join(Unit, Unit.id == StockReceiptItem.unit_id)
        .join(item_unit, item_unit.c.id == Item.unit_id)
        .outerjoin(Category, Category.id == Item.category_id)
        .where(StockReceiptItem.receipt_id == document_id)
        .order_by(Item.name)
    ).all()

    return {
        "document_type": "RECEIPT",
        "title": "Goods Receipt Note",
        "document_no": receipt.receipt_no,
        "document_date": dt(receipt.received_at),
        "status": "COMPLETED",
        "kitchen": None,
        "parties": {
            "source": supplier.name if supplier else "External supplier",
            "destination": "Main Inventory",
        },
        "supplier": {
            "name": supplier.name if supplier else None,
            "contact_person": supplier.contact_person if supplier else None,
            "phone": supplier.phone if supplier else None,
            "address": supplier.address if supplier else None,
            "invoice_no": receipt.invoice_no,
        },
        "performed_by": {
            "name": creator.full_name if creator else None,
            "username": creator.username if creator else None,
        },
        "notes": receipt.notes,
        "lines": [
            {
                "item_name": item.name,
                "sku": item.sku,
                "category": category,
                "quantity": f(line.quantity),
                "unit_code": unit_code,
                "base_quantity": f(line.base_quantity),
                "base_unit_code": base_code,
                "unit_cost": f(line.unit_cost),
                "total_cost": f(line.total_cost),
                "batch_no": line.batch_no,
                "expiry_date": line.expiry_date,
            }
            for line, item, unit_code, base_code, category in lines
        ],
        "totals": {"line_count": len(lines), "total_cost": f(receipt.total_cost)},
        "signatures": ["Received by", "Checked by"],
        "kitchen_id": None,
    }


# -------------------------------------------------------------- wastage -----
def _build_wastage(db, user: CurrentUser, document_id: int) -> dict:
    item_unit = Unit.__table__.alias("item_unit")

    row = db.execute(
        select(WastageRecord, Item, Unit.code, item_unit.c.code, Category.name, Kitchen, User)
        .join(Item, Item.id == WastageRecord.item_id)
        .join(Unit, Unit.id == WastageRecord.unit_id)
        .join(item_unit, item_unit.c.id == Item.unit_id)
        .outerjoin(Category, Category.id == Item.category_id)
        .outerjoin(Kitchen, Kitchen.id == WastageRecord.kitchen_id)
        .outerjoin(User, User.id == WastageRecord.recorded_by)
        .where(WastageRecord.id == document_id)
    ).first()
    if row is None:
        raise not_found("Wastage record")

    record, item, unit_code, base_code, category, kitchen, recorder = row
    if record.location_type == "MAIN" and not user.is_admin:
        raise forbidden("This document does not belong to your kitchen")
    _assert_visible(user, [record.kitchen_id])

    location_label = "Main Inventory" if record.location_type == "MAIN" else (
        kitchen.name if kitchen else "-"
    )
    unit_cost = (
        record.estimated_cost / record.base_quantity if record.base_quantity else Decimal("0")
    )

    return {
        "document_type": "WASTAGE",
        "title": "Wastage Note",
        "document_no": record.wastage_no,
        "document_date": dt(record.recorded_at),
        "status": "RECORDED",
        "kitchen": _kitchen_of(db, record.kitchen_id),
        "parties": {
            "source": location_label,
            "destination": f"Written off ({record.reason_code})",
        },
        "performed_by": {
            "name": recorder.full_name if recorder else None,
            "username": recorder.username if recorder else None,
        },
        "notes": record.reason,
        "lines": [
            {
                "item_name": item.name,
                "sku": item.sku,
                "category": category,
                "quantity": f(record.quantity),
                "unit_code": unit_code,
                "base_quantity": f(record.base_quantity),
                "base_unit_code": base_code,
                "unit_cost": f(unit_cost),
                "total_cost": f(record.estimated_cost),
                "reason": record.reason_code,
            }
        ],
        "totals": {"line_count": 1, "total_cost": f(record.estimated_cost)},
        "signatures": ["Recorded by", "Approved by"],
        "kitchen_id": record.kitchen_id,
    }


# ----------------------------------------------------------- adjustment -----
def _build_adjustment(db, user: CurrentUser, document_id: int) -> dict:
    row = db.execute(
        select(InventoryAdjustment, Item, Unit.code, Category.name, Kitchen, User)
        .join(Item, Item.id == InventoryAdjustment.item_id)
        .join(Unit, Unit.id == Item.unit_id)
        .outerjoin(Category, Category.id == Item.category_id)
        .outerjoin(Kitchen, Kitchen.id == InventoryAdjustment.kitchen_id)
        .outerjoin(User, User.id == InventoryAdjustment.created_by)
        .where(InventoryAdjustment.id == document_id)
    ).first()
    if row is None:
        raise not_found("Adjustment")

    record, item, unit_code, category, kitchen, creator = row
    if record.location_type == "MAIN" and not user.is_admin:
        raise forbidden("This document does not belong to your kitchen")
    _assert_visible(user, [record.kitchen_id])

    location_label = "Main Inventory" if record.location_type == "MAIN" else (
        kitchen.name if kitchen else "-"
    )
    moved = abs(record.difference)
    value = moved * item.unit_cost

    return {
        "document_type": "ADJUSTMENT",
        "title": "Stock Adjustment Note",
        "document_no": record.adjustment_no,
        "document_date": dt(record.adjusted_at),
        "status": record.adjustment_type,
        "kitchen": _kitchen_of(db, record.kitchen_id),
        "parties": {
            "source": location_label,
            "destination": f"Adjustment ({record.reason_code})",
        },
        "performed_by": {
            "name": creator.full_name if creator else None,
            "username": creator.username if creator else None,
        },
        "notes": record.reason,
        "lines": [
            {
                "item_name": item.name,
                "sku": item.sku,
                "category": category,
                "previous_quantity": f(record.previous_quantity),
                "quantity": f(moved),
                "new_quantity": f(record.new_quantity),
                "unit_code": unit_code,
                "unit_cost": f(item.unit_cost),
                "total_cost": f(value),
                "reason": record.reason_code,
            }
        ],
        "totals": {"line_count": 1, "total_cost": f(value)},
        "signatures": ["Adjusted by", "Approved by"],
        "kitchen_id": record.kitchen_id,
    }


BUILDERS = {
    "TRANSFER": _build_transfer,
    "PRODUCTION": _build_production,
    "RECEIPT": _build_receipt,
    "WASTAGE": _build_wastage,
    "ADJUSTMENT": _build_adjustment,
}


@router.get("/{document_type}/{document_id}")
def get_document(
    document_type: str, document_id: int, db: DbSession, user: CurrentUserDep
):
    key = document_type.upper()
    builder = BUILDERS.get(key)
    if builder is None:
        raise bad_request(f'Unknown document type "{document_type}"')

    document = builder(db, user, document_id)
    print_count = db.execute(
        select(func.count(DocumentPrint.id)).where(
            DocumentPrint.document_type == key, DocumentPrint.document_id == document_id
        )
    ).scalar_one()

    return {
        "data": {
            **document,
            "company": _company(db),
            "generated_at": datetime.now(UTC).isoformat(),
            "generated_for": user.full_name,
            "print_count": print_count,
        }
    }


@router.post("/{document_type}/{document_id}/print")
def log_print(document_type: str, document_id: int, db: DbSession, user: CurrentUserDep):
    """Log that a slip was printed, so reprints are visible in the audit trail."""
    key = document_type.upper()
    builder = BUILDERS.get(key)
    if builder is None:
        raise bad_request(f'Unknown document type "{document_type}"')

    document = builder(db, user, document_id)
    db.add(
        DocumentPrint(
            document_type=key,
            document_id=document_id,
            document_no=document["document_no"],
            kitchen_id=document["kitchen_id"],
            printed_by=user.id,
        )
    )
    db.commit()

    return {"message": f"{document['document_no']} marked as printed"}
