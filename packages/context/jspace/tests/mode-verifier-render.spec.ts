import { describe, expect, it } from 'vitest'
import { effectiveMode } from '../src/mode.ts'
import { renderJSpaceState } from '../src/render.ts'
import { checkCompletion } from '../src/verifier.ts'
import type { JSpaceState } from '../src/types.ts'

function state(overrides: Partial<JSpaceState> = {}): JSpaceState {
  return {
    revision: 1,
    mode: 'loop',
    core: [],
    verified: [],
    open: [],
    failedApproaches: [],
    complete: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('effectiveMode', () => {
  it('forces an explicit tier regardless of the ledger', () => {
    expect(effectiveMode('fast', null)).toBe('fast')
    expect(effectiveMode('loop', null)).toBe('loop')
    expect(effectiveMode('full', state({ goal: 'g' }))).toBe('full')
  })

  it('auto is fast before any ledger, and uses the stored ledger mode otherwise', () => {
    expect(effectiveMode('auto', null)).toBe('fast')
    expect(effectiveMode('auto', state({ mode: 'loop' }))).toBe('loop')
    expect(effectiveMode('auto', state({ mode: 'full' }))).toBe('full')
    expect(effectiveMode('auto', state({ mode: 'fast' }))).toBe('fast')
  })
})

describe('checkCompletion', () => {
  const readyAck = {
    goalSatisfied: true,
    constraintsRespected: true,
    noKnownErrorsIgnored: true,
    noEvidentRegressions: true,
  }

  it('accepts a claim with no ledger when every acknowledgement is true', () => {
    const result = checkCompletion({ state: null, documented: [], requireVerification: true, ack: readyAck })
    expect(result.ready).toBe(true)
    expect(result.missing).toEqual([])
  })

  it('rejects every missing acknowledgement', () => {
    const result = checkCompletion({
      state: null,
      documented: [],
      requireVerification: true,
      ack: { ...readyAck, noEvidentRegressions: false, goalSatisfied: false },
    })
    expect(result.ready).toBe(false)
    expect(result.missing.length).toBe(2)
  })

  it('rejects an open item that is neither resolved nor documented', () => {
    const result = checkCompletion({
      state: state({ open: ['fix regression C'] }),
      documented: [],
      requireVerification: true,
      ack: readyAck,
    })
    expect(result.ready).toBe(false)
    expect(result.missing.join()).toContain('fix regression C')
  })

  it('accepts an open item the model explicitly documents', () => {
    const result = checkCompletion({
      state: state({ open: ['fix regression C'], verified: ['regression C is pre-existing'] }),
      documented: ['fix regression C'],
      requireVerification: true,
      ack: readyAck,
    })
    expect(result.ready).toBe(true)
  })

  it('rejects documentation of an item that is not open', () => {
    const result = checkCompletion({
      state: state({ open: [] }),
      documented: ['ghost'],
      requireVerification: true,
      ack: readyAck,
    })
    expect(result.ready).toBe(false)
    expect(result.missing.join()).toContain('ghost')
  })

  it('requires verified evidence when a ledger took action and requireVerification is on', () => {
    const result = checkCompletion({
      state: state({ goal: 'implement X' }),
      documented: [],
      requireVerification: true,
      ack: readyAck,
    })
    expect(result.ready).toBe(false)
    expect(result.missing.join()).toContain('verified')
    const tolerant = checkCompletion({
      state: state({ goal: 'implement X' }),
      documented: [],
      requireVerification: false,
      ack: readyAck,
    })
    expect(tolerant.ready).toBe(true)
  })

  it('accepts an already-complete ledger as ready', () => {
    const result = checkCompletion({ state: state({ complete: true }), documented: [], requireVerification: true, ack: readyAck })
    expect(result.ready).toBe(true)
  })
})

describe('renderJSpaceState', () => {
  it('renders the ledger block with priorities in order and omits empty lists', () => {
    const text = renderJSpaceState(state({
      goal: 'Implement X',
      core: ['keep C', 'no regressions'],
      verified: ['module A compiles'],
      open: ['regression C'],
      next: 'investigate foo()',
      failedApproaches: [{ action: 'strategy Y', result: 'failed', reason: 'breaks Z', at: 1 }],
    }), { maxBytes: 4000 })
    expect(text).toContain('GOAL: Implement X')
    expect(text).toContain('CORE:')
    expect(text).toContain('- keep C')
    expect(text).toContain('VERIFIED:')
    expect(text).toContain('OPEN')
    expect(text).toContain('NEXT: investigate foo()')
    expect(text).toContain('FAILED')
    expect(text).toContain('COMPLETED: no')
    expect(text).not.toContain('[]')
  })

  it('bounded: a tight budget drops the least important trailing sections and marks truncation', () => {
    const text = renderJSpaceState(state({
      goal: 'a long goal '.repeat(60),
      core: ['c1'],
      verified: ['v1'],
      open: ['o1'],
      next: 'n1',
      failedApproaches: [{ action: 'f1', result: 'failed', reason: 'r1', at: 1 }],
    }), { maxBytes: 120 })
    expect(text.length).toBeLessThanOrEqual(121)
    expect(text).toContain('</system-reminder>')
    expect(text).toContain('J-Space task ledger')
  })

  it('a generous budget keeps the whole block', () => {
    const text = renderJSpaceState(state({ goal: 'g', core: ['c'], verified: ['v'], open: ['o'] }), { maxBytes: 4000 })
    expect(text).toContain('COMPLETED: no')
    expect(text.length).toBeLessThanOrEqual(4000)
  })
})
