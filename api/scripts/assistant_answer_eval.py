"""Ask the assistant 30 questions with the real model and check each answer with code.

    cd api && .venv/bin/python scripts/assistant_answer_eval.py --list                      # the questions, free
    cd api && .venv/bin/python scripts/assistant_answer_eval.py --live                      # run all 30 on Claude Haiku
    cd api && .venv/bin/python scripts/assistant_answer_eval.py --live --only runs          # only the 10 run questions
    cd api && .venv/bin/python scripts/assistant_answer_eval.py --live --record             # also record every question as a run

20 questions are about the docs (the answer must cite a passage that answers it). 10 are about a made-up workspace of six runs
that is built in memory, so nothing is read from or written to your database and the right answers are known exactly (see
app/assistant/answer_eval.py for what each check looks for). One question is about 2 to 3 model calls and roughly 10,000 input
tokens, so all 30 are about 300,000 tokens in: a few cents at Haiku prices (an estimate; check the real numbers it prints).

--record sends each question to AgentTrace as a run (retriever turn, answerer turn, verdict from the check) using
AGENTTRACE_API_URL and AGENTTRACE_INGEST_KEY from .env, so you can open them on the Runs page. Without it they stay in memory.
Needs ANTHROPIC_API_KEY. The questions are never logged anywhere else."""

import argparse
import asyncio
import os
import sys
from pathlib import Path

API = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API))
sys.path.insert(0, str(API / "tests"))  # the in-memory store the tests use

from agenttrace_sdk import HttpSink, ListSink  # noqa: E402
from anthropic import AsyncAnthropic  # noqa: E402
from fakes import DB_FUNCTIONS, FakeDB  # noqa: E402

from app import db  # noqa: E402
from app.assistant import service  # noqa: E402
from app.assistant.answer_eval import WS, build_cases, evaluate, seed_scenario  # noqa: E402
from app.rca import memory  # noqa: E402

PER_MTOK_IN, PER_MTOK_OUT = 0.10, 0.50  # Claude Haiku 5.5 list prices, dollars per million tokens (check the current page)


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true", help="print the questions and stop")
    ap.add_argument("--live", action="store_true", help="call Claude (spends tokens)")
    ap.add_argument("--only", choices=["docs", "runs"], default=None)
    ap.add_argument("--limit", type=int, default=None, help="ask only the first N of the chosen questions")
    ap.add_argument("--record", action="store_true", help="record every question as a run in AgentTrace")
    args = ap.parse_args()

    cases = [c for c in build_cases() if args.only in (None, c.kind)][: args.limit]
    if args.list:
        for c in cases:
            print(f"[{c.kind}] {c.question}" + ("  (viewing a run)" if c.viewing else ""))
        return
    if not args.live:
        sys.exit("this calls Claude and spends tokens; add --live (or --list to only see the questions)")

    sink = ListSink()
    if args.record:
        url, key = os.environ.get("AGENTTRACE_API_URL"), os.environ.get("AGENTTRACE_INGEST_KEY")
        if not (url and key):
            sys.exit("--record needs AGENTTRACE_API_URL and AGENTTRACE_INGEST_KEY in .env")
        sink = HttpSink(url, key)

    fake = FakeDB()
    seed_scenario(fake)
    for name in DB_FUNCTIONS:
        setattr(db, name, getattr(fake, name))
    memory._open = lambda: None  # no Agent Memory: similar_causes finds nothing, and nothing is written there

    client = AsyncAnthropic(max_retries=5)

    async def ask(workspace, question, viewing, *, trace):
        return await service.ask(workspace, question, viewing, client, trace=trace)

    print(f"asking {len(cases)} questions on {service.ASSISTANT_MODEL}...\n")
    rows = await evaluate(cases, ask, sink, workspace=WS)
    for row in rows:
        print(f"{'PASS' if row.passed else 'FAIL'}  [{row.case.kind}] {row.case.question}" + ("" if row.passed else f"\n      {row.reason}"))

    print()
    for kind in ("docs", "runs"):
        kind_rows = [r for r in rows if r.case.kind == kind]
        if kind_rows:
            print(f"{kind}: {sum(r.passed for r in kind_rows)}/{len(kind_rows)} answers held what the check looks for")
    tin, tout = sum(r.tokens_in for r in rows), sum(r.tokens_out for r in rows)
    print(f"tokens: {tin:,} in, {tout:,} out, about ${tin / 1e6 * PER_MTOK_IN + tout / 1e6 * PER_MTOK_OUT:.3f} at list prices")
    if args.record:
        print(f"recorded {len(rows)} runs in AgentTrace (workflow ask-agenttrace-eval)")


if __name__ == "__main__":
    asyncio.run(main())
