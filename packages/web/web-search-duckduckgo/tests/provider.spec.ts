import { afterEach, describe, expect, it, vi } from 'vitest'
import { DuckDuckGoSearchProvider, DUCKDUCKGO_PROVIDER_ID } from '@deepseek-ai/dsh-web-search-duckduckgo'
import { extractDdgHtmlSources, mapDdgInstantResponse, mapDdgTopic } from '../src/provider.ts'
import type { DdgInstantResponse } from '../src/types.ts'

const base = {
  mode: 'instant' as const,
  ua: 'test-ua',
  instantBaseURL: 'https://ia.test',
  htmlBaseURL: 'https://html.test',
  defaultMaxResults: 8,
  maxHtmlBytes: 1024,
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('mapDdgTopic', () => {
  it('maps a topic with url + text', () => {
    expect(mapDdgTopic({ FirstURL: 'https://a.test', Text: 'A description…' }))
      .toEqual({ url: 'https://a.test', snippet: 'A description' })
  })
  it('drops empty/None urls', () => {
    expect(mapDdgTopic({ Text: 'x' })).toBeUndefined()
    expect(mapDdgTopic({ FirstURL: 'None' })).toBeUndefined()
  })
})

describe('mapDdgInstantResponse', () => {
  const instant: DdgInstantResponse = {
    Heading: 'Python',
    AbstractText: 'Python is a language.',
    AbstractURL: 'https://en.wikipedia.org/wiki/Python',
    RelatedTopics: [
      { FirstURL: 'https://docs.python.org', Text: 'Docs…' },
      { name: 'Category', Topics: [{ FirstURL: 'https://b.test', Text: 'B…' }] },
      { FirstURL: 'https://docs.python.org', Text: 'dup' },
    ],
  }
  it('combines the abstract and deduplicated topics; nested categories flatten', () => {
    const result = mapDdgInstantResponse(instant)
    expect(result.content).toBe('Python is a language.')
    expect(result.sources.map(s => s.url)).toEqual([
      'https://en.wikipedia.org/wiki/Python',
      'https://docs.python.org',
      'https://b.test',
    ])
    expect(result.sources[0]).toMatchObject({ title: 'Python' })
  })
  it('returns empty sources for a bare response', () => {
    expect(mapDdgInstantResponse({}).sources).toEqual([])
  })
})

describe('extractDdgHtmlSources', () => {
  it('parses DuckDuckGo result anchors and snippets', () => {
    const html = `<div class="result">
      <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fhost.test%2Fp&rut=1">Host Page</a>
      <a class="result__snippet">A <b>bold</b> snippet&hellip;</a>
      <a class="result__a" href="https://example.test">Example</a>
    </div>`
    const sources = extractDdgHtmlSources(html)
    expect(sources[0]).toMatchObject({ url: 'https://host.test/p', title: 'Host Page' })
    expect(sources[0]?.snippet).toContain('bold')
    expect(sources[1]?.url).toBe('https://example.test')
  })
})

describe('DuckDuckGoSearchProvider availability + requests', () => {
  it('is always available (keyless)', () => {
    expect(new DuckDuckGoSearchProvider(base).available()).toBe(true)
  })

  it('auto mode tries instant first and returns its sources when non-empty', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      AbstractText: 'a', AbstractURL: 'https://a.test', Heading: 'A', RelatedTopics: [],
    }))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new DuckDuckGoSearchProvider({ ...base, mode: 'auto' })
    const result = await provider.search({ query: 'hello', maxResults: 5 })
    expect(result.sources).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url] = fetchMock.mock.calls[0] as unknown as [string]
    expect(url).toContain('q=hello')
  })

  it('auto mode falls back to html when instant returns nothing', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ RelatedTopics: [] }))
      .mockResolvedValueOnce(new Response(
        '<a class="result__a" href="https://x.test">X</a>',
        { status: 200, headers: { 'content-type': 'text/html' } },
      ))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new DuckDuckGoSearchProvider({ ...base, mode: 'auto' })
    const result = await provider.search({ query: 'q' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.sources[0]?.url).toBe('https://x.test')
  })

  it('forwards the abort signal', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ RelatedTopics: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    await new DuckDuckGoSearchProvider(base).search({ query: 'q' }, controller.signal)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.signal).toBe(controller.signal)
  })

  it('maps an HTTP error to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'nope' }, { status: 503 })))
    await expect(new DuckDuckGoSearchProvider(base).search({ query: 'q' }))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
  })

  it('registers under the stable duckduckgo id', () => {
    expect(new DuckDuckGoSearchProvider(base).id).toBe(DUCKDUCKGO_PROVIDER_ID)
  })
})
