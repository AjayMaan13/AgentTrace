"""Ask AgentTrace, day 3: the answer evaluation and recording an evaluation question as a run. Offline: made-up answers
and a scripted model. The run against the real model is scripts/assistant_answer_eval.py."""

import asyncio

import pytest
from agenttrace_sdk import ListSink

from app.assistant import answer_eval, service, tools
from app.assistant.answer_eval import WS, build_cases, docs_check, evaluate, rid, runs_check, seed_scenario
from app.assistant.evaluation import load_questions
from app.assistant.tracing import WORKFLOW, build_state
from test_assistant import FakeModel, text, use


def run(coro):
    return asyncio.run(coro)


def answer(text_: str, *refs: str, rejected: bool = False, tokens=(100, 20)) -> dict:
    """The shape service.ask returns, with citations that are all valid."""
    return {"answer": text_, "rejected": rejected, "citations": [{"ref": r, "ok": True} for r in refs], "tool_calls": 1,
            "tokens_in": tokens[0], "tokens_out": tokens[1], "model": "claude-haiku-5-5"}


def state_of(result, question="q", viewing=None, trace=()):
    return build_state(question, viewing, result, list(trace))


# --- the scenario is what the checks say it is ----------------------------------------------------

def test_the_made_up_workspace_has_the_four_failed_or_crashed_runs_the_checks_expect(store):
    seed_scenario(store)
    payload, _, _ = run(tools.execute("list_failed_runs", {"limit": 20}, WS))
    assert {r["id"] for r in payload["runs"]} == {rid("1"), rid("3"), rid("4"), rid("6")}
    run_one, _, _ = run(tools.execute("get_run", {"run_id": rid("1")}, WS))
    assert [s["agent"] for s in run_one["steps"]] == ["planner", "researcher", "researcher", "writer", "critic"]
    assert any(s["tool_name"] == "ticket_summary" for s in run_one["steps"])
    other, _, is_error = run(tools.execute("get_run", {"run_id": rid("1")}, "some-other-workspace"))
    assert is_error  # the scenario belongs to one workspace only


def test_there_are_twenty_docs_cases_and_ten_run_cases_each_with_a_check():
    cases = build_cases()
    assert [c.kind for c in cases].count("docs") == len(load_questions()) == 20 and [c.kind for c in cases].count("runs") == 10
    assert len({c.question for c in cases if c.kind == "docs"}) == 20


# --- the checks -----------------------------------------------------------------------------------

def test_a_docs_answer_passes_only_when_it_is_shown_and_cites_a_passage_that_answers_it():
    check = docs_check(("docs/integrations.md#6-failure-alerts",))
    assert check(state_of(answer("Use a webhook.", "doc:docs/integrations.md#6-failure-alerts-slack-or-any-address")))[0]
    assert not check(state_of(answer("Use a webhook.", "doc:docs/self-host.md#steps")))[0]
    assert not check(state_of(answer("Use a webhook.")))[0]
    assert "not shown" in check(state_of(answer("", rejected=True)))[1]


def test_a_run_answer_must_cite_a_run_and_hold_the_facts_and_not_the_wrong_ones():
    check = runs_check(has=("planner",), lacks=("critic",))
    cite = f"run:{rid('1')}#1"
    assert check(state_of(answer("The Planner decided it.", cite)))[0]  # case does not matter
    assert "cited no run" in check(state_of(answer("The planner decided it.")))[1]
    assert "does not mention" in check(state_of(answer("The writer decided it.", cite)))[1]
    assert "mentions 'critic'" in check(state_of(answer("The planner, then the critic.", cite)))[1]
    assert runs_check(pattern=r"\b4\b|\bfour\b")(state_of(answer("Four runs failed.", f"run:{rid('1')}")))[0]
    assert not runs_check(pattern=r"\b4\b|\bfour\b")(state_of(answer("Run 44444444 failed.", f"run:{rid('4')}")))[0]  # an id is not the count


# --- the whole evaluation, with answers written by hand -------------------------------------------

