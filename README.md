# AgentTrace

**A debugger for multi-agent LLM workflows that tests which step broke a run, and measures whether the fix works.**

Traces show what happened. AgentTrace tests what caused it: record a run, fork it at any step, edit that step, and re-run the rest live N times in a **control arm** (no edit) and a **treatment arm** (your edit). The result is a success rate per arm, checked by code against ground truth, with a Fisher exact p-value labelled *directional*.

[![AgentTrace pitch: rewind to any sub-agent, fix it, and be confident that the fix works](docs/assets/pitch-cover.png)](docs/AgentTrace-Pitch.pdf)

| | Link |
| --- | --- |
| Live demo (no sign-in) | <https://agenttrace-web.onrender.com/demo>, with an Examples dropdown: the saved failing run, all runs by time, keys and alerts, forking your own agents through a worker, and the terminal and CI |
| Web app | <https://agenttrace-web.onrender.com/> |
| API | <https://agenttrace-api-apaa.onrender.com/health> |
| Devpost | <https://devpost.com/software/agenttrace-qb8jvo> |
| Pitch deck (PDF) | [docs/AgentTrace-Pitch.pdf](docs/AgentTrace-Pitch.pdf) |
| Example client (separate repo) | <https://github.com/AjayMaan13/agenttrace-harness-demo>: three Claude agents run as a LangGraph graph, recorded into AgentTrace and forkable through a worker |

- Built for Build North (Oct 2026), solo.
- The free Render services sleep after 15 minutes without traffic, so the first request can take about a minute. The demo page shows the saved results while the API wakes up.

## What it shows

The demo workflow is a four-agent **renewal risk brief** (planner → researcher → writer ⇄ critic) over a simulated company's Zendesk and Salesforce data. A teammate "reduced noise" in the planner's prompt, so the planner filters tickets to `solved` only. Every later agent behaves sensibly given that plan, and the brief reports **0 open tickets**. The failure is planted at the first step and only surfaces at the end.

| What we did | Control | Treatment | Fisher p | Notes |
| --- | --- | --- | --- | --- |
| **Decoy:** make the critic stricter (fork at the critic) | 0/5 | 0/5 | 1.0 | The obvious fix does nothing: the data never contained open tickets. |
| **Hero:** fix the planner's ticket filter (fork at the planner) | 0/8 | 8/8 | 0.00016 | Same fork point both arms; only the edit differs. 62,722 tokens. |
| **Root-cause agent** | | | | Ranked the planner #1 (confidence 0.80). A small test (N=3 each way) supported it: 0/3 → 3/3. That is too few runs to be sure. |
| **Generalization benchmark:** original vs patched planner prompt, 5 other Era accounts, 3 fresh end-to-end runs each | 0/15 | 13/15 | | Two patched runs crashed and count as not passing. |

These are the stored results behind the `/demo` page, not mock-ups. N is small, so every figure is **directional evidence**, not proof.

## How replay works

**Recorded steps replay exactly. Forked steps re-run live.** AgentTrace never calls the live part deterministic; it measures it.

| Segment | Source | Tokens |
| --- | --- | --- |
| Steps before the fork | Read back from the recording (no model or tool calls) | 0 |
| The edited step | Your edited output replaces the recorded one | 0 |
| Steps after the fork | Re-run live against Claude and the data source, sampled | live |

State at the fork is the recorded state after the previous step, overlaid with your edit. Nodes are pure functions of `(state, llm, tools)` and declare which state keys they read and write, which is how the root-cause agent follows data from the symptom back to its source. A model-pin check refuses to run an experiment if the recorded model is unavailable, and tools that declare a side effect cannot run live in a fork without a registered mock.

Why a control arm: one replay with a fix that "works" could be luck, because live steps are sampled. Running the same fork point with and without the edit, N times each, is what turns a replay into evidence. Why a code oracle: success is checked in code against exact ground truth from the data source, so a pass is not an LLM's opinion.

## Architecture

