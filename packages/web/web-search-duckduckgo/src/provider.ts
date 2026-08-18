/**
 * `DuckDuckGoSearchProvider`: a keyless `WebSearchProvider` backed by DuckDuckGo.
 *
 * Two backends (see README for the honest limits):
 * - `instant` — the official Instant-Answer JSON API. Stable and keyless but
 *   returns only instant answers / encyclopedic topics; many web queries come
 *   back empty.
 * - `html` — the unofficial `html.duckduckgo.com/html` result page. Returns
 *   real web results without a key but is rate-limited, anti-bot (some IPs get
 *   a 2xx challenge page) and may change. Opt-in.
 *
 * `auto` (default) tries `instant` first and falls back to `html` when it
 * yields no sources. No credentials are ever attached, so the credential
 * redirect rule does not apply; the request URL is always `baseURL`.
 * @module @deepseek-ai/dsh-web-search-duckduckgo/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'
import type { DdgInstantResponse, DdgRelatedTopic } from './types.ts'

/** Stable id this provider registers under. */
export const DUCKDUCKGO_PROVIDER_ID = 'duckduckgo'

/** Official Instant-Answer JSON endpoint (keyless). */
export const DUCKDUCKGO_INSTANT_BASE_URL = 'https://api.duckduckgo.com'

/** Unofficial HTML results endpoint (real web results, fragile). */
export const DUCKDUCKGO_HTML_BASE_URL = 'https://html.duckduckgo.com'

/** Detection mode: stable instant-answer first, html web results opt-in. */
export type DuckDuckGoMode = 'instant' | 'html' | 'auto'

/** Realistic UA that the unofficial HTML backend tolerates. */
export const DUCKDUCKGO_DEFAULT_UA =
  'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0 deepseek-harness/0.1.0'

/** Cap on bytes read from the HTML results page. */
export const DUCKDUCKGO_MAX_HTML_BYTES = 256 * 1024

/** Resolved provider options (the plugin's `apply` supplies the defaults). */
export interface DuckDuckGoSearchProviderOptions {
  /** instant | html | auto. */
  mode: DuckDuckGoMode
  /** User agent for the HTML backend. */
  ua: string
  /** Instant-Answer endpoint. */
  instantBaseURL: string
  /** HTML results endpoint. */
  htmlBaseURL: string
  /** Default result count when a request carries no `maxResults`. */
  defaultMaxResults: number
  /** Cap on the HTML body read. */
  maxHtmlBytes: number
}

/** Whether a value is usable as an HTTP endpoint URL (non-empty trimmed). */
function validateBaseURL(value: string, name: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`duckduckgo: ${name} must be a non-empty string`)
  }
}

/**
 * Map one Instant-Answer related topic (or result) into a source. Topics carry
 * `FirstURL` and `Text`; entries without a usable URL are dropped.
 * @param topic - raw topic/result entry.
 * @returns the normalized source, or `undefined` when it has no FirstURL.
 */
export function mapDdgTopic(topic: DdgRelatedTopic): WebSearchSource | undefined {
  const url = typeof topic.FirstURL === 'string' ? topic.FirstURL.trim() : ''
  if (url.length === 0 || url === 'None') return undefined
  const text = typeof topic.Text === 'string' ? topic.Text : ''
  const snippet = text.replace(/\.{3}\s*$/, '').replace(/\u2026\s*$/, '').trim()
  const name = typeof topic.name === 'string' ? topic.name.trim() : ''
  return {
    url,
    ...snippet.length > 0 ? { snippet } : {},
    ...name.length > 0 ? { title: name } : {},
  }
}

/**
 * Map the official Instant-Answer response envelope into a normalized result.
 * Sources are the abstract entry (when given) plus every related topic/result,
 * deduplicated by URL. `content` is the abstract text when present.
 * @param response - parsed Instant-Answer JSON.
 * @returns the normalized result (may be empty — Instant Answers are narrow).
 */
