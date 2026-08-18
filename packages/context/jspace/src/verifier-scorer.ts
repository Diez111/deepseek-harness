/**
 * Minimal TS port of the "LLM-as-a-verifier" idea: an independent LLM scores a
 * completion against declared criteria, and the completion gate requires the
 * score. Harness-native adaptation: no Python runtime, one auxiliary
 * `ctx.llm` call, opt-in via `verifierEnabled`. The source repo calibrates by
 * the expected score over the full logprob distribution of score tokens; that
 * refinement is deferred (the gateway accepts logprobs, so a later port can
 * add it). Scoring is a bounded integer 0..4 parsed from a single digit.
 * @module @deepseek-ai/dsh-jspace/verifier-scorer
 */

import type { Context } from '@deepseek-ai/cordis'
import { BlockAssembler, createUserMessage, deepFreeze } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-agent-default-model'

/** Upper bound of the verifier score scale. */
export const VERIFIER_MAX_SCORE = 4

/** Default criteria a deployment scores against unless configured. */
export const DEFAULT_VERIFIER_CRITERIA = ['Correctness', 'Completeness', 'Constraint preservation']

/**
 * Parse the first bounded integer (0..4) from a model answer. Anything else
 * (no digit, out of range) returns `undefined`.
 * @param text - model output.
 * @returns the parsed score, or `undefined` when it cannot be read confidently.
 */
export function parseVerifierScore(text: string): number | undefined {
  // Bounded single digit, not part of a larger number or decimal.
  const match = /(?:^|[^0-9.])([0-4])(?:[^0-9.]|$)/.exec(text)
  return match ? Number(match[1]) : undefined
}

/**
 * Build the verifier system/user prompt pair for a completion against criteria.
 * @param goal - compact completion objective.
 * @param verified - verified-evidence lines.
 * @param summary - optional verified_summary from the finish call.
 * @param criteria - score dimensions.
 * @returns an object with the system and user prompt strings.
 */
export function buildVerifierPrompt(
  goal: string,
  verified: readonly string[],
  summary: string | undefined,
  criteria: readonly string[],
): { system: string; user: string } {
  const system = 'You are an independent completion verifier. Rate on a scale 0..'
    + String(VERIFIER_MAX_SCORE)
    + ' (0 = clearly wrong or incomplete, '
    + String(VERIFIER_MAX_SCORE)
    + ' = fully satisfies the criteria). Failing tests, missing evidence, or plainly wrong answers MUST score 0 or 1. Output ONLY a single digit.'
  const evidence = summary !== undefined && summary.trim().length > 0
    ? summary
    : verified.length > 0 ? verified.join('; ') : '(no recorded evidence)'
  const user = 'Objective: ' + goal
    + '\nCriteria: ' + criteria.join(', ')
    + '\nEvidence: ' + evidence
    + '\nScore (single digit 0..' + String(VERIFIER_MAX_SCORE) + '):'
  return { system, user }
}

/** Verifier route resolution result. */
export interface VerifierRoute {
  readonly provider: string
  readonly model: string
}

/**
 * Resolve the verifier route: explicit config wins; otherwise the deployment default
 * agent model.
 * @param ctx - harness context.
 * @param config - verifierProvider / verifierModel from plugin config.
 * @returns the route, or `undefined` when neither is available.
 */
export function resolveVerifierRoute(
  ctx: Context,
  config: { verifierProvider?: string; verifierModel?: string },
): VerifierRoute | undefined {
  if (config.verifierProvider !== undefined && config.verifierModel !== undefined) {
    return { provider: config.verifierProvider, model: config.verifierModel }
  }
  const llm = ctx.get('llm')
  if (llm === undefined) return undefined
  const defaultModel = ctx.get('agentDefaultModel')
  if (defaultModel === undefined) return undefined
  const selection = defaultModel.currentSelection()
  return { provider: selection.provider, model: selection.model }
}

/**
 * Run one bounded verifier call and return a score, failing open (undefined) on
 * any routing, transport, or parse failure; the verifier must never break the
 * completion gate on its own malfunction — it only ADDS evidence.
 * @param ctx - harness context with `llm` service.
 * @param route - provider/model for the auxiliary call.
 * @param prompt - system/user prompt pair.
 * @param opts - timeout and output cap.
 * @returns the parsed score, or `undefined` when the verifier could not judge.
 */
export async function runVerifierCall(
  ctx: Context,
  route: VerifierRoute,
  prompt: { system: string; user: string },
  opts: { timeoutMs: number; maxOutputTokens: number },
): Promise<number | undefined> {
  const llm = ctx.get('llm')
  if (llm === undefined) return undefined
  const signal = AbortSignal.timeout(opts.timeoutMs)
  const messages: Message[] = [createUserMessage({
    content: [{ type: 'text', text: prompt.user }],
    source: { kind: 'plugin', plugin: 'jspace' },
  })]
  const options: GenerateOptions = deepFreeze({
    provider: route.provider,
    model: route.model,
    messages,
    system: prompt.system,
    maxTokens: opts.maxOutputTokens,
    signal,
  })
  const assembler = new BlockAssembler()
  try {
    for await (const chunk of llm.stream(options)) {
      signal.throwIfAborted()
      assembler.push(chunk)
    }
  } catch {
    return undefined
  }
  if (signal.aborted) return undefined
  const blocks = assembler.blocks()
  return parseVerifierScore(blocks
    .filter((block): block is Extract<(typeof blocks)[number], { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join(' '))
}

/** Aggregate repeated verifier scores conservatively (min), for a completion gate. */
export function aggregateVerifierScores(scores: readonly number[]): number | undefined {
  return scores.length > 0 ? Math.min(...scores) : undefined
}
