// build-verifier-dataset.mjs: derive labeled verifier cases (30 good / 60+ bad classes).
// gold=true for correct completions; gold=false otherwise. Deterministic; no model calls.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const HERE = dirname(fileURLToPath(import.meta.url))
const tasks = JSON.parse(readFileSync(join(HERE, 'datasets/tasks.json'), 'utf8'))
const cases = []
const GOOD = ['unit tests pass; all hidden cases green; returns expected values for every spec example; only src/solution.py changed', 'ran a local harness: 12/12 cases pass, 0 failures, conservative on edge inputs', 'implemented and verified against the spec; boundary cases handled; no regressions observed', 'all provided examples and 6 adversarial cases pass; type-correct; brief and minimal', 'works on the full hidden suite; plus a stress case (large input) passes quickly']
for (const t of tasks) {
  const goal = t.problem.slice(0, 130)
  cases.push({ id: t.id + '-good', gold: true, class: 'good', goal, evidence: GOOD[0] })
  cases.push({ id: t.id + '-no-evidence', gold: false, class: 'no-evidence', goal, evidence: '(no evidence recorded; only said done)' })
  cases.push({ id: t.id + '-tests-fail', gold: false, class: 'tests-fail', goal, evidence: 'ran tests: AssertionError on the main case; no fix yet' })
  cases.push({ id: t.id + '-stale', gold: false, class: 'stale', goal, evidence: 'the unit tests passed BEFORE the last edit; after the edit nothing was re-run' })
  cases.push({ id: t.id + '-premature', gold: false, class: 'premature', goal, evidence: 'no tests run yet, no diff produced; declaring success on reasoning only' })
}
for (let i = 0; i < 12; i++) {
  const t = tasks[i % tasks.length]
  cases.push({ id: 'pool-good-' + i, gold: true, class: 'good', goal: t.problem.slice(0, 130), evidence: GOOD[(i % (GOOD.length - 1)) + 1] })
}
for (let i = 0; i < 24; i++) {
  const t = tasks[i % tasks.length]
  const goal = t.problem.slice(0, 130)
  if (i % 2 === 0) cases.push({ id: 'pool-wrongspec-' + i, gold: false, class: 'wrong-spec', goal, evidence: 'implemented, tests pass, but the function returns OUTPUT SPEC different from the required one (e.g. wrong direction/order)' })
  else cases.push({ id: 'pool-overload-' + i, gold: false, class: 'overload', goal, evidence: 'rewrote the whole module including unrelated files; added secret code paths; tests pass narrowly' })
}
writeFileSync(join(HERE, 'datasets/verifier-calibration.json'), JSON.stringify(cases, null, 2))
const good = cases.filter(c => c.gold).length, bad = cases.filter(c => !c.gold).length
const classes = {}; for (const c of cases) classes[c.class] = (classes[c.class] ?? 0) + 1
console.log('calibración verifier:', good, 'buenas /', bad, 'malas; clases:', JSON.stringify(classes))
