import { readFileSync, appendFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import yaml from '/home/diez/.nvm/versions/node/v24.16.0/lib/node_modules/@deepseek-ai/dsh/node_modules/js-yaml/index.js'
import { buildVerifierPrompt, parseVerifierScore } from '/home/diez/Documentos/deepseekharness/harness/packages/context/jspace/src/verifier-scorer.ts'
const HERE = dirname(fileURLToPath(import.meta.url))
const key = yaml.load(fs.readFileSync('/home/diez/.dsh/.credentials.yaml', 'utf8')).OPENCODE_GO_API_KEY
const all = JSON.parse(readFileSync(join(HERE, 'datasets/verifier-calibration.json'), 'utf8'))
// fixed holdout (never used for the rounds decision)
const HOLD = new Set(['t01-reverse-good', 't05-eval-good', 't09-word-count-good', 't16-minstack-good',
  't02-fizzbuzz-tests-fail', 't07-anagram-no-evidence', 't14-password-stale', 't18-wildcard-premature'])
// sample: all 30 good; bad: 30 spread across classes
const good = all.filter(c => c.gold && !HOLD.has(c.id))
const badPool = all.filter(c => !c.gold && !HOLD.has(c.id))
const classes = {}
for (const c of badPool) classes[c.class] = classes[c.class] ?? []
for (const c of badPool) classes[c.class].push(c)
const bad = []
for (const [k, v] of Object.entries(classes)) {
  const per = Math.max(1, Math.ceil(30 / Object.keys(classes).length))
  const chosen = v.slice(0, per)
  bad.push(...chosen)
}
const sample = [...good, ...bad].slice(0, 60)
async function one(c) {
  const p = buildVerifierPrompt(c.goal, [], c.evidence, ['Correctness', 'Completeness', 'Constraint preservation'])
  try {
    const r = await fetch('https://opencode.ai/zen/go/v1/chat/completions', { method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify({ model: 'deepseek-v4-flash', messages: [{ role: 'system', content: p.system }, { role: 'user', content: p.user }], max_tokens: 8 }) })
    const j = await r.json()
    return parseVerifierScore(j?.choices?.[0]?.message?.content ?? '')
  } catch (e) { return undefined }
}
const rows = []
for (const c of sample) {
  const s = [await one(c), await one(c), await one(c)]
  rows.push({ id: c.id, gold: c.gold, cls: c.class, s: s.map(x => x ?? -1) })
  appendFileSync(join(HERE, 'results/verifier-r2.rawl'), JSON.stringify({ id: c.id, gold: c.gold, cls: c.class, s }) + String.fromCharCode(10))
}
// aggregate per rounds variant
function stat(rounds, pick) {
  let ta = 0, tr = 0, fa = 0, fr = 0, undef = 0
  for (const r of rows) {
    const use = r.s.slice(0, rounds).filter(x => x !== -1)
    if (use.length === 0) { undef++; if (r.gold) fa++; else tr++; continue }
    const agg = pick === 'min' ? Math.min(...use) : use[0]
    if (r.gold) { if (agg >= 3) ta++; else fr++ } else { if (agg >= 3) fa++; else tr++ }
  }
  const nBad = rows.filter(r => !r.gold).length, nGood = rows.filter(r => r.gold).length
  const favg = fa / nBad, frv = fr / nGood
  return { rounds, pick, n: rows.length, ta, tr, fa, fr, undef,
    falseAccept: favg, falseReject: frv,
    balancedAcc: (((ta / nGood) + (tr / nBad)) / 2) }
}
for (const v of [ { rounds: 1, pick: 'first' }, { rounds: 2, pick: 'min' }, { rounds: 3, pick: 'min' } ]) {
  const s = stat(v.rounds, v.pick)
  console.log('V' + v.rounds, JSON.stringify(s))
}
