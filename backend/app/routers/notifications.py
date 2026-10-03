"""
The notification bell: what is new for the signed-in person.

Every call is scoped to the caller's own notifications. There is no way to ask
for, or clear, somebody else's.
"""

from datetime import UTC, datetime

from fastapi import APIRouter
from sqlalchemy import func, select, update

from ..deps import CurrentUserDep, DbSession, PaginationDep
from ..errors import not_found
from ..models import Notification
from ..schemas import dt

router = APIRouter(prefix="/notifications", tags=["notifications"])


def _unread(db, user_id: int) -> int:
    return db.execute(
        select(func.count(Notification.id)).where(
            Notification.user_id == user_id, Notification.read_at.is_(None)
        )
    ).scalar_one()


def _row(n: Notification) -> dict:
    return {
        "id": n.id,
        "kind": n.kind,
        "severity": n.severity,
        "title": n.title,
        "body": n.body,
        "link": n.link,
        "created_at": dt(n.created_at),
        "is_read": n.read_at is not None,
    }


@router.get("")
def list_notifications(
    db: DbSession, user: CurrentUserDep, page: PaginationDep, unread_only: bool = False
):
    base = select(Notification).where(Notification.user_id == user.id)
    if unread_only:
        base = base.where(Notification.read_at.is_(None))

    total = db.execute(base.with_only_columns(func.count(Notification.id))).scalar_one()
    rows = db.execute(
        base.order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(page.page_size)
        .offset(page.offset)
    ).scalars().all()

    return {
        "data": [_row(n) for n in rows],
        "meta": page.meta(total, unread=_unread(db, user.id)),
    }


@router.get("/unread-count")
def unread_count(db: DbSession, user: CurrentUserDep):
    """The cheap one the bell asks every minute."""
    return {"data": {"unread": _unread(db, user.id)}}


@router.post("/read-all")
def read_all(db: DbSession, user: CurrentUserDep):
    result = db.execute(
        update(Notification)
        .where(Notification.user_id == user.id, Notification.read_at.is_(None))
        .values(read_at=datetime.now(UTC))
    )
    db.commit()
    return {"data": {"marked": result.rowcount}, "message": "All marked as read"}


@router.post("/{notification_id}/read")
def read_one(notification_id: int, db: DbSession, user: CurrentUserDep):
    note = db.get(Notification, notification_id)
    if note is None or note.user_id != user.id:
        raise not_found("Notification")
    if note.read_at is None:
        note.read_at = datetime.now(UTC)
        db.commit()
    return {"data": {"id": note.id, "is_read": True}}
