import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const HERE = dirname(fileURLToPath(import.meta.url))
const base = JSON.parse(readFileSync(join(HERE, 'datasets/tasks.json'), 'utf8'))
const seen = new Set(); const uniq = []
for (const t of base) { if (!seen.has(t.id)) { seen.add(t.id); uniq.push(t) } }
const seed = 20260818
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296}}
const rnd = mulberry32(seed)
const ids = uniq.map(t => t.id)
for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]] }
const dev = ids.slice(0, 15), val = ids.slice(15, 23), sealed = ids.slice(23)
uniq.forEach(t => { t.split = dev.includes(t.id) ? 'dev' : val.includes(t.id) ? 'val' : 'sealed' })
writeFileSync(join(HERE, 'datasets/splits.json'), JSON.stringify({ seed, split: { dev, val, sealed } }, null, 2))
writeFileSync(join(HERE, 'datasets/tasks.json'), JSON.stringify(uniq, null, 2))
const dist = {}; for (const t of uniq) dist[t.difficulty] = (dist[t.difficulty] ?? 0) + 1
console.log('total', uniq.length, 'dificultad', JSON.stringify(dist), '| dev', dev.length, 'val', val.length, 'sealed', sealed.length)
const dup = uniq.length - seen.size
console.log('sealed:', sealed.join(','))
