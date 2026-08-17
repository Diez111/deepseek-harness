/**
 * Host-side vocabulary of the J-Space task-state domain: the durable
 * `jspace/state` session event carrying complete post-mutation snapshots (or a
 * clear tombstone). Kept apart from ./types.ts because this file merges the
 * SessionEventMap, which pulls dsh-session types into the program.
 * @module @deepseek-ai/dsh-jspace
 */

import type { JSpaceState } from './types.ts'

/** Version of the durable `jspace/state` payload written by this package. */
export const JSPACE_STATE_VERSION = 1

/** A full-snapshot ledger mutation committed by a `jspace/state` event. */
export interface JSpaceStateSetMeta {
  readonly kind: 'jspace/state'
  readonly version: typeof JSPACE_STATE_VERSION
  readonly operation: 'set'
  /** Complete post-change state; the write side owns its correctness. */
  readonly state: JSpaceState
}

/** Tombstone that resets the ledger to absent. */
export interface JSpaceStateClearMeta {
  readonly kind: 'jspace/state'
  readonly version: typeof JSPACE_STATE_VERSION
  readonly operation: 'clear'
  /** Epoch milliseconds of the clear mutation. */
  readonly clearedAt: number
}

/** Durable change union carried by the J-Space domain's own session event. */
export type JSpaceStateChangeMeta = JSpaceStateSetMeta | JSpaceStateClearMeta

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Complete post-mutation J-Space ledger, or a clear tombstone. The event
     * is log-only (never on the model-visible surface); when the loop's
     * runtime-context projection re-renders the ledger as a durable user
     * message, that message carries the system-prompt plugin source.
     */
    'jspace/state': JSpaceStateChangeMeta
  }
}

export type * from './types.ts'