GOLD = {  # a right answer for each run question, as the data says it
    "How many of my runs failed or crashed?": "Four runs failed or crashed.",
    "Which workflows have runs that failed?": "renewal_brief and support_triage both have failures.",
    "Which agent decided the ticket status filter in this run?": "The planner set the status filter to solved only.",
    "What did the writer say in this run?": "The writer said: Zero open tickets, risk low.",
    "Which tool did the researcher call in this run?": "It called ticket_summary.",
    "Which agent ran last in this run?": "The critic ran last.",
    "Which run crashed?": f"Run {rid('4')[:8]} crashed.",
    "List the runs of the support_triage workflow that failed or crashed.": f"Runs {rid('4')[:8]} (crashed) and {rid('6')[:8]} (failed).",
    "How many steps does this run have?": "It has three steps.",
    "Do any other runs share this run's workflow?": f"Yes: runs {rid('2')[:8]} and {rid('3')[:8]} are also renewal_brief.",
}


def gold_asker(wrong=False):
    cases = {c.question: c for c in build_cases()}

    async def ask(workspace, question, viewing, *, trace):
        trace.append({"name": "get_run" if viewing else "list_failed_runs", "args": {"run_id": viewing} if viewing else {}, "sources": [f"run:{rid('1')}"], "is_error": False})
        if cases[question].kind == "runs":
            return answer("I am not sure." if wrong else GOLD[question], f"run:{rid('1')}")
        expected = next(q.expected[0] for q in load_questions() if q.text == question)
        return answer("See the docs.", f"doc:{expected}" if not wrong else "doc:SECURITY.md#known-gaps")

    return ask


def test_right_answers_pass_every_case_and_are_recorded_as_runs_with_their_verdicts():
    sink = ListSink()
    rows = run(evaluate(build_cases(), gold_asker(), sink))
    assert len(rows) == 30 and all(r.passed for r in rows), [(r.case.question, r.reason) for r in rows if not r.passed]
    assert len(sink.runs) == 30 and {r["outcome"] for r in sink.runs.values()} == {"pass"}
    assert {r["workflow"] for r in sink.runs.values()} == {WORKFLOW}


def test_wrong_answers_fail_every_case_and_the_runs_say_wrong():
    sink = ListSink()
    rows = run(evaluate(build_cases(), gold_asker(wrong=True), sink))
    assert not any(r.passed for r in rows)
    assert {r["outcome"] for r in sink.runs.values()} == {"fail"}
    assert all(r["oracle_detail"]["verdict"]["reason"] for r in sink.runs.values())


def test_a_recorded_question_has_a_retriever_turn_and_an_answerer_turn():
    sink = ListSink()
    [row] = run(evaluate([c for c in build_cases() if c.question == "Which agent ran last in this run?"], gold_asker(), sink))
    steps = sink.steps_for(row.run_id)
    assert [s["agent"] for s in steps if s["kind"] == "llm"] == ["retriever", "answerer"]
    assert [s["tool_name"] for s in steps if s["kind"] == "tool"] == ["get_run"]
    answerer = next(s for s in steps if s["agent"] == "answerer" and s["kind"] == "llm")
    assert answerer["output"] == "The critic ran last." and (answerer["tokens_in"], answerer["tokens_out"]) == (100, 20)
    assert set(answerer["writes"]) == {"answer", "cited", "rejected"} and answerer["state_after"]["rejected"] is False


# --- through the real assistant loop, with a scripted model ----------------------------------------

def test_a_question_asked_through_the_real_loop_is_checked_and_recorded(store):
    seed_scenario(store)
    model = FakeModel(
        [use("get_run", {"run_id": rid("3")})],
        [text(f"The critic ran last [run:{rid('3')}#3].")],
    )

    async def ask(workspace, question, viewing, *, trace):
        return await service.ask(workspace, question, viewing, model, trace=trace)

    sink = ListSink()
    [row] = run(evaluate([c for c in build_cases() if c.question == "Which agent ran last in this run?"], ask, sink))
    assert row.passed, row.reason
    recorded = sink.runs[row.run_id]
    assert recorded["outcome"] == "pass" and recorded["oracle_detail"]["verdict"]["kind"] == "code"
    retriever = next(s for s in sink.steps_for(row.run_id) if s["kind"] == "tool")
    assert retriever["tool_name"] == "get_run" and f"run:{rid('3')}#3" in retriever["tool_result"]["sources"]


@pytest.mark.parametrize("n", range(1, 7))
def test_every_scenario_run_has_steps(store, n):
    seed_scenario(store)
    assert run(store.get_run_with_steps(WS, rid(str(n))))["steps"]
