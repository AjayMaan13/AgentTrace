"""Ask AgentTrace, day 2: rank fusion, reranking, the docs in Agent Memory, the search that combines them, and the
scores that compare them. Offline: a scripted model and a stand-in for Agent Memory. The live comparison is
scripts/assistant_eval.py, and the check that the real Agent Memory behaves as assumed is scripts/probe_docs_memory.py."""

import asyncio
from types import SimpleNamespace

import httpx
import pytest
from anthropic import APIConnectionError

from app import config
from app.assistant import docs_memory, service
from app.assistant.docs_memory import DOCS_SCOPE, passage_text
from app.assistant.evaluation import first_hit_rank, load_questions, summarize
from app.assistant.fusion import reciprocal_rank_fusion
from app.assistant.rerank import CLIP, SYSTEM, TOOL, rerank
from app.assistant.retrieval import Chunk, docs_index
from app.assistant.search import Usage, search_passages
from app.assistant.tools import execute
from app.rca import memory
from test_assistant import WS_A, FakeModel, text, use


def run(coro):
    return asyncio.run(coro)


def chunk(n: int, body: str = "some passage text that is long enough") -> Chunk:
    return Chunk(f"f.md#s{n}", "f.md", f"Section {n}", body)


# --- rank fusion ----------------------------------------------------------------------------------

def test_fusion_puts_what_both_rankings_like_first():
    assert reciprocal_rank_fusion([["a", "b", "c"], ["b", "c", "a"]]) == ["b", "a", "c"]


def test_fusion_of_one_ranking_keeps_its_order_and_of_none_is_empty():
    assert reciprocal_rank_fusion([["x", "y", "z"]]) == ["x", "y", "z"]
    assert reciprocal_rank_fusion([]) == [] and reciprocal_rank_fusion([[], []]) == []


def test_fusion_counts_a_repeat_within_one_ranking_once_and_breaks_ties_by_first_appearance():
    assert reciprocal_rank_fusion([["a", "a", "a"], ["b"]]) == ["a", "b"]  # a: 1/61 once, b: 1/61: a appeared first
    assert reciprocal_rank_fusion([["a", "b"], ["b", "a"]]) == ["a", "b"]


# --- reranking ------------------------------------------------------------------------------------

CHUNKS = [chunk(1), chunk(2), chunk(3)]


def reranked(model, chunks=CHUNKS, query="a question"):
    result, tokens_in, tokens_out = run(rerank(query, chunks, model))
    return [c.id for c in result], tokens_in, tokens_out


def test_the_model_can_reorder_the_passages_and_the_ones_it_leaves_out_follow():
    model = FakeModel([use("order_passages", {"order": [3, 1]})])
    assert reranked(model) == (["f.md#s3", "f.md#s1", "f.md#s2"], 100, 20)
    call = model.calls[0]
    assert call["tools"] == [TOOL] and call["tool_choice"]["name"] == "order_passages"
    assert "DATA" in SYSTEM and "<passage n=\"3\"" in call["messages"][0]["content"] and "a question" in call["messages"][0]["content"]


def test_a_repeated_number_counts_once():
    assert reranked(FakeModel([use("order_passages", {"order": [2, 2, 3]})]))[0] == ["f.md#s2", "f.md#s3", "f.md#s1"]


@pytest.mark.parametrize("order", [[0], [4], ["1"], [True], [1.5], [-1], "3,1,2", None, {}, 7])
def test_an_unusable_order_leaves_the_passages_as_they_were(order):
    ids, tokens_in, _ = reranked(FakeModel([use("order_passages", {"order": order})]))
    assert ids == ["f.md#s1", "f.md#s2", "f.md#s3"] and tokens_in == 100  # the tokens were still spent


def test_no_tool_call_or_an_outage_leaves_the_passages_as_they_were():
    assert reranked(FakeModel([text("I think 3 then 1")]))[0] == ["f.md#s1", "f.md#s2", "f.md#s3"]

    async def down(**_):
        raise APIConnectionError(request=httpx.Request("POST", "https://api.anthropic.com/v1/messages"))

    model = FakeModel([use("order_passages", {"order": [3]})])
    model.messages.create = down
    assert reranked(model) == (["f.md#s1", "f.md#s2", "f.md#s3"], 0, 0)


