/**
 * The J-Space controller: an opt-in compact durable task-state ledger
 * (GOAL/CORE/VERIFIED/OPEN/NEXT plus bounded failed approaches), a failure-aware
 * retry guard, a completion gate, and mode routing (fast/full/loop/auto). The
 * ledger is event-sourced in the session log, folded last-write-wins, and
 * re-injected as dynamic runtime context (survives compaction/resume). When
 * \`enabled\` is false the plugin registers nothing, so the harness behaves
 * exactly as before.
 * @module @deepseek-ai/dsh-jspace
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { HarnessError, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { JsonValue, Session } from '@deepseek-ai/dsh-session'
import type { AssembleContext } from '@deepseek-ai/dsh-system-prompt'
import type { PostToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import {
  DEFAULT_VERIFIER_CRITERIA, VERIFIER_MAX_SCORE, buildVerifierPrompt,
  resolveVerifierRoute, runVerifierCall,
} from './verifier-scorer.ts'
import { JSPACE_MAX_LIST_ITEMS, applyJSpaceStateFold, foldJSpaceState } from './fold.ts'
import type { JSpaceStateChangeMeta } from './domain.ts'
import { JSPACE_STATE_VERSION } from './domain.ts'
import { effectiveMode } from './mode.ts'
import { renderJSpaceState, type RenderJSpaceStateOptions } from './render.ts'
import { checkCompletion, describeCompletion, type CompletionAck } from './verifier.ts'
import {
  AttemptMemory, compileAttemptFilter, preview, trackedTool, type AttemptFilter,
} from './attempts.ts'
import type { JSpaceAttempt, JSpaceMode, JSpaceModeChoice, JSpaceState } from './types.ts'

export const name = 'jspace'

/** Services the controller registers on; their presence is required to compose it. */
export const inject = ['systemPrompt', 'tools'] as const

/** J-Space controller configuration: the feature flag plus tier and budget knobs. */
export interface Config {
  /** Master switch. When false (default) the plugin registers nothing. */
  enabled?: boolean
  /**
   * Inject a short guidance section telling the model to keep the ledger for
   * multi-step tasks and to pass jspace_finish before declaring completion.
   * Off it stays fully opt-in (the model reads the tool descriptions only).
   * Defaults to true when enabled.
   */
  autoGuide?: boolean
  /** Tier: explicit fast/full/loop, or auto-resolution from the ledger (default). */
  mode?: JSpaceModeChoice
  /** Cap on every bounded ledger list (core/verified/open), default 12. */
  maxItems?: number
  /** Cap on each ledger item's characters, default 200. */
  maxItemChars?: number
  /** Cap on the next-action text, default 300. */
  maxNextChars?: number
  /** Cap on failedApproaches entries, default 8. */
  maxFailedItems?: number
  /** Cap on each failure reason's characters, default 160. */
  maxReasonChars?: number
  /** Byte budget of the injected state block, default 2400. */
  maxStateBytes?: number
  /** Require verified evidence before jspace_finish accepts completion, default true. */
  requireVerification?: boolean
  /**
   * After a context compaction, inject a re-anchor notice onto the owning
   * agent's next request so it re-reads the durable ledger instead of
   * drifting. Defaults to true when enabled; no-op in fast mode or without a
   * ledger.
   */
  reanchorAfterCompaction?: boolean
  /** Append detected failures to the durable ledger (extra log events), default false. */
  persistFailedAttempts?: boolean
  /** Independent verifier (LLM-as-a-verifier): an extra LLM call scores the completion. Default off. */
  verifierEnabled?: boolean
  /** Minimum verifier score (0..4) required to complete. Default 3. */
  verifierMinScore?: number
  /** Criteria the verifier scores against. Default Correctness + Completeness. */
  verifierCriteria?: string[]
  /** Explicit verifier route (provider/model); otherwise the deployment default. */
  verifierProvider?: string
  verifierModel?: string
  /** Auxiliary verifier call timeout in ms, default 30000. */
  verifierTimeoutMs?: number
  /** Auxiliary verifier output-token cap, default 16. */
  verifierMaxOutputTokens?: number
  /** Tool-name patterns to track for failure memory; empty means all. */
  attemptInclude?: string[]
  /** Tool-name patterns transparent to failure memory. */
  attemptExclude?: string[]
  /** Cap on argument/failure preview text quoted in an advisory, default 200. */
  attemptPreviewChars?: number
}

