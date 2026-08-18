# @deepseek-ai/dsh-web-search-duckduckgo

English | [中文](README.zh.md)

A keyless search provider for the DeepSeek Harness web capability seam (`ctx.web`), so `web_search` works without a DeepSeek/Exa/Perplexity API key. No credentials are ever attached to a request.

## Honest limits
DuckDuckGo has **no official free-and-unlimited web search API**. This provider ships two backends with very different trade-offs, and recommending one over the other would be misleading:

- **`instant` (default)** — the official Instant-Answer JSON API. Free, keyless, stable. **Narrow coverage**: it answers encyclopedic/instant-answer queries (Wikipedia topics, definitions); many general web queries return zero sources.
- **`html` (opt-in)** — the unofficial `html.duckduckgo.com/html` result page. Returns real web results without a key, but is **rate-limited, anti-bot (some networks/IPs receive a 2xx challenge page with no results — probe from a datacenter IP commonly returns HTTP 202), and its HTML structure can change**. Opt in with `mode: html`; do not rely on it in production.
- **`auto` (default)** — tries `instant` first and falls back to `html` when it yields nothing.

For full-coverage agentic web search you should configure a keyed provider (Exa, Perplexity, or any paid API) instead; this package is the zero-key default that keeps `web_search` usable when none is configured.

## Config
```yaml
- insert:
    - id: web-search-duckduckgo
      name: '@deepseek-ai/dsh-web-search-duckduckgo'
      config:
        mode: auto        # instant | html | auto
        ua: 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0'
        instantBaseURL: 'https://api.duckduckgo.com'
        htmlBaseURL: 'https://html.duckduckgo.com'
        defaultMaxResults: 8
        maxHtmlBytes: 262144
```

When the seam has no configured `searchProvider`, it uses the sole available registered provider. The shipped DeepSeek search provider is unavailable without its key, so registering this keyless provider makes `web_search` route to it automatically.

## Model Experience

### Tool behavior

`web_search` keeps its existing schema (query, optional maxResults) and prompt guidance; this package only supplies the backend. Results are normalized into the seam's `{ content?, sources[], truncated }` shape: `content` is the Instant-Answer abstract when present; sources carry URL/title/snippet/publishedAt (optional per the seam contract — nothing is invented).

#### Token effect

Zero tokens when unregistered. Each search result the model retains costs as many tokens as the sources it reads; `maxResults` bounds sources and the seam truncates.

#### KV Cache effect

Search results are tool results appended after the reusable request prefix; they do not invalidate earlier KV-cache entries.

## Known Limitations and Deferred Work

- **Coverage is narrow in `instant` mode** and the HTML fallback is unofficial and fragile — see the Honest limits section. No claim of "free and unlimited web search" is made.
- **No result-count API on Instant-Answer**: `maxResults` is enforced locally and by the seam, not by the provider network call (`defaultMaxResults` is the same bound).
- **HTML parsing is regex-based and bounded** (`maxHtmlBytes`); it stops at the first 100 results and deduplicates by URL. Malformed pages return as many sources as they yield, never an error.
- **Keyless thus exempt from the credential redirect rule**; the HTML backend follows redirects, which is safe because no authorization header is ever attached.
- **No pagination**: only the first result page is parsed.
