import os
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Service configuration, read from the environment (see .env.example).

    The backend is a standalone microservice: it owns its database and talks to
    the frontend only over HTTP, so every dependency it needs is declared here.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # -- service ------------------------------------------------------------
    app_name: str = "KitchenStock API"
    app_env: str = "development"
    api_prefix: str = "/api"
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = True

    # -- database -----------------------------------------------------------
    # PostgreSQL over the psycopg 3 driver. Supabase gives three hostnames for
    # the same database and the choice matters:
    #
    #   Session pooler (use this for a long-running server such as the
    #   container on Cloudflare). IPv4, holds a connection for the life of the
    #   session, so SQLAlchemy's own pool behaves normally:
    #     postgresql+psycopg://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require
    #
    #   Transaction pooler (port 6543). For serverless, where every invocation
    #   is a new process. Hands the connection back after each transaction, so
    #   prepared statements and a client-side pool have to be turned off - this
    #   module detects port 6543 (or ?pgbouncer=true) and does that for you:
    #     postgresql+psycopg://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:6543/postgres?sslmode=require
    #
    #   Direct connection (db.<ref>.supabase.co:5432). IPv6 only, so it fails
    #   on hosts without IPv6 egress. Prefer a pooler unless you know you have
    #   IPv6 end to end.
    #
    # Local development without Supabase:
    #     postgresql+psycopg://postgres:postgres@localhost:5432/kitchenstock
    #
    # CockroachDB is still supported - pass a cockroachdb+psycopg:// URL.
    database_url: str = (
        "postgresql+psycopg://postgres:postgres@localhost:5432/kitchenstock"
    )
    db_echo: bool = False
    db_pool_size: int = 5
    db_max_overflow: int = 5
    db_pool_recycle: int = 1800
    # Retried here: serialization failures (40001) and deadlocks (40P01).
    db_max_retries: int = 5
    # Statement timeout applied to every connection, so one bad query cannot
    # hold a pooled Supabase connection open indefinitely. 0 disables it.
    db_statement_timeout_ms: int = 30000

    # -- auth ---------------------------------------------------------------
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 720
    bcrypt_rounds: int = 12

    # -- cors ---------------------------------------------------------------
    # Comma-separated list of frontend origins allowed to call this service.
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    # -- seeding ------------------------------------------------------------
    # Default off on serverless. Vercel sets VERCEL=1, and there "startup"
    # happens on every cold start, so seeding there means creating the schema
    # and counting rows over the network before the first request can be
    # answered - which is slow at best and a failed invocation at worst.
    # A long-running server still seeds on boot as before.
    seed_on_startup: bool = os.environ.get("VERCEL") != "1"
    seed_demo_data: bool = True

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def is_cockroach(self) -> bool:
        return self.database_url.startswith("cockroachdb")

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")

    @property
    def uses_transaction_pooler(self) -> bool:
        """
        True when the URL points at a transaction-mode pooler (PgBouncer).

        In that mode a connection is only ours for the length of one
        transaction, so neither prepared statements nor a client-side pool can
        be relied on. Supabase serves this on port 6543; other providers signal
        it with ?pgbouncer=true.
        """
        url = self.database_url
        return ":6543/" in url or "pgbouncer=true" in url


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
