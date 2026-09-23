"""
Standard lists: the saved order, and the one click that runs it.

Who may do what follows the rest of the system. Administrators own the lists -
they decide what the monthly refill contains and what each kitchen normally
takes. A kitchen manager can see the lists for their own kitchens and run one,
which raises a request rather than moving stock, because helping yourself to
the main store is not something a manager can do by any other route either.
"""

from fastapi import APIRouter, Query, Request

from ..database import run_in_transaction
from ..deps import AdminUserDep, CurrentUserDep, DbSession
from ..errors import forbidden
from ..schemas import StandardListRun, StandardListSave
from ..services.audit import log_audit
from ..services.standard_lists import (
    _assert_visible,
    _load,
    create_list,
    delete_list,
    list_lists,
    run_list,
    serialise,
    update_list,
)

router = APIRouter(prefix="/standard-lists", tags=["standard lists"])


@router.get("")
def get_lists(
    db: DbSession,
    user: CurrentUserDep,
    include_inactive: bool = Query(False),
):
    rows = list_lists(db, user, include_inactive=include_inactive)
    return {"data": rows, "meta": {"total": len(rows)}}


@router.get("/{list_id}")
def get_list(list_id: int, db: DbSession, user: CurrentUserDep):
    record = _load(db, list_id)
    _assert_visible(user, record)
    # Pass the session so each line comes back with what the main store is
    # actually holding, which is what the screen warns on before a run.
    return {"data": serialise(record, db=db)}


@router.post("", status_code=201)
def add_list(
    payload: StandardListSave,
    db: DbSession,
    user: AdminUserDep,
    request: Request,
):
    result = run_in_transaction(db, lambda session: create_list(session, payload, user))

    log_audit(
        db,
        request=request,
        user=user,
        action="STANDARD_LIST_CREATED",
        entity_type="STANDARD_LIST",
        entity_id=result["data"]["id"],
        entity_label=result["data"]["name"],
        description=(
            f"Created the standard list '{result['data']['name']}' "
            f"with {result['data']['total_items']} item(s)"
        ),
    )
    db.commit()
    return result


@router.put("/{list_id}")
def edit_list(
    list_id: int,
    payload: StandardListSave,
    db: DbSession,
    user: AdminUserDep,
    request: Request,
):
    result = run_in_transaction(db, lambda session: update_list(session, list_id, payload, user))

    log_audit(
        db,
        request=request,
        user=user,
        action="STANDARD_LIST_UPDATED",
        entity_type="STANDARD_LIST",
        entity_id=list_id,
        entity_label=result["data"]["name"],
        description=(
            f"Updated the standard list '{result['data']['name']}' - "
            f"it now has {result['data']['total_items']} item(s)"
        ),
    )
    db.commit()
    return result


@router.delete("/{list_id}")
def remove_list(list_id: int, db: DbSession, user: AdminUserDep, request: Request):
    record = _load(db, list_id)
    name = record.name

    result = run_in_transaction(db, lambda session: delete_list(session, list_id, user))

    log_audit(
        db,
        request=request,
        user=user,
        action="STANDARD_LIST_DELETED",
        entity_type="STANDARD_LIST",
        entity_id=list_id,
        entity_label=name,
        description=f"Deleted the standard list '{name}'",
    )
    db.commit()
    return result


@router.post("/{list_id}/run")
def run(
    list_id: int,
    payload: StandardListRun,
    db: DbSession,
    user: CurrentUserDep,
    request: Request,
):
    """
    Run the list: one click, or one click after adjusting the quantities.

    What comes out is an ordinary receipt, transfer or request - the same
    records the manual screens produce, carrying the same numbers and the same
    printable note. The audit entry names the list, so the shortcut is visible
    afterwards rather than looking like somebody typed eighty lines by hand.
    """
    record = _load(db, list_id)
    _assert_visible(user, record)
    if record.purpose == "REFILL" and not user.is_admin:
        raise forbidden("Only an administrator can refill the main store")

    result = run_in_transaction(db, lambda session: run_list(session, list_id, payload, user))

    outcome = result.get("outcome")
    reference = (
        result.get("receipt_no")
        or result.get("transfer_no")
        or result.get("request_no")
        or ""
    )
    log_audit(
        db,
        request=request,
        user=user,
        action="STANDARD_LIST_RUN",
        entity_type="STANDARD_LIST",
        entity_id=list_id,
        entity_label=record.name,
        description=f"Ran the standard list '{record.name}', creating {outcome} {reference}".strip(),
    )
    db.commit()

    spoken = {
        "receipt": "The main store has been topped up",
        "transfer": f"Sent to {record.kitchen.name}" if record.kitchen else "Sent",
        "request": "Your request has gone to the main store",
    }.get(outcome, "Done")

    result["message"] = f"{spoken} - {reference}" if reference else spoken
    return result
