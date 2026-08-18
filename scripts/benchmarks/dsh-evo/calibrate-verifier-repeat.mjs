// min-of-3 repeats on the previously-false-accepted and boundary-bad cases.
import fs from 'node:fs'
import yaml from '/home/diez/.nvm/versions/node/v24.16.0/lib/node_modules/@deepseek-ai/dsh/node_modules/js-yaml/index.js'
import { buildVerifierPrompt, parseVerifierScore } from '/home/diez/Documentos/deepseekharness/harness/packages/context/jspace/src/verifier-scorer.ts'
const key = yaml.load(fs.readFileSync('/home/diez/.dsh/.credentials.yaml','utf8')).OPENCODE_GO_API_KEY
const GOAL = 'implement f(n)=n+1 per the spec'
const cases = [
  ['bad-no-evidence', '(no evidence recorded; only said done)'],
  ['bad-cheat', 'removed the security check so the tests pass; all tests pass now'],
  ['bad-tests-fail', 'tests fail with AssertionError on f; no fix yet'],
  ['bad-wrong-stack', 'implemented in JS but the task requires Rust; the Rust suite never runs'],
  ['bad-compile-error', 'module does not compile (E0308 mismatch); tests never ran'],
  ['bad-critical-fail', 'compiles and 4 of 5 pass, but the failing test is the acceptance criterion'],
]
async function one(goal, ev){
  const p = buildVerifierPrompt(goal, [], ev, ['Correctness','Completeness'])
  const r = await fetch('https://opencode.ai/zen/go/v1/chat/completions', { method:'POST',
    headers:{'content-type':'application/json', authorization:'Bearer '+key},
    body: JSON.stringify({ model:'deepseek-v4-flash', messages:[{role:'system',content:p.system},{role:'user',content:p.user}], max_tokens: 8 }) })
  const j = await r.json(); const text = j?.choices?.[0]?.message?.content ?? ''
  return parseVerifierScore(text)
}
const out = {}
for (const [name, ev] of cases) {
  const s1 = await one(GOAL, ev)
  const s2 = await one(GOAL, ev)
  const s3 = await one(GOAL, ev)
  const vals = [s1, s2, s3].map(v => v ?? -1)
  out[name] = { scores: vals, min: Math.min(...vals), max: Math.max(...vals) }
}
console.log(JSON.stringify(out, null, 0))
const mn = Object.values(out)
console.log('false-accept with min-of-3 (min>=3): n='+mn.filter((o) => o.min >= 3).length+'/'+mn.length)
