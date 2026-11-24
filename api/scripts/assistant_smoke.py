"""Ask the assistant one question with the real model and show the answer, its citations and what it cost.

    cd api && .venv/bin/python scripts/assistant_smoke.py "How do I get an alert when a run fails?"
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
    args = ap.parse_args()

    workspace = get_settings().dev_workspace_id or "dev"
    result = await service.ask(workspace, args.question, args.run, AsyncAnthropic(max_retries=5))

    print(f"model {result['model']}; {result['tool_calls']} tool calls; {result['tokens_in']} tokens in, {result['tokens_out']} out")
    print("REJECTED (no checked sources):" if result["rejected"] else "ANSWER:")
    print(result["answer"])
    for c in result["citations"]:
        print(f"  [{'ok' if c['ok'] else 'NOT RETURNED'}] {c['ref']}  ({c['label']})")


if __name__ == "__main__":
    asyncio.run(main())
