// holdout-verifier.mjs: frozen-config validation (rounds=3, min) on the 8 reserved ids.
import { readFileSync, appendFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import yaml from '/home/diez/.nvm/versions/node/v24.16.0/lib/node_modules/@deepseek-ai/dsh/node_modules/js-yaml/index.js'
import { buildVerifierPrompt, parseVerifierScore } from '/home/diez/Documentos/deepseekharness/harness/packages/context/jspace/src/verifier-scorer.ts'
const HERE = dirname(fileURLToPath(import.meta.url))
const key = yaml.load(fs.readFileSync('/home/diez/.dsh/.credentials.yaml', 'utf8')).OPENCODE_GO_API_KEY
const all = JSON.parse(readFileSync(join(HERE, 'datasets/verifier-calibration.json'), 'utf8'))
const HOLD = ['t01-reverse-good','t05-eval-good','t09-word-count-good','t16-minstack-good','t02-fizzbuzz-tests-fail','t07-anagram-no-evidence','t14-password-stale','t18-wildcard-premature']
const cases = HOLD.map(id => all.find(c => c.id === id)).filter(Boolean)
async function one(c) {
  const p = buildVerifierPrompt(c.goal, [], c.evidence, ['Correctness','Completeness','Constraint preservation'])
  try {
    const r = await fetch('https://opencode.ai/zen/go/v1/chat/completions', { method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify({ model: 'deepseek-v4-flash', messages: [{ role: 'system', content: p.system }, { role: 'user', content: p.user }], max_tokens: 8 }) })
    const j = await r.json()
    return parseVerifierScore(j?.choices?.[0]?.message?.content ?? '')
  } catch { return undefined }
}
const rows = []
for (const c of cases) {
  const s = [await one(c), await one(c), await one(c)].map(x => x ?? -1)
  rows.push({ id: c.id, gold: c.gold, cls: c.class, min: Math.min(...s), s })
  appendFileSync(join(HERE, 'results/verifier-holdout.rawl'), JSON.stringify({ id: c.id, gold: c.gold, cls: c.class, s }) + String.fromCharCode(10))
}
const good = rows.filter(r => r.gold), bad = rows.filter(r => !r.gold)
const fa = bad.filter(r => r.min >= 3).length, fr = good.filter(r => r.min < 3).length
console.log('holdout (frozen rounds=3): n=' + rows.length + ' good=' + good.length + ' bad=' + bad.length)
console.log('false-accept=' + fa + '/' + bad.length + ' false-reject=' + fr + '/' + good.length)
console.log(rows.map(r => r.id + ':' + r.gold + ':' + r.min).join(', '))
