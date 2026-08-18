import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const HERE = dirname(fileURLToPath(import.meta.url))
const raw = readFileSync(join(HERE, 'results/verifier-r2.rawl'), 'utf8').split(String.fromCharCode(10)).filter(l => l.trim().length > 0).map(JSON.parse)
function wilson(p, n, z = 1.96) {
  const d = 1 + z * z / n
  const c = p + z * z / (2 * n)
  const lo = (c - z * Math.sqrt((p * (1 - p) / n) + (z * z / (4 * n * n)))) / d
  const hi = (c + z * Math.sqrt((p * (1 - p) / n) + (z * z / (4 * n * n)))) / d
  return [lo, hi]
}
function metrics(rounds, pick) {
  let ta = 0, tr = 0, fa = 0, fr = 0, cl = {}
  for (const r of raw) {
    const use = r.s.slice(0, rounds).filter(x => x !== undefined)
    const agg = pick === 'min' ? (use.length ? Math.min(...use) : undefined) : (use[0] ?? undefined)
    const accepted = agg !== undefined ? agg >= 3 : true // fail-open -> accept
    if (r.gold) { if (accepted) ta++; else fr++ } else { if (accepted) fa++; else { tr++; cl[r.cls] = (cl[r.cls] ?? 0) + 1 } }
  }
  const nb = raw.filter(r => !r.gold).length, ng = raw.filter(r => r.gold).length
  const favg = fa / nb
  return { rounds, ta, tr, fa, fr, falseAccept: favg, falseReject: fr / ng, balAcc: ((ta / ng) + (tr / nb)) / 2, wilson: wilson(favg, nb), rejectedByClass: cl }
}
const M = { V1: metrics(1, 'first'), V2: metrics(2, 'min'), V3: metrics(3, 'min') }
console.log(JSON.stringify(M, null, 1))
