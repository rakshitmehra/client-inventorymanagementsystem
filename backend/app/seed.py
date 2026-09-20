"""
Database bootstrap and demo dataset.

``ensure_seed`` runs on boot: it creates the tables, loads the reference data
(roles, units, company settings) and guarantees an administrator exists. On a
completely empty database it also loads the demo dataset so a fresh clone has
something to look at. Set SEED_DEMO_DATA=false to skip that.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import Sequence as SASequence
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from .config import settings
from .database import Base, SessionLocal, engine, run_in_transaction
from .deps import CurrentUser
from .models import (
    AuditLog,
    Category,
    ConsumptionRecord,
    InventoryAdjustment,
    InventoryTransfer,
    Item,
    Kitchen,
    KitchenManager,
    MainInventory,
    Product,
    ProductionRecord,
    Recipe,
    RecipeIngredient,
    Role,
    RoleCode,
    Setting,
    StockMovement,
    StockReceipt,
    Supplier,
    Unit,
    User,
    WastageRecord,
)
from .security import D, hash_password, q
from .services.operations import (
    create_adjustment,
    create_transfer,
    execute_production,
    receive_stock,
    record_wastage,
)

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# reference data - always present, independent of the demo dataset
# ---------------------------------------------------------------------------
ROLES = [
    (
        RoleCode.ADMIN.value,
        "Administrator",
        "Full access to every kitchen, the Main Inventory and all reports",
    ),
    (
        RoleCode.KITCHEN_MANAGER.value,
        "Kitchen Manager",
        "Access limited to the kitchens they are assigned to",
    ),
]

UNITS = [
    ("g", "Gram", "MASS", Decimal("1"), True),
    ("kg", "Kilogram", "MASS", Decimal("1000"), False),
    ("ml", "Millilitre", "VOLUME", Decimal("1"), True),
    ("l", "Litre", "VOLUME", Decimal("1000"), False),
    ("pcs", "Pieces", "COUNT", Decimal("1"), True),
    ("dozen", "Dozen", "COUNT", Decimal("12"), False),
    ("tray", "Tray (30)", "COUNT", Decimal("30"), False),
]

SETTINGS = [
    ("company_name", "Golden Crust Bakery & Kitchens"),
    ("company_address", "14 Industrial Estate Road, Pune 411001"),
    ("company_phone", "+91 20 4000 1200"),
    ("company_email", "operations@goldencrust.example"),
    ("company_currency", "INR"),
]

ADMIN_DEFAULTS = {
    "username": "admin",
    "email": "admin@goldencrust.example",
    "password": "Admin@123",
    "full_name": "Priya Raghunathan",
    "phone": "+91 98200 11001",
}

# ---------------------------------------------------------------------------
# demo dataset
# ---------------------------------------------------------------------------
CATEGORIES = [
    ("Flours & Grains", "Wheat flour, refined flour, semolina and other milled grains"),
    ("Dairy", "Milk, cream, butter, cheese and other chilled dairy products"),
    ("Sweeteners", "Sugars, syrups and icing preparations"),
    ("Eggs & Proteins", "Eggs and protein ingredients"),
    ("Baking Essentials", "Leavening agents, essences and small-quantity additives"),
    ("Chocolate & Nuts", "Cocoa, chocolate and nut products"),
    ("Finished Goods", "Products produced by the kitchens"),
]

SUPPLIERS = [
    ("Sunrise Flour Mills", "Ramesh Iyer", "+91 98110 22001", "sales@sunrisemills.example", "Plot 22, MIDC Bhosari, Pune"),
    ("Deccan Dairy Co-operative", "Anita Kulkarni", "+91 98220 44112", "orders@deccandairy.example", "Dairy Road, Baramati"),
    ("Everest Sweeteners Pvt Ltd", "Farhan Shaikh", "+91 98330 77223", "contact@everestsweet.example", "Sugar Complex, Kolhapur"),
    ("Valley Farm Eggs", "Sunita Patil", "+91 98440 99334", "hello@valleyfarm.example", "Village Wagholi, Pune"),
    ("Cocoa Craft Imports", "Daniel Fernandes", "+91 98550 66445", "imports@cocoacraft.example", "Warehouse 7, Navi Mumbai"),
]

# sku, name, category, unit, min level, reorder qty, unit cost, supplier, perishable
ITEMS = [
    ("RM-FLR-001", "Wheat Flour", "Flours & Grains", "kg", 60, 200, "42", "Sunrise Flour Mills", False),
    ("RM-FLR-002", "Maida (Refined Flour)", "Flours & Grains", "kg", 50, 150, "46", "Sunrise Flour Mills", False),
    ("RM-FLR-003", "Semolina", "Flours & Grains", "kg", 20, 60, "52", "Sunrise Flour Mills", False),
    ("RM-DRY-001", "Fresh Cream", "Dairy", "l", 40, 120, "210", "Deccan Dairy Co-operative", True),
    ("RM-DRY-002", "Unsalted Butter", "Dairy", "kg", 30, 90, "480", "Deccan Dairy Co-operative", True),
    ("RM-DRY-003", "Full Cream Milk", "Dairy", "l", 50, 150, "62", "Deccan Dairy Co-operative", True),
    ("RM-DRY-004", "Cream Cheese", "Dairy", "kg", 15, 40, "640", "Deccan Dairy Co-operative", True),
    ("RM-SWT-001", "Granulated Sugar", "Sweeteners", "kg", 60, 200, "48", "Everest Sweeteners Pvt Ltd", False),
    ("RM-SWT-002", "Icing Sugar", "Sweeteners", "kg", 20, 60, "72", "Everest Sweeteners Pvt Ltd", False),
    ("RM-SWT-003", "Honey", "Sweeteners", "l", 8, 24, "420", "Everest Sweeteners Pvt Ltd", False),
    ("RM-EGG-001", "Eggs", "Eggs & Proteins", "pcs", 300, 900, "7", "Valley Farm Eggs", True),
    ("RM-BKE-001", "Baking Powder", "Baking Essentials", "g", 2000, 5000, "0.38", None, False),
    ("RM-BKE-002", "Active Dry Yeast", "Baking Essentials", "g", 1500, 4000, "0.62", None, False),
    ("RM-BKE-003", "Vanilla Essence", "Baking Essentials", "ml", 1000, 3000, "1.9", None, False),
    ("RM-BKE-004", "Refined Salt", "Baking Essentials", "kg", 10, 30, "22", None, False),
    ("RM-CHO-001", "Cocoa Powder", "Chocolate & Nuts", "kg", 12, 40, "690", "Cocoa Craft Imports", False),
    ("RM-CHO-002", "Dark Chocolate Chips", "Chocolate & Nuts", "kg", 15, 45, "580", "Cocoa Craft Imports", False),
    ("RM-CHO-003", "Almond Flakes", "Chocolate & Nuts", "kg", 8, 25, "920", "Cocoa Craft Imports", False),
]

KITCHENS = [
    ("KIT-CP", "Central Production Kitchen", "Bhosari Industrial Area, Pune", "+91 20 4000 1210",
     "Main production facility handling bulk cakes and breads"),
    ("KIT-KP", "Koregaon Park Outlet Kitchen", "North Main Road, Koregaon Park, Pune", "+91 20 4000 1220",
     "Outlet kitchen serving the flagship cafe"),
    ("KIT-HN", "Hinjewadi Cloud Kitchen", "Phase 2, Hinjewadi, Pune", "+91 20 4000 1230",
     "Delivery-only kitchen for the tech park corridor"),
]

MANAGERS = [
    ("rajesh.kumar", "Rajesh Kumar", "rajesh.kumar@goldencrust.example", "+91 98201 33221", "KIT-CP"),
    ("meera.nair", "Meera Nair", "meera.nair@goldencrust.example", "+91 98202 44332", "KIT-KP"),
    ("arjun.deshpande", "Arjun Deshpande", "arjun.deshpande@goldencrust.example", "+91 98203 55443", "KIT-HN"),
]

MANAGER_PASSWORD = "Manager@123"

PRODUCTS = [
    {
        "sku": "FG-CAKE-001",
        "name": "Classic Vanilla Cake (1 kg)",
        "description": "Signature vanilla sponge with fresh cream frosting",
        "unit": "pcs",
        "price": "850",
        "recipe": {
            "name": "Classic Vanilla Cake - Standard",
            "yield": 1,
            "yield_unit": "pcs",
            "prep": 90,
            "instructions": (
                "Cream the butter and sugar, fold in the sifted flours and baking powder, add "
                "the eggs one at a time, then the vanilla. Bake at 180 C for 35 minutes. Cool "
                "fully before whipping the cream and frosting."
            ),
            "ingredients": [
                ("RM-FLR-001", 500, "g"),
                ("RM-FLR-002", 250, "g"),
                ("RM-DRY-001", 500, "ml"),
                ("RM-SWT-001", 200, "g"),
                ("RM-DRY-002", 200, "g"),
                ("RM-EGG-001", 4, "pcs"),
                ("RM-BKE-003", 10, "ml"),
                ("RM-BKE-001", 15, "g"),
            ],
        },
    },
    {
        "sku": "FG-BRWN-001",
        "name": "Chocolate Fudge Brownie",
        "description": "Dense chocolate brownie, sold by the piece",
        "unit": "pcs",
        "price": "120",
        "recipe": {
            "name": "Chocolate Fudge Brownie - Tray of 12",
            "yield": 12,
            "yield_unit": "pcs",
            "prep": 60,
            "instructions": (
                "Melt the butter with the chocolate chips, whisk in the sugar and eggs, fold in "
                "the maida and cocoa. Bake at 170 C for 28 minutes in a lined tray and cut into "
                "12 squares."
            ),
            "ingredients": [
                ("RM-FLR-002", 300, "g"),
                ("RM-SWT-001", 400, "g"),
                ("RM-DRY-002", 250, "g"),
                ("RM-CHO-001", 150, "g"),
                ("RM-EGG-001", 4, "pcs"),
                ("RM-CHO-002", 200, "g"),
            ],
        },
    },
    {
        "sku": "FG-CROI-001",
        "name": "Butter Croissant",
        "description": "Laminated all-butter croissant",
        "unit": "pcs",
        "price": "95",
        "recipe": {
            "name": "Butter Croissant - Batch of 10",
            "yield": 10,
            "yield_unit": "pcs",
            "prep": 240,
            "instructions": (
                "Make the detrempe, rest overnight, laminate with the butter block through three "
                "single folds, shape, proof for 2 hours and bake at 200 C for 18 minutes."
            ),
            "ingredients": [
                ("RM-FLR-001", 1, "kg"),
                ("RM-DRY-002", 500, "g"),
                ("RM-DRY-003", 300, "ml"),
                ("RM-BKE-002", 20, "g"),
                ("RM-SWT-001", 80, "g"),
                ("RM-BKE-004", 20, "g"),
            ],
        },
    },
    {
        "sku": "FG-CHSE-001",
        "name": "New York Cheesecake (1 kg)",
        "description": "Baked cheesecake on a butter biscuit base",
        "unit": "pcs",
        "price": "1150",
        "recipe": {
            "name": "New York Cheesecake - Standard",
            "yield": 1,
            "yield_unit": "pcs",
            "prep": 150,
            "instructions": (
                "Beat the cream cheese smooth, add sugar, then eggs one at a time, finish with "
                "cream. Bake in a water bath at 160 C for 70 minutes and chill overnight."
            ),
            "ingredients": [
                ("RM-DRY-004", 800, "g"),
                ("RM-DRY-001", 600, "ml"),
                ("RM-SWT-001", 250, "g"),
                ("RM-EGG-001", 5, "pcs"),
                ("RM-DRY-002", 150, "g"),
                ("RM-FLR-002", 100, "g"),
            ],
        },
    },
]

OPENING_STOCK = [
    ("RM-FLR-001", 600, "kg"), ("RM-FLR-002", 450, "kg"), ("RM-FLR-003", 120, "kg"),
    ("RM-DRY-001", 320, "l"), ("RM-DRY-002", 240, "kg"), ("RM-DRY-003", 400, "l"),
    ("RM-DRY-004", 90, "kg"), ("RM-SWT-001", 500, "kg"), ("RM-SWT-002", 120, "kg"),
    ("RM-SWT-003", 40, "l"), ("RM-EGG-001", 90, "tray"), ("RM-BKE-001", 12, "kg"),
    ("RM-BKE-002", 9, "kg"), ("RM-BKE-003", 6, "l"), ("RM-BKE-004", 60, "kg"),
    ("RM-CHO-001", 70, "kg"), ("RM-CHO-002", 85, "kg"), ("RM-CHO-003", 35, "kg"),
]

TRANSFER_PLAN = [
    ("KIT-CP", 18, [
        ("RM-FLR-001", 180, "kg"), ("RM-FLR-002", 140, "kg"), ("RM-DRY-001", 110, "l"),
        ("RM-DRY-002", 80, "kg"), ("RM-DRY-003", 120, "l"), ("RM-DRY-004", 30, "kg"),
        ("RM-SWT-001", 160, "kg"), ("RM-EGG-001", 30, "tray"), ("RM-CHO-001", 22, "kg"),
        ("RM-CHO-002", 26, "kg"), ("RM-BKE-001", 4, "kg"), ("RM-BKE-002", 3, "kg"),
        ("RM-BKE-003", 2, "l"), ("RM-BKE-004", 18, "kg"),
    ]),
    ("KIT-KP", 16, [
        ("RM-FLR-001", 90, "kg"), ("RM-FLR-002", 70, "kg"), ("RM-DRY-001", 70, "l"),
        ("RM-DRY-002", 50, "kg"), ("RM-DRY-003", 80, "l"), ("RM-DRY-004", 22, "kg"),
        ("RM-SWT-001", 90, "kg"), ("RM-EGG-001", 18, "tray"), ("RM-CHO-001", 14, "kg"),
        ("RM-CHO-002", 16, "kg"), ("RM-BKE-001", 2.5, "kg"), ("RM-BKE-002", 2, "kg"),
        ("RM-BKE-003", 1.2, "l"), ("RM-BKE-004", 10, "kg"),
    ]),
    ("KIT-HN", 14, [
        ("RM-FLR-001", 70, "kg"), ("RM-FLR-002", 55, "kg"), ("RM-DRY-001", 45, "l"),
        ("RM-DRY-002", 38, "kg"), ("RM-DRY-003", 60, "l"), ("RM-SWT-001", 70, "kg"),
        ("RM-EGG-001", 12, "tray"), ("RM-CHO-001", 9, "kg"), ("RM-CHO-002", 11, "kg"),
        ("RM-BKE-001", 1.8, "kg"), ("RM-BKE-002", 1.5, "kg"), ("RM-BKE-003", 0.8, "l"),
        ("RM-BKE-004", 8, "kg"),
    ]),
]

PRODUCTION_PLAN = [
    ("KIT-CP", "FG-CAKE-001", 14, 12, "rajesh.kumar"),
    ("KIT-CP", "FG-BRWN-001", 48, 12, "rajesh.kumar"),
    ("KIT-KP", "FG-CROI-001", 60, 11, "meera.nair"),
    ("KIT-CP", "FG-CAKE-001", 9, 9, "rajesh.kumar"),
    ("KIT-HN", "FG-BRWN-001", 36, 9, "arjun.deshpande"),
    ("KIT-KP", "FG-CHSE-001", 6, 8, "meera.nair"),
    ("KIT-CP", "FG-CROI-001", 80, 7, "rajesh.kumar"),
    ("KIT-HN", "FG-CROI-001", 40, 6, "arjun.deshpande"),
    ("KIT-KP", "FG-CAKE-001", 7, 4, "meera.nair"),
    ("KIT-CP", "FG-BRWN-001", 60, 3, "rajesh.kumar"),
    ("KIT-HN", "FG-CAKE-001", 5, 2, "arjun.deshpande"),
    ("KIT-KP", "FG-BRWN-001", 24, 1, "meera.nair"),
]

WASTAGE_PLAN = [
    ("KIT-CP", "RM-DRY-001", 4, "l", "SPOILED", "Cream left out of the chiller overnight", 10),
    ("KIT-KP", "RM-EGG-001", 18, "pcs", "DAMAGED", "Tray dropped during unloading", 8),
    ("KIT-HN", "RM-DRY-003", 6, "l", "EXPIRED", "Past the use-by date", 6),
    ("KIT-CP", "RM-FLR-002", 3, "kg", "SPILLAGE", "Bag split while being moved", 4),
    ("KIT-KP", "RM-DRY-002", 2, "kg", "QUALITY_REJECT", "Off smell on opening", 2),
]


def _days_ago(n: int) -> str:
    return (datetime.now(UTC) - timedelta(days=n)).isoformat()


def _as_user(db: Session, user: User) -> CurrentUser:
    role = db.get(Role, user.role_id)
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
        kitchens=[],
    )


# ---------------------------------------------------------------------------
def seed_reference_data(db: Session) -> None:
    for code, name, description in ROLES:
        if db.execute(select(Role).where(Role.code == code)).scalar_one_or_none() is None:
            db.add(Role(code=code, name=name, description=description))

    for code, name, dimension, factor, is_base in UNITS:
        if db.execute(select(Unit).where(Unit.code == code)).scalar_one_or_none() is None:
            db.add(Unit(code=code, name=name, dimension=dimension, factor=factor, is_base=is_base))

    for key, value in SETTINGS:
        if db.get(Setting, key) is None:
            db.add(Setting(key=key, value=value))

    db.flush()


def ensure_admin(db: Session) -> User:
    """The fallback administrator, created only when no admin exists at all."""
    admin_role = db.execute(
        select(Role).where(Role.code == RoleCode.ADMIN.value)
    ).scalar_one()

    existing = db.execute(
        select(User).where(User.role_id == admin_role.id).limit(1)
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    admin = User(
        username=ADMIN_DEFAULTS["username"],
        email=ADMIN_DEFAULTS["email"],
        password_hash=hash_password(ADMIN_DEFAULTS["password"]),
        full_name=ADMIN_DEFAULTS["full_name"],
        phone=ADMIN_DEFAULTS["phone"],
        role_id=admin_role.id,
    )
    db.add(admin)
    db.flush()
    return admin


def _lookup(db: Session, model, column, value):
    return db.execute(select(model).where(column == value)).scalar_one_or_none()


def seed_demo_data(db: Session, admin: User) -> None:
    unit_by_code = {u.code: u for u in db.execute(select(Unit)).scalars()}
    admin_user = _as_user(db, admin)

    # -- catalogue ----------------------------------------------------------
    for name, description in CATEGORIES:
        if _lookup(db, Category, Category.name, name) is None:
            db.add(Category(name=name, description=description))

    for name, contact, phone, email, address in SUPPLIERS:
        if _lookup(db, Supplier, Supplier.name, name) is None:
            db.add(
                Supplier(
                    name=name,
                    contact_person=contact,
                    phone=phone,
                    email=email,
                    address=address,
                )
            )
    db.flush()

    categories = {c.name: c for c in db.execute(select(Category)).scalars()}
    suppliers = {s.name: s for s in db.execute(select(Supplier)).scalars()}

    for sku, name, category, unit, min_level, reorder, cost, supplier, perishable in ITEMS:
        if _lookup(db, Item, Item.sku, sku) is not None:
            continue
        item = Item(
            sku=sku,
            name=name,
            category_id=categories[category].id,
            unit_id=unit_by_code[unit].id,
            min_stock_level=D(min_level),
            reorder_quantity=D(reorder),
            unit_cost=D(cost),
            default_supplier_id=suppliers[supplier].id if supplier else None,
            is_perishable=perishable,
        )
        db.add(item)
        db.flush()
        db.add(MainInventory(item_id=item.id, quantity=Decimal("0")))
    db.flush()

    items = {i.sku: i for i in db.execute(select(Item)).scalars()}

    # -- kitchens and their managers ----------------------------------------
    for code, name, location, phone, description in KITCHENS:
        if _lookup(db, Kitchen, Kitchen.code, code) is None:
            db.add(
                Kitchen(
                    code=code,
                    name=name,
                    location=location,
                    phone=phone,
                    description=description,
                    created_by=admin.id,
                )
            )
    db.flush()

    kitchens = {k.code: k for k in db.execute(select(Kitchen)).scalars()}
    manager_role = db.execute(
        select(Role).where(Role.code == RoleCode.KITCHEN_MANAGER.value)
    ).scalar_one()

    for username, full_name, email, phone, kitchen_code in MANAGERS:
        user = _lookup(db, User, User.username, username)
        if user is None:
            user = User(
                username=username,
                email=email,
                password_hash=hash_password(MANAGER_PASSWORD),
                full_name=full_name,
                phone=phone,
                role_id=manager_role.id,
                created_by=admin.id,
            )
            db.add(user)
            db.flush()

        kitchen = kitchens[kitchen_code]
        already = db.execute(
            select(KitchenManager).where(
                KitchenManager.kitchen_id == kitchen.id,
                KitchenManager.user_id == user.id,
                KitchenManager.is_active.is_(True),
            )
        ).scalar_one_or_none()
        if already is None:
            db.add(
                KitchenManager(
                    kitchen_id=kitchen.id,
                    user_id=user.id,
                    assigned_by=admin.id,
                    is_primary=True,
                    is_active=True,
                    active_key=True,
                )
            )
    db.flush()

    managers = {u.username: u for u in db.execute(select(User)).scalars()}

    # -- products and recipes -----------------------------------------------
    for spec in PRODUCTS:
        if _lookup(db, Product, Product.sku, spec["sku"]) is not None:
            continue

        product = Product(
            sku=spec["sku"],
            name=spec["name"],
            description=spec["description"],
            category_id=categories["Finished Goods"].id,
            unit_id=unit_by_code[spec["unit"]].id,
            selling_price=D(spec["price"]),
            created_by=admin.id,
        )
        db.add(product)
        db.flush()

        recipe_spec = spec["recipe"]
        recipe = Recipe(
            product_id=product.id,
            name=recipe_spec["name"],
            version=1,
            yield_quantity=D(recipe_spec["yield"]),
            yield_unit_id=unit_by_code[recipe_spec["yield_unit"]].id,
            prep_time_mins=recipe_spec["prep"],
            instructions=recipe_spec["instructions"],
            is_active=True,
            active_key=True,
            created_by=admin.id,
        )
        db.add(recipe)
        db.flush()

        for order, (sku, quantity, unit_code) in enumerate(recipe_spec["ingredients"]):
            item = items[sku]
            entered = unit_by_code[unit_code]
            stocking = unit_by_code[item.unit.code]
            db.add(
                RecipeIngredient(
                    recipe_id=recipe.id,
                    item_id=item.id,
                    quantity=D(quantity),
                    unit_id=entered.id,
                    base_quantity=q(D(quantity) * entered.factor / stocking.factor),
                    sort_order=order,
                )
            )
    db.flush()

    # -- opening stock into the Main Inventory -------------------------------
    by_supplier: dict[int | None, list[dict]] = {}
    for sku, quantity, unit_code in OPENING_STOCK:
        item = items[sku]
        by_supplier.setdefault(item.default_supplier_id, []).append(
            {
                "item_id": item.id,
                "quantity": quantity,
                "unit_id": unit_by_code[unit_code].id,
                "unit_cost": float(item.unit_cost),
            }
        )

    receipt_day = 24
    for supplier_id, lines in by_supplier.items():
        receive_stock(
            db,
            {
                "supplier_id": supplier_id,
                "invoice_no": f"INV-{2026000 + receipt_day}",
                "received_at": _days_ago(receipt_day),
                "notes": "Opening stock load",
                "items": lines,
            },
            admin_user,
        )
        receipt_day -= 1
    db.flush()

    # -- distribute to the kitchens ------------------------------------------
    for kitchen_code, day, lines in TRANSFER_PLAN:
        create_transfer(
            db,
            {
                "from_location_type": "MAIN",
                "to_location_type": "KITCHEN",
                "to_kitchen_id": kitchens[kitchen_code].id,
                "transfer_date": _days_ago(day),
                "notes": "Initial stocking of the kitchen sub-inventory",
                "items": [
                    {
                        "item_id": items[sku].id,
                        "quantity": quantity,
                        "unit_id": unit_by_code[unit_code].id,
                    }
                    for sku, quantity, unit_code in lines
                ],
            },
            admin_user,
        )

    # A top-up run so the transfer history is not all on one day.
    create_transfer(
        db,
        {
            "from_location_type": "MAIN",
            "to_location_type": "KITCHEN",
            "to_kitchen_id": kitchens["KIT-CP"].id,
            "transfer_date": _days_ago(5),
            "notes": "Weekly top-up ahead of the festival orders",
            "items": [
                {"item_id": items["RM-FLR-001"].id, "quantity": 60, "unit_id": unit_by_code["kg"].id},
                {"item_id": items["RM-DRY-002"].id, "quantity": 25, "unit_id": unit_by_code["kg"].id},
                {"item_id": items["RM-EGG-001"].id, "quantity": 10, "unit_id": unit_by_code["tray"].id},
            ],
        },
        admin_user,
    )
    db.flush()

    # -- production history ---------------------------------------------------
    products = {p.sku: p for p in db.execute(select(Product)).scalars()}

    for kitchen_code, product_sku, quantity, day, username in PRODUCTION_PLAN:
        try:
            execute_production(
                db,
                {
                    "kitchen_id": kitchens[kitchen_code].id,
                    "product_id": products[product_sku].id,
                    "output_quantity": quantity,
                    "produced_at": _days_ago(day),
                    "notes": "Scheduled production run",
                },
                _as_user(db, managers[username]),
            )
        except Exception as error:  # noqa: BLE001 - demo data is best-effort
            log.warning("skipped production %s at %s: %s", product_sku, kitchen_code, error)
    db.flush()

    # -- wastage and adjustments ---------------------------------------------
    manager_for_kitchen = {code: username for username, _, _, _, code in
                           [(m[0], m[1], m[2], m[3], m[4]) for m in MANAGERS]}

    for kitchen_code, sku, quantity, unit_code, reason_code, reason, day in WASTAGE_PLAN:
        try:
            record_wastage(
                db,
                {
                    "location_type": "KITCHEN",
                    "kitchen_id": kitchens[kitchen_code].id,
                    "item_id": items[sku].id,
                    "quantity": quantity,
                    "unit_id": unit_by_code[unit_code].id,
                    "reason_code": reason_code,
                    "reason": reason,
                    "recorded_at": _days_ago(day),
                },
                _as_user(db, managers[manager_for_kitchen[kitchen_code]]),
            )
        except Exception as error:  # noqa: BLE001
            log.warning("skipped wastage %s at %s: %s", sku, kitchen_code, error)

    try:
        from .services.inventory import KITCHEN as KITCHEN_LOCATION, get_balance

        counted = get_balance(db, KITCHEN_LOCATION, kitchens["KIT-CP"].id, items["RM-FLR-001"].id)
        create_adjustment(
            db,
            {
                "location_type": "KITCHEN",
                "kitchen_id": kitchens["KIT-CP"].id,
                "item_id": items["RM-FLR-001"].id,
                "new_quantity": float(max(Decimal("0"), counted - Decimal("2.5"))),
                "reason_code": "STOCK_COUNT",
                "reason": "Monthly physical count - minor shortfall against the system figure",
                "adjusted_at": _days_ago(2),
            },
            admin_user,
        )
    except Exception as error:  # noqa: BLE001
        log.warning("skipped adjustment: %s", error)

    db.flush()
    _backfill_audit_trail(db)


def _backfill_audit_trail(db: Session) -> None:
    """
    The demo operations above call the services directly rather than going
    through the HTTP layer, so no audit rows were written for them. Derive the
    trail from the documents themselves so the Audit Log page opens with real
    history instead of an empty table.
    """
    users = {u.id: u for u in db.execute(select(User)).scalars()}
    roles = {r.id: r for r in db.execute(select(Role)).scalars()}

    def actor(user_id: int | None) -> tuple[str | None, str | None]:
        user = users.get(user_id)
        if user is None:
            return None, None
        return user.username, roles[user.role_id].code

    def add(user_id, action, entity_type, entity_id, label, description, created_at):
        username, role_code = actor(user_id)
        db.add(
            AuditLog(
                user_id=user_id,
                username=username,
                role_code=role_code,
                action=action,
                entity_type=entity_type,
                entity_id=entity_id,
                entity_label=label,
                description=description,
                created_at=created_at,
            )
        )

    for receipt in db.execute(select(StockReceipt).order_by(StockReceipt.id)).scalars():
        supplier = db.get(Supplier, receipt.supplier_id) if receipt.supplier_id else None
        add(
            receipt.created_by,
            "STOCK_RECEIVED",
            "RECEIPT",
            receipt.id,
            receipt.receipt_no,
            (
                f"Received {receipt.total_items} item(s) into the Main Inventory from "
                f"{supplier.name if supplier else 'an external supplier'} ({receipt.receipt_no})"
            ),
            receipt.received_at,
        )

    for transfer in db.execute(select(InventoryTransfer).order_by(InventoryTransfer.id)).scalars():
        source = (
            "Main Inventory"
            if transfer.from_location_type == "MAIN"
            else db.get(Kitchen, transfer.from_kitchen_id).name
        )
        destination = (
            "Main Inventory"
            if transfer.to_location_type == "MAIN"
            else db.get(Kitchen, transfer.to_kitchen_id).name
        )
        add(
            transfer.created_by,
            "STOCK_TRANSFERRED",
            "TRANSFER",
            transfer.id,
            transfer.transfer_no,
            (
                f"Transferred {transfer.total_items} item(s) from {source} to {destination} "
                f"({transfer.transfer_no})"
            ),
            transfer.transfer_date,
        )

    for record in db.execute(select(ProductionRecord).order_by(ProductionRecord.id)).scalars():
        ingredients = db.execute(
            select(func.count(ConsumptionRecord.id)).where(
                ConsumptionRecord.production_id == record.id
            )
        ).scalar_one()
        add(
            record.created_by,
            "PRODUCTION_RECORDED",
            "PRODUCTION",
            record.id,
            record.production_no,
            (
                f"Produced {record.output_quantity} x {db.get(Product, record.product_id).name} "
                f"at {db.get(Kitchen, record.kitchen_id).name}, consuming {ingredients} "
                "ingredient(s)"
            ),
            record.produced_at,
        )

    for waste in db.execute(select(WastageRecord).order_by(WastageRecord.id)).scalars():
        place = (
            "Main Inventory"
            if waste.location_type == "MAIN"
            else db.get(Kitchen, waste.kitchen_id).name
        )
        add(
            waste.recorded_by,
            "WASTAGE_RECORDED",
            "WASTAGE",
            waste.id,
            waste.wastage_no,
            (
                f"Recorded wastage of {waste.quantity} "
                f"{db.get(Item, waste.item_id).name} at {place} ({waste.reason_code})"
            ),
            waste.recorded_at,
        )

    for adjustment in db.execute(
        select(InventoryAdjustment).order_by(InventoryAdjustment.id)
    ).scalars():
        place = (
            "Main Inventory"
            if adjustment.location_type == "MAIN"
            else db.get(Kitchen, adjustment.kitchen_id).name
        )
        add(
            adjustment.created_by,
            "STOCK_ADJUSTED",
            "ADJUSTMENT",
            adjustment.id,
            adjustment.adjustment_no,
            (
                f"Adjusted {db.get(Item, adjustment.item_id).name} at {place} from "
                f"{adjustment.previous_quantity} to {adjustment.new_quantity} "
                f"({adjustment.reason_code})"
            ),
            adjustment.adjusted_at,
        )

    for kitchen in db.execute(select(Kitchen).order_by(Kitchen.id)).scalars():
        add(
            kitchen.created_by,
            "KITCHEN_CREATED",
            "KITCHEN",
            kitchen.id,
            f"{kitchen.code} - {kitchen.name}",
            f'Created kitchen "{kitchen.name}"',
            kitchen.created_at,
        )

    for user in db.execute(
        select(User).where(User.created_by.is_not(None)).order_by(User.id)
    ).scalars():
        add(
            user.created_by,
            "USER_CREATED",
            "USER",
            user.id,
            user.username,
            f"Created {roles[user.role_id].name.lower()} account for {user.full_name}",
            user.created_at,
        )

    db.flush()


def _primary_key_sequences() -> list[str]:
    """Names of the sequences backing every primary key."""
    names: list[str] = []
    for table in Base.metadata.sorted_tables:
        for column in table.primary_key.columns:
            default = column.default
            if isinstance(default, SASequence):
                names.append(default.name)
    return names


def create_schema() -> None:
    """
    Create the sequences, then the tables.

    The sequences are issued explicitly rather than left to create_all(): the
    columns carry ``DEFAULT nextval(...)``, so the sequence has to exist before
    the table that references it.
    """
    with engine.begin() as connection:
        for name in _primary_key_sequences():
            connection.execute(text(f'CREATE SEQUENCE IF NOT EXISTS "{name}"'))
    Base.metadata.create_all(engine)


def ensure_seed() -> None:
    """Called on boot: create the schema, reference data and a guaranteed admin."""
    create_schema()

    db = SessionLocal()
    try:
        def bootstrap(session: Session):
            seed_reference_data(session)
            return ensure_admin(session)

        admin = run_in_transaction(db, bootstrap)

        if not settings.seed_demo_data:
            return

        item_count = db.execute(select(func.count(Item.id))).scalar_one()
        if item_count:
            return

        log.info("Empty database detected - loading the demo dataset")
        run_in_transaction(db, lambda session: seed_demo_data(session, admin))

        log.info("Demo data seeded.")
        log.info("  Administrator     %s / %s", ADMIN_DEFAULTS["username"], ADMIN_DEFAULTS["password"])
        for username, *_ in MANAGERS:
            log.info("  Kitchen manager   %s / %s", username, MANAGER_PASSWORD)
    finally:
        db.close()


def reset_database() -> None:
    """Drop every table and sequence. Used by ``python -m app.seed --reset``."""
    Base.metadata.drop_all(engine)
    with engine.begin() as connection:
        for name in _primary_key_sequences():
            connection.execute(text(f'DROP SEQUENCE IF EXISTS "{name}" CASCADE'))
    log.info("All tables and sequences dropped.")


if __name__ == "__main__":
    import sys

    logging.basicConfig(level=logging.INFO, format="%(message)s")

    if "--reset" in sys.argv:
        reset_database()
    ensure_seed()