```mermaid
flowchart LR
  subgraph Customer process
    G["Your agents<br/>example: agenttrace-harness-demo,<br/>LangGraph + Claude Agent SDK"]
    W["AgentTrace SDK<br/>RunRecorder, trace_run, @node, @tool<br/>redacts before send"]
    WK["SDK worker<br/>re-runs the agents live for a fork"]
    G --> W
    G --> WK
  end
  subgraph Render
    API[FastAPI api<br/>ingest, replay, experiments, RCA]
    WEB[Next.js web<br/>Clerk sign-in]
  end
  W -- ingest key --> API
  WK -- worker key, asks for fork jobs --> API
  WEB -- Clerk JWT --> API
  API --> DB[(SurrealDB Cloud<br/>runs, steps, forks, experiments)]
  API --> MEM[(SurrealDB Agent Memory<br/>verified failure patterns)]
  API --> LLM[Anthropic API<br/>live steps + RCA]
  API --> ERA[Era by Eon<br/>Zendesk + Salesforce simulators]
```

- `sdk/` stdlib-only recorder: `trace_run`, `@node`, `@tool`, `TracedLLM`, redaction, `HttpSink`.
- `api/` FastAPI service: ingest, read API, replay engine ([fork.py](api/app/replay/fork.py)), experiment runner and statistics ([experiments/](api/app/experiments)), root-cause agent ([rca/](api/app/rca)), the Ask AgentTrace assistant ([assistant/](api/app/assistant)), security ([security/](api/app/security)), workflow and oracle ([workflows/renewal_brief](api/app/workflows/renewal_brief)).
- `web/` Next.js (App Router) UI: a run is a workbench. The answer and a scoreboard at the top, the run drawn as one continuous line of agents with every fork opening a new branch under it, and, for the agent you select, what went in, what came out and what it passed on, beside an editor where you change it and fork. A dashed new line appears on the graph as soon as you change a value. The Runs page is a Gantt: one numbered row per run (oldest first, grouped by workflow, each run in its own colour) with time across, and every fork a marker on the row under its run. Filters: All, Wrong, Fixed, Right. Plus the public `/demo`.
- Experiments run as asyncio tasks inside the API process, 3 at a time.

## Root-cause agent

Claude Haiku 5.5 reads a compacted trace (full detail only for steps on the data-lineage path to the failing oracle field), recalls similar verified patterns from Agent Memory, and must answer with a forced `report_candidates` tool call: up to 3 candidates with confidence, hypothesis, evidence quotes and a small proposed edit. Evidence quotes are checked verbatim against the trace. **The agent proposes; experiments decide.** "Verify" runs the top two candidates that carry a concrete edit at N=3 per arm and re-ranks them by measured improvement. Trace content is untrusted input: it is delimited, the agent has no tool that acts on anything, and its output is schema-validated.

## Ask AgentTrace

A question box on every run page. It answers how-to questions from the documentation and questions about the workspace's own runs, and every answer lists the sources it used.

- **Retrieval first.** `search_docs` ranks passages of the README, the integration guide, the self-hosting guide and the security notes with BM25 (written here, no extra dependency), then Claude Haiku 5.5 reorders the top 10. Four more tools read only the caller's own workspace: `get_run`, `list_runs`, `list_failed_runs` and `similar_causes` (verified causes from Agent Memory). None of the five changes anything.
- **Checked sources.** An answer may cite only a source that a tool returned for that question (`[doc:...]`, `[run:...#step]`, `[experiment:...]`). A failing answer is sent back once and, if it still fails, is not shown. Run content is treated as untrusted data, and the workspace comes from the Clerk token, never from the question.
- **Streaming.** `POST /v1/assistant/ask/stream` sends status lines and the text as it is written. That text is a preview: the checked result replaces it. The same docs search is an MCP tool, `search_docs`.
- **Limits.** 10 questions a minute and 100 a day per user, at most 5 model calls and 40,000 tokens per question. The audit log keeps counts, never the question or the answer.

**Measured on 23 Nov 2026**, docs search over 20 questions about these docs. The author wrote the questions, and one label was widened after the first run showed it was too narrow; every row below was run again afterwards.

| Docs search | Right passage first | In the top 3 | MRR |
| --- | --- | --- | --- |
| BM25 | 12/20 | 17/20 | 0.721 |
| BM25 + Haiku rerank (on by default) | 15/20 | 17/20 | 0.808 |
| Agent Memory alone | 15/20 | 18/20 | 0.842 |
| BM25 + Agent Memory, merged | 13/20 | 17/20 | 0.770 |
| Merged + rerank | 17/20 | 20/20 | 0.925 |

The rerank adds about half a second per search (mean of five calls). One Agent Memory recall took 6 to 8 seconds (five calls), so Agent Memory stays off for the interactive assistant (`ASSISTANT_DOCS_MEMORY` in [config.py](api/app/config.py)); if you turn it on, run `scripts/seed_docs_memory.py --infer none` again whenever the docs change.

