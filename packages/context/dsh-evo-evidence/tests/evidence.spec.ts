// Evidence Vault: pure ops. The package is feature-flagged off (not shipped, not
// composed); its decisive validation is the dev benchmark (plugin-funciona != model-resuelve).
import { describe, expect, it } from 'vitest'
import { applyEvidenceOp, fnv1a, makeEntry } from '../src/index.ts'

describe('evidence pure ops', () => {
  it('fnv1a is deterministic and distinct', () => {
    expect(fnv1a('abc')).toBe(fnv1a('abc'))
    expect(fnv1a('abc')).not.toBe(fnv1a('abd'))
  })
  it('makeEntry enforces the byte cap and ids', () => {
    const e = makeEntry({ entries: [], seq: 3 }, { type: 'test-result', source: 'pytest', content: '1234567890' }, 4)
    expect(e.id).toBe('E3')
    expect(e.content).toBe('1234')
    expect(e.status).toBe('fresh')
    expect(e.files).toEqual([])
  })
  it('applyEvidenceOp stores and marks stale only matching fresh entries', () => {
    const a = makeEntry({ entries: [], seq: 0 }, { type: 'diff', source: 'x', files: ['src/a.py'], content: 'a' }, 100)
    const b = makeEntry({ entries: [], seq: 1 }, { type: 'diff', source: 'y', files: ['src/b.py'], content: 'b' }, 100)
    const s1 = applyEvidenceOp({ entries: [], seq: 0 }, { op: 'store', entry: a })
    const s2 = applyEvidenceOp(s1, { op: 'store', entry: b })
    const s3 = applyEvidenceOp(s2, { op: 'markStale', files: ['src/a.py'] })
    expect(s3.entries.find(x => x.id === 'E0')?.status).toBe('stale')
    expect(s3.entries.find(x => x.id === 'E1')?.status).toBe('fresh')
    const s4 = applyEvidenceOp(s3, { op: 'store', entry: a })
    expect(s4.entries.length).toBe(2)
  })
})
