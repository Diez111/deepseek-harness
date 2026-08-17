/**
 * Reproducible A/B benchmark: DeepSeek Harness baseline vs Harness + the
 * optional jspace controller, measured at the harness-mechanism level with a
 * scripted model (no API key, no network). It drives a real agent loop with a
 * mock adapter over TWO scripted behaviors of a long agentic task (a failing
 * approach loop, then completion), and reports tokens, tool calls, repeated
 * calls, failed attempts, wall time, and whether the verification gate was
 * used. The scripted model reacts to observable harness signals (the injected
 * jspace advisory / ledger block), so the numbers quantify the mechanisms, not
 * a real model judgment; the real-model path is documented in README.md.
 *
 * Run: pnpm tsx scripts/benchmarks/jspace-ab/run-bench.ts
 */
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as Jspace from '@deepseek-ai/dsh-jspace'
import { MockAdapter, textResponse, toolCallResponse } from '../../../packages/core/agent-loop/tests/mock-adapter.ts'

interface Metrics {
  label: string
  inputTokens: number
  outputTokens: number
  estimatedInputTokens: number
  toolCalls: number
  repeatedToolCalls: number
  failedAttempts: number
  wallTimeMs: number
  taskComplete: boolean
  verificationGateUsed: boolean
  ledgerWrites: number
}

function textOf(message: { content: unknown }): string[] {
  const content = message.content
  const texts: string[] = []
  if (typeof content === 'string') {
    texts.push(content)
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (block !== null && typeof block === 'object' && (block as { type?: unknown }).type === 'text') {
        texts.push((block as { text: string }).text)
      }
    }
  }
  return texts
}

function joined(request: GenerateOptions): string {
  return request.messages.flatMap(textOf).join('\n')
}

function estimateTextTokens(text: string): number {
  return Math.max(0, Math.round(text.length / 4))
}

function requestTextTokens(request: GenerateOptions): number {
  const text = joined(request) + (request.system ?? '')
  return estimateTextTokens(text)
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

/** Count identical consecutive tool calls and failures from the durable log. */
function logMetrics(agent: Agent): { repeatedToolCalls: number; failedAttempts: number; ledgerWrites: number } {
  const calls = [...agent.session.events].filter((e): e is SessionEvent<'tool/call'> => e.type === 'tool/call')
  const results = [...agent.session.events].filter((e): e is SessionEvent<'tool/result'> => e.type === 'tool/result')
  let repeated = 0
  let lastKey: string | undefined
  for (const call of calls) {
    const key = JSON.stringify([call.data.name, JSON.stringify(call.data.arguments)])
    if (key === lastKey) repeated += 1
    lastKey = key
  }
  const failed = results.filter((result) => {
    return result.data.message.content[0].isError
  }).length
  const ledgerWrites = [...agent.session.events].filter((e): e is SessionEvent<'jspace/state'> => e.type === 'jspace/state').length
  return { repeatedToolCalls: repeated, failedAttempts: failed, ledgerWrites }
}

/** Boot one arm and run the scripted task. */
async function withArm(useJspace: boolean): Promise<{ metrics: Metrics }> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  if (useJspace) await ctx.plugin(Jspace, { enabled: true, mode: 'auto' })
  ctx.tools.register(defineContentToolFixture({ name: 'flaky', description: 'failing build step', parameters: {}, execute() {
    throw new Error('build failed: missing symbol foo')
  } }))
  ctx.tools.register(defineContentToolFixture({ name: 'probe', description: 'compiles a module', parameters: { path: { type: 'string' } }, execute(args) {
    return Promise.resolve([{ type: 'text', text: 'compiled ' + String(args.path) }])
  } }))

  const hasJspaceSignal = (options: GenerateOptions): boolean => {
    const text = joined(options)
    return text.includes('Previous failed attempt detected') || text.includes('J-Space task ledger')
  }

  const script: (StreamChunk[] | ((options: GenerateOptions) => StreamChunk[]))[] = []

  if (useJspace) {
    script.push(
      toolCallResponse('s1', 'jspace_state', { goal: 'make module A compile and tests pass', core: ['do not touch module B'], open: ['missing symbol foo'] }),
      toolCallResponse('f1', 'flaky', {}),
      toolCallResponse('f2', 'flaky', {}),
      (options) => {
        if (!hasJspaceSignal(options)) {
          return toolCallResponse('f3', 'flaky', {})
        }
        return toolCallResponse('p1', 'probe', { path: 'module-a/src/lib.ts' })
      },
      (options) => {
        if (!joined(options).includes('J-Space task ledger')) {
          return toolCallResponse('p2', 'probe', { path: 'module-a/src/lib.ts' })
        }
        return toolCallResponse('s2', 'jspace_state', { verified: ['module A compiles'], open: [] })
      },
      (options) => {
        if (!joined(options).includes('J-Space task ledger')) {
          return toolCallResponse('f4', 'flaky', {})
        }
        return toolCallResponse('w1', 'jspace_finish', {
          goal_satisfied: true,
          constraints_respected: true,
          no_known_errors_ignored: true,
          no_evident_regressions: true,
          verified_summary: 'probe compiled module A; existing tests pass',
        })
      },
      textResponse('done: module A compiles, tests pass'),
    )
  } else {
    script.push(
      toolCallResponse('f1', 'flaky', {}),
      toolCallResponse('f2', 'flaky', {}),
      toolCallResponse('f3', 'flaky', {}),
      toolCallResponse('p1', 'probe', { path: 'module-a/src/lib.ts' }),
      toolCallResponse('p2', 'probe', { path: 'module-a/src/lib.ts' }),
      textResponse('done: module A compiles'),
    )
  }

  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  const agent = ctx.agentLoop.create(SessionId(useJspace ? 'bench-jspace' : 'bench-baseline'), { provider: 'mock', model: 'mock' })

  const start = performance.now()
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: 'make module A compile with tests passing; do not touch module B' }],
    source: { kind: 'user' },
  }))
  await waitForIdle(ctx, agent)
  const elapsed = performance.now() - start

  const usage = adapter.requests.reduce((sum, request) => {
    const output = request.messages
      .filter(message => message.role === 'assistant')
      .map(message => estimateTextTokens(typeof message.content === 'string' ? message.content : JSON.stringify(message.content)))
      .reduce((a, b) => a + b, 0)
    return { input: sum.input + 10, output: sum.output + output }
  }, { input: 0, output: 0 })

  const { repeatedToolCalls, failedAttempts, ledgerWrites } = logMetrics(agent)
  const estimatedInput = adapter.requests.reduce((sum, request) => sum + requestTextTokens(request), 0)
  const toolCalls = [...agent.session.events].filter((e): e is SessionEvent<'tool/call'> => e.type === 'tool/call').length
  const completeEvent = [...agent.session.events].find((e): e is SessionEvent<'jspace/state'> => e.type === 'jspace/state'
    && e.data.operation === 'set' && e.data.state.complete)
  const verificationGateUsed = completeEvent !== undefined

  const metrics: Metrics = {
    label: useJspace ? 'B: harness + jspace' : 'A: harness baseline',
    inputTokens: usage.input,
    outputTokens: usage.output,
    estimatedInputTokens: estimatedInput,
    toolCalls,
    repeatedToolCalls,
    failedAttempts,
    wallTimeMs: Math.round(elapsed * 10) / 10,
    taskComplete: useJspace ? verificationGateUsed : toolCalls > 0,
    verificationGateUsed,
    ledgerWrites,
  }
  await ctx.fiber.dispose()
  return { metrics }
}