/** Schemastery config for the controller. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(false),
  autoGuide: z.boolean().default(true),
  mode: z.union(['auto', 'fast', 'full', 'loop'] as const).default('auto'),
  maxItems: z.number().step(1).min(1).default(12),
  maxItemChars: z.number().step(1).min(1).default(200),
  maxNextChars: z.number().step(1).min(1).default(300),
  maxFailedItems: z.number().step(1).min(1).default(8),
  maxReasonChars: z.number().step(1).min(1).default(160),
  maxStateBytes: z.number().step(1).min(1).default(2400),
  requireVerification: z.boolean().default(true),
  reanchorAfterCompaction: z.boolean().default(true),
  persistFailedAttempts: z.boolean().default(false),
  verifierEnabled: z.boolean().default(false),
  verifierMinScore: z.number().step(1).min(0).max(VERIFIER_MAX_SCORE).default(3),
  verifierCriteria: z.array(z.string()).default([...DEFAULT_VERIFIER_CRITERIA]),
  verifierProvider: z.string(),
  verifierModel: z.string(),
  verifierTimeoutMs: z.number().step(1).min(1).default(30000),
  verifierMaxOutputTokens: z.number().step(1).min(1).default(16),
  attemptInclude: z.array(z.string()).default([]),
  attemptExclude: z.array(z.string()).default(['todo_write', 'jspace_state', 'jspace_finish']),
  attemptPreviewChars: z.number().step(1).min(1).default(200),
})

/** Fully materialized controller policy. */
interface ResolvedConfig {
  readonly enabled: boolean
  readonly autoGuide: boolean
  readonly mode: JSpaceModeChoice
  readonly maxItems: number
  readonly maxItemChars: number
  readonly maxNextChars: number
  readonly maxFailedItems: number
  readonly maxReasonChars: number
  readonly maxStateBytes: number
  readonly requireVerification: boolean
  readonly reanchorAfterCompaction: boolean
  readonly persistFailedAttempts: boolean
  readonly verifierEnabled: boolean
  readonly verifierMinScore: number
  readonly verifierCriteria: string[]
  readonly verifierProvider?: string
  readonly verifierModel?: string
  readonly verifierTimeoutMs: number
  readonly verifierMaxOutputTokens: number
  readonly filter: AttemptFilter
  readonly attemptPreviewChars: number
}

/** Validate a positive safe integer with a fallback. */
function positiveInt(value: number | undefined, fallback: number, name: string): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < 1) {
    throw new Error(`jspace: ${name} must be a positive safe integer`)
  }
  return result
}

/** Validate config fail-loud, even when apply is called outside the Loader. */
function resolveConfig(config: Config): ResolvedConfig {
  const maxItems = positiveInt(config.maxItems, 12, 'maxItems')
  if (maxItems > JSPACE_MAX_LIST_ITEMS) {
    throw new Error(`jspace: maxItems must not exceed ${JSPACE_MAX_LIST_ITEMS}`)
  }
  return {
    enabled: config.enabled ?? false,
    autoGuide: config.autoGuide ?? true,
    mode: config.mode ?? 'auto',
    maxItems,
    maxItemChars: positiveInt(config.maxItemChars, 200, 'maxItemChars'),
    maxNextChars: positiveInt(config.maxNextChars, 300, 'maxNextChars'),
    maxFailedItems: positiveInt(config.maxFailedItems, 8, 'maxFailedItems'),
    maxReasonChars: positiveInt(config.maxReasonChars, 160, 'maxReasonChars'),
    maxStateBytes: positiveInt(config.maxStateBytes, 2400, 'maxStateBytes'),
    requireVerification: config.requireVerification ?? true,
    reanchorAfterCompaction: config.reanchorAfterCompaction ?? true,
    persistFailedAttempts: config.persistFailedAttempts ?? false,
    verifierEnabled: config.verifierEnabled ?? false,
    verifierMinScore: config.verifierMinScore ?? 3,
    verifierCriteria: config.verifierCriteria ?? [...DEFAULT_VERIFIER_CRITERIA],
    ...config.verifierProvider !== undefined ? { verifierProvider: config.verifierProvider } : {},
    ...config.verifierModel !== undefined ? { verifierModel: config.verifierModel } : {},
    verifierTimeoutMs: config.verifierTimeoutMs ?? 30000,
    verifierMaxOutputTokens: config.verifierMaxOutputTokens ?? 16,
    filter: compileAttemptFilter(
      config.attemptInclude ?? [],
      config.attemptExclude ?? ['todo_write', 'jspace_state', 'jspace_finish'],
    ),
    attemptPreviewChars: positiveInt(config.attemptPreviewChars, 200, 'attemptPreviewChars'),
  }
}

