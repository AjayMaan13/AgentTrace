"""trace_run, @node, @tool and TracedLLM: turn a workflow execution into Step records.

Explicit wrappers, not monkey-patching: the workflow is handed a `TracedLLM` and decorated
tools, so what gets recorded is visible in the code.

Recording never changes behaviour. Wrapped functions return exactly what they would have
returned; only the stored copy is redacted. Outside `trace_run` everything passes through
untraced, so the same workflow code can run with or without recording.
"""

import dataclasses
import functools
import hashlib
import inspect
import json
import time
from collections.abc import AsyncIterator, Awaitable, Callable, Sequence
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from agenttrace_sdk.context import (
    NodeContext,
    RunContext,
    Step,
    current_node,
    current_run,
)
from agenttrace_sdk.redaction import redact
from agenttrace_sdk.sinks import Sink

NO_CALL_TOOL_NAME = "__node__"
_LLM_INPUT_KEYS = ("system", "messages", "tools")


class UndeclaredWriteError(RuntimeError):
    """A node returned state keys it did not declare in `writes=`.

    Lineage (which node wrote which key) is how the RCA agent walks from a symptom back to its
    cause, so an undeclared write would silently produce a wrong trace. Fail loudly instead.
    """


def _to_jsonable(obj: Any) -> Any:
    """Copy `obj` into plain JSON types. Handles pydantic models (e.g. Anthropic content blocks)."""
    if obj is None or isinstance(obj, (str, int, float, bool)):
        return obj
    if isinstance(obj, dict):
        return {str(k): _to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [_to_jsonable(v) for v in obj]
    dump = getattr(obj, "model_dump", None)
    if callable(dump):
        return _to_jsonable(dump(mode="json"))
    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        return _to_jsonable(dataclasses.asdict(obj))
    return str(obj)


def _clean(field_name: str, value: Any, redactions: list[dict[str, str]]) -> Any:
    """JSON-ify and redact one field, recording hits under `field_name.<path>`."""
    cleaned, found = redact(_to_jsonable(value))
    for hit in found:
        path = f"{field_name}.{hit['path']}" if hit["path"] else field_name
        redactions.append({**hit, "path": path})
    return cleaned


def _content_hash(redacted_input: Any) -> str:
    """sha256 of the STORED input, so it can never leak what redaction removed, while still
    differing when two secrets differ (the markers carry a hash of the secret)."""
    payload = json.dumps(redacted_input, sort_keys=True, default=str)
    return hashlib.sha256(payload.encode()).hexdigest()


def _require_node() -> NodeContext:
    node = current_node.get()
    if node is None:
        raise RuntimeError(
            "LLM and tool calls inside trace_run() must happen inside an @node function"
        )
    return node


def _record_step(
    *,
    kind: str,
    agent: str,
    model: str | None = None,
    params: dict[str, Any] | None = None,
    input: Any = None,
    output: Any = None,
    tool_name: str | None = None,
    tool_args: dict[str, Any] | None = None,
    tool_result: Any = None,
    side_effect: bool | None = None,
    tokens_in: int = 0,
    tokens_out: int = 0,
    latency_ms: int = 0,
) -> Step:
    run = current_run.get()
    node = current_node.get()
    assert run is not None and node is not None
    redactions: list[dict[str, str]] = []
    clean_input = _clean("input", input, redactions)
    clean_args = _clean("tool_args", tool_args, redactions)
    step = Step(
        run=run.id,
        idx=run.next_idx(),
        node_run_idx=node.node_run_idx,
        agent=agent,
        kind=kind,
        origin=run.origin,
        model=model,
        params=_clean("params", params or {}, redactions),
        input=clean_input,
        output=_clean("output", output, redactions),
        tool_name=tool_name,
        tool_args=clean_args,
        tool_result=_clean("tool_result", tool_result, redactions),
        side_effect=side_effect,
        reads=list(node.reads),
        writes=list(node.writes),
        content_hash=_content_hash(clean_input if kind == "llm" else clean_args),
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        latency_ms=latency_ms,
        redactions=redactions,
    )
    node.steps.append(step)
    return step


@asynccontextmanager
async def trace_run(
    workflow_name: str, sink: Sink, *, origin: str = "recorded"
) -> AsyncIterator[RunContext]:
    """Start a run, make it the current one, and close it (status 'ok' or 'error') on exit.

    Yields the RunContext; `run.id` is the run id. `origin` is stamped on every step: the
    recorder uses 'recorded', and Phase 5's live suffix will pass 'live'.
    """
    run = RunContext(uuid4().hex, workflow_name, origin, sink)
    await sink.start_run(
        {
            "id": run.id,
            "workflow": workflow_name,
            "origin": origin,
            "started_at": datetime.now(UTC).isoformat(),
        }
    )
    token = current_run.set(run)
    status = "ok"
    try:
        yield run
    except BaseException:
        status = "error"
        raise
    finally:
        current_run.reset(token)
        await sink.finish_run(run.id, status)


def node(
    name: str, *, reads: Sequence[str] = (), writes: Sequence[str] = ()
) -> Callable[[Callable[..., Awaitable[dict[str, Any]]]], Callable[..., Awaitable[dict[str, Any]]]]:
    """Decorate `async def fn(state, llm, tools) -> dict of state updates` as one node.

    Each call is one node run: it gets the next `node_run_idx`, stamps the declared reads and
    writes on its steps, and attaches the redacted, fully merged `state_after` to its LAST step
    (the state a fork restores). A node that makes no LLM or tool call still gets one marker
    step so its state_after has somewhere to live.
    """

    def decorator(fn: Callable[..., Awaitable[dict[str, Any]]]):
        @functools.wraps(fn)
        async def wrapper(state: dict[str, Any], *args: Any, **kwargs: Any) -> dict[str, Any]:
            run = current_run.get()
            if run is None:
                return await fn(state, *args, **kwargs)

            ctx = NodeContext(name, tuple(reads), tuple(writes), run.next_node_run_idx())
            token = current_node.set(ctx)
            try:
                try:
                    updates = await fn(state, *args, **kwargs)
                    _check_updates(ctx, updates)
                    _attach_state_after(ctx, state, updates)
                finally:
                    # Flush even on failure, so a crashing node's steps are still debuggable.
                    if ctx.steps:
                        await run.sink.add_steps(run.id, [s.to_dict() for s in ctx.steps])
            finally:
                current_node.reset(token)
            return updates

        return wrapper

    return decorator


def _check_updates(ctx: NodeContext, updates: Any) -> None:
    if not isinstance(updates, dict):
        raise TypeError(f"node {ctx.name!r} must return a dict of state updates")
    undeclared = sorted(set(updates) - set(ctx.writes))
    if undeclared:
        raise UndeclaredWriteError(
            f"node {ctx.name!r} wrote {undeclared} but declares writes={list(ctx.writes)}"
        )


def _attach_state_after(ctx: NodeContext, state: dict[str, Any], updates: dict[str, Any]) -> None:
    if not ctx.steps:
        _record_step(
            kind="tool",
            agent=ctx.name,
            tool_name=NO_CALL_TOOL_NAME,
            tool_args={},
            tool_result=updates,
            side_effect=False,
        )
    last = ctx.steps[-1]
    last.state_after = _clean("state_after", {**state, **updates}, last.redactions)


def _usage(response: Any, name: str) -> int:
    usage = getattr(response, "usage", None)
    value = usage.get(name) if isinstance(usage, dict) else getattr(usage, name, None)
    return int(value or 0)


class TracedLLM:
    """Wraps an AsyncAnthropic-style client: `await llm.create(**kwargs)` forwards to
    `client.messages.create(**kwargs)` and records the call as one 'llm' step.

    The client is duck-typed (anything with `messages.create`), so the SDK needs no
    `anthropic` dependency and tests can pass a fake. Streaming is not supported.
    """

    def __init__(self, client: Any, agent_name: str) -> None:
        self._client = client
        self.agent_name = agent_name

    async def create(self, **kwargs: Any) -> Any:
        if current_run.get() is None:
            return await self._client.messages.create(**kwargs)
        _require_node()  # fail before spending tokens

        started = time.perf_counter()
        response = await self._client.messages.create(**kwargs)
        latency_ms = int((time.perf_counter() - started) * 1000)

        _record_step(
            kind="llm",
            agent=self.agent_name,
            model=kwargs.get("model"),
            params={k: v for k, v in kwargs.items() if k not in ("model", *_LLM_INPUT_KEYS)},
            input={k: kwargs[k] for k in _LLM_INPUT_KEYS if k in kwargs},
            output={
                "content": getattr(response, "content", None),
                "stop_reason": getattr(response, "stop_reason", None),
            },
            tokens_in=_usage(response, "input_tokens"),
            tokens_out=_usage(response, "output_tokens"),
            latency_ms=latency_ms,
        )
        return response


def tool(side_effect: bool) -> Callable[[Callable[..., Awaitable[Any]]], Callable[..., Awaitable[Any]]]:
    """Decorate an async tool function. Records its name, arguments and result as a 'tool' step.

    `side_effect` is required: Phase 5 refuses to run a side-effecting tool live in a fork
    unless a mock is registered. It is exposed as `.side_effect` on the wrapped function.
    """

    def decorator(fn: Callable[..., Awaitable[Any]]):
        if not inspect.iscoroutinefunction(fn):
            raise TypeError(f"@tool requires an async function, got {fn.__name__!r}")
        signature = inspect.signature(fn)

        @functools.wraps(fn)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            if current_run.get() is None:
                return await fn(*args, **kwargs)
            node = _require_node()

            started = time.perf_counter()
            result = await fn(*args, **kwargs)
            latency_ms = int((time.perf_counter() - started) * 1000)

            bound = signature.bind(*args, **kwargs)
            bound.apply_defaults()
            arguments = {k: v for k, v in bound.arguments.items() if k not in ("self", "cls")}
            _record_step(
                kind="tool",
                agent=node.name,
                tool_name=fn.__name__,
                tool_args=arguments,
                tool_result=result,
                side_effect=side_effect,
                latency_ms=latency_ms,
            )
            return result

        wrapper.side_effect = side_effect  # type: ignore[attr-defined]
        return wrapper

    return decorator
