/**
 * Pure last-write-wins fold over durable \`jspace/state\` events, with a strict
 * decoder for the whole-value snapshot. The write side owns correctness of the
 * values it commits; this decoder validates the durable/wire boundary loudly
 * so a malformed event cannot silently reconstruct a wrong ledger.
 * @module @deepseek-ai/dsh-jspace/fold
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { JSPACE_STATE_VERSION } from './domain.ts'
import type { JSpaceState, JSpaceStateChangeMeta } from './domain.ts'
import type { JSpaceAttempt, JSpaceAttemptResult, JSpaceMode } from './types.ts'

/** Hard ceiling on every bounded ledger list, shared by config validation and decode. */
export const JSPACE_MAX_LIST_ITEMS = 64

const MODES: ReadonlySet<string> = new Set(['fast', 'full', 'loop'])
const RESULTS: ReadonlySet<string> = new Set(['failed', 'blocked'])

/** Whether a value is a JSON record rather than an array. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Require one non-negative safe integer. */
function nonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`jspace state ${field} must be a non-negative safe integer`)
  }
  return value
}

/** Require one positive safe integer. */
function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`jspace state ${field} must be a positive safe integer`)
  }
  return value
}

/** Require a mode. */
function modeOf(value: unknown, field: string): JSpaceMode {
  if (typeof value !== 'string' || !MODES.has(value)) {
    throw new Error(`jspace state ${field} must be one of fast, full, loop`)
  }
  return value as JSpaceMode
}

/** Require a bounded list of non-empty normalized strings. */
function stringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > JSPACE_MAX_LIST_ITEMS) {
    throw new Error(`jspace state ${field} must be an array of at most ${JSPACE_MAX_LIST_ITEMS} items`)
  }
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0 || item !== item.trim()) {
      throw new Error(`jspace state ${field} items must be non-empty and normalized strings`)
    }
  }
  return value as string[]
}

/** Whether an optional scalar field is a valid trimmed string. */
function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new Error(`jspace state ${field} must be a non-empty normalized string`)
  }
  return value
}

/** Decode one failed-approach record. */
function decodeAttempt(value: unknown): JSpaceAttempt {
  if (!isRecord(value)) throw new Error('jspace state failedApproaches item must be a record')
  if (typeof value['action'] !== 'string' || value['action'].length === 0
    || value['action'] !== value['action'].trim()) {
    throw new Error('jspace state failedApproaches item.action must be a non-empty normalized string')
  }
  if (typeof value['reason'] !== 'string' || value['reason'].length === 0
    || value['reason'] !== value['reason'].trim()) {
    throw new Error('jspace state failedApproaches item.reason must be a non-empty normalized string')
  }
  if (typeof value['result'] !== 'string' || !RESULTS.has(value['result'])) {
    throw new Error('jspace state failedApproaches item.result must be failed or blocked')
  }
  const tool = optionalString(value['tool'], 'failedApproaches item.tool')
  const at = nonNegativeInteger(value['at'], 'failedApproaches item.at')
  if (Object.keys(value).sort().join(',') !== (tool === undefined
    ? 'action,at,reason,result'
    : 'action,at,reason,result,tool')) {
    throw new Error('jspace state failedApproaches item has unexpected fields')
  }
  return {
    ...tool === undefined ? {} : { tool },
    action: value['action'],
    result: value['result'] as JSpaceAttemptResult,
    reason: value['reason'],
    at,
  }
}

/**
 * Decode and strictly validate one whole ledger snapshot.
 * @param value - candidate `jspace/state` set payload state.
 * @returns the validated snapshot.
 */