/**
 * A model-supplied failed-approach entry. Loose input; normalized (trimmed,
 * capped, default result) on write.
 */
export interface FailedApproachInput {
  readonly tool?: string
  readonly action: string
  readonly reason: string
  readonly result?: 'failed' | 'blocked'
}

/**
 * Fields one \`jspace_state\` call may change. List fields replace whole
 * lists; scalar fields set or clear; \`clear: true\` discards the ledger.
 */
export interface LedgerPatch {
  readonly goal?: string
  readonly core?: readonly string[]
  readonly verified?: readonly string[]
  readonly open?: readonly string[]
  readonly next?: string
  readonly failedApproaches?: readonly FailedApproachInput[]
  readonly mode?: JSpaceModeChoice
  readonly clear?: boolean
}

/**
 * Read the current ledger by folding the session log.
 * @param session - the owning session.
 * @returns the folded ledger, or \`null\` before the first write / after a clear.
 */
export function currentState(session: Session): JSpaceState | null {
  return foldJSpaceState(session.events)
}

/**
 * Build a per-session memoized ledger reader. The fold is append-only and
 * last-write-wins, so each access folds only the events since the last read;
 * a long session pays O(change) per access instead of O(history).
 * @returns a read function keyed by session.
 */
export function makeLedgerReader(): (session: Session) => JSpaceState | null {
  const cache = new WeakMap<Session, { seq: number; value: JSpaceState | null }>()
  return (session: Session): JSpaceState | null => {
    const events = session.events
    const entry = cache.get(session)
    if (entry !== undefined && entry.seq === events.length) return entry.value
    const from = entry?.seq ?? 0
    let value: JSpaceState | null = entry?.value ?? null
    for (const event of events.slice(from)) {
      value = applyJSpaceStateFold(value, event)
    }
    cache.set(session, { seq: events.length, value })
    return value
  }
}

/**
 * Commit a ledger change (set or clear) to the session log.
 * @param agent - agent whose session owns the ledger.
 * @param next - builds the next snapshot from the current one (\`null\` clears).
 * @returns the committed snapshot, or \`null\` after a clear.
 */
export function commitState(agent: Agent, next: (previous: JSpaceState | null) => JSpaceState | null): JSpaceState | null {
  const previous = currentState(agent.session)
  const built = next(previous)
  if (built === null) {
    agent.session.append('jspace/state', {
      kind: 'jspace/state',
      version: JSPACE_STATE_VERSION,
      operation: 'clear',
      clearedAt: Date.now(),
    } satisfies JSpaceStateChangeMeta)
    return null
  }
  agent.session.append('jspace/state', {
    kind: 'jspace/state',
    version: JSPACE_STATE_VERSION,
    operation: 'set',
    state: built,
  } satisfies JSpaceStateChangeMeta)
  return built
}

/** Trim one optional scalar: empty clears it, otherwise cap characters. */
function trimScalar(value: string | undefined, chars: number): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  if (trimmed.length === 0) return undefined
  return trimmed.slice(0, chars)
}

/** Normalize one bounded string list: trim, drop empties, dedupe, cap. */
function normalizeItems(items: readonly string[] | undefined, maxItems: number, chars: number): string[] | undefined {
  if (items === undefined) return undefined
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of items) {
    const trimmed = item.trim()
    if (trimmed.length === 0 || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed.slice(0, chars))
    if (result.length >= maxItems) break
  }
  return result
}

