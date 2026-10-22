"""In-memory stand-in for the parts of app.db that routes and forks use (fast, offline)."""

from typing import Any

from app import db


class FakeDB:
    def __init__(self) -> None:
        self.keys: dict[str, str] = {}
        self.runs: dict[str, dict[str, Any]] = {}
        self.steps: dict[tuple[str, int], dict[str, Any]] = {}
        self.forks: list[dict[str, Any]] = []
        self.experiments: dict[str, dict[str, Any]] = {}
        self.tested: list[tuple[str, str]] = []
        self.rca_reports: list[dict[str, Any]] = []

    async def workspace_for_key_hash(self, h):
        return self.keys.get(h)

    async def create_run(self, ws, run_id, workflow, started_at, kind="recorded"):
        if run_id in self.runs:
            if self.runs[run_id]["workspace"] != ws:
                raise db.RunConflict(run_id)
            return False
        self.runs[run_id] = {"id": run_id, "workspace": ws, "workflow": workflow,
                             "started_at": started_at, "status": "running", "kind": kind}
        return True

    async def run_exists(self, ws, run_id):
        return self.runs.get(run_id, {}).get("workspace") == ws

    async def add_steps(self, ws, run_id, steps):
        added = 0
        for s in steps:
            if (run_id, s["idx"]) not in self.steps:
                self.steps[(run_id, s["idx"])] = s
                added += 1
        return added

    async def finish_run(self, ws, run_id, status, outcome, oracle_detail):
        if not await self.run_exists(ws, run_id):
            return False
        self.runs[run_id].update(status=status, outcome=outcome, oracle_detail=oracle_detail)
        return True

    async def get_run_with_steps(self, ws, run_id):
        if not await self.run_exists(ws, run_id):
            return None
        steps = sorted((s for (r, _), s in self.steps.items() if r == run_id), key=lambda s: s["idx"])
        return {**self.runs[run_id], "steps": steps}

    async def list_runs(self, ws, limit=50):
        return sorted((r for r in self.runs.values() if r["workspace"] == ws),
                      key=lambda r: r["started_at"], reverse=True)[:limit]

    async def create_fork_edge(self, ws, fork_run_id, parent_run_id, at_idx, arm, experiment=None):
        if not (await self.run_exists(ws, fork_run_id) and await self.run_exists(ws, parent_run_id)):
            raise LookupError("both runs must exist in the workspace")
        self.forks.append({"fork_run": fork_run_id, "parent": parent_run_id,
                           "at_idx": at_idx, "arm": arm, "experiment": experiment})

    async def list_forks(self, ws, parent_run_id):
        return [f for f in self.forks if f["parent"] == parent_run_id]

    async def create_experiment(self, ws, experiment_id, doc):
        self.experiments[experiment_id] = {**doc, "id": experiment_id, "workspace": ws}

    async def update_experiment(self, ws, experiment_id, merge):
        if self.experiments.get(experiment_id, {}).get("workspace") == ws:
            self.experiments[experiment_id].update(merge)

    async def get_experiment(self, ws, experiment_id):
        e = self.experiments.get(experiment_id)
        return {**e} if e and e["workspace"] == ws else None

    async def create_tested_edge(self, experiment_id, run_id):
        self.tested.append((experiment_id, run_id))

    async def get_run_summary(self, ws, run_id):
        r = self.runs.get(run_id)
        if not r or r["workspace"] != ws:
            return None
        steps = [s for (rid, _), s in self.steps.items() if rid == run_id]
        return {"status": r.get("status"), "outcome": r.get("outcome"),
                "tokens_in": sum(s["tokens_in"] for s in steps),
                "tokens_out": sum(s["tokens_out"] for s in steps)}

    async def create_rca_report(self, ws, report_id, doc):
        self.rca_reports.append({**doc, "id": report_id, "workspace": ws})

    async def get_latest_rca_report(self, ws, run_id):
        mine = [r for r in self.rca_reports if r["workspace"] == ws and r["run"] == run_id]
        return max(mine, key=lambda r: r["created_at"]) if mine else None


DB_FUNCTIONS = ("workspace_for_key_hash", "create_run", "run_exists", "add_steps", "finish_run",
                "get_run_with_steps", "list_runs", "create_fork_edge", "list_forks",
                "create_experiment", "update_experiment", "get_experiment", "create_tested_edge",
                "get_run_summary", "create_rca_report", "get_latest_rca_report")
