# @deepseek-ai/dsh-protocol-trace

[English](README.md) | 中文

按请求的协议追踪（可观测性）。一个函数型插件监听持久的 `session/event` 流，并为每个模型请求追加一条 `session/protocol-trace` 事件：将 `request/header` 的路由快照（`provider`、`model`、`reasoningEffort`、`maxTokens`、`temperature`）与组装好的 `assistant/message`（reasoning 存在性、tool-call 数、usage、前缀缓存字段）合并。纯观测：不改行为、不产生模型可见输入、只写会话日志。

这是 DSH-EVO baseline 的 Native Contract Guard 种子：让契约事实（路由是否被信守、reasoning 是否保留、缓存字段有无、token 用量）按请求可见且可由日志重建。

## 配置
```yaml
- insert:
    - id: protocol-trace
      name: '@deepseek-ai/dsh-protocol-trace'
      config:
        enabled: true   # false restores baseline exactly
```

## 模型体验

### 工具行为

无工具、无提示、无模型可见输入。每条 assistant 消息多一条持久会话事件（约 100-200 字节），不消耗推理 token；唯一成本是极小的日志写入。

#### Token 影响

零新增 prompt/completion token；数据仅存储，绝不发送给模型。

#### KV 缓存影响

无。不改变也不重排任何请求前缀。

## 已知限制与后续工作

- **仅覆盖 harness 层**：track 记录的是 harness 自身组装的事实（路由、usage、reasoning 存在性）。网关静默丢弃的字段（top_logprobs 分布、cache tokens）在此不可观测；由一次性 wire audit 捕获（scripts/benchmarks/dsh-evo/BASELINE.md）。
- **监听 wiring 是标准 `ctx.on('session/event', ..., { global: true })`**：逻辑经导出的 `onSessionEvent` 单测；thin wiring 与会话投影注册表同模式。
- **尚无按评估聚合**：只发射原始事实；聚合与 router 校准推迟到 router 阶段。
