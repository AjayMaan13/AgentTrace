"""Ask AgentTrace, day 3: streaming answers and the tool trace. Offline, with a scripted model that streams."""

import asyncio
import json
from datetime import UTC, datetime
from types import SimpleNamespace

import httpx
import pytest
from anthropic import APIConnectionError
from fastapi.testclient import TestClient

from app.assistant import service
from app.config import ASSISTANT_DAILY_QUESTIONS, ASSISTANT_MODEL
from app.main import app
from app.runtime import get_runtime
from test_assistant import WS_A, FakeModel, seed, text, use

RUN_A = "a" * 32
GOOD = "Add a webhook [doc:docs/integrations.md#6-failure-alerts-slack-or-any-address]."


def run(coro):
    return asyncio.run(coro)


class _Live:
    """What `client.messages.stream(...)` gives: a context manager with a stream of the text and the final message."""

    def __init__(self, model, kw):
        self.model, self.kw = model, kw

    async def __aenter__(self):
        self.response = await self.model._create(**self.kw)
        return self

    async def __aexit__(self, *exc):
        return False

    @property
    def text_stream(self):
        return self._deltas()

    async def _deltas(self):
        for block in self.response.content:
            if block.type == "text":
                words = block.text.split(" ")
                for i, word in enumerate(words):
                    yield word + (" " if i < len(words) - 1 else "")

    async def get_final_message(self):
        return self.response


class FakeStreamModel(FakeModel):
    def __init__(self, *replies, **kw):
        super().__init__(*replies, **kw)
        self.streams = 0
        self.messages = SimpleNamespace(create=self._create, stream=self._stream)

    def _stream(self, **kw):
        self.streams += 1
        return _Live(self, kw)


def events(model, question="How do I get Slack alerts?", stream=True, **kw):
    async def go():
        return [e async for e in service.ask_events(WS_A, question, None, model, stream=stream, **kw)]

    return run(go())


# --- the events -----------------------------------------------------------------------------------

def test_a_streamed_answer_arrives_as_status_then_text_then_a_result():
    model = FakeStreamModel([use("search_docs", {"query": "slack alerts failed run"})], [text(GOOD)])
    got = events(model)
    kinds = [k for k, _ in got]
    assert kinds[0] == "status" and kinds[-1] == "result" and set(kinds[1:-1]) == {"text"}
    assert got[0][1] == {"message": "Searching the docs"}
    assert "".join(d["delta"] for k, d in got if k == "text") == GOOD  # the preview is the answer, piece by piece
    result = got[-1][1]
    assert not result["rejected"] and result["citations"][0]["ok"] and model.streams == 2


def test_without_streaming_the_model_is_called_the_ordinary_way_and_there_is_no_text_event():
    model = FakeStreamModel([use("search_docs", {"query": "slack alerts failed run"})], [text(GOOD)])
    got = events(model, stream=False)
    assert [k for k, _ in got] == ["status", "result"] and model.streams == 0


def test_an_answer_redone_for_its_citations_resets_the_preview_and_only_the_result_counts():
    model = FakeStreamModel([use("search_docs", {"query": "slack alerts"})], [text("Made up [doc:nope.md#x].")], [text(GOOD)])
    got = events(model)
    statuses = [d["message"] for k, d in got if k == "status"]
    assert statuses == ["Searching the docs", service.RETRYING]
    assert got[-1][1]["answer"] == GOOD and not got[-1][1]["rejected"]


def test_an_answer_that_fails_its_check_is_replaced_by_the_notice_even_though_it_was_previewed():
    model = FakeStreamModel([use("search_docs", {"query": "slack alerts"})], [text("Trust me [run:" + "f" * 32 + "].")])
    got = events(model)
    previewed = "".join(d["delta"] for k, d in got if k == "text")
    assert "Trust me" in previewed
    assert got[-1][1]["rejected"] and got[-1][1]["answer"] == service.REJECTED and got[-1][1]["citations"] == []


