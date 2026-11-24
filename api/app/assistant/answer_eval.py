"""An evaluation of whole answers, checked by code, not by a model.

Docs questions (the file in evals/): the answer must be shown and cite a passage that answers the question. Run
questions: a small made-up workspace of six runs is built in memory, so the right answer to each question is known
exactly, and the answer must be shown, cite a run, and contain what the data says (and not what it does not).
That is a check on words in the answer, so it can be fooled by an answer that mentions the right word for the wrong
reason, and it cannot tell whether an explanation is good. It says whether the answer holds the fact.

`seed_scenario` takes any store with `runs` and `steps` dicts (the tests' in-memory store); nothing here touches
a real database. Running it against Claude is scripts/assistant_answer_eval.py."""

import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from agenttrace_sdk.sinks import Sink

from app.assistant import tracing
from app.assistant.evaluation import load_questions

WS = "eval-ws"
Check = Callable[[dict[str, Any]], tuple[bool, str]]


@dataclass(frozen=True)
class Case:
    kind: str  # "docs" | "runs"
    question: str
    viewing: str | None  # the run the user is "looking at", if any
    check: Check


@dataclass
class Row:
    case: Case
    passed: bool
    reason: str
    tokens_in: int
    tokens_out: int
    run_id: str


RUNS = {  # id -> (workflow, outcome, started_at)
    "1": ("renewal_brief", "fail", "2026-11-01T10:00:00+00:00"),
    "2": ("renewal_brief", "pass", "2026-11-01T10:05:00+00:00"),
    "3": ("renewal_brief", "fail", "2026-11-01T10:10:00+00:00"),
    "4": ("support_triage", "error", "2026-11-01T10:15:00+00:00"),
    "5": ("support_triage", "pass", "2026-11-01T10:20:00+00:00"),
    "6": ("support_triage", "fail", "2026-11-01T10:25:00+00:00"),
}


def rid(n: str) -> str:
    return n * 32


def _step(idx: int, node: int, agent: str, *, kind: str = "llm", output: Any = None, input: Any = "go", tool: str | None = None,
          args: dict[str, Any] | None = None, result: Any = None, writes: list[str] | None = None) -> dict[str, Any]:
    return {"idx": idx, "node_run_idx": node, "agent": agent, "kind": kind, "origin": "recorded", "input": input, "output": output,
            "tool_name": tool, "tool_args": args, "tool_result": result, "writes": writes or [], "state_after": {}}


STEPS: dict[str, list[dict[str, Any]]] = {
    "1": [
        _step(1, 1, "planner", output={"ticket_filter": {"status": ["solved"]}}, writes=["plan"]),
        _step(2, 2, "researcher", kind="tool", tool="ticket_summary", args={"account_id": "acct-1"}, result={"open_tickets": 0}, input=None),
        _step(3, 2, "researcher", output="No open tickets were found."),
        _step(4, 3, "writer", output="Zero open tickets, risk low.", writes=["draft"]),
        _step(5, 4, "critic", output="APPROVE"),
    ],
    "2": [_step(1, 1, "planner", output="plan"), _step(2, 2, "researcher", output="facts"), _step(3, 3, "writer", output="brief")],
    "3": [_step(1, 1, "planner", output="plan"), _step(2, 2, "writer", output="a wrong brief"), _step(3, 3, "critic", output="APPROVE")],
    "4": [_step(1, 1, "triager", output="crashed before it answered")],
    "5": [_step(1, 1, "triager", output="route to billing")],
    "6": [_step(1, 1, "triager", output="route to the wrong queue")],
}


def seed_scenario(store: Any, ws: str = WS) -> None:
    """Six runs in two workflows: four of them failed or crashed (1, 3, 4 and 6)."""
    for n, (workflow, outcome, started) in RUNS.items():
        store.runs[rid(n)] = {"id": rid(n), "workspace": ws, "workflow": workflow, "started_at": started, "status": "ok", "kind": "recorded",
                              "outcome": outcome, "oracle_detail": {"verdict": {"kind": "code", "passed": outcome == "pass"}}}
        for step in STEPS[n]:
            store.steps[(rid(n), step["idx"])] = step


