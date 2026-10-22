"""Root-cause analysis of a failed run: POST runs it (and stores the report), GET returns the
latest stored report. Scoped to the caller's workspace."""

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException

from app import db
from app.auth import read_workspace
from app.rca.agent import Candidate, RcaError, analyze
from app.rca.compact import build_prompt
from app.rca.lineage import lineage
from app.runtime import get_runtime
from app.workflows.registry import REGISTRY

router = APIRouter(prefix="/v1")


def _view(doc: dict[str, Any]) -> dict[str, Any]:
    # Fields stored as None are dropped by SurrealDB; validating through Candidate restores them.
    return {
        "id": doc["id"], "run": doc["run"], "model": doc["model"], "created_at": doc["created_at"],
        "lineage": doc["lineage"], "dropped_quotes": doc.get("dropped_quotes", 0),
        "tokens_in": doc["tokens_in"], "tokens_out": doc["tokens_out"],
        "candidates": [Candidate.model_validate(c).model_dump() for c in doc["candidates"]],
    }


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

    path = lineage(run["steps"], workflow.oracle_keys)
    try:
        result = await analyze(run, build_prompt(run, path, workflow.oracle_keys), runtime[0])
    except RcaError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from None

    report_id = uuid4().hex
    doc = {"run": run_id, "lineage": path, "created_at": datetime.now(UTC).isoformat(), **result}
    await db.create_rca_report(workspace, report_id, doc)
    return _view({**doc, "id": report_id})


@router.get("/runs/{run_id}/rca")
async def get_rca(run_id: str, workspace: str = Depends(read_workspace)) -> dict[str, Any]:
    doc = await db.get_latest_rca_report(workspace, run_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="No root-cause report for this run yet")
    return _view(doc)