def test_one_passage_or_none_needs_no_model_call():
    model = FakeModel([use("order_passages", {"order": [1]})])
    assert reranked(model, [chunk(1)])[0] == ["f.md#s1"] and reranked(model, [])[0] == [] and model.calls == []


def test_the_model_reads_only_the_start_of_each_passage():
    reranked(model := FakeModel([use("order_passages", {"order": [1]})]), [chunk(1, "x" * 5000), chunk(2)])
    assert "x" * CLIP in model.calls[0]["messages"][0]["content"] and "x" * (CLIP + 1) not in model.calls[0]["messages"][0]["content"]


# --- the docs in Agent Memory ---------------------------------------------------------------------

class FakeMemory:
    def __init__(self, hits=None, boom=False):
        self.hits, self.boom, self.calls, self.closed = hits or [], boom, [], False

    async def recall(self, query, **kw):
        self.calls.append((query, kw))
        if self.boom:
            raise RuntimeError("memory down")
        return SimpleNamespace(hits=[SimpleNamespace(text=t) for t in self.hits])

    async def close(self):
        self.closed = True


def test_a_passage_is_stored_with_a_mark_that_names_it():
    c = chunk(1, "Alerts go to Slack.")
    stored = passage_text(c)
    assert "Section 1 (f.md)" in stored and "Alerts go to Slack." in stored and stored.endswith("[docs-chunk f.md#s1]")
    assert docs_memory._MARK.search(stored).group(1) == "f.md#s1"


def test_recalled_hits_are_mapped_back_to_passages_and_extracted_entities_are_skipped(monkeypatch):
    chunks = [chunk(1), chunk(2), chunk(3)]
    fake = FakeMemory([passage_text(chunks[2]), "an extracted entity with no mark", "[docs-chunk not-a-real-id]", passage_text(chunks[2]), passage_text(chunks[0])])
    monkeypatch.setattr(memory, "open_memory", lambda: fake)
    found = run(docs_memory.recall_docs("question", chunks, k=3))
    assert [c.id for c in found] == ["f.md#s3", "f.md#s1"]
    query, kw = fake.calls[0]
    assert kw["mode"] == "hybrid" and kw["lens"] == [DOCS_SCOPE] and kw["k"] == 6  # only the docs scope, never a workspace's patterns
    assert fake.closed


def test_memory_that_is_missing_or_failing_gives_no_passages_and_never_an_error(monkeypatch):
    assert run(docs_memory.recall_docs("q", [chunk(1)])) == []  # not configured (the test setup returns no client)
    fake = FakeMemory(boom=True)
    monkeypatch.setattr(memory, "open_memory", lambda: fake)
    assert run(docs_memory.recall_docs("q", [chunk(1)])) == [] and fake.closed


# --- the search -----------------------------------------------------------------------------------

QUERY = "how do I get slack alerts when a run fails"


def bm25_ids(query=QUERY, k=10):
    return [c.id for c, _ in docs_index().search(query, k)]


def test_the_rerank_is_on_and_agent_memory_is_off_by_default_as_the_evaluation_showed():
    assert config.ASSISTANT_RERANK is True and config.ASSISTANT_DOCS_MEMORY is False
    assert [c.id for c in run(search_passages(QUERY, 4))] == bm25_ids()[:4]  # no model client, so nothing can rerank
    model = FakeModel([use("order_passages", {"order": [2, 1]})])
    got = [c.id for c in run(search_passages(QUERY, 4, client=model))]  # with a client, the default reranks
    assert len(model.calls) == 1 and got[:2] == [bm25_ids()[1], bm25_ids()[0]]


