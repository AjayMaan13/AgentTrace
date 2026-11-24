"""Ask AgentTrace: a signed-in user asks a question about the docs or their own runs and gets an answer with
checked citations. The workspace comes from the verified token. Each question is rate limited, counted against a
daily allowance and audited; the audit record holds counts only, never the question or the answer."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.assistant import service
from app.auth import Principal, get_principal
from app.runtime import get_runtime
from app.security import audit
from app.security.limits import assistant_limiter, enforce_assistant_daily_cap

router = APIRouter(prefix="/v1/assistant")


class AskBody(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    run_id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_-]{1,64}$")  # the run the user is looking at


@router.post("/ask")
async def ask(
    body: AskBody, principal: Principal = Depends(get_principal), runtime: tuple[Any, Any] = Depends(get_runtime)
) -> dict[str, Any]:
    assistant_limiter.check(principal.user_id)
    await enforce_assistant_daily_cap(principal.user_id)
    try:
        result = await service.ask(principal.org_id, body.question.strip(), body.run_id, runtime[0])
    except service.AssistantError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from None
    await audit.record(
        principal.org_id, principal.user_id, "assistant.ask", body.run_id or "-",
        {"tool_calls": result["tool_calls"], "tokens_in": result["tokens_in"], "tokens_out": result["tokens_out"], "rejected": result["rejected"]},
    )
    return result
