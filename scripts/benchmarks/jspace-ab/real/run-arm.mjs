#!/usr/bin/env node
// Real-model A/B arm runner. Usage: node run-arm.mjs <effort|max|high>
// Runs each task from tasks.json in a fresh temp dir (fixtures written), times it,
// checks the expected marker in the final answer, and prints one line per task.
// Requires `dsh --profile headless` to resolve the opencode-go credential.
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const effort = process.argv[2]
if (!['max', 'high'].includes(effort)) { console.error('usage: node run-arm.mjs <max|high>'); process.exit(2) }
const here = fileURLToPath(new URL('.', import.meta.url))
const tasks = JSON.parse(readFileSync(join(here, 'tasks.json'), 'utf8'))
const DSH = '/home/diez/.nvm/versions/node/v24.16.0/bin/dsh'
const results = []
for (const task of tasks) {
  const wd = mkdtempSync(join(tmpdir(), 'jspace-ab-'))
  for (const [name, content] of Object.entries(task.fixture ?? {})) writeFileSync(join(wd, name), content)
  const t0 = performance.now()
  const run = spawnSync(DSH, ['--profile', 'headless', task.prompt], { cwd: wd, timeout: 300_000, encoding: 'utf8' })
  const ms = Math.round(performance.now() - t0)
  const out = (run.stdout ?? '') + (run.stderr ?? '')
  const ok = out.includes(task.marker)
  results.push({ effort, id: task.id, ok, ms, rc: run.status })
  console.log(JSON.stringify({ effort, id: task.id, ok, ms, rc: run.status }))
  console.log('  tail:', out.split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 200))
  rmSync(wd, { recursive: true, force: true })
}
const ok = results.filter(r => r.ok).length
const avg = results.length ? Math.round(results.reduce((a, r) => a + r.ms, 0) / results.length) : 0
console.log(`ARM[${effort}] success=${ok}/${results.length} avg_wall_ms=${avg} ` + JSON.stringify(results.map(r => ({ id: r.id, ok: r.ok }))))
