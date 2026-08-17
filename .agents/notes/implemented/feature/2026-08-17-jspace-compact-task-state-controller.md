# Agent Note: J-Space compact task-state controller (dsh-jspace)

Status: implemented

English | [中文](2026-08-17-jspace-compact-task-state-controller.zh.md)

## Problem

Long agentic work drifts: the original objective fades from the context window,
constraints get rebuilt differently in separate branches, failed attempts are
retried without a diagnostic, "done" is declared after edits instead of after
verification, and context compaction erases the working memory. The J-Space
capability report names this loss "capability-realization loss" and proposes a
compact durable task state (GOAL/CORE/VERIFIED/OPEN/NEXT), failed-attempt
memories, verification before completion, and tiered control. The harness
already owns adjacent mechanisms — goal, todo, repeat-tool-reminder, compaction,
plan-mode — so the goal is to add what is genuinely missing without duplicating
those, and without touching the persona or first-round interface that DeepSeek
is sensitive to.

## Decision

One opt-in package, `@deepseek-ai/dsh-jspace` under `packages/context`, gated by
`config.enabled` (default false). When disabled it registers nothing and the
harness behaves exactly as before; when enabled it adds three coordinated
mechanisms and no system-prompt section:

1. **Durable ledger + runtime-context injection.** The ledger is event-sourced
   through a new log-only session event `jspace/state` carrying the complete
   post-mutation snapshot (last-write-wins, mirroring `todo/write` and
   `goal/change`). The model-visible block is registered as a
   `systemPrompt.context` contribution (`jspace`, order 300): the loop's
   runtime-context projection re-logs the rendered block only when it changes or
   after compaction, so recovery reuses the existing mechanism instead of a new
   context-restore path. The block renders nothing before the first write or in
   `fast`, so token cost is zero until bookkeeping begins, and `maxStateBytes`
   bounds it.
2. **Failure-aware retry guard.** Per-agent in-memory memory of failed calls
   (canonicalized arguments), on `tools/post-execute`/\`agent/pre-step\` exactly like
   the repeat-tool guard, injecting an advisory when the same canonical call that
   previously failed is retried; a success forgets the record. This is
   complementary to `repeat-tool-reminder` (which counts identical calls
   regardless of outcome and never records why they failed).
3. **Completion gate.** `jspace_finish` enforces the closure checklist in the
   operation that makes the decision: every OPEN item must be resolved or
   explicitly documented, verified evidence must exist when the ledger took
   action (`requireVerification`), and the model must acknowledge the four
   closure booleans. Rejection is a typed tool error, not prose.

Tier selection: `mode` config forces fast/full/loop, or `auto` derives it from
the ledger (empty → fast, goal or open → loop, else full). Fast suppresses the
block and the advisory; tools remain registered so the model can escalate.

Deliberately NOT duplicated: `dsh-goal` (the ledger `goal` is a compact
restatement, documented), `dsh-todo`, `dsh-plan-mode`, `dsh-compaction-basic`,
and the existing request-context projection machinery.

## Verification

47 keyless tests across six suites in the package: pure fold/mode/verifier/
render/attempt units; an invariant companion that rejects malformed
`jspace/state` streams before commit; a real-agent-loop suite (mock adapter)
proving the advisory fires on retry-of-failed, is silent in fast mode, and that
the ledger becomes a model-visible user-role snapshot that survives later
writes; and a real Loader composition proving the feature flag, the completion
gate, tier forcing, and fail-loud config validation end to end. The host
aggregate typechecks clean, the persistence catalog was regenerated for the new
event type, and `scripts/benchmarks/jspace-ab` provides the reproducible A/B
harness (tokens, tool calls, repeated calls, failed attempts, wall time) that
also documents the real-model path.

## Alternatives considered

**Always-visible state in the system prompt.** Rejected: it would alter the
first-round interface DeepSeek is sensitive to and tax every request
permanently; the existing dynamic-context projection gives the same recovery
guarantee with zero cost before the first write.

**Persist every failure as a ledger event by default.** Rejected: the retry
guard stays in-memory-advisory (accepted cost of a mistaken nudge), and durable
failure records are opt-in via `persistFailedAttempts` or model curation.

**Reuse `ctx.goals` as the goal source.** Rejected for now: it couples the
controller to the goal package and its activation machinery; the ledger keeps a
compatible compact restatement and documents keeping them in sync.
