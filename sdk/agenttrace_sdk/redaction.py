"""Redaction: replace secrets and PII in a COPY of a payload before it leaves the process.

Two layers, applied in `redact()`:
  1. Key-name denylist: a dict key like `authorization` or `x-api-key` redacts its whole value.
  2. Regexes over every string: API-key shapes, JWTs, bearer tokens, emails, card numbers
     (Luhn-checked) and phone numbers.

Each hit becomes `[REDACTED:<type>:<first 8 hex of sha256 of the original>]`, so two equal
secrets get the same marker and a diff still shows they matched.

Redaction is for the STORED copy only. The live state passed between nodes is never touched,
and the structure of a payload (keys, list shapes, non-secret values like a `status` filter)
is preserved so a recorded step can still be read and replayed.

Known limits (see tests): the patterns are heuristics. `123-456-7890` looks like a phone
number to the regex even when it is a part code, and a key-name hit redacts the whole value,
so a JSON-schema property literally named `token` would be replaced wholesale.
"""

import hashlib
import json
import re
from collections.abc import Callable
from typing import Any

# Matched against the normalised key: exact, or as a trailing `_<word>` ("access_token").
# Not a substring match, so `max_tokens` and `token_count` are NOT redacted.
KEY_DENYLIST = (
    "authorization",
    "api_key",
    "apikey",
    "password",
    "passwd",
    "token",
    "secret",
    "secret_key",
    "private_key",
    "cookie",
)

MARKER_PREFIX = "[REDACTED:"

_API_KEY = re.compile(
    r"\b(?:sk-ant-[A-Za-z0-9_-]{8,}"
    r"|sk-[A-Za-z0-9_-]{20,}"
    r"|at_live_[A-Za-z0-9]{8,}"
    r"|gh[pousr]_[A-Za-z0-9]{20,}"
    r"|AKIA[0-9A-Z]{16}"
    r"|(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,})"
)
_JWT = re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}")
# Requires a digit in the token so prose like "bearer authorization" is left alone.
_BEARER = re.compile(r"(?i)\bBearer\s+(?=[A-Za-z0-9._~+/=-]*\d)[A-Za-z0-9._~+/=-]{10,}")
_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")
_CARD = re.compile(r"(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)")
# Needs separators ("415-555-0123", "(415) 555-0123"), so bare 10-digit ids are not phones.
_PHONE = re.compile(
    r"(?<!\w)(?:\+?\d{1,3}[\s.-])?(?:\(\d{3}\)\s?|\d{3}[\s.-])\d{3}[\s.-]\d{4}(?!\d)"
)


def _luhn_ok(text: str) -> bool:
    digits = [int(c) for c in text if c.isdigit()]
    total = 0
    for i, d in enumerate(reversed(digits)):
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


# Order matters: specific shapes first, so a JWT is not later mistaken for a bearer token.
_PATTERNS: tuple[tuple[str, re.Pattern[str], Callable[[str], bool] | None], ...] = (
    ("api_key", _API_KEY, None),
    ("jwt", _JWT, None),
    ("bearer", _BEARER, None),
    ("email", _EMAIL, None),
    ("card", _CARD, _luhn_ok),
    ("phone", _PHONE, None),
)


def _hash8(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:8]


def _marker(kind: str, original: str) -> str:
    return f"{MARKER_PREFIX}{kind}:{_hash8(original)}]"


def _normalise_key(key: str) -> str:
    key = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", key)  # apiKey -> api_Key
    return re.sub(r"[^a-z0-9]+", "_", key.lower()).strip("_")


def is_secret_key(key: str) -> bool:
    norm = _normalise_key(key)
    return any(norm == w or norm.endswith("_" + w) for w in KEY_DENYLIST)


def _is_sensitive_value(value: Any) -> bool:
    if value is None or isinstance(value, bool) or value == "":
        return False
    return not (isinstance(value, str) and value.startswith(MARKER_PREFIX))


def _canonical(value: Any) -> str:
    return value if isinstance(value, str) else json.dumps(value, sort_keys=True, default=str)


def _record(found: list[dict[str, str]], path: str, kind: str, marker: str) -> None:
    found.append({"path": path, "type": kind, "hash": marker.rsplit(":", 1)[1][:-1]})


def _redact_string(text: str, path: str, found: list[dict[str, str]]) -> str:
    for kind, pattern, validator in _PATTERNS:

        def repl(m: re.Match[str], kind: str = kind, validator=validator) -> str:
            if validator is not None and not validator(m.group(0)):
                return m.group(0)
            marker = _marker(kind, m.group(0))
            _record(found, path, kind, marker)
            return marker

        text = pattern.sub(repl, text)
    return text


def _walk(value: Any, path: str, found: list[dict[str, str]]) -> Any:
    if isinstance(value, str):
        return _redact_string(value, path, found)
    if isinstance(value, dict):
        out: dict[Any, Any] = {}
        for key, item in value.items():
            child = f"{path}.{key}" if path else str(key)
            if isinstance(key, str) and is_secret_key(key) and _is_sensitive_value(item):
                marker = _marker("secret", _canonical(item))
                _record(found, child, "secret", marker)
                out[key] = marker
            else:
                out[key] = _walk(item, child, found)
        return out
    if isinstance(value, (list, tuple)):
        return [_walk(item, f"{path}[{i}]", found) for i, item in enumerate(value)]
    return value


def redact(obj: Any) -> tuple[Any, list[dict[str, str]]]:
    """Return (redacted copy of obj, redactions). Never mutates obj.

    Each redaction is {"path": "messages[0].content", "type": "email", "hash": "1a2b3c4d"}.
    Idempotent: redacting already-redacted data changes nothing and reports nothing, so the API
    can safely run it again on ingest.
    """
    found: list[dict[str, str]] = []
    return _walk(obj, "", found), found
