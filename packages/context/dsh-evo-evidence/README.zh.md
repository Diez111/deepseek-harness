# @deepseek-ai/dsh-evo-evidence

[English](README.md) | 中文

面向 DSH-EVO 的 Evidence Vault：上下文外部的精确证据存储（命令输出、编译错误、测试结果、diff、决策），带逐条目元数据、文件哈希失效与选择检索。条目以持久的 `session/evidence-op` 事件持久化（从会话日志重建——不引入第二套存储）。

## 配置
```yaml
- insert:
    - id: dsh-evo-evidence
      name: '@deepseek-ai/dsh-evo-evidence'
      config:
        enabled: true   # false (default) restores baseline exactly
        maxEntries: 200
        maxBytes: 8192
        editToolNames: ['str-replace-editor', 'edit', 'apply-edit', 'patch']
```

## 工具
- `evidence_store`（type, source, command?, files?, content）-> id E###；content 受 maxBytes 截断。
- `evidence_get`（id）-> 精确内容 + 状态。
- `evidence_list`（status?）-> 紧凑 id 列表（无内容），以保持上下文精简。
自动失效：文件编辑工具调用会把依赖被编辑文件的 fresh 条目标记为 `stale`。

## 模型体验
无提示词改动；启用后新增三个可选工具与每条目一条持久事件。默认 `enabled: false`，未在任何 profile 中挂载，直到在 dev benchmark 上验证通过（feature-flag off = baseline）。

#### Token / KV 缓存影响
未启用时为零；启用后仅计模型读取返回证据的 token。

## 已知限制与后续工作
- 会话内存 + 日志重放；无独立数据库（有意复用会话持久化）。
- 失效键取自文件编辑参数（`file`/`path`/`oldPath`）；多文件编辑只取首个文件。
- 尚未基准验证：验证方式是 dev/validation 对比，而非单元测试。
