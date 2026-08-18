import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const HERE = dirname(fileURLToPath(import.meta.url))
const p = join(HERE, 'results/B0-dev.jsonl')
const rows = readFileSync(p, 'utf8').split(/\n/).filter(l => l.startsWith('{')).map(JSON.parse)
const last = new Map()
for (const r of rows) last.set(r.id, r)
const clean = [...last.values()]
writeFileSync(p, clean.map(r => JSON.stringify({ id: r.id, difficulty: r.difficulty, type: r.type, origin: r.origin, status: r.status, wallMs: r.wallMs })).join('\n') + '\n')
console.log('B0-dev una por tarea:', clean.length, '| pass=' + clean.filter(r => r.status === 'pass').length + ' fail=' + clean.filter(r => r.status === 'fail').length + ' timeout=' + clean.filter(r => r.status === 'timeout').length)
console.log('fail ids:', clean.filter(r => r.status !== 'pass').map(r => r.id + ':' + r.status).join(', ') || 'ninguno')
const totalMs = clean.reduce((a, r) => a + r.wallMs, 0)
console.log('wall total:', totalMs, 'ms | media:', Math.round(totalMs / clean.length), 'ms/tarea')
