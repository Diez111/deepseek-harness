/**
 * Failure-aware attempt memory: canonicalizes a tool call, remembers calls
 * that failed, and lets the controller distinguish a retry of a previously
 * failed call (a strong loop signal) from a first attempt. Canonicalization is
 * a deep key-sort plus stringify, so argument objects differing only in
 * property order compare equal. The memory is in-memory and per-agent,
 * mirroring the advisory repeat-tool guard: it is a nudge, not a logged
 * invariant. Failures that should survive compaction belong in the durable
 * \`failedApproaches\` ledger (\`persistFailedAttempts\` or model curation).
 * @module @deepseek-ai/dsh-jspace/attempts
 */

/** One remembered failed call. */
export interface FailedCall {
  /** Tool name of the failed call. */
  readonly tool: string
  /** Canonical (sorted) argument string — the equality key. */
  readonly key: string
  /** Bounded preview of the canonical arguments for advisory text. */
  readonly argsPreview: string
  /** Bounded diagnostic from the failed result. */
  readonly reason: string
  /** Epoch milliseconds when the failure was recorded. */
  readonly at: number
}

/**
 * Deep key-sort of a parsed-JSON value so property order cannot change identity.
 * @param value - lossless JSON value to sort.
 * @returns the same value with object keys sorted recursively.
 */
export function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) sorted[key] = sortJsonValue(record[key])
    return sorted
  }
  return value
}

/**
 * Canonical string form of one call's arguments: deep key-sort, then stringify.
 * @param value - call arguments (lossless JSON).
 * @returns the canonical identity string.
 */
export function canonicalizeArguments(value: unknown): string {
  try {
    return JSON.stringify(sortJsonValue(value))
  } catch {
    // The loop passes lossless JSON; hostile non-serializable values fall back
    // to a stable string so detection still functions.
    return '<non-serializable arguments>'
  }
}

/**
 * Head-truncate text for model-visible previews, marking how much was omitted.
 * @param value - text to truncate.
 * @param cap - maximum characters kept before the omission marker.
 * @returns the truncated preview with an omission marker when the input exceeds the cap.
 */
export function preview(value: string, cap: number): string {
  if (value.length <= cap) return value
  return `${value.slice(0, cap)}… (+${value.length - cap} more chars)`
}

/**
 * Compile one `*`-wildcard pattern to an anchored RegExp (other metacharacters match literally).
 * @param pattern - the `*`-wildcard pattern.
 * @returns an anchored RegExp matching exactly the pattern's language.
 */
export function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, String.raw`\$&`)
  return new RegExp(`^${escaped.replaceAll('*', '.*')}$`)
}

/** Bounded, per-agent failure memory keyed by canonical call identity. */
export class AttemptMemory {
  private readonly records = new Map<string, FailedCall>()

  private key(tool: string, args: unknown): string {
    return JSON.stringify([tool, canonicalizeArguments(args)])
  }

  /** Drop every remembered failure. */
  clear(): void {
    this.records.clear()
  }

  /**
   * Forget an earlier failure of the same canonical call (new evidence: the
   * call later succeeded).
   * @param tool - tool name.
   * @param args - call arguments (lossless JSON).
   */
  forget(tool: string, args: unknown): void {
    this.records.delete(this.key(tool, args))
  }

  /**
   * Look up a prior failure for the same canonical call.
   * @param tool - tool name.
   * @param args - call arguments (lossless JSON).
   * @returns the remembered failure, or \`undefined\` for a first attempt.
   */
  priorFailure(tool: string, args: unknown): FailedCall | undefined {
    return this.records.get(this.key(tool, args))
  }

  /**
   * Remember one failed call, replacing any earlier record for the same call.
   * @param tool - tool name.
   * @param args - call arguments (lossless JSON).
   * @param reason - bounded diagnostic captured from the failed result.
   * @param previewChars - cap on the stored argument preview.
   * @returns the stored record.
   */
  markFailed(tool: string, args: unknown, reason: string, previewChars: number): FailedCall {
    const canonical = canonicalizeArguments(args)
    const record: FailedCall = {
      tool,
      key: canonical,
      argsPreview: preview(canonical, previewChars),
      reason: preview(reason, previewChars),
      at: Date.now(),
    }
    this.records.set(this.key(tool, args), record)
    return record
  }

  /**
   * Whether any failure is remembered for this agent.
   * @returns true when at least one failure is recorded.
   */
  hasFailures(): boolean {
    return this.records.size > 0
  }
}

/** Compile \`include\`/\`exclude\` patterns once for attempt tracking. */
export interface AttemptFilter {
  readonly include: readonly RegExp[]
  readonly exclude: readonly RegExp[]
}

/**
 * Build a filter from configured patterns.
 * @param include - tool-name patterns that participate (empty means all).
 * @param exclude - tool-name patterns that are transparent to tracking.
 * @returns the compiled filter.
 */
export function compileAttemptFilter(include: readonly string[], exclude: readonly string[]): AttemptFilter {
  return {
    include: include.map(wildcardToRegExp),
    exclude: exclude.map(wildcardToRegExp),
  }
}

/**
 * Whether a tool participates in attempt tracking. An empty inclusion list
 * means every tool is tracked; an excluded tool is transparent.
 * @param tool - tool name at call time.
 * @param filter - compiled patterns.
 * @returns whether the call participates.
 */
export function trackedTool(tool: string, filter: AttemptFilter): boolean {
  if (filter.include.length > 0 && !filter.include.some(pattern => pattern.test(tool))) return false
  return !filter.exclude.some(pattern => pattern.test(tool))
}
