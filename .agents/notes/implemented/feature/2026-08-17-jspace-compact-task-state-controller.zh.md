# Agent Note：J-Space 紧凑任务状态控制器（dsh-jspace）

状态：已实现

[English](2026-08-17-jspace-compact-task-state-controller.md) | 中文

## 问题

长程 agentic 工作会漂移：原始目标从上下文窗口中淡出，约束在不同分支中被分别重建，失败的尝试在没有诊断的情况下被重试，完成声明发生在编辑之后而非验证之后，上下文压实清空了工作记忆。J-Space 能力报告把这一损失称为「能力实现损失」，并提出紧凑且持久的状态（GOAL/CORE/VERIFIED/OPEN/NEXT）、失败尝试记忆、完成前验证与分级控制。Harness 已经拥有相邻机制——goal、todo、repeat-tool-reminder、compaction、plan-mode——因此目标是补上真正缺失的部分而不重复它们，也不触碰 DeepSeek 敏感的人格与首轮接口。

## 决策

一个可选包 `@deepseek-ai/dsh-jspace`（位于 `packages/context`），由 `config.enabled`（默认 false）门控。禁用时不注册任何东西，Harness 行为与之前完全一致；启用时新增三个协调机制。一段简短的系统提示区段（`jspace-guide`，`autoGuide`，默认开启）会主动告诉模型在多步任务中维护账本、并在声明完成前调用 `jspace_finish`；`autoGuide: false` 可移除它，使工具完全 opt-in。人格与首轮接口永不被改动：

1. **持久账本 + 运行时上下文注入。** 账本通过新的只写会话事件 `jspace/state`（携带完整的变更后快照，last-write-wins，与 `todo/write`、`goal/change` 一致）事件溯源。模型可见块注册为 `systemPrompt.context`（`jspace`，order 300）：loop 的 runtime-context 投影只在块变化或压实后重新落盘，因此恢复复用现有机制而非新开一条上下文恢复路径。块在首次写入前或 `fast` 档不渲染任何内容，所以记账开始前 token 成本为零，并由 `maxStateBytes` 约束。
2. **失败感知的重试守卫。** 每 agent 的内存失败调用记忆（参数规范化），挂接 `tools/post-execute` 与 `agent/pre-step`（与 repeat-tool 守卫一致），当之前失败过的同一规范化调用被重试时注入提示；成功会遗忘该记录。它与 `repeat-tool-reminder` 互补（后者不看结果计数相同调用，也不记录失败原因）。
3. **完成闸门。** `jspace_finish` 在做出决策的操作中强制闭环清单：每个 OPEN 项必须被解决或显式记录，账本采取行动后必须有已验证证据（`requireVerification`），且模型必须确认四个闭环布尔。拒绝是带类型的工具错误而非提示文字。

档位选择：`mode` 配置强制 fast/full/loop，或 `auto` 由账本推导（空 → fast，有目标或 OPEN → loop，其余 → full）。Fast 抑制块与提示；工具仍注册以允许模型升级。

刻意不重复：`dsh-goal`（账本 `goal` 是紧凑复述，已记录）、`dsh-todo`、`dsh-plan-mode`、`dsh-compaction-basic` 以及既有的请求上下文投影机制。

## 验证

包内六套共 47 个无密钥测试：纯 fold/mode/verifier/render/attempt 单元；拒绝格式错误的 `jspace/state` 流在提交前的 invariant 伴随；真实 agent-loop 套件（mock adapter）证明对被重试的失败调用触发提示、在 fast 档静默、账本成为模型可见的 user-role 快照并能在后续写入后存续；真实 Loader 组合端到端证明功能开关、完成闸门、档位强制与配置错误响亮失败。host 聚合类型检查通过，持久化目录已为新事件类型重新生成，`scripts/benchmarks/jspace-ab` 提供可复现的 A/B 框架（token、工具调用、重复调用、失败尝试、墙钟时间），并记录了真实模型路径。

## 曾考虑的其他方案

**在系统提示中始终显示状态。** 已拒绝：它会改变 DeepSeek 敏感的首轮接口并使每个请求永久增耗；既有的动态上下文投影以首次写入前零成本提供同样的恢复保证。

**默认把每次失败作为账本事件持久化。** 已拒绝：重试守卫保持内存提示（误判提示是可接受代价），持久失败记录通过 `persistFailedAttempts` 或模型整理可选实现。

**用 `ctx.goals` 作为目标来源。** 暂缓：它会把控制器耦合到 goal 包及其激活机制；账本保留兼容的紧凑复述并记录保持同步的要求。
