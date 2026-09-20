import logging
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Any, TypeVar

from sqlalchemy import create_engine, event
from sqlalchemy.exc import DBAPIError, OperationalError
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import NullPool

from .config import settings

log = logging.getLogger(__name__)

T = TypeVar("T")

# Errors worth replaying rather than surfacing:
#   40001  serialization_failure - CockroachDB raises this constantly under
#          SERIALIZABLE; PostgreSQL raises it under REPEATABLE READ and above.
#   40P01  deadlock_detected - PostgreSQL broke a deadlock and chose us as the
#          victim. The work is sound, it simply needs running again.
RETRYABLE_SQLSTATES = {"40001", "40P01"}


def _engine_kwargs() -> dict[str, Any]:
    kwargs: dict[str, Any] = {"echo": settings.db_echo, "future": True}

    if settings.is_sqlite:
        # Local fallback used for tests; SQLite takes none of the pool options.
        kwargs["connect_args"] = {"check_same_thread": False}
        return kwargs

    connect_args: dict[str, Any] = {"application_name": "kitchenstock-api"}

    if settings.uses_transaction_pooler:
        # PgBouncer in transaction mode hands the connection to someone else
        # between transactions, so a prepared statement we created may not
        # exist next time, and pooling on our side would pool something that
        # is no longer ours. Let the pooler do the pooling.
        #
        # No statement_timeout here either: session settings do not survive in
        # this mode, and the pooler rejects unexpected startup parameters.
        connect_args["prepare_threshold"] = None
        kwargs.update(poolclass=NullPool, connect_args=connect_args)
        log.info(
            "Transaction pooler detected: prepared statements and client-side "
            "pooling disabled"
        )
        return kwargs

    if settings.db_statement_timeout_ms > 0:
        # Cap how long any one statement may run. On a hosted database a
        # connection is a scarce shared resource, and without this a single
        # runaway query holds one open until somebody notices.
        #
        # Passed as a libpq startup option rather than a SET on connect: the
        # server applies it before any transaction begins, so it cannot be
        # undone by a rollback the way a transactional SET can.
        connect_args["options"] = f"-c statement_timeout={settings.db_statement_timeout_ms}"

    kwargs.update(
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        pool_recycle=settings.db_pool_recycle,
        # A pooled connection can be closed under us by the provider; check it
        # is alive before handing it to a request.
        pool_pre_ping=True,
        connect_args=connect_args,
    )
    return kwargs


engine = create_engine(settings.database_url, **_engine_kwargs())

if settings.is_sqlite:

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_connection, _record):  # pragma: no cover - dev only
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    pass


def get_db() -> Iterator[Session]:
    """FastAPI dependency: one session per request, always closed."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _is_retryable(error: Exception) -> bool:
    """True for a conflict the database expects the client to replay."""
    if not isinstance(error, (DBAPIError, OperationalError)):
        return False
    sqlstate = getattr(getattr(error, "orig", None), "sqlstate", None)
    if sqlstate in RETRYABLE_SQLSTATES:
        return True
    text_form = str(error).lower()
    return any(code.lower() in text_form for code in RETRYABLE_SQLSTATES) or (
        "restart transaction" in text_form
    )


def run_in_transaction(db: Session, work: Callable[[Session], T]) -> T:
    """
    Run `work` inside a single transaction, retrying serialization failures
    and deadlocks with exponential backoff.

    Every stock-changing operation goes through here, so a conflicting write
    from another kitchen is retried rather than surfacing as an error, and a
    failure part-way through can never leave inventory and its ledger out of
    step.
    """
    last_error: Exception | None = None

    for attempt in range(settings.db_max_retries):
        try:
            # A router usually reads something before calling this, and those
            # reads make SQLAlchemy autobegin a transaction. Discard it so this
            # loop owns a clean boundary it can safely replay on a retry.
            if db.in_transaction():
                db.rollback()
            with db.begin():
                return work(db)
        except Exception as error:  # noqa: BLE001 - re-raised below
            db.rollback()
            if not _is_retryable(error):
                raise
            last_error = error
            backoff = min(0.05 * (2**attempt), 1.0)
            log.warning(
                "Retrying transaction after serialization failure (attempt %s/%s)",
                attempt + 1,
                settings.db_max_retries,
            )
            time.sleep(backoff)

    raise RuntimeError(
        f"Transaction failed after {settings.db_max_retries} retries"
    ) from last_error


@contextmanager
def session_scope() -> Iterator[Session]:
    """Standalone session for scripts (seeding, migrations)."""
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
