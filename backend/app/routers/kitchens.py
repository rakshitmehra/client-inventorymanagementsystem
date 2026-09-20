from datetime import UTC, datetime
from decimal import Decimal

from fastapi import APIRouter, Request
from sqlalchemy import Numeric, case, func, or_, select

from ..deps import (
    AdminUserDep,
    CurrentUserDep,
    DbSession,
    PaginationDep,
    assert_kitchen_access,
    sort_clause,
)
from ..errors import bad_request, conflict, not_found
from ..models import (
    Category,
    Item,
    Kitchen,
    KitchenInventory,
    KitchenManager,
    ProductionRecord,
    Role,
    RoleCode,
    StockMovement,
    Unit,
    User,
)
from ..schemas import (
    AssignManagerRequest,
    KitchenCreate,
    KitchenUpdate,
    MinLevelRequest,
    StatusUpdate,
    dt,
    f,
)
from ..security import q
from ..services.audit import log_audit

router = APIRouter(prefix="/kitchens", tags=["kitchens"])

# The effective minimum is the higher of the kitchen override and the catalogue
# default, so a kitchen can be stricter than the item but never looser.
EFFECTIVE_MIN = func.greatest(KitchenInventory.min_stock_level, Item.min_stock_level)


def _managers_of(db, kitchen_id: int) -> list[dict]:
    rows = db.execute(
        select(KitchenManager, User)
        .join(User, User.id == KitchenManager.user_id)
        .where(KitchenManager.kitchen_id == kitchen_id, KitchenManager.is_active.is_(True))
        .order_by(KitchenManager.is_primary.desc(), User.full_name)
    ).all()
    return [
        {
            "assignment_id": km.id,
            "assigned_at": dt(km.assigned_at),
            "is_primary": km.is_primary,
            "id": user.id,
            "username": user.username,
            "full_name": user.full_name,
            "email": user.email,
            "phone": user.phone,
            "is_active": user.is_active,
        }
        for km, user in rows
    ]


def _summary(db, kitchen_id: int) -> dict:
    row = db.execute(
        select(
            func.count(KitchenInventory.id).label("item_count"),
            func.coalesce(
                func.sum(KitchenInventory.quantity * Item.unit_cost), Decimal("0")
            ).label("stock_value"),
            func.coalesce(
                func.sum(case((KitchenInventory.quantity <= 0, 1), else_=0)), Decimal("0")
            ).label("out_of_stock"),
            func.coalesce(
                func.sum(
                    case(
                        (
                            (KitchenInventory.quantity > 0)
                            & (KitchenInventory.quantity <= EFFECTIVE_MIN),
                            1,
                        ),
                        else_=0,
                    )
                ),
                Decimal("0"),
            ).label("low_stock"),
        )
        .select_from(KitchenInventory)
        .join(Item, Item.id == KitchenInventory.item_id)
        .where(KitchenInventory.kitchen_id == kitchen_id)
    ).one()

    return {
        "item_count": row.item_count or 0,
        "stock_value": f(row.stock_value),
        "low_stock": row.low_stock or 0,
        "out_of_stock": row.out_of_stock or 0,
    }


def _serialise(kitchen: Kitchen) -> dict:
    return {
        "id": kitchen.id,
        "code": kitchen.code,
        "name": kitchen.name,
        "location": kitchen.location,
        "phone": kitchen.phone,
        "description": kitchen.description,
        "is_active": kitchen.is_active,
        "created_at": dt(kitchen.created_at),
        "updated_at": dt(kitchen.updated_at),
    }


def _assign_manager(db, kitchen_id: int, user_id: int, assigned_by: int) -> User:
    row = db.execute(
        select(User, Role).join(Role, Role.id == User.role_id).where(User.id == user_id)
    ).first()
    if row is None:
        raise not_found(f"User {user_id}")
    user, role = row

    if role.code != RoleCode.KITCHEN_MANAGER.value:
        raise bad_request(f"{user.full_name} is not a kitchen manager")

    already = db.execute(
        select(KitchenManager.id).where(
            KitchenManager.kitchen_id == kitchen_id,
            KitchenManager.user_id == user_id,
            KitchenManager.is_active.is_(True),
        )
    ).scalar_one_or_none()
    if already:
        raise conflict(f"{user.full_name} already manages this kitchen")

    existing = db.execute(
        select(func.count(KitchenManager.id)).where(
            KitchenManager.kitchen_id == kitchen_id, KitchenManager.is_active.is_(True)
        )
    ).scalar_one()

    db.add(
        KitchenManager(
            kitchen_id=kitchen_id,
            user_id=user_id,
            assigned_by=assigned_by,
            is_primary=existing == 0,
            is_active=True,
            active_key=True,
        )
    )
    db.flush()
    return user


