"""Where recorded runs go. The recorder only talks to this interface.

Records are plain dicts so any sink can serialise them. Only ListSink exists in Phase 2;
the HTTP sink arrives in Phase 4 together with the ingest endpoints it will POST to.
"""

from datetime import UTC, datetime
from typing import Any, Protocol


class Sink(Protocol):
    async def start_run(self, run: dict[str, Any]) -> None: ...

    async def add_steps(self, run_id: str, steps: list[dict[str, Any]]) -> None:
        """Called once per node run. Receivers must be idempotent on (run_id, idx)."""
        ...

    async def finish_run(self, run_id: str, status: str) -> None: ...


class ListSink:
    """In-memory sink for tests and local debugging."""

    def __init__(self) -> None:
        self.runs: dict[str, dict[str, Any]] = {}
        self.steps: list[dict[str, Any]] = []

    async def start_run(self, run: dict[str, Any]) -> None:
        self.runs[run["id"]] = dict(run)

    async def add_steps(self, run_id: str, steps: list[dict[str, Any]]) -> None:
        self.steps.extend(steps)

    async def finish_run(self, run_id: str, status: str) -> None:
        self.runs[run_id]["status"] = status
        self.runs[run_id]["ended_at"] = datetime.now(UTC).isoformat()

    def steps_for(self, run_id: str) -> list[dict[str, Any]]:
        return sorted((s for s in self.steps if s["run"] == run_id), key=lambda s: s["idx"])
