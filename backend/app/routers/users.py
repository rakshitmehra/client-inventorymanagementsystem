from fastapi import APIRouter, Request
from sqlalchemy import func, or_, select

from ..deps import AdminUserDep, CurrentUserDep, DbSession
from ..errors import bad_request, conflict, not_found
from ..models import AuditLog, Kitchen, KitchenManager, Role, RoleCode, User
from ..schemas import ResetPasswordRequest, StatusUpdate, UserCreate, UserUpdate, dt
from ..security import hash_password
from ..services.audit import log_audit

router = APIRouter(prefix="/users", tags=["users"])


def _kitchens_of(db, user_id: int) -> list[dict]:
    rows = db.execute(
        select(Kitchen.id, Kitchen.code, Kitchen.name, KitchenManager.assigned_at)
        .join(KitchenManager, KitchenManager.kitchen_id == Kitchen.id)
        .where(KitchenManager.user_id == user_id, KitchenManager.is_active.is_(True))
        .order_by(Kitchen.name)
    ).all()
    return [
        {"id": r.id, "code": r.code, "name": r.name, "assigned_at": dt(r.assigned_at)}
        for r in rows
    ]


def _serialise(user: User, role: Role, db) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "full_name": user.full_name,
        "phone": user.phone,
        "is_active": user.is_active,
        "last_login_at": dt(user.last_login_at),
        "created_at": dt(user.created_at),
        "role_id": user.role_id,
        "role_code": role.code,
        "role_name": role.name,
        "kitchens": _kitchens_of(db, user.id),
    }


def _assert_not_last_admin(db, user_id: int) -> None:
    """The last active administrator must not be able to lock everyone out."""
    remaining = db.execute(
        select(func.count(User.id))
        .join(Role, Role.id == User.role_id)
        .where(
            Role.code == RoleCode.ADMIN.value,
            User.is_active.is_(True),
            User.id != user_id,
        )
    ).scalar_one()
    if remaining == 0:
        raise conflict(
            "This is the only active administrator - the system must keep at least one"
        )


@router.get("/roles")
def list_roles(db: DbSession, _user: CurrentUserDep):
    rows = db.execute(select(Role).order_by(Role.id)).scalars().all()
    return {
        "data": [
            {"id": r.id, "code": r.code, "name": r.name, "description": r.description}
            for r in rows
        ]
    }


@router.get("")
def list_users(
    db: DbSession,
    _admin: AdminUserDep,
    include_inactive: bool = False,
    role: str | None = None,
    search: str | None = None,
    unassigned: bool = False,
):
    stmt = select(User, Role).join(Role, Role.id == User.role_id)

    if not include_inactive:
        stmt = stmt.where(User.is_active.is_(True))
    if role:
        stmt = stmt.where(Role.code == role.upper())
    if search:
        like = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(User.full_name.ilike(like), User.username.ilike(like), User.email.ilike(like))
        )
    if unassigned:
        stmt = stmt.where(
            ~select(KitchenManager.id)
            .where(KitchenManager.user_id == User.id, KitchenManager.is_active.is_(True))
            .exists()
        )

    rows = db.execute(stmt.order_by(Role.code, User.full_name)).all()
    return {"data": [_serialise(user, role_row, db) for user, role_row in rows]}


@router.get("/{user_id}")
def get_user(user_id: int, db: DbSession, _admin: AdminUserDep):
    row = db.execute(
        select(User, Role).join(Role, Role.id == User.role_id).where(User.id == user_id)
    ).first()
    if row is None:
        raise not_found("User")

    user, role = row
    data = _serialise(user, role, db)
    data["recent_activity"] = [
        {
            "action": a.action,
            "entity_type": a.entity_type,
            "entity_label": a.entity_label,
            "description": a.description,
            "created_at": dt(a.created_at),
        }
        for a in db.execute(
            select(AuditLog)
            .where(AuditLog.user_id == user_id)
            .order_by(AuditLog.created_at.desc())
            .limit(20)
        ).scalars()
    ]
    return {"data": data}


