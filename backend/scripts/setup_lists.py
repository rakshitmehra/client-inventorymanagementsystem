"""
Add the suppliers from the handwritten sheet, and build the three standard
lists the business actually buys on.

Run with --dry-run (the default) to see the plan; pass --commit to write. Safe
to run twice: suppliers are matched by name and lists by name, so a second run
reports what is already there rather than creating duplicates.

    python scripts/setup_lists.py            # show the plan
    python scripts/setup_lists.py --commit   # do it

The three lists are filled from the item catalogue by category, because that
is the only honest way to decide what belongs on which run:

    Everyday  - things that spoil: dairy, vegetables, fruit
    Weekly    - the grocery order: flour, spices, sauces, oils, pasta, nuts
    Monthly   - not food at all: packaging, and the things bought by the case

Quantities are deliberately left at 1. Nobody has told us how much of anything
this business goes through, and a made-up number on a list somebody runs with
one click is worse than an obvious placeholder they have to fill in.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.data.suppliers import SUPPLIERS  # noqa: E402

API = os.environ.get("KITCHENSTOCK_API", "http://127.0.0.1:8000/api")
USERNAME = os.environ.get("KITCHENSTOCK_USER", "admin")
PASSWORD = os.environ.get("KITCHENSTOCK_PASSWORD", "Admin@123")

#: Which categories belong to which shopping run.
LIST_PLAN = {
    "EVERYDAY": {
        "name": "Everyday Refill",
        "notes": "Milk, cream, vegetables and anything else that will not keep.",
        "categories": ["Dairy", "Vegetables", "Fruits", "Eggs & Proteins"],
    },
    "WEEKLY": {
        "name": "Weekly Grocery Order",
        "notes": "The grocery run: flour, spices, sauces, oils and dry goods.",
        "categories": [
            "Flours & Grains",
            "Spices & Masalas",
            "Sauces & Condiments",
            "Oils & Fats",
            "Pasta & Noodles",
            "Chocolate & Nuts",
            "Sweeteners",
            "Baking Essentials",
            "Bakery Supplies",
            "Canned & Preserved",
            "Frozen & Ready Foods",
        ],
    },
    "MONTHLY": {
        "name": "Monthly Packaging Order",
        "notes": "Cake boxes, containers, plates and bags. Ordered by the carton.",
        "categories": ["Packaging", "Beverages"],
    },
}


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
        raise RuntimeError(f"{method} {path} -> {error.code}: {error.read().decode()[:300]}") from None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--commit", action="store_true", help="actually write")
    args = parser.parse_args()
    commit = args.commit

    print("=" * 76)
    print("SUPPLIERS AND STANDARD LISTS  -  " + ("COMMITTING" if commit else "DRY RUN"))
    print("=" * 76)

    token = call("POST", "/auth/login", body={"username": USERNAME, "password": PASSWORD})["token"]

    # ------------------------------------------------------------ suppliers
    have = {s["name"].strip().lower() for s in call("GET", "/suppliers?include_inactive=true", token)["data"]}
    added, already = [], []
    for name, supplies, note in SUPPLIERS:
        if name.strip().lower() in have:
            already.append(name)
            continue
        added.append(name)
        if commit:
            call("POST", "/suppliers", token, {
                "name": name,
                "notes": f"Supplies: {supplies}." + (f" ({note})" if note else ""),
            })

    print(f"\nSUPPLIERS: {len(added)} added, {len(already)} already there")
    for name in added:
        print(f"   + {name}")
    if already:
        print("   already there: " + ", ".join(already))

    # ---------------------------------------------------------------- lists
    items = call("GET", f"/items?page_size=500", token)["data"]
    by_category = {}
    for item in items:
        if not item.get("is_active"):
            continue
        by_category.setdefault(item.get("category_name") or "(none)", []).append(item)

    existing_lists = {l["name"].strip().lower() for l in call("GET", "/standard-lists?include_inactive=true", token)["data"]}

    print("\nSTANDARD LISTS")
    for frequency, plan in LIST_PLAN.items():
        chosen = []
        for category in plan["categories"]:
            chosen.extend(by_category.get(category, []))

        if plan["name"].strip().lower() in existing_lists:
            print(f"   {plan['name']:<28} already exists, left alone")
            continue
        if not chosen:
            print(f"   {plan['name']:<28} no items in those categories, skipped")
            continue

        print(f"   {plan['name']:<28} {len(chosen):>3} items  ({frequency.lower()})")
        for category in plan["categories"]:
            count = len(by_category.get(category, []))
            if count:
                print(f"        {category:<24} {count}")

        if commit:
            call("POST", "/standard-lists", token, {
                "name": plan["name"],
                "purpose": "REFILL",
                "frequency": frequency,
                "notes": plan["notes"],
                "items": [
                    {"item_id": i["id"], "quantity": 1, "unit_id": i["unit_id"]}
                    for i in chosen
                ],
            })

    print("\n" + "-" * 76)
    if not commit:
        print("DRY RUN - nothing was written. Re-run with --commit to apply.")
    else:
        print("Done. Open Stock > Standard Lists and set the quantities you actually order.")


if __name__ == "__main__":
    main()
