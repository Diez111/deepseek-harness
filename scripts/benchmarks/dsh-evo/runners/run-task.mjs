// run-task.mjs: execute one dataset task against a dsh profile, then grade with the
// independent oracle. Status: pass | fail | timeout | infrastructure_error.
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

const DSH = process.env.DSH_BIN ?? '/home/diez/.nvm/versions/node/v24.16.0/bin/dsh'
const HERE = dirname(fileURLToPath(import.meta.url))
const TASKS = JSON.parse(readFileSync(join(HERE, '../datasets/tasks.json'), 'utf8'))

export function runTask(task, { profile = 'headless', timeoutMs = 240000 } = {}) {
  const wd = mkdtempSync(join(tmpdir(), 'dshevo-task-'))
  try {
    for (const [rel, content] of Object.entries(task.files)) {
      const full = join(wd, rel); mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, content)
    }
    writeFileSync(join(wd, 'problem.md'), task.problem)
    const t0 = performance.now()
    const run = spawnSync(DSH, ['--profile', profile, task.problem], { cwd: wd, timeout: timeoutMs, encoding: 'utf8' })
    const wallMs = Math.round(performance.now() - t0)
    const agentTimedOut = run.status === 124 || (run.error && run.error.code === 'ETIMEDOUT')
    writeFileSync(join(wd, 'oracle.py'), task.oracle)
    const grade = spawnSync('python3', ['oracle.py'], { cwd: wd, timeout: 20000, encoding: 'utf8' })
    const gradeTimedOut = grade.status === 124
    const status = agentTimedOut ? 'timeout' : (grade.status === 0 ? 'pass' : (gradeTimedOut ? 'timeout' : 'fail'))
    return {
      id: task.id, difficulty: task.difficulty, type: task.type, origin: task.origin,
      status, wallMs,
      oracleOut: String(grade.stdout ?? '').slice(-120),
      oracleErr: String(grade.stderr ?? '').slice(-250),
      agentTail: String(run.stdout ?? '').slice(-600),
    }
  } catch (err) {
    return { id: task.id, difficulty: task.difficulty, type: task.type, origin: task.origin, status: 'infrastructure_error', error: String(err) }
  } finally {
    rmSync(wd, { recursive: true, force: true })
  }
}

// CLI: node run-task.mjs <taskId> [profile] [timeoutMs]
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const id = process.argv[2]
  const task = TASKS.find(t => t.id === id)
  if (!task) { console.error('task not found:', id, 'known:', TASKS.map(t => t.id).join(',')); process.exit(2) }
  console.log(JSON.stringify(runTask(task, { profile: process.argv[3] ?? 'headless', timeoutMs: Number(process.argv[4] ?? 240000) })))
}
