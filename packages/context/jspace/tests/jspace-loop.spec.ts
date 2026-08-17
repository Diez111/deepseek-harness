import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Message } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as Jspace from '@deepseek-ai/dsh-jspace'
import type { Config } from '@deepseek-ai/dsh-jspace'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

/** Boot the core spine + the controller with a failing and a passing probe tool. */
async function harness(config: Config = {}): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Jspace, config)
  ctx.tools.register(defineContentToolFixture({ name: 'probe', description: 'ok tool', parameters: {}, async execute() {
    return [{ type: 'text', text: 'ok' }]
  } }))
  ctx.tools.register(defineContentToolFixture({ name: 'flaky', description: 'failing tool', parameters: {}, async execute() {
    throw new Error('boom')
  } }))
  return ctx
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const d = ctx.on('agent/status', ({ agent: s, status }) => {
      if (s === agent && status === 'idle') {
        d()
        resolve()
      }
    })
  })
}

/** Every injected (non-user) context message in the agent's log, flattened to text. */
function notices(agent: Agent): { text: string; source: unknown }[] {
  return [...agent.session.events]
    .filter((e): e is SessionEvent<'user/message'> => e.type === 'user/message' && e.data.source.kind !== 'user')
    .map(e => ({
      text: e.data.content.map(block => block.type === 'text' ? block.text : '').join('|'),
      source: e.data.source,
    }))
}

/** Flatten every message in one recorded request to joined text. */
function requestTexts(request: { messages: readonly Message[] }): string[] {
  const texts: string[] = []
  for (const message of request.messages) {
    const content = message.content
    if (typeof content === 'string') {
      texts.push(content)
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block?.type === 'text') texts.push(block.text)
      }
    }
  }
  return texts
}

describe('feature flag: disabled identity', () => {
  it('registers neither jspace tools nor the context block when enabled is absent/false', async () => {
    const ctx = await harness()
    const names = ctx.tools.schemas().map(schema => schema.name)
    expect(names).not.toContain('jspace_state')
    expect(names).not.toContain('jspace_finish')
    await ctx.fiber.dispose()
  })

  it('registers the ledger tools when enabled', async () => {
    const ctx = await harness({ enabled: true, mode: 'loop' })
    const names = ctx.tools.schemas().map(schema => schema.name)
    expect(names).toContain('jspace_state')
    expect(names).toContain('jspace_finish')
    await ctx.fiber.dispose()
  })
})

describe('failure-aware attempt guard', () => {
  it('injects an advisory when a previously failed call is retried, in full/loop mode', async () => {
    const ctx = await harness({ enabled: true, mode: 'loop', attemptInclude: ['flaky'] })
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'flaky', {}),
      toolCallResponse('c2', 'flaky', {}),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const found = notices(agent).filter(n => (n.source as { plugin?: string }).plugin === 'jspace')
    expect(found).toHaveLength(1)
    expect(found[0]!.text).toContain('Previous failed attempt detected')
    expect(found[0]!.text).toContain('- tool: flaky')
    expect(found[0]!.text).toContain('boom')
    await ctx.fiber.dispose()
  })

  it('is silent in fast mode: the first failure is remembered but no advisory repeats', async () => {
    const ctx = await harness({ enabled: true, mode: 'fast', attemptInclude: ['flaky'] })
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'flaky', {}),
      toolCallResponse('c2', 'flaky', {}),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a2'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const found = notices(agent).filter(n => (n.source as { plugin?: string }).plugin === 'jspace')
    expect(found).toHaveLength(0)
    await ctx.fiber.dispose()
  })

  it('a success forgets the earlier failure of the same call (new evidence)', async () => {
    // flaky now succeeds on retry; the second identical call draws no advisory.
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(Jspace, { enabled: true, mode: 'loop', attemptInclude: ['whiny'] })
    let calls = 0
    ctx.tools.register(defineContentToolFixture({ name: 'whiny', description: 'fails once then recovers', parameters: {}, async execute() {
      calls += 1
      if (calls === 1) throw new Error('transient')
      return [{ type: 'text', text: 'ok' }]
    } }))
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'whiny', {}),
      toolCallResponse('c2', 'whiny', {}),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a3'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const found = notices(agent).filter(n => (n.source as { plugin?: string }).plugin === 'jspace')
    expect(found).toHaveLength(0)
    await ctx.fiber.dispose()
  })
})

describe('durable state as model-visible context', () => {
  async function runLedgerScript(
    config: Config,
    script: ReturnType<typeof toolCallResponse>[],
  ): Promise<{ ctx: Context; agent: Agent; adapter: MockAdapter }> {
    const ctx = await harness(config)
    const adapter = new MockAdapter([...script, textResponse('done')])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('l1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    return { ctx, agent, adapter }
  }

  it('re-injects the ledger as a user-role snapshot after a write (auto escalates to loop)', async () => {
    const { ctx, adapter } = await runLedgerScript(
      { enabled: true, mode: 'auto' },
      [toolCallResponse('s1', 'jspace_state', { goal: 'Implement X', open: ['fix C'] })],
    )
    // The request after the ledger write must carry the block.
    const later = adapter.requests.find(request => requestTexts(request).some(t => t.includes('J-Space task ledger')))
    expect(later).toBeDefined()
    const joined = requestTexts(later!).join('\n')
    expect(joined).toContain('GOAL: Implement X')
    expect(joined).toContain('OPEN')
    expect(joined).toContain('fix C')
    await ctx.fiber.dispose()
  })

  it('keeps CORE/OPEN across later writes (partial updates persist, auto mode)', async () => {
    const { ctx, adapter } = await runLedgerScript({ enabled: true, mode: 'auto' }, [
      toolCallResponse('s1', 'jspace_state', { goal: 'Implement X', core: ['keep C'], open: ['fix C'] }),
      toolCallResponse('s2', 'jspace_state', { verified: ['module A compiles'] }),
    ])
    const later = adapter.requests.filter(request =>
      requestTexts(request).some(t => t.includes('J-Space task ledger')))
    const last = later.at(-1)!
    const joined = requestTexts(last).join('\n')
    expect(joined).toContain('GOAL: Implement X')
    expect(joined).toContain('keep C')
    expect(joined).toContain('fix C')
    expect(joined).toContain('module A compiles')
    await ctx.fiber.dispose()
  })

  it('injects no block for a ledger in fast mode (forced tier)', async () => {
    const { ctx, adapter } = await runLedgerScript({ enabled: true, mode: 'fast' }, [
      toolCallResponse('s1', 'jspace_state', { goal: 'Implement X' }),
    ])
    const injected = adapter.requests.some(request => requestTexts(request).some(t => t.includes('J-Space task ledger')))
    expect(injected).toBe(false)
    await ctx.fiber.dispose()
  })
})
