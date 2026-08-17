import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as JspaceCompanion from '@deepseek-ai/dsh-jspace/invariant'
import InvariantRegistry, { InvariantError } from '@deepseek-ai/dsh-invariants'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { JSPACE_STATE_VERSION } from '../src/domain.ts'
import type { JSpaceStateChangeMeta } from '../src/domain.ts'
import type { JSpaceState } from '../src/types.ts'

const change: JSpaceStateChangeMeta = {
  kind: 'jspace/state',
  version: JSPACE_STATE_VERSION,
  operation: 'set',
  state: {
    revision: 1,
    mode: 'loop',
    goal: 'check the stream',
    core: ['constraint'],
    verified: [],
    open: [],
    failedApproaches: [],
    complete: false,
    createdAt: 1,
    updatedAt: 1,
  } satisfies JSpaceState,
}

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(JspaceCompanion)
  return ctx
}

describe('jspace stream invariants', () => {
  it('accepts canonical ledger snapshots', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('jspace-invariant-valid'))
    session.append('jspace/state', change)
    session.append('jspace/state', {
      kind: 'jspace/state',
      version: JSPACE_STATE_VERSION,
      operation: 'clear' as const,
      clearedAt: 5,
    })
    expect(session.seq).toBe(2)
  })

  it('rejects a malformed jspace change before committing it and keeps the fold reusable', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('jspace-invariant-invalid'))
    expect(() => {
      session.append('jspace/state', { ...change, extra: true } as never)
    }).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-jspace',
    }))
    expect(session.seq).toBe(0)
    session.append('jspace/state', change)
    expect(session.seq).toBe(1)
  })

  it('rejects an invalid snapshot such as a bad mode', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('jspace-invariant-badmode'))
    const bad: JSpaceState = { ...change.state, mode: 'turbo' as never }
    expect(() => {
      session.append('jspace/state', { ...change, state: bad })
    }).toThrow(expect.objectContaining<Partial<InvariantError>>({ code: 'INVARIANT' }))
  })

  it('reconstructs an existing durable ledger before checking later writes', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('jspace-invariant-late-load'))
    session.append('jspace/state', change)

    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(JspaceCompanion)
    expect(() => {
      session.append('jspace/state', {
        kind: 'jspace/state',
        version: JSPACE_STATE_VERSION,
        operation: 'clear' as const,
        clearedAt: 9,
      })
    }).not.toThrow()
  })
})
