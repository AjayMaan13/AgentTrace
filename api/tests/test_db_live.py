"""Phase 1 and 4 against the REAL SurrealDB. Skipped unless RUN_LIVE=1:

    RUN_LIVE=1 api/.venv/bin/pytest api/tests/test_db_live.py

Each test uses a throwaway `test-<random>` workspace and purges it afterwards."""

import asyncio
import os
import uuid

import pytest
from fastapi.testclient import TestClient

from app import db
from app.auth import KEY_PREFIX, hash_key
from app.main import app

pytestmark = pytest.mark.skipif(not os.environ.get("RUN_LIVE"), reason="set RUN_LIVE=1 to hit SurrealDB")


def run(coro):
    return asyncio.run(coro)


def new_id() -> str:
    return uuid.uuid4().hex


def step(run_id, idx, **over):
    return {"run": run_id, "idx": idx, "node_run_idx": idx, "agent": f"a{idx}", "kind": "llm",
            "origin": "recorded", "tokens_in": 10, "tokens_out": 5, **over}


@pytest.fixture(scope="module", autouse=True)
def schema():
    run(db.apply_schema())


@pytest.fixture
def ws():
    name = f"test-{uuid.uuid4().hex[:8]}"
    yield name
    run(db.purge_workspace(name))


def test_steps_come_back_in_order_even_when_inserted_out_of_order(ws):
    rid = new_id()
    run(db.create_run(ws, rid, "w", "2026-01-01T00:00:00+00:00"))
    run(db.add_steps(ws, rid, [step(rid, 3), step(rid, 1)]))
    run(db.add_steps(ws, rid, [step(rid, 2)]))
    result = run(db.get_run_with_steps(ws, rid))
    assert [s["idx"] for s in result["steps"]] == [1, 2, 3]
    assert result["id"] == rid and result["workspace"] == ws


def test_reposting_a_batch_adds_no_duplicate_steps_or_edges(ws):
    rid = new_id()
    run(db.create_run(ws, rid, "w", "t"))
    batch = [step(rid, 1), step(rid, 2)]
    assert run(db.add_steps(ws, rid, batch)) == 2
    assert run(db.add_steps(ws, rid, batch)) == 0
    assert len(run(db.get_run_with_steps(ws, rid))["steps"]) == 2

    async def edge_counts():
        async with db.connect() as c:
            has = await c.query("SELECT count() AS n FROM has_step WHERE in = type::record('run', $r) GROUP ALL", {"r": rid})
            nxt = await c.query("SELECT count() AS n FROM next WHERE in.run = $r GROUP ALL", {"r": rid})
        return has[0]["n"], nxt[0]["n"]

    assert run(edge_counts()) == (2, 1)  # two has_step edges, one next edge (step1 -> step2)


def test_a_run_is_invisible_to_other_workspaces(ws):
    rid = new_id()
    run(db.create_run(ws, rid, "w", "t"))
    assert run(db.run_exists(ws, rid)) and not run(db.run_exists("test-other", rid))
    assert run(db.get_run_with_steps("test-other", rid)) is None
    assert run(db.list_runs("test-other")) == []
    assert run(db.finish_run("test-other", rid, "ok", "pass", None)) is False
    with pytest.raises(db.RunConflict):
        run(db.create_run("test-other", rid, "w", "t"))


def test_finish_run_sums_tokens_and_stores_the_oracle_result(ws):
    rid = new_id()
    run(db.create_run(ws, rid, "w", "t"))
    run(db.add_steps(ws, rid, [step(rid, 1), step(rid, 2)]))
    assert run(db.finish_run(ws, rid, "ok", "fail", {"footer": {"open_tickets": 0}}))
    got = run(db.get_run_with_steps(ws, rid))
    assert (got["status"], got["outcome"], got["tokens_in"], got["tokens_out"]) == ("ok", "fail", 20, 10)
    assert got["oracle_detail"] == {"footer": {"open_tickets": 0}}


def test_list_runs_is_newest_first(ws):
    old, new = new_id(), new_id()
    run(db.create_run(ws, old, "w", "2026-01-01T00:00:00+00:00"))
    run(db.create_run(ws, new, "w", "2026-02-01T00:00:00+00:00"))
    assert [r["id"] for r in run(db.list_runs(ws))] == [new, old]


def test_list_forks_is_empty_for_a_fresh_run_then_shows_the_fork(ws):
    parent, fork = new_id(), new_id()
    run(db.create_run(ws, parent, "w", "t"))
    run(db.create_run(ws, fork, "w", "t"))
    assert run(db.list_forks(ws, parent)) == []
    run(db.create_fork_edge(ws, fork, parent, at_idx=2, arm="treatment", experiment=None))
    assert run(db.list_forks(ws, parent)) == [
        {"fork_run": fork, "at_idx": 2, "arm": "treatment", "experiment": None}
    ]
    assert run(db.list_forks("test-other", parent)) == []


def test_end_to_end_ingest_over_http_with_a_real_key(ws, monkeypatch):
    """SDK-shaped requests -> routes -> SurrealDB -> GET, including a wrong key and a re-post."""
    key = KEY_PREFIX + uuid.uuid4().hex
    run(db.upsert_workspace(ws, "live test"))
    run(db.create_api_key(ws, key[:12], hash_key(key), "test"))
    monkeypatch.setenv("ENV", "dev")
    monkeypatch.setenv("DEV_WORKSPACE_ID", ws)
    client, auth, rid = TestClient(app), {"Authorization": f"Bearer {key}"}, new_id()

    assert client.post("/v1/runs", headers={"Authorization": "Bearer at_live_wrong"},
                       json={"id": rid, "workflow": "w", "started_at": "t"}).status_code == 401
    assert client.post("/v1/runs", headers=auth, json={"id": rid, "workflow": "w", "started_at": "t"}).status_code == 201
    batch = {"steps": [{"idx": i, "node_run_idx": 1, "agent": "p", "kind": "llm", "origin": "recorded"} for i in (1, 2)]}
    assert client.post(f"/v1/runs/{rid}/steps", headers=auth, json=batch).json()["added"] == 2
    assert client.post(f"/v1/runs/{rid}/steps", headers=auth, json=batch).json()["added"] == 0
    client.post(f"/v1/runs/{rid}/finish", headers=auth, json={"status": "ok", "outcome": "fail"})

    got = client.get(f"/v1/runs/{rid}").json()
    assert [s["idx"] for s in got["steps"]] == [1, 2] and got["outcome"] == "fail"
