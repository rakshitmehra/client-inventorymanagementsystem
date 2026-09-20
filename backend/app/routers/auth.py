from datetime import UTC, datetime

from fastapi import APIRouter, Request
from sqlalchemy import func, or_, select

from ..deps import CurrentUserDep, DbSession, load_current_user
from ..errors import bad_request, unauthorized
from ..models import Role, User
from ..schemas import ChangePasswordRequest, LoginRequest, dt
from ..security import create_access_token, hash_password, verify_password
from ..services.audit import log_audit

router = APIRouter(prefix="/auth", tags=["auth"])


def _user_payload(user) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "full_name": user.full_name,
        "phone": user.phone,
        "role_id": user.role_id,
        "role_code": user.role_code,
        "role_name": user.role_name,
        "is_active": user.is_active,
        "kitchens": user.kitchens,
        "kitchen_ids": user.kitchen_ids,
    }


@router.post("/login")
def login(payload: LoginRequest, request: Request, db: DbSession):
    identifier = payload.username.lower()

    row = db.execute(
        select(User, Role)
        .join(Role, Role.id == User.role_id)
        .where(
            or_(
                func.lower(User.username) == identifier,
                func.lower(User.email) == identifier,
            )
        )
    ).first()

    # The same message either way, so the form cannot be used to probe for
    # valid usernames.
    invalid = unauthorized("Incorrect username or password")

    if row is None:
        log_audit(
            db,
            request=request,
            username=payload.username,
            action="LOGIN_FAILED",
            description=f'Sign-in attempt for unknown account "{payload.username}"',
            status="FAILURE",
        )
        db.commit()
        raise invalid

    user, role = row

    if not verify_password(payload.password, user.password_hash):
        log_audit(
            db,
            request=request,
            user_id=user.id,
            username=user.username,
            role_code=role.code,
            action="LOGIN_FAILED",
            description="Incorrect password",
            status="FAILURE",
        )
        db.commit()
        raise invalid

    if not user.is_active:
        log_audit(
            db,
            request=request,
            user_id=user.id,
            username=user.username,
            role_code=role.code,
            action="LOGIN_BLOCKED",
            description="Sign-in attempt on a deactivated account",
            status="FAILURE",
        )
        db.commit()
        raise unauthorized(
            "This account has been deactivated. Contact your administrator."
        )

    user.last_login_at = datetime.now(UTC)
    db.flush()

    current = load_current_user(db, user.id)
    log_audit(
        db,
        request=request,
        user=current,
        action="LOGIN",
        description=f"{user.full_name} signed in",
    )
    db.commit()

    return {
        "token": create_access_token(user.id, user.username, role.code),
        "user": _user_payload(current),
    }


@router.get("/me")
def me(user: CurrentUserDep):
    return {"user": _user_payload(user)}


@router.post("/change-password")
def change_password(
    payload: ChangePasswordRequest, request: Request, db: DbSession, user: CurrentUserDep
):
    row = db.get(User, user.id)
    if not verify_password(payload.current_password, row.password_hash):
        raise bad_request(
            "Please correct the highlighted fields",
            {"current_password": "That is not your current password"},
        )

    row.password_hash = hash_password(payload.new_password)
    log_audit(
        db,
        request=request,
        user=user,
        action="PASSWORD_CHANGED",
        entity_type="USER",
        entity_id=user.id,
        entity_label=user.username,
        description="Changed their own password",
    )
    db.commit()

    return {"message": "Your password has been updated"}


@router.post("/logout")
def logout(request: Request, db: DbSession, user: CurrentUserDep):
    log_audit(
        db,
        request=request,
        user=user,
        action="LOGOUT",
        description=f"{user.full_name} signed out",
    )
    db.commit()
    return {"message": "Signed out"}
