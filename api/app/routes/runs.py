"""Browser -> API reads. Scoped to the caller's workspace; another workspace's run is a 404."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from app import db
from app.auth import read_workspace

router = APIRouter(prefix="/v1")


@router.get("/runs")
async def list_runs(
    limit: int = Query(default=50, ge=1, le=200), workspace: str = Depends(read_workspace)
) -> list[dict[str, Any]]:
    return await db.list_runs(workspace, limit)


@router.get("/runs/{run_id}")
async def get_run(run_id: str, workspace: str = Depends(read_workspace)) -> dict[str, Any]:
    run = await db.get_run_with_steps(workspace, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return run
