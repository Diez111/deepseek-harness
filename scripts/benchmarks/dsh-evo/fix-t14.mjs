import { readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const HERE = dirname(fileURLToPath(import.meta.url))
const t14Oracle = "import importlib.util\nspec=importlib.util.spec_from_file_location('sol','src/solution.py'); sol=importlib.util.module_from_spec(spec); spec.loader.exec_module(sol)\nfor a,b in [('abc123a',False),('ABCcba321123',False),('Az9zA9AAAZ',False),('a1B1A1b1a',False),('aaaaaaaa',False),('A1bCCb1A',True),('9XyzzyX9',True)]:\n    assert sol.password_ok(a)==b, (a,sol.password_ok(a),b)\nprint('PASS')\n"
const p = join(HERE, 'datasets/tasks.json')
const tasks = JSON.parse(readFileSync(p, 'utf8'))
const t14 = tasks.find(k => k.id === 't14-password')
const changed = t14.oracle !== t14Oracle
if (changed) t14.oracle = t14Oracle
writeFileSync(p, JSON.stringify(tasks, null, 2))
console.log('oracle t14 changed:', changed)
const { runTask } = await import(join(HERE, 'runners/run-task.mjs'))
const r = runTask(t14, { profile: 'headless', timeoutMs: 240000 })
appendFileSync(join(HERE, 'results/B0-dev.jsonl'), JSON.stringify(r) + '\n')
const rows = readFileSync(join(HERE, 'results/B0-dev.jsonl'), 'utf8').split(/\n/).filter(l => l.startsWith('{')).map(JSON.parse)
const last = rows.filter(x => x.id === 't14-password').slice(-1)[0]
console.log('t14 status:', last?.status, last?.wallMs + 'ms', '| oracleOut:', last?.oracleOut)
const pass = rows.filter(x => x.status === 'pass').length
const fail = rows.filter(x => x.status === 'fail').length
console.log('B0-dev (rows=' + rows.length + '): pass=' + pass + ' fail=' + fail)