# ---------------------------------------------------------------- listing ---
@router.get("")
def list_kitchens(
    db: DbSession,
    user: CurrentUserDep,
    include_inactive: bool = False,
    search: str | None = None,
):
    stmt = select(Kitchen)

    # A kitchen manager only ever sees their own kitchens.
    if not user.is_admin:
        if not user.kitchen_ids:
            return {"data": []}
        stmt = stmt.where(Kitchen.id.in_(user.kitchen_ids))
    if not include_inactive:
        stmt = stmt.where(Kitchen.is_active.is_(True))
    if search:
        like = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(Kitchen.name.ilike(like), Kitchen.code.ilike(like), Kitchen.location.ilike(like))
        )

    kitchens = db.execute(stmt.order_by(Kitchen.name)).scalars().all()
    return {
        "data": [
            {**_serialise(k), "managers": _managers_of(db, k.id), "summary": _summary(db, k.id)}
            for k in kitchens
        ]
    }


@router.get("/{kitchen_id}")
def get_kitchen(kitchen_id: int, db: DbSession, user: CurrentUserDep):
    assert_kitchen_access(user, kitchen_id)
    kitchen = db.get(Kitchen, kitchen_id)
    if kitchen is None:
        raise not_found("Kitchen")

    creator = db.get(User, kitchen.created_by) if kitchen.created_by else None

    history = db.execute(
        select(KitchenManager, User)
        .join(User, User.id == KitchenManager.user_id)
        .where(KitchenManager.kitchen_id == kitchen_id)
        .order_by(KitchenManager.assigned_at.desc())
    ).all()

    return {
        "data": {
            **_serialise(kitchen),
            "created_by_name": creator.full_name if creator else None,
            "managers": _managers_of(db, kitchen_id),
            "summary": _summary(db, kitchen_id),
            "manager_history": [
                {
                    "id": km.id,
                    "full_name": u.full_name,
                    "username": u.username,
                    "assigned_at": dt(km.assigned_at),
                    "unassigned_at": dt(km.unassigned_at),
                    "is_active": km.is_active,
                    "assigned_by_name": (
                        db.get(User, km.assigned_by).full_name if km.assigned_by else None
                    ),
                }
                for km, u in history
            ],
        }
    }


# ----------------------------------------------------------------- create ---
@router.post("", status_code=201)
def create_kitchen(payload: KitchenCreate, request: Request, db: DbSession, admin: AdminUserDep):
    kitchen = Kitchen(
        code=payload.code,
        name=payload.name,
        location=payload.location,
        phone=payload.phone,
        description=payload.description,
        created_by=admin.id,
    )
    db.add(kitchen)
    db.flush()

    for user_id in payload.manager_ids:
        _assign_manager(db, kitchen.id, int(user_id), admin.id)

    log_audit(
        db,
        request=request,
        user=admin,
        action="KITCHEN_CREATED",
        entity_type="KITCHEN",
        entity_id=kitchen.id,
        entity_label=f"{kitchen.code} - {kitchen.name}",
        description=f'Created kitchen "{kitchen.name}"',
        metadata=payload.model_dump(),
    )
    db.commit()

    return {"data": _serialise(kitchen)}


@router.put("/{kitchen_id}")
def update_kitchen(
    kitchen_id: int, payload: KitchenUpdate, request: Request, db: DbSession, admin: AdminUserDep
):
    kitchen = db.get(Kitchen, kitchen_id)
    if kitchen is None:
        raise not_found("Kitchen")

    before = _serialise(kitchen)
    kitchen.code = payload.code
    kitchen.name = payload.name
    kitchen.location = payload.location
    kitchen.phone = payload.phone
    kitchen.description = payload.description

    log_audit(
        db,
        request=request,
        user=admin,
        action="KITCHEN_UPDATED",
        entity_type="KITCHEN",
        entity_id=kitchen.id,
        entity_label=f"{kitchen.code} - {kitchen.name}",
        description=f'Updated kitchen "{kitchen.name}"',
        metadata={"before": before, "after": payload.model_dump()},
    )
    db.commit()

    return {"data": _serialise(kitchen)}


