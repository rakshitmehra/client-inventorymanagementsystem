from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import DocumentSequence

SEQUENCES: dict[str, tuple[str, int]] = {
    "TRANSFER": ("TRF", 5),
    "PRODUCTION": ("PRD", 5),
    "WASTAGE": ("WST", 5),
    "ADJUSTMENT": ("ADJ", 5),
    "RECEIPT": ("GRN", 5),
    "MOVEMENT": ("MOV", 6),
    "REQUEST": ("REQ", 5),
    "USAGE": ("USE", 5),
    "PASTBILL": ("PB", 5),
}


def next_number(db: Session, name: str) -> str:
    """
    Allocate the next document number (TRF-00001, PRD-00001, ...).

    The row is locked FOR UPDATE inside the caller's transaction, so two
    concurrent transfers cannot take the same number, and a rolled-back
    operation does not burn one.
    """
    prefix, padding = SEQUENCES[name]

    row = db.execute(
        select(DocumentSequence).where(DocumentSequence.name == name).with_for_update()
    ).scalar_one_or_none()

    if row is None:
        row = DocumentSequence(name=name, prefix=prefix, next_value=1, padding=padding)
        db.add(row)
        db.flush()
        row = db.execute(
            select(DocumentSequence).where(DocumentSequence.name == name).with_for_update()
        ).scalar_one()

    value = row.next_value
    row.next_value = value + 1
    db.flush()

    return f"{row.prefix}-{str(value).zfill(row.padding)}"


def next_numbers(db: Session, name: str, count: int) -> list[str]:
    """
    Allocate ``count`` consecutive document numbers with one lock.

    A bulk save writes a ledger row per item; asking for a number one at a time
    would lock and update the sequence row once per item. This takes the whole
    block in a single step instead.
    """
    prefix, padding = SEQUENCES[name]

    row = db.execute(
        select(DocumentSequence).where(DocumentSequence.name == name).with_for_update()
    ).scalar_one_or_none()
    if row is None:
        row = DocumentSequence(name=name, prefix=prefix, next_value=1, padding=padding)
        db.add(row)
        db.flush()
        row = db.execute(
            select(DocumentSequence).where(DocumentSequence.name == name).with_for_update()
        ).scalar_one()

    first = row.next_value
    row.next_value = first + count
    db.flush()
    return [f"{row.prefix}-{str(first + i).zfill(row.padding)}" for i in range(count)]
