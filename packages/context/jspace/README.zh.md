# @deepseek-ai/dsh-jspace

[English](README.md) | 中文

一个面向长程 agentic 任务的可选控制器，改编自 J-Space 能力报告中的思想（状态可跨上下文压缩存续、失败感知的重试、完成前验证、分级控制）。它是现有 Harness 之上的独立模块：当 `enabled: false` 时不注册任何东西，Harness 的行为与之前完全一致。它刻意与已有的 goal、todo、repeat-tool-reminder、compaction 和 plan-mode 包互补而非重复；凡已有机制的地方都复用而非重造。

## 启用后新增的能力

- **紧凑且持久的任务账本**（GOAL / CORE / VERIFIED / OPEN / NEXT 及有上限的失败尝试记录），以会话日志为事件源，并作为模型可见的动态运行上下文重新注入。loop 的 runtime-context 投影只在其变化或压实后重新落盘，因此它保持最新、可跨压实与续会存续，并且在首次写入前不消耗任何 token。
- **失败感知的重试守卫**：记住失败的工具调用，当同样的规范化调用被重试时注入提示——失败的策略不会被静默重复。与 `repeat-tool-reminder` 不同（后者不看结果计数相同调用，也不记录失败原因）。
- **完成闸门**（`jspace_finish`）：在每一个 OPEN 项被解决或显式记录、账本采取行动后存在已验证证据、且模型确认闭环清单（目标满足、约束被遵守、无被忽略的已知错误、无明显的回归）之前，拒绝完成声明。强制发生在做出决策的操作中，而非提示文字里。
- **分级控制（fast/full/loop/auto）**：部署可强制某一档位；在 `auto` 下由账本自行选择（无账本 → fast；存在目标或 OPEN → loop；其余 → full）。

## 配置

```yaml
- id: jspace
  name: '@deepseek-ai/dsh-jspace'
  config:
    enabled: true        # default false — the feature flag
    autoGuide: true      # short guidance so the model self-starts the ledger
    mode: auto           # auto | fast | full | loop
    maxItems: 12         # cap on core/verified/open lists
    maxItemChars: 200
    maxNextChars: 300
    maxFailedItems: 8
    maxReasonChars: 160
    maxStateBytes: 2400  # byte budget of the injected block
    requireVerification: true
    persistFailedAttempts: false  # append detected failures to the durable ledger
    attemptInclude: []            # tool-name patterns tracked by the guard
    attemptExclude: [todo_write, jspace_state, jspace_finish]
    attemptPreviewChars: 200
```

配置错误在加载时响亮失败（`maxItems` 超过硬上限、非正或非整数的预算等）。

## 工具

- **jspace_state** — 读取或更新账本。列表字段（`core`、`verified`、`open`、`failed_approaches`）是整体替换；标量字段（`goal`、`next`、`mode`）设置或清空。`clear: true` 丢弃整个账本。需要有归属的 agent 会话。
- **jspace_finish** — 前述完成闸门。需要四个确认布尔值；否则以未满足的条件拒绝，并在成功时把账本标记为 `complete`。

## 模型体验

### 系统提示

#### 模型看到什么

Harness 的身份与人格保持不变。当 `autoGuide` 开启（启用时的默认）时，一个简短的引导区段（`jspace-guide`）会告诉模型：在需多步的任务中维护账本，并在声明完成前调用 `jspace_finish`；设置 `autoGuide: false` 可移除它，工具将完全 opt-in（模型只读它们的描述）。其余模型可见面是两个工具 schema 与动态状态块（见下）。这使得首轮接口与人格与部署配置完全一致——即 J-Space 报告所称的「首轮锚定」接口得以保留。

#### Token 影响

`enabled` 为 false 时零 token。启用后，`jspace-guide` 区段在开启期间带来少量固定的每请求成本，两个工具 schema 在工具可见期间带来固定的每请求成本；状态块自首次账本写入起才产生 token（受 `maxStateBytes` 约束）。

#### KV 缓存影响

工具 schema 前缀稳定。状态块是动态运行时上下文快照：仅当其文本变化或压实后追加在可复用前缀之后，绝不使早期 KV 条目失效。

### 动态状态块

#### 模型看到什么

通过 `systemPrompt.context`（名 `jspace`）注册，当有效档位为 full 或 loop 时从当前账本渲染：

```text
<system-reminder>
J-Space task ledger (mode: loop):
GOAL: Implement X
CORE:
- keep C
VERIFIED:
- module A compiles
OPEN:
- fix C
NEXT: investigate foo()
FAILED (do not repeat):
- strategy Y [tool bash] → breaks Z
COMPLETED: no
Keep this compact ledger current with jspace_state; core constraints and failed approaches are durable and replace earlier plans. Open items must be resolved or documented before jspace_finish accepts completion.
</system-reminder>
```

在 `fast` 档或首次写入前块不渲染任何内容。在字节预算下，最不重要的尾部区段先被丢弃，然后尾部被截断并附省略标记；闭合框架始终放得下。

#### Token 影响

受 `maxStateBytes` 约束；空块不产生任何内容。

#### KV 缓存影响

仅在可复用前缀之后追加；压实遮蔽先前快照时自动重新注入。

## 扩展点

- 持久账本由 `jspace/state` 会话事件折叠而来（last-write-wins、整值）。loop 的 runtime-context 投影把渲染块变成持久 `user/message`（插件来源）——压实与续会后的恢复无需新机制。
- 重试守卫监听 `tools/post-execute` 与 `agent/pre-step`（复位），与提示性 repeat-tool 守卫完全一致，因此可与其它 post-execute 监听器组合（瀑布通过 `next()` 委托）。

## 已知限制与后续工作

- **fast 档仍暴露工具 schema**——在 `fast`/琐碎任务中动态隐藏或作用域化工具列表尚未实现；开销是保留工具以便模型升级档位的代价。
- **完成闸门是仪式而非循环拦截**——Harness 不会检测模型的最终回答在未调用 `jspace_finish` 时声称「完成」；闸门只在工具被使用时强制清单（与 goal 工具相同的权威模型）。
- **重试记忆为每 agent 的内存态**——它是提示而非已记录的不变量；误判重试后的提示是可接受的代价。需跨压实存续的失败进入持久账本（模型整理或 `persistFailedAttempts`）。
- **独立验证器为选配、已校准但不完美**——设置 `verifierEnabled: true` 后，额外的 LLM 调用会按标准对完成打分（`verifierMinScore` 下限，默认 3）。基于真实标签（flash）校准：对 `verifierRounds`（默认 1；建议 3）取 min 时，10 例集上 false-accept 1/6、false-reject 0/4；单次打分不满足 1/4 的 false-accept 下限，故推荐多轮。它惩罚缺失确定性证据、违约/越权（如为通过而移除必需检查）及测试失败；代价是每次完成多一次（或 N 次）额外调用。
- **与 dsh-goal 重叠**——账本中的 `goal` 是紧凑复述而非另一个持久目标库；两者同时挂载时请保持同步（权威目标用 `get_goal`）。
- **基准为 Harness 机制层面**——模型层面的增益（如 J-Space 报告所称）需要真实模型的 A/B 运行；`scripts/benchmarks/jspace-ab` 中的可复现 A/B 框架在脚本化模型下测量 token、工具调用、重复、失败尝试与墙钟时间，并可指向真实 provider。
