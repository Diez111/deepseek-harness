/**
 * Pure types of the J-Space compact task ledger: the durable GOAL/CORE/
 * VERIFIED/OPEN/NEXT state (plus bounded failed-approach records), free of
 * host-side imports. The session event carrying this vocabulary lives in
 * ./domain.ts (it merges the SessionEventMap); the pure decode/fold and
 * rendering live in ./fold.ts and ./render.ts.
 * @module @deepseek-ai/dsh-jspace/types
 */

/** Operating tier for the J-Space controller. */
export type JSpaceMode = 'fast' | 'full' | 'loop'

/** Deployment mode choice: an explicit tier or automatic resolution. */
export type JSpaceModeChoice = 'auto' | JSpaceMode

/** How one recorded attempt ended. */
export type JSpaceAttemptResult = 'failed' | 'blocked'

/**
 * One failed approach worth remembering: the decisive diagnostic, so a model
 * that sees the ledger after a compaction or a resume does not re-run a play
 * that already failed. Entries are bounded by the configured failure budget.
 */
export interface JSpaceAttempt {
  /** Tool the failed call used, when the failure came from a tool call. */
  readonly tool?: string
  /** Short description of the attempted approach. */
  readonly action: string
  /** Whether the attempt failed or was blocked by policy. */
  readonly result: JSpaceAttemptResult
  /** Decisive failure diagnostic, bounded to the configured reason budget. */
  readonly reason: string
  /** Epoch milliseconds when the attempt ended. */
  readonly at: number
}

/**
 * The whole durable J-Space task state. Every mutation writes the complete
 * snapshot (last-write-wins), so a fold over the session log is trivially
 * last-event-wins and the snapshot itself survives context compaction
 * (re-projected, re-rendered) and session resume.
 */
export interface JSpaceState {
  /** Positive monotonic revision; every durable mutation increments it by one. */
  readonly revision: number
  /** Effective tier of the last write: governs block/advisory/verification intensity. */
  readonly mode: JSpaceMode
  /** Compact restatement of the main objective; absent on reaction-only work. */
  readonly goal?: string
  /** Constraints and decisions that must not be lost. Bounded list. */
  readonly core: string[]
  /** Facts proven by code, tests, tools, or inspection. Bounded list. */
  readonly verified: string[]
  /** Problems still pending. Bounded list; each blocks completion until resolved or documented. */
  readonly open: string[]
  /** Next concrete action; absent when no next step is chosen. */
  readonly next?: string
  /** Failed approaches worth remembering. Bounded list. */
  readonly failedApproaches: JSpaceAttempt[]
  /** Whether the completion gate accepted a finish claim. */
  readonly complete: boolean
  /** Epoch milliseconds of the first ledger write. */
  readonly createdAt: number
  /** Epoch milliseconds of the latest mutation. */
  readonly updatedAt: number
}
