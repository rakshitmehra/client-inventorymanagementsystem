from decimal import Decimal

from typing import Annotated

from fastapi import APIRouter, Query, Request
from sqlalchemy import func, or_, select

from ..database import run_in_transaction
from ..deps import CurrentUserDep, DbSession, PaginationDep, as_date, assert_kitchen_access
from ..errors import forbidden, not_found
from ..models import (
    Category,
    ConsumptionRecord,
    Item,
    Kitchen,
    KitchenInventory,
    Product,
    ProductionRecord,
    Recipe,
    RecipeIngredient,
    StockMovement,
    Unit,
    User,
)
from ..schemas import ProductionPreviewRequest, ProductionRequest, dt, f
from ..security import D
from ..services.audit import log_audit
from ..services.operations import execute_production, preview_production

router = APIRouter(prefix="/production", tags=["production"])


@router.get("/available/{kitchen_id}")
def available_products(kitchen_id: int, db: DbSession, user: CurrentUserDep):
    """
    Products a kitchen can actually make, with a readiness flag per product so
    the manager sees at a glance what is possible right now.
    """
    assert_kitchen_access(user, kitchen_id)

    products = db.execute(
        select(Product, Unit, Category, Recipe)
        .join(Unit, Unit.id == Product.unit_id)
        .join(Recipe, (Recipe.product_id == Product.id) & (Recipe.is_active.is_(True)))
        .outerjoin(Category, Category.id == Product.category_id)
        .where(Product.is_active.is_(True))
        .order_by(Product.name)
    ).all()

    data = []
    for product, unit, category, recipe in products:
        ingredients = db.execute(
            select(
                RecipeIngredient.item_id,
                RecipeIngredient.base_quantity,
                Item.name,
                func.coalesce(KitchenInventory.quantity, Decimal("0")).label("available"),
            )
            .join(Item, Item.id == RecipeIngredient.item_id)
            .outerjoin(
                KitchenInventory,
                (KitchenInventory.item_id == RecipeIngredient.item_id)
                & (KitchenInventory.kitchen_id == kitchen_id),
            )
            .where(RecipeIngredient.recipe_id == recipe.id)
            .order_by(Item.name)
        ).all()

        # How many finished units the kitchen could produce with what it holds.
        max_units: Decimal | None = None
        blocking = []
        for ingredient in ingredients:
            per_unit = D(ingredient.base_quantity) / D(recipe.yield_quantity)
            if per_unit <= 0:
                continue
            possible = D(ingredient.available) / per_unit
            max_units = possible if max_units is None else min(max_units, possible)
            if D(ingredient.available) <= 0:
                blocking.append(ingredient.name)

        producible = int(max_units) if max_units is not None and max_units > 0 else 0

        data.append(
            {
                "id": product.id,
                "sku": product.sku,
                "name": product.name,
                "description": product.description,
                "selling_price": f(product.selling_price),
                "unit_code": unit.code,
                "category_name": category.name if category else None,
                "recipe_id": recipe.id,
                "recipe_name": recipe.name,
                "version": recipe.version,
                "yield_quantity": f(recipe.yield_quantity),
                "prep_time_mins": recipe.prep_time_mins,
                "ingredient_count": len(ingredients),
                "max_producible": producible,
                "can_produce": producible >= 1,
                "blocking_items": blocking,
            }
        )

    return {"data": data}


@router.post("/preview")
def preview(payload: ProductionPreviewRequest, db: DbSession, user: CurrentUserDep):
    """Dry run: compute requirements and availability without writing anything."""
    assert_kitchen_access(user, payload.kitchen_id)
    return {"data": preview_production(db, payload)}


@router.post("", status_code=201)
def record_production(
    payload: ProductionRequest, request: Request, db: DbSession, user: CurrentUserDep
):
    """Commit the run: deduct every ingredient and record each one separately."""
    assert_kitchen_access(user, payload.kitchen_id)

    kitchen = db.get(Kitchen, payload.kitchen_id)
    product = db.get(Product, payload.product_id)

    def work(session):
        result = execute_production(session, payload, user)
        log_audit(
            session,
            request=request,
            user=user,
            action="PRODUCTION_RECORDED",
            entity_type="PRODUCTION",
            entity_id=result["id"],
            entity_label=result["production_no"],
            description=(
                f"Produced {result['output_quantity']} x "
                f"{product.name if product else payload.product_id} at "
                f"{kitchen.name if kitchen else payload.kitchen_id}, consuming "
                f"{result['ingredients_consumed']} ingredient(s)"
            ),
            metadata={"kitchen_id": payload.kitchen_id, "total_cost": result["total_cost"]},
        )
        return result

    result = run_in_transaction(db, work)
    return {
        "data": result,
        "message": (
            f"Production {result['production_no']} recorded - "
            f"{result['ingredients_consumed']} ingredient(s) deducted from "
            f"{kitchen.name if kitchen else 'the kitchen'}"
        ),
    }


