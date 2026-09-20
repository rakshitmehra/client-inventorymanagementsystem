from decimal import Decimal

from fastapi import APIRouter, Request
from sqlalchemy import func, or_, select

from ..deps import AdminUserDep, CurrentUserDep, DbSession, PaginationDep, sort_clause
from ..errors import bad_request, conflict, not_found
from ..models import (
    Category,
    Item,
    KitchenInventory,
    MainInventory,
    Product,
    Recipe,
    RecipeIngredient,
    StockMovement,
    StockReceipt,
    Supplier,
    Unit,
)
from ..schemas import (
    CategoryCreate,
    CategoryUpdate,
    ItemCreate,
    ItemUpdate,
    SupplierCreate,
    SupplierUpdate,
    dt,
    f,
)
from ..services.audit import log_audit
from ..services.inventory import item_stock_breakdown

router = APIRouter(tags=["catalogue"])


# ------------------------------------------------------------------ units ---
@router.get("/units")
def list_units(db: DbSession, _user: CurrentUserDep):
    rows = db.execute(select(Unit).order_by(Unit.dimension, Unit.factor)).scalars().all()
    return {
        "data": [
            {
                "id": u.id,
                "code": u.code,
                "name": u.name,
                "dimension": u.dimension,
                "factor": f(u.factor),
                "is_base": u.is_base,
            }
            for u in rows
        ]
    }


# ------------------------------------------------------------- categories ---
@router.get("/categories")
def list_categories(db: DbSession, _user: CurrentUserDep, include_inactive: bool = False):
    item_count = (
        select(func.count(Item.id)).where(Item.category_id == Category.id).scalar_subquery()
    )
    product_count = (
        select(func.count(Product.id))
        .where(Product.category_id == Category.id)
        .scalar_subquery()
    )

    stmt = select(Category, item_count.label("item_count"), product_count.label("product_count"))
    if not include_inactive:
        stmt = stmt.where(Category.is_active.is_(True))

    rows = db.execute(stmt.order_by(Category.name)).all()
    return {
        "data": [
            {
                "id": c.id,
                "name": c.name,
                "description": c.description,
                "is_active": c.is_active,
                "created_at": dt(c.created_at),
                "item_count": items,
                "product_count": products,
            }
            for c, items, products in rows
        ]
    }


@router.post("/categories", status_code=201)
def create_category(
    payload: CategoryCreate, request: Request, db: DbSession, admin: AdminUserDep
):
    category = Category(name=payload.name, description=payload.description)
    db.add(category)
    db.flush()

    log_audit(
        db,
        request=request,
        user=admin,
        action="CATEGORY_CREATED",
        entity_type="CATEGORY",
        entity_id=category.id,
        entity_label=category.name,
        description=f'Created category "{category.name}"',
    )
    db.commit()

    return {"data": {"id": category.id, "name": category.name, "is_active": category.is_active}}


@router.put("/categories/{category_id}")
def update_category(
    category_id: int,
    payload: CategoryUpdate,
    request: Request,
    db: DbSession,
    admin: AdminUserDep,
):
    category = db.get(Category, category_id)
    if category is None:
        raise not_found("Category")

    before = {"name": category.name, "is_active": category.is_active}
    category.name = payload.name
    category.description = payload.description
    category.is_active = payload.is_active

    log_audit(
        db,
        request=request,
        user=admin,
        action="CATEGORY_UPDATED",
        entity_type="CATEGORY",
        entity_id=category.id,
        entity_label=category.name,
        description=f'Updated category "{category.name}"',
        metadata={"before": before, "after": payload.model_dump()},
    )
    db.commit()

    return {"data": {"id": category.id, "name": category.name, "is_active": category.is_active}}


