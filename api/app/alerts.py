"""Tell people when a run fails: a message to Slack or to any address that accepts a JSON post.

When a run finishes with a wrong answer (or an error) and the workspace has webhooks, each one gets the workflow,
a link, the reason the owner's check gave, and, if that webhook asked for it, the most likely cause.

The likely cause costs tokens and nobody is there to approve it, so it is opt-in per webhook, it runs under the
same per-minute limit as a person starting one (charged to `webhook:<id>`), and it only exists for workflows
registered on this server. Otherwise the alert says why there is no suspect.

An address a workspace admin types in is a request our server makes, so it is checked twice, when it is saved and
when it is used: https only, the standard port, no user name in it, and the host must resolve only to public
addresses (never loopback, a private network, link-local or the cloud metadata address). Slack addresses must be
hooks.slack.com. Redirects are not followed. The remaining gap is a host whose address changes between that check
and the connection (DNS rebinding); it is listed in SECURITY.md.

A run alerts once, however many times its finish is sent. A workspace is limited to 10 alerts a minute.
Run text is escaped for Slack, so a run cannot mention a channel or plant a link in the message.
"""

import asyncio
import hashlib
import hmac
import ipaddress
import json
import logging
import socket
import urllib.error
import urllib.request
from typing import Any
from urllib.parse import urlsplit

from fastapi import HTTPException

from app import db
from app.config import get_settings
from app.security import audit
from app.security.limits import alert_limiter
from app.workflows.registry import REGISTRY

log = logging.getLogger(__name__)

SLACK_HOST = "hooks.slack.com"
TIMEOUT_S = 5.0
KINDS = ("slack", "generic")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args: Any, **kwargs: Any) -> None:  # a redirect could lead somewhere we never checked
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)


def validate(url: str, kind: str) -> str:
    """The host if the address is acceptable, else a ValueError saying why in plain words. Blocking (it resolves
    the name): call it through `check` from async code."""
    parts = urlsplit(url)
    if parts.scheme != "https":
        raise ValueError("Use an https address.")
    if parts.username or parts.password:
        raise ValueError("The address cannot contain a user name or password.")
    try:
        port = parts.port
    except ValueError:
        raise ValueError("The address has a bad port.") from None
    if port not in (None, 443):
        raise ValueError("Only the standard https port is allowed.")
    host = (parts.hostname or "").lower()
    if not host:
        raise ValueError("The address has no host.")
    if kind == "slack":
        if host != SLACK_HOST or not parts.path.startswith("/services/"):
            raise ValueError("A Slack address looks like https://hooks.slack.com/services/...")
        return host
    try:
        found = [ipaddress.ip_address(host)]
    except ValueError:
        try:
            found = [ipaddress.ip_address(i[4][0]) for i in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)]
        except OSError:
            raise ValueError("That address cannot be found.") from None
    if not found or any(not ip.is_global for ip in found):
        raise ValueError("That address is on a private network, so it is not allowed.")
    return host


async def check(url: str, kind: str) -> str:
    return await asyncio.to_thread(validate, url, kind)


def _escape(text: Any) -> str:
    """Slack treats & < > as markup: <!channel> pings everyone and <https://x|y> makes a link."""
    return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _clip(text: Any, n: int) -> str:
    text = str(text)
    return text if len(text) <= n else text[: n - 1] + "…"


def event_for(run: dict[str, Any], suspect: dict[str, Any] | None, note: str | None) -> dict[str, Any]:
    origin = get_settings().web_origins[0]
    verdict = (run.get("oracle_detail") or {}).get("verdict") or {}
    return {
        "event": "run.failed",
        "run": {"id": run["id"], "workflow": run["workflow"], "outcome": run["outcome"], "started_at": run.get("started_at"),
                "url": f"{origin}/runs/{run['id']}"},
        "check": {"name": verdict.get("name"), "reason": _clip(verdict["reason"], 300)} if verdict.get("reason") else None,
        "suspect": suspect,
        "suspect_note": note,
    }


def slack_message(event: dict[str, Any]) -> dict[str, Any]:
    r = event["run"]
    what = "ended in an error" if r["outcome"] == "error" else "gave a wrong answer"
    lines = [f"*{_escape(r['workflow'])}* {what}."]
    if event["check"]:
        lines.append(f"Check {_escape(event['check']['name'])}: {_escape(event['check']['reason'])}")
    s = event["suspect"]
    if s:
        lines.append(f"Most likely cause: the *{_escape(s['agent'])}* ({round(s['confidence'] * 100)}%). {_escape(s['hypothesis'])}")
    elif event["suspect_note"]:
        lines.append(_escape(event["suspect_note"]))
    lines.append(f"<{r['url']}|Open the run>")  # the one link in the message is ours
    return {"text": "\n".join(lines)}


