# Devpost write-up (draft)

Paste each section into the matching Devpost field. Numbers are the stored results shown on `/demo`; re-check them against the page before submitting.

## Tagline

A debugger for multi-agent systems that tests which step broke your run, and measures whether the fix works.

## The problem

An AI engineer ships a research → write → critique workflow and it fails nine agent steps deep with a confident, wrong answer. Traces show what happened, not what caused it. Re-running the workflow is noisy and costs tokens, and one lucky re-run proves nothing.

## What it does

Record a run, inspect every prompt, tool payload and state change, then fork at any step and edit its output. AgentTrace re-runs the rest live N times in a **control arm** (no edit) and a **treatment arm** (your edit), checks every run with a code oracle against exact ground truth, and reports k/N per arm with a Fisher exact p-value, labelled directional. A root-cause agent ranks the suspect steps and proposes a small edit for each; "Verify" tests the top two by experiment and re-ranks them by measured effect. Verified causes go into shared failure memory and are recalled on the next failure.

On the demo workflow (a renewal brief that wrongly reports 0 open tickets):

- Decoy, make the critic stricter: **0/5 → 0/5** (p = 1.0). The obvious fix does nothing.
- Hero, fix the planner's ticket filter: **0/8 → 8/8** (Fisher p = 0.00016, directional).
- Root-cause agent ranked the planner first (80%); auto-verify confirmed it, 0/3 → 3/3.
- Generalization: original vs patched planner prompt on five other Era accounts, 3 fresh runs each: **0/15 vs 13/15**. Two patched runs crashed and count as failures.

## How it works

Recorded steps replay exactly from the recording; forked steps re-run live against Claude and the data source and are sampled, never deterministic. That is why each arm runs N times. The oracle is code checking the brief against Era's data, not an LLM judge. Architecture: a stdlib-only Python SDK records and redacts; a FastAPI service stores traces in SurrealDB Cloud and runs forks, experiments and the root-cause agent; a Next.js app behind Clerk shows it. See the README for the diagram.

## Partner platforms

- **Anthropic.** Claude Haiku 5.5 runs the demo agents and the root-cause agent (forced `report_candidates` tool call, schema-validated, evidence quotes checked verbatim against the trace). Haiku 5.5 rejects non-default temperature, so reasoning effort is the sampling control. Code: `api/app/rca/agent.py`, `api/app/config.py`.
- **SurrealDB.** Traces and the fork graph live in SurrealDB Cloud (`has_step`, `next`, `forked_from`, `tested` edges, `api/schema.surql`). **Agent Memory** stores a redacted paragraph for each verified root cause, one scope per source run so deletion is exact. The next analysis recalls it and the UI shows a "seen before" chip with the source run and experiment. Code: `api/app/rca/memory.py`.
- **Clerk.** Organizations are workspaces with admin and member roles. The API verifies the session JWT via JWKS and takes the workspace only from the token's organization; a test proves one organization cannot read another's run. Code: `api/app/auth.py`, `web/proxy.ts`, `api/tests/test_auth.py`.
- **Era by Eon.** A simulated company (Zendesk and Salesforce) is both the workflow's tool environment and the source of exact ground truth. Because the data is fixed, a pass or fail is a fact, which is what makes a causal claim from a handful of runs defensible. The benchmark ran the original and patched workflow on five other Era accounts.
- **Render.** `web` and `api` services from one `render.yaml`.

## Security and ethics

Secrets are redacted in the SDK and again on ingest; fields are capped at 32 KB; the workspace comes only from the verified identity; admins can delete a run and everything derived from it, including its Agent Memory patterns; every launch, analysis and deletion is audited; experiments have per-experiment, per-user and per-minute limits. The root-cause agent treats the trace as untrusted data, has no tool that acts, and only proposes: a person launches experiments. Demo data is synthetic. It does not claim deterministic replay, apply fixes to production, train on traces, or hold any compliance certification. See `SECURITY.md` for the known gaps.

## Related work and what is new

[Rewind](https://github.com/agentoptics/rewind) and [LangGraph time travel](https://docs.langchain.com/oss/python/langgraph/use-time-travel) already fork and replay a run; Rewind also diagnoses failures with an LLM and compares forks with evaluators, including an LLM judge. LangSmith, Langfuse and Phoenix trace and display runs. AgentTrace is complementary and adds four things: control-arm experiments with uncertainty, root cause ranked by measured effect, a code oracle on exact ground truth, and shared memory of verified failures.

## Path to production

A customer-hosted replay worker so prompts and tools never leave the customer's infrastructure; framework adapters (LangGraph, CrewAI, OpenAI Agents SDK) and OpenTelemetry import; a CI gate that fails a deploy when a known failure pattern's experiment regresses; edit-input mode and streaming results.

## Built this week / prior work

*(Fill in: what existed before Oct 16, if anything. The idea was chosen this week from an earlier shortlist.)* Everything in this repository was written during Build Week. Templates used: `create-next-app` and the Clerk quickstart for the web app skeleton. Claude Code assisted with the implementation.

## Challenges and what's next

N=5 to 8 is directional, and the UI says so. Only registered workflows replay, and only output edits are supported. Experiments run inside the API process, so a restart loses a running one. Auto-verify can only test candidates that propose a concrete edit (one of three on the demo run). Two patched benchmark runs crashed and the cause was not recorded; that is the first thing to fix. Next: edit-input mode, a fork tree and diff view, and the customer-hosted worker.
