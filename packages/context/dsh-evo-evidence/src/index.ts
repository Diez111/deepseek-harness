/**
 * `@deepseek-ai/dsh-evo-evidence`: Evidence Vault for the DSH-EVO program.
 * External-to-context store of exact evidence (command outputs, errors,
 * diffs) with per-entry metadata and selective retrieval tools. Content is
 * capped at a UTF-8 byte budget. Each vault operation is appended as a
 * durable session event (log-only); the in-memory per-session vault is not
 * rehydrated from those events across processes, so evidence is best-effort
 * within a single run. A content hash is recorded per entry (reserved for
 * future invalidation; not yet used). Feature-flagged: enabled defaults to
 * false, so an unconfigured row equals the baseline exactly.
 * @module @deepseek-ai/dsh-evo-evidence
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Session } from '@deepseek-ai/dsh-session'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Log-only durable evidence-vault operation. @mode Log */
    'session/evidence-op': EvidenceOp
  }
}

export type EvidenceStatus = 'fresh' | 'stale'
export type EvidenceOp =
  | { op: 'store'; entry: EvidenceEntry }
  | { op: 'markStale'; files: readonly string[] }
export interface EvidenceEntry {
  id: string
  type: string
  source: string
  command?: string
  files: readonly string[]
  contentHash: string
  content: string
  createdAt: number
  status: EvidenceStatus
}
export interface EvidenceVaultState {
  entries: EvidenceEntry[]
  seq: number
}

/** Deterministic content hash (fnv1a-32 hex) used for bookkeeping. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}

/** Apply one durable evidence op to a store state (pure, fold-friendly). */
export function applyEvidenceOp(state: EvidenceVaultState, op: EvidenceOp): EvidenceVaultState {
  if (op.op === 'markStale') {
    const files = new Set(op.files)
    return { seq: state.seq + 1, entries: state.entries.map(e =>
      e.status !== 'fresh' || !e.files.some(f => files.has(f)) ? e : { ...e, status: 'stale' }) }
  }
  if (state.entries.some(e => e.id === op.entry.id)) return state
  return { seq: state.seq + 1, entries: [...state.entries, op.entry] }
}

/** Truncate `text` to at most `maxBytes` UTF-8 bytes without splitting a code point. */
function truncateUtf8Bytes(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, 'utf8')
  if (buf.length <= maxBytes) return text
  let end = maxBytes
  // Step back while the byte at `end` is a UTF-8 continuation byte (0b10xxxxxx).
  // `?? 0` is safe: the loop only runs while `end > 0` and the buffer is longer
  // than `maxBytes`, so at most the final byte may be absent under strict indexing.
  while (end > 0 && ((buf[end] ?? 0) & 0xc0) === 0x80) end -= 1
  return buf.subarray(0, end).toString('utf8')
}

