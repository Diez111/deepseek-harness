# @deepseek-ai/dsh-web-search-duckduckgo

[English](README.md) | 中文

面向 DeepSeek Harness 网页能力 seam（`ctx.web`）的无密钥搜索 provider，使 `web_search` 在没有任何 DeepSeek/Exa/Perplexity API key 时也能工作。请求永不附带任何凭据。

## 诚实的限制
DuckDuckGo **没有官方“免费且不限量”的网页搜索 API**。本包提供两个后端，权衡差别巨大——若只推荐其一会误导：

- **`instant`（默认）**——官方 Instant-Answer JSON API。免费、无密钥、稳定。**覆盖窄**：只回答即时答案/百科类查询（维基主题、定义）；许多一般网页查询会返回零结果。
- **`html`（可选）**——非官方 `html.duckduckgo.com/html` 结果页。无密钥也能返回真实网页结果，但**有限流、反爬（部分网络/IP 会收到带挑战页的 2xx，从数据中心 IP 探测常见 HTTP 202）、且 HTML 结构可能变动**。用 `mode: html` 启用；不要在生产中依赖它。
- **`auto`（默认）**——先试 `instant`，无结果时回退到 `html`。

需要全覆盖的 agentic 网页搜索时，应改用带密钥的 provider（Exa、Perplexity 等付费 API）；本包是无密钥默认，让未配置任何密钥时 `web_search` 仍可用。

## 配置
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

当 seam 未配置 `searchProvider` 时，会使用唯一已注册且可用的 provider。内置的 DeepSeek 搜索 provider 在没有其密钥时不可用，因此注册本无密钥 provider 后，`web_search` 会自动路由到它。

## 模型体验

### 工具行为

`web_search` 保持现有 schema（query、可选 maxResults）与提示文案；本包只提供后端。结果归一为 seam 的 `{ content?, sources[], truncated }`：`content` 在有即时答案抽象时给出；source 携带 URL/标题/snippet/publishedAt（按 seam 契约均为可选——绝不虚构字段）。

#### Token 影响

未注册时零 token。每次搜索结果的 token 成本取决于模型读取的 sources；`maxResults` 限定数量并由 seam 截断。

#### KV 缓存影响

搜索结果作为 tool result 追加在可复用前缀之后，不会使早期 KV-cache 条目失效。

## 已知限制与后续工作

- **`instant` 模式覆盖窄**，HTML 回退为非官方且脆弱——见“诚实的限制”。不宣称“免费且不限量的网页搜索”。
- **Instant-Answer 无结果数 API**：`maxResults` 由本地与 seam 限定，而非 provider 网络请求（`defaultMaxResults` 为同一上限）。
- **HTML 解析基于正则且有界**（`maxHtmlBytes`）；解析到前 100 个结果并按 URL 去重。畸形页面按其实际产出返回，绝不报错。
- **无密钥故不受凭据重定向规则约束**；HTML 后端会跟随重定向，安全因从不附加任何 authorization 头。
- **无分页**：仅解析第一页结果。
