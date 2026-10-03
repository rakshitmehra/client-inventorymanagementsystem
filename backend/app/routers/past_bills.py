"""
Past bills: supplier bills from before the system, kept for audit.

Nothing here touches stock. See PastBill for why that is the whole point.
"""

from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Query, Request
from sqlalchemy import func, or_, select

from ..database import run_in_transaction
from ..deps import AdminUserDep, DbSession, PaginationDep, as_date
from ..errors import not_found
from ..models import PastBill, PastBillItem, User
from ..schemas import PastBillRequest, dt, f
from ..security import money, q, rate
from ..services.audit import log_audit
from ..services.numbering import next_number

router = APIRouter(prefix="/past-bills", tags=["past-bills"])


def _fill(bill: PastBill, payload: PastBillRequest) -> None:
    """Copy the form onto a bill, replacing its lines."""
    lines = []
    for line in payload.items:
        price = rate(line.unit_price)
        quantity = q(line.quantity)
        total = money(line.line_total) if line.line_total is not None else money(price * quantity)
        lines.append(
            PastBillItem(
                item_id=line.item_id,
                item_name=line.item_name,
                quantity=quantity,
                unit=(line.unit or None),
                unit_price=price,
                line_total=total,
            )
        )

    bill.supplier_name = payload.supplier_name
    bill.invoice_no = payload.invoice_no or None
    bill.bill_date = as_date(payload.bill_date)
    bill.notes = payload.notes or None
    bill.total_amount = (
        money(payload.total_amount)
        if payload.total_amount is not None
        else money(sum((line.line_total for line in lines), Decimal("0")))
    )
    bill.items = lines


def _detail(bill: PastBill, creator: User | None) -> dict:
    return {
        "id": bill.id,
        "bill_no": bill.bill_no,
        "supplier_name": bill.supplier_name,
        "invoice_no": bill.invoice_no,
        "bill_date": bill.bill_date.isoformat(),
        "total_amount": f(bill.total_amount),
        "notes": bill.notes,
        "created_at": dt(bill.created_at),
        "created_by_name": creator.full_name if creator else None,
        "items": [
            {
                "id": line.id,
                "item_id": line.item_id,
                "item_name": line.item_name,
                "quantity": f(line.quantity),
                "unit": line.unit,
                "unit_price": f(line.unit_price),
                "line_total": f(line.line_total),
            }
            for line in bill.items
        ],
    }


@router.get("")
def list_past_bills(
    db: DbSession,
    _admin: AdminUserDep,
    page: PaginationDep,
    search: str | None = None,
    from_: Annotated[str | None, Query(alias="from")] = None,
    to: str | None = None,
):
    base = select(PastBill)

    if search:
        like = f"%{search.strip()}%"
        has_item = (
            select(PastBillItem.id)
            .where(PastBillItem.bill_id == PastBill.id, PastBillItem.item_name.ilike(like))
            .exists()
        )
        base = base.where(
            or_(
                PastBill.supplier_name.ilike(like),
                PastBill.invoice_no.ilike(like),
                PastBill.bill_no.ilike(like),
                has_item,
            )
        )
    if from_:
        base = base.where(PastBill.bill_date >= as_date(from_))
    if to:
        base = base.where(PastBill.bill_date <= as_date(to))

    total = db.execute(base.with_only_columns(func.count(PastBill.id)).order_by(None)).scalar_one()
    total_amount = db.execute(
        base.with_only_columns(
            func.coalesce(func.sum(PastBill.total_amount), Decimal("0"))
        ).order_by(None)
    ).scalar_one()

    bills = db.execute(
        base.order_by(PastBill.bill_date.desc(), PastBill.id.desc())
        .limit(page.page_size)
        .offset(page.offset)
    ).scalars().all()

    counts: dict[int, int] = {}
    if bills:
        counts = dict(
            db.execute(
                select(PastBillItem.bill_id, func.count(PastBillItem.id))
                .where(PastBillItem.bill_id.in_([b.id for b in bills]))
                .group_by(PastBillItem.bill_id)
            ).all()
        )

    return {
        "data": [
            {
                "id": bill.id,
                "bill_no": bill.bill_no,
                "supplier_name": bill.supplier_name,
                "invoice_no": bill.invoice_no,
                "bill_date": bill.bill_date.isoformat(),
                "total_amount": f(bill.total_amount),
                "item_count": counts.get(bill.id, 0),
                "notes": bill.notes,
            }
            for bill in bills
        ],
        "meta": page.meta(total, total_amount=f(total_amount)),
    }


@router.get("/{bill_id}")
def get_past_bill(bill_id: int, db: DbSession, _admin: AdminUserDep):
    bill = db.get(PastBill, bill_id)
    if bill is None:
        raise not_found("Past bill")
    return {"data": _detail(bill, bill.creator)}


@router.post("", status_code=201)
def create_past_bill(payload: PastBillRequest, request: Request, db: DbSession, admin: AdminUserDep):
    def work(session):
        bill = PastBill(bill_no=next_number(session, "PASTBILL"), created_by=admin.id)
        _fill(bill, payload)
        session.add(bill)
        session.flush()
        log_audit(
            session,
            request=request,
            user=admin,
            action="PAST_BILL_ADDED",
            entity_type="PAST_BILL",
            entity_id=bill.id,
            entity_label=bill.bill_no,
            description=(
                f"Added past bill from {bill.supplier_name} dated {bill.bill_date.isoformat()} "
                f"({bill.bill_no})"
            ),
            metadata={"total_amount": float(bill.total_amount), "lines": len(bill.items)},
        )
        return bill.id, bill.bill_no

    bill_id, bill_no = run_in_transaction(db, work)
    return {"data": {"id": bill_id, "bill_no": bill_no}, "message": f"Past bill {bill_no} saved"}


@router.put("/{bill_id}")
def update_past_bill(
    bill_id: int, payload: PastBillRequest, request: Request, db: DbSession, admin: AdminUserDep
):
    def work(session):
        bill = session.get(PastBill, bill_id)
        if bill is None:
            raise not_found("Past bill")
        _fill(bill, payload)
        bill.updated_at = func.now()
        session.flush()
        log_audit(
            session,
            request=request,
            user=admin,
            action="PAST_BILL_EDITED",
            entity_type="PAST_BILL",
            entity_id=bill.id,
            entity_label=bill.bill_no,
            description=f"Edited past bill {bill.bill_no} from {bill.supplier_name}",
            metadata={"total_amount": float(bill.total_amount), "lines": len(bill.items)},
        )
        return bill.bill_no

    bill_no = run_in_transaction(db, work)
    return {"data": {"id": bill_id, "bill_no": bill_no}, "message": f"Past bill {bill_no} updated"}


@router.delete("/{bill_id}")
def delete_past_bill(bill_id: int, request: Request, db: DbSession, admin: AdminUserDep):
    def work(session):
        bill = session.get(PastBill, bill_id)
        if bill is None:
            raise not_found("Past bill")
        no = bill.bill_no
        label = f"{no} ({bill.supplier_name}, {bill.bill_date.isoformat()})"
        session.delete(bill)
        session.flush()
        log_audit(
            session,
            request=request,
            user=admin,
            action="PAST_BILL_DELETED",
            entity_type="PAST_BILL",
            entity_id=bill_id,
            entity_label=no,
            description=f"Deleted past bill {label}",
        )
        return no

    bill_no = run_in_transaction(db, work)
    return {"message": f"Past bill {bill_no} deleted"}