/** Normalize one failed-approach entry for durable storage. */
function normalizeAttempt(input: FailedApproachInput, cfg: ResolvedConfig, at: number): JSpaceAttempt {
  const action = input.action.trim().slice(0, cfg.maxItemChars)
  const reason = input.reason.trim().slice(0, cfg.maxReasonChars)
  if (action.length === 0 || reason.length === 0) {
    throw new HarnessError(
      'jspace_state: each failed_approach needs a non-empty action and reason',
      'JSPACE_INVALID_ATTEMPT',
    )
  }
  const tool = trimScalar(input.tool, cfg.maxItemChars)
  return {
    ...tool === undefined ? {} : { tool },
    action,
    result: input.result === 'blocked' ? 'blocked' : 'failed',
    reason,
    at,
  }
}

/** Merge model-curated attempts with any auto-persisted ones, newest first and bounded. */
function mergeAttempts(existing: readonly JSpaceAttempt[], additions: readonly JSpaceAttempt[], cfg: ResolvedConfig): JSpaceAttempt[] {
  const merged = [...existing, ...additions].sort((a, b) => b.at - a.at)
  const seen = new Set<string>()
  const result: JSpaceAttempt[] = []
  for (const attempt of merged) {
    const key = JSON.stringify([attempt.tool ?? '', attempt.action, attempt.reason, attempt.result])
    if (seen.has(key)) continue
    seen.add(key)
    result.push(attempt)
    if (result.length >= cfg.maxFailedItems) break
  }
  return result
}

/** Resolve the stored mode for a ledger write. */
function storedMode(
  cfg: ResolvedConfig,
  previous: JSpaceState | null,
  patch: LedgerPatch,
  goal: string | undefined,
  open: string[],
): JSpaceMode {
  if (cfg.mode !== 'auto') return cfg.mode
  if (patch.mode !== undefined && patch.mode !== 'auto') return patch.mode
  if (previous?.mode !== undefined) return previous.mode
  return goal !== undefined || open.length > 0 ? 'loop' : 'full'
}

/** Whether a patch changes anything when no ledger exists yet. */
function patchIsMeaningless(patch: LedgerPatch): boolean {
  return patch.goal === undefined
    && patch.core === undefined
    && patch.verified === undefined
    && patch.open === undefined
    && patch.next === undefined
    && patch.failedApproaches === undefined
    && patch.mode === undefined
    && patch.clear !== true
}

/**
 * Apply a model patch onto the current ledger, enforcing caps.
 * @param previous - ledger before this write (\`null\` when none exists).
 * @param patch - fields the model changed.
 * @param cfg - resolved controller policy.
 * @param now - epoch milliseconds for timestamps.
 * @returns the next snapshot, or \`null\` for a clear.
 */
export function applyPatch(previous: JSpaceState | null, patch: LedgerPatch, cfg: ResolvedConfig, now: number): JSpaceState | null {
  if (patch.clear === true) return null
  if (previous === null && patchIsMeaningless(patch)) {
    throw new HarnessError(
      'jspace_state: no ledger exists and no field was provided; set at least one field or use clear: true',
      'JSPACE_EMPTY_UPDATE',
    )
  }
  const goal = trimScalar(patch.goal, cfg.maxItemChars)
  const core = normalizeItems(patch.core, cfg.maxItems, cfg.maxItemChars)
  const verified = normalizeItems(patch.verified, cfg.maxItems, cfg.maxItemChars)
  const open = normalizeItems(patch.open, cfg.maxItems, cfg.maxItemChars)
  const next = trimScalar(patch.next, cfg.maxNextChars)
  const failedApproaches = patch.failedApproaches === undefined
    ? undefined
    : patch.failedApproaches.map(input => normalizeAttempt(input, cfg, now))
  const existingOpen = open ?? previous?.open ?? []
  const mode = storedMode(cfg, previous, patch, goal, existingOpen)
  if (previous === null) {
    return {
      revision: 1,
      mode,
      ...goal === undefined ? {} : { goal },
      core: core ?? [],
      verified: verified ?? [],
      open: open ?? [],
      ...next === undefined ? {} : { next },
      failedApproaches: failedApproaches ?? [],
      complete: false,
      createdAt: now,
      updatedAt: now,
    }
  }
  return {
    ...previous,
    revision: previous.revision + 1,
    mode,
    ...goal === undefined ? {} : { goal },
    core: core ?? previous.core,
    verified: verified ?? previous.verified,
    open: open ?? previous.open,
    ...next === undefined ? {} : { next },
    ...failedApproaches === undefined
      ? { failedApproaches: previous.failedApproaches }
      : { failedApproaches: mergeAttempts(previous.failedApproaches, failedApproaches, cfg) },
    complete: false,
    updatedAt: now,
  }
}