@router.post("", status_code=201)
def create_user(payload: UserCreate, request: Request, db: DbSession, admin: AdminUserDep):
    role = db.get(Role, payload.role_id)
    if role is None:
        raise bad_request("Choose a valid role")
    if role.code != RoleCode.KITCHEN_MANAGER.value and payload.kitchen_ids:
        raise bad_request("Only kitchen managers can be assigned to kitchens")

    user = User(
        username=payload.username,
        email=payload.email,
        password_hash=hash_password(payload.password),
        full_name=payload.full_name,
        phone=payload.phone,
        role_id=payload.role_id,
        created_by=admin.id,
    )
    db.add(user)
    db.flush()

    for kitchen_id in payload.kitchen_ids:
        if db.get(Kitchen, int(kitchen_id)) is None:
            raise bad_request(f"Kitchen {kitchen_id} does not exist")
        db.add(
            KitchenManager(
                kitchen_id=int(kitchen_id),
                user_id=user.id,
                assigned_by=admin.id,
                is_primary=True,
                is_active=True,
                active_key=True,
            )
        )

    log_audit(
        db,
        request=request,
        user=admin,
        action="USER_CREATED",
        entity_type="USER",
        entity_id=user.id,
        entity_label=f"{user.username} ({role.code})",
        description=f"Created {role.name.lower()} account for {user.full_name}",
        metadata={"kitchen_ids": payload.kitchen_ids},
    )
    db.commit()

    return {"data": _serialise(user, role, db)}


@router.put("/{user_id}")
def update_user(
    user_id: int, payload: UserUpdate, request: Request, db: DbSession, admin: AdminUserDep
):
    row = db.execute(
        select(User, Role).join(Role, Role.id == User.role_id).where(User.id == user_id)
    ).first()
    if row is None:
        raise not_found("User")
    user, current_role = row

    role = db.get(Role, payload.role_id)
    if role is None:
        raise bad_request("Choose a valid role")

    # Demoting a manager who still runs kitchens would orphan those kitchens.
    if (
        current_role.code == RoleCode.KITCHEN_MANAGER.value
        and role.code != RoleCode.KITCHEN_MANAGER.value
    ):
        assigned = db.execute(
            select(func.count(KitchenManager.id)).where(
                KitchenManager.user_id == user.id, KitchenManager.is_active.is_(True)
            )
        ).scalar_one()
        if assigned:
            raise conflict(
                f"{user.full_name} still manages {assigned} kitchen(s). "
                "Unassign them before changing the role."
            )

    if current_role.code == RoleCode.ADMIN.value and role.code != RoleCode.ADMIN.value:
        _assert_not_last_admin(db, user.id)

    before = {
        "username": user.username,
        "email": user.email,
        "full_name": user.full_name,
        "role_id": user.role_id,
    }

    user.username = payload.username
    user.email = payload.email
    user.full_name = payload.full_name
    user.phone = payload.phone
    user.role_id = payload.role_id

    log_audit(
        db,
        request=request,
        user=admin,
        action="USER_UPDATED",
        entity_type="USER",
        entity_id=user.id,
        entity_label=user.username,
        description=f"Updated account for {user.full_name}",
        metadata={"before": before, "after": payload.model_dump()},
    )
    db.commit()

    return {"data": _serialise(user, role, db)}


@router.patch("/{user_id}/status")
def set_user_status(
    user_id: int, payload: StatusUpdate, request: Request, db: DbSession, admin: AdminUserDep
):
    row = db.execute(
        select(User, Role).join(Role, Role.id == User.role_id).where(User.id == user_id)
    ).first()
    if row is None:
        raise not_found("User")
    user, role = row

    if not payload.is_active:
        if user.id == admin.id:
            raise conflict("You cannot deactivate your own account")
        if role.code == RoleCode.ADMIN.value:
            _assert_not_last_admin(db, user.id)

    user.is_active = payload.is_active
    log_audit(
        db,
        request=request,
        user=admin,
        action="USER_ACTIVATED" if payload.is_active else "USER_DEACTIVATED",
        entity_type="USER",
        entity_id=user.id,
        entity_label=user.username,
        description=f"{'Activated' if payload.is_active else 'Deactivated'} {user.full_name}",
    )
    db.commit()

    state = "activated" if payload.is_active else "deactivated"
    return {"message": f"{user.full_name} has been {state}"}


@router.post("/{user_id}/reset-password")
def reset_password(
    user_id: int,
    payload: ResetPasswordRequest,
    request: Request,
    db: DbSession,
    admin: AdminUserDep,
):
    user = db.get(User, user_id)
    if user is None:
        raise not_found("User")

    user.password_hash = hash_password(payload.new_password)
    log_audit(
        db,
        request=request,
        user=admin,
        action="PASSWORD_RESET",
        entity_type="USER",
        entity_id=user.id,
        entity_label=user.username,
        description=f"Reset the password for {user.full_name}",
    )
    db.commit()

    return {"message": f"Password reset for {user.full_name}"}
