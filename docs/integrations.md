# Bring your own harness

AgentTrace records runs from agents it did not build, and lets you say whether each run is right. Three ways in, from least to most code. All of them need an ingest key (Connect your agents, then Make a key) and send it as a Bearer token.

What you get today: the run drawn as a line of agents, what went in and out of each step, redaction before storage, and a right or wrong verdict from a check you write. What you do not get yet: forking, k/N experiments and root cause on your own workflow. Those re-run your agents, which needs the customer-hosted worker in `docs/addon-plan.md` (P3). A run from your harness is view only, and the app says so.

## 1. OpenTelemetry (no code in your agents)

If your harness already emits GenAI spans, point its exporter at AgentTrace.

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT="https://<your-api>"          # the exporter adds /v1/traces
export OTEL_EXPORTER_OTLP_PROTOCOL="http/json"
export OTEL_EXPORTER_OTLP_HEADERS="authorization=Bearer at_live_..."
```

- JSON only. An exporter that can only send protobuf can go through an OpenTelemetry Collector with an `otlphttp` exporter set to `encoding: json`. Protobuf direct is refused with that explanation; accepting it needs a decoder this API does not have yet.
- One trace is one run, and its **run id is the trace id**. Send a whole trace in one request (flush your span processor at the end of the workflow). A second delivery of a trace you already sent is ignored, so retries are safe.
- Read: `invoke_agent` spans as agents; `chat`, `text_completion` and `generate_content` spans as model calls; `execute_tool` spans as tool calls. Other spans are skipped. A trace with none of those is rejected and counted in `partialSuccess.rejectedSpans`.
- The GenAI attribute names (`gen_ai.agent.name`, `gen_ai.input.messages`, `gen_ai.output.messages`, `gen_ai.tool.call.arguments`, and so on) are marked Development in the OpenTelemetry conventions, and message content is opt-in at the exporter. If your exporter does not record content, the run shows the agents and timings but empty prompts. Checked against the OTLP JSON specification, not yet against a real exporter.
- Optional: an `agenttrace.state_after` attribute (a JSON object) on an `invoke_agent` span stores the shared state when that turn ended.
- Limits: 5 MB per request (after gzip), 50 traces per request, 300 steps per trace. A trace id already used in another workspace is rejected.

## 2. LangGraph (a few lines, no LangGraph import in the SDK)

```python
from agenttrace_sdk import HttpSink
from agenttrace_sdk.adapters.langgraph import record_langgraph

sink = HttpSink("https://<your-api>", "at_live_...")
run_id = await record_langgraph(
    app.astream(inputs, stream_mode="updates"),   # also works with a list of modes, and version="v2"
    sink, "renewal-brief", input=inputs,
    oracle=check,                                  # optional, see below
    reducers={"notes": operator.add},              # optional: keys whose updates append rather than replace
)
```

It reads the update stream LangGraph already produces: one turn per node, with the state before it as the agent's input and the rebuilt state after it. Probed against langgraph 1.2.17 in all three stream shapes, and the rebuilt state matched LangGraph's own final state when the reducers were given. Without a reducer for a key that has one, the rebuilt value is only the last update, so give the reducers if you want the state to be exact.

For any other loop, use `RunRecorder` the same way: `async with RunRecorder(sink, "name", oracle=check) as rec:` then `await rec.turn("agent", input=..., output=..., tool_calls=[...], state_after=...)`.

## 3. A verdict from your own check

AgentTrace cannot know what "right" means for your workflow. You write it as a function of the run's final state:

```python
def check(state):
    return state["answer"] == "5 open tickets", f"the run said {state['answer']!r}"
```

- It may return `True`/`False`, `(bool, reason)` or a `Verdict`, and may be `async`.
- Pass it as `oracle=` to `record_langgraph` or `RunRecorder`, or judge a run that is already stored (for example one that arrived over OpenTelemetry): `await submit_verdict(sink, trace_id, check, final_state)`.
- The result is stored as `outcome` (pass, fail, or error) with a `verdict` of kind `code`: the check's name and its reason. The Runs page shows the run as right or wrong; the run page shows "Your check <name>" and the reason.
- A check that raises, or returns something that is not a verdict, gives `error`, never a quiet pass. Only the exception type is stored, because the message may hold data. A secret in a reason is redacted, and a reason is cut at 300 characters.
- A run with no check has **no verdict yet**. It is never shown as right.
- This is a check written in code. It is not an AI judge, and it is not more than the function you wrote.
