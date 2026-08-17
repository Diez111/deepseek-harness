// Real composition through the Loader: the feature flag, the completion gate,
// and the dynamic-context block are the model-visible faces of a cordis.yml row.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { CallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as Jspace from '@deepseek-ai/dsh-jspace'
import { foldJSpaceState } from '../src/fold.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

function agent(ctx: Context): Agent {
  const scope = ctx.plugin(() => {})
  const id = SessionId('jspace-loader-agent')
  const session = Session.create(id)
  const value: Agent = {
    id, options: {}, session, inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle', ctx: scope.ctx,
    followup: () => {}, steer: () => {}, inject: () => {}, send: () => {}, cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(value)
  return value
}

function resultText(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

/** Boot a cordis.yml carrying the given jspace config block. */
async function boot(configLines: readonly string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-jspace-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-jspace'",
    ...configLines.length > 0 ? ['  config:', ...configLines] : [],
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-jspace', Jspace],
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

describe('jspace feature flag through a real Loader composition', () => {
  it('disabled by default: registers no jspace tools and no context', async () => {
    const ctx = await boot([])
    const names = ctx.tools.schemas().map(schema => schema.name)
    expect(names).not.toContain('jspace_state')
    expect(names).not.toContain('jspace_finish')
  }, 30_000)

  it('blocks completion until every OPEN item is resolved or documented', async () => {
    const ctx = await boot(['    enabled: true', '    mode: loop'])
    const owner = agent(ctx)
    const write = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('w1'),
      name: 'jspace_state',
      arguments: { goal: 'implement X', open: ['resolve C'], verified: ['C isolated'] },
      agent: owner,
    })
    expect(write.isError).toBe(false)

    const first = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('f1'),
      name: 'jspace_finish',
      arguments: {
        goal_satisfied: true,
        constraints_respected: true,
        no_known_errors_ignored: true,
        no_evident_regressions: true,
      },
      agent: owner,
    })
    expect(first.isError).toBe(true)
    expect(resultText(first)).toContain('resolve C')

    // Document the open item explicitly → passes.
    const second = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('f2'),
      name: 'jspace_finish',
      arguments: {
        goal_satisfied: true,
        constraints_respected: true,
        no_known_errors_ignored: true,
        no_evident_regressions: true,
        resolved_open: ['resolve C'],
      },
      agent: owner,
    })
    expect(second.isError).toBe(false)
    const folded = foldJSpaceState(owner.session.events)
    expect(folded?.complete).toBe(true)
    expect(folded?.verified).toContain('C isolated')
  }, 30_000)

  it('requires verified evidence when the ledger took action', async () => {
    const ctx = await boot(['    enabled: true', '    mode: loop'])
    const owner = agent(ctx)
    await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('w2'),
      name: 'jspace_state',
      arguments: { goal: 'implement X', open: [] },
      agent: owner,
    })
    const finish = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('f3'),
      name: 'jspace_finish',
      arguments: {
        goal_satisfied: true,
        constraints_respected: true,
        no_known_errors_ignored: true,
        no_evident_regressions: true,
      },
      agent: owner,
    })
    expect(finish.isError).toBe(true)
    expect(resultText(finish)).toContain('verified')
  }, 30_000)

  it('forces the fast tier from configuration: tools work but no ledger block is injected', async () => {
    const ctx = await boot(['    enabled: true', '    mode: fast'])
    const owner = agent(ctx)
    const write = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('w3'),
      name: 'jspace_state',
      arguments: { goal: 'quick task' },
      agent: owner,
    })
    expect(write.isError).toBe(false)
    const assembly = await ctx.systemPrompt.assemble({ agent: owner, scope: owner })
    expect(assembly.contexts.some(entry => entry.name === 'jspace' && entry.text.length > 0)).toBe(false)
  }, 30_000)

  it('injects the ledger block in loop mode after a write', async () => {
    const ctx = await boot(['    enabled: true', '    mode: loop'])
    const owner = agent(ctx)
    await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('w4'),
      name: 'jspace_state',
      arguments: { goal: 'Implement X', core: ['constraint C'] },
      agent: owner,
    })
    const assembly = await ctx.systemPrompt.assemble({ agent: owner, scope: owner })
    const block = assembly.contexts.find(entry => entry.name === 'jspace')?.text ?? ''
    expect(block).toContain('J-Space task ledger')
    expect(block).toContain('GOAL: Implement X')
    expect(block).toContain('constraint C')
  }, 30_000)

  it('fails loading when configuration is invalid (maxItems 0)', async () => {
    await expect(boot(['    enabled: true', '    maxItems: 0'])).rejects.toThrow(/maxItems/)
  }, 30_000)
})
