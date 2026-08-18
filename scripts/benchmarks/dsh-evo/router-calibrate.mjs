// router-calibrate.mjs: predicted tier (complexity-note heuristic) vs measured cost.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { predictComplexityTier } from '/home/diez/Documentos/deepseekharness/harness/packages/context/dsh-protocol-trace/src/index.ts'
const HERE = dirname(fileURLToPath(import.meta.url))
const tasks = JSON.parse(readFileSync(join(HERE, 'datasets/tasks.json'), 'utf8'))
const rows = readFileSync(join(HERE, 'results/B0-dev2.jsonl'), 'utf8').split(String.fromCharCode(10)).filter(l => l.startsWith('{')).map(JSON.parse)
const wall = {}; for (const r of rows) wall[r.id] = r
const out = []
for (const t of tasks) {
  const pred = predictComplexityTier(t.problem)
  const m = wall[t.id]
  if (!m) continue
  out.push({ id: t.id, difficulty: t.difficulty, pred, wallMs: m.wallMs, status: m.status })
}
const med = (xs) => { const a=[...xs].sort((x,y)=>x-y); const i=a.length>>1; return a.length%2?a[i]:(a[i-1]+a[i])/2 }
const tiers = {}
for (const o of out) { tiers[o.pred] = tiers[o.pred] ?? { count:0, walls: [] }; tiers[o.pred].count++; tiers[o.pred].walls.push(o.wallMs) }
console.log('tier | n | mediana wall_ms | dureza real (difficulty)')
for (const k of ['trivial','standard','deep']) {
  const x = tiers[k]
  if (!x) continue
  const diff = out.filter(o => o.pred === k).map(o => o.difficulty)
  console.log(k.padEnd(10) + x.count + ' ' + Math.round(med(x.walls)).toString().padStart(6) + 'ms  ' + JSON.stringify(diff.reduce((a,d)=>(a[d]=(a[d]??0)+1,a),{})))
}
writeFileSync(join(HERE, 'results/router-calib.json'), JSON.stringify(out, null, 2))
