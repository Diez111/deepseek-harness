/**
 * Renders the compact, self-describing J-Space state block injected as dynamic
 * runtime context (registered through \`ctx.systemPrompt.context\`). The block is
 * derived from the durable ledger on every assembly, so it stays current and is
 * re-injected automatically when context compaction shadows an earlier copy.
 * Rendering never exceeds the configured byte budget: sections are dropped
 * from the least important end, then the tail is truncated with an omitted
 * marker.
 * @module @deepseek-ai/dsh-jspace/render
 */

import type { JSpaceAttempt, JSpaceState } from './types.ts'

/** Render options for one ledger. */
export interface RenderJSpaceStateOptions {
  /** Hard ceiling on the rendered bytes; the marker and closing frame always fit. */
  readonly maxBytes: number
}

const TRUNCATED = '\n… (truncated)'

/** One one-line failed-approach entry. */
function failedLine(attempt: JSpaceAttempt): string {
  const tool = attempt.tool === undefined ? '' : ` [tool ${attempt.tool}]`
  return `- ${attempt.action}${tool} → ${attempt.reason}`
}

/** One bulleted list section, or an empty string for an empty list. */
function listSection(label: string, items: readonly string[]): string {
  if (items.length === 0) return ''
  return items.map(item => `${label}\\n- ${item}`).join('')
}

/**
 * Render the ledger block. An empty (absent) ledger renders nothing, so the
 * dynamic-context projection contributes zero tokens before any write.
 * @param state - current ledger.
 * @param options - byte budget.
 * @returns the model-visible block, or `''` for an absent ledger.
 */
export function renderJSpaceState(state: JSpaceState, options: RenderJSpaceStateOptions): string {
  const maxBytes = options.maxBytes
  if (maxBytes < 1) return ''
  const header = `<system-reminder>\\nJ-Space task ledger (mode: ${state.mode}):`
  const goal = state.goal === undefined ? '' : `\\nGOAL: ${state.goal}`
  const core = listSection('\\nCORE:', state.core)
  const verified = listSection('\\nVERIFIED:', state.verified)
  const open = listSection('\\nOPEN (resolve or document before completion):', state.open)
  const next = state.next === undefined ? '' : `\\nNEXT: ${state.next}`
  const failed = listSection('\\nFAILED (do not repeat):', state.failedApproaches.map(failedLine))
  const completed = `\\nCOMPLETED: ${state.complete ? 'yes' : 'no'}`
  const footer = '\\nKeep this compact ledger current with jspace_state; core constraints and failed approaches are durable and replace earlier plans. Open items must be resolved or documented before jspace_finish accepts completion.'
  const closing = '\\n</system-reminder>'

  const sections: string[] = [header, goal, core, verified, open, next, failed, completed]
  let text = sections.join('')
  if (text.length + footer.length + closing.length <= maxBytes) {
    return text + footer + closing
  }
  // Drop whole trailing sections until the frame fits.
  let index = sections.length - 1
  while (index > 0) {
    const candidate = sections.slice(0, index).join('')
    if (candidate.length + footer.length + closing.length <= maxBytes) break
    index -= 1
  }
  text = sections.slice(0, index).join('')
  if (text.length <= 1) return header.slice(0, Math.max(0, maxBytes - closing.length)) + closing
  if (text.length + TRUNCATED.length + footer.length + closing.length <= maxBytes) {
    return text + TRUNCATED + footer + closing
  }
  // Truncate the text tail within budget.
  const remaining = maxBytes - closing.length
  return text.slice(0, Math.max(1, remaining)) + '…' + closing
}
