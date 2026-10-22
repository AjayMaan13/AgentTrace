"""Who is calling, and for which workspace. The workspace always comes from here, never from a
request body.

  ingest_workspace  SDK -> API: `Authorization: Bearer at_live_...`, looked up by sha256.
  get_principal     browser -> API: a Clerk session JWT, verified against Clerk's JWKS.
  read_workspace    the caller's workspace = their ACTIVE Clerk organization id.
"""

import asyncio
import hashlib
from dataclasses import dataclass
from typing import Any

import jwt
from fastapi import Depends, Header, HTTPException
from jwt import PyJWKClient

from app import db
from app.config import get_settings

KEY_PREFIX = "at_live_"


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(status_code=401, detail=detail, headers={"WWW-Authenticate": "Bearer"})


def _bearer(authorization: str | None) -> str:
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise _unauthorized("Missing bearer token")
    return token.strip()


# --- SDK ingest ------------------------------------------------------------------------------

async def ingest_workspace(authorization: str | None = Header(default=None)) -> str:
    key = _bearer(authorization)
    if not key.startswith(KEY_PREFIX):
        raise _unauthorized("Malformed ingest key")
    workspace = await db.workspace_for_key_hash(hash_key(key))
    if workspace is None:
        raise _unauthorized("Invalid ingest key")
    return workspace


# --- Clerk -----------------------------------------------------------------------------------

@dataclass(frozen=True)
class Principal:
    user_id: str
    org_id: str  # the workspace
    org_role: str  # "admin" | "member" (Clerk's "org:" prefix removed)

    @property
    def is_admin(self) -> bool:
        return self.org_role == "admin"


_jwks_client: PyJWKClient | None = None


def _signing_key(token: str) -> Any:
    """The public key for this token's `kid`. PyJWKClient caches Clerk's key set and re-fetches
    it once when it sees an unknown kid (key rotation). Sync, so callers run it in a thread."""
    global _jwks_client
    url = get_settings().clerk_jwks_url
    if _jwks_client is None or _jwks_client.uri != url:
        _jwks_client = PyJWKClient(url)
    return _jwks_client.get_signing_key_from_jwt(token).key


def _active_org(claims: dict[str, Any]) -> tuple[str | None, str]:
    """The active organization and the caller's role in it.

    Clerk has two session-token layouts: v1 puts `org_id` / `org_role` ("org:admin") at the top
    level; v2 nests them as `o: {id, rol}` ("admin"). Accept both; scripts/decode_token.py
    shows which one a real token uses."""
    if isinstance(claims.get("o"), dict):
        org_id, role = claims["o"].get("id"), claims["o"].get("rol", "")
    else:
        org_id, role = claims.get("org_id"), claims.get("org_role", "")
    return org_id, str(role).removeprefix("org:") or "member"


async def get_principal(authorization: str | None = Header(default=None)) -> Principal:
    token = _bearer(authorization)
    settings = get_settings()
    if not (settings.clerk_issuer and settings.clerk_jwks_url):
        raise HTTPException(status_code=503, detail="Sign-in is not configured on this server")
    try:
        key = await asyncio.to_thread(_signing_key, token)
        claims = jwt.decode(
            token, key, algorithms=["RS256"], issuer=settings.clerk_issuer, leeway=10,
            options={"require": ["exp", "iss", "sub"], "verify_aud": False},
        )
    except jwt.PyJWKClientConnectionError:
        raise HTTPException(status_code=503, detail="Could not reach the sign-in key server") from None
    except jwt.PyJWTError:
        raise _unauthorized("Invalid or expired token") from None

    # `azp` (authorized party) is the origin that requested the token; only our web app may.
    azp = claims.get("azp")
    if azp and azp.rstrip("/") not in settings.web_origins:
        raise _unauthorized("Token was issued to a different origin")

    org_id, role = _active_org(claims)
    if not org_id:
        raise HTTPException(status_code=403, detail="Select or create an organization to continue")
    return Principal(user_id=claims["sub"], org_id=org_id, org_role=role)


async def read_workspace(principal: Principal = Depends(get_principal)) -> str:
    return principal.org_id
