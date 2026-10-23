"""Start an experiment (returns immediately) and poll it. Scoped to the caller's workspace."""

from typing import Any

from agenttrace_sdk import SideEffectBlocked
from fastapi import APIRouter, Depends, HTTPException

from app import db
from app.benchmark import benchmark_view
from app.auth import Principal, get_principal, read_workspace
from app.experiments.runner import create_experiment, view
from app.models import ExperimentCreate
from app.replay.fork import ModelPinError
from app.runtime import get_runtime
from app.security import audit
from app.security.limits import enforce_daily_cap, experiment_limiter, launch_lock

router = APIRouter(prefix="/v1")


@router.post("/experiments", status_code=202)
async def start_experiment(
    body: ExperimentCreate,
    principal: Principal = Depends(get_principal),
    runtime: tuple[Any, Any] = Depends(get_runtime),
) -> dict[str, str]:
    client, tools = runtime
    workspace = principal.org_id
    experiment_limiter.check(principal.user_id)
    try:
        async with launch_lock:
            await enforce_daily_cap(principal.user_id)
            experiment_id = await create_experiment(
                workspace, body.run_id, body.fork_node_run_idx, body.edit, body.n,
                client=client, tools=tools, created_by=principal.user_id,
            )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from None
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    except (ModelPinError, SideEffectBlocked) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    await audit.record(workspace, principal.user_id, "experiment.launch", experiment_id, {
        "parent_run": body.run_id, "fork_node_run_idx": body.fork_node_run_idx, "n": body.n,
        "edit_keys": sorted(body.edit),
    })
    return {"id": experiment_id}


@router.get("/experiments/{experiment_id}")
async def get_experiment(experiment_id: str, workspace: str = Depends(read_workspace)) -> dict[str, Any]:
    doc = await db.get_experiment(workspace, experiment_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Experiment not found")
    return {**view(doc), "benchmark": benchmark_view(await db.get_benchmark_for_experiment(workspace, experiment_id))}
