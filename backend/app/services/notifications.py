"""
Notifications: who gets told what, and when.

Events are noticed where they happen - the stock engine, transfers, requests -
but written out in one place, so who receives what is decided here rather than
scattered through the code that moves stock.

Low stock is the one that needs care. A balance is checked as it changes and a
notification is made only when it CROSSES the line (was above the minimum, is
now at or below it), not every time it is below. Otherwise a kitchen sitting
low would raise a new warning for every spoonful used.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import KitchenManager, Notification, Role, RoleCode, User

PENDING_KEY = "pending_low_stock"

#: More than this many low items in one save become one summary message, so
#: using up forty things at close does not bury the bell in forty rows.
SUMMARISE_OVER = 4


def admin_ids(db: Session) -> list[int]:
    return list(
        db.execute(
            select(User.id)
            .join(Role, Role.id == User.role_id)
            .where(Role.code == RoleCode.ADMIN.value, User.is_active.is_(True))
        ).scalars()
    )


def manager_ids(db: Session, kitchen_id: int) -> list[int]:
    return list(
        db.execute(
            select(KitchenManager.user_id)
            .join(User, User.id == KitchenManager.user_id)
            .where(
                KitchenManager.kitchen_id == kitchen_id,
                KitchenManager.is_active.is_(True),
                User.is_active.is_(True),
            )
        ).scalars()
    )


def notify(
    db: Session,
    user_ids: list[int],
    *,
    kind: str,
    title: str,
    body: str | None = None,
    link: str | None = None,
    severity: str = "info",
    skip_user_id: int | None = None,
) -> None:
    """One row per recipient. `skip_user_id` keeps people from notifying themselves."""
    seen: set[int] = set()
    for user_id in user_ids:
        if user_id in seen or user_id == skip_user_id:
            continue
        seen.add(user_id)
        db.add(
            Notification(
                user_id=user_id, kind=kind, severity=severity, title=title, body=body, link=link
            )
        )


# --------------------------------------------------------------- low stock ---
def queue_low_stock(
    db: Session,
    *,
    item,
    location_type: str,
    kitchen_id: int | None,
    before: Decimal,
    after: Decimal,
    minimum: Decimal,
    unit_code: str,
) -> None:
    """
    Note a balance that has just fallen, to be announced when the transaction
    commits. Only a crossing of the minimum counts - see the module notes.
    """
    threshold = Decimal(minimum or 0)
    if before > threshold and after <= threshold:
        db.info.setdefault(PENDING_KEY, []).append(
            {
                "item_name": item.name,
                "location_type": location_type,
                "kitchen_id": kitchen_id,
                "after": after,
                "unit_code": unit_code,
                "out": after <= 0,
            }
        )


def flush_low_stock(db: Session) -> None:
    """Turn the queued crossings into notifications. Called just before commit."""
    pending = db.info.pop(PENDING_KEY, [])
    if not pending:
        return

    from ..models import Kitchen  # local: avoids a cycle at import time

    admins = admin_ids(db)
    groups: dict[tuple[str, int | None], list[dict[str, Any]]] = {}
    for entry in pending:
        groups.setdefault((entry["location_type"], entry["kitchen_id"]), []).append(entry)

    for (location_type, kitchen_id), entries in groups.items():
        if location_type == "KITCHEN":
            kitchen = db.get(Kitchen, kitchen_id)
            place = kitchen.name if kitchen else "a kitchen"
            link = f"/kitchens/{kitchen_id}/inventory"
            recipients = admins + manager_ids(db, kitchen_id)
        else:
            place = "the main store"
            link = "/main-inventory"
            recipients = admins

        if len(entries) > SUMMARISE_OVER:
            out = sum(1 for e in entries if e["out"])
            body = ", ".join(e["item_name"] for e in entries[:6]) + (
                f" and {len(entries) - 6} more" if len(entries) > 6 else ""
            )
            notify(
                db,
                recipients,
                kind="LOW_STOCK",
                severity="warn",
                title=f"{len(entries)} items running low at {place}"
                + (f" ({out} out)" if out else ""),
                body=body,
                link=link,
            )
            continue

        for entry in entries:
            left = f"{entry['after'].normalize():f} {entry['unit_code']}"
            notify(
                db,
                recipients,
                kind="LOW_STOCK",
                severity="danger" if entry["out"] else "warn",
                title=(
                    f"{entry['item_name']} is out of stock at {place}"
                    if entry["out"]
                    else f"{entry['item_name']} is running low at {place}"
                ),
                body=None if entry["out"] else f"Only {left} left",
                link=link,
            )
