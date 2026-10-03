"""
Kitchen usage: a manager reporting, in one go, what the kitchen has used.
"""

from typing import Annotated

from fastapi import APIRouter, Query, Request
from sqlalchemy import func, select

from ..database import run_in_transaction
from ..deps import CurrentUserDep, DbSession, PaginationDep, as_date, assert_kitchen_access
from ..errors import forbidden
from ..models import Item, Kitchen, Unit, UsageRecord, UsageRecordItem, User
from ..schemas import UsageRequest, dt, f
from ..services.audit import log_audit
from ..services.operations import record_usage

router = APIRouter(tags=["kitchen-usage"])


@router.post("/usage", status_code=201)
def create_usage(payload: UsageRequest, request: Request, db: DbSession, user: CurrentUserDep):
    if user.is_admin:
        raise forbidden("Kitchen usage is recorded by the kitchen manager")
    assert_kitchen_access(user, payload.kitchen_id)

    def work(session):
        result = record_usage(session, payload, user)
        log_audit(
            session,
            request=request,
            user=user,
            action="KITCHEN_USAGE_RECORDED",
            entity_type="USAGE",
            entity_id=result["id"],
            entity_label=result["usage_no"],
            description=(
                f"Recorded {result['total_items']} item(s) used at "
                f"{result['kitchen_name']} ({result['usage_no']})"
            ),
            metadata={
                "kitchen_id": payload.kitchen_id,
                "items": [line.model_dump() for line in payload.items],
            },
        )
        return result

    result = run_in_transaction(db, work)
    return {"data": result, "message": f"Saved - {result['total_items']} item(s) taken off the shelf"}


@router.get("/usage")
def list_usage(
    db: DbSession,
    user: CurrentUserDep,
    page: PaginationDep,
    kitchen_id: int | None = None,
    from_: Annotated[str | None, Query(alias="from")] = None,
    to: str | None = None,
):
    base = (
        select(UsageRecord, Kitchen, User)
        .join(Kitchen, Kitchen.id == UsageRecord.kitchen_id)
        .outerjoin(User, User.id == UsageRecord.created_by)
    )

    if not user.is_admin:
        if not user.kitchen_ids:
            return {"data": [], "meta": page.meta(0)}
        base = base.where(UsageRecord.kitchen_id.in_(user.kitchen_ids))
    if kitchen_id:
        base = base.where(UsageRecord.kitchen_id == kitchen_id)
    if from_:
        base = base.where(func.date(UsageRecord.used_at) >= as_date(from_))
    if to:
        base = base.where(func.date(UsageRecord.used_at) <= as_date(to))

    total = db.execute(
        base.with_only_columns(func.count(UsageRecord.id)).order_by(None)
    ).scalar_one()

    rows = db.execute(
        base.order_by(UsageRecord.used_at.desc(), UsageRecord.id.desc())
        .limit(page.page_size)
        .offset(page.offset)
    ).all()

    lines: dict[int, list] = {}
    if rows:
        found = db.execute(
            select(UsageRecordItem, Item, Unit.code)
            .join(Item, Item.id == UsageRecordItem.item_id)
            .join(Unit, Unit.id == UsageRecordItem.unit_id)
            .where(UsageRecordItem.usage_id.in_([row[0].id for row in rows]))
            .order_by(UsageRecordItem.id)
        ).all()
        for line, item, unit_code in found:
            lines.setdefault(line.usage_id, []).append(
                {
                    "item_id": item.id,
                    "item_name": item.name,
                    "quantity": f(line.quantity),
                    "unit_code": unit_code,
                    "balance_after": f(line.balance_after),
                }
            )

    return {
        "data": [
            {
                "id": record.id,
                "usage_no": record.usage_no,
                "kitchen_id": kitchen.id,
                "kitchen_name": kitchen.name,
                "used_at": dt(record.used_at),
                "total_items": record.total_items,
                "total_cost": f(record.total_cost),
                "notes": record.notes,
                "recorded_by_name": creator.full_name if creator else None,
                "items": lines.get(record.id, []),
            }
            for record, kitchen, creator in rows
        ],
        "meta": page.meta(total),
    }
