# @deepseek-ai/dsh-evo-evidence

English | [中文](README.zh.md)

Evidence Vault for the DSH-EVO program: an external-to-context store of exact evidence (command outputs, compiler errors, test results, diffs, decisions) with per-entry metadata, file-hash invalidation and selective retrieval. Entries are persisted as durable `session/evidence-op` events (reconstructed from the session log — no second storage layer).

## Config
```yaml
- insert:
    - id: dsh-evo-evidence
      name: '@deepseek-ai/dsh-evo-evidence'
      config:
        enabled: true   # false (default) restores baseline exactly
        maxEntries: 200
        maxBytes: 8192
        editToolNames: ['str-replace-editor', 'edit', 'apply-edit', 'patch']
```

## Tools
- `evidence_store` (type, source, command?, files?, content) -> id E###; content truncated at maxBytes.
- `evidence_get` (id) -> exact content + status.
- `evidence_list` (status?) -> compact ids (no content) to keep context small.
Automatic staleness: a file-edit tool call marks fresh entries that depend on the edited file as `stale`.

## Model Experience
No prompt changes; adds three optional tools and one extra durable event per entry. Not shipped: default `enabled: false`; the plugin is not composed in any profile until validated on the dev benchmark (feature-flag off = baseline).

#### Token / KV Cache effect
Zero until enabled; when enabled, only the tokens the model spends reading returned evidence.

## Known Limitations and Deferred Work
- In-memory per session plus log-replay; no separate database (intentional: reuse session persistence).
- Staleness keys on the file-edit argument (`file`/`path`/`oldPath`); multi-file edits collapse to the first file seen.
- Holdout: not benchmark-validated yet; validation is the dev/validation comparison, not unit tests.
