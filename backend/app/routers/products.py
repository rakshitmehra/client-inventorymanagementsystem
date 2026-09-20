from decimal import Decimal

from fastapi import APIRouter, Request
from sqlalchemy import func, or_, select

from ..database import run_in_transaction
from ..deps import AdminUserDep, CurrentUserDep, DbSession, PaginationDep
from ..errors import conflict, not_found
from ..models import (
    Category,
    Item,
    Product,
    ProductionRecord,
    Recipe,
    RecipeIngredient,
    Unit,
    User,
)
from ..schemas import ProductCreate, ProductUpdate, RecipeRequest, dt, f
from ..security import money
from ..services.audit import log_audit
from ..services.operations import prepare_ingredients

router = APIRouter(prefix="/products", tags=["products"])


def _load_recipe(db, recipe_id: int) -> dict | None:
    row = db.execute(
        select(Recipe, Unit, Product, User)
        .join(Unit, Unit.id == Recipe.yield_unit_id)
        .join(Product, Product.id == Recipe.product_id)
        .outerjoin(User, User.id == Recipe.created_by)
        .where(Recipe.id == recipe_id)
    ).first()
    if row is None:
        return None

    recipe, yield_unit, product, creator = row
    item_unit = Unit.__table__.alias("item_unit")

    ingredients = db.execute(
        select(RecipeIngredient, Item, Unit.code, item_unit.c.code, Category.name)
        .join(Item, Item.id == RecipeIngredient.item_id)
        .join(Unit, Unit.id == RecipeIngredient.unit_id)
        .join(item_unit, item_unit.c.id == Item.unit_id)
        .outerjoin(Category, Category.id == Item.category_id)
        .where(RecipeIngredient.recipe_id == recipe_id)
        .order_by(RecipeIngredient.sort_order, Item.name)
    ).all()

    lines = []
    total = Decimal("0")
    for ingredient, item, unit_code, base_code, category in ingredients:
        line_cost = money(ingredient.base_quantity * item.unit_cost)
        total += line_cost
        lines.append(
            {
                "id": ingredient.id,
                "item_id": item.id,
                "item_name": item.name,
                "sku": item.sku,
                "category_name": category,
                "item_is_active": item.is_active,
                "quantity": f(ingredient.quantity),
                "unit_id": ingredient.unit_id,
                "unit_code": unit_code,
                "base_quantity": f(ingredient.base_quantity),
                "item_unit_code": base_code,
                "unit_cost": f(item.unit_cost),
                "line_cost": f(line_cost),
                "is_optional": ingredient.is_optional,
                "notes": ingredient.notes,
            }
        )

    return {
        "id": recipe.id,
        "product_id": recipe.product_id,
        "product_name": product.name,
        "product_sku": product.sku,
        "name": recipe.name,
        "version": recipe.version,
        "yield_quantity": f(recipe.yield_quantity),
        "yield_unit_id": recipe.yield_unit_id,
        "yield_unit_code": yield_unit.code,
        "prep_time_mins": recipe.prep_time_mins,
        "instructions": recipe.instructions,
        "is_active": recipe.is_active,
        "created_at": dt(recipe.created_at),
        "created_by_name": creator.full_name if creator else None,
        "ingredients": lines,
        "estimated_cost": f(money(total)),
        "cost_per_unit": f(money(total / recipe.yield_quantity)) if recipe.yield_quantity else 0.0,
    }


# -------------------------------------------------------------- products ----
@router.get("")
def list_products(
    db: DbSession,
    _user: CurrentUserDep,
    page: PaginationDep,
    search: str | None = None,
    category_id: int | None = None,
    has_recipe: bool = False,
    include_inactive: bool = False,
):
    active_recipe = (
        select(Recipe.id)
        .where(Recipe.product_id == Product.id, Recipe.is_active.is_(True))
        .scalar_subquery()
    )
    ingredient_count = (
        select(func.count(RecipeIngredient.id))
        .select_from(RecipeIngredient)
        .join(Recipe, Recipe.id == RecipeIngredient.recipe_id)
        .where(Recipe.product_id == Product.id, Recipe.is_active.is_(True))
        .scalar_subquery()
    )
    produced = (
        select(func.coalesce(func.sum(ProductionRecord.output_quantity), Decimal("0")))
        .where(ProductionRecord.product_id == Product.id)
        .scalar_subquery()
    )

    base = (
        select(
            Product,
            Unit,
            Category,
            active_recipe.label("active_recipe_id"),
            ingredient_count.label("ingredient_count"),
            produced.label("total_produced"),
        )
        .join(Unit, Unit.id == Product.unit_id)
        .outerjoin(Category, Category.id == Product.category_id)
    )

    if not include_inactive:
        base = base.where(Product.is_active.is_(True))
    if search:
        like = f"%{search.strip()}%"
        base = base.where(or_(Product.name.ilike(like), Product.sku.ilike(like)))
    if category_id:
        base = base.where(Product.category_id == category_id)
    if has_recipe:
        base = base.where(active_recipe.is_not(None))

    total = db.execute(
        base.with_only_columns(func.count(Product.id)).order_by(None)
    ).scalar_one()

    rows = db.execute(
        base.order_by(Product.name).limit(page.page_size).offset(page.offset)
    ).all()

    return {
        "data": [
            {
                "id": product.id,
                "sku": product.sku,
                "name": product.name,
                "description": product.description,
                "category_id": product.category_id,
                "category_name": category.name if category else None,
                "unit_id": product.unit_id,
                "unit_code": unit.code,
                "unit_name": unit.name,
                "selling_price": f(product.selling_price),
                "is_active": product.is_active,
                "active_recipe_id": recipe_id,
                "ingredient_count": ingredients,
                "total_produced": f(produced_qty),
            }
            for product, unit, category, recipe_id, ingredients, produced_qty in rows
        ],
        "meta": page.meta(total),
    }


