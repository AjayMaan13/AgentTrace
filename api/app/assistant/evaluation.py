"""Score a docs search: for each question, where does a passage that answers it rank?

A question lists the passages that answer it as id prefixes (`docs/integrations.md#4-fork-...` also matches the
second half of that section, which is cut into `...-2`). Rank 1 is the top result. The score of a search over many
questions is hit@1, hit@3 (the share of questions with an answering passage in the first 1 or 3) and MRR (the mean of
1 / rank, 0 for a miss). These measure the search only, not whether an answer written from the passages is right."""

import json
from dataclasses import dataclass
from pathlib import Path

QUESTIONS_FILE = Path(__file__).resolve().parents[2] / "evals" / "assistant_docs_questions.json"


@dataclass(frozen=True)
class Question:
    text: str
    expected: tuple[str, ...]


def load_questions(path: Path = QUESTIONS_FILE) -> list[Question]:
    return [Question(item["q"], tuple(item["expected"])) for item in json.loads(path.read_text(encoding="utf-8"))]


def first_hit_rank(ranked_ids: list[str], expected: tuple[str, ...]) -> int | None:
    """The 1-based place of the first result that answers the question, or None."""
    for place, result in enumerate(ranked_ids, start=1):
        if any(result.startswith(prefix) for prefix in expected):
            return place
    return None


def summarize(ranks: list[int | None]) -> dict[str, float | int]:
    n = len(ranks)
    return {
        "n": n,
        "hit_at_1": sum(1 for r in ranks if r is not None and r <= 1),
        "hit_at_3": sum(1 for r in ranks if r is not None and r <= 3),
        "mrr": round(sum(1 / r for r in ranks if r) / n, 3) if n else 0.0,
    }
