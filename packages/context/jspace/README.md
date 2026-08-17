# @deepseek-ai/dsh-jspace

English | [中文](README.zh.md)

An opt-in controller for long agentic work, adapted from the ideas of the J-Space
capability report (state that survives compaction, failure-aware retrying,
verification before completion, tiered control). It is a separate module on top
of the existing harness: with `enabled: false` it registers nothing, so the
harness behaves exactly as before. It deliberately complements — and does not
duplicate — the existing goal, todo, repeat-tool-reminder, compaction, and
plan-mode packages; where a mechanism already exists it reuses it instead of
reimplementing it.

## What it adds (when enabled)

- **A compact durable task ledger** (GOAL / CORE / VERIFIED / OPEN / NEXT plus
  bounded failed approaches), event-sourced in the session log and re-injected
  as model-visible runtime context. The loop's runtime-context projection
  re-logs it only when it changes or after compaction, so it stays current,
  survives compaction and resume, and costs zero tokens before the first write.
- **Failure-aware retry guard**: it remembers failed tool calls and injects an
  advisory when the same canonical call is retried — so a failed strategy is
  not silently repeated. Distinct from `repeat-tool-reminder` (which counts
  identical calls regardless of outcome and never records why they failed).
- **A completion gate** (`jspace_finish`): rejects a completion claim until
  every OPEN item is resolved or explicitly documented, verified evidence
  exists when the ledger took action, and the model acknowledges the closure
  checklist (objective satisfied, constraints respected, no ignored known
  errors, no evident regressions). Enforcement happens in the operation that
  makes the decision, not in prose.
- **Tiered control (fast/full/loop/auto)**: the deployment may force a tier; in
  `auto` the ledger itself selects it (no ledger → fast; a goal or open
  problems → loop; otherwise full).

## Config

```yaml
- id: jspace
  name: '@deepseek-ai/dsh-jspace'
  config:
    enabled: true        # default false — the feature flag
    mode: auto           # auto | fast | full | loop
    maxItems: 12         # cap on core/verified/open lists
    maxItemChars: 200
    maxNextChars: 300
    maxFailedItems: 8
    maxReasonChars: 160
    maxStateBytes: 2400  # byte budget of the injected block
    requireVerification: true
    persistFailedAttempts: false  # append detected failures to the durable ledger
    attemptInclude: []            # tool-name patterns tracked by the guard
    attemptExclude: [todo_write, jspace_state, jspace_finish]
    attemptPreviewChars: 200
```

Misconfiguration fails loud at load (`maxItems` beyond the hard ceiling, a
non-positive or non-integer budget, ...).

## Tools

- **jspace_state** — read or update the ledger. List fields (`core`, `verified`,
  `open`, `failed_approaches`) are whole-list replacements; scalar fields
  (`goal`, `next`, `mode`) set or clear. `clear: true` discards the ledger.
  Requires an owning agent session.
- **jspace_finish** — the completion gate described above. Requires the four
  acknowledgement booleans; rejects with the unmet conditions otherwise, and
  marks the ledger `complete` on success.

## Model Experience

### System prompt

#### What the model sees

No system-prompt section is added and the harness identity/persona is untouched.
The only model-facing surface is the two tool schemas plus the dynamic state
block (below). This keeps the first-round interface and persona exactly as the
deployment configured them — the interface the J-Space report calls
"first-round anchored" is preserved.

#### Token effect

Zero tokens while `enabled` is false or when no ledger exists. When enabled,
the two tool schemas add a fixed per-request cost while the tools are visible,
and the state block adds tokens only from the first ledger write onward (bounded
by `maxStateBytes`).

#### KV Cache effect

Tool schemas are prefix-stable. The block is a dynamic runtime context snapshot:
appended after the reusable prefix when its text changes or after compaction,
never invalidating earlier KV entries.

### Dynamic state block

#### What the model sees

Registered through `systemPrompt.context` (name `jspace`), rendered from the
current ledger when the effective tier is full or loop:

```text
<system-reminder>
J-Space task ledger (mode: loop):
GOAL: Implement X
CORE:
- keep C
VERIFIED:
- module A compiles
OPEN:
- fix C
NEXT: investigate foo()
FAILED (do not repeat):
- strategy Y [tool bash] → breaks Z
COMPLETED: no
Keep this compact ledger current with jspace_state; core constraints and failed approaches are durable and replace earlier plans. Open items must be resolved or documented before jspace_finish accepts completion.
</system-reminder>
```

The block renders nothing in `fast` or before the first write. Under a byte
budget the least important trailing sections are dropped, then the tail is
truncated with an omitted marker; the closing frame always fits.

#### Token effect

Bounded by `maxStateBytes`; empty blocks contribute nothing.

#### KV Cache effect

Append-only after the reusable prefix; re-injected automatically when compaction
shadows the prior snapshot.

## Extension points

- The durable ledger folds from `jspace/state` session events (last-write-wins,
  whole value). The loop's runtime-context projection turns the rendered block
  into a durable `user/message` (plugin source) — recovery after compaction and
  resume needs no new mechanism.
- The retry guard listens on `tools/post-execute` and `agent/pre-step` (reset),
  exactly like the advisory repeat-tool guard, so it composes with other
  post-execute listeners (waterfall delegates via `next()`).

## Known Limitations and Deferred Work

- **Fast tier still exposes tool schemas** — a dynamically hidden or scoped tool
  list in `fast`/trivial tasks is not implemented; overhead is the cost of
  keeping the tools available for the model to escalate.
- **The completion gate is a ceremony, not a loop interception** — the harness
  does not detect a model's *final answer* proclaiming "done" without calling
  `jspace_finish`; the gate enforces the checklist only when the tool is used
  (same authority model as the goal tools).
- **Retry memory is in-memory per agent** — it is a nudge, not a logged
  invariant; advising after a mistaken retry is the accepted cost. Failures that
  must survive compaction go into the durable ledger (model curation or
  `persistFailedAttempts`).
- **No external evaluator** — "objective satisfied" and "no regressions" remain
  model acknowledgements, exactly as the goal domain leaves completion judgment
  to the caller. An independent verifier is deferred.
- **Overlap with dsh-goal** — `goal` in the ledger is a compact restatement,
  not another durable-goal database; when both are composed, keep them in sync
  (use `get_goal` for the authoritative objective).
- **Benchmarking is harness-mechanism level** — model-level gains (as the J-Space
  report claims) require a real-model A/B run; the reproducible A/B harness in
  `scripts/benchmarks/jspace-ab` measures tokens, tool calls, repeats, failed
  attempts, and wall time under a scripted model and can be pointed at a real
  provider.
