"""Put the docs passages into Agent Memory (scope docs/agenttrace) so the assistant can find them by meaning too.

    cd api && .venv/bin/python scripts/seed_docs_memory.py --infer <setting from the probe>
    cd api && .venv/bin/python scripts/seed_docs_memory.py --forget          # remove them again

Run scripts/probe_docs_memory.py first and pass the `infer` setting that kept the text intact. Seeding forgets the
scope first, so running it twice does not duplicate anything. It writes about 40 small items to your Agent Memory
context. The assistant only uses them when ASSISTANT_DOCS_MEMORY is True in config.py."""

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.assistant.docs_memory import DOCS_SCOPE, passage_text  # noqa: E402
from app.assistant.retrieval import docs_index  # noqa: E402
from app.rca import memory  # noqa: E402


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--infer", default=None, help="the infer setting the probe showed keeps the text intact")
    ap.add_argument("--forget", action="store_true", help="only remove the docs scope")
    args = ap.parse_args()

    mem = memory.open_memory()
    if mem is None:
        sys.exit("Agent Memory is not configured (SPECTRON_* in .env)")
    try:
        try:
            gone = await mem.scopes.forget(DOCS_SCOPE)
            print(f"removed {gone.forgotten} existing items from {DOCS_SCOPE}")
        except Exception as exc:
            print(f"nothing to remove ({type(exc).__name__})")
        if args.forget:
            return
        await mem.scopes.register(DOCS_SCOPE, description="AgentTrace documentation passages")
        chunks = docs_index().chunks
        for i, chunk in enumerate(chunks, 1):
            await mem.remember(passage_text(chunk), infer=args.infer, scopes=[DOCS_SCOPE], labels=["kind=docs", f"source={chunk.source}"])
            print(f"\r{i}/{len(chunks)}", end="", flush=True)
        print(f"\nstored {len(chunks)} passages in {DOCS_SCOPE}")
    finally:
        await mem.close()


if __name__ == "__main__":
    asyncio.run(main())
