"""Compare ways of finding the docs passage that answers a question, on the questions in evals/assistant_docs_questions.json.

    cd api && .venv/bin/python scripts/assistant_eval.py                       # BM25 only: offline, free
    cd api && .venv/bin/python scripts/assistant_eval.py --live --arms bm25,memory,fused,bm25_rerank,fused_rerank

Arms: bm25; memory (Agent Memory alone, needs scripts/seed_docs_memory.py to have run); fused (BM25 and memory merged
by rank fusion); bm25_rerank and fused_rerank (the same, then reordered by Haiku). The memory arms read your Agent
Memory context; the rerank arms call Claude Haiku once per question (about 1,000 to 2,000 input tokens each).
Those arms run only with --live. Nothing is written. The score is for the search only: hit@1, hit@3 and MRR say
where the right passage ranks, not whether an answer written from it is right."""

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from anthropic import AsyncAnthropic  # noqa: E402

from app.assistant import docs_memory  # noqa: E402
from app.assistant.evaluation import first_hit_rank, load_questions, summarize  # noqa: E402
from app.assistant.retrieval import docs_index  # noqa: E402
from app.assistant.search import search_passages  # noqa: E402

ARMS = ("bm25", "memory", "fused", "bm25_rerank", "fused_rerank")
LIVE_ARMS = set(ARMS) - {"bm25"}
POOL = 10


async def ranked_ids(arm: str, question: str, client: AsyncAnthropic | None) -> list[str]:
    index = docs_index()
    if arm == "bm25":
        return [c.id for c, _ in index.search(question, POOL)]
    if arm == "memory":
        return [c.id for c in await docs_memory.recall_docs(question, index.chunks, POOL)]
    use_memory = arm.startswith("fused")
    use_rerank = arm.endswith("rerank")
    chunks = await search_passages(question, POOL, client=client, use_memory=use_memory, use_rerank=use_rerank)
    return [c.id for c in chunks]


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--arms", default="bm25", help=f"comma-separated, from {', '.join(ARMS)}")
    ap.add_argument("--live", action="store_true", help="allow the arms that read Agent Memory or call Claude")
    args = ap.parse_args()
    arms = [a.strip() for a in args.arms.split(",") if a.strip()]
    unknown = [a for a in arms if a not in ARMS]
    if unknown:
        sys.exit(f"unknown arm(s): {unknown}")
    if LIVE_ARMS & set(arms) and not args.live:
        sys.exit(f"{sorted(LIVE_ARMS & set(arms))} read Agent Memory or call Claude; add --live to run them")

    questions = load_questions()
    client = AsyncAnthropic(max_retries=5) if any(a.endswith("rerank") for a in arms) else None
    print(f"{len(questions)} questions, {len(docs_index().chunks)} passages\n")
    print("| arm | hit@1 | hit@3 | MRR |\n|---|---|---|---|")
    misses: dict[str, list[str]] = {}
    for arm in arms:
        ranks = []
        for q in questions:
            rank = first_hit_rank(await ranked_ids(arm, q.text, client), q.expected)
            ranks.append(rank)
            if rank is None or rank > 3:
                misses.setdefault(arm, []).append(f"{q.text}  (rank {rank})")
        s = summarize(ranks)
        print(f"| {arm} | {s['hit_at_1']}/{s['n']} | {s['hit_at_3']}/{s['n']} | {s['mrr']} |")
    for arm, items in misses.items():
        print(f"\n{arm}: not in the top 3")
        for item in items:
            print(f"  - {item}")


if __name__ == "__main__":
    asyncio.run(main())