@router.get("")
def list_production(
    db: DbSession,
    user: CurrentUserDep,
    page: PaginationDep,
    kitchen_id: int | None = None,
    product_id: int | None = None,
    search: str | None = None,
    from_: Annotated[str | None, Query(alias="from")] = None,
    to: str | None = None,
):
    ingredient_count = (
        select(func.count(ConsumptionRecord.id))
        .where(ConsumptionRecord.production_id == ProductionRecord.id)
        .scalar_subquery()
    )

    base = (
        select(ProductionRecord, Product, Kitchen, Unit, User, ingredient_count.label("ingredients"))
        .join(Product, Product.id == ProductionRecord.product_id)
        .join(Kitchen, Kitchen.id == ProductionRecord.kitchen_id)
        .join(Unit, Unit.id == ProductionRecord.output_unit_id)
        .outerjoin(User, User.id == ProductionRecord.created_by)
    )

    if not user.is_admin:
        if not user.kitchen_ids:
            return {"data": [], "meta": page.meta(0)}
        base = base.where(ProductionRecord.kitchen_id.in_(user.kitchen_ids))
    if kitchen_id:
        base = base.where(ProductionRecord.kitchen_id == kitchen_id)
    if product_id:
        base = base.where(ProductionRecord.product_id == product_id)
    if search:
        like = f"%{search.strip()}%"
        base = base.where(
            or_(ProductionRecord.production_no.ilike(like), Product.name.ilike(like))
        )
    if from_:
        base = base.where(func.date(ProductionRecord.produced_at) >= as_date(from_))
    if to:
        base = base.where(func.date(ProductionRecord.produced_at) <= as_date(to))

    total = db.execute(
        base.with_only_columns(func.count(ProductionRecord.id)).order_by(None)
    ).scalar_one()

    rows = db.execute(
        base.order_by(ProductionRecord.produced_at.desc(), ProductionRecord.id.desc())
        .limit(page.page_size)
        .offset(page.offset)
    ).all()

    return {
        "data": [
            {
                "id": record.id,
                "production_no": record.production_no,
                "kitchen_id": record.kitchen_id,
                "kitchen_name": kitchen.name,
                "kitchen_code": kitchen.code,
                "product_id": product.id,
                "product_name": product.name,
                "product_sku": product.sku,
                "batch_quantity": f(record.batch_quantity),
                "output_quantity": f(record.output_quantity),
                "output_unit_code": unit.code,
                "total_cost": f(record.total_cost),
                "status": record.status,
                "produced_at": dt(record.produced_at),
                "notes": record.notes,
                "created_by_name": creator.full_name if creator else None,
                "ingredient_count": ingredients,
            }
            for record, product, kitchen, unit, creator, ingredients in rows
        ],
        "meta": page.meta(total),
    }


@router.get("/{production_id}")
def get_production(production_id: int, db: DbSession, user: CurrentUserDep):
    row = db.execute(
        select(ProductionRecord, Product, Kitchen, Unit, Recipe, User)
        .join(Product, Product.id == ProductionRecord.product_id)
        .join(Kitchen, Kitchen.id == ProductionRecord.kitchen_id)
        .join(Unit, Unit.id == ProductionRecord.output_unit_id)
        .join(Recipe, Recipe.id == ProductionRecord.recipe_id)
        .outerjoin(User, User.id == ProductionRecord.created_by)
        .where(ProductionRecord.id == production_id)
    ).first()
    if row is None:
        raise not_found("Production record")

    record, product, kitchen, unit, recipe, creator = row
    if not user.is_admin and record.kitchen_id not in user.kitchen_ids:
        raise forbidden("This production run belongs to another kitchen")

    consumption = db.execute(
        select(ConsumptionRecord, Item, Unit.code, Category.name)
        .join(Item, Item.id == ConsumptionRecord.item_id)
        .join(Unit, Unit.id == ConsumptionRecord.unit_id)
        .outerjoin(Category, Category.id == Item.category_id)
        .where(ConsumptionRecord.production_id == production_id)
        .order_by(Item.name)
    ).all()

    movements = db.execute(
        select(StockMovement, Item.name)
        .join(Item, Item.id == StockMovement.item_id)
        .where(
            StockMovement.reference_type == "PRODUCTION",
            StockMovement.reference_id == production_id,
        )
        .order_by(StockMovement.id)
    ).all()

    return {
        "data": {
            "id": record.id,
            "production_no": record.production_no,
            "kitchen_id": record.kitchen_id,
            "kitchen_name": kitchen.name,
            "kitchen_code": kitchen.code,
            "kitchen_location": kitchen.location,
            "product_name": product.name,
            "product_sku": product.sku,
            "recipe_name": recipe.name,
            "recipe_version": recipe.version,
            "instructions": recipe.instructions,
            "batch_quantity": f(record.batch_quantity),
            "output_quantity": f(record.output_quantity),
            "output_unit_code": unit.code,
            "total_cost": f(record.total_cost),
            "status": record.status,
            "produced_at": dt(record.produced_at),
            "created_at": dt(record.created_at),
            "notes": record.notes,
            "created_by_name": creator.full_name if creator else None,
            "created_by_username": creator.username if creator else None,
            "consumption": [
                {
                    "id": c.id,
                    "item_id": item.id,
                    "item_name": item.name,
                    "sku": item.sku,
                    "category_name": category,
                    "required_quantity": f(c.required_quantity),
                    "consumed_quantity": f(c.consumed_quantity),
                    "unit_code": unit_code,
                    "balance_after": f(c.balance_after),
                    "unit_cost": f(c.unit_cost),
                    "total_cost": f(c.total_cost),
                }
                for c, item, unit_code, category in consumption
            ],
            "movements": [
                {
                    "id": m.id,
                    "movement_no": m.movement_no,
                    "item_name": item_name,
                    "quantity": f(m.quantity),
                    "balance_before": f(m.balance_before),
                    "balance_after": f(m.balance_after),
                    "created_at": dt(m.created_at),
                }
                for m, item_name in movements
            ],
        }
    }
