"""Ingest keys: how an organization connects its agents. Admins only. A key is shown exactly once,
when it is made; only its sha256 and a short display prefix are stored."""

import secrets
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from app import db
from app.auth import KEY_PREFIX, Principal, get_principal, hash_key
from app.security import audit
from app.security.limits import key_limiter

router = APIRouter(prefix="/v1")


def _admin(principal: Principal) -> None:
    if not principal.is_admin:
        raise HTTPException(status_code=403, detail="Only organization admins can manage ingest keys")


@router.post("/keys", status_code=201)
async def mint_key(principal: Principal = Depends(get_principal)) -> dict[str, str]:
    """Make a key for the caller's organization. The key itself is in this response and nowhere else."""
    _admin(principal)
    key_limiter.check(principal.user_id)
    workspace = principal.org_id
    key = KEY_PREFIX + secrets.token_urlsafe(32)
    await db.upsert_workspace(workspace, workspace)
    await db.create_api_key(workspace, key[:12], hash_key(key), principal.user_id)
    await audit.record(workspace, principal.user_id, "key.create", key[:12])
    return {"key": key, "prefix": key[:12]}


@router.get("/keys")
async def list_keys(principal: Principal = Depends(get_principal)) -> list[dict[str, Any]]:
    _admin(principal)
    return await db.list_api_keys(principal.org_id)


@router.delete("/keys/{key_id}")
async def revoke_key(key_id: str, principal: Principal = Depends(get_principal)) -> dict[str, str]:
    _admin(principal)
    if not await db.revoke_api_key(principal.org_id, key_id):
        raise HTTPException(status_code=404, detail="Key not found or already revoked")
    await audit.record(principal.org_id, principal.user_id, "key.revoke", key_id)
    return {"id": key_id}
