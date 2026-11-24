"""Ask the assistant one question with the real model and show the answer, its citations and what it cost.

    cd api && .venv/bin/python scripts/assistant_smoke.py "How do I get an alert when a run fails?"
    cd api && .venv/bin/python scripts/assistant_smoke.py --stream "How do I get an alert when a run fails?"   # show the events as they arrive
    cd api && .venv/bin/python scripts/assistant_smoke.py --run <run id> "What went wrong in this run?"

Needs ANTHROPIC_API_KEY (one question is a few small Haiku calls). With --run it reads that run from the dev
workspace in SurrealDB, so it also needs the SURREAL_* settings. Nothing is stored; the question is not logged.
"""

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from anthropic import AsyncAnthropic  # noqa: E402

from app.assistant import service  # noqa: E402
from app.config import get_settings  # noqa: E402


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("question")
    ap.add_argument("--run", default=None, help="a run id in the dev workspace")
    ap.add_argument("--stream", action="store_true", help="use the streaming path and show each event")
    args = ap.parse_args()

    workspace = get_settings().dev_workspace_id or "dev"
    client = AsyncAnthropic(max_retries=5)
    try:
        await run(args, workspace, client)
    except service.AssistantError as exc:
        cause = exc.__cause__
        sys.exit(f"{exc}\n  cause: {type(cause).__name__}, status {getattr(cause, 'status_code', None)}")


async def run(args: argparse.Namespace, workspace: str, client: AsyncAnthropic) -> None:
    if args.stream:
        result, previewed = {}, 0
        async for kind, data in service.ask_events(workspace, args.question, args.run, client, stream=True):
            if kind == "text":
                previewed += 1
                print(data["delta"], end="", flush=True)
            elif kind == "status":
                print(f"\n[status] {data['message']}")
            else:
                result = data
        print(f"\n[{previewed} text pieces streamed]")
    else:
        result = await service.ask(workspace, args.question, args.run, client)

    print(f"model {result['model']}; {result['tool_calls']} tool calls; {result['tokens_in']} tokens in, {result['tokens_out']} out")
    print("REJECTED (no checked sources):" if result["rejected"] else "ANSWER:")
    print(result["answer"])
    for c in result["citations"]:
        print(f"  [{'ok' if c['ok'] else 'NOT RETURNED'}] {c['ref']}  ({c['label']})")


if __name__ == "__main__":
    asyncio.run(main())
