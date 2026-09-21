from dataclasses import dataclass, field
from datetime import date
from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from .database import get_db
from .errors import bad_request, forbidden, unauthorized
from .models import Kitchen, KitchenManager, Role, RoleCode, User
from .security import decode_access_token

bearer_scheme = HTTPBearer(auto_error=False)

DbSession = Annotated[Session, Depends(get_db)]


@dataclass
class CurrentUser:
    """The signed-in user plus the kitchens they are allowed to touch."""

    id: int
    username: str
    email: str
    full_name: str
    phone: str | None
    role_id: int
    role_code: str
    role_name: str
    is_active: bool
    kitchens: list[dict] = field(default_factory=list)

    @property
    def is_admin(self) -> bool:
        return self.role_code == RoleCode.ADMIN.value

    @property
    def kitchen_ids(self) -> list[int]:
        return [kitchen["id"] for kitchen in self.kitchens]


def load_current_user(db: Session, user_id: int) -> CurrentUser | None:
    row = db.execute(
        select(User, Role).join(Role, Role.id == User.role_id).where(User.id == user_id)
    ).first()
    if row is None:
        return None

    user, role = row
    kitchens = db.execute(
        select(Kitchen)
        .join(KitchenManager, KitchenManager.kitchen_id == Kitchen.id)
        .where(KitchenManager.user_id == user.id, KitchenManager.is_active.is_(True))
        .order_by(Kitchen.name)
    ).scalars().all()

    return CurrentUser(
        id=user.id,
        username=user.username,
        email=user.email,
        full_name=user.full_name,
        phone=user.phone,
        role_id=user.role_id,
        role_code=role.code,
        role_name=role.name,
        is_active=user.is_active,
        kitchens=[
            {
                "id": k.id,
                "code": k.code,
                "name": k.name,
                "location": k.location,
                "is_active": k.is_active,
            }
            for k in kitchens
        ],
    )


def get_current_user(
    request: Request,
    db: DbSession,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
) -> CurrentUser:
    """Reject anything without a valid token for a currently active user."""
    if credentials is None or not credentials.credentials:
        raise unauthorized("Sign in to continue")

    payload = decode_access_token(credentials.credentials)
    try:
        user_id = int(payload.get("sub", ""))
    except (TypeError, ValueError) as exc:
        raise unauthorized("Invalid session") from exc

    user = load_current_user(db, user_id)
    if user is None:
        raise unauthorized("This account no longer exists")
    if not user.is_active:
        raise forbidden("This account has been deactivated")

    request.state.current_user = user
    return user


CurrentUserDep = Annotated[CurrentUser, Depends(get_current_user)]


def require_admin(user: CurrentUserDep) -> CurrentUser:
    if not user.is_admin:
        raise forbidden("This action is restricted to administrators")
    return user


AdminUserDep = Annotated[CurrentUser, Depends(require_admin)]


def assert_kitchen_access(user: CurrentUser, kitchen_id: int | None) -> int:
    """
    Kitchen managers may only touch kitchens assigned to them; the admin may
    touch any. Raises instead of returning a flag so callers can use it inline.
    """
    if kitchen_id is None:
        raise forbidden("A kitchen must be specified")
    kitchen_id = int(kitchen_id)
    if user.is_admin:
        return kitchen_id
    if kitchen_id not in user.kitchen_ids:
        raise forbidden("You are not assigned to this kitchen")
    return kitchen_id


def assert_location_access(user: CurrentUser, location_type: str, kitchen_id: int | None) -> int | None:
    """
    Wastage and adjustments happen either at the Main Inventory (admin only) or
    at a kitchen (admin, or that kitchen's manager).
    """
    if location_type == "MAIN":
        if not user.is_admin:
            raise forbidden("Only an administrator can act on the Main Inventory")
        return None
    return assert_kitchen_access(user, kitchen_id)


@dataclass
class Pagination:
    page: int
    page_size: int

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size

    def meta(self, total: int, **extra) -> dict:
        pages = max(1, -(-total // self.page_size))
        return {
            "page": self.page,
            "page_size": self.page_size,
            "total": total,
            "total_pages": pages,
            **extra,
        }


#: Screens that filter in the browser ask for the whole list in one request.
#: The ceiling is what keeps that honest - a caller can take a catalogue in a
#: single page, but never enough rows to build a response that times out. Lists
#: that outgrow it stay paginated and say so.
MAX_PAGE_SIZE = 500


def pagination(page: int = 1, page_size: int = 25) -> Pagination:
    return Pagination(page=max(1, page), page_size=min(MAX_PAGE_SIZE, max(1, page_size)))


PaginationDep = Annotated[Pagination, Depends(pagination)]


def as_date(value: str | None) -> date | None:
    """
    Parse a ``YYYY-MM-DD`` filter value into a real date.

    CockroachDB refuses to compare DATE with VARCHAR, so every date filter has
    to bind as a date rather than the raw query-string value.
    """
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError as exc:
        raise bad_request(f"'{value}' is not a valid date (expected YYYY-MM-DD)") from exc


def sort_clause(sort: str | None, order: str | None, allowed: dict, fallback: str):
    """
    Map ?sort=&order= onto a real column, restricted to an allowlist so the
    value can never reach the query as arbitrary text.
    """
    column = allowed.get(sort or "", allowed[fallback])
    return column.desc() if (order or "").lower() == "desc" else column.asc()
