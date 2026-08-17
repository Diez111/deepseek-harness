/**
 * Model-facing remediation for guarded-mutation failures. The provider's
 * `FS_STALE_VERSION` and `FS_NOT_OBSERVED` messages state the condition but
 * not the only correct recovery (re-read / read the file), so this package
 * appends the remedy at the model boundary; provider messages stay
 * machine-oriented and unchanged.
 * @module @deepseek-ai/dsh-tool-fs/src/error
 */

import { FsError } from '@deepseek-ai/dsh-fs'
import type { FsErrorCode } from '@deepseek-ai/dsh-fs'

/** The remedy appended to each remediable failure code's message. */
const REMEDIES: Partial<Record<FsErrorCode, string>> = {
  FS_STALE_VERSION: 're-read the file, then retry',
  FS_NOT_OBSERVED: 'read the file, then retry',
}

/**
 * Append the correct recovery instruction to a guarded-mutation failure's
 * message. `FS_STALE_VERSION` (the file changed since this session's last
 * observation, including a missing target) recovers only by re-reading;
 * `FS_NOT_OBSERVED` (no prior read by this session) by reading. The `FsError`
 * code is preserved so retry/permission/UI layers keep routing on it, and the
 * original error chains as `cause`. Anything else passes through untouched.
 * @param error - the caught value from a write/edit execution.
 * @returns a remediated `FsError` for the two guarded-mutation codes, else the original value.
 */
/**
 * Append a bounded preview of the current file content to an
 * `FS_EDIT_NOT_FOUND` failure observed AFTER a fresh read. A stale or
 * hallucinated `old_string` otherwise loops: the model re-guesses the same
 * string without seeing what the file actually contains. Bounded to 160
 * chars and never changes the error code, so routing/retry layers keep
 * working.
 * @param error - the caught edit failure (a remediable FsError or not).
 * @param freshText - current file content read just before the failed retry,
 *   or undefined when no fresh read happened.
 * @returns an enriched `FS_EDIT_NOT_FOUND` FsError, else the original value.
 */
export function enrichEditNotFound(error: unknown, freshText: string | undefined): unknown {
  if (error instanceof FsError && error.code === 'FS_EDIT_NOT_FOUND' && freshText !== undefined) {
    const preview = (freshText.trimStart().slice(0, 160) || ' (empty file)')
    return new FsError(
      `${error.message} — current content starts with: ${JSON.stringify(preview)}`,
      error.code,
      { cause: error },
    )
  }
  return error
}

export function remediateFsError(error: unknown): unknown {
  if (!(error instanceof FsError)) return error
  const remedy = REMEDIES[error.code]
  if (!remedy) return error
  return new FsError(`${error.message} — ${remedy}`, error.code, { cause: error })
}
