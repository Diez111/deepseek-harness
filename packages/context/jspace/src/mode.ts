/**
 * J-Space mode resolution. The deployment chooses an explicit tier or `auto`;
 * `auto` derives the tier from the ledger: no ledger means `fast` (no
 * bookkeeping), a ledger with a goal or open problems means `loop` (persistent
 * control), otherwise `full`. When the model wrote a ledger it stores its own
 * tier choice, which `auto` honors.
 * @module @deepseek-ai/dsh-jspace/mode
 */

import type { JSpaceMode, JSpaceState } from './types.ts'

/**
 * Automatic tier for an empty log.
 * @returns the `fast` tier.
 */
export function autoModeEmpty(): JSpaceMode {
  return 'fast'
}

/**
 * Automatic tier for a non-empty ledger.
 * @param state - the current ledger.
 * @returns `loop` when a goal or open problems exist, else `full`.
 */
export function autoModeForState(state: JSpaceState): JSpaceMode {
  return state.goal !== undefined || state.open.length > 0 ? 'loop' : 'full'
}

/**
 * Resolve the deployment choice against the current ledger.
 * @param choice - configured `mode` (`'auto'` is the default).
 * @param state - current ledger, `null` when none was written.
 * @returns the effective tier for this request.
 */
export function effectiveMode(choice: 'auto' | JSpaceMode, state: JSpaceState | null): JSpaceMode {
  if (choice !== 'auto') return choice
  if (state === null) return autoModeEmpty()
  return state.mode
}