/** Short proactive-use guidance the model sees when autoGuide is on. */
const AUTO_GUIDE = 'Maintain the J-Space task ledger (jspace_state) for any task '
  + 'with several steps: record GOAL, CORE constraints, VERIFIED evidence, OPEN '
  + 'problems, and NEXT action, keeping it compact. Before declaring a task '
  + 'complete, call jspace_finish; it rejects the claim until every OPEN item is '
  + 'resolved or documented and the closure acknowledgements are given. Do not '
  + 'use these tools for trivial single-step work.'

/** Advisory source label stamped on every injected note. */
const PLUGIN_SOURCE = { kind: 'plugin' as const, plugin: 'jspace' }

/** Reminder text when a previously failed call is retried and fails again. */
function failedRepeatReminder(call: { tool: string; argsPreview: string; reason: string }): string {
  return 'Previous failed attempt detected:\n'
    + `- tool: ${call.tool}\n`
    + `- arguments: ${call.argsPreview}\n`
    + `- reason: ${call.reason}\n`
    + 'You already tried this exact call and it failed. Do not repeat it unless new '
    + 'evidence changed the situation; change the approach or record the failure in '
    + 'the jspace ledger (failed_approaches).'
}

/** Extract a bounded diagnostic from a failed tool result. */
function failureReason(error: unknown, chars: number): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message: unknown = error.message
    if (typeof message === 'string' && message.length > 0) return preview(message, chars)
  }
  return preview(String(error) === 'undefined' ? 'tool call failed' : String(error), chars)
}

const STATE_DESCRIPTION = 'Maintain the compact durable J-Space task ledger for '
  + 'long multi-step work. The ledger records GOAL (main objective), CORE '
  + '(constraints and decisions that must not be lost), VERIFIED (facts proven '
  + 'by code, tests, tools, or inspection), OPEN (pending problems), NEXT (next '
  + 'concrete action), and failed_approaches (attempts that failed and why). The '
  + 'ledger survives context compaction and is re-injected automatically; it '
  + 'must stay small and current. Call with no arguments to read the current '
  + 'ledger. To change it, send the COMPLETE replacement arrays for any list '
  + 'field you touch (core, verified, open, failed_approaches replace whole '
  + 'lists). OPEN items block completion until they are resolved in the ledger '
  + 'or documented when calling jspace_finish. Use this only for tasks with '
  + 'several steps; skip it for trivial single-step work.'

const FINISH_DESCRIPTION = 'Verification-before-completion gate: claims the task '
  + 'is complete and runs the closure checklist. Rejects the claim — with the '
  + 'unmet conditions — until every OPEN item in the jspace ledger is resolved '
  + '(remove it via jspace_state) or listed in resolved_open with a reason, '
  + 'verified evidence exists (when the ledger took action), and you '
  + 'acknowledge goal satisfaction, respected constraints, no ignored known '
  + 'errors, and no evident regressions. Do not call this merely after editing '
  + 'files or a passing isolated command; call it after the required '
  + 'verification runs. A rejected claim means keep working or document the '
  + 'divergence explicitly.'

