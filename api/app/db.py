"""SurrealDB connection. Phase 0 only needs connect + ping; helpers arrive in Phase 1."""

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from surrealdb import AsyncSurreal

from app.config import DB_CONNECT_TIMEOUT_S, Settings, get_settings

log = logging.getLogger(__name__)


def _signin_vars(s: Settings) -> dict[str, str]:
    """Credentials payload for the level the user was created at (SDK: signin docstring)."""
    creds = {"username": s.surreal_user, "password": s.surreal_pass}
    if s.surreal_auth_level == "namespace":
        creds["namespace"] = s.surreal_ns
    elif s.surreal_auth_level == "database":
        creds["namespace"] = s.surreal_ns
        creds["database"] = s.surreal_db
    return creds


@asynccontextmanager
async def connect(settings: Settings | None = None) -> AsyncIterator[AsyncSurreal]:
    """Open an authenticated connection scoped to SURREAL_NS / SURREAL_DB.

    The SDK appends /rpc to the url itself, so SURREAL_URL is the bare host.
    """
    s = settings or get_settings()
    async with AsyncSurreal(s.surreal_url) as db:
        if s.surreal_token:
            await db.authenticate(s.surreal_token)
        else:
            await db.signin(_signin_vars(s))
        await db.use(s.surreal_ns, s.surreal_db)
        yield db


async def ping(timeout: float = DB_CONNECT_TIMEOUT_S) -> bool:
    """True if we can connect, authenticate and run a query within `timeout` seconds.

    Never raises and never logs exception text (it could echo credentials or hosts).
    """
    s = get_settings()
    if not s.surreal_configured:
        return False

    async def _probe() -> bool:
        async with connect(s) as db:
            await db.query("RETURN 1;")
        return True

    try:
        return await asyncio.wait_for(_probe(), timeout=timeout)
    except Exception as exc:  # includes TimeoutError
        log.warning("surreal ping failed: %s", type(exc).__name__)
        return False