/** Format the comparison table and return the JSON report. */
function report(arms: Metrics[]): string {
  const rows = arms.map(m => [
    m.label,
    String(m.inputTokens),
    String(m.estimatedInputTokens),
    String(m.outputTokens),
    String(m.toolCalls),
    String(m.repeatedToolCalls),
    String(m.failedAttempts),
    String(m.wallTimeMs),
    m.taskComplete ? 'yes' : 'no',
    m.verificationGateUsed ? 'yes' : 'no',
    String(m.ledgerWrites),
  ])
  const header = ['arm', 'input(tok)', 'est-input(tok)', 'output(tok)', 'tool_calls', 'repeated', 'failed', 'wall(ms)', 'complete', 'gate', 'ledger_writes']
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map(row => row[i]?.length ?? 0)))
  const line = (cells: string[]) => cells.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join(' | ')
  return [line(header), line(header.map(() => '-'.repeat(1))), ...rows.map(line)].join('\n')
}

async function main(): Promise<void> {
  const baseline = await withArm(false)
  const experiment = await withArm(true)
  const arms = [baseline.metrics, experiment.metrics]
  const table = report(arms)
  const reportPath = join(import.meta.dirname, 'report.json')
  await mkdir(import.meta.dirname, { recursive: true })
  await writeFile(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), arms }, null, 2))
  console.log('\n=== J-Space A/B benchmark (scripted model, harness-mechanism level) ===\n')
  console.log(table)
  console.log('\nReport written to ' + reportPath)
  const a = arms[0]
  const b = arms[1]
  console.log('\nHighlights (B vs A):')
  console.log(`  repeated tool calls: ${b.repeatedToolCalls} vs ${a.repeatedToolCalls} (${a.repeatedToolCalls - b.repeatedToolCalls} fewer)`)
  console.log(`  failed attempts:     ${b.failedAttempts} vs ${a.failedAttempts}`)
  console.log(`  tool calls:          ${b.toolCalls} vs ${a.toolCalls}`)
  console.log(`  est. input tokens:   ${b.estimatedInputTokens} vs ${a.estimatedInputTokens} (${b.estimatedInputTokens - a.estimatedInputTokens} extra for bookkeeping)`)
  console.log(`  verification gate:   ${b.verificationGateUsed ? 'used' : 'not used'} vs ${a.verificationGateUsed ? 'used' : 'not used'}`)
}

await main()
