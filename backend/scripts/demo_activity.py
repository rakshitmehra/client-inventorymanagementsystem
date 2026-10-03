"""
Fill the app with demo ACTIVITY on top of your real items and lists.

For a demo or a screenshot: stock in the main store and the kitchens, deliveries,
what the kitchens used, waste, requests, past bills and the notifications that
follow. Nothing here touches the catalogue - no item or standard list is created,
changed or deleted, and no price is changed. The activity is built on the items
you already have.

Everything it creates has a note starting "DEMO:", and `remove` finds exactly
those records, takes their stock back out and deletes them. Remove the demo data
before the system is used for real: if real movements have happened since, the
stock cannot always be put back and `remove` will say so and stop.

    python scripts/demo_activity.py add             # show the plan
    python scripts/demo_activity.py add --commit    # create the demo activity
    python scripts/demo_activity.py remove          # show what would be removed
    python scripts/demo_activity.py remove --commit # remove it again

`add` talks to the running API (so every rule, number and notification behaves as
it does for a person) - start the API first. `remove` works on the database
directly, using the same DATABASE_URL as the API.

    KITCHENSTOCK_API       default http://127.0.0.1:8000/api
    KITCHENSTOCK_USER      admin login, default admin
    KITCHENSTOCK_PASSWORD  default Admin@123
    KITCHENSTOCK_MANAGER_PASSWORD  default Manager@123 (kitchen managers)
"""

import argparse
import json
import os
import random
import sys
import urllib.error
import urllib.request
from datetime import UTC, datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

API = os.environ.get("KITCHENSTOCK_API", "http://127.0.0.1:8000/api")
ADMIN_USER = os.environ.get("KITCHENSTOCK_USER", "admin")
ADMIN_PASSWORD = os.environ.get("KITCHENSTOCK_PASSWORD", "Admin@123")
MANAGER_PASSWORD = os.environ.get("KITCHENSTOCK_MANAGER_PASSWORD", "Manager@123")

TAG = "DEMO:"
# Kitchen code -> its manager's username (the demo accounts the app seeds).
MANAGERS = {"KIT-CP": "rajesh.kumar", "KIT-KP": "meera.nair", "KIT-HN": "arjun.deshpande"}

rng = random.Random(2026)


# --------------------------------------------------------------------- api ---
class ApiError(RuntimeError):
    pass


