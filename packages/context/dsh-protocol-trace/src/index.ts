/**
 * `@deepseek-ai/dsh-protocol-trace`: per-request protocol trace for the web
 * and headless agent loop. A function/namespace plugin (NOT a default-export
 * service) that observes the durable session event stream and appends one
 * `session/protocol-trace` event per model request, recording route facts from
 * `request/header` merged with the assembled `assistant/message` (reasoning
 * presence, tool calls, usage, cache fields). Purely observational: it changes
 * no behavior and never touches model-visible input. This is the observability
 * seed (Native Contract Guard) referenced by the DSH-EVO baseline.
 * @module @deepseek-ai/dsh-protocol-trace
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { AssistantMessage, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Log-only per-request protocol trace (route, effort, tokens, reasoning, cache). @mode Log */
    'session/protocol-trace': ProtocolTracePayload
  }
}

/** Compact per-request trace emitted to the durable session log. */
export interface ProtocolTracePayload {
  /** Provider route of the request. */
  provider: string
  /** Provider-owned model id of the request. */
  model: string
  /** Reasoning effort id when the request carried one. */
  reasoningEffort?: string
  /** Requested max output tokens when present. */
  maxTokens?: number
  /** Sampled temperature scalar when present. */
  temperature?: number
  /** Prompt-side input tokens for the step. */
  inputTokens?: number
  /** Completion-side output tokens for the step. */
  outputTokens?: number
  /** Reasoning tokens isolated by the adapter when present. */
  reasoningTokens?: number
  /** Whether the assembled message carried reasoning blocks. */
  reasoningPresent: boolean
  /** Number of tool calls in the assembled message. */
  toolCalls: number
  /** Prefix-cache read tokens when the backend reports them. */
  cacheReadTokens?: number
  /** Prefix-cache write tokens when the backend reports them. */
  cacheWriteTokens?: number
  /** Unix epoch ms of the emitted trace. */
  ts: number
}

/** Route snapshot captured from the latest `request/header`. */
export interface RouteSnapshot {
  provider: string
  model: string
  reasoningEffort?: string
  maxTokens?: number
  temperature?: number
}

/**
 * Merge a route snapshot with an assembled assistant message and its usage into
 * one trace payload. Pure and unit-testable.
 * @param route - last `request/header` route facts.
 * @param message - the finalized assistant message.
 * @param usage - usage attributed to the message when present.
 * @param ts - event timestamp.
 * @returns the complete trace payload.
 */
export function buildTrace(
  route: RouteSnapshot | undefined,
  message: AssistantMessage,
  usage: TokenUsage | undefined,
  ts: number,
): ProtocolTracePayload {
  const blocks = message.content
  const reasoningPresent = blocks.some(block => block.type === 'reasoning')
  const toolCalls = blocks.filter(block => block.type === 'tool-call').length
  return {
    provider: route?.provider ?? 'unknown',
    model: route?.model ?? 'unknown',
    ...route?.reasoningEffort !== undefined ? { reasoningEffort: route.reasoningEffort } : {},
    ...route?.maxTokens !== undefined ? { maxTokens: route.maxTokens } : {},
    ...route?.temperature !== undefined ? { temperature: route.temperature } : {},
    ...usage?.inputTokens !== undefined ? { inputTokens: usage.inputTokens } : {},
    ...usage?.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {},
    ...usage?.reasoningTokens !== undefined ? { reasoningTokens: usage.reasoningTokens } : {},
    ...usage?.cacheReadTokens !== undefined ? { cacheReadTokens: usage.cacheReadTokens } : {},
    ...usage?.cacheWriteTokens !== undefined ? { cacheWriteTokens: usage.cacheWriteTokens } : {},
    reasoningPresent,
    toolCalls,
    ts,
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'protocol-trace'

/** Loader-configurable settings (feature flag). */
export interface Config {
  /** Master switch; when false nothing is registered or appended. Default true once composed. */
  enabled?: boolean
}

/** Schemastery config for the observable trace. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
})

/**
 * Observe the session event stream and append one trace per model request.
 * @param ctx - cordis context.
 * @param config - plugin config.
 */
/** Mutable route state shared by the observer across events. */
export interface ProtocolTraceState {
  route?: RouteSnapshot
}

/**
 * Observe one session event and append the trace when warranted. The listener
 * routes through this so the discrimination is directly unit-testable; the
 * durable session/event wiring stays the thin standard listener.
 * @param session - owning session.
 * @param event - one durable session event (envelope with type/data).
 * @param state - in-progress route snapshot.
 */
export function onSessionEvent(session: Session, event: SessionEvent, state: ProtocolTraceState): void {
  if (event.type === 'request/header') {
    const headerConfig = event.data.header.config
    state.route = {
      provider: headerConfig.provider,
      model: headerConfig.model,
      ...headerConfig.reasoningEffort !== undefined ? { reasoningEffort: headerConfig.reasoningEffort } : {},
      ...headerConfig.maxTokens !== undefined ? { maxTokens: headerConfig.maxTokens } : {},
      ...headerConfig.temperature !== undefined ? { temperature: headerConfig.temperature } : {},
    }
    return
  }
  if (event.type !== 'assistant/message') return
  session.append('session/protocol-trace', buildTrace(state.route, event.data.message, event.data.usage, Date.now()))
}

export function apply(ctx: Context, config: Config): void {
  const enabled = config.enabled ?? true
  if (!enabled) return
  const state: ProtocolTraceState = {}
  ctx.on('session/event', (session, event) => {
    onSessionEvent(session, event, state)
  }, { global: true })
}
