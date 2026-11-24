"""The docs in Agent Memory, as a second way to find a passage (it matches on meaning as well as words).

One memory item per passage, in its own scope, apart from the workspaces' failure patterns (which are read only
through their own scopes). The text of an item ends with `[docs-chunk <id>]`, because a recall hit holds only
an id, a score, a source and a text, so the passage it came from has to be named in the text.

Everything is best effort, like the rest of the memory code: not configured, not seeded or down means no
results, and the search carries on with BM25 alone. Seeding is scripts/seed_docs_memory.py."""

import logging
import re

from app.assistant.retrieval import Chunk
from app.rca import memory

log = logging.getLogger(__name__)

DOCS_SCOPE = "docs/agenttrace"
_MARK = re.compile(r"\[docs-chunk ([^\]\s]+)\]")


def passage_text(chunk: Chunk) -> str:
    return f"{chunk.heading} ({chunk.source}). {chunk.text}\n[docs-chunk {chunk.id}]"


async def recall_docs(query: str, chunks: list[Chunk], k: int = 10) -> list[Chunk]:
    """The passages Agent Memory finds for the query, best first. `chunks` is the index, so a hit can be mapped
    back to a passage (hits that name no known passage, such as extracted entities, are skipped)."""
    mem = memory.open_memory()
    if mem is None:
        return []
    by_id = {c.id: c for c in chunks}
    try:
        response = await mem.recall(query, k=k * 2, mode="hybrid", lens=[DOCS_SCOPE])
        found: dict[str, Chunk] = {}
        for hit in response.hits:
            mark = _MARK.search(hit.text)
            if mark and mark.group(1) in by_id and mark.group(1) not in found:
                found[mark.group(1)] = by_id[mark.group(1)]
        return list(found.values())[:k]
    except Exception as exc:
        log.warning("docs memory recall failed: %s", type(exc).__name__)
        return []
    finally:
        await mem.close()
