# E2E: verifier operating through the real harness (E2 integration)

_Run 2026-08-18, flash@max, disposable profile evo-e2e = headless bundles + jspace(verifierEnabled, minScore 3, verifierRounds 3) + protocol-trace._

## How to reproduce
```bash
cp -r ~/.dsh/profiles/headless ~/.dsh/profiles/evo-e2e
# write the cordis.patch.yml insert (jspace with verifier + protocol-trace) and add the two
# package names to the profile package.json dependencies (see MANIFEST-001.md).
cd <fixture-dir> && dsh --profile evo-e2e '<task prompt>'
```

## Task A (good path) — 18 s
- `prog.py` already correct; task: ledger -> run python3 -> finish with real output.
- `jspace_finish` returned **`{complete:true, verifierScore:4}`**.

## Task B (honestly-failing intent) — 33 s
- `prog.py` has a precedence bug (`3 + 5 * 2` misparsed); at most one fix attempt then finish.
- flash@max actually FIXED precedence in one attempt (`HARD=13`, assert passes).
- First `jspace_finish` call was **rejected by the deterministic gate** in live use
  (`documented item is not an open item: inspect/fix/verify`) — premature completion blocked.
- Final finish: **`{complete:true, verifierScore:4}`** (genuine, verified completion accepted).

## Interpretation
- The integrated `jspace_finish` -> verifier (min-of-3) -> completion path works end-to-end through
  the real agent loop and real LLM calls; a genuine verified completion is accepted (score 4).
- The live **verifier REJECTION** (`JSPACE_VERIFIER_LOW`) was not observed here because flash@max kept
  fixing rather than honestly reporting a failing test; rejection behavior is covered by the
  calibration probe (deterministic bad evidence -> score 0) and the gate unit path.
- Observable side effect: the completion gate blocks premature finishes in real use (seen live).
