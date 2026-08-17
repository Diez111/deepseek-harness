/**
 * Package-owned durable jspace-stream invariants: an independent incremental
 * fold over every attached session that rejects malformed \`jspace/state\`
 * events before they become accepted reality, so the writer cannot commit a
 * corrupt ledger silently.
 * @module @deepseek-ai/dsh-jspace/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { applyJSpaceStateFold } from './fold.ts'
import type { JSpaceState } from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-jspace'

/** Cordis companion plugin name. */
export const name = 'jspace-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Mutable fold holder so the incremental fold can share one state per session. */
interface FoldHolder {
  current: JSpaceState | null
}

/** Apply one event through the strict decoder and attribute failures. */
function applyChecked(holder: FoldHolder, event: SessionEvent, fail: InvariantFailure): void {
  try {
    holder.current = applyJSpaceStateFold(holder.current, event)
  } catch (error) {
    /* v8 ignore next -- the strict decoder throws Error instances */
    const message = error instanceof Error ? error.message : String(error)
    fail(`session event ${event.seq} violates the durable jspace stream: ${message}`)
  }
}

/** Install an independent incremental fold over every attached session. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const states = new WeakMap<Session, FoldHolder>()
  const staged = new WeakMap<SessionEvent, FoldHolder>()

  const seed = (session: Session): FoldHolder => {
    const holder: FoldHolder = { current: null }
    for (const event of session.events) applyChecked(holder, event, fail)
    states.set(session, holder)
    return holder
  }
  /* v8 ignore next -- session/event always follows list() or session/created seeding */
  const holderFor = (session: Session): FoldHolder => states.get(session) ?? seed(session)

  for (const session of ctx.sessions.list()) seed(session)
  ctx.on('session/created', (session) => { seed(session) }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    const holder = { current: holderFor(session).current }
    applyChecked(holder, event, fail)
    staged.set(event, holder)
  }, { global: true })
  ctx.on('session/event', (session, event) => {
    const candidate = staged.get(event)
    /* v8 ignore next 2 -- internal/dispatch stages the exact callback arguments */
    if (candidate === undefined) return fail('session/event reached publication without matching jspace-fold validation')
    staged.delete(event)
    states.set(session, candidate)
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register the jspace-stream invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
