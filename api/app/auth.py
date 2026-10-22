"""Who is calling, and for which workspace. The workspace always comes from here, never from a
request body.

  ingest_workspace  SDK -> API: `Authorization: Bearer at_live_...`, looked up by sha256.
  read_workspace    browser -> API: Clerk JWT in Phase 7. Until then, a dev-only shortcut.
"""

import hashlib

from fastapi import Header, HTTPException

from app import db
from app.config import get_settings

KEY_PREFIX = "at_live_"


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


async def ingest_workspace(authorization: str | None = Header(default=None)) -> str:
    scheme, _, key = (authorization or "").partition(" ")
    key = key.strip()
    if scheme.lower() != "bearer" or not key.startswith(KEY_PREFIX):
        raise HTTPException(status_code=401, detail="Missing or malformed ingest key")
    workspace = await db.workspace_for_key_hash(hash_key(key))
    if workspace is None:
        raise HTTPException(status_code=401, detail="Invalid ingest key")
    return workspace


async def read_workspace() -> str:
    """Phase 4 stand-in for Clerk: DEV_WORKSPACE_ID, honoured only when ENV=dev."""
    settings = get_settings()
    if settings.env == "dev" and settings.dev_workspace_id:
        return settings.dev_workspace_id
    raise HTTPException(status_code=401, detail="Sign-in is required (Clerk arrives in Phase 7)")
