"""Probe: can docs passages be stored in Agent Memory and found again with their text intact?

    cd api && .venv/bin/python scripts/probe_docs_memory.py

Per CLAUDE.md, an uncertain external shape gets a probe, not a guess. This asks four things: which `infer`
settings `remember` accepts, whether the stored text (with its `[docs-chunk <id>]` mark) comes back from a hybrid recall,
whether a recall limited to the scope sees only these items, and what a hit looks like. It writes two passages to a
throwaway scope (`docs/probe-<random>`) in the Agent Memory context from .env, then forgets that scope. It prints
shapes and short excerpts only, never keys. Needs SPECTRON_ENDPOINT, SPECTRON_CONTEXT and SPECTRON_API_KEY."""

import asyncio
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.assistant.docs_memory import _MARK, passage_text  # noqa: E402
from app.assistant.retrieval import docs_index  # noqa: E402
from app.rca import memory  # noqa: E402

CANDIDATE_INFER = [None, "none", "full"]
SAMPLE_IDS = ("docs/integrations.md#6-failure-alerts-slack-or-any-address", "docs/self-host.md#not-covered")
QUERIES = ["how do I get alerts when a run fails", "what does self hosting not cover"]


async def main() -> None:
    mem = memory.open_memory()
    if mem is None:
        sys.exit("Agent Memory is not configured (SPECTRON_* in .env)")
    by_id = {c.id: c for c in docs_index().chunks}
    chunks = [by_id[i] for i in SAMPLE_IDS]
    scope = f"docs/probe-{uuid.uuid4().hex[:8]}"
    print(f"throwaway scope: {scope}")
    try:
        await mem.scopes.register(scope, description="AgentTrace docs probe (deleted at the end)")
        for infer in CANDIDATE_INFER:
            for chunk in chunks:
                try:
                    res = await mem.remember(passage_text(chunk), infer=infer, scopes=[scope], labels=["kind=docs-probe", f"chunk={chunk.id}"])
                    print(f"remember infer={infer!r:7} {chunk.id[:40]:40} ok  mode={getattr(res, 'mode', '?')} chunk_id={getattr(res, 'chunk_id', None)}")
                except Exception as exc:
                    print(f"remember infer={infer!r:7} {chunk.id[:40]:40} FAILED {type(exc).__name__}: {str(exc)[:120]}")
        for query in QUERIES:
            response = await mem.recall(query, k=8, mode="hybrid", lens=[scope])
            print(f"\nrecall {query!r}: {len(response.hits)} hits, tier={response.tier!r}")
            for hit in response.hits:
                mark = _MARK.search(hit.text)
                print(f"  score={hit.score:.3f} source={hit.source!r} mark={'yes ' + mark.group(1)[:34] if mark else 'NO'} text={hit.text[:70]!r}")
    finally:
        gone = await mem.scopes.forget(scope)
        print(f"\nforgot scope {scope}: {gone.forgotten} items removed")
        await mem.close()


if __name__ == "__main__":
    asyncio.run(main())