**Answers.** A 30-question evaluation checked by code, not by a model (20 docs questions where the answer must cite a passage that answers it, and 10 about a made-up workspace of six runs whose right answers are known) scored 28/30 on its first run. It found a bug (passages were clipped before the model saw the answer) and a missing tool (no way to list passing runs); after fixing both it scored 30/30, and 30/30 again with the rerank on. One 30-question run used 160,000 to 240,000 input tokens, about two to three cents at list prices. This is a regression check on these docs, not an accuracy claim: the questions are the author's, and a check for the right words in an answer cannot judge an explanation.

```bash
cd api
.venv/bin/python scripts/assistant_smoke.py --stream "How do I get an alert when a run fails?"   # one real question
.venv/bin/python scripts/assistant_eval.py                                                      # docs search, BM25 only, offline
.venv/bin/python scripts/assistant_eval.py --live --arms bm25,bm25_rerank,memory,fused,fused_rerank
.venv/bin/python scripts/assistant_answer_eval.py --live                                        # 30 questions on Claude
```

## Partner platforms

| Platform | How it is used | Where to look |
| --- | --- | --- |
| **Anthropic** | Demo agents, the root-cause agent and the Ask AgentTrace assistant on `claude-haiku-5-5`; forced tool call with schema validation; effort (not temperature) is the sampling control, because Haiku 5.5 rejects non-default temperature. | [rca/agent.py](api/app/rca/agent.py), [config.py](api/app/config.py) |
| **SurrealDB** | Trace store with graph edges (`has_step`, `next`, `forked_from`, `tested`) in SurrealDB Cloud. **Agent Memory** `remember`s a redacted paragraph for each *verified* root cause, `recall`s it into the next analysis ("seen before" chip with the source run and experiment), and `forget`s it exactly when a run is deleted. | [schema.surql](api/schema.surql), [rca/memory.py](api/app/rca/memory.py) |
| **Clerk** | Sign-in and organizations as workspaces, admin vs member roles. The API verifies the session JWT (RS256, JWKS, issuer, expiry, authorized party) and takes the workspace **only** from the token's organization. | [auth.py](api/app/auth.py), [proxy.ts](web/proxy.ts), [test_auth.py](api/tests/test_auth.py) (cross-org isolation) |
| **Era by Eon** | The simulated company (Zendesk + Salesforce) is the workflow's tool environment and the source of exact ground truth for the oracle. The benchmark runs the original and patched workflow on five other Era accounts. | [tools.py](api/app/workflows/renewal_brief/tools.py), [oracle.py](api/app/workflows/renewal_brief/oracle.py), [benchmark.py](api/app/benchmark.py) |
| **Render** | `web` and `api` services from one Blueprint. | [render.yaml](render.yaml) |

## Quickstart

Needs Python 3.11 and Node 20+. The offline test suites need no keys.

```bash
git clone <this repo> && cd AgentTrace
cp .env.example .env            # names only; fill in the values you have

# API (offline tests: fake database and fake model)
cd api && python3.11 -m venv .venv && .venv/bin/pip install -e ../sdk -e '.[dev]'
.venv/bin/pytest                # 421 passed, 17 live tests skipped
cd ..

# SDK (stdlib only)
api/.venv/bin/pytest sdk/              # 91 passed

# Web
cd web && npm install && npm test && npm run build   # 81 passed
```

The same checks run on every push and pull request in [ci.yml](.github/workflows/ci.yml): the API and SDK tests on Python 3.11, and the web lint, tests and build on Node 22 (the build uses placeholder Clerk keys).

To run it for real you need a SurrealDB Cloud instance, an Anthropic key and (for the full demo) Clerk keys, an Era company and an Agent Memory context. `api/scripts/check_env.py --phase N` lists what is still missing. Without Era, set `TOOLS_BACKEND=fixtures` to use `fixtures/company.json`.

```bash
cd api && .venv/bin/uvicorn app.main:app --reload     # http://localhost:8000
cd web && npm run dev                                  # http://localhost:3000
```

Useful scripts (`api/scripts/`): `seed_demo.py` (record the failing run, run the decoy and hero experiments, store the root-cause report), `era_benchmark.py`, `verify_demo.py`, `remember_experiment.py`, `create_workspace_key.py` (mint an ingest key, shown once). Live tests: `RUN_LIVE=1 .venv/bin/pytest`.

