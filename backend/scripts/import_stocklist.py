"""
Load the transcribed stock sheets into the catalogue.

Run with --dry-run (the default) to see exactly what would happen; pass
--commit to write. The script is safe to run twice: it matches on SKU and on
normalised name, so a second run reports "already there" rather than creating
a second Maida.

    python scripts/import_stocklist.py            # show the plan
    python scripts/import_stocklist.py --commit   # do it

Items go in through the API, not straight into the database, so the same
validation, numbering and audit trail apply as when somebody adds an item by
hand. Units are the exception - there is no endpoint for them, by design, so
they are inserted directly from the seed's own list.
"""

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.data import stocklist  # noqa: E402

API = os.environ.get("KITCHENSTOCK_API", "http://127.0.0.1:8000/api")
USERNAME = os.environ.get("KITCHENSTOCK_USER", "admin")
PASSWORD = os.environ.get("KITCHENSTOCK_PASSWORD", "Admin@123")


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
        detail = error.read().decode(errors="replace")
        raise RuntimeError(f"{method} {path} -> {error.code}: {detail[:400]}") from None


def normalise(name):
    """
    Reduce a name to something two spellings of the same thing share: case and
    punctuation go, everything else stays.

    What is inside the brackets stays too. It is the difference between
    "Pastry Box (2)" and "Pastry Box (4)", and dropping it collapsed three
    different boxes into one. Where brackets hold a translation rather than a
    size - "Suji (Semolina)" - the synonym table below handles it, because
    that is a judgement about the shelf, not about the spelling.
    """
    return re.sub(r"[^a-z0-9]+", " ", name.lower()).strip()


# Different words, same thing on the shelf. Listed explicitly rather than
# guessed at by fuzzy matching, so every merge here is a decision somebody
# can read and disagree with.
SYNONYMS = {
    "atta wheat flour": "wheat flour",
    "suji semolina": "semolina",
    "chini sugar": "granulated sugar",
    "yeast": "active dry yeast",
    "salt": "refined salt",
}

# Same commodity, but the existing entry is more specific and a kitchen may
# genuinely stock both. Imported separately and reported, not merged.
NEAR_DUPLICATES = {
    "butter": "Unsalted Butter",
    "cream": "Fresh Cream",
    "milk": "Full Cream Milk",
    "choco chips": "Dark Chocolate Chips",
}


def rows_from_sheets():
    """Flatten the five sheets into one list of (sku, name, category, unit, cost, perishable, note, source)."""
    out = []
    for sku, name, category, unit, cost, perishable, note in stocklist.COST_REPORT:
        out.append((sku, name, category, unit, cost, perishable, note, "cost report"))
    for sku, name, category, unit, note in stocklist.BAKERY:
        out.append((sku, name, category, unit, 0, False, note, "bakery sheet"))
    for sku, name in stocklist.VEGETABLES_LOCAL:
        out.append((sku, name, "Vegetables", "kg", 0, True, "local", "vegetable sheet"))
    for sku, name in stocklist.VEGETABLES_ENGLISH:
        out.append((sku, name, "Vegetables", "kg", 0, True, "english", "vegetable sheet"))
    for sku, name, category, unit, note in stocklist.PACKAGING:
        out.append((sku, name, category, unit, 0, False, note, "packaging sheet"))
    for sku, name, category, unit, note in stocklist.BEVERAGES:
        out.append((sku, name, category, unit, 0, False, note, "packaging sheet"))
    return out


