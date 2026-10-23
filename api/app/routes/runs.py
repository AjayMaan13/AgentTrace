"""Browser -> API reads. Scoped to the caller's workspace; another workspace's run is a 404."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from app import db
from app.auth import Principal, get_principal, read_workspace
from app.rca.memory import forget_scopes
from app.security import audit

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


@router.delete("/runs/{run_id}")
async def delete_run(run_id: str, principal: Principal = Depends(get_principal)) -> dict[str, Any]:
    """Admins only. Deletes the run, every fork of it, their steps, the experiments run on them,
    root-cause reports, and what Agent Memory remembered from them. The audit record is written
    first and must succeed: deleting data never goes unrecorded."""
    if not principal.is_admin:
        raise HTTPException(status_code=403, detail="Only organization admins can delete runs")
    workspace = principal.org_id
    if not await db.run_exists(workspace, run_id):
        raise HTTPException(status_code=404, detail="Run not found")

    await audit.record(workspace, principal.user_id, "run.delete", run_id, strict=True)
    deleted = await db.delete_run_cascade(workspace, run_id)
    if deleted is None:  # deleted by someone else between the check and now
        raise HTTPException(status_code=404, detail="Run not found")

    forgotten, failed = await forget_scopes(deleted["memory_scopes"])
    if failed:  # the run is gone, but some remembered patterns may remain: say so, do not hide it
        await audit.record(workspace, principal.user_id, "run.delete.memory_incomplete", run_id,
                           {"scopes_failed": failed})
    return {
        "deleted": {k: deleted[k] for k in ("runs", "steps", "experiments", "rca_reports")},
        "memory": {"items_forgotten": forgotten, "scopes_not_forgotten": failed},
    }
