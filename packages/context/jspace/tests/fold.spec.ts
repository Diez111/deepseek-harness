import { describe, expect, it } from 'vitest'
import { SessionId, Session } from '@deepseek-ai/dsh-session'
import { JSPACE_STATE_VERSION } from '../src/domain.ts'
import type { JSpaceStateChangeMeta } from '../src/domain.ts'
import {
  JSPACE_MAX_LIST_ITEMS, applyJSpaceStateFold, decodeJSpaceChange, decodeJSpaceState, foldJSpaceState,
} from '../src/fold.ts'
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

function setEvent(_seq: number, next: JSpaceState): JSpaceStateChangeMeta {
  return { kind: 'jspace/state', version: JSPACE_STATE_VERSION, operation: 'set', state: next }
}

function clearEvent(seq: number): JSpaceStateChangeMeta {
  return { kind: 'jspace/state', version: JSPACE_STATE_VERSION, operation: 'clear', clearedAt: seq + 100 }
}

type RawEvent = { type: string; seq: number; time: number; data: unknown }

function eventOf(seq: number, data: JSpaceStateChangeMeta | Record<string, unknown>): RawEvent {
  return { type: 'jspace/state', seq, time: seq + 100, data }
}

describe('decodeJSpaceChange', () => {
  it('returns undefined for unrelated values', () => {
    expect(decodeJSpaceChange({ kind: 'other', anything: true })).toBeUndefined()
    expect(decodeJSpaceChange(null)).toBeUndefined()
    expect(decodeJSpaceChange('nope')).toBeUndefined()
  })

  it('decodes a canonical set change and a clear tombstone', () => {
    const change = setEvent(1, state({ goal: 'g', core: ['c'] }))
    expect(decodeJSpaceChange(change)).toEqual(change)
    const clear = clearEvent(2)
    expect(decodeJSpaceChange(clear)).toEqual(clear)
  })

  it('fails loud on an unsupported version or a bad operation', () => {
    expect(() => decodeJSpaceChange({ kind: 'jspace/state', version: 99, operation: 'set', state: state() }))
      .toThrow(/unsupported jspace state version/)
    expect(() => decodeJSpaceChange({ kind: 'jspace/state', version: JSPACE_STATE_VERSION, operation: 'upsert', state: state() }))
      .toThrow(/operation must be set or clear/)
  })

  it('fails loud on malformed snapshots', () => {
    const bad = [
      state({ revision: 0 }),
      state({ mode: 'turbo' as never }),
      state({ core: ['  whitespace  '] }),
      state({ core: ['a', '', 'b'] }),
      state({
        verified: Array.from({ length: JSPACE_MAX_LIST_ITEMS + 1 }, () => 'x'),
      }),
      state({ updatedAt: 0, createdAt: 5 }),
      state({ complete: 'yes' as never }),
      state({ failedApproaches: [{ action: '', reason: 'r' }] as never }),
      state({ next: ' untrimmed' }),
    ]
    for (const snapshot of bad) {
      expect(() => decodeJSpaceState(snapshot)).toThrow()
    }
  })

  it('accepts optional fields only when present with exact keys', () => {
    const withGoal = state({ goal: 'g' })
    expect(decodeJSpaceState(withGoal)).toEqual(withGoal)
    const withoutGoal = state()
    expect(decodeJSpaceState(withoutGoal)).toEqual(withoutGoal)
  })
})

describe('foldJSpaceState / applyJSpaceStateFold', () => {
  it('returns null for an empty log and ignores unrelated events', () => {
    const result = foldJSpaceState([eventOf(1, {}) as never])
    expect(result).toBeNull()
  })

  it('is last-write-wins and honors a later clear', () => {
    const events = [
      eventOf(1, setEvent(1, state({ revision: 1, goal: 'first' }))),
      eventOf(2, setEvent(2, state({ revision: 2, goal: 'second', open: ['x'] }))),
    ]
    const folded = foldJSpaceState(events as never[])
    expect(folded?.goal).toBe('second')
    expect(folded?.revision).toBe(2)

    const cleared = applyJSpaceStateFold(folded, { type: 'jspace/state', seq: 3, time: 4, data: clearEvent(3) } as never)
    expect(cleared).toBeNull()
  })

  it('returns the same reference for unrelated events', () => {
    const accumulated: JSpaceState | null = null
    const unrelated = { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } } as never
    expect(applyJSpaceStateFold(accumulated, unrelated)).toBe(accumulated)
  })

  it('reconstructs a ledger from real session events', () => {
    const session = Session.create(SessionId('fold-live'))
    session.append('jspace/state', setEvent(1, state({ goal: 'g' })))
    session.append('turn/start', { turn: 1 })
    session.append('jspace/state', setEvent(3, state({ revision: 2, goal: 'g2', core: ['k'] })))
    const folded = foldJSpaceState(session.events)
    expect(folded?.goal).toBe('g2')
    expect(folded?.core).toEqual(['k'])
  })
})