Connecting your own agents: sign in, create an organization, then open **Connect your agents**. There you can add the saved example to your workspace (a real run you can fork at once, no code, no tokens), make a key and copy the snippet, or import past logs (those are view only). Agents you did not write can be recorded too, from OpenTelemetry GenAI traces or a LangGraph stream, and given a right or wrong verdict by a check you write (forkable through a worker you run next to your code); an assistant or the command line can look at failed runs through MCP: see [docs/integrations.md](docs/integrations.md) (which also covers failure alerts to Slack and a CI gate) and [docs/self-host.md](docs/self-host.md) to run it yourself. A complete outside example, with its own repo, is [agenttrace-harness-demo](https://github.com/AjayMaan13/agenttrace-harness-demo): a LangGraph app of three Claude agents that records into AgentTrace and runs forks through a worker. See [sdk/agenttrace_sdk](sdk/agenttrace_sdk) and [record_demo.py](api/scripts/record_demo.py) for an example inside this repo.

Recording your own workflow in code:

```python
from agenttrace_sdk import trace_run, node, tool, TracedLLM, HttpSink
```

See [sdk/agenttrace_sdk](sdk/agenttrace_sdk) and [record_demo.py](api/scripts/record_demo.py) for a complete example.

## Security

Redaction at the source and again on ingest (`[REDACTED:<type>:<hash8>]`), 32 KB field limit, workspace isolation from the verified identity only, admin-only run deletion that cascades into forks, experiments, reports and Agent Memory, an audit log, spend limits (N per arm, token ceiling, daily cap per user, per-minute rate limits), and an untrusted-input design for the root-cause agent. Details, and what is **not** covered, are in [SECURITY.md](SECURITY.md). A `gitleaks` scan of the working tree and history is clean.

## Limitations

- **N is small.** Results are directional. The UI says so and shows Wilson intervals.
- **Only registered workflows replay.** There is no endpoint that runs arbitrary code, and the recorder currently targets Python and the Anthropic SDK.
- **Two kinds of edit.** You can replace a step's output, or (for workflows registered on this server) change an agent's instructions: that agent then runs live again in both arms, with your instructions and with the recorded ones. Instructions of agents that run in your own code (forked through a worker) cannot be changed from here. Instruction edits are covered by offline tests with a fake model; they have not been run against the real model yet.
- **Experiments live in the API process** and are lost on a restart; the experiment pages poll (only the assistant streams).
- **Rate limits are per process**, and there is no retention sweep or key-rotation endpoint (see SECURITY.md).
- **Auto-verify tests only candidates with a concrete edit.** On the demo run that was one of three.
- **The benchmark is one workflow** on five accounts; two patched runs crashed and their cause was not recorded.
- **Ask AgentTrace is small and checked on small sets.** It looks at the 200 most recent runs of a workspace, streamed text is a preview until its sources are checked, and the evaluations use 20 and 30 questions written by the author.
- The demo uses an Era tenant token that expires and is refreshed by hand.

## Related work

- [Rewind](https://github.com/agentoptics/rewind) forks a session at a step, serves earlier steps from cache and re-runs the changed step live. It has an LLM-driven `rewind fix` diagnosis, evaluators including an LLM judge, datasets and side-by-side experiment comparison.
- [LangGraph time travel](https://docs.langchain.com/oss/python/langgraph/use-time-travel) replays from a checkpoint or forks it with modified state; nodes after the checkpoint re-execute.
- Tracing platforms such as LangSmith, Langfuse and Phoenix record and display runs.

AgentTrace is meant to complement these. What it adds: **control-arm experiments** (N live suffixes with and without the edit, with uncertainty), **root cause ranked by measured effect**, a **code oracle on exact ground truth** instead of a judge, and **shared failure memory** for verified causes. It is a hackathon MVP, not a replacement for a production tracing stack.

## Built with

Python 3.11, FastAPI, Pydantic v2, the Anthropic SDK, SurrealDB Cloud and Agent Memory (`surrealdb-memory`), Next.js 16, Clerk, Tailwind, Render, and Era by Eon. The web app started from `create-next-app` and the Clerk quickstart. No LangChain or LangGraph in AgentTrace itself; the separate example client above uses LangGraph.

## License

MIT, see [LICENSE](LICENSE). The planning documents are in [docs/](docs).
