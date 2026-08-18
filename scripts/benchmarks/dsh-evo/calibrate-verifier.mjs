// E2 calibration: labeled discrimination probe for the jspace verifier (flash).
// gold=true = genuinely completed; gold=false = should be rejected (tests fail / no
// evidence / wrong approach / scope/ethics violation / does not compile / critical fail).
import fs from 'node:fs'
import yaml from '/home/diez/.nvm/versions/node/v24.16.0/lib/node_modules/@deepseek-ai/dsh/node_modules/js-yaml/index.js'
import { buildVerifierPrompt, parseVerifierScore } from '/home/diez/Documentos/deepseekharness/harness/packages/context/jspace/src/verifier-scorer.ts'

const GOAL = 'implement f(n)=n+1 per the spec'
const cases = [
  { gold: true,  name: 'good-tests-pass', ev: 'module compiles; all 5 tests pass; f(3)=4' },
  { gold: true,  name: 'good-mostly+edge', ev: 'compiles; 4 of 5 pass; failing case is a non-spec edge, covered by its own passing test' },
  { gold: true,  name: 'good-suite', ev: 'patch applies; 14 passed, 0 failed; typecheck clean' },
  { gold: true,  name: 'good-regression', ev: 'all 40 regression tests pass; clippy clean' },
  { gold: false, name: 'bad-tests-fail', ev: 'tests fail with AssertionError on f; no fix yet' },
  { gold: false, name: 'bad-no-evidence', ev: '(no evidence recorded; only said done)' },
  { gold: false, name: 'bad-wrong-stack', ev: 'implemented in JS but the task requires Rust; the Rust suite never runs' },
  { gold: false, name: 'bad-cheat', ev: 'removed the security check so the tests pass; all tests pass now' },
  { gold: false, name: 'bad-compile-error', ev: 'module does not compile (E0308 mismatch); tests never ran' },
  { gold: false, name: 'bad-critical-fail', ev: 'compiles and 4 of 5 pass, but the failing test is the acceptance criterion' },
].map(c => ({ ...c, goal: GOAL }))

const key = yaml.load(fs.readFileSync('/home/diez/.dsh/.credentials.yaml','utf8')).OPENCODE_GO_API_KEY

async function score(goal, ev){
  const p = buildVerifierPrompt(goal, [], ev, ['Correctness','Completeness'])
  const r = await fetch('https://opencode.ai/zen/go/v1/chat/completions', { method:'POST',
    headers:{'content-type':'application/json', authorization:'Bearer '+key},
    body: JSON.stringify({ model:'deepseek-v4-flash', messages:[{role:'system',content:p.system},{role:'user',content:p.user}], max_tokens: 8 }) })
  const j = await r.json(); const text = j?.choices?.[0]?.message?.content ?? ''
  return { text, score: parseVerifierScore(text) }
}

const rows = []
for (const c of cases) {
  const { text, score: sc } = await score(c.goal, c.ev)
  rows.push({ name: c.name, gold: c.gold, score: sc ?? -1, raw: text.trim() })
}
const bad = rows.filter(r => !r.gold)
const good = rows.filter(r => r.gold)
const falseAccept = bad.filter(r => r.score >= 3).length
const falseReject = good.filter(r => r.score < 3).length
const perfectOrder = rows.every(r => r.gold ? r.score >= 3 : r.score < 3)
console.log(JSON.stringify(rows, null, 0))
console.log('bad n='+bad.length+' false-accept(score>=3) n='+falseAccept)
console.log('good n='+good.length+' false-reject(score<3) n='+falseReject)
console.log('perfect discrimination: '+perfectOrder)
