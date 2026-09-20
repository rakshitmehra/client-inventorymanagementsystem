import json
from typing import Any

from fastapi import Request
from sqlalchemy.orm import Session

from ..deps import CurrentUser
from ..models import AuditLog


def _client_ip(request: Request | None) -> str | None:
    if request is None:
        return None
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


def log_audit(
    db: Session,
    *,
    request: Request | None = None,
    user: CurrentUser | None = None,
    action: str,
    entity_type: str | None = None,
    entity_id: int | None = None,
    entity_label: str | None = None,
    description: str | None = None,
    metadata: Any = None,
    username: str | None = None,
    role_code: str | None = None,
    user_id: int | None = None,
    status: str = "SUCCESS",
) -> AuditLog:
    """
    Write an audit log entry. Called for every state-changing request as well as
    for authentication events, so the admin can reconstruct who did what.
    """
    entry = AuditLog(
        user_id=user.id if user else user_id,
        username=user.username if user else username,
        role_code=user.role_code if user else role_code,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        entity_label=entity_label,
        description=description,
        audit_metadata=json.dumps(metadata, default=str) if metadata is not None else None,
        ip_address=_client_ip(request),
        user_agent=(request.headers.get("user-agent") if request else None),
        status=status,
    )
    db.add(entry)
    db.flush()
    return entry
