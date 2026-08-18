// Behavior: buildTrace (pure) + onSessionEvent (direct, real Session) + Loader smoke.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { AssistantMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { buildTrace, noteFirstUserComplexity, onSessionEvent, predictComplexityTier, ProtocolTraceState } from '../src/index.ts'
import * as ProtocolTrace from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Boot a cordis.yml carrying SessionStore + protocol-trace. */
async function boot(extraLines: readonly string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-protocol-trace-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-session'",
    '- id: protocol-trace',
    "  name: '@deepseek-ai/dsh-protocol-trace'",
    ...extraLines.length > 0 ? ['  config:', ...extraLines] : [],
    '',
  ].join('\n'))
  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-protocol-trace', ProtocolTrace],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error('unexpected Loader import: ' + specifier)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return ctx
}

const route = { provider: 'opencode-go', model: 'deepseek-v4-flash', maxTokens: 2048 }

const headerEvent = { type: 'request/header', data: { header: { config: route }, reason: 'initial' } } as unknown as SessionEvent

function assistantEvent(
  content: readonly unknown[],
  usage?: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number },
): SessionEvent {
  return { type: 'assistant/message', data: {
    turn: 1, step: 1,
    message: { content },
    ...usage !== undefined ? { usage } : {},
  } } as unknown as SessionEvent
}

describe('buildTrace (pure)', () => {
  it('merges route, reasoning/tool presence, and usage', () => {
    const message = { content: [
      { type: 'reasoning', text: 'hmm' },
      { type: 'tool-call', id: 'c1', name: 'bash', arguments: {} },
      { type: 'text', text: 'x' },
    ] } as unknown as AssistantMessage
    const trace = buildTrace(route, message, { inputTokens: 10, outputTokens: 4, reasoningTokens: 6 }, 1)
    expect(trace).toMatchObject({
      provider: 'opencode-go', model: 'deepseek-v4-flash', maxTokens: 2048,
      reasoningPresent: true, toolCalls: 1, inputTokens: 10, outputTokens: 4, reasoningTokens: 6,
    })
  })
  it('omits cache fields when the backend does not report them', () => {
    const trace = buildTrace(route, { content: [] } as unknown as AssistantMessage, { inputTokens: 1, outputTokens: 1 }, 2)
    expect(trace.cacheReadTokens).toBeUndefined()
    expect(trace.reasoningPresent).toBe(false)
    expect(trace.toolCalls).toBe(0)
  })
  it('falls back to unknown route and reflects cache fields when present', () => {
    const trace = buildTrace(undefined, { content: [] } as unknown as AssistantMessage,
      { inputTokens: 1, outputTokens: 1, cacheReadTokens: 900, cacheWriteTokens: 100 }, 3)
    expect(trace.provider).toBe('unknown')
    expect(trace.cacheReadTokens).toBe(900)
    expect(trace.cacheWriteTokens).toBe(100)
  })
})

describe('onSessionEvent (direct observer)', () => {
  it('caches the route from the header and appends one trace per assistant message', async () => {
    const ctx = await boot([])
    const session = ctx.sessions.create(SessionId('pt-live'))
    const state: ProtocolTraceState = {}
    onSessionEvent(session, headerEvent, state)
    expect(state.route).toMatchObject({ provider: 'opencode-go', model: 'deepseek-v4-flash', maxTokens: 2048 })
    onSessionEvent(session, assistantEvent([
      { type: 'reasoning', text: 'plan' },
      { type: 'tool-call', id: 'c1', name: 'bash', arguments: {} },
    ], { inputTokens: 25, outputTokens: 7 }), state)
    const traces = session.events
      .filter(e => e.type === 'session/protocol-trace')
      .map(e => (e as unknown as { data: Record<string, unknown> }).data)
    expect(traces).toHaveLength(1)
    expect(traces[0]).toMatchObject({ provider: 'opencode-go', model: 'deepseek-v4-flash', reasoningPresent: true, toolCalls: 1, inputTokens: 25, outputTokens: 7 })
    expect(traces[0]!.cacheReadTokens).toBeUndefined()
  })
  it('ignores non-matching events and does not trace the assistant message twice', async () => {
    const ctx = await boot([])
    const session = ctx.sessions.create(SessionId('pt-cold'))
    const state: ProtocolTraceState = {}
    const stepEvent = { type: 'step/end', data: { turn: 1, step: 1 } } as unknown as SessionEvent
    onSessionEvent(session, stepEvent, state)
    expect(session.events.some(e => e.type === 'session/protocol-trace')).toBe(false)
  })
})

describe('protocol-trace under a real Loader composition', () => {
  it('loads cleanly with enabled config and exposes the session store', async () => {
    const ctx = await boot([])
    const session = ctx.sessions.create(SessionId('pt-boot'))
    expect(session.events).toBeDefined()
  })
  it('disabled config registers nothing (no traces after manual append)', async () => {
    const ctx = await boot(['    enabled: false'])
    const session = ctx.sessions.create(SessionId('pt-off'))
    session.append('assistant/message', {
      turn: 1, step: 1, message: { content: [{ type: 'text', text: 'x' }] } as unknown as AssistantMessage,
    }, { surfaceOp: 'append' })
    expect(session.events.some(e => e.type === 'session/protocol-trace')).toBe(false)
  })
})

describe('predictComplexityTier + noteFirstUserComplexity', () => {
  it('classifies by message size and keywords', () => {
    expect(predictComplexityTier('ok')).toBe('trivial')
    expect(predictComplexityTier('Implement the requested numeric parser with correct precedence and then run its test suite')).toBe('standard')
    expect(predictComplexityTier('debug the concurrency race deadlock in the parser, then compile the build and run the full regression refactor; also fix the threading model, migrate the architecture, reproduce the deadlock, and build a stress regression to confirm the fix holds under load; then recompile the build and run the whole suite again to make sure the race window closes and no regression appears in the parser, the thread pool, or the build pipeline; finally document the deadlock and the build regression for the migration to the new architecture and the concurrency freeze')).toBe('deep')
  })
  it('notes the first user message complexity once per session', async () => {
    const ctx = await boot([])
    const session = ctx.sessions.create(SessionId('pt-note'))
    const seen = new WeakSet<object>()
    const userEvent = { type: 'user/message', data: { content: [{ type: 'text', text: 'debug the parse bug and run it' }] } } as unknown as SessionEvent
    noteFirstUserComplexity(session, userEvent, seen)
    noteFirstUserComplexity(session, userEvent, seen)
    const notes = session.events.filter(e => e.type === 'session/complexity-note')
    expect(notes).toHaveLength(1)
    const payload = (notes[0] as unknown as { data: { tier: string } }).data
    expect(payload.tier).toBe('standard')
  })
})
