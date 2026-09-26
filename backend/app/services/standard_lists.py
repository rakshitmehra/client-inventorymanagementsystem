"""
Standard lists: the same order, saved once and run whenever it is needed.

Refilling the main store is the same long list of items every month, and each
kitchen takes roughly the same delivery every week. Entering that by hand is
slow and it is where the mistakes come from - a line missed, a quantity typed
into the wrong row. A standard list holds the usual items and the usual
quantities so the whole thing goes in on one click.

The important part is what running a list does *not* do. It does not write to
the ledger itself, or touch stock levels, or invent its own numbering. It
fills in an ordinary goods receipt or an ordinary transfer and hands it to the
very service the manual screens call. Everything that protects stock - the
shortage check, the atomic write, the audit entry, the printable note -
applies unchanged, because it is the same code path. A list is a shortcut
through the typing, never a way round the rules.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..deps import CurrentUser
from ..errors import bad_request, not_found
from ..models import (
    Item,
    Kitchen,
    ListPurpose,
    StandardList,
    StandardListItem,
    Supplier,
    Unit,
)
from .inventory import get_balance
from .operations import create_transfer, receive_stock
from .requests import create_request

REFILL = ListPurpose.REFILL.value
DELIVERY = ListPurpose.DELIVERY.value


# ---------------------------------------------------------------------------
# loading and shaping
# ---------------------------------------------------------------------------
def _load(db: Session, list_id: int) -> StandardList:
    found = db.execute(
        select(StandardList)
        .where(StandardList.id == list_id)
        .options(
            selectinload(StandardList.items).selectinload(StandardListItem.item),
            selectinload(StandardList.items).selectinload(StandardListItem.unit),
        )
    ).scalar_one_or_none()
    if not found:
        raise not_found("That standard list no longer exists")
    return found


def visible_to(user: CurrentUser, record: StandardList) -> bool:
    """
    Administrators see every list. A kitchen manager sees only the delivery
    lists for their own kitchens - a refill list is about buying into the main
    store, which is not their business, and another kitchen's delivery is not
    either.
    """
    if user.is_admin:
        return True
    if record.purpose == REFILL:
        # A manager may look at the buying lists, because they are what says
        # which items belong to the everyday run and which to the monthly one
        # - a grouping their own request screen needs. They still cannot run
        # one; that check lives in run_list and is not relaxed here.
        return True
    return record.kitchen_id in (user.kitchen_ids or [])


def _assert_visible(user: CurrentUser, record: StandardList) -> None:
    if not visible_to(user, record):
        raise not_found("That standard list no longer exists")


def serialise(record: StandardList, *, db: Session | None = None) -> dict[str, Any]:
    """
    One list with its lines.

    When a session is passed, each line also carries what the main store is
    currently holding. That is what lets the screen say "this line is short"
    before anybody commits to sending it, rather than after.
    """
    lines = []
    for line in record.items:
        row: dict[str, Any] = {
            "id": line.id,
            "item_id": line.item_id,
            "item_name": line.item.name,
            "item_sku": line.item.sku,
            "unit_id": line.unit_id,
            "unit_code": line.unit.code,
            "quantity": float(line.quantity),
            "unit_cost": float(line.item.unit_cost or 0),
            "notes": line.notes,
        }
        if db is not None:
            available = get_balance(db, "MAIN", None, line.item_id)
            row["main_quantity"] = float(available)
            # Only a delivery can run the main store short; a refill is adding
            # to it, so "not enough in the main store" means nothing there.
            row["short_by"] = (
                float(max(Decimal("0"), line.quantity - available))
                if record.purpose == DELIVERY
                else 0.0
            )
        lines.append(row)

    return {
        "id": record.id,
        "name": record.name,
        "purpose": record.purpose,
        "frequency": record.frequency,
        "kitchen_id": record.kitchen_id,
        "kitchen_name": record.kitchen.name if record.kitchen else None,
        "supplier_id": record.supplier_id,
        "supplier_name": record.supplier.name if record.supplier else None,
        "notes": record.notes,
        "is_active": record.is_active,
        "total_items": len(record.items),
        "estimated_cost": round(
            sum(float(l.quantity) * float(l.item.unit_cost or 0) for l in record.items), 2
        ),
        "created_by_name": record.creator.full_name if record.creator else None,
        "created_at": record.created_at.isoformat() if record.created_at else None,
        "updated_at": record.updated_at.isoformat() if record.updated_at else None,
        "last_used_at": record.last_used_at.isoformat() if record.last_used_at else None,
        "items": lines,
    }


# ---------------------------------------------------------------------------
# writing the list itself
# ---------------------------------------------------------------------------
def _validate_targets(db: Session, data: dict[str, Any]) -> None:
    if data.get("kitchen_id"):
        kitchen = db.get(Kitchen, int(data["kitchen_id"]))
        if not kitchen or not kitchen.is_active:
            raise bad_request("That kitchen is not available")
    if data.get("supplier_id"):
        supplier = db.get(Supplier, int(data["supplier_id"]))
        if not supplier or not supplier.is_active:
            raise bad_request("That supplier is not available")


def _build_lines(db: Session, rows: list[Any]) -> list[StandardListItem]:
    """
    Turn the submitted lines into rows, checking each item and unit.

    The unit has to measure the same kind of thing the item is stocked in -
    you cannot ask for two litres of an item counted in kilograms - and
    catching that here means the list can never produce a run that fails.
    """
    built = []
    for raw in rows:
        row = raw if isinstance(raw, dict) else raw.model_dump()
        item = db.get(Item, int(row["item_id"]))
        if not item or not item.is_active:
            raise bad_request(f"Item {row['item_id']} is not in the catalogue")

        unit_id = int(row["unit_id"]) if row.get("unit_id") else item.unit_id
        unit = db.get(Unit, unit_id)
        if not unit:
            raise bad_request(f"'{item.name}' was given a unit that does not exist")

        stocking_unit = db.get(Unit, item.unit_id)
        if stocking_unit and unit.dimension != stocking_unit.dimension:
            raise bad_request(
                f"'{item.name}' is kept in {stocking_unit.code}, "
                f"so it cannot be listed in {unit.code}"
            )

        quantity = Decimal(str(row["quantity"]))
        if quantity <= 0:
            raise bad_request(f"'{item.name}' needs a quantity above zero")

        built.append(
            StandardListItem(
                item_id=item.id,
                unit_id=unit_id,
                quantity=quantity,
                notes=row.get("notes"),
            )
        )
    return built


def create_list(db: Session, payload: Any, user: CurrentUser) -> dict[str, Any]:
    data = payload if isinstance(payload, dict) else payload.model_dump()
    _validate_targets(db, data)

    clash = db.execute(
        select(StandardList).where(StandardList.name == data["name"].strip())
    ).scalar_one_or_none()
    if clash:
        raise bad_request(f"A standard list called '{data['name']}' already exists")

    record = StandardList(
        name=data["name"].strip(),
        purpose=data["purpose"],
        frequency=data.get("frequency") or "WEEKLY",
        kitchen_id=data.get("kitchen_id"),
        supplier_id=data.get("supplier_id"),
        notes=data.get("notes"),
        is_active=data.get("is_active", True),
        created_by=user.id,
    )
    record.items = _build_lines(db, data["items"])
    db.add(record)
    db.flush()

    db.refresh(record)
    return {"data": serialise(record), "message": f"'{record.name}' is ready to use"}


def update_list(db: Session, list_id: int, payload: Any, user: CurrentUser) -> dict[str, Any]:
    record = _load(db, list_id)
    data = payload if isinstance(payload, dict) else payload.model_dump()
    _validate_targets(db, data)

    clash = db.execute(
        select(StandardList).where(
            StandardList.name == data["name"].strip(), StandardList.id != list_id
        )
    ).scalar_one_or_none()
    if clash:
        raise bad_request(f"A standard list called '{data['name']}' already exists")

    before = len(record.items)
    record.name = data["name"].strip()
    record.purpose = data["purpose"]
    record.frequency = data.get("frequency") or "WEEKLY"
    record.kitchen_id = data.get("kitchen_id")
    record.supplier_id = data.get("supplier_id")
    record.notes = data.get("notes")
    record.is_active = data.get("is_active", True)
    record.updated_at = datetime.now(timezone.utc)

    # Clear the old lines and flush before adding the new ones. Assigning
    # straight over the collection lets SQLAlchemy insert a replacement line
    # before it has deleted the one it replaces, and since a list may hold an
    # item only once, the database rejects the edit as a duplicate. Deleting
    # in its own round trip keeps the constraint satisfied at every point.
    record.items.clear()
    db.flush()
    record.items = _build_lines(db, data["items"])
    db.flush()

    db.refresh(record)
    return {"data": serialise(record), "message": f"'{record.name}' has been updated"}


def delete_list(db: Session, list_id: int, user: CurrentUser) -> dict[str, Any]:
    record = _load(db, list_id)
    name = record.name
    db.delete(record)
    db.flush()
    return {"data": None, "message": f"'{name}' has been deleted"}


# ---------------------------------------------------------------------------
# running a list
# ---------------------------------------------------------------------------
def _run_lines(record: StandardList, overrides: list[Any] | None) -> list[dict[str, Any]]:
    """
    Work out what this run actually moves.

    With no overrides the saved quantities stand, which is the single click.
    With overrides, those quantities win: a changed number is a changed line,
    zero drops the line from this run, and an item that is not on the list at
    all is simply added to it. None of it writes back to the list, so today's
    exception does not quietly become next month's normal.
    """
    if overrides is None:
        return [
            {"item_id": line.item_id, "quantity": float(line.quantity), "unit_id": line.unit_id}
            for line in record.items
        ]

    saved_units = {line.item_id: line.unit_id for line in record.items}
    lines = []
    for raw in overrides:
        row = raw if isinstance(raw, dict) else raw.model_dump()
        quantity = float(row["quantity"])
        if quantity <= 0:
            continue  # left out of this run
        lines.append(
            {
                "item_id": int(row["item_id"]),
                "quantity": quantity,
                "unit_id": row.get("unit_id") or saved_units.get(int(row["item_id"])),
            }
        )

    if not lines:
        raise bad_request("Every line is zero, so there is nothing to send")
    return lines


def run_list(db: Session, list_id: int, payload: Any, user: CurrentUser) -> dict[str, Any]:
    """
    Run a standard list, producing a real receipt, transfer or request.

    Which of the three depends on the list and on who is running it. A refill
    buys into the main store. A delivery run by an administrator moves the
    stock. A delivery run by a kitchen manager raises a request instead,
    because a manager cannot help themselves to the main store - it goes to an
    administrator to approve, exactly as a hand-written request does.
    """
    record = _load(db, list_id)
    _assert_visible(user, record)
    if not record.is_active:
        raise bad_request(f"'{record.name}' is archived, so it cannot be run")

    data = payload if isinstance(payload, dict) else payload.model_dump()
    lines = _run_lines(record, data.get("items"))
    note = data.get("notes") or f"From the standard list '{record.name}'"

    if record.purpose == REFILL:
        if not user.is_admin:
            raise bad_request("Only an administrator can refill the main store")
        result = receive_stock(
            db,
            {
                "supplier_id": record.supplier_id,
                "invoice_no": data.get("invoice_no"),
                "notes": note,
                "items": lines,
            },
            user,
        )
        outcome = "receipt"

    elif not user.is_admin or data.get("as_request"):
        # A kitchen asking for its usual delivery.
        result = create_request(
            db,
            {"kitchen_id": record.kitchen_id, "notes": note, "items": lines},
            user,
        )
        outcome = "request"

    else:
        result = create_transfer(
            db,
            {
                "from_location_type": "MAIN",
                "to_location_type": "KITCHEN",
                "to_kitchen_id": record.kitchen_id,
                "notes": note,
                "items": lines,
            },
            user,
        )
        outcome = "transfer"

    record.last_used_at = datetime.now(timezone.utc)
    db.flush()


    result["outcome"] = outcome
    result["list_name"] = record.name
    return result


def list_lists(db: Session, user: CurrentUser, *, include_inactive: bool = False) -> list[dict]:
    query = select(StandardList).options(
        selectinload(StandardList.items).selectinload(StandardListItem.item),
        selectinload(StandardList.items).selectinload(StandardListItem.unit),
    )
    if not include_inactive:
        query = query.where(StandardList.is_active.is_(True))
    if not user.is_admin:
        # Their own kitchen's delivery lists, plus the buying lists, which
        # they read only as a way of grouping items.
        query = query.where(
            (StandardList.purpose == REFILL)
            | (
                (StandardList.purpose == DELIVERY)
                & StandardList.kitchen_id.in_(user.kitchen_ids or [-1])
            )
        )
    records = db.execute(query.order_by(StandardList.name)).scalars().all()
    return [serialise(r) for r in records]