# Declared before /{product_id} so "recipes" is never read as an id.
@router.get("/recipes/{recipe_id}")
def get_recipe(recipe_id: int, db: DbSession, _user: CurrentUserDep):
    recipe = _load_recipe(db, recipe_id)
    if recipe is None:
        raise not_found("Recipe")
    return {"data": recipe}


@router.put("/recipes/{recipe_id}")
def update_recipe(
    recipe_id: int, payload: RecipeRequest, request: Request, db: DbSession, admin: AdminUserDep
):
    recipe = db.get(Recipe, recipe_id)
    if recipe is None:
        raise not_found("Recipe")

    def work(session):
        ingredients = prepare_ingredients(session, payload.ingredients)

        recipe.name = payload.name
        recipe.yield_quantity = payload.yield_quantity
        recipe.yield_unit_id = payload.yield_unit_id
        recipe.prep_time_mins = payload.prep_time_mins
        recipe.instructions = payload.instructions

        session.execute(
            RecipeIngredient.__table__.delete().where(
                RecipeIngredient.recipe_id == recipe_id
            )
        )
        for ingredient in ingredients:
            session.add(RecipeIngredient(recipe_id=recipe_id, **ingredient))

        log_audit(
            session,
            request=request,
            user=admin,
            action="RECIPE_UPDATED",
            entity_type="RECIPE",
            entity_id=recipe_id,
            entity_label=payload.name,
            description=f'Updated recipe "{payload.name}"',
            metadata={"ingredients": [dict(i) for i in ingredients]},
        )

    run_in_transaction(db, work)
    return {"data": _load_recipe(db, recipe_id)}


@router.patch("/recipes/{recipe_id}/activate")
def activate_recipe(recipe_id: int, request: Request, db: DbSession, admin: AdminUserDep):
    recipe = db.get(Recipe, recipe_id)
    if recipe is None:
        raise not_found("Recipe")

    def work(session):
        current = session.execute(
            select(Recipe).where(
                Recipe.product_id == recipe.product_id, Recipe.is_active.is_(True)
            )
        ).scalar_one_or_none()
        if current is not None and current.id != recipe_id:
            current.deactivate()
            session.flush()

        target = session.get(Recipe, recipe_id)
        target.activate()

        log_audit(
            session,
            request=request,
            user=admin,
            action="RECIPE_ACTIVATED",
            entity_type="RECIPE",
            entity_id=recipe_id,
            entity_label=target.name,
            description=(
                f'Made recipe "{target.name}" (v{target.version}) the active version'
            ),
        )

    run_in_transaction(db, work)
    return {"data": _load_recipe(db, recipe_id)}


@router.delete("/recipes/{recipe_id}")
def delete_recipe(recipe_id: int, request: Request, db: DbSession, admin: AdminUserDep):
    recipe = db.get(Recipe, recipe_id)
    if recipe is None:
        raise not_found("Recipe")

    used = db.execute(
        select(func.count(ProductionRecord.id)).where(ProductionRecord.recipe_id == recipe_id)
    ).scalar_one()
    if used:
        raise conflict(
            f"This recipe was used for {used} production run(s) and is kept for history. "
            "Create a new version instead."
        )

    name = recipe.name
    db.delete(recipe)
    log_audit(
        db,
        request=request,
        user=admin,
        action="RECIPE_DELETED",
        entity_type="RECIPE",
        entity_id=recipe_id,
        entity_label=name,
        description=f'Deleted recipe "{name}"',
    )
    db.commit()

    return {"message": f'Recipe "{name}" deleted'}


@router.get("/{product_id}")
def get_product(product_id: int, db: DbSession, _user: CurrentUserDep):
    row = db.execute(
        select(Product, Unit, Category)
        .join(Unit, Unit.id == Product.unit_id)
        .outerjoin(Category, Category.id == Product.category_id)
        .where(Product.id == product_id)
    ).first()
    if row is None:
        raise not_found("Product")

    product, unit, category = row
    recipe_ids = db.execute(
        select(Recipe.id).where(Recipe.product_id == product_id).order_by(Recipe.version.desc())
    ).scalars().all()

    recipes = [_load_recipe(db, rid) for rid in recipe_ids]
    active = next((r for r in recipes if r and r["is_active"]), None)

    return {
        "data": {
            "id": product.id,
            "sku": product.sku,
            "name": product.name,
            "description": product.description,
            "category_id": product.category_id,
            "category_name": category.name if category else None,
            "unit_id": product.unit_id,
            "unit_code": unit.code,
            "unit_name": unit.name,
            "selling_price": f(product.selling_price),
            "is_active": product.is_active,
            "recipes": recipes,
            "active_recipe": active,
        }
    }


