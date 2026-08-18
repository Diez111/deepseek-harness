/**
 * `@deepseek-ai/dsh-web-search-duckduckgo`: registers a keyless
 * DuckDuckGo-backed `WebSearchProvider` with `ctx.web`. A function/namespace
 * plugin (NOT a default-export service): a search provider registers INTO the
 * seam's provider registry, exactly as `@deepseek-ai/dsh-web-search-exa` does.
 * Keyless by design — `available()` is always true and no credential is sent.
 * @module @deepseek-ai/dsh-web-search-duckduckgo
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import { DuckDuckGoSearchProvider } from './provider.ts'
import type { DuckDuckGoMode } from './provider.ts'

export {
  DUCKDUCKGO_DEFAULT_UA,
  DUCKDUCKGO_HTML_BASE_URL,
  DUCKDUCKGO_INSTANT_BASE_URL,
  DUCKDUCKGO_MAX_HTML_BYTES,
  DUCKDUCKGO_PROVIDER_ID,
  DuckDuckGoSearchProvider,
} from './provider.ts'
export type { DuckDuckGoMode, DuckDuckGoSearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-duckduckgo'

/** The web seam this provider registers into. */
export const inject = ['web'] as const

/** Plugin config (all optional — this provider needs no API key). */
export interface Config {
  /** instant | html | auto. Defaults to auto (instant first, html fallback). */
  mode?: DuckDuckGoMode
  /** User agent for the unofficial HTML backend. */
  ua?: string
  /** Instant-Answer endpoint (usually left at the official default). */
  instantBaseURL?: string
  /** HTML results endpoint (leave at the default unless testing). */
  htmlBaseURL?: string
  /** Default result count when a request carries no maxResults. */
  defaultMaxResults?: number
  /** Cap on the HTML body bytes read. */
  maxHtmlBytes?: number
}

/** Schemastery config for the keyless provider. */
export const Config: z<Config> = z.object({
  mode: z.union(['instant', 'html', 'auto'] as const),
  ua: z.string(),
  instantBaseURL: z.string(),
  htmlBaseURL: z.string(),
  defaultMaxResults: z.number().step(1).min(1),
  maxHtmlBytes: z.number().step(1).min(1),
})

/** Register the keyless DuckDuckGo search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  ctx.web.registerSearchProvider(new DuckDuckGoSearchProvider({
    ...config.mode !== undefined ? { mode: config.mode } : {},
    ...config.ua !== undefined ? { ua: config.ua } : {},
    ...config.instantBaseURL !== undefined ? { instantBaseURL: config.instantBaseURL } : {},
    ...config.htmlBaseURL !== undefined ? { htmlBaseURL: config.htmlBaseURL } : {},
    ...config.defaultMaxResults !== undefined ? { defaultMaxResults: config.defaultMaxResults } : {},
    ...config.maxHtmlBytes !== undefined ? { maxHtmlBytes: config.maxHtmlBytes } : {},
  }))
}