export function mapDdgInstantResponse(response: DdgInstantResponse): WebSearchResult {
  const sources: WebSearchSource[] = []
  const seen = new Set<string>()
  const abstractUrl = typeof response.AbstractURL === 'string' ? response.AbstractURL.trim() : ''
  const abstractText = typeof response.AbstractText === 'string' ? response.AbstractText.trim() : ''
  const heading = typeof response.Heading === 'string' ? response.Heading.trim() : ''
  if (abstractUrl.length > 0 && abstractUrl !== 'None') {
    seen.add(abstractUrl)
    sources.push({
      url: abstractUrl,
      ...heading.length > 0 ? { title: heading } : {},
      ...abstractText.length > 0 ? { snippet: abstractText } : {},
    })
  }
  for (const entry of response.RelatedTopics ?? []) {
    // Topics can be nested Category objects ({ Name, Topics: [...] }).
    const maybeTopics: unknown = entry.Topics
    const items: DdgRelatedTopic[] = Array.isArray(maybeTopics)
      ? maybeTopics as DdgRelatedTopic[]
      : [entry]
    for (const topic of items) {
      const source = mapDdgTopic(topic)
      if (source === undefined || seen.has(source.url)) continue
      seen.add(source.url)
      sources.push(source)
    }
  }
  return {
    ...abstractText.length > 0 ? { content: abstractText } : {},
    sources,
    truncated: false,
  }
}

/**
 * Parse the unofficial HTML results page into sources. Tolerant regex over the
 * `result__a` (title+URL) and `result__snippet` markers; entries without a
 * URL are dropped and results are deduplicated by URL.
 * @param html - raw body (already capped).
 * @returns the extracted sources.
 */
export function extractDdgHtmlSources(html: string): WebSearchSource[] {
  const sources: WebSearchSource[] = []
  const seen = new Set<string>()
  const titleRe = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  const snippetRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
  const snippets: string[] = []
  for (const m of html.matchAll(snippetRe)) snippets.push(stripTags(m[1] ?? '').trim())
  let titleMatch: RegExpExecArray | null
  let index = 0
  while ((titleMatch = titleRe.exec(html)) !== null && sources.length < 100) {
    const href = decodeDdgUrl(titleMatch[1] ?? '')
    if (href.length === 0 || seen.has(href)) { continue }
    seen.add(href)
    sources.push({
      url: href,
      ...(stripTags(titleMatch[2] ?? '').trim().length > 0
        ? { title: stripTags(titleMatch[2] ?? '').trim() }
        : {}),
      ...index < snippets.length && (snippets[index] ?? '').length > 0 ? { snippet: snippets[index] } : {},
    })
    index += 1
  }
  return sources
}

