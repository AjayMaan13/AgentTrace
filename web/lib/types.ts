// Shapes returned by the AgentTrace API (api/app/routes, api/app/db.py).

export type Origin = "recorded" | "replayed" | "edited" | "live";
export type Outcome = "pass" | "fail" | "error";
export type State = Record<string, unknown>;

export type Step = {
  run: string;
  idx: number; // 1-based position in the run
  node_run_idx: number; // 1-based: which execution of an agent this step belongs to
  agent: string;
  kind: "llm" | "tool";
  origin: Origin;
  model: string | null;
  params: Record<string, unknown>;
  input: unknown;
  output: unknown;
  tool_name: string | null;
  tool_args: Record<string, unknown> | null;
  tool_result: unknown;
  side_effect: boolean | null;
  state_after: State | null; // only on the last step of a node run
  reads: string[];
  writes: string[];
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
  redactions: { path: string; type: string }[];
};

export type RunSummary = {
  id: string;
  workflow: string;
  kind: string; // "recorded" | "fork"
  status: string; // running | ok | error
  outcome?: Outcome;
  started_at: string;
  ended_at?: string;
  tokens_in?: number;
  tokens_out?: number;
};

export type OracleDetail = {
  truth?: { open_tickets?: number; open_pipeline_usd?: number };
  footer?: { open_tickets?: number; open_pipeline_usd?: number; risk?: string } | null;
  open_tickets_ok?: boolean;
  pipeline_ok?: boolean;
  critic_loop_ok?: boolean;
};

export type Run = RunSummary & { oracle_detail?: OracleDetail; steps: Step[] };

export type Tile = {
  arm: "control" | "treatment";
  i: number;
  status: "queued" | "running" | "done" | "skipped";
  run_id: string | null;
  outcome: Outcome | null;
};

export type Arm = { pass: number; total: number };

export type Experiment = {
  id: string;
  status: "queued" | "running" | "done" | "capped" | "error";
  parent_run: string;
  fork_node_run_idx: number;
  n: number;
  edit_patch: State;
  control: Arm;
  treatment: Arm;
  tiles: Tile[];
  stats: {
    fisher_p: number | null;
    wilson: { control: [number, number] | null; treatment: [number, number] | null };
    label: string; // "directional evidence, N=5"
  };
  tokens_used: number;
  token_ceiling: number;
  error: string | null;
};