def call(method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(API + path, data=data, method=method)
    if data:
        request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as error:
        try:
            message = json.loads(error.read())["error"]["message"]
        except Exception:  # noqa: BLE001
            message = f"HTTP {error.code}"
        raise ApiError(message) from None


def login(username, password):
    return call("POST", "/auth/login", body={"username": username, "password": password})["token"]


def days_ago(n, hour=10):
    moment = datetime.now(UTC).replace(hour=hour, minute=rng.randint(0, 59), second=0, microsecond=0)
    return (moment - timedelta(days=n)).isoformat()


def step(label, fn):
    """Run one piece of the demo; a failure is reported, never fatal."""
    try:
        result = fn()
        print(f"  ok    {label}")
        return result
    except ApiError as error:
        print(f"  FAIL  {label}: {error}")
    return None


def usual(quantity, unit_code):
    """
    A list quantity of 1 is the placeholder the lists were built with, not how
    much anybody really buys, so demo amounts use a believable figure instead.
    """
    if quantity > 1:
        return quantity
    return {"kg": 25, "l": 20, "g": 5000, "ml": 5000, "pcs": 120}.get(unit_code, 24)


def tidy(quantity, unit_code):
    """A believable amount: whole numbers for things counted, halves for weights."""
    if unit_code in ("kg", "l"):
        return max(0.5, round(quantity * 2) / 2)
    if unit_code in ("g", "ml"):
        return max(100, round(quantity / 100) * 100)
    return max(1, round(quantity))


# --------------------------------------------------------------------- add ---
def add(commit):
    admin = login(ADMIN_USER, ADMIN_PASSWORD)

    items = call("GET", "/items?page_size=2000", admin)["data"]
    by_id = {i["id"]: i for i in items if i["is_active"]}

    # The real catalogue: whatever is not one of the starter RM- sample items.
    # The refill lists say which of it actually gets bought, so build on those.
    wanted = []
    for entry in call("GET", "/standard-lists", admin)["data"]:
        if entry["purpose"] != "REFILL":
            continue
        for line in call("GET", f"/standard-lists/{entry['id']}", admin)["data"]["items"]:
            item = by_id.get(line["item_id"])
            if item and not item["sku"].startswith("RM-") and item["id"] not in [w[0]["id"] for w in wanted]:
                wanted.append((item, usual(float(line["quantity"]), item["unit_code"])))
    if len(wanted) < 10:
        wanted = [(i, usual(1, i["unit_code"])) for i in by_id.values() if not i["sku"].startswith("RM-")][:60]
    wanted = wanted[:70]

    kitchens = [k for k in call("GET", "/kitchens", admin)["data"] if k["is_active"]]
    suppliers = call("GET", "/suppliers", admin)["data"]

    already = [
        r for r in call("GET", "/main-inventory/receipts?page_size=500", admin)["data"]
        if (r.get("notes") or "").startswith(TAG)
    ]
    if already and commit:
        sys.exit("Demo activity is already there. Run `remove --commit` first, or leave it as it is.")

    print(f"Catalogue left untouched. Demo activity will use {len(wanted)} of your real items")
    print(f"and {len(kitchens)} kitchens:")
    print("  - 3 goods receipts into the main store, 2 deliveries to each kitchen")
    print("  - 5 days of 'used today' entries and 2 waste records per kitchen")
    print("  - 3 stock requests per kitchen (one waiting, one approved, one declined)")
    print("  - 1 stock count correction, and 5 past bills")
    if not commit:
        print("\nDry run - nothing was written. Add --commit to create it.")
        return

    print()
    # 1. stock arrives in the main store
    slices = [wanted[:45], wanted[25:70], wanted[::2]]
    for n, (age, scale) in enumerate([(28, 3.0), (21, 3.0), (14, 3.0)], start=1):
        lines = [
            {"item_id": item["id"], "quantity": tidy(qty * scale * rng.uniform(0.8, 1.2), item["unit_code"]),
             "unit_id": item["unit_id"]}
            for item, qty in slices[n - 1]
        ]
        supplier = rng.choice(suppliers)["id"] if suppliers else None
        step(f"goods receipt {n} ({len(lines)} items)", lambda lines=lines, age=age, supplier=supplier, n=n: call(
            "POST", "/main-inventory/receipts", admin,
            {"supplier_id": supplier, "invoice_no": f"DEMO-{2600 + n}", "received_at": days_ago(age),
             "notes": f"{TAG} stock delivery {n}", "items": lines}))

    # 2. deliveries to each kitchen
    for kitchen in kitchens:
        for age in (20, 11):
            chosen = rng.sample(wanted, k=min(28, len(wanted)))
            lines = [
                {"item_id": item["id"], "quantity": tidy(qty * rng.uniform(0.3, 0.5), item["unit_code"]),
                 "unit_id": item["unit_id"]}
                for item, qty in chosen
            ]
            step(f"delivery to {kitchen['name']} ({age} days ago)", lambda lines=lines, age=age, kitchen=kitchen: call(
                "POST", "/transfers", admin,
                {"from_location_type": "MAIN", "to_location_type": "KITCHEN", "to_kitchen_id": kitchen["id"],
                 "transfer_date": days_ago(age), "notes": f"{TAG} regular delivery", "items": lines}))

    # 3. what the kitchens used, waste, and requests - done as each kitchen's manager
    for kitchen in kitchens:
        username = MANAGERS.get(kitchen["code"])
        if not username:
            print(f"  skip  {kitchen['name']}: no known manager login for {kitchen['code']}")
            continue
        try:
            manager = login(username, MANAGER_PASSWORD)
        except ApiError as error:
            print(f"  skip  {kitchen['name']}: cannot sign in as {username} ({error})")
            continue

        shelf = [
            r for r in call("GET", f"/kitchens/{kitchen['id']}/inventory?page_size=2000&hide_zero=true", manager)["data"]
            if not r["sku"].startswith("RM-") and r["quantity"] > 0
        ]
        if not shelf:
            print(f"  skip  {kitchen['name']}: nothing on the shelf to use")
            continue

        for age in (5, 4, 3, 2, 1):
            picks = rng.sample(shelf, k=min(rng.randint(6, 12), len(shelf)))
            lines = [
                {"item_id": r["item_id"],
                 "quantity": min(tidy(r["quantity"] * rng.uniform(0.05, 0.12), r["unit_code"]), r["quantity"])}
                for r in picks
            ]
            lines = [ln for ln in lines if ln["quantity"] > 0]
            step(f"{kitchen['name']}: used {len(lines)} items, {age} day(s) ago", lambda lines=lines, age=age, kitchen=kitchen, manager=manager: call(
                "POST", "/usage", manager,
                {"kitchen_id": kitchen["id"], "used_at": days_ago(age, hour=21), "notes": f"{TAG} end of day", "items": lines}))

        for age, reason in ((6, "SPOILED"), (2, "DAMAGED")):
            r = rng.choice(shelf)
            step(f"{kitchen['name']}: waste of {r['item_name']}", lambda r=r, reason=reason, age=age, kitchen=kitchen, manager=manager: call(
                "POST", "/wastage", manager,
                {"location_type": "KITCHEN", "kitchen_id": kitchen["id"], "item_id": r["item_id"],
                 "quantity": min(tidy(r["quantity"] * 0.04, r["unit_code"]), r["quantity"]), "unit_id": r["unit_id"],
                 "reason_code": reason, "reason": f"{TAG} {reason.lower()} during the week",
                 "recorded_at": days_ago(age, hour=15)}))

        made = []
        for tag in ("waiting", "to approve", "to decline"):
            picks = rng.sample(wanted, k=min(rng.randint(4, 8), len(wanted)))
            lines = [{"item_id": i["id"], "quantity": tidy(q * rng.uniform(0.2, 0.4), i["unit_code"]),
                      "unit_id": i["unit_id"]} for i, q in picks]
            result = step(f"{kitchen['name']}: stock request ({tag})", lambda lines=lines, kitchen=kitchen, manager=manager: call(
                "POST", "/requests", manager,
                {"kitchen_id": kitchen["id"], "notes": f"{TAG} running low before the weekend", "items": lines}))
            if result:
                made.append(result["data"]["id"])
        # the first stays pending; the second is approved, the third declined
        if len(made) == 3:
            step(f"approve request {made[1]}", lambda: call("POST", f"/requests/{made[1]}/approve", admin, {"decision_note": f"{TAG} approved"}))
            step(f"decline request {made[2]}", lambda: call("POST", f"/requests/{made[2]}/decline", admin, {"decision_note": f"{TAG} not needed this week"}))

    # 4. one stock count correction
    if kitchens:
        k = kitchens[0]
        shelf = [r for r in call("GET", f"/kitchens/{k['id']}/inventory?page_size=2000&hide_zero=true", admin)["data"]
                 if not r["sku"].startswith("RM-") and r["quantity"] > 1]
        if shelf:
            r = rng.choice(shelf)
            step(f"stock count correction for {r['item_name']}", lambda: call(
                "POST", "/adjustments", admin,
                {"location_type": "KITCHEN", "kitchen_id": k["id"], "item_id": r["item_id"],
                 "new_quantity": round(r["quantity"] * 0.95, 2), "reason_code": "STOCK_COUNT",
                 "reason": f"{TAG} monthly physical count", "adjusted_at": days_ago(3)}))

    # 5. past bills (kept for audit only)
    bills = [
        ("Sunrise Wholesale Traders", "SW-4471", 75, [("Maida", 100, "kg", 36), ("Sugar", 50, "kg", 44), ("Refined Oil", 30, "l", 118)]),
        ("City Dairy Supplies", "CD-2290", 62, [("Butter", 20, "kg", 540), ("Fresh Cream", 25, "l", 185), ("Cheese Slices", 200, "pcs", 8)]),
        ("Kumar Packaging", "KP-118", 48, [("Cake Box 9x9x6", 300, "pcs", 11), ("Pastry Box (4)", 400, "pcs", 9), ("Dip Container", 500, "pcs", 2.5)]),
        ("Green Valley Vegetables", "GV-8821", 33, [("Onion", 80, "kg", 28), ("Tomato", 60, "kg", 35), ("Capsicum", 25, "kg", 70), ("Garlic", 15, "kg", 190)]),
        ("Metro Cash & Carry", "MC-55012", 19, [("Chocolate Compound", 30, "kg", 205), ("Baking Powder", 10, "kg", 46), ("Yeast", 5, "kg", 130), ("Honey", 12, "kg", 310)]),
    ]
    for supplier, number, age, lines in bills:
        date = (datetime.now(UTC) - timedelta(days=age)).date().isoformat()
        step(f"past bill {number} from {supplier}", lambda supplier=supplier, number=number, date=date, lines=lines: call(
            "POST", "/past-bills", admin,
            {"supplier_name": supplier, "invoice_no": number, "bill_date": date, "notes": f"{TAG} older bill kept for audit",
             "items": [{"item_name": n, "quantity": q, "unit": u, "unit_price": p} for n, q, u, p in lines]}))

    print("\nDone. Every record's note starts with DEMO: - `remove --commit` takes it all back out.")


# ------------------------------------------------------------------ remove ---
def remove(commit, keep_notifications):
    from sqlalchemy import delete, select

    from app import models as m
    from app.database import SessionLocal

    db = SessionLocal()
    like = TAG + "%"

    def ids(model, column):
        return list(db.execute(select(model.id).where(column.like(like))).scalars())

    receipts = ids(m.StockReceipt, m.StockReceipt.notes)
    usage = ids(m.UsageRecord, m.UsageRecord.notes)
    wastage = ids(m.WastageRecord, m.WastageRecord.reason)
    adjustments = ids(m.InventoryAdjustment, m.InventoryAdjustment.reason)
    bills = ids(m.PastBill, m.PastBill.notes)
    requests = ids(m.StockRequest, m.StockRequest.notes)
    transfers = set(ids(m.InventoryTransfer, m.InventoryTransfer.notes))
    # An approved request makes its own delivery, which carries no tag of its own.
    transfers |= set(
        db.execute(
            select(m.StockRequest.transfer_id).where(
                m.StockRequest.id.in_(requests), m.StockRequest.transfer_id.is_not(None)
            )
        ).scalars()
    )

    refs = {"RECEIPT": receipts, "TRANSFER": list(transfers), "USAGE": usage, "WASTAGE": wastage, "ADJUSTMENT": adjustments}
    movements = []
    for ref_type, ref_ids in refs.items():
        if ref_ids:
            movements += list(
                db.execute(
                    select(m.StockMovement).where(
                        m.StockMovement.reference_type == ref_type, m.StockMovement.reference_id.in_(ref_ids)
                    )
                ).scalars()
            )

    # What each shelf must change by to undo the demo movements.
    undo = {}
    for mv in movements:
        key = (mv.location_type, mv.kitchen_id, mv.item_id)
        undo[key] = undo.get(key, 0) + (-mv.quantity if mv.direction == "IN" else mv.quantity)

    rows, problems = {}, []
    for (location, kitchen_id, item_id), delta in undo.items():
        if location == "MAIN":
            row = db.execute(select(m.MainInventory).where(m.MainInventory.item_id == item_id)).scalar_one_or_none()
        else:
            row = db.execute(
                select(m.KitchenInventory).where(
                    m.KitchenInventory.kitchen_id == kitchen_id, m.KitchenInventory.item_id == item_id
                )
            ).scalar_one_or_none()
        if row is None or row.quantity + delta < 0:
            name = db.get(m.Item, item_id).name
            problems.append(f"{name} ({'main store' if location == 'MAIN' else f'kitchen {kitchen_id}'})")
        else:
            rows[(location, kitchen_id, item_id)] = (row, delta)

    from sqlalchemy import func

    stamps = []
    for model, column, id_list in (
        (m.StockReceipt, m.StockReceipt.created_at, receipts),
        (m.UsageRecord, m.UsageRecord.created_at, usage),
        (m.StockRequest, m.StockRequest.requested_at, requests),
    ):
        if id_list:
            stamps.append(db.execute(select(func.min(column)).where(model.id.in_(id_list))).scalar_one())
    first = min(stamps) if stamps else None

    notifications = 0
    if not keep_notifications and first is not None:
        notifications = len(
            list(
                db.execute(
                    select(m.Notification.id).where(
                        m.Notification.created_at >= first,
                        m.Notification.kind.in_(["LOW_STOCK", "STOCK_RECEIVED", "REQUEST_NEW", "REQUEST_DECIDED"]),
                    )
                ).scalars()
            )
        )

    print("Demo records found:")
    print(f"  goods receipts {len(receipts)}, deliveries {len(transfers)}, usage entries {len(usage)}, "
          f"waste {len(wastage)}, corrections {len(adjustments)}, requests {len(requests)}, past bills {len(bills)}")
    print(f"  stock movements to undo {len(movements)} across {len(undo)} shelves; notifications to clear {notifications}")

    if problems:
        print("\nCannot remove cleanly - real stock has moved since, and putting the demo stock back")
        print("would take these below zero:")
        for p in problems[:15]:
            print("  -", p)
        sys.exit(1)

    if not commit:
        print("\nDry run - nothing was changed. Add --commit to remove it.")
        return

    for row, delta in rows.values():
        row.quantity = row.quantity + delta
    for mv in movements:
        db.delete(mv)
    db.flush()
    for model, id_list in (
        (m.StockRequest, requests),
        (m.InventoryTransfer, list(transfers)),
        (m.StockReceipt, receipts),
        (m.UsageRecord, usage),
        (m.WastageRecord, wastage),
        (m.InventoryAdjustment, adjustments),
        (m.PastBill, bills),
    ):
        for obj in db.execute(select(model).where(model.id.in_(id_list))).scalars() if id_list else []:
            db.delete(obj)
    if notifications:
        db.execute(
            delete(m.Notification).where(
                m.Notification.created_at >= first,
                m.Notification.kind.in_(["LOW_STOCK", "STOCK_RECEIVED", "REQUEST_NEW", "REQUEST_DECIDED"]),
            )
        )
    db.commit()
    print("\nRemoved. Items, standard lists and prices were not touched.")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    a = sub.add_parser("add", help="create demo activity")
    a.add_argument("--commit", action="store_true")
    r = sub.add_parser("remove", help="remove the demo activity again")
    r.add_argument("--commit", action="store_true")
    r.add_argument("--keep-notifications", action="store_true", help="leave notifications alone")
    args = parser.parse_args()

    if args.command == "add":
        add(args.commit)
    else:
        remove(args.commit, args.keep_notifications)


if __name__ == "__main__":
    main()
