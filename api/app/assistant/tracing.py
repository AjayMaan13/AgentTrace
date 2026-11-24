"""Record one assistant question as a run in AgentTrace itself, through the same SDK a customer uses.

Two turns: the retriever (the tool calls and the sources they returned) and the answerer (the answer, which sources it
cited, the tokens). A code check gives the run its verdict, so a wrong answer shows up on the Runs page as a wrong
run. This is for evaluation runs only: live questions from users are never recorded, because that would store what
people asked. Whoever calls it chooses the sink (an HttpSink with an ingest key sends it to a real workspace)."""

from typing import Any

from agenttrace_sdk import RunRecorder
from agenttrace_sdk.oracle import Check
from agenttrace_sdk.sinks import Sink

WORKFLOW = "ask-agenttrace-eval"


def build_state(question: str, viewing: str | None, result: dict[str, Any], trace: list[dict[str, Any]]) -> dict[str, Any]:
    """What the check reads: the question, the sources the tools returned, and the answer with what it cited."""
    return {
        "question": question,
        "viewing_run": viewing,
        "sources": sorted({ref for call in trace for ref in call["sources"]}),
        "answer": result["answer"],
        "cited": [c["ref"] for c in result["citations"] if c["ok"]],
        "rejected": result["rejected"],
    }


async def record_question(sink: Sink, state: dict[str, Any], trace: list[dict[str, Any]], result: dict[str, Any], check: Check) -> str:
    """Send the question as a run and return its id. The run's verdict is `check(state)`."""
    calls = [
        {"name": c["name"], "args": c["args"] if isinstance(c["args"], dict) else {}, "result": {"sources": c["sources"], "error": c["is_error"]}}
        for c in trace
    ]
    async with RunRecorder(sink, WORKFLOW, oracle=check) as rec:
        await rec.turn(
            "retriever", input={"question": state["question"], "viewing_run": state["viewing_run"]}, tool_calls=calls,
            state_after={"question": state["question"], "sources": state["sources"]}, writes=["sources"],
        )
        await rec.turn(
            "answerer", input={"question": state["question"], "sources": state["sources"]}, output=state["answer"], model=result["model"],
            state_after=state, reads=["question", "sources"], writes=["answer", "cited", "rejected"],
            tokens_in=result["tokens_in"], tokens_out=result["tokens_out"],
        )
        rec.final_state = state
    return rec.id