def _post_sync(url: str, body: bytes, headers: dict[str, str]) -> int:
    request = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json", **headers}, method="POST")
    try:
        with _OPENER.open(request, timeout=TIMEOUT_S) as resp:
            resp.read(1024)  # the answer is not used, and a big one is not read
            return resp.status
    except urllib.error.HTTPError as exc:
        return exc.code


async def deliver(hook: dict[str, Any], payload: dict[str, Any]) -> int | None:
    """Post once, and once more if it could not connect. Returns the HTTP status, or None if it never got through."""
    try:
        await check(hook["url"], hook["kind"])  # again now: the name may have moved since it was saved
    except ValueError as exc:
        log.warning("webhook %s not sent: %s", hook.get("id"), exc)
        return None
    body = json.dumps(payload, default=str).encode()
    headers = {}
    if hook["kind"] == "generic" and hook.get("secret"):
        headers["X-AgentTrace-Signature"] = "sha256=" + hmac.new(hook["secret"].encode(), body, hashlib.sha256).hexdigest()
    for attempt in (1, 2):
        try:
            return await asyncio.to_thread(_post_sync, hook["url"], body, headers)
        except (urllib.error.URLError, TimeoutError, OSError):
            if attempt == 2:
                return None
            await asyncio.sleep(1)
    return None


async def _suspect(workspace: str, run: dict[str, Any], hooks: list[dict[str, Any]]) -> tuple[dict[str, Any] | None, str | None]:
    """The most likely cause, if some webhook asked for it and the server can find one."""
    asking = next((h for h in hooks if h.get("include_suspect")), None)
    if asking is None:
        return None, None
    if run["outcome"] != "fail" or run["workflow"] not in REGISTRY:
        return None, "A likely cause is only worked out for runs of workflows registered on the server."
    from app.rca.report import report_view  # noqa: PLC0415
    from app.routes.rca import run_rca  # noqa: PLC0415
    from app.runtime import get_runtime  # noqa: PLC0415

    try:
        stored = await db.get_latest_rca_report(workspace, run["id"])
        report = report_view(stored) if stored else await run_rca(workspace, f"webhook:{asking['id']}", run["id"], get_runtime())
    except Exception as exc:  # the alert still goes out, without a suspect
        log.warning("alert for %s: no suspect (%s)", run["id"], type(exc).__name__)
        return None, "A likely cause could not be worked out for this run."
    if not report["candidates"]:
        return None, "No likely cause was found."
    top = max(report["candidates"], key=lambda c: c["confidence"])
    agent = next((s["agent"] for s in run["steps"] if s["node_run_idx"] == top["node_run_idx"]), f"turn {top['node_run_idx']}")
    return {"node_run_idx": top["node_run_idx"], "agent": agent, "confidence": top["confidence"],
            "hypothesis": _clip(top["hypothesis"], 400)}, None


async def notify_failure(workspace: str, run_id: str) -> None:
    """Alert every webhook of the workspace about a failed run. Never raises: a failed alert must not fail a run."""
    try:
        hooks = [h for h in await db.list_webhooks(workspace) if not h.get("revoked_at")]
        if not hooks or not await db.claim_alert(workspace, run_id):
            return
        try:
            alert_limiter.check(workspace)
        except HTTPException:
            log.warning("alert for %s dropped: too many alerts this minute", run_id)
            return
        run = await db.get_run_with_steps(workspace, run_id)
        if run is None or run.get("outcome") not in ("fail", "error"):
            return
        suspect, note = await _suspect(workspace, run, hooks)
        for hook in hooks:
            wants = bool(hook.get("include_suspect"))
            event = event_for(run, suspect if wants else None, note if wants else None)
            status = await deliver(hook, slack_message(event) if hook["kind"] == "slack" else event)
            ok = status is not None and 200 <= status < 300
            await audit.record(workspace, f"webhook:{hook['id']}", "alert.sent" if ok else "alert.failed", run_id, {"status": status})
    except Exception as exc:
        log.warning("alert for %s failed: %s", run_id, type(exc).__name__)
