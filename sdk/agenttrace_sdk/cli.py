"""The agenttrace command line: look at failed runs and test a fix from a terminal or a CI job.

    export AGENTTRACE_URL=https://<api> AGENTTRACE_KEY=at_live_...
    agenttrace failed                      # runs that came out wrong
    agenttrace show <run>                  # one run: its agents, steps and verdict
    agenttrace suspects <run>              # which step probably broke it (spend key; costs tokens)
    agenttrace fork <run> <turn> --edit '{"filter": "open"}' -n 5     # test a change (spend key; costs tokens)
    agenttrace result <experiment>         # k of n each way, and the p-value (directional)
    agenttrace mcp                         # serve these as MCP tools over stdio

Add --json to any command for machine-readable output. Exit status is 0 on success, 1 on an API refusal.
"""

import argparse
import json
import os
import sys
from typing import Any

from agenttrace_sdk._http import ApiClient, ApiError
from agenttrace_sdk.mcp import call_tool, serve


def _text(command: str, out: Any) -> str:
    if command == "failed":
        return "\n".join(f"{r['id']}  {r['workflow']}  {r['outcome']}  {r['started_at']}" for r in out) or "No failed runs."
    if command == "show":
        head = [f"{out['id']}  {out['workflow']}  outcome: {out['outcome'] or 'no verdict yet'}"]
        if out.get("verdict"):
            head.append(f"check {out['verdict']['name']}: {out['verdict']['reason']}")
        return "\n".join(head + [f"  {s['idx']:>3}  turn {s['node_run_idx']}  {s['agent']}  {s['kind']}  {s['origin']}" for s in out["steps"]])
    if command == "suspects":
        return "\n".join(f"turn {s['node_run_idx']}  {round(s['confidence'] * 100)}%  {s['hypothesis']}" for s in out["suspects"]) or "No suspects."
    if command == "fork":
        return f"Started experiment {out['id']}\nRead it with: agenttrace result {out['id']}"
    c, t = out["control"], out["treatment"]
    p = out["stats"].get("fisher_p")
    return (f"{out['status']}  without the change {c['pass']} of {c['total']}, with it {t['pass']} of {t['total']}"
            + (f", p = {p:.4f} (directional)" if p is not None else ""))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="agenttrace", description="Look at failed runs and test a fix.")
    ap.add_argument("--json", action="store_true", help="print the raw answer")
    sub = ap.add_subparsers(dest="command", required=True)
    failed = sub.add_parser("failed")
    failed.add_argument("--limit", type=int, default=20)
    sub.add_parser("show").add_argument("run")
    sub.add_parser("suspects").add_argument("run")
    fork = sub.add_parser("fork")
    fork.add_argument("run")
    fork.add_argument("turn", type=int, help="the agent turn to change (node_run_idx)")
    fork.add_argument("--edit", required=True, help='JSON of the state keys to overwrite, e.g. \'{"filter": "open"}\'')
    fork.add_argument("-n", type=int, default=5)
    sub.add_parser("result").add_argument("experiment")
    sub.add_parser("mcp")
    args = ap.parse_args(argv)

    url, key = os.environ.get("AGENTTRACE_URL", ""), os.environ.get("AGENTTRACE_KEY", "")
    if not url or not key:
        print("Set AGENTTRACE_URL and AGENTTRACE_KEY.", file=sys.stderr)
        return 1
    client = ApiClient(url, key)
    if args.command == "mcp":
        serve(client)
        return 0
    try:
        if args.command == "failed":
            out = call_tool(client, "list_failed_runs", {"limit": args.limit})
        elif args.command == "show":
            out = call_tool(client, "get_run", {"run_id": args.run})
        elif args.command == "suspects":
            out = call_tool(client, "rank_suspects", {"run_id": args.run})
        elif args.command == "fork":
            out = call_tool(client, "run_experiment", {"run_id": args.run, "fork_node_run_idx": args.turn, "edit": json.loads(args.edit), "n": args.n})
        else:
            out = call_tool(client, "get_experiment", {"experiment_id": args.experiment})
    except ApiError as exc:
        print(f"AgentTrace refused: {exc.detail}", file=sys.stderr)
        return 1
    except ValueError as exc:
        print(f"Bad input: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(out, indent=2) if args.json else _text(args.command, out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
