"""Merge several rankings of the same things into one.

Reciprocal rank fusion: each ranking gives an item 1 / (k + its place), and the places add up. It needs no
scores, so a keyword ranking (BM25 scores) and a meaning-based one (Agent Memory scores) can be merged
without making their numbers comparable. An item both rankings put high wins."""


def reciprocal_rank_fusion(rankings: list[list[str]], k: int = 60) -> list[str]:
    """The ids of all rankings, best first. Ties keep the order in which the ids first appeared."""
    scores: dict[str, float] = {}
    for ranking in rankings:
        seen: set[str] = set()
        for place, item in enumerate(ranking, start=1):
            if item in seen:
                continue  # a repeat within one ranking counts once, at its best place
            seen.add(item)
            scores[item] = scores.get(item, 0.0) + 1.0 / (k + place)
    order = {item: i for i, item in enumerate(scores)}
    return sorted(scores, key=lambda item: (-scores[item], order[item]))
