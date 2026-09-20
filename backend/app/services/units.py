from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..errors import bad_request
from ..models import Item, Unit
from ..security import D, q


def get_unit(db: Session, unit_id: int) -> Unit:
    unit = db.get(Unit, unit_id)
    if unit is None:
        raise bad_request(f"Unit {unit_id} does not exist")
    return unit


def convert(db: Session, quantity, from_unit_id: int, to_unit_id: int) -> Decimal:
    """Convert a quantity between two units of the same dimension."""
    if int(from_unit_id) == int(to_unit_id):
        return q(quantity)

    source = get_unit(db, from_unit_id)
    target = get_unit(db, to_unit_id)

    if source.dimension != target.dimension:
        raise bad_request(
            f"Cannot convert {source.code} ({source.dimension.lower()}) to "
            f"{target.code} ({target.dimension.lower()})"
        )

    return q(D(quantity) * D(source.factor) / D(target.factor))


def to_item_unit(db: Session, quantity, entered_unit_id: int | None, item: Item) -> tuple[Decimal, int]:
    """
    Convert an entered quantity into the item's stocking unit.
    Returns (base_quantity, entered_unit_id) for display on documents.
    """
    unit_id = int(entered_unit_id) if entered_unit_id else item.unit_id
    base = convert(db, quantity, unit_id, item.unit_id)
    if base <= 0:
        raise bad_request(f"Quantity for {item.name} must be greater than zero")
    return base, unit_id


def units_for_dimension(db: Session, unit_id: int) -> list[Unit]:
    """Every unit a quantity in this unit's dimension can be entered in."""
    base = get_unit(db, unit_id)
    return list(
        db.execute(select(Unit).where(Unit.dimension == base.dimension).order_by(Unit.factor))
        .scalars()
        .all()
    )