/** Register one tool on the controller context. */
function withTools(ctx: Context, cfg: ResolvedConfig): void {
  ctx.tools.register(defineTool({
    name: 'jspace_state',
    description: STATE_DESCRIPTION,
    parameters: {
      goal: { type: 'string', description: 'Compact main objective; empty string clears it.' },
      core: { type: 'array', items: { type: 'string' }, description: 'COMPLETE replacement list of CORE constraints and decisions.' },
      verified: { type: 'array', items: { type: 'string' }, description: 'COMPLETE replacement list of VERIFIED facts.' },
      open: { type: 'array', items: { type: 'string' }, description: 'COMPLETE replacement list of OPEN problems.' },
      next: { type: 'string', description: 'Next concrete action; empty string clears it.' },
      failed_approaches: {
        type: 'array',
        description: 'COMPLETE replacement list of failed approaches.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            tool: { type: 'string', description: 'Optional tool that was called.' },
            action: { type: 'string', required: true, description: 'Short description of the attempted approach.' },
            reason: { type: 'string', required: true, description: 'Decisive failure diagnostic.' },
            result: { type: 'string', enum: ['failed', 'blocked'], description: 'How the attempt ended.' },
          },
        },
      },
      mode: {
        type: 'string',
        enum: ['auto', 'fast', 'full', 'loop'],
        description: 'Tier for this ledger (auto resolves by content; configuration can force a tier).',
      },
      clear: { type: 'boolean', description: 'Discard the entire ledger.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          state: { type: 'json' },
        },
      },
      render: (_args, value) => [{ type: 'text' as const, text: JSON.stringify(value) }],
    },
    execute(args, exec) {
      if (!exec.agent) throw new HarnessError('jspace_state requires an owning agent session', 'JSPACE_NO_AGENT')
      const patch: LedgerPatch = {
        ...'goal' in args ? { goal: args.goal } : {},
        ...'core' in args ? { core: args.core } : {},
        ...'verified' in args ? { verified: args.verified } : {},
        ...'open' in args ? { open: args.open } : {},
        ...'next' in args ? { next: args.next } : {},
        ...'failed_approaches' in args
          ? { failedApproaches: args.failed_approaches }
          : {},
        ...'mode' in args ? { mode: args.mode } : {},
        ...args.clear === true ? { clear: true } : {},
      }
      const result = commitState(exec.agent, previous => applyPatch(previous, patch, cfg, Date.now()))
      return Promise.resolve({ state: (result === null ? null : result) as JsonValue })
    },
    presentCall: () => ({ card: 'generic', title: 'Update J-Space ledger', kind: 'other' }),
  }))

  ctx.tools.register(defineTool({
    name: 'jspace_finish',
    description: FINISH_DESCRIPTION,
    parameters: {
      goal_satisfied: { type: 'boolean', required: true, description: 'The original objective is satisfied.' },
      constraints_respected: { type: 'boolean', required: true, description: 'CORE constraints and stated restrictions were respected.' },
      no_known_errors_ignored: { type: 'boolean', required: true, description: 'No known error is being ignored.' },
      no_evident_regressions: { type: 'boolean', required: true, description: 'No evident regression was introduced.' },
      resolved_open: {
        type: 'array',
        description: 'OPEN ledger items the model explicitly documents instead of resolving (exact item text).',
        items: { type: 'string' },
      },
      verified_summary: { type: 'string', description: 'Optional one-line summary of the verification actually run.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          complete: { type: 'boolean', required: true },
          verifierScore: { type: 'number' },
        },
      },
      render: (_args, value) => [{ type: 'text' as const, text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      if (!exec.agent) throw new HarnessError('jspace_finish requires an owning agent session', 'JSPACE_NO_AGENT')
      const previous = currentState(exec.agent.session)
      const ack: CompletionAck = {
        goalSatisfied: args.goal_satisfied,
        constraintsRespected: args.constraints_respected,
        noKnownErrorsIgnored: args.no_known_errors_ignored,
        noEvidentRegressions: args.no_evident_regressions,
      }
      const documented = (args.resolved_open ?? [])
        .map(item => item.trim())
        .filter(item => item.length > 0)
      const check = checkCompletion({
        state: previous,
        documented,
        requireVerification: cfg.requireVerification,
        ack,
      })
      if (!check.ready) {
        throw new HarnessError(describeCompletion(check), 'JSPACE_COMPLETION_MISSING')
      }
      // Independent verifier (LLM-as-a-verifier, opt-in): an extra bounded call
      // scores the completion; a score below the floor rejects. Fails open.
      let verifierScore: number | undefined
      if (previous !== null && cfg.verifierEnabled && cfg.verifierCriteria.length > 0) {
        const route = resolveVerifierRoute(ctx, {
          ...cfg.verifierProvider !== undefined ? { verifierProvider: cfg.verifierProvider } : {},
          ...cfg.verifierModel !== undefined ? { verifierModel: cfg.verifierModel } : {},
        })
        if (route !== undefined) {
          const summary = typeof args.verified_summary === 'string' && args.verified_summary.trim().length > 0
            ? args.verified_summary
            : undefined
          const prompt = buildVerifierPrompt(
            previous.goal ?? 'complete the current task',
            previous.verified,
            summary,
            cfg.verifierCriteria,
          )
          const score = await runVerifierCall(ctx, route, prompt, {
            timeoutMs: cfg.verifierTimeoutMs,
            maxOutputTokens: cfg.verifierMaxOutputTokens,
          })
          verifierScore = score
          if (score !== undefined && score < cfg.verifierMinScore) {
            throw new HarnessError(
              `jspace_finish rejected by the verifier: score ${score} < ${cfg.verifierMinScore}`,
              'JSPACE_VERIFIER_LOW',
            )
          }
        }
      }
      if (previous !== null) {
        const summary = trimScalar(args.verified_summary, cfg.maxItemChars)
        const now = Date.now()
        commitState(exec.agent, (state) => {
          const current = state ?? previous
          const verified = summary === undefined
            ? current.verified
            : current.verified.includes(summary)
              ? current.verified
              : [...current.verified, summary].slice(0, cfg.maxItems)
          return {
            ...current,
            revision: current.revision + 1,
            verified,
            complete: true,
            updatedAt: now,
          }
        })
      }
      return { complete: true, ...verifierScore !== undefined ? { verifierScore } : {} }
    },
    presentCall: () => ({ card: 'generic', title: 'Verify and finish task', kind: 'other' }),
  }))
}

