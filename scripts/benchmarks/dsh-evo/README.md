# DSH-EVO benchmark suite

Evidence-driven evaluation of harness changes on the DSH-EVO program under a
scripted model (no external API key required).

## Run the core runner

    node scripts/benchmarks/dsh-evo/runners/run-task.mjs <task-id> [--use-jspace]

Static inputs come from `datasets/tasks.json` and `datasets/splits.json`.
Runtime results are written under `results/` (git-ignored).

## Layout

- `runners/run-task.mjs` - deterministic task runner (scripted model + oracles)
- `build-verifier-dataset.mjs` - generator for verifier calibration inputs
- `datasets/` - static task corpus and splits
- `MANIFEST-*.md` / `REPORT.md` / `*-CALIBRATION.md` - analysis narrative
- `results/` - runtime output (git-ignored)

The real-model A/B harness lives in `scripts/benchmarks/jspace-ab/real/`.
