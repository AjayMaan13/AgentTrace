"""Find the passages of the docs that answer a question: split the Markdown files by heading and rank the
passages with BM25 (term frequency, rarity of the term across passages, length of the passage).

Nothing here calls a model or a service, and there is no extra dependency. The docs are the public ones
in the repository, so every workspace may search them; run data is never put in this index."""

import logging
import math
import re
from collections import Counter
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from app.config import REPO_ROOT

log = logging.getLogger(__name__)

DOC_FILES = ("README.md", "docs/integrations.md", "docs/self-host.md", "SECURITY.md")
MAX_CHUNK_CHARS = 1800
MIN_CHUNK_CHARS = 40

_HEADING = re.compile(r"^(#{1,3})\s+(.+?)\s*$")
_FENCE = re.compile(r"^\s*```")
_WORD = re.compile(r"[a-z0-9]+")
_STOP = frozenset(
    "a an and are as at be but by can do does for from how i if in into is it its of on or so than that the "
    "their then there these they this to was we what when where which who why will with you your".split()
)


@dataclass(frozen=True)
class Chunk:
    id: str  # "<file>#<heading slug>": what an answer cites
    source: str
    heading: str
    text: str


def _slug(heading: str) -> str:
    return "-".join(_WORD.findall(heading.lower())) or "section"


def chunk_markdown(source: str, text: str) -> list[Chunk]:
    """One chunk per heading section (a `#` inside a code fence is not a heading). A long section is cut at
    paragraph breaks. The file's own title is the first heading, so the intro before the first `##` is a chunk too."""
    sections: list[tuple[str, list[str]]] = [("", [])]
    in_fence = False
    for line in text.splitlines():
        if _FENCE.match(line):
            in_fence = not in_fence
        match = None if in_fence else _HEADING.match(line)
        if match:
            sections.append((match.group(2), []))
        else:
            sections[-1][1].append(line)

    chunks: list[Chunk] = []
    seen: Counter[str] = Counter()
    for heading, lines in sections:
        body = "\n".join(lines).strip()
        if len(body) < MIN_CHUNK_CHARS:
            continue
        for part in _split(body):
            base = f"{source}#{_slug(heading)}"
            seen[base] += 1
            chunk_id = base if seen[base] == 1 else f"{base}-{seen[base]}"
            chunks.append(Chunk(chunk_id, source, heading or source, part))
    return chunks


def _split(body: str) -> list[str]:
    """Cut at blank lines; a block longer than the limit with none (a long list) is cut at line breaks."""
    if len(body) <= MAX_CHUNK_CHARS:
        return [body]
    pieces: list[tuple[str, str]] = []  # (text, what came before it in the original)
    for paragraph in re.split(r"\n\s*\n", body):
        lines = paragraph.split("\n") if len(paragraph) > MAX_CHUNK_CHARS else [paragraph]
        pieces += [(line, "\n" if i else "\n\n") for i, line in enumerate(lines)]
    parts, current = [], ""
    for text, sep in pieces:
        if current and len(current) + len(sep) + len(text) > MAX_CHUNK_CHARS:
            parts.append(current)
            current = ""
        current = f"{current}{sep}{text}" if current else text
    if current:
        parts.append(current)
    return parts


def tokenize(text: str) -> list[str]:
    """Lowercase words, a trailing plural `s` dropped, common words removed."""
    words = (w[:-1] if len(w) > 3 and w.endswith("s") and not w.endswith("ss") else w for w in _WORD.findall(text.lower()))
    return [w for w in words if w not in _STOP]


class Bm25Index:
    """Okapi BM25 over a fixed list of chunks. A heading counts three times, because a question usually
    names the thing a section is about."""

    def __init__(self, chunks: list[Chunk], k1: float = 1.5, b: float = 0.75) -> None:
        self.chunks, self.k1, self.b = chunks, k1, b
        self._tf = [Counter(tokenize(f"{(c.heading + ' ') * 3}{c.text}")) for c in chunks]
        self._len = [sum(tf.values()) for tf in self._tf]
        self._avg = (sum(self._len) / len(chunks)) if chunks else 0.0
        df: Counter[str] = Counter()
        for tf in self._tf:
            df.update(tf.keys())
        n = len(chunks)
        self._idf = {t: math.log(1 + (n - d + 0.5) / (d + 0.5)) for t, d in df.items()}

    def search(self, query: str, k: int = 4) -> list[tuple[Chunk, float]]:
        """The best `k` chunks for the query, best first. A chunk with no query word in it is never returned."""
        terms = set(tokenize(query))
        scored: list[tuple[Chunk, float]] = []
        for chunk, tf, length in zip(self.chunks, self._tf, self._len, strict=True):
            score = 0.0
            for term in terms:
                freq = tf.get(term, 0)
                if freq:
                    norm = freq + self.k1 * (1 - self.b + self.b * length / (self._avg or 1))
                    score += self._idf[term] * freq * (self.k1 + 1) / norm
            if score > 0:
                scored.append((chunk, score))
        return sorted(scored, key=lambda pair: -pair[1])[:k]


def load_chunks(root: Path = REPO_ROOT, files: tuple[str, ...] = DOC_FILES) -> list[Chunk]:
    """The chunks of every doc file that exists under `root`. A missing file is skipped and logged, so a
    deployment without the docs still starts (the assistant then says it has no documentation)."""
    chunks: list[Chunk] = []
    for name in files:
        path = root / name
        if not path.is_file():
            log.warning("assistant docs: %s not found", name)
            continue
        chunks += chunk_markdown(name, path.read_text(encoding="utf-8"))
    return chunks


@lru_cache(maxsize=1)
def docs_index() -> Bm25Index:
    return Bm25Index(load_chunks())