@router.delete("/categories/{category_id}")
def delete_category(category_id: int, request: Request, db: DbSession, admin: AdminUserDep):
    category = db.get(Category, category_id)
    if category is None:
        raise not_found("Category")

    items = db.execute(
        select(func.count(Item.id)).where(Item.category_id == category_id)
    ).scalar_one()
    products = db.execute(
        select(func.count(Product.id)).where(Product.category_id == category_id)
    ).scalar_one()

    if items + products > 0:
        raise conflict(
            f'"{category.name}" is used by {items + products} item(s) or product(s). '
            "Deactivate it instead."
        )

    name = category.name
    db.delete(category)
    log_audit(
        db,
        request=request,
        user=admin,
        action="CATEGORY_DELETED",
        entity_type="CATEGORY",
        entity_id=category_id,
        entity_label=name,
        description=f'Deleted category "{name}"',
    )
    db.commit()

    return {"message": f'Category "{name}" deleted'}


# -------------------------------------------------------------- suppliers ---
@router.get("/suppliers")
def list_suppliers(
    db: DbSession, _user: CurrentUserDep, include_inactive: bool = False, search: str | None = None
):
    item_count = (
        select(func.count(Item.id))
        .where(Item.default_supplier_id == Supplier.id)
        .scalar_subquery()
    )
    stmt = select(Supplier, item_count.label("item_count"))

    if not include_inactive:
        stmt = stmt.where(Supplier.is_active.is_(True))
    if search:
        like = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                Supplier.name.ilike(like),
                Supplier.contact_person.ilike(like),
                Supplier.phone.ilike(like),
            )
        )

    rows = db.execute(stmt.order_by(Supplier.name)).all()
    return {
        "data": [
            {
                "id": s.id,
                "name": s.name,
                "contact_person": s.contact_person,
                "phone": s.phone,
                "email": s.email,
                "address": s.address,
                "notes": s.notes,
                "is_active": s.is_active,
                "item_count": count,
            }
            for s, count in rows
        ]
    }


@router.post("/suppliers", status_code=201)
def create_supplier(
    payload: SupplierCreate, request: Request, db: DbSession, admin: AdminUserDep
):
    supplier = Supplier(**payload.model_dump())
    db.add(supplier)
    db.flush()

    log_audit(
        db,
        request=request,
        user=admin,
        action="SUPPLIER_CREATED",
        entity_type="SUPPLIER",
        entity_id=supplier.id,
        entity_label=supplier.name,
        description=f'Added supplier "{supplier.name}"',
    )
    db.commit()

    return {"data": {"id": supplier.id, "name": supplier.name, "is_active": supplier.is_active}}


@router.put("/suppliers/{supplier_id}")
def update_supplier(
    supplier_id: int,
    payload: SupplierUpdate,
    request: Request,
    db: DbSession,
    admin: AdminUserDep,
):
    supplier = db.get(Supplier, supplier_id)
    if supplier is None:
        raise not_found("Supplier")

    for key, value in payload.model_dump().items():
        setattr(supplier, key, value)

    log_audit(
        db,
        request=request,
        user=admin,
        action="SUPPLIER_UPDATED",
        entity_type="SUPPLIER",
        entity_id=supplier.id,
        entity_label=supplier.name,
        description=f'Updated supplier "{supplier.name}"',
    )
    db.commit()

    return {"data": {"id": supplier.id, "name": supplier.name, "is_active": supplier.is_active}}


@router.delete("/suppliers/{supplier_id}")
def delete_supplier(supplier_id: int, request: Request, db: DbSession, admin: AdminUserDep):
    supplier = db.get(Supplier, supplier_id)
    if supplier is None:
        raise not_found("Supplier")

    receipts = db.execute(
        select(func.count(StockReceipt.id)).where(StockReceipt.supplier_id == supplier_id)
    ).scalar_one()
    if receipts:
        raise conflict(
            f'"{supplier.name}" has {receipts} goods receipt(s) on record. '
            "Deactivate it instead."
        )

    name = supplier.name
    db.delete(supplier)
    log_audit(
        db,
        request=request,
        user=admin,
        action="SUPPLIER_DELETED",
        entity_type="SUPPLIER",
        entity_id=supplier_id,
        entity_label=name,
        description=f'Deleted supplier "{name}"',
    )
    db.commit()

    return {"message": f'Supplier "{name}" deleted'}


