"""Root-cause analysis of a failed run: POST runs it (and stores the report), GET returns the
latest stored report. Scoped to the caller's workspace."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from app import db
from app.auth import read_workspace
from app.rca.agent import RcaError
from app.rca.report import report_view
from app.rca.service import generate_report
from app.runtime import get_runtime
from app.workflows.registry import REGISTRY

router = APIRouter(prefix="/v1")


@router.post("/runs/{run_id}/rca")
async def create_rca(
    run_id: str, workspace: str = Depends(read_workspace), runtime: tuple[Any, Any] = Depends(get_runtime)
) -> dict[str, Any]:
    run = await db.get_run_with_steps(workspace, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    if run.get("outcome") != "fail":
        raise HTTPException(status_code=409, detail="Root-cause analysis is for runs that failed the oracle")
    workflow = REGISTRY.get(run["workflow"])
    if workflow is None:
        raise HTTPException(status_code=422, detail=f"workflow {run['workflow']!r} is not registered")

    try:
        return await generate_report(workspace, run, workflow, runtime[0])
    except RcaError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from None


@router.get("/runs/{run_id}/rca")
async def get_rca(run_id: str, workspace: str = Depends(read_workspace)) -> dict[str, Any]:
    doc = await db.get_latest_rca_report(workspace, run_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="No root-cause report for this run yet")
    return report_view(doc)
