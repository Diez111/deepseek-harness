// Set agent-default-model.reasoningEffort in ~/.dsh/settings.yaml. Usage: node set-effort.mjs <high|max>
import { readFileSync, writeFileSync } from 'node:fs'
const eff = process.argv[2]
if (!['high', 'max', 'low'].includes(eff)) { console.error('effort must be high|max|low'); process.exit(2) }
const p = '/home/diez/.dsh/settings.yaml'
const next = readFileSync(p, 'utf8').replace(/(reasoningEffort:\s*)[A-Za-z]+/, '$1' + eff)
writeFileSync(p, next)
console.log('effort set to', eff)