def test_a_model_outage_while_streaming_is_an_assistant_error():
    model = FakeStreamModel([text("x")])

    def down(**_):
        raise APIConnectionError(request=httpx.Request("POST", "https://api.anthropic.com/v1/messages"))

    model.messages.stream = down
    with pytest.raises(service.AssistantError, match="could not reach the model"):
        events(model)


def test_the_tool_calls_can_be_collected_for_recording(store):
    seed(store, WS_A, RUN_A)
    trace = []
    model = FakeStreamModel([use("get_run", {"run_id": RUN_A})], [text(f"Step 1 holds the wrong plan [run:{RUN_A}#1].")])
    events(model, "What happened?", stream=False, trace=trace)
    assert trace == [{"name": "get_run", "args": {"run_id": RUN_A}, "sources": sorted([f"run:{RUN_A}", f"run:{RUN_A}#1", f"run:{RUN_A}#2"]), "is_error": False}]


# --- the route ------------------------------------------------------------------------------------

def parse_sse(body: str) -> list[tuple[str, dict]]:
    out = []
    for block in body.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines())
        out.append((lines["event"], json.loads(lines["data"])))
    return out


@pytest.fixture
def client(store, login):
    login(WS_A)
    holder = {"model": FakeStreamModel([text("I could not find anything about that.")])}
    app.dependency_overrides[get_runtime] = lambda: (holder["model"], None)
    with TestClient(app) as c:
        c.holder = holder
        yield c
    app.dependency_overrides.pop(get_runtime, None)


def post(c, **body):
    return c.post("/v1/assistant/ask/stream", json={"question": "What is AgentTrace?", **body})


def test_the_stream_route_sends_events_and_ends_with_the_result(client):
    res = post(client)
    assert res.status_code == 200 and res.headers["content-type"].startswith("text/event-stream")
    assert res.headers["cache-control"] == "no-cache"
    got = parse_sse(res.text)
    assert got[-1][0] == "result" and got[-1][1]["model"] == ASSISTANT_MODEL and not got[-1][1]["rejected"]
    assert "".join(d["delta"] for k, d in got if k == "text") == "I could not find anything about that."


def test_a_streamed_question_is_counted_before_it_streams_and_the_audit_holds_no_content(client, store):
    post(client, question="the secret word zebra-42")
    [record] = store.audit
    assert record["action"] == "assistant.ask" and record["detail"] == {"streamed": True} and "zebra-42" not in json.dumps(store.audit)


def test_a_model_outage_is_an_error_event_not_a_broken_response(client):
    def down(**_):
        raise APIConnectionError(request=httpx.Request("POST", "https://api.anthropic.com/v1/messages"))

    client.holder["model"].messages.stream = down
    res = post(client)
    assert res.status_code == 200 and parse_sse(res.text) == [("error", {"detail": "The assistant could not reach the model. Try again in a minute."})]


def test_the_limits_apply_before_anything_streams(client, store):
    codes = [post(client).status_code for _ in range(11)]
    assert codes[:10] == [200] * 10 and codes[10] == 429
    store.audit.clear()
    from app.security import limits

    limits.assistant_limiter._calls.clear()
    now = datetime.now(UTC).isoformat()
    store.audit += [{"workspace": WS_A, "actor": "user_1", "action": "assistant.ask", "target": "-", "detail": {}, "at": now}] * ASSISTANT_DAILY_QUESTIONS
    res = post(client)
    assert res.status_code == 429 and "Daily question limit" in res.json()["detail"]


def test_the_stream_route_needs_a_login_and_a_sound_question(store, login):
    from app.auth import get_principal

    app.dependency_overrides.pop(get_principal, None)
    with TestClient(app) as c:
        assert post(c).status_code in (401, 403)
    login(WS_A)
    app.dependency_overrides[get_runtime] = lambda: (FakeStreamModel([text("x")]), None)
    with TestClient(app) as c:
        assert post(c, question="").status_code == 422 and post(c, run_id="../x").status_code == 422
    app.dependency_overrides.pop(get_runtime, None)