/** Decode an anchor URL, unwrapping DuckDuckGo's `uddg=` redirect parameter and HTML entities. */
function decodeDdgUrl(href: string): string {
  const cleaned = href
    .replace(/^\/\/duckduckgo\.com\/l\//, 'https://duckduckgo.com/l/')
    .replace(/&amp;/g, '&')
  const m = /[?&]uddg=([^&]+)/.exec(cleaned)
  const raw = m?.[1] ?? ''
  if (m && raw.length > 0) {
    try { return decodeURIComponent(raw) } catch { return raw }
  }
  return cleaned
}

/** Strip HTML tags and entity artifacts from a snippet/title fragment. */
function stripTags(text: string): string {
  return text.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Cap sources locally (cost/latency optimization; the seam enforces the bound regardless). */
function cap(result: WebSearchResult, maxResults: number): WebSearchResult {
  if (result.sources.length <= maxResults) return result
  return { ...result, sources: result.sources.slice(0, maxResults), truncated: true }
}

/** Build the Instant-Answer request URL. */
function instantUrl(base: string, query: string): string {
  const url = new URL('/', base)
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'json')
  url.searchParams.set('no_html', '1')
  url.searchParams.set('skip_disambig', '1')
  return url.toString()
}

/** Build the HTML results request URL. */
function htmlUrl(base: string, query: string): string {
  const url = new URL('/html/', base)
  url.searchParams.set('q', query)
  return url.toString()
}

/**
 * `DuckDuckGoSearchProvider`: a `WebSearchProvider` backed by DuckDuckGo.
 * Keyless — `available()` is therefore always true and no credential is ever
 * attached to a request.
 */
export class DuckDuckGoSearchProvider implements WebSearchProvider {
  readonly id = DUCKDUCKGO_PROVIDER_ID

  private readonly options: DuckDuckGoSearchProviderOptions

  constructor(options: Partial<DuckDuckGoSearchProviderOptions>) {
    this.options = {
      mode: options.mode ?? 'auto',
      ua: options.ua ?? DUCKDUCKGO_DEFAULT_UA,
      instantBaseURL: options.instantBaseURL ?? DUCKDUCKGO_INSTANT_BASE_URL,
      htmlBaseURL: options.htmlBaseURL ?? DUCKDUCKGO_HTML_BASE_URL,
      defaultMaxResults: options.defaultMaxResults ?? 8,
      maxHtmlBytes: options.maxHtmlBytes ?? DUCKDUCKGO_MAX_HTML_BYTES,
    }
    validateBaseURL(this.options.instantBaseURL, 'instantBaseURL')
    validateBaseURL(this.options.htmlBaseURL, 'htmlBaseURL')
    if (!Number.isSafeInteger(this.options.defaultMaxResults) || this.options.defaultMaxResults < 1) {
      throw new TypeError('duckduckgo: defaultMaxResults must be a positive safe integer')
    }
  }

  /** Keyless: always usable when composed. */
  available(): boolean {
    return true
  }

  /** Run one search through the configured backend(s), honoring the signal. */
  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const maxResults = request.maxResults ?? this.options.defaultMaxResults
    const tryInstant = this.options.mode === 'instant' || this.options.mode === 'auto'
    const tryHtml = this.options.mode === 'html' || this.options.mode === 'auto'
    if (tryInstant) {
      const result = await this.instant(request.query, signal)
      if (result.sources.length > 0) return cap(result, maxResults)
    }
    if (tryHtml) {
      const result = await this.htmlResults(request.query, signal)
      if (result.sources.length > 0) return cap(result, maxResults)
    }
    return { sources: [], truncated: false }
  }

  /** Official Instant-Answer JSON path. */
  private async instant(query: string, signal?: AbortSignal): Promise<WebSearchResult> {
    let response: Response
    try {
      response = await fetch(instantUrl(this.options.instantBaseURL, query), signalInit(signal))
    } catch (error) {
      throw new WebError(`duckduckgo instant search failed: ${fault(error)}`, 'WEB_PROVIDER_ERROR')
    }
    if (!response.ok) {
      throw new WebError(`duckduckgo instant search failed (HTTP ${response.status})`, 'WEB_PROVIDER_ERROR')
    }
    let json: unknown
    try {
      json = await response.json()
      if (json === null || typeof json !== 'object') throw new Error('expected an object body')
    } catch (error) {
      throw new WebError(`duckduckgo instant search returned invalid JSON: ${fault(error)}`, 'WEB_PROVIDER_ERROR')
    }
    return mapDdgInstantResponse(json)

  }

  /** Unofficial HTML results path (opt-in; may be rate-limited or challenged). */
  private async htmlResults(query: string, signal?: AbortSignal): Promise<WebSearchResult> {
    let response: Response
    try {
      response = await fetch(htmlUrl(this.options.htmlBaseURL, query), {
        ...signalInit(signal),
        headers: { 'user-agent': this.options.ua, accept: 'text/html' },
      })
    } catch (error) {
      throw new WebError(`duckduckgo html search failed: ${fault(error)}`, 'WEB_PROVIDER_ERROR')
    }
    if (!response.ok) {
      throw new WebError(`duckduckgo html search failed (HTTP ${response.status})`, 'WEB_PROVIDER_ERROR')
    }
    let body: string
    try {
      body = await readCappedBody(response, this.options.maxHtmlBytes)
    } catch (error) {
      throw new WebError(`duckduckgo html search read failed: ${fault(error)}`, 'WEB_PROVIDER_ERROR')
    }
    return { sources: extractDdgHtmlSources(body), truncated: false }
  }
}

/** RequestInit signal wiring that is valid under exactOptionalPropertyTypes. */
function signalInit(signal: AbortSignal | undefined): { signal: AbortSignal } | Record<string, never> {
  return signal !== undefined ? { signal } : {}
}

/**
 * Read at most `maxBytes` bytes of a response body, canceling the upstream
 * read once the cap is reached (a runaway body is never buffered whole).
 * @param response - the fetched response.
 * @param maxBytes - hard cap on bytes read, per the provider's HTML bound.
 * @returns the decoded prefix as a UTF-8 string (a trailing cut code point
 *   decodes to a replacement character, never to an unbounded read).
 */
async function readCappedBody(response: Response, maxBytes: number): Promise<string> {
  const stream = response.body
  if (stream === null) {
    const buffer = await response.arrayBuffer()
    return new TextDecoder('utf-8').decode(buffer.slice(0, maxBytes))
  }
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (received >= maxBytes) {
        void reader.cancel().catch(() => {})
        break
      }
      const take = value.subarray(0, maxBytes - received)
      chunks.push(take)
      received += take.length
    }
  } finally {
    reader.releaseLock()
  }
  const merged = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length }
  return new TextDecoder('utf-8').decode(merged)
}

/** Compact human reason from an arbitrary failure. */
function fault(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
