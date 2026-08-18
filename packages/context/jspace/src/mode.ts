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