@router.patch("/{kitchen_id}/status")
def set_kitchen_status(
    kitchen_id: int, payload: StatusUpdate, request: Request, db: DbSession, admin: AdminUserDep
):
    kitchen = db.get(Kitchen, kitchen_id)
    if kitchen is None:
        raise not_found("Kitchen")

    if not payload.is_active:
        remaining = db.execute(
            select(func.coalesce(func.sum(KitchenInventory.quantity), Decimal("0"))).where(
                KitchenInventory.kitchen_id == kitchen_id
            )
        ).scalar_one()
        if remaining > 0 and not payload.force:
            raise conflict(
                f"{kitchen.name} still holds stock. Transfer it back to the Main "
                "Inventory first, or confirm to deactivate anyway.",
                {"requires_force": True, "remaining_quantity": f(q(remaining))},
            )

    kitchen.is_active = payload.is_active
    log_audit(
        db,
        request=request,
        user=admin,
        action="KITCHEN_ACTIVATED" if payload.is_active else "KITCHEN_DEACTIVATED",
        entity_type="KITCHEN",
        entity_id=kitchen.id,
        entity_label=kitchen.name,
        description=(
            f"{'Activated' if payload.is_active else 'Deactivated'} kitchen "
            f'"{kitchen.name}"'
        ),
    )
    db.commit()

    return {"data": _serialise(kitchen)}


@router.delete("/{kitchen_id}")
def delete_kitchen(kitchen_id: int, request: Request, db: DbSession, admin: AdminUserDep):
    kitchen = db.get(Kitchen, kitchen_id)
    if kitchen is None:
        raise not_found("Kitchen")

    movements = db.execute(
        select(func.count(StockMovement.id)).where(StockMovement.kitchen_id == kitchen_id)
    ).scalar_one()
    runs = db.execute(
        select(func.count(ProductionRecord.id)).where(ProductionRecord.kitchen_id == kitchen_id)
    ).scalar_one()

    if movements + runs > 0:
        raise conflict(
            f"{kitchen.name} has {movements + runs} historical record(s) and cannot be "
            "deleted. Deactivate it instead."
        )

    name = kitchen.name
    db.delete(kitchen)
    log_audit(
        db,
        request=request,
        user=admin,
        action="KITCHEN_DELETED",
        entity_type="KITCHEN",
        entity_id=kitchen_id,
        entity_label=name,
        description=f'Deleted kitchen "{name}"',
    )
    db.commit()

    return {"message": f'Kitchen "{name}" deleted'}


# ------------------------------------------------------ manager assignment --
@router.post("/{kitchen_id}/managers", status_code=201)
def assign_manager(
    kitchen_id: int,
    payload: AssignManagerRequest,
    request: Request,
    db: DbSession,
    admin: AdminUserDep,
):
    kitchen = db.get(Kitchen, kitchen_id)
    if kitchen is None:
        raise not_found("Kitchen")

    user = _assign_manager(db, kitchen_id, payload.user_id, admin.id)
    log_audit(
        db,
        request=request,
        user=admin,
        action="MANAGER_ASSIGNED",
        entity_type="KITCHEN",
        entity_id=kitchen.id,
        entity_label=kitchen.name,
        description=f'Assigned {user.full_name} to "{kitchen.name}"',
        metadata={"user_id": user.id, "username": user.username},
    )
    db.commit()

    return {"data": _managers_of(db, kitchen_id)}


@router.delete("/{kitchen_id}/managers/{user_id}")
def unassign_manager(
    kitchen_id: int, user_id: int, request: Request, db: DbSession, admin: AdminUserDep
):
    kitchen = db.get(Kitchen, kitchen_id)
    if kitchen is None:
        raise not_found("Kitchen")

    assignment = db.execute(
        select(KitchenManager).where(
            KitchenManager.kitchen_id == kitchen_id,
            KitchenManager.user_id == user_id,
            KitchenManager.is_active.is_(True),
        )
    ).scalar_one_or_none()
    if assignment is None:
        raise not_found("Assignment")

    assignment.is_active = False
    assignment.active_key = None
    assignment.unassigned_at = datetime.now(UTC)

    user = db.get(User, user_id)
    log_audit(
        db,
        request=request,
        user=admin,
        action="MANAGER_UNASSIGNED",
        entity_type="KITCHEN",
        entity_id=kitchen.id,
        entity_label=kitchen.name,
        description=(
            f'Removed {user.full_name if user else "a manager"} from "{kitchen.name}"'
        ),
    )
    db.commit()

    return {"data": _managers_of(db, kitchen_id)}


# ----------------------------------------------------- kitchen inventory ----
INVENTORY_SORTS = {
    "name": Item.name,
    "sku": Item.sku,
    "category": Category.name,
    "quantity": KitchenInventory.quantity,
    "value": KitchenInventory.quantity * Item.unit_cost,
    "updated_at": KitchenInventory.updated_at,
}