export function decodeJSpaceState(value: unknown): JSpaceState {
  if (!isRecord(value)) throw new Error('jspace state must be a record')
  const goal = optionalString(value['goal'], 'goal')
  const next = optionalString(value['next'], 'next')
  const expected = [
    'complete',
    'core', 'createdAt',
    ...goal === undefined ? [] : ['goal'],
    'failedApproaches', 'mode',
    ...next === undefined ? [] : ['next'],
    'open', 'revision', 'updatedAt', 'verified',
  ].sort().join(',')
  if (Object.keys(value).sort().join(',') !== expected) {
    throw new Error(`jspace state has unexpected or missing fields (got ${Object.keys(value).sort().join(',')})`)
  }
  const revision = positiveInteger(value['revision'], 'revision')
  const mode = modeOf(value['mode'], 'mode')
  const core = stringList(value['core'], 'core')
  const verified = stringList(value['verified'], 'verified')
  const open = stringList(value['open'], 'open')
  if (typeof value['complete'] !== 'boolean') {
    throw new Error('jspace state complete must be a boolean')
  }
  if (!Array.isArray(value['failedApproaches']) || value['failedApproaches'].length > JSPACE_MAX_LIST_ITEMS) {
    throw new Error(`jspace state failedApproaches must be an array of at most ${JSPACE_MAX_LIST_ITEMS} items`)
  }
  const failedApproaches = value['failedApproaches'].map(decodeAttempt)
  const createdAt = nonNegativeInteger(value['createdAt'], 'createdAt')
  const updatedAt = nonNegativeInteger(value['updatedAt'], 'updatedAt')
  if (updatedAt < createdAt) throw new Error('jspace state updatedAt cannot precede createdAt')
  return {
    revision,
    mode,
    ...goal === undefined ? {} : { goal },
    core,
    verified,
    open,
    ...next === undefined ? {} : { next },
    failedApproaches,
    complete: value['complete'],
    createdAt,
    updatedAt,
  }
}

/**
 * Decode a value that declares itself as a `jspace/state` change. Unrelated
 * values return `undefined`; malformed jspace changes fail loudly.
 * @param value - candidate source change.
 * @returns the validated change or `undefined` for another value kind.
 */
export function decodeJSpaceChange(value: unknown): JSpaceStateChangeMeta | undefined {
  if (!isRecord(value) || value['kind'] !== 'jspace/state') return undefined
  if (value['version'] !== JSPACE_STATE_VERSION) {
    throw new Error(`unsupported jspace state version ${String(value['version'])}`)
  }
  if (value['operation'] === 'clear') {
    if (Object.keys(value).sort().join(',') !== 'clearedAt,kind,operation,version') {
      throw new Error('jspace clear change must carry exactly clearedAt, kind, operation, version')
    }
    return {
      kind: 'jspace/state',
      version: JSPACE_STATE_VERSION,
      operation: 'clear',
      clearedAt: nonNegativeInteger(value['clearedAt'], 'clearedAt'),
    }
  }
  if (value['operation'] !== 'set') throw new Error('jspace change operation must be set or clear')
  if (Object.keys(value).sort().join(',') !== 'kind,operation,state,version') {
    throw new Error('jspace set change must carry exactly kind, operation, state, version')
  }
  return {
    kind: 'jspace/state',
    version: JSPACE_STATE_VERSION,
    operation: 'set',
    state: decodeJSpaceState(value['state']),
  }
}

/**
 * Apply one committed event to the ledger fold. Unrelated events return the
 * same state reference; a validated `set` returns its whole snapshot; a
 * `clear` returns `null`.
 * @param state - fold covering all prior events.
 * @param event - the next committed session event.
 * @returns the next fold state.
 */
export function applyJSpaceStateFold(state: JSpaceState | null, event: SessionEvent): JSpaceState | null {
  if (event.type !== 'jspace/state') return state
  const change = decodeJSpaceChange(event.data)
  if (change === undefined) return state
  if (change.operation === 'clear') return null
  // Declared contract: a positive monotonic revision. A later set that does
  // not advance the folded revision means the log is corrupt (reordered or
  // rewritten), and silently last-write-wins would reconstruct a wrong ledger.
  if (state !== null && change.state.revision <= state.revision) {
    throw new Error(`jspace state revision must be monotonic: ${String(change.state.revision)} after ${String(state.revision)}`)
  }
  return change.state
}

/**
 * Fold a full event log into the current ledger. Malformed `jspace/state`
 * events fail loudly; a `clear` after a `set` resets to `null`.
 * @param events - the session event log.
 * @returns the current ledger, or `null` before the first write / after a clear.
 */
export function foldJSpaceState(events: readonly SessionEvent[]): JSpaceState | null {
  let state: JSpaceState | null = null
  for (const event of events) state = applyJSpaceStateFold(state, event)
  return state
}
