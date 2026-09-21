"""
Stock requests: a kitchen asks the main store to send it something.

The flow is deliberately one-directional. A kitchen manager raises a request;
an administrator approves it (optionally cutting the quantities), declines it,
or the manager withdraws it. Nothing moves until approval, and approval does
not invent its own stock handling - it calls create_transfer(), so a request
that becomes stock goes through exactly the same shortage checks, ledger rows
and atomicity as a transfer typed in by hand.

That reuse is the point: there is one way stock leaves the main store, and a
request is a reason to use it, not a second implementation of it.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..deps import CurrentUser
from ..errors import bad_request, conflict, not_found
from ..models import (
    Item,
    Kitchen,
    RequestStatus,
    StockRequest,
    StockRequestItem,
    Unit,
)
from ..security import D, q
from .numbering import next_number
from .operations import create_transfer
from .units import to_item_unit


def _load(db: Session, request_id: int) -> StockRequest:
    request = db.get(StockRequest, request_id)
    if request is None:
        raise not_found("Request")
    return request


def _require_pending(request: StockRequest, verb: str) -> None:
    if request.status != RequestStatus.PENDING.value:
        raise conflict(
            f"This request was already {request.status.lower()}, so it cannot be {verb}."
        )


# ---------------------------------------------------------------------------
# raise
# ---------------------------------------------------------------------------
def create_request(db: Session, payload: Any, user: CurrentUser) -> dict[str, Any]:
    """Raise a request from a kitchen to the main store."""
    data = payload if isinstance(payload, dict) else payload.model_dump()

    kitchen_id = data.get("kitchen_id")
    if kitchen_id is None:
        raise bad_request("Choose a kitchen")
    kitchen_id = int(kitchen_id)

    kitchen = db.get(Kitchen, kitchen_id)
    if kitchen is None or not kitchen.is_active:
        raise bad_request("That kitchen is not available")

    raw_lines = data.get("items") or []
    if not raw_lines:
        raise bad_request("Add at least one item to the request")

    # Merge duplicates rather than rejecting them: asking for flour twice on
    # one form is a slip, not an error worth losing the whole request over.
    merged: dict[int, dict[str, Any]] = {}
    for index, raw in enumerate(raw_lines, start=1):
        line = raw if isinstance(raw, dict) else raw.model_dump()

        item_id = line.get("item_id")
        if item_id is None:
            raise bad_request(f"Line {index}: choose an item")
        item = db.get(Item, int(item_id))
        if item is None or not item.is_active:
            raise bad_request(f"Line {index}: that item is not available")

        quantity = D(line.get("quantity"))
        if quantity <= 0:
            raise bad_request(f"Line {index} ({item.name}): enter how much you need")

        # Store in the item's own stocking unit so the administrator, the
        # transfer and the kitchen balance all speak the same units.
        base_quantity, _ = to_item_unit(db, quantity, line.get("unit_id"), item)

        if item.id in merged:
            merged[item.id]["quantity"] = q(merged[item.id]["quantity"] + base_quantity)
        else:
            merged[item.id] = {
                "item_id": item.id,
                "unit_id": item.unit_id,
                "quantity": q(base_quantity),
                "notes": line.get("notes"),
            }

    # The column is a real DATE, so hand it a date rather than a string -
    # PostgreSQL will not compare the two.
    needed_by = data.get("needed_by")
    if needed_by:
        try:
            needed_by = date.fromisoformat(str(needed_by)[:10])
        except ValueError:
            raise bad_request("'needed by' must be a date (YYYY-MM-DD)") from None
    else:
        needed_by = None

    request = StockRequest(
        request_no=next_number(db, "REQUEST"),
        kitchen_id=kitchen_id,
        status=RequestStatus.PENDING.value,
        needed_by=needed_by,
        notes=data.get("notes"),
        requested_by=user.id,
    )
    db.add(request)
    db.flush()

    for line in merged.values():
        db.add(StockRequestItem(request_id=request.id, **line))

    db.flush()
    return {
        "id": request.id,
        "request_no": request.request_no,
        "kitchen_name": kitchen.name,
        "total_items": len(merged),
    }


# ---------------------------------------------------------------------------
# decide
# ---------------------------------------------------------------------------
def approve_request(db: Session, request_id: int, payload: Any, user: CurrentUser) -> dict[str, Any]:
    """
    Approve a request and send the stock.

    The administrator may cut any line's quantity, including to zero, which
    refuses that line while the rest goes through. The transfer is created by
    create_transfer(), so if the main store is short the whole thing fails and
    the request stays PENDING - a half-sent request would be worse than none.
    """
    data = payload if isinstance(payload, dict) else payload.model_dump()
    request = _load(db, request_id)
    _require_pending(request, "approved")

    lines = list(request.items)
    if not lines:
        raise bad_request("This request has no items")

    # Quantities the administrator actually agreed to, keyed by line id.
    overrides = {}
    for raw in data.get("items") or []:
        entry = raw if isinstance(raw, dict) else raw.model_dump()
        if entry.get("id") is None:
            continue
        value = D(entry.get("approved_quantity"))
        if value < 0:
            raise bad_request("An approved quantity cannot be negative")
        overrides[int(entry["id"])] = q(value)

    to_send = []
    for line in lines:
        approved = overrides.get(line.id, q(line.quantity))
        line.approved_quantity = approved
        if approved > 0:
            to_send.append(
                {
                    "item_id": line.item_id,
                    "quantity": approved,
                    "unit_id": line.unit_id,
                    "notes": line.notes,
                }
            )

    if not to_send:
        raise bad_request(
            "Every line has been set to zero. Decline the request instead of approving nothing."
        )

    transfer = create_transfer(
        db,
        {
            "from_location_type": "MAIN",
            "to_location_type": "KITCHEN",
            "to_kitchen_id": request.kitchen_id,
            "items": to_send,
            "notes": f"Request {request.request_no}",
        },
        user,
    )

    request.status = RequestStatus.APPROVED.value
    request.decided_by = user.id
    request.decided_at = datetime.now(UTC)
    request.decision_note = data.get("decision_note")
    request.transfer_id = transfer["id"]
    db.flush()

    return {
        "id": request.id,
        "request_no": request.request_no,
        "status": request.status,
        "transfer_id": transfer["id"],
        "transfer_no": transfer["transfer_no"],
        "lines_sent": len(to_send),
        "lines_refused": len(lines) - len(to_send),
    }


def decline_request(db: Session, request_id: int, payload: Any, user: CurrentUser) -> dict[str, Any]:
    """Turn a request down. A reason is required - "no" without one is not useful."""
    data = payload if isinstance(payload, dict) else payload.model_dump()
    request = _load(db, request_id)
    _require_pending(request, "declined")

    note = (data.get("decision_note") or "").strip()
    if not note:
        raise bad_request("Say why you are declining, so the kitchen knows what to do next")

    request.status = RequestStatus.DECLINED.value
    request.decided_by = user.id
    request.decided_at = datetime.now(UTC)
    request.decision_note = note
    for line in request.items:
        line.approved_quantity = Decimal("0")
    db.flush()

    return {"id": request.id, "request_no": request.request_no, "status": request.status}


def cancel_request(db: Session, request_id: int, user: CurrentUser) -> dict[str, Any]:
    """Withdraw a request. Only the kitchen that raised it, and only while pending."""
    request = _load(db, request_id)
    _require_pending(request, "withdrawn")

    request.status = RequestStatus.CANCELLED.value
    request.decided_by = user.id
    request.decided_at = datetime.now(UTC)
    db.flush()

    return {"id": request.id, "request_no": request.request_no, "status": request.status}


# ---------------------------------------------------------------------------
# read
# ---------------------------------------------------------------------------
def pending_count(db: Session, kitchen_ids: list[int] | None = None) -> int:
    """How many requests are waiting on a decision - drives the sidebar badge."""
    query = select(func.count(StockRequest.id)).where(
        StockRequest.status == RequestStatus.PENDING.value
    )
    if kitchen_ids is not None:
        query = query.where(StockRequest.kitchen_id.in_(kitchen_ids or [-1]))
    return db.execute(query).scalar_one()
