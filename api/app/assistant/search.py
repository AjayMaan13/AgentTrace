"""Find the passages of the docs for a question: BM25, optionally merged with Agent Memory's results by rank
fusion, optionally reordered by a small model. Which of the two extras run is decided in config.py, and both are
off until the evaluation shows they help."""

from dataclasses import dataclass
from typing import Any

from app import config
from app.assistant import docs_memory
from app.assistant.fusion import reciprocal_rank_fusion
from app.assistant.rerank import rerank
from app.assistant.retrieval import Chunk, docs_index


@dataclass
class Usage:
    """Model tokens spent inside a tool, so the question's total counts them."""

    tokens_in: int = 0
    tokens_out: int = 0

    def take(self) -> tuple[int, int]:
        used = (self.tokens_in, self.tokens_out)
        self.tokens_in = self.tokens_out = 0
        return used


async def search_passages(
    query: str, k: int = 4, *, client: Any = None, use_memory: bool | None = None, use_rerank: bool | None = None,
    usage: Usage | None = None,
) -> list[Chunk]:
    """The best `k` passages. `use_memory` and `use_rerank` default to the settings; reranking needs a client."""
    use_memory = config.ASSISTANT_DOCS_MEMORY if use_memory is None else use_memory
    use_rerank = (config.ASSISTANT_RERANK if use_rerank is None else use_rerank) and client is not None
    index = docs_index()
    pool = config.ASSISTANT_POOL

    candidates = [c for c, _ in index.search(query, pool)]
    if use_memory:
        remembered = await docs_memory.recall_docs(query, index.chunks, pool)
        by_id = {c.id: c for c in [*candidates, *remembered]}
        candidates = [by_id[i] for i in reciprocal_rank_fusion([[c.id for c in candidates], [c.id for c in remembered]])][:pool]
    if use_rerank:
        candidates, tokens_in, tokens_out = await rerank(query, candidates, client)
        if usage is not None:
            usage.tokens_in += tokens_in
            usage.tokens_out += tokens_out
    return candidates[:k]
