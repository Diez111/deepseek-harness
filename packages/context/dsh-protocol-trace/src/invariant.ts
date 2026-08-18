/**
 * Package-owned invariant companion.
 * @module @deepseek-ai/dsh-protocol-trace/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-protocol-trace'

/** Cordis companion plugin name. */
export const name = 'protocol-trace-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'] as const

/**
 * Installer with no runtime invariant: the trace replays logged facts from the
 * authoritative session event stream and owns no other relationship to assert.
 */
const install: InvariantInstaller = Object.assign((_ctx: Context, fail: InvariantFailure) => {
  void fail
}, { inject: [] })

/**
 * Register the package's invariant companion (powered by the invariants seam).
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
