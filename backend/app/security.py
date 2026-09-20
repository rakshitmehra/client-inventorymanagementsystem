from datetime import UTC, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

import bcrypt
import jwt

from .config import settings
from .errors import unauthorized

# ---------------------------------------------------------------------------
# passwords
# ---------------------------------------------------------------------------
# bcrypt truncates at 72 bytes; longer input is rejected rather than silently
# ignored so two different long passwords can never collide.
MAX_PASSWORD_BYTES = 72


def hash_password(password: str) -> str:
    raw = password.encode("utf-8")
    if len(raw) > MAX_PASSWORD_BYTES:
        raw = raw[:MAX_PASSWORD_BYTES]
    return bcrypt.hashpw(raw, bcrypt.gensalt(rounds=settings.bcrypt_rounds)).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    raw = password.encode("utf-8")[:MAX_PASSWORD_BYTES]
    try:
        return bcrypt.checkpw(raw, password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False


# ---------------------------------------------------------------------------
# tokens
# ---------------------------------------------------------------------------
def create_access_token(user_id: int, username: str, role_code: str) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "username": username,
        "role": role_code,
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_expire_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.ExpiredSignatureError as exc:
        raise unauthorized("Your session has expired, please sign in again") from exc
    except jwt.PyJWTError as exc:
        raise unauthorized("Invalid session") from exc


# ---------------------------------------------------------------------------
# decimal helpers
# ---------------------------------------------------------------------------
QTY_PLACES = Decimal("0.0001")
MONEY_PLACES = Decimal("0.01")
RATE_PLACES = Decimal("0.0001")


def D(value) -> Decimal:
    """Coerce to Decimal without going through binary floating point."""
    if isinstance(value, Decimal):
        return value
    if value is None:
        return Decimal("0")
    return Decimal(str(value))


def q(value) -> Decimal:
    """Quantise a stock quantity to four decimal places."""
    return D(value).quantize(QTY_PLACES, rounding=ROUND_HALF_UP)


def money(value) -> Decimal:
    """Quantise a monetary amount to two decimal places."""
    return D(value).quantize(MONEY_PLACES, rounding=ROUND_HALF_UP)


def rate(value) -> Decimal:
    """Quantise a unit cost to four decimal places."""
    return D(value).quantize(RATE_PLACES, rounding=ROUND_HALF_UP)
