import logging
from contextlib import asynccontextmanager
from datetime import UTC, datetime

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from .config import settings
from .database import engine
from .errors import (
    AppError,
    app_error_handler,
    integrity_error_handler,
    validation_error_handler,
)
from .routers import (
    audit,
    auth,
    catalog,
    dashboard,
    documents,
    kitchens,
    main_inventory,
    movements,
    production,
    products,
    records,
    reports,
    requests as requests_router,
    standard_lists,
    transfers,
    users,
)
from .seed import ensure_seed

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("kitchenstock")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if settings.seed_on_startup:
        try:
            ensure_seed()
        except Exception:
            # Seeding is a convenience: it creates the schema on an empty
            # database. If it fails, the API can still serve every request
            # against a database that is already set up, so log it and carry
            # on rather than failing the whole process - which on serverless
            # turns one bad boot into a total outage with no readable reason.
            log.exception("Startup seeding failed - continuing without it")
    log.info("%s ready on port %s", settings.app_name, settings.port)
    log.info("Database: %s", settings.database_url.split("@")[-1])
    yield
    engine.dispose()


app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    description=(
        "Inventory management for a multi-kitchen business: one central Main "
        "Inventory, an independent sub-inventory per kitchen, recipe-driven "
        "production and a complete stock movement ledger."
    ),
    lifespan=lifespan,
    docs_url="/docs" if settings.debug else None,
    redoc_url="/redoc" if settings.debug else None,
    openapi_url="/openapi.json" if settings.debug else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_exception_handler(AppError, app_error_handler)
app.add_exception_handler(RequestValidationError, validation_error_handler)
app.add_exception_handler(IntegrityError, integrity_error_handler)


@app.get(f"{settings.api_prefix}/health", tags=["health"])
def health():
    """Liveness probe that also confirms the database is reachable."""
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        database = "up"
    except Exception as error:  # noqa: BLE001
        log.error("Health check failed: %s", error)
        database = "down"

    return {
        "status": "ok" if database == "up" else "degraded",
        "service": settings.app_name,
        "environment": settings.app_env,
        "database": database,
        "time": datetime.now(UTC).isoformat(),
    }


for router in (
    auth.router,
    users.router,
    kitchens.router,
    catalog.router,
    main_inventory.router,
    transfers.router,
    requests_router.router,
    standard_lists.router,
    products.router,
    production.router,
    records.router,
    movements.router,
    reports.router,
    dashboard.router,
    audit.router,
    documents.router,
):
    app.include_router(router, prefix=settings.api_prefix)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
    )
