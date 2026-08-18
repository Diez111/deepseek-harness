/**
 * Package-owned invariant companion. A search provider is a pure consumer of
 * the `ctx.web` seam and owns no durable domain, session event, or projection,
 * so there is no invariant relation to enforce beyond registration behavior,
 * which the package tests cover.
 * @module @deepseek-ai/dsh-web-search-duckduckgo/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-web-search-duckduckgo'

/** Cordis companion plugin name. */
export const name = 'web-search-duckduckgo-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'] as const

/** Installer with no runtime invariant (provider behavior is test-covered). */
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
