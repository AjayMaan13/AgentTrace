"""Start an experiment (returns immediately) and poll it. Scoped to the caller's workspace."""

from typing import Any

from agenttrace_sdk import SideEffectBlocked
from anthropic import AsyncAnthropic
from fastapi import APIRouter, Depends, HTTPException

from app import db
from app.auth import read_workspace
from app.experiments.runner import create_experiment, view
from app.models import ExperimentCreate
from app.replay.fork import ModelPinError
from app.workflows.renewal_brief.tools import make_tools

router = APIRouter(prefix="/v1")


def get_runtime() -> tuple[Any, Any]:
    """(LLM client, tools) for live forks. A dependency so tests can substitute fakes.
    The SDK retries 429s; a higher ceiling than its default of 2 rides out rate limits."""
    return AsyncAnthropic(max_retries=5), make_tools()


@router.post("/experiments", status_code=202)
async def start_experiment(
    body: ExperimentCreate,
    workspace: str = Depends(read_workspace),
    runtime: tuple[Any, Any] = Depends(get_runtime),
) -> dict[str, str]:
    client, tools = runtime
    try:
        experiment_id = await create_experiment(
            workspace, body.run_id, body.fork_node_run_idx, body.edit, body.n,
            client=client, tools=tools, created_by=workspace,  # a user id once Clerk lands
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from None
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    except (ModelPinError, SideEffectBlocked) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    return {"id": experiment_id}


@router.get("/experiments/{experiment_id}")
async def get_experiment(experiment_id: str, workspace: str = Depends(read_workspace)) -> dict[str, Any]:
    doc = await db.get_experiment(workspace, experiment_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Experiment not found")
    return view(doc)
