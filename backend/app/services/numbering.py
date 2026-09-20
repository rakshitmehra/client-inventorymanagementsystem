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