# ------------------------------------------------------------------ items ---
KITCHEN_QTY = (
    select(func.coalesce(func.sum(KitchenInventory.quantity), Decimal("0")))
    .where(KitchenInventory.item_id == Item.id)
    .scalar_subquery()
)
MAIN_QTY = func.coalesce(MainInventory.quantity, Decimal("0"))

ITEM_SORTS = {
    "name": Item.name,
    "sku": Item.sku,
    "category": Category.name,
    "main_quantity": MAIN_QTY,
    "total_quantity": MAIN_QTY + KITCHEN_QTY,
    "unit_cost": Item.unit_cost,
    "created_at": Item.created_at,
}


def _item_row(item: Item, unit: Unit, category, supplier, main_qty, kitchen_qty) -> dict:
    return {
        "id": item.id,
        "sku": item.sku,
        "name": item.name,
        "description": item.description,
        "category_id": item.category_id,
        "category_name": category.name if category else None,
        "unit_id": item.unit_id,
        "unit_code": unit.code,
        "unit_name": unit.name,
        "dimension": unit.dimension,
        "min_stock_level": f(item.min_stock_level),
        "max_stock_level": f(item.max_stock_level) if item.max_stock_level is not None else None,
        "reorder_quantity": f(item.reorder_quantity),
        "unit_cost": f(item.unit_cost),
        "default_supplier_id": item.default_supplier_id,
        "supplier_name": supplier.name if supplier else None,
        "is_perishable": item.is_perishable,
        "is_active": item.is_active,
        "main_quantity": f(main_qty),
        "kitchen_quantity": f(kitchen_qty),
        "total_quantity": f((main_qty or 0) + (kitchen_qty or 0)),
        "created_at": dt(item.created_at),
        "updated_at": dt(item.updated_at),
    }


@router.get("/items")
def list_items(
    db: DbSession,
    _user: CurrentUserDep,
    page: PaginationDep,
    search: str | None = None,
    category_id: int | None = None,
    supplier_id: int | None = None,
    include_inactive: bool = False,
    sort: str | None = "name",
    order: str | None = "asc",
):
    base = (
        select(Item, Unit, Category, Supplier, MAIN_QTY.label("main_qty"), KITCHEN_QTY.label("kitchen_qty"))
        .join(Unit, Unit.id == Item.unit_id)
        .outerjoin(MainInventory, MainInventory.item_id == Item.id)
        .outerjoin(Category, Category.id == Item.category_id)
        .outerjoin(Supplier, Supplier.id == Item.default_supplier_id)
    )

    if not include_inactive:
        base = base.where(Item.is_active.is_(True))
    if search:
        like = f"%{search.strip()}%"
        base = base.where(
            or_(Item.name.ilike(like), Item.sku.ilike(like), Item.description.ilike(like))
        )
    if category_id:
        base = base.where(Item.category_id == category_id)
    if supplier_id:
        base = base.where(Item.default_supplier_id == supplier_id)

    total = db.execute(
        base.with_only_columns(func.count(Item.id)).order_by(None)
    ).scalar_one()

    rows = db.execute(
        base.order_by(sort_clause(sort, order, ITEM_SORTS, "name"))
        .limit(page.page_size)
        .offset(page.offset)
    ).all()

    return {
        "data": [_item_row(*row) for row in rows],
        "meta": page.meta(total),
    }


@router.get("/items/{item_id}")
def get_item_detail(item_id: int, db: DbSession, _user: CurrentUserDep):
    row = db.execute(
        select(Item, Unit, Category, Supplier, MAIN_QTY.label("main_qty"), KITCHEN_QTY.label("kitchen_qty"))
        .join(Unit, Unit.id == Item.unit_id)
        .outerjoin(MainInventory, MainInventory.item_id == Item.id)
        .outerjoin(Category, Category.id == Item.category_id)
        .outerjoin(Supplier, Supplier.id == Item.default_supplier_id)
        .where(Item.id == item_id)
    ).first()
    if row is None:
        raise not_found("Item")

    used_in = db.execute(
        select(Product.id, Product.name, Recipe.id, Recipe.name, RecipeIngredient.quantity, Unit.code)
        .select_from(RecipeIngredient)
        .join(Recipe, Recipe.id == RecipeIngredient.recipe_id)
        .join(Product, Product.id == Recipe.product_id)
        .join(Unit, Unit.id == RecipeIngredient.unit_id)
        .where(RecipeIngredient.item_id == item_id, Recipe.is_active.is_(True))
        .order_by(Product.name)
    ).all()

    return {
        "data": {
            **_item_row(*row),
            "stock": item_stock_breakdown(db, item_id),
            "used_in_recipes": [
                {
                    "product_id": pid,
                    "product_name": pname,
                    "recipe_id": rid,
                    "recipe_name": rname,
                    "quantity": f(qty),
                    "unit_code": code,
                }
                for pid, pname, rid, rname, qty, code in used_in
            ],
        }
    }