/** Install the failure-aware retry guard for the dispensed scope. */
function withAttemptGuard(ctx: Context, cfg: ResolvedConfig): void {
  const memories = new WeakMap<Agent, AttemptMemory>()
  const memoryFor = (agent: Agent): AttemptMemory => {
    let memory = memories.get(agent)
    if (memory === undefined) {
      memory = new AttemptMemory()
      memories.set(agent, memory)
    }
    return memory
  }

  const readLedger = makeLedgerReader()
  ctx.on('tools/post-execute', async (exec: ToolExecution, result: { isError: boolean; error?: unknown }, next: () => Promise<PostToolDecision>): Promise<PostToolDecision> => {
    const downstream = await next()
    if (!exec.agent) return downstream
    const mode = effectiveMode(cfg.mode, readLedger(exec.agent.session))
    if (mode === 'fast') return downstream
    if (!trackedTool(exec.name, cfg.filter)) return downstream
    const memory = memoryFor(exec.agent)

    if (!result.isError) {
      // Success is new evidence: forget an earlier failure of the same call.
      if (memory.priorFailure(exec.name, exec.arguments) !== undefined) {
        memory.forget(exec.name, exec.arguments)
      }
      return downstream
    }

    const reason = failureReason(result.error, cfg.attemptPreviewChars)
    const prior = memory.priorFailure(exec.name, exec.arguments)
    memory.markFailed(exec.name, exec.arguments, reason, cfg.attemptPreviewChars)
    let reminder: UserMessage | undefined
    if (prior !== undefined) {
      reminder = createUserMessage({
        content: [{ type: 'text', text: failedRepeatReminder({ tool: exec.name, argsPreview: prior.argsPreview, reason: prior.reason }) }],
        source: { ...PLUGIN_SOURCE, form: 'notice', summary: `${exec.name} retried after failure` },
      })
    }
    if (cfg.persistFailedAttempts) {
      // Fold the failure into the durable ledger so it survives compaction.
      commitState(exec.agent, (state) => {
        if (state === null) return state
        const attempt: JSpaceAttempt = {
          tool: exec.name,
          action: preview(exec.name, cfg.maxItemChars),
          result: 'failed',
          reason,
          at: Date.now(),
        }
        return {
          ...state,
          revision: state.revision + 1,
          failedApproaches: mergeAttempts(state.failedApproaches, [attempt], cfg),
          updatedAt: Date.now(),
        }
      })
    }
    if (!reminder) return downstream
    if (downstream.kind === 'block') {
      return { kind: 'block', feedback: downstream.feedback, additionalContexts: [reminder, ...downstream.additionalContexts ?? []] }
    }
    return { ...downstream, additionalContexts: [reminder, ...downstream.additionalContexts ?? []] }
  })

  ctx.on('agent/pre-step', ({ agent, messages }, next): Promise<PreStepDecision> => {
    if (messages.some(message => message.source.kind === 'user')) memories.delete(agent)
    return next()
  })
}