/** Build a new entry enforcing the content byte cap. */
export function makeEntry(
  state: EvidenceVaultState,
  input: { type: string; source: string; command?: string; files?: readonly string[]; content: string },
  maxBytes: number,
): EvidenceEntry {
  const content = truncateUtf8Bytes(input.content, maxBytes)
  return {
    id: 'E' + String(state.seq), type: input.type, source: input.source,
    ...input.command !== undefined ? { command: input.command } : {},
    files: input.files ?? [],
    contentHash: fnv1a(content), content,
    createdAt: Date.now(), status: 'fresh',
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-evo-evidence'

/** Services this plugin registers into. */
export const inject = ['tools'] as const

export interface Config {
  enabled?: boolean
  maxEntries?: number
  maxBytes?: number
  editToolNames?: string[]
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(false),
  maxEntries: z.number().step(1).min(1).default(200),
  maxBytes: z.number().step(1).min(1).default(8192),
  editToolNames: z.array(z.string()).default(['str-replace-editor', 'edit', 'apply-edit', 'patch']),
})

export function apply(ctx: Context, config: Config): void {
  if (config.enabled !== true) return
  const maxEntries = config.maxEntries ?? 200
  const maxBytes = config.maxBytes ?? 8192
  const states = new WeakMap<object, EvidenceVaultState>()
  const stateFor = (session: Session): EvidenceVaultState => {
    let s = states.get(session)
    if (s === undefined) { s = { entries: [], seq: 0 }; states.set(session, s) }
    return s
  }
  const edits = config.editToolNames ?? ['str-replace-editor', 'edit', 'apply-edit', 'patch']

  ctx.tools.register(defineTool({
    name: 'evidence_store',
    description: 'Store exact evidence outside the main context. Returns an id (E###) you can retrieve later with evidence_get. Prefer saving command outputs, compiler errors, diffs and test results verbatim.',
    parameters: {
      type: { type: 'string', required: true, description: 'evidence type' },
      source: { type: 'string', required: true, description: 'where it came from' },
      command: { type: 'string', description: 'the exact command or query' },
      files: { type: 'array', items: { type: 'string' }, description: 'dependent files (relative paths)' },
      content: { type: 'string', required: true, description: 'exact content' },
    },
    output: { schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true } } }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
    async execute(args, exec) {
      await Promise.resolve()
      if (!exec.agent) throw new Error('evidence_store requires an owning agent session')
      const state = stateFor(exec.agent.session)
      if (state.entries.length >= maxEntries) throw new Error('evidence vault is full at the configured maxEntries')
      const entry = makeEntry(state, {
        type: args.type, source: args.source,
        ...args.command !== undefined ? { command: args.command } : {},
        ...args.files !== undefined ? { files: args.files } : {},
        content: args.content,
      }, maxBytes)
      const next = applyEvidenceOp(state, { op: 'store', entry })
      states.set(exec.agent.session, next)
      exec.agent.session.append('session/evidence-op', { op: 'store', entry })
      return { id: entry.id }
    },
    presentCall: () => ({ card: 'generic', title: 'Store evidence', kind: 'other' }),
  }))

  ctx.tools.register(defineTool({
    name: 'evidence_get',
    description: 'Retrieve the exact content of a stored evidence entry by id (E###).',
    parameters: { id: { type: 'string', required: true, description: 'evidence id' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: {
      found: { type: 'boolean', required: true }, id: { type: 'string' }, type: { type: 'string' },
      source: { type: 'string' }, status: { type: 'string' }, content: { type: 'string' } } }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
    async execute(args, exec) {
      await Promise.resolve()
      if (!exec.agent) throw new Error('evidence_get requires an owning agent session')
      const e = stateFor(exec.agent.session).entries.find(x => x.id === args.id)
      return e === undefined ? { found: false }
        : { found: true, id: e.id, type: e.type, source: e.source, status: e.status, content: e.content }
    },
    presentCall: () => ({ card: 'generic', title: 'Retrieve evidence', kind: 'other' }),
  }))

  ctx.tools.register(defineTool({
    name: 'evidence_list',
    description: 'List stored evidence compactly (id, type, status, source, size) without content.',
    parameters: { status: { type: 'string', description: 'filter: fresh | stale' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: {
      total: { type: 'number' }, items: { type: 'array', items: { type: 'string' } } } }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
    async execute(args, exec) {
      await Promise.resolve()
      if (!exec.agent) throw new Error('evidence_list requires an owning agent session')
      const items = stateFor(exec.agent.session).entries.filter(e => args.status === undefined || e.status === args.status)
        .map(e => e.id + ':' + e.type + ':' + e.status + ':' + e.source + ':' + String(e.content.length))
      return { total: items.length, items }
    },
    presentCall: () => ({ card: 'generic', title: 'List evidence', kind: 'other' }),
  }))

  ctx.on('session/event', (session, event) => {
    const d = (event as { type?: string; data?: { name?: string; arguments?: unknown } }).data
    if ((event as { type?: string }).type !== 'tool/call') return
    if (d === undefined || !edits.includes(d.name ?? '')) return
    let files: string[] = []
    try {
      const parsed: unknown = typeof d.arguments === 'string' ? JSON.parse(d.arguments) : (d.arguments ?? {})
      const rec = parsed as Record<string, unknown>
      const f = (typeof rec.file === 'string') ? rec.file : (typeof rec.path === 'string') ? rec.path : (typeof rec.oldPath === 'string') ? rec.oldPath : undefined
      if (typeof f === 'string') files = [f]
    } catch { files = [] }
    if (files.length === 0) return
    const next = applyEvidenceOp(stateFor(session), { op: 'markStale', files })
    states.set(session, next)
    session.append('session/evidence-op', { op: 'markStale', files })
  }, { global: true })
}