@router.post("", status_code=201)
def create_product(payload: ProductCreate, request: Request, db: DbSession, admin: AdminUserDep):
    product = Product(**payload.model_dump(), created_by=admin.id)
    db.add(product)
    db.flush()

    log_audit(
        db,
        request=request,
        user=admin,
        action="PRODUCT_CREATED",
        entity_type="PRODUCT",
        entity_id=product.id,
        entity_label=f"{product.sku} - {product.name}",
        description=f'Created product "{product.name}"',
    )
    db.commit()

    return {"data": {"id": product.id, "sku": product.sku, "name": product.name}}


@router.put("/{product_id}")
def update_product(
    product_id: int, payload: ProductUpdate, request: Request, db: DbSession, admin: AdminUserDep
):
    product = db.get(Product, product_id)
    if product is None:
        raise not_found("Product")

    before = {"sku": product.sku, "name": product.name, "is_active": product.is_active}
    for key, value in payload.model_dump().items():
        setattr(product, key, value)

    log_audit(
        db,
        request=request,
        user=admin,
        action="PRODUCT_UPDATED",
        entity_type="PRODUCT",
        entity_id=product.id,
        entity_label=f"{product.sku} - {product.name}",
        description=f'Updated product "{product.name}"',
        metadata={"before": before, "after": payload.model_dump()},
    )
    db.commit()

    return {"data": {"id": product.id, "sku": product.sku, "name": product.name}}


@router.delete("/{product_id}")
def delete_product(product_id: int, request: Request, db: DbSession, admin: AdminUserDep):
    product = db.get(Product, product_id)
    if product is None:
        raise not_found("Product")

    produced = db.execute(
        select(func.count(ProductionRecord.id)).where(ProductionRecord.product_id == product_id)
    ).scalar_one()

    if produced:
        product.is_active = False
        log_audit(
            db,
            request=request,
            user=admin,
            action="PRODUCT_ARCHIVED",
            entity_type="PRODUCT",
            entity_id=product.id,
            entity_label=product.name,
            description=f'Archived product "{product.name}" (it has production history)',
        )
        db.commit()
        return {
            "message": (
                f'"{product.name}" has production history, so it was archived rather '
                "than deleted"
            ),
            "archived": True,
        }

    name = product.name
    db.delete(product)
    log_audit(
        db,
        request=request,
        user=admin,
        action="PRODUCT_DELETED",
        entity_type="PRODUCT",
        entity_id=product_id,
        entity_label=name,
        description=f'Deleted product "{name}"',
    )
    db.commit()

    return {"message": f'Product "{name}" deleted', "archived": False}


@router.get("/{product_id}/recipes")
def list_recipes(product_id: int, db: DbSession, _user: CurrentUserDep):
    recipe_ids = db.execute(
        select(Recipe.id).where(Recipe.product_id == product_id).order_by(Recipe.version.desc())
    ).scalars().all()
    return {"data": [_load_recipe(db, rid) for rid in recipe_ids]}


@router.post("/{product_id}/recipes", status_code=201)
def create_recipe(
    product_id: int, payload: RecipeRequest, request: Request, db: DbSession, admin: AdminUserDep
):
    product = db.get(Product, product_id)
    if product is None:
        raise not_found("Product")

    def work(session):
        ingredients = prepare_ingredients(session, payload.ingredients)

        # A new recipe becomes the active one; earlier versions are retained for
        # history so past production still points at what was actually used.
        max_version = session.execute(
            select(func.coalesce(func.max(Recipe.version), 0)).where(
                Recipe.product_id == product_id
            )
        ).scalar_one()

        current = session.execute(
            select(Recipe).where(Recipe.product_id == product_id, Recipe.is_active.is_(True))
        ).scalar_one_or_none()
        if current is not None:
            current.deactivate()
            session.flush()

        recipe = Recipe(
            product_id=product_id,
            name=payload.name,
            version=max_version + 1,
            yield_quantity=payload.yield_quantity,
            yield_unit_id=payload.yield_unit_id,
            prep_time_mins=payload.prep_time_mins,
            instructions=payload.instructions,
            is_active=True,
            active_key=True,
            created_by=admin.id,
        )
        session.add(recipe)
        session.flush()

        for ingredient in ingredients:
            session.add(RecipeIngredient(recipe_id=recipe.id, **ingredient))

        log_audit(
            session,
            request=request,
            user=admin,
            action="RECIPE_CREATED",
            entity_type="RECIPE",
            entity_id=recipe.id,
            entity_label=payload.name,
            description=(
                f'Added recipe "{payload.name}" for "{product.name}" with '
                f"{len(ingredients)} ingredient(s)"
            ),
            metadata={"product_id": product_id},
        )
        return recipe.id

    recipe_id = run_in_transaction(db, work)
    return {"data": _load_recipe(db, recipe_id)}