@router.post("/items", status_code=201)
def create_item(payload: ItemCreate, request: Request, db: DbSession, admin: AdminUserDep):
    if db.get(Unit, payload.unit_id) is None:
        raise bad_request("Choose a valid unit")

    item = Item(**payload.model_dump())
    db.add(item)
    db.flush()

    # Every item gets a main-inventory row immediately, starting at zero.
    db.add(MainInventory(item_id=item.id, quantity=Decimal("0")))

    log_audit(
        db,
        request=request,
        user=admin,
        action="ITEM_CREATED",
        entity_type="ITEM",
        entity_id=item.id,
        entity_label=f"{item.sku} - {item.name}",
        description=f'Created item "{item.name}"',
        metadata=payload.model_dump(),
    )
    db.commit()

    return {"data": {"id": item.id, "sku": item.sku, "name": item.name}}


@router.put("/items/{item_id}")
def update_item(
    item_id: int, payload: ItemUpdate, request: Request, db: DbSession, admin: AdminUserDep
):
    item = db.get(Item, item_id)
    if item is None:
        raise not_found("Item")

    # Changing the stocking unit would silently reinterpret every stored
    # balance, so it is only allowed while the item has never held stock.
    if payload.unit_id != item.unit_id:
        moved = db.execute(
            select(func.count(StockMovement.id)).where(StockMovement.item_id == item_id)
        ).scalar_one()
        if moved:
            raise conflict(
                "The unit cannot be changed once the item has stock history. "
                "Create a new item instead."
            )

    before = {"sku": item.sku, "name": item.name, "unit_cost": f(item.unit_cost)}
    for key, value in payload.model_dump().items():
        setattr(item, key, value)

    log_audit(
        db,
        request=request,
        user=admin,
        action="ITEM_UPDATED",
        entity_type="ITEM",
        entity_id=item.id,
        entity_label=f"{item.sku} - {item.name}",
        description=f'Updated item "{item.name}"',
        metadata={"before": before, "after": payload.model_dump()},
    )
    db.commit()

    return {"data": {"id": item.id, "sku": item.sku, "name": item.name}}


@router.delete("/items/{item_id}")
def delete_item(item_id: int, request: Request, db: DbSession, admin: AdminUserDep):
    item = db.get(Item, item_id)
    if item is None:
        raise not_found("Item")

    stock = item_stock_breakdown(db, item_id)
    history = db.execute(
        select(func.count(StockMovement.id)).where(StockMovement.item_id == item_id)
    ).scalar_one()

    if stock["total_quantity"] > 0 or history > 0:
        item.is_active = False
        log_audit(
            db,
            request=request,
            user=admin,
            action="ITEM_ARCHIVED",
            entity_type="ITEM",
            entity_id=item.id,
            entity_label=item.name,
            description=f'Archived item "{item.name}" (it has stock or history)',
        )
        db.commit()
        return {
            "message": (
                f'"{item.name}" has stock history, so it was archived rather than deleted'
            ),
            "archived": True,
        }

    name = item.name
    db.execute(MainInventory.__table__.delete().where(MainInventory.item_id == item_id))
    db.delete(item)
    log_audit(
        db,
        request=request,
        user=admin,
        action="ITEM_DELETED",
        entity_type="ITEM",
        entity_id=item_id,
        entity_label=name,
        description=f'Deleted item "{name}"',
    )
    db.commit()

    return {"message": f'Item "{name}" deleted', "archived": False}
