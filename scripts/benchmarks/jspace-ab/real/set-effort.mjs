// Set agent-default-model.reasoningEffort in ~/.dsh/settings.yaml. Usage: node set-effort.mjs <high|max>
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
const eff = process.argv[2]
if (!['high', 'max', 'low'].includes(eff)) { console.error('effort must be high|max|low'); process.exit(2) }
const home = process.env.DSH_HOME ?? join(os.homedir(), '.dsh')
const p = join(home, 'settings.yaml')
const before = readFileSync(p, 'utf8')
const next = before.replace(/(reasoningEffort:\s*)[A-Za-z]+/, '$1' + eff)
if (next === before) {
  console.error('settings.yaml has no reasoningEffort entry to patch: ' + p)
  process.exit(3)
}
writeFileSync(p, next)
console.log('effort set to', eff, 'in', p)
