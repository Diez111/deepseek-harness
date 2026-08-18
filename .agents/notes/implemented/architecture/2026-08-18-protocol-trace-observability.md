# `dsh-protocol-trace`: per-request observability (DSH-EVO E1)

## Status: implemented (rc.7), installed, enabled in web profile

## Why

The DSH-EVO baseline made one-off wire audit facts visible (top_logprobs not relayed, cache fields absent), but no durable per-request telemetry existed: contract drift (route/effort ignored, reasoning dropped, cache appearing/disappearing) would go unobserved and be misattributed to the model. E1 turns audit facts into a logged stream.

## Mechanism

- Function plugin (`name`/`Config`/`apply`, no default export) registering `ctx.on('session/event', ..., { global: true })`.
- `onSessionEvent(session, event, state)` is the exported, unit-tested discriminator: `request/header` caches the route (`provider`, `model`, `reasoningEffort`, `maxTokens`, `temperature`); `assistant/message` appends one `session/protocol-trace` event with route + reasoning presence, tool-call count, usage, and cache fields.
- Wire facts the harness cannot see (gateway-dropped top_logprobs/cache) stay in the wire audit; the plugin records what the harness owns.

## Why this stays thin

- The listener body is the standard projection-registry pattern; the discrimination is a pure exported function, so the (unreproducible-in-test) session/event dispatch does not gate the logic tests.
- Feature-flag `enabled` (default true once composed); `false` restores baseline exactly.
- No aggregation yet; the router phase consumes these raw facts.