def _cites(state: dict[str, Any], kind: str) -> bool:
    return any(ref.startswith(f"{kind}:") for ref in state["cited"])


def _shown(state: dict[str, Any]) -> tuple[bool, str] | None:
    return (False, "the answer was not shown (its sources could not be checked)") if state["rejected"] else None


def docs_check(expected: tuple[str, ...]) -> Check:
    def check(state: dict[str, Any]) -> tuple[bool, str]:
        if (bad := _shown(state)) is not None:
            return bad
        doc_ids = [ref.removeprefix("doc:") for ref in state["cited"] if ref.startswith("doc:")]
        if any(i.startswith(p) for i in doc_ids for p in expected):
            return True, "cited a passage that answers it"
        return False, f"cited {doc_ids or 'no passage'}, none of which answers it"
    return check


def runs_check(*, has: tuple[str, ...] = (), lacks: tuple[str, ...] = (), pattern: str | None = None) -> Check:
    def check(state: dict[str, Any]) -> tuple[bool, str]:
        if (bad := _shown(state)) is not None:
            return bad
        if not _cites(state, "run"):
            return False, "cited no run"
        answer = state["answer"].lower()
        for word in has:
            if word.lower() not in answer:
                return False, f"the answer does not mention {word!r}"
        for word in lacks:
            if word.lower() in answer:
                return False, f"the answer mentions {word!r}, which the data does not support"
        if pattern is not None and not re.search(pattern, answer):
            return False, f"the answer does not match /{pattern}/"
        return True, "the answer holds what the data says"
    return check


def build_cases() -> list[Case]:
    short = lambda n: rid(n)[:8]  # noqa: E731 (the id as an answer is likely to write it)
    runs = [
        Case("runs", "How many of my runs failed or crashed?", None, runs_check(pattern=r"\b4\b|\bfour\b")),
        Case("runs", "Which workflows have runs that failed?", None, runs_check(has=("renewal_brief", "support_triage"))),
        Case("runs", "Which agent decided the ticket status filter in this run?", rid("1"), runs_check(has=("planner",))),
        Case("runs", "What did the writer say in this run?", rid("1"), runs_check(has=("zero open tickets",))),
        Case("runs", "Which tool did the researcher call in this run?", rid("1"), runs_check(has=("ticket_summary",))),
        Case("runs", "Which agent ran last in this run?", rid("3"), runs_check(has=("critic",))),
        Case("runs", "Which run crashed?", None, runs_check(has=(short("4"),))),
        Case("runs", "List the runs of the support_triage workflow that failed or crashed.", None, runs_check(has=(short("4"), short("6")), lacks=(short("5"),))),
        Case("runs", "How many steps does this run have?", rid("2"), runs_check(pattern=r"\b3\b|\bthree\b")),
        Case("runs", "Do any other runs share this run's workflow?", rid("1"), runs_check(has=(short("2"), short("3")), lacks=(short("4"),))),
    ]
    docs = [Case("docs", q.text, None, docs_check(q.expected)) for q in load_questions()]
    return docs + runs


AskFn = Callable[..., Awaitable[dict[str, Any]]]


async def evaluate(cases: list[Case], ask: AskFn, sink: Sink, *, workspace: str = WS) -> list[Row]:
    """Ask every case, check the answer with its code check and record each as a run. `ask(workspace, question, run_id, trace=...)`
    is the assistant (the tests pass one with a scripted model)."""
    rows = []
    for case in cases:
        trace: list[dict[str, Any]] = []
        result = await ask(workspace, case.question, case.viewing, trace=trace)
        state = tracing.build_state(case.question, case.viewing, result, trace)
        passed, reason = case.check(state)
        run_id = await tracing.record_question(sink, state, trace, result, case.check)
        rows.append(Row(case, passed, reason, result["tokens_in"], result["tokens_out"], run_id))
    return rows
