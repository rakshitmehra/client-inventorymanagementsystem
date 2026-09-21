"""
Stock requests: the kitchen asks, the administrator decides.

Visibility mirrors the rest of the system. An administrator sees every
kitchen's requests; a kitchen manager sees only their own, and can only raise
or withdraw - deciding is an administrator's job.
"""

from typing import Annotated

from fastapi import APIRouter, Query, Request
from sqlalchemy import func, or_, select

from ..database import run_in_transaction
from ..deps import (
    AdminUserDep,
    CurrentUserDep,
    DbSession,
    PaginationDep,
    as_date,
    assert_kitchen_access,
)
from ..errors import forbidden, not_found
from ..models import (
    Item,
    Kitchen,
    RequestStatus,
    StockRequest,
    StockRequestItem,
    Unit,
    User,
)
from ..schemas import (
    StockRequestApprove,
    StockRequestCreate,
    StockRequestDecline,
    dt,
    f,
)
from ..services.audit import log_audit
from ..services.requests import (
    approve_request,
    cancel_request,
    create_request,
    decline_request,
    pending_count,
)

router = APIRouter(prefix="/requests", tags=["requests"])

Requester = User.__table__.alias("requester")
Decider = User.__table__.alias("decider")


def _assert_visible(user, request: StockRequest) -> None:
    """A manager may only see requests from a kitchen they run."""
    if user.is_admin:
        return
    if request.kitchen_id not in (user.kitchen_ids or []):
        raise forbidden("That request belongs to another kitchen")


def _row(request: StockRequest, kitchen_name, requester_name, decider_name, line_count) -> dict:
    return {
        "id": request.id,
        "request_no": request.request_no,
        "kitchen_id": request.kitchen_id,
        "kitchen_name": kitchen_name,
        "status": request.status,
        "needed_by": request.needed_by.isoformat() if request.needed_by else None,
        "notes": request.notes,
        "requested_by_name": requester_name,
        "requested_at": dt(request.requested_at),
        "decided_by_name": decider_name,
        "decided_at": dt(request.decided_at) if request.decided_at else None,
        "decision_note": request.decision_note,
        "transfer_id": request.transfer_id,
        "total_items": line_count,
    }


@router.get("")
def list_requests(
    db: DbSession,
    user: CurrentUserDep,
    page: PaginationDep,
    search: str | None = None,
    status: str | None = None,
    kitchen_id: int | None = None,
    from_: Annotated[str | None, Query(alias="from")] = None,
    to: str | None = None,
):
    line_count = (
        select(func.count(StockRequestItem.id))
        .where(StockRequestItem.request_id == StockRequest.id)
        .scalar_subquery()
    )

    base = (
        select(
            StockRequest,
            Kitchen.name.label("kitchen_name"),
            Requester.c.full_name.label("requested_by_name"),
            Decider.c.full_name.label("decided_by_name"),
            line_count.label("line_count"),
        )
        .join(Kitchen, Kitchen.id == StockRequest.kitchen_id)
        .outerjoin(Requester, Requester.c.id == StockRequest.requested_by)
        .outerjoin(Decider, Decider.c.id == StockRequest.decided_by)
    )

    if not user.is_admin:
        base = base.where(StockRequest.kitchen_id.in_(user.kitchen_ids or [-1]))
    elif kitchen_id:
        base = base.where(StockRequest.kitchen_id == kitchen_id)

    if status:
        base = base.where(StockRequest.status == status.upper())
    if search:
        like = f"%{search.strip()}%"
        base = base.where(
            or_(StockRequest.request_no.ilike(like), Kitchen.name.ilike(like))
        )
    if from_:
        base = base.where(func.date(StockRequest.requested_at) >= as_date(from_))
    if to:
        base = base.where(func.date(StockRequest.requested_at) <= as_date(to))

    total = db.execute(base.with_only_columns(func.count(StockRequest.id)).order_by(None)).scalar_one()

    rows = db.execute(
        base.order_by(
            # Waiting requests first: the list exists to be acted on.
            (StockRequest.status != RequestStatus.PENDING.value),
            StockRequest.requested_at.desc(),
        )
        .limit(page.page_size)
        .offset(page.offset)
    ).all()

    return {
        "data": [_row(*row) for row in rows],
        "meta": {
            **page.meta(total),
            "pending": pending_count(db, None if user.is_admin else (user.kitchen_ids or [])),
        },
    }


