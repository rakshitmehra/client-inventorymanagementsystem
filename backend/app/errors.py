from typing import Any

from fastapi import Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError


class AppError(Exception):
    """An error carrying an HTTP status and optional field-level details."""

    def __init__(
        self,
        status_code: int,
        message: str,
        details: Any = None,
        code: str | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message
        self.details = details
        self.code = code


def bad_request(message: str, details: Any = None) -> AppError:
    return AppError(status.HTTP_400_BAD_REQUEST, message, details, "BAD_REQUEST")


def unauthorized(message: str = "Authentication required") -> AppError:
    return AppError(status.HTTP_401_UNAUTHORIZED, message, None, "UNAUTHORIZED")


def forbidden(message: str = "You do not have access to this resource") -> AppError:
    return AppError(status.HTTP_403_FORBIDDEN, message, None, "FORBIDDEN")


def not_found(what: str = "Resource") -> AppError:
    return AppError(status.HTTP_404_NOT_FOUND, f"{what} not found", None, "NOT_FOUND")


def conflict(message: str, details: Any = None) -> AppError:
    return AppError(status.HTTP_409_CONFLICT, message, details, "CONFLICT")


class InsufficientStockError(AppError):
    """Raised when an operation would drive a balance below zero."""

    def __init__(self, shortages: list[dict[str, Any]]) -> None:
        if len(shortages) == 1:
            first = shortages[0]
            message = (
                f"Insufficient stock for {first['item_name']}: need {first['required']} "
                f"{first['unit_code']}, only {first['available']} {first['unit_code']} available"
            )
        else:
            message = f"Insufficient stock for {len(shortages)} items"
        super().__init__(
            status.HTTP_409_CONFLICT,
            message,
            {"shortages": shortages},
            "INSUFFICIENT_STOCK",
        )


def _payload(message: str, details: Any = None, code: str | None = None) -> dict[str, Any]:
    return {"error": {"message": message, "details": details, "code": code}}


async def app_error_handler(_request: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=_payload(exc.message, exc.details, exc.code),
    )


async def validation_error_handler(
    _request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Turn FastAPI's validation errors into the per-field shape the UI expects."""
    details: dict[str, str] = {}
    for error in exc.errors():
        location = [part for part in error["loc"] if part not in ("body", "query", "path")]
        field = ".".join(str(part) for part in location) or "body"
        details.setdefault(field, error["msg"].replace("Value error, ", ""))

    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST,
        content=_payload("Please correct the highlighted fields", details, "BAD_REQUEST"),
    )


async def integrity_error_handler(_request: Request, exc: IntegrityError) -> JSONResponse:
    """Translate the database's own guard rails into something readable."""
    raw = str(getattr(exc, "orig", exc))
    sqlstate = getattr(getattr(exc, "orig", None), "sqlstate", None)

    if sqlstate == "23505" or "duplicate key" in raw or "UNIQUE constraint" in raw:
        field = _guess_field(raw)
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content=_payload(f"That {field} is already in use", None, "DUPLICATE"),
        )

    if sqlstate == "23514" or "check constraint" in raw.lower():
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content=_payload(
                "That change would leave inventory in an invalid state and was rolled back",
                None,
                "CONSTRAINT",
            ),
        )

    if sqlstate == "23503" or "foreign key" in raw.lower():
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content=_payload(
                "This record is referenced by other data and cannot be changed or removed",
                None,
                "IN_USE",
            ),
        )

    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content=_payload("The database rejected that change", None, "CONSTRAINT"),
    )


def _guess_field(raw: str) -> str:
    """Pull a column name out of a unique-violation message for the UI."""
    for marker in ("Key (", "constraint failed: "):
        if marker in raw:
            fragment = raw.split(marker, 1)[1]
            fragment = fragment.split(")")[0].split("=")[0]
            return fragment.split(".")[-1].strip() or "value"
    return "value"