@router.get("/{kitchen_id}/inventory")
def kitchen_inventory(
    kitchen_id: int,
    db: DbSession,
    user: CurrentUserDep,
    page: PaginationDep,
    search: str | None = None,
    category_id: int | None = None,
    stock_status: str | None = None,
    hide_zero: bool = False,
    sort: str | None = "name",
    order: str | None = "asc",
):
    assert_kitchen_access(user, kitchen_id)
    kitchen = db.get(Kitchen, kitchen_id)
    if kitchen is None:
        raise not_found("Kitchen")

    base = (
        select(KitchenInventory, Item, Unit, Category)
        .join(Item, Item.id == KitchenInventory.item_id)
        .join(Unit, Unit.id == Item.unit_id)
        .outerjoin(Category, Category.id == Item.category_id)
        .where(KitchenInventory.kitchen_id == kitchen_id)
    )

    if search:
        like = f"%{search.strip()}%"
        base = base.where(or_(Item.name.ilike(like), Item.sku.ilike(like)))
    if category_id:
        base = base.where(Item.category_id == category_id)
    if stock_status == "low":
        base = base.where(
            KitchenInventory.quantity > 0, KitchenInventory.quantity <= EFFECTIVE_MIN
        )
    elif stock_status == "out":
        base = base.where(KitchenInventory.quantity <= 0)
    elif stock_status == "in":
        base = base.where(KitchenInventory.quantity > EFFECTIVE_MIN)
    if hide_zero:
        base = base.where(KitchenInventory.quantity > 0)

    count_stmt = base.with_only_columns(func.count(KitchenInventory.id)).order_by(None)
    total = db.execute(count_stmt).scalar_one()

    value_stmt = base.with_only_columns(
        func.coalesce(func.sum(KitchenInventory.quantity * Item.unit_cost), Decimal("0"))
    ).order_by(None)
    stock_value = db.execute(value_stmt).scalar_one()

    rows = db.execute(
        base.order_by(sort_clause(sort, order, INVENTORY_SORTS, "name"))
        .limit(page.page_size)
        .offset(page.offset)
    ).all()

    data = []
    for inv, item, unit, category in rows:
        effective_min = max(inv.min_stock_level, item.min_stock_level)
        if inv.quantity <= 0:
            status = "OUT"
        elif inv.quantity <= effective_min:
            status = "LOW"
        else:
            status = "OK"

        data.append(
            {
                "id": inv.id,
                "kitchen_id": inv.kitchen_id,
                "item_id": item.id,
                "sku": item.sku,
                "item_name": item.name,
                "quantity": f(inv.quantity),
                "kitchen_min_level": f(inv.min_stock_level),
                "item_min_level": f(item.min_stock_level),
                "effective_min_level": f(effective_min),
                "reorder_quantity": f(item.reorder_quantity),
                "unit_cost": f(item.unit_cost),
                "unit_id": unit.id,
                "unit_code": unit.code,
                "unit_name": unit.name,
                "category_id": category.id if category else None,
                "category_name": category.name if category else None,
                "stock_value": f(q(inv.quantity * item.unit_cost)),
                "stock_status": status,
                "is_active": item.is_active,
                "updated_at": dt(inv.updated_at),
            }
        )

    return {
        "data": data,
        "kitchen": _serialise(kitchen),
        "meta": page.meta(total, stock_value=f(stock_value)),
    }


@router.patch("/{kitchen_id}/inventory/{item_id}/min-level")
def set_min_level(
    kitchen_id: int,
    item_id: int,
    payload: MinLevelRequest,
    request: Request,
    db: DbSession,
    user: CurrentUserDep,
):
    assert_kitchen_access(user, kitchen_id)

    row = db.execute(
        select(KitchenInventory).where(
            KitchenInventory.kitchen_id == kitchen_id, KitchenInventory.item_id == item_id
        )
    ).scalar_one_or_none()
    if row is None:
        raise not_found("Kitchen stock line")

    before = f(row.min_stock_level)
    row.min_stock_level = q(payload.min_stock_level)

    item = db.get(Item, item_id)
    log_audit(
        db,
        request=request,
        user=user,
        action="MIN_LEVEL_UPDATED",
        entity_type="KITCHEN_INVENTORY",
        entity_id=row.id,
        entity_label=item.name if item else None,
        description=(
            f'Set minimum level for "{item.name if item else item_id}" to '
            f"{payload.min_stock_level}"
        ),
        metadata={"kitchen_id": kitchen_id, "before": before, "after": payload.min_stock_level},
    )
    db.commit()

    return {"message": "Minimum level updated"}
