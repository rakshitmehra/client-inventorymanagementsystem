import json

from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import func, or_, select

from ..deps import AdminUserDep, DbSession, PaginationDep, as_date
from ..models import AuditLog, User
from ..schemas import dt

router = APIRouter(prefix="/audit-logs", tags=["audit"])


def _parse(raw: str | None):
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return None


@router.get("")
def list_audit_logs(
    db: DbSession,
    _admin: AdminUserDep,
    page: PaginationDep,
    user_id: int | None = None,
    action: str | None = None,
    entity_type: str | None = None,
    entity_id: int | None = None,
    status: str | None = None,
    search: str | None = None,
    from_: Annotated[str | None, Query(alias="from")] = None,
    to: str | None = None,
):
    base = select(AuditLog, User.full_name).outerjoin(User, User.id == AuditLog.user_id)

    if user_id:
        base = base.where(AuditLog.user_id == user_id)
    if action:
        base = base.where(AuditLog.action == action.upper())
    if entity_type:
        base = base.where(AuditLog.entity_type == entity_type.upper())
    if entity_id:
        base = base.where(AuditLog.entity_id == entity_id)
    if status:
        base = base.where(AuditLog.status == status.upper())
    if search:
        like = f"%{search.strip()}%"
        base = base.where(
            or_(
                AuditLog.description.ilike(like),
                AuditLog.entity_label.ilike(like),
                AuditLog.username.ilike(like),
            )
        )
    if from_:
        base = base.where(func.date(AuditLog.created_at) >= as_date(from_))
    if to:
        base = base.where(func.date(AuditLog.created_at) <= as_date(to))

    total = db.execute(
        base.with_only_columns(func.count(AuditLog.id)).order_by(None)
    ).scalar_one()

    rows = db.execute(
        base.order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .limit(page.page_size)
        .offset(page.offset)
    ).all()

    return {
        "data": [
            {
                "id": entry.id,
                "user_id": entry.user_id,
                "username": entry.username,
                "full_name": full_name,
                "role_code": entry.role_code,
                "action": entry.action,
                "entity_type": entry.entity_type,
                "entity_id": entry.entity_id,
                "entity_label": entry.entity_label,
                "description": entry.description,
                "metadata": _parse(entry.audit_metadata),
                "ip_address": entry.ip_address,
                "user_agent": entry.user_agent,
                "status": entry.status,
                "created_at": dt(entry.created_at),
            }
            for entry, full_name in rows
        ],
        "meta": page.meta(total),
    }


@router.get("/actions")
def list_actions(db: DbSession, _admin: AdminUserDep):
    """The distinct action names present, for the filter dropdown."""
    rows = db.execute(
        select(AuditLog.action, func.count(AuditLog.id).label("count"))
        .group_by(AuditLog.action)
        .order_by(AuditLog.action)
    ).all()
    return {"data": [{"action": action, "count": count} for action, count in rows]}
