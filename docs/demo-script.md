# Demo video script (under 2:00)

Rule: **the numbers on screen are the stored results.** If you re-seed and they change, change the script, never the screen. Current stored results: decoy 0/5 → 0/5, hero 0/8 → 8/8 (p = 0.00016), auto-verify 0/3 → 3/3, benchmark 0/15 vs 13/15. The recorded failing run has 6 recorded steps (planner, researcher tools and summary, writer, critic).

Record at 1440×900, browser zoom 110%, light theme, notifications off. Open `/demo` (no sign-in) for shots 1 to 4 and 6 to 7; sign in for the workspace switcher in shot 5. Voice-over separately; label any sped-up footage on screen. Upload unlisted and test the link logged out.

| Shot | Time | On screen | Voice-over |
| --- | --- | --- | --- |
| 1 | 0:00–0:10 | `/demo` top: the failing run in agent lanes, red FAIL badge, oracle detail (0 open tickets, truth 5) | "This four-agent workflow wrote a renewal brief that says zero open tickets. The real data has five. It's wrong, and the cause is several steps upstream of the symptom." |
| 2 | 0:10–0:22 | Click the writer step; footer `open_tickets: 0` next to the expected value | "The obvious suspect is the writer. A tracer shows you this. It can't tell you whether the writer is actually the cause." |
| 3 | 0:22–0:40 | Root-cause panel: planner #1 at 80%, data path planner → researcher → writer, "Verified cause" with N=3 measurement; point at the "seen before" chip if shown | "The root-cause agent, running on Claude, follows the data back to the planner's ticket filter. It proposes an edit and tests it, and it recalls verified failures from this workspace's memory in SurrealDB." |
| 4 | 0:40–0:58 | Decoy experiment: 5 + 5 tiles, result 0/5 → 0/5 | "Hypotheses are cheap, so we test them. Make the critic stricter and rerun five times: zero of five, with or without the change." |
| 5 | 0:58–1:12 | Open one tile's run from the hero experiment: the lane view labels each step's origin (replayed from the recording vs live); then the Clerk organization switcher. The seeded runs contain no secrets, so show redaction with the SECURITY.md table or the redaction test output rather than a live badge | "Steps before the fork replay exactly from the recording. Everything after it re-runs live, so we measure outcomes instead of claiming determinism. Workspaces are isolated, and secrets are redacted before a trace leaves your process." |
| 6 | 1:12–1:35 | Hero experiment: fork at the planner, the edit visible, control and treatment tiles filling (label "sped up"), result card | "Now the planner. Same fork point twice: a control arm with no edit, a treatment arm with the fixed filter. Each brief is checked in code against Era's ground truth, not an LLM's opinion." |
| 7 | 1:35–1:55 | Result card held: Control 0/8 → Treatment 8/8, Fisher p, "directional"; then the benchmark table (0/15 vs 13/15) | "Zero of eight to eight of eight. That's causal evidence the planner broke this run. And on five other accounts the fix goes from zero of fifteen to thirteen of fifteen. Directional, not proof, but measured. AgentTrace." |

Fallback if recording live is risky: everything above is on the public `/demo` page from stored data, so no tokens are spent while recording.