@router.get("/{request_id}")
def get_request(request_id: int, db: DbSession, user: CurrentUserDep):
    row = db.execute(
        select(
            StockRequest,
            Kitchen.name.label("kitchen_name"),
            Requester.c.full_name.label("requested_by_name"),
            Decider.c.full_name.label("decided_by_name"),
        )
        .join(Kitchen, Kitchen.id == StockRequest.kitchen_id)
        .outerjoin(Requester, Requester.c.id == StockRequest.requested_by)
        .outerjoin(Decider, Decider.c.id == StockRequest.decided_by)
        .where(StockRequest.id == request_id)
    ).first()
    if row is None:
        raise not_found("Request")

    stock_request, kitchen_name, requested_by_name, decided_by_name = row
    _assert_visible(user, stock_request)

    lines = db.execute(
        select(StockRequestItem, Item, Unit)
        .join(Item, Item.id == StockRequestItem.item_id)
        .join(Unit, Unit.id == StockRequestItem.unit_id)
        .where(StockRequestItem.request_id == request_id)
        .order_by(Item.name)
    ).all()

    return {
        "data": {
            **_row(stock_request, kitchen_name, requested_by_name, decided_by_name, len(lines)),
            "items": [
                {
                    "id": line.id,
                    "item_id": item.id,
                    "item_name": item.name,
                    "item_sku": item.sku,
                    "unit_code": unit.code,
                    "quantity": f(line.quantity),
                    "approved_quantity": (
                        f(line.approved_quantity) if line.approved_quantity is not None else None
                    ),
                    "notes": line.notes,
                }
                for line, item, unit in lines
            ],
        }
    }


@router.post("", status_code=201)
def raise_request(
    payload: StockRequestCreate,
    db: DbSession,
    user: CurrentUserDep,
    request: Request,
):
    # A manager may only request for their own kitchen; passing someone else's
    # id is rejected rather than quietly redirected.
    kitchen_id = assert_kitchen_access(user, payload.kitchen_id)

    result = run_in_transaction(
        db, lambda session: create_request(session, {**payload.model_dump(), "kitchen_id": kitchen_id}, user)
    )

    log_audit(
        db,
        request=request,
        user=user,
        action="STOCK_REQUESTED",
        entity_type="STOCK_REQUEST",
        entity_id=result["id"],
        entity_label=result["request_no"],
        description=(
            f"{result['kitchen_name']} requested {result['total_items']} item(s) "
            f"from the main store"
        ),
    )
    db.commit()

    return {"data": result, "message": f"Request {result['request_no']} sent to the main store"}


@router.post("/{request_id}/approve")
def approve(
    request_id: int,
    payload: StockRequestApprove,
    db: DbSession,
    user: AdminUserDep,
    request: Request,
):
    result = run_in_transaction(
        db, lambda session: approve_request(session, request_id, payload, user)
    )

    log_audit(
        db,
        request=request,
        user=user,
        action="STOCK_REQUEST_APPROVED",
        entity_type="STOCK_REQUEST",
        entity_id=result["id"],
        entity_label=result["request_no"],
        description=(
            f"Approved {result['request_no']} - {result['lines_sent']} line(s) sent "
            f"as {result['transfer_no']}"
        ),
        metadata={"transfer_no": result["transfer_no"], "refused": result["lines_refused"]},
    )
    db.commit()

    return {
        "data": result,
        "message": f"Approved - {result['lines_sent']} item(s) sent as {result['transfer_no']}",
    }


@router.post("/{request_id}/decline")
def decline(
    request_id: int,
    payload: StockRequestDecline,
    db: DbSession,
    user: AdminUserDep,
    request: Request,
):
    result = run_in_transaction(
        db, lambda session: decline_request(session, request_id, payload, user)
    )

    log_audit(
        db,
        request=request,
        user=user,
        action="STOCK_REQUEST_DECLINED",
        entity_type="STOCK_REQUEST",
        entity_id=result["id"],
        entity_label=result["request_no"],
        description=f"Declined {result['request_no']}: {payload.decision_note}",
    )
    db.commit()

    return {"data": result, "message": f"Request {result['request_no']} declined"}


@router.post("/{request_id}/cancel")
def cancel(request_id: int, db: DbSession, user: CurrentUserDep, request: Request):
    existing = db.get(StockRequest, request_id)
    if existing is None:
        raise not_found("Request")
    _assert_visible(user, existing)

    result = run_in_transaction(db, lambda session: cancel_request(session, request_id, user))

    log_audit(
        db,
        request=request,
        user=user,
        action="STOCK_REQUEST_CANCELLED",
        entity_type="STOCK_REQUEST",
        entity_id=result["id"],
        entity_label=result["request_no"],
        description=f"Withdrew {result['request_no']}",
    )
    db.commit()

    return {"data": result, "message": f"Request {result['request_no']} withdrawn"}
