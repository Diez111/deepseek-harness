/**
 * Pure completion check for J-Space: the gate \`jspace_finish\` uses before it
 * accepts a completion claim. It mirrors the task closure checklist — original
 * objective, respected constraints, open problems resolved or documented,
 * verified evidence, no ignored known errors, no evident regressions — and
 * reports every unmet condition so the model can fix or document them.
 * @module @deepseek-ai/dsh-jspace/verifier
 */

import type { JSpaceState } from './types.ts'

/** Model acknowledgements asserted by \`jspace_finish\`. */
export interface CompletionAck {
  /** The original objective is satisfied. */
  readonly goalSatisfied: boolean
  /** CORE constraints and stated restrictions were respected. */
  readonly constraintsRespected: boolean
  /** No known error is being silently ignored. */
  readonly noKnownErrorsIgnored: boolean
  /** No evident regression was introduced. */
  readonly noEvidentRegressions: boolean
}

/** Input to one completion check. */
export interface CompletionCheckInput {
  /** Current ledger; \`null\` when no ledger was written. */
  readonly state: JSpaceState | null
  /** Open items the model explicitly documents instead of resolving. */
  readonly documented: readonly string[]
  /** Whether verified evidence is required for a ledger that took action. */
  readonly requireVerification: boolean
  /** Model acknowledgements. */
  readonly ack: CompletionAck
}

/** Result of one completion check. */
export interface CompletionCheckResult {
  /** Whether the claim may be accepted. */
  readonly ready: boolean
  /** Concrete unmet conditions, in stable order; empty when ready. */
  readonly missing: string[]
}

/**
 * Check a completion claim against the ledger closure checklist.
 * @param input - ledger, documented open items, policy, and acknowledgements.
 * @returns readiness plus every unmet condition.
 */
export function checkCompletion(input: CompletionCheckInput): CompletionCheckResult {
  const missing: string[] = []
  const ack = input.ack
  if (!ack.goalSatisfied) missing.push('goal_satisfied must be true (is the original objective met?)')
  if (!ack.constraintsRespected) missing.push('constraints_respected must be true (were the stated restrictions honored?)')
  if (!ack.noKnownErrorsIgnored) missing.push('no_known_errors_ignored must be true (an ignored known error blocks completion)')
  if (!ack.noEvidentRegressions) missing.push('no_evident_regressions must be true (an evident regression blocks completion)')

  const state = input.state
  if (state === null) return { ready: missing.length === 0, missing }

  if (state.complete) return { ready: true, missing: [] }

  const documented = new Set(input.documented)
  for (const item of input.documented) {
    if (!state.open.includes(item)) missing.push(`documented item is not an open item: ${item}`)
  }
  for (const item of state.open) {
    if (!documented.has(item)) missing.push(`open item is neither resolved nor documented: ${item}`)
  }

  const isFinished = state.goal !== undefined || state.open.length > 0
  if (input.requireVerification && isFinished && state.verified.length === 0) {
    missing.push('no verified evidence recorded (record focused-then-broad checks in verified, or set requireVerification=false)')
  }

  return { ready: missing.length === 0, missing }
}

/**
 * Describe one check result in a compact, model-visible line.
 * @param result - a completion-check result.
 * @returns a short description for error feedback or the tool result.
 */
export function describeCompletion(result: CompletionCheckResult): string {
  return result.ready
    ? 'completion accepted'
    : `completion rejected: ${result.missing.join('; ')}`
}