/** Re-anchor notice injected after context compaction. */
export function buildReanchorMessage(): UserMessage {
  return createUserMessage({
    content: [{
      type: 'text',
      text: '<system-reminder>\n'
        + 'Context was compacted. Re-anchor before continuing: consult your J-Space '
        + 'ledger (goal / core / verified / open / next) and its current content. If '
        + 'it is missing, re-establish it and continue toward the original objective; '
        + 'do not restart the task.\n'
        + '</system-reminder>',
    }],
    source: { ...PLUGIN_SOURCE, form: 'notice', summary: 're-anchor after compaction' },
  })
}

/** Register the dynamic ledger context block. */
function withContext(ctx: Context, cfg: ResolvedConfig): void {
  const options: RenderJSpaceStateOptions = { maxBytes: cfg.maxStateBytes }
  const readLedger = makeLedgerReader()
  ctx.systemPrompt.context({
    name: 'jspace',
    order: 300,
    text: (assembly: AssembleContext): string => {
      const agent = (assembly as { agent?: Agent }).agent
      if (agent === undefined) return ''
      const state = readLedger(agent.session)
      const mode = effectiveMode(cfg.mode, state)
      if (state === null || mode === 'fast') return ''
      return renderJSpaceState(state, options)
    },
  })
}

/**
 * Install the J-Space controller. When `enabled` is false nothing is
 * registered and the harness behaves exactly as before.
 * @param ctx - cordis context.
 * @param config - plugin config.
 */
/**
 * Re-anchor decision for one session: inject the re-anchor notice on the
 * owning agent when a durable ledger exists and the effective tier is not
 * fast. No-op for an ownerless session or one with no ledger.
 * @param ctx - context carrying the agent registry.
 * @param modeChoice - configured mode (auto resolves against the ledger).
 * @param session - the session whose context was compacted.
 */
export function maybeReanchor(ctx: Context, modeChoice: JSpaceModeChoice, session: Session): void {
  const readLedger = makeLedgerReader()
  const state = readLedger(session)
  if (state === null || effectiveMode(modeChoice, state) === 'fast') return
  const agent = ctx.agents.list().find(candidate => candidate.session === session)
  if (agent === undefined) return
  agent.inject(buildReanchorMessage())
}

/** Re-anchor the owning agent after a durable context compaction. */
function withReanchor(ctx: Context, cfg: ResolvedConfig): void {
  ctx.on('session/event', (session, event) => {
    // compaction/end arrives via the durable session log; its member type is
    // declared by the compaction seam, so widen for the string comparison.
    if ((event as { type?: string }).type !== 'compaction/end') return
    maybeReanchor(ctx, cfg.mode, session)
  }, { global: true })
}

export function apply(ctx: Context, config: Config): void {
  const cfg = resolveConfig(config)
  if (!cfg.enabled) return
  if (cfg.autoGuide) {
    // Small, deployment-gated guidance so the model self-starts the ledger on
    // multi-step work; off keeps the tools opt-in (descriptions only).
    ctx.systemPrompt.section({ name: 'jspace-guide', order: 20, text: AUTO_GUIDE })
  }
  withTools(ctx, cfg)
  withContext(ctx, cfg)
  withAttemptGuard(ctx, cfg)
  if (cfg.reanchorAfterCompaction) withReanchor(ctx, cfg)
}

export {
  DEFAULT_VERIFIER_CRITERIA,
  VERIFIER_MAX_SCORE,
  buildVerifierPrompt,
  parseVerifierScore,
} from './verifier-scorer.ts'
export type { VerifierRoute } from './verifier-scorer.ts'
