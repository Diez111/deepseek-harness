# `dsh-evo-evidence`: Evidence Vault (DSH-EVO Stage 3)

## Status: implemented, feature-flagged off, not shipped

## Why

Stage 3 of the DSH-EVO program calls for an external-to-context evidence store with
invalidation; no existing DSH primitive covers it (the jspace ledger is compact and
in-context; session persistence is the durable log). The vault stores exact evidence
with metadata and marks entries stale when an edited file intersects.

## Mechanism

- Function plugin (name/Config/apply, no default export), `inject: ['tools']`.
- Tools `evidence_store`/`evidence_get`/`evidence_list`; entries persisted as
  `session/evidence-op` ops replayed from the session log (no second database).
- Staleness: a session `tool/call` for an edit tool marks dependent fresh entries stale.
- Default `enabled: false`; composing the row without config equals the baseline.

## Why not mounted

- Per the program rule, plugin-funciona != model-resuelve: the plugin is validated only
  through the dev benchmark comparison, not shipped pre-emptively. Test-host note: the
  repo test host did not expose the `tools` service to a Loader/direct composition for
  this package; logic is covered by pure ops tests and the benchmark is the arbiter.
