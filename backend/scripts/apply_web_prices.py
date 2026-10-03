"""
Fill in prices for items that have none, from figures found online.

These are INDICATIVE prices, taken from supplier listings and retailers on the
dates noted below - a starting point so costs are not blank, not a quote. Each
is the price of ONE unit of the item (one kg, one piece, one bottle), which is
the figure every cost in the system is worked out from.

Only items whose price is currently 0 are touched. A price somebody has already
entered is never overwritten. Anything not listed here was not found with
enough confidence to put a number on, and is left blank on purpose - fill those
in on the Items > Set prices screen.

    python scripts/apply_web_prices.py            # show the plan
    python scripts/apply_web_prices.py --commit   # write the prices
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

API = os.environ.get("KITCHENSTOCK_API", "http://127.0.0.1:8000/api")
USERNAME = os.environ.get("KITCHENSTOCK_USER", "admin")
PASSWORD = os.environ.get("KITCHENSTOCK_PASSWORD", "Admin@123")

# sku -> (price for one unit, where it came from)
PRICES = {
    "BKY-DKC-001": (200, "Dark compound, IndiaMART supplier listing, Rs 200/kg"),
    "BKY-WHC-001": (370, "White compound, IndiaMART supplier listings, Rs 370-380/kg"),
    "BKY-CRC-001": (710, "Cream cheese (D'lecta), IndiaMART, Rs 710/kg"),
    "BKY-YST-001": (130, "Fresh yeast listing, Rs 130/kg - dry yeast costs more, check"),
    "BKY-BIM-001": (220, "Bread improver, IndiaMART, Rs 215-240/kg"),
    "BKY-OAT-001": (105, "Quick oats, supplier listing, Rs 105-110/kg"),
    "BKY-CRF-001": (100, "Corn flakes, supplier listing, Rs 100/kg"),
    "BKY-SNF-001": (100, "Fennel seed, supplier listing, Rs 100/kg"),
    "BKY-JEE-001": (198, "Cumin, APMC wholesale about Rs 198/kg - retail is higher"),
    "BKY-COC-001": (350, "Cocoa powder, wholesale range Rs 280-425/kg, middle taken"),
    "BKY-BKP-001": (45, "Baking powder, wholesale Rs 44-46/kg"),
    "BKY-SDB-001": (50, "Baking soda, wholesale range Rs 33-67/kg, middle taken"),
    "BKY-MSD-001": (50, "Baking soda, wholesale range Rs 33-67/kg, middle taken"),
    "BKY-CNP-001": (240, "Desiccated coconut powder, wholesale Rs 200-280/kg, middle taken"),
    "BKY-BUT-001": (570, "Amul butter 500 g is Rs 285 (from 22 Sep 2025), so Rs 570/kg"),
    "BKY-GHE-001": (670, "Amul ghee 1 l is Rs 610 (from 22 Sep 2025); about Rs 670/kg. Marvo may differ"),
    "BKY-KHJ-001": (500, "Dates (kimia), Rs 400-600/kg, middle taken"),
    "BEV-RDB-001": (95, "Red Bull 250 ml can, Rs 95"),
    "BEV-HEL-001": (60, "Hell Energy Classic 250 ml, Rs 60 incl. tax"),
    "BEV-DTC-001": (40, "Diet Coke 330 ml can, MRP Rs 40"),
    "BEV-MNW-001": (20, "Bisleri 1 l bottle, Rs 20"),
    "PKG-CKB-001": (10.5, "Plain duplex-board cake box, Rs 10.50 each - size varies"),
    "PKG-COB-001": (45, "White cardboard cookies box, Rs 45 each"),
}


def call(method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(API + path, data=data, method=method)
    if data:
        request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"{method} {path} -> {error.code}: {error.read().decode(errors='replace')[:300]}") from None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--commit", action="store_true", help="write the prices (default: show the plan)")
    args = parser.parse_args()

    token = call("POST", "/auth/login", body={"username": USERNAME, "password": PASSWORD})["token"]
    items = call("GET", "/items?page_size=500&include_inactive=true", token)["data"]
    by_sku = {item["sku"]: item for item in items}

    plan, skipped = [], []
    for sku, (price, source) in PRICES.items():
        item = by_sku.get(sku)
        if item is None:
            skipped.append((sku, "not in the catalogue"))
        elif float(item.get("unit_cost") or 0) > 0:
            skipped.append((sku, f"{item['name']} already has a price"))
        else:
            plan.append((item, price, source))

    for item, price, source in plan:
        print(f"  {item['name']:<34} Rs {price:>7} per {item['unit_code']:<4} {source}")
    for sku, why in skipped:
        print(f"  skipped {sku}: {why}")
    print(f"\n{len(plan)} price(s) to set, {len(skipped)} skipped.")

    if not args.commit:
        print("Dry run - pass --commit to write.")
        return
    if plan:
        result = call(
            "PUT",
            "/item-prices",
            token,
            {"prices": [{"item_id": item["id"], "unit_cost": price} for item, price, _ in plan]},
        )
        print(result["message"])


if __name__ == "__main__":
    sys.exit(main())
