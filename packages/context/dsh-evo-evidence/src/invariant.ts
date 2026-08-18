/**
 * Package-owned invariant companion.
 * @module @deepseek-ai/dsh-evo-evidence/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-evo-evidence'

export const name = 'dsh-evo-evidence-invariant'
export const inject = ['invariants'] as const

/**
 * No runtime invariant: the vault replays its ops from the durable session
 * event stream and owns no other relationship to assert.
 */
const install: InvariantInstaller = Object.assign((_ctx: Context, fail: InvariantFailure) => {
  void fail
}, { inject: [] })

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
