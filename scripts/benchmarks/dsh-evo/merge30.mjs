import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const HERE = dirname(fileURLToPath(import.meta.url))
const base = JSON.parse(readFileSync(join(HERE, 'datasets/tasks.json'), 'utf8'))
const ex1 = JSON.parse(readFileSync(join(HERE, 'datasets/tasks-extra.json'), 'utf8'))
const ex2 = JSON.parse(readFileSync(join(HERE, 'datasets/tasks-extra2.json'), 'utf8'))
let all = [...base, ...ex1, ...ex2]
// patch t26 sloppy oracle line
const t26 = all.find(t => t.id === 't26-nearest-point')
t26.oracle = t26.oracle.replace("assert sol.nearest([0,0],[[]])==None or sol.nearest([0,0],[[0,0]])==[0,0]", "assert sol.nearest([0,0],[[0,0]])==[0,0]")
const seed = 20260818
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296}}
const rnd = mulberry32(seed)
const ids = all.map(t => t.id)
for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]] }
const dev = ids.slice(0, 15), val = ids.slice(15, 23), sealed = ids.slice(23)
all.forEach(t => { t.split = dev.includes(t.id) ? 'dev' : val.includes(t.id) ? 'val' : 'sealed' })
writeFileSync(join(HERE, 'datasets/splits.json'), JSON.stringify({ seed, split: { dev, val, sealed } }, null, 2))
writeFileSync(join(HERE, 'datasets/tasks.json'), JSON.stringify(all, null, 2))
const c = { total: all.length, dev: dev.length, val: val.length, sealed: sealed.length }
const dist = {}
for (const t of all) dist[t.difficulty] = (dist[t.difficulty] ?? 0) + 1
console.log('total', c.total, 'dificultad', JSON.stringify(dist))
console.log('sealed:', sealed.join(','))
