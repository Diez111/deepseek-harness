# @deepseek-ai/dsh-protocol-trace

English | [中文](README.zh.md)

Per-request protocol trace (observability). A function plugin that watches the durable `session/event` stream and appends one `session/protocol-trace` event per model request, recording the route snapshot from `request/header` (`provider`, `model`, `reasoningEffort`, `maxTokens`, `temperature`) merged with the assembled `assistant/message` (reasoning presence, tool-call count, usage, prefix-cache fields). Purely observational: it changes no behavior, emits no model-visible input, and only writes to the session log.

This is the Native Contract Guard seed of the DSH-EVO baseline: it makes contract facts (route honored, reasoning preserved, cache fields present or absent, token usage) observable per request and reconstructable from the log.

## Config
```yaml
- insert:
    - id: protocol-trace
      name: '@deepseek-ai/dsh-protocol-trace'
      config:
        enabled: true      # false restores baseline exactly
        complexityNote: true # one passive complexity estimate per session first message (0 tokens)
```

## Model Experience

### Tool behavior

No tools, no prompts, no model-visible input. One extra durable session event per assistant message (~100-200 bytes) so nothing here consumes inference tokens; the only cost is the negligible log write.

#### Token effect

Zero added prompt or completion tokens; the packet is stored, never sent to a model.

#### KV Cache effect

None. No request prefix is altered or reordered.

## Known Limitations and Deferred Work

- **Wire-layer coverage is partial**: the trace records what the harness itself assembles (route config, usage, reasoning presence). Fields silently dropped by the upstream gateway (top_logprobs distribution, cache tokens) are NOT observable here; they are captured by the one-off wire audit in scripts/benchmarks/dsh-evo/BASELINE.md.
- **Listener wiring is the standard `ctx.on('session/event', ..., { global: true })`**: logic is unit-tested via the exported `onSessionEvent`; the thin wiring follows the same pattern as the session projection registry.
- **No per-evaluation aggregation yet**: the trace emits raw facts; aggregation and routing calibration are deferred to the router phase.
- **Complexity note is measure-first**: `session/complexity-note` predicts a tier (`trivial`/`standard`/`deep`) from cheap heuristics on the first user message; it NEVER changes effort or budget and is not a validated router (`complexityNote: false` restores baseline).