def ensure_units(commit):
    """Add the packaging units from the seed list that the database is missing."""
    from app.database import session_scope
    from app.models import Unit
    from app.seed import UNITS

    added = []
    with session_scope() as db:
        have = {u.code for u in db.query(Unit).all()}
        for code, name, dimension, factor, is_base in UNITS:
            if code in have:
                continue
            added.append(code)
            if commit:
                db.add(
                    Unit(
                        code=code,
                        name=name,
                        dimension=dimension,
                        factor=factor,
                        is_base=is_base,
                    )
                )
        if not commit:
            db.rollback()
    return added


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--commit", action="store_true", help="actually write")
    args = parser.parse_args()
    commit = args.commit

    print("=" * 78)
    print("IMPORT STOCK SHEETS  -  " + ("COMMITTING" if commit else "DRY RUN (nothing is written)"))
    print("=" * 78)

    new_units = ensure_units(commit)
    print(f"\nUNITS: {len(new_units)} added -> {', '.join(new_units) if new_units else 'none needed'}")

    token = call("POST", "/auth/login", body={"username": USERNAME, "password": PASSWORD})["token"]

    units = {u["code"]: u["id"] for u in call("GET", "/units", token)["data"]}
    # On a dry run the new units were rolled back, so stand them in here -
    # otherwise the plan reports 44 spurious failures and hides the real ones.
    for code in new_units:
        units.setdefault(code, -1)
    categories = {c["name"]: c["id"] for c in call("GET", "/categories?include_inactive=true", token)["data"]}

    # ---------------------------------------------------------- categories
    made = []
    for name, description in stocklist.CATEGORIES:
        if name in categories:
            continue
        made.append(name)
        if commit:
            created = call("POST", "/categories", token, {"name": name, "description": description})
            categories[name] = created["data"]["id"]
        else:
            categories[name] = -1
    print(f"CATEGORIES: {len(made)} added -> {', '.join(made) if made else 'none needed'}")

    # --------------------------------------------------------------- items
    existing = call("GET", "/items?include_inactive=true&page_size=500", token)["data"]
    by_sku = {i["sku"].upper() for i in existing}
    by_name = {normalise(i["name"]): i["name"] for i in existing}

    created, skipped_dup, skipped_existing, near, failed = [], [], [], [], []

    for sku, name, category, unit, cost, perishable, note, source in rows_from_sheets():
        if note.startswith("DUPLICATE:"):
            skipped_dup.append((name, note.split(":", 1)[1]))
            continue

        key = normalise(name)
        key = SYNONYMS.get(key, key)

        if sku.upper() in by_sku:
            skipped_existing.append((sku, name, "SKU already in the catalogue"))
            continue
        if key in by_name:
            skipped_existing.append((sku, name, f"already stocked as '{by_name[key]}'"))
            continue

        if key in NEAR_DUPLICATES:
            near.append((name, NEAR_DUPLICATES[key]))

        if unit not in units:
            failed.append((sku, name, f"no such unit '{unit}'"))
            continue

        payload = {
            "sku": sku,
            "name": name,
            "category_id": categories.get(category),
            "unit_id": units[unit],
            "unit_cost": float(cost),
            "is_perishable": perishable,
            "description": f"From the {source}." + (f" {note}" if note else ""),
        }
        if commit:
            try:
                call("POST", "/items", token, payload)
            except RuntimeError as error:
                failed.append((sku, name, str(error)[:150]))
                continue
        created.append((sku, name, category, unit, cost))
        by_sku.add(sku.upper())
        by_name[key] = name

    # -------------------------------------------------------------- report
    print(f"\nITEMS TO CREATE: {len(created)}")
    for sku, name, category, unit, cost in created:
        price = f"Rs {cost}/{unit}" if cost else "no price on the sheet"
        print(f"   {sku:<14} {name:<34} {category:<22} {price}")

    if skipped_dup:
        print(f"\nSKIPPED - the same item appears on two sheets: {len(skipped_dup)}")
        for name, keep in skipped_dup:
            print(f"   {name:<34} kept as {keep}")

    if skipped_existing:
        print(f"\nSKIPPED - already in the catalogue: {len(skipped_existing)}")
        for sku, name, why in skipped_existing:
            print(f"   {name:<34} {why}")

    if near:
        print(f"\nWORTH A LOOK - similar to something you already stock: {len(near)}")
        for name, other in near:
            print(f"   imported '{name}' alongside the existing '{other}'")

    if failed:
        print(f"\nFAILED: {len(failed)}")
        for sku, name, why in failed:
            print(f"   {sku:<14} {name:<34} {why}")

    print("\n" + "-" * 78)
    print(f"created {len(created)}   skipped {len(skipped_dup) + len(skipped_existing)}   failed {len(failed)}")
    if not commit:
        print("DRY RUN - nothing was written. Re-run with --commit to apply.")


if __name__ == "__main__":
    main()
