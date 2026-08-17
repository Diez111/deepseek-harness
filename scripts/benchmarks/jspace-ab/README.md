# J-Space A/B benchmark

Reproducible, keyless comparison of the two harness configurations on a long
agentic task:

- **A — baseline**: DeepSeek Harness agent loop with the standard tool set.
- **B — experiment**: the same loop with the optional `@deepseek-ai/dsh-jspace`
  controller enabled (`enabled: true`, `mode: auto`).

## What it measures

A real agent loop is driven by a scripted mock model (no API key, no network).
The scripted model reacts to observable harness signals — the injected
failure-advisory and the injected J-Space ledger block — so the numbers quantify
the harness mechanisms, not a real model's judgment. Metrics per arm:

```text
input_tokens            reported input usage (mock adapter constant; see below)
estimated_input_tokens  character-based estimate of the cumulative request text
output_tokens           character-based estimate of assistant output
tool_calls              durable tool/call events
repeated_tool_calls     consecutive identical tool calls
failed_attempts         failed tool/result events
wall_time_ms            end-to-end agent-loop wall time
task_complete           whether the task reached completion
verification_gate_used  whether jspace_finish accepted a completion claim
ledger_writes           durable jspace/state events
```

The scripted task: "make module A compile with tests passing; do not touch
module B" with a first approach that fails. Arm A blindly repeats the failing
call three times and declares completion with no verification ceremony. Arm B
keeps a compact ledger, breaks the failing loop when the advisory appears,
switches approach, records verification, and must pass the `jspace_finish` gate
before completion.

## Run

```sh
pnpm tsx scripts/benchmarks/jspace-ab/run-bench.ts
```

Prints the comparison table and writes `report.json` (regenerated on every run;
the committed copy is a sample).

## Reading the sample report

The mechanism effects (fewer repeated calls, fewer failed attempts, gate used)
come from the loop-breaking advisory and the completion gate. The honest cost is
the estimated input-token increase: the injected ledger block, its re-injection
when it changes (bounded by `maxStateBytes`), and the compact ledger tool
results. For a single synthetic task that overhead looks large in relative
terms; on a real long task the fixed overhead amortizes while the loop savings
repeat per episode. The reported `input_tokens` column uses the mock adapter's
constant usage and is only a placeholder; use `estimated_input_tokens` (or a
real provider's usage) for comparisons.

## Real-model run (future work)

To compare actual model behavior, run the same two compositions through the
headless profile with a real provider:

```sh
# arm A
pnpm dsh --profile headless "make module A compile with tests passing; do not touch module B"
# arm B (profile with the jspace bundle row enabled, see the package README)
```

Then aggregate the session telemetry (token meter, tool calls, wall time) for
both arms. The report's claim gate is strict: no model-level improvement is
claimed from the scripted numbers above.