def test_memory_results_are_merged_into_the_bm25_ranking(monkeypatch):
    index = docs_index()
    outside = next(c for c in index.chunks if c.id not in bm25_ids())  # a passage BM25 did not return for this question
    monkeypatch.setattr(memory, "open_memory", lambda: FakeMemory([passage_text(outside), passage_text(index.chunks[0])]))
    merged = [c.id for c in run(search_passages(QUERY, 10, use_memory=True))]
    assert outside.id in merged and bm25_ids()[0] in merged
    assert len(merged) == len(set(merged)) <= config.ASSISTANT_POOL


def test_memory_that_finds_nothing_leaves_bm25_as_it_was():
    assert [c.id for c in run(search_passages(QUERY, 4, use_memory=True))] == bm25_ids()[:4]


def test_reranking_reorders_the_pool_counts_its_tokens_and_needs_a_client():
    model = FakeModel([use("order_passages", {"order": [2, 1]})])
    usage = Usage()
    got = [c.id for c in run(search_passages(QUERY, 4, client=model, use_rerank=True, usage=usage))]
    expected = bm25_ids()
    assert got[:2] == [expected[1], expected[0]] and got[2:] == expected[2:4]
    assert usage.take() == (100, 20) and usage.take() == (0, 0)
    assert [c.id for c in run(search_passages(QUERY, 4, client=None, use_rerank=True))] == expected[:4]  # no client, no rerank


def test_the_settings_turn_the_extras_on(monkeypatch):
    monkeypatch.setattr(config, "ASSISTANT_RERANK", True)
    model = FakeModel([use("order_passages", {"order": [2, 1]})])
    run(search_passages(QUERY, 4, client=model))
    assert len(model.calls) == 1


def test_the_tokens_spent_reranking_inside_a_tool_are_counted_in_the_questions_total(store, monkeypatch):
    monkeypatch.setattr(config, "ASSISTANT_RERANK", True)
    model = FakeModel(
        [use("search_docs", {"query": "slack alerts failed run"})],
        [use("order_passages", {"order": [2, 1]})],  # the rerank call, made by the tool with the same client
        [text("Add a webhook [doc:docs/integrations.md#6-failure-alerts-slack-or-any-address].")],
    )
    result = run(service.ask(WS_A, "How do I get Slack alerts?", None, model))
    assert not result["rejected"] and result["tool_calls"] == 1
    assert (result["tokens_in"], result["tokens_out"]) == (300, 60)  # two assistant calls plus the rerank call


def test_a_tool_called_without_a_client_still_searches(store):
    payload, found, is_error = run(execute("search_docs", {"query": "slack alerts"}, WS_A))
    assert not is_error and payload["results"] and found


# --- the scores -----------------------------------------------------------------------------------

def test_the_rank_of_the_first_answering_passage_matches_prefixes():
    assert first_hit_rank(["a#x", "b#y-2", "c#z"], ("b#y",)) == 2  # the second half of a long section counts
    assert first_hit_rank(["a#x", "c#z"], ("b#y", "c#z")) == 2
    assert first_hit_rank(["a#x"], ("b#y",)) is None and first_hit_rank([], ("b#y",)) is None


def test_hit_at_one_hit_at_three_and_mrr():
    assert summarize([1, 3, None, 2]) == {"n": 4, "hit_at_1": 1, "hit_at_3": 3, "mrr": 0.458}
    assert summarize([]) == {"n": 0, "hit_at_1": 0, "hit_at_3": 0, "mrr": 0.0}


def test_the_question_file_is_sound_and_bm25_stays_at_its_measured_level():
    questions = load_questions()
    ids = [c.id for c in docs_index().chunks]
    assert len(questions) == 20 and len({q.text for q in questions}) == 20
    for q in questions:  # a doc that is renamed would otherwise score every question about it as a miss
        assert all(any(i.startswith(p) for i in ids) for p in q.expected), q.text
    scores = summarize([first_hit_rank([c.id for c, _ in docs_index().search(q.text, 10)], q.expected) for q in questions])
    # Measured 23 Nov 2026 with 45 passages: hit@1 12/20, hit@3 16/20, MRR 0.711 (13/20, 16/20, 0.736 before one sentence was added to
    # docs/integrations.md). These floors only catch a regression; they are not a claim.
    assert scores["hit_at_3"] >= 15 and scores["mrr"] >= 0.70
