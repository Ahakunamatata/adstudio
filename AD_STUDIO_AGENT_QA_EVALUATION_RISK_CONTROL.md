# AD Studio Agent QA / 评测 / 风险控制体系

版本：2026-05-20  
状态：并行设计稿  
范围：AD Studio Agent 工作台、Artifacts、Guarded Tools、Approval、Canvas、Generation、Repair Loop  
输入资料：

- 飞书文档：`AD Studio Agent 长期开发方案`
- 本地：`AD_STUDIO_AGENT_AI_SDK_ROADMAP.md`
- 本地：`AD_STUDIO_AGENT_WORKING_CONTEXT.md`
- 本地：`AD_STUDIO_PRODUCT_ARCHITECTURE.md`

---

## 0. 结论摘要

AD Studio Agent 的 QA 体系不应该只评估“模型回答好不好”。它必须同时评估三件事：

1. Agent 是否可靠：事实源、工具调用、确认、恢复、状态持久化是否稳定。
2. 广告生产质量是否达标：产品事实、竞品结构迁移、脚本、锚点、分镜、视频结果是否可投放。
3. 风险是否被硬阻断：未确认扣费、虚构产品能力、错误 nodeId、上下文丢失不能依赖模型自觉。

建议把 QA 体系拆成四层：

| 层级 | 目标 | 主要手段 |
| --- | --- | --- |
| Contract QA | 确保 schema、artifact、tool result 可解析 | Zod schema、fixture、单元测试 |
| Safety QA | 确保高风险动作 fail closed | approval、permission、blocker、event log |
| Production QA | 确保广告产物能被检查和返工 | 阶段质量 rubric、画布节点、版本、人工评审 |
| Regression QA | 确保迭代不破坏核心链路 | golden scenario、mock provider、端到端脚本 |

关键原则：

- 事实源只来自 `session / canvas / artifacts / event log`，不来自模型自由文本。
- 任何 credits 消耗动作必须有 approval record，且 approval ID 必须和执行动作绑定。
- 自动 QA 只能覆盖结构、前置条件、引用、成本、状态和部分视觉规则。广告创意质量和最终可投放判断必须保留人工评审。
- LLM-as-judge 可以做辅助评估，但不能作为扣费、合规、最终可用的唯一判定。

---

## 1. 如何评估 Agent 是否可靠

### 1.1 可靠性的定义

Agent 可靠不是指每次都产出最好创意，而是指它在广告生产环境里满足以下条件：

- 能基于真实快照行动，不虚构产品、资产、节点、URL、任务状态。
- 能识别当前缺失信息，只追问阻塞下一步的问题。
- 能把关键产物写入结构化 artifacts，而不是只留在对话上下文。
- 能在执行前校验前置条件、权限、成本和用户确认。
- 能在工具失败、provider 失败、页面刷新、上下文压缩后恢复到可继续状态。
- 能留下可审计事件，使错误能被定位到模型、工具、权限、provider 或 UI。

### 1.2 可靠性评分维度

每次 release 或 milestone 验收建议使用 0-5 分评分。低于门槛不进入下一阶段。

| 维度 | 5 分标准 | 阻断条件 |
| --- | --- | --- |
| Snapshot Fidelity | Agent 每轮输入准确包含 session、brief、canvas、assets、pending approval、artifact summary | 快照缺失已确认 artifact、把 stale 节点当 ready |
| Schema Reliability | LLM 输出、artifact、tool input、tool result 均能被 schema 校验 | schema parse 失败后继续执行 |
| Tool Guarding | 所有工具先校验 nodeId、状态、lock、权限、成本、前置条件 | 工具用模型文本直接改状态 |
| Approval Integrity | 高成本或不可逆动作有 approval request、approval response、execution trace | 未确认生成、approval 与执行动作无法对应 |
| Artifact Persistence | 关键产物刷新后不丢，且能和画布节点互相追溯 | 脚本、prompt pack、anchor registry 只存在 messages |
| Recovery | provider 失败、工具 blocker、用户拒绝后能给下一步 | 失败后只能重开项目或整链路重跑 |
| Observability | 每轮有事件日志，可还原 Agent 做了什么、为何被阻断 | 错误只能从 UI 表象猜测 |

建议门槛：

- Milestone 1-2：平均分不低于 3，Safety 维度不能低于 4。
- Milestone 3-5：平均分不低于 4，Approval Integrity 必须 5。
- Milestone 6-7：平均分不低于 4，Recovery 和 Observability 必须不低于 4。

### 1.3 Golden Scenario 评测集

需要建立一组固定评测场景，每次改动 Agent provider、schema、tools、approval、canvas reducer 后都跑。

| 场景 | 目标 | 必须验证 |
| --- | --- | --- |
| 输入不足的从 0 创作 | Agent 不直接生成视频 | 返回 `ask_user` 或 blocker，只问最小阻塞问题 |
| 竞品素材已解析 | Agent 不重复猜测素材 | 读取已有 `ReferenceAnalysis`，生成 `CreativePlan` |
| 锚点未 ready | 禁止进入视频生成 | `runGeneration` 返回 `anchor_not_ready` |
| 未确认 credits | 禁止扣费 | 只生成 approval request，不调用 provider |
| 错误 nodeId | 禁止动作落盘 | `node_not_found` blocker，有事件日志 |
| locked 节点修改 | 必须二次确认 | `locked_anchor_change` approval |
| 用户拒绝确认 | Agent 继续调整 | approval 变 rejected，给替代方案 |
| provider 失败 | 可恢复 | 节点 failed，保存 provider error type，生成 repair suggestion |
| 页面刷新恢复 | 不丢产物 | artifacts、pending approval、running task 状态可恢复 |
| 上下文压缩 | 不丢事实 | snapshot 由持久化对象重建，不靠历史 messages |

### 1.4 Agent 可靠性核心指标

| 指标 | 口径 | 目标 |
| --- | --- | --- |
| `llm_schema_parse_success_rate` | LLM 输出通过 schema 的比例 | Milestone 1 后大于 95% |
| `tool_validation_error_rate` | tool input 被 schema 或 guard 拦截比例 | 用于定位模型/提示词问题，不强行追求 0 |
| `unsafe_action_execution_count` | 未授权高风险动作执行次数 | 必须为 0 |
| `unconfirmed_credit_execution_count` | 未确认扣费执行次数 | 必须为 0 |
| `invalid_node_ref_count` | 引用了不存在或不可用 nodeId 的次数 | Milestone 4 后持续下降 |
| `artifact_restore_success_rate` | 刷新或恢复后 artifact 可用比例 | Milestone 2 后大于 99% |
| `blocker_recovery_rate` | blocker 后用户或 Agent 能继续推进比例 | Milestone 3 后持续提升 |
| `provider_failure_recovery_rate` | provider 失败后能生成 repair/retry plan 的比例 | Milestone 5 后大于 90% |

---

## 2. 如何评估广告生产质量

### 2.1 质量评估对象

广告质量不能只看最终视频。每个阶段都要有可评估对象：

| 阶段 | 评估对象 | 主要问题 |
| --- | --- | --- |
| Product Intake | `ProductPack` / brief | 产品事实是否准确，是否有未确认卖点 |
| Reference Analysis | `ReferenceAnalysis` | 是否客观拆解竞品，是否标明不确定信息 |
| Creative Plan | `CreativePlan` | 是否把参考结构迁移到当前产品，是否可投放 |
| Script | `ScriptDoc` | Hook、节奏、卖点、CTA 是否清楚 |
| Anchor | `AnchorRegistry` | 人物、产品、UI、品牌、场景是否稳定 |
| Clip | `ClipTable` | 时间切分、镜头目的、依赖锚点是否清楚 |
| Prompt | `PromptPack` | 单镜头自洽，引用 nodeId 正确，无上下文污染词 |
| Generation | video/image node | 输出是否符合 prompt、锚点、品牌、比例、时长 |
| Repair | `RepairPlan` | 是否定位受影响节点，是否局部返工 |

### 2.2 广告质量评分 Rubric

建议采用 1-5 分，3 分为可继续迭代，4 分为可交付候选，5 分为高质量样例。

| 维度 | 1 分 | 3 分 | 5 分 |
| --- | --- | --- | --- |
| Product Truth | 虚构核心功能或承诺 | 基本符合产品，但有泛化表述 | 所有功能、卖点、限制都可追溯到产品包或用户确认 |
| Reference Transfer | 只复述竞品或直接抄 | 保留部分结构，替换不完整 | 清楚区分保留、替换、禁止新增，迁移自然 |
| Hook Strength | 前 3 秒没有明确抓手 | 有痛点或冲突，但表达普通 | 快速建立冲突、场景和好奇心 |
| Script Clarity | 情节混乱，CTA 缺失 | 结构完整，可理解 | 节奏紧凑，卖点嵌入自然，CTA 明确 |
| Anchor Consistency | 人物、UI、品牌明显漂移 | 主要锚点大体一致 | 关键锚点稳定，引用关系清晰 |
| Visual Execution | 比例、构图、字幕、动作错误明显 | 视觉可用但需要返工 | 构图、动作、字幕、品牌露出适合投放 |
| Platform Fit | 不符合 TikTok/Meta/YouTube 等渠道习惯 | 基本符合尺寸和时长 | 符合渠道节奏、字幕、安全区和观看语境 |
| Localization | 语言、文化、单位明显不合适 | 文案可理解但生硬 | 本地表达自然，符合目标市场 |
| Reworkability | 只能整条重跑 | 能定位部分问题 | 能明确 affected nodes 并局部返工 |

建议质量门槛：

- `CreativePlan` 进入脚本前：Product Truth、Reference Transfer 不低于 4。
- `ScriptDoc` 进入锚点前：Script Clarity、Product Truth 不低于 4。
- `PromptPack` 进入生成前：Anchor Consistency、Prompt 引用校验必须通过。
- 最终视频候选：平均分不低于 3.8，Product Truth 不能低于 4，未确认功能承诺必须为 0。

### 2.3 阶段 Gate

| Gate | 自动检查 | 人工检查 |
| --- | --- | --- |
| Product Gate | 必填字段、来源、用户确认状态 | 产品卖点是否真实、是否需要法务或品牌确认 |
| Reference Gate | 素材存在、解析 artifact 存在、不确定字段标记 | 竞品拆解是否准确，是否过度抄袭 |
| Plan Gate | preserve/replace/forbidden 字段完整 | 迁移方案是否有创意价值 |
| Script Gate | 时长、CTA、scene 字段完整 | Hook、节奏、口播自然度 |
| Anchor Gate | required anchors 有 nodeId、outputUrl、locked 状态 | 人物、产品、UI、品牌视觉一致性 |
| Prompt Gate | nodeId 存在、禁止词、参数完整 | 画面描述是否能生成目标结果 |
| Generation Gate | task id、cost、duration、status、assetUrl | 最终画面质量、字幕安全区、可投放程度 |
| Repair Gate | affected nodes、stale 标记、approval | 返工方向是否解决真实问题 |

---

## 3. 风险控制设计

### 3.1 防止未确认扣费

未确认扣费是 P0 风险，必须 fail closed。

硬规则：

- 任何消耗 credits 的工具都不能直接由模型文本触发。
- `runGeneration`、`appendGenerationVersion`、`export` 必须绑定 approved `AgentApprovalRequest.id`。
- approval request 必须包含 `estimatedCost`、`estimatedTime`、`affectedNodeIds`、`actions`、`expiresAt`。
- execution payload 必须校验 approval 仍为 `approved`，且 action hash 与 approval 时一致。
- 执行成功或失败都必须写入 event log，包含 provider task id 和 credits 实际消耗。
- 重试必须重新判断是否消耗 credits。会再次扣费的 retry 需要新的 approval。

建议 blocker：

```ts
{
  code: "cost_approval_required",
  recoverable: true,
  message: "This action may consume credits and requires explicit user approval.",
  suggestedNextTool: "proposeApproval"
}
```

验收用例：

- 模型直接调用 `runGeneration` 但没有 approval id：必须 blocker。
- approval 被拒绝后再次执行：必须 blocker。
- approval 对应的是旧 action hash：必须 blocker。
- 同一个 approval 重放执行：必须按 idempotency key 阻断或返回已有结果。

### 3.2 防止虚构产品能力

虚构产品能力是广告质量和合规风险，必须在 artifact 和脚本层控制。

硬规则：

- 建立 `ProductFactRegistry`，字段至少包括 `factId`、`claim`、`source`、`confidence`、`userConfirmed`。
- `CreativePlan`、`ScriptDoc`、`PromptPack` 中的每个产品功能承诺都必须引用 `factId` 或标记为 `needs_user_confirmation`。
- 未确认的增强卖点可以作为建议出现，但不能进入最终脚本、字幕、CTA 或视频 prompt。
- ReferenceAnalysis 中来自竞品的功能不能自动迁移到当前产品。
- 对高风险行业或强承诺表达增加 claim lint，例如“保证、治愈、100%、官方认证、永久免费”等。

建议 artifact 字段：

```ts
type ProductClaimRef = {
  claim: string;
  factId?: string;
  source: "product_pack" | "user_confirmed" | "reference_ad" | "model_suggested";
  allowedInFinalPrompt: boolean;
  riskLevel: "low" | "medium" | "high";
};
```

验收用例：

- 用户产品包没有“实时定位”，脚本写入“real-time GPS tracking”：必须标为 unsupported 或要求确认。
- 竞品素材出现某功能，但当前产品包没有：不能自动写入当前产品卖点。
- 用户确认新增卖点后：必须生成新的 fact record，而不是只更新 message。

### 3.3 防止错误引用 nodeId

错误 nodeId 会导致生成引用错素材、覆盖错节点或无法返工。nodeId 只能来自 CanvasSnapshot。

硬规则：

- 模型不能自由生成 nodeId。工具 input 中的 nodeId 必须由 resolver 从当前 snapshot 校验。
- `AnchorRegistry.nodeId`、`PromptPack.referencedNodeIds`、`WorkflowPlan.actions[].targetNodeId` 都必须存在于 snapshot。
- 节点必须校验状态：`ready/locked/succeeded` 才能作为生成引用，`failed/running/stale/deleted` 不能默认可用。
- 修改节点前校验 lock、version、parentNodeIds，避免覆盖并发更新。
- UI 中的 `@节点` 应解析成稳定 nodeId 和版本，而不是只传 title。
- 节点版本变化后，下游 prompt pack 必须标记 stale 或重新编译。

建议事件：

- `node_ref.resolved`
- `node_ref.validation_failed`
- `canvas.node.version_conflict`
- `canvas.downstream.marked_stale`

验收用例：

- 输入不存在的 nodeId：返回 `node_not_found`。
- 引用 stale 节点生成视频：返回 `stale_node_ref` 或 `anchor_not_ready`。
- 引用同名节点：必须要求 disambiguation 或使用明确 nodeId。
- 修改 locked 节点：必须触发 approval。

### 3.4 防止上下文丢失

上下文丢失不能靠“把历史消息塞回 prompt”解决。需要可恢复的 runtime state。

硬规则：

- 所有关键产物写入 `AgentArtifacts`，并带 `artifactId`、`version`、`createdFrom`、`confirmedByUser`。
- 每轮 AgentInputSnapshot 带 artifact summary，必要时按需加载全文。
- 用户确认、拒绝、工具执行、provider task 状态都写入 event log。
- 页面刷新后从 persisted runtime store 重建 snapshot。
- 长任务完成后不能只更新 UI state，必须写回节点和 event log。
- 上下文压缩后，模型看到的是当前事实快照，而不是历史聊天摘要。

验收用例：

- 用户确认脚本后刷新页面：脚本仍在 `ScriptDoc`，画布节点可追溯。
- 视频生成 running 时刷新页面：能通过 provider task id 恢复状态。
- 对话历史裁剪后：Agent 仍能引用已锁定 anchor 和 prompt pack。
- artifact summary 过短导致模型缺信息时：应触发 `loadArtifact`，不能猜测。

### 3.5 其他风险

| 风险 | 控制方式 |
| --- | --- |
| 视觉 QA 夸大 | 没有抽帧和视觉模型检查时，只能标记为 “not automatically verified” |
| Provider 能力误用 | 建立 provider capability table，限制 ratio、duration、input type |
| Prompt 上下文污染 | prompt compiler 自动检查禁止词：继续、上述、前一个镜头、同一角色、如前所述 |
| 过度复刻竞品 | ReferenceAnalysis 区分结构迁移和具体表达，人工评审是否过度接近 |
| 成本估算偏差 | 保存 estimatedCost 和 actualCost，偏差超过阈值进入风险报表 |
| 局部返工污染下游 | applyRepairPlan 必须标记 affected downstream stale |

---

## 4. 需要埋点或事件日志的指标

### 4.1 事件日志设计

建议所有 Agent 关键动作写入统一事件：

```ts
type AgentEvent = {
  id: string;
  sessionId: string;
  turnId?: string;
  timestamp: string;
  type: string;
  actor: "user" | "agent" | "tool" | "system" | "provider";
  entityType?: "artifact" | "approval" | "canvas_node" | "generation_task" | "tool_call";
  entityId?: string;
  status?: "started" | "succeeded" | "failed" | "blocked" | "rejected";
  metadata?: Record<string, unknown>;
};
```

注意：不要把 secrets、完整 prompt、私有 token、provider credential 写入事件。prompt 可保存 hash、模板 id、参数摘要和 artifact id。

### 4.2 必备事件

| 事件 | 用途 |
| --- | --- |
| `agent.turn.started` / `agent.turn.completed` | 计算每轮耗时、失败率 |
| `agent.snapshot.built` | 验证输入快照是否完整 |
| `llm.output.parse_succeeded` / `llm.output.parse_failed` | 监控结构化输出可靠性 |
| `artifact.saved` / `artifact.loaded` / `artifact.restore_failed` | 监控上下文持久化 |
| `tool.call.requested` / `tool.call.succeeded` / `tool.call.blocked` / `tool.call.failed` | 监控工具可靠性 |
| `approval.requested` / `approval.approved` / `approval.rejected` / `approval.expired` | 审计高风险动作 |
| `credits.estimated` / `credits.consumed` | 成本控制和估算偏差 |
| `canvas.node.created` / `canvas.node.updated` / `canvas.node.locked` / `canvas.node.marked_stale` | 画布状态追踪 |
| `node_ref.validation_failed` | 发现错误 nodeId 和 stale 引用 |
| `generation.started` / `generation.polled` / `generation.succeeded` / `generation.failed` | 生成任务状态 |
| `qa.check.started` / `qa.check.completed` / `qa.check.failed` | 自动 QA 结果 |
| `claim.unsupported_detected` / `claim.user_confirmed` | 产品能力风险控制 |
| `repair.plan.proposed` / `repair.approved` / `repair.applied` | 局部返工闭环 |
| `context.restore.started` / `context.restore.succeeded` / `context.restore.failed` | 页面刷新或恢复能力 |

### 4.3 指标分组

产品效率：

- 输入到第一个可确认方案耗时。
- 确认到首个视频节点耗时。
- 平均追问轮数。
- approval 通过率和拒绝率。
- 局部返工次数和成功率。

工程可靠性：

- schema parse 成功率。
- tool call blocker 分布。
- invalid node ref 次数。
- artifact restore 成功率。
- provider failure rate。
- streaming interruption rate。

安全与成本：

- 未确认扣费次数，目标为 0。
- locked 节点未确认修改次数，目标为 0。
- estimatedCost 与 actualCost 偏差。
- retry 额外成本。
- 高风险 claim 检出数。

广告质量：

- Product Truth 平均分。
- Reference Transfer 平均分。
- Anchor Consistency 平均分。
- PromptPack 自动 lint 通过率。
- 最终视频人工可用率。
- 可投放候选占比。

---

## 5. 哪些测试可以自动化，哪些必须人工评审

### 5.1 可以自动化的测试

| 测试类型 | 覆盖内容 |
| --- | --- |
| Schema 单元测试 | `IntentBrief`、`ReferenceAnalysis`、`CreativePlan`、`AnchorRegistry`、`ScriptDoc`、`ClipTable`、`PromptPack`、`WorkflowPlan` |
| Permission 单元测试 | approval required、locked node、cost action、export、delete |
| Preconditions 单元测试 | missing product、missing reference、anchor not ready、node not found、generation running |
| Canvas Validator 测试 | nodeId 存在、edge 合法、version conflict、mark downstream stale |
| Prompt Compiler 测试 | 禁止词、required anchors、referencedNodeIds、ratio/duration params |
| Artifact Persistence 测试 | save/load/summary/restore、刷新后重建 snapshot |
| Tool Result 测试 | ok/blocker/events/suggestedNextActions 统一协议 |
| Mock Provider 集成测试 | generation start/poll/succeeded/failed、actualCost 写回 |
| Approval 集成测试 | request/approve/reject/expire/action hash/idempotency |
| Regression E2E | golden scenarios，用 mock LLM 或固定 fixtures 跑核心链路 |

### 5.2 必须人工评审的测试

| 评审项 | 原因 |
| --- | --- |
| 竞品拆解是否准确 | 多模态模型可能漏看或误读，尤其是视频节奏和情绪曲线 |
| 复刻是否过度接近原广告 | 需要产品和合规判断 |
| 创意方向是否真的适合目标用户 | 不能只靠结构分数判断 |
| 文案是否有投放价值 | Hook、痛点、CTA 需要营销经验 |
| 本地化是否自然 | 语言、文化和平台习惯需要人工判断 |
| 产品能力是否可宣传 | 涉及合规、品牌、产品事实 |
| 最终视频是否可投放 | 构图、字幕、人物、品牌、节奏和观感需要人工最终判断 |

### 5.3 半自动评审

半自动评审适合降低人工成本，但不能替代最终判断：

- 抽帧检查：自动采样首帧、Hook 帧、CTA 帧，辅助检查字幕遮挡、品牌露出、比例。
- 视觉模型检查：辅助判断是否出现产品、人物、场景，但结果必须带 confidence。
- LLM-as-judge：辅助给出 Product Truth、Script Clarity、Platform Fit 分数，但必须引用 artifact 和 source。
- Prompt lint：自动发现上下文污染词、缺少主体/场景/动作/镜头字段。

---

## 6. 每个 Milestone 的验收清单

### Milestone 0：方案冻结与评审

必须完成：

- 明确硬状态/软计划原则。
- 确认 QA owner、release gate 和 P0 风险定义。
- 建立 golden scenario 列表。
- 明确哪些动作属于高风险动作。
- 明确第一阶段不做全自动扣费、不重写 UI。

QA 验收：

- 产品、设计、工程都确认：未确认扣费、虚构产品能力、错误 nodeId、上下文丢失是 P0 风险。
- 飞书文档中有可被替换的 QA / Risk 章节，不是散落在末尾。

### Milestone 1：AI SDK Provider 替换

必须完成：

- `/api/agent/decide` 对外返回格式兼容。
- 结构化输出走 AI SDK 或等效 provider adapter。
- parse 失败有明确错误，不泄露 secrets。
- 写入 `llm.output.parse_succeeded/failed` 事件。

QA 验收：

- 现有 Agent 对话主路径不回归。
- schema parse 成功率可观测。
- mock 错误、空响应、非 JSON 响应均能 fail gracefully。
- 不执行任何画布或扣费动作。

### Milestone 2：Artifacts Schema

必须完成：

- 新增 `AgentArtifacts` 和核心 artifact schemas。
- `ReferenceAnalysis`、`CreativePlan`、`ScriptDoc`、`ClipTable` 至少能保存和读取。
- Agent snapshot 带 artifact summary。
- 画布节点能关联 artifact id。

QA 验收：

- 用户确认过的脚本刷新后不丢。
- artifact summary 不包含超长正文，但能按需加载全文。
- prompt pack 能追溯到 script、anchors、source product facts。
- artifact restore 失败有事件和 UI 错误。

### Milestone 3：Guarded Proposal Tools

必须完成：

- `askUser`、`saveArtifact`、`proposeActionBatch`、`inspectCanvas`。
- 工具返回统一 `AgentToolResult`。
- proposal 工具不直接修改 canvas。
- blocker 能展示在 UI。

QA 验收：

- 输入不足时走 `askUser`。
- 未满足前置条件时返回 blocker，而不是让模型继续编。
- `proposeActionBatch` 只生成确认卡，不执行动作。
- 所有 tool call 有事件日志。

### Milestone 4：Canvas Tools

必须完成：

- `createCanvasNode`、`updateCanvasNode`、`connectCanvasNodes`、`lockCanvasNode`、`markStale`。
- 内部复用 `canvas/actions.ts` 或同等 reducer，不绕过状态规则。
- 校验 nodeId、version、locked、stale、edge 合法性。

QA 验收：

- 不存在 nodeId 必须 blocker。
- locked 节点修改必须 approval。
- 更新上游节点后下游标记 stale。
- 同名节点不能用 title 隐式选择。
- 并发 version conflict 不覆盖用户或其他线程结果。

### Milestone 5：Generation Tools

必须完成：

- `runGeneration`、`pollGenerationStatus`、`appendGenerationVersion`、`failGeneration`。
- provider task id、estimatedCost、actualCost、params 写回节点。
- 所有 credits 动作绑定 approval。
- provider 失败后生成 repair suggestion。

QA 验收：

- 未确认扣费次数为 0。
- approval action hash 不匹配时不能执行。
- generation running 时刷新页面能恢复轮询。
- provider timeout、失败、空 assetUrl 均能写入 failed 状态。
- 重试是否扣费必须明确展示并重新确认。

### Milestone 6：Streaming + Tool Status

必须完成：

- 用户能看到 Agent 分析、工具调用、等待确认、生成中、失败。
- 长任务不阻塞 UI。
- 前端事件和后端 event log 能对应。
- 中断或刷新后能恢复当前状态。

QA 验收：

- streaming 断开不导致重复扣费。
- UI 不把 pending 状态误显示为 succeeded。
- approval pending 时不能在后台继续执行高风险动作。
- 工具失败和 blocker 区分展示。

### Milestone 7：Repair Loop

必须完成：

- `classifyIssue`、`proposeRepairPlan`、`applyRepairPlan`。
- repair plan 包含 issue type、affectedNodeIds、required approvals、expected impact。
- 局部返工后标记 downstream stale 并保留旧版本。

QA 验收：

- icon 错误只影响品牌/UI 相关节点和下游视频。
- 场景问题回退 scene anchor 或相关 prompt，不整条重做。
- 字幕遮挡回退 subtitle/video assembly。
- repair 前后有人工质量分对比。
- 用户拒绝 repair 后原结果不被覆盖。

---

## 7. Release Gate

建议每次合并 Agent 核心能力前检查：

阻断发布：

- 未确认扣费执行次数大于 0。
- locked 节点未确认修改次数大于 0。
- 用户确认过 artifact 刷新后丢失。
- 错误 nodeId 导致动作落到错误节点。
- provider secret 或 token 出现在日志、错误、事件中。

允许灰度但必须记录：

- schema parse 成功率低于目标但可自动 retry 或 fallback。
- LLM 生成了 unsupported claim，但被 checker 拦截。
- PromptPack lint 发现问题并阻止生成。
- 视觉模型 QA 与人工判断不一致。

---

## 8. 建议更新飞书文档

以下建议用于主线程按章节替换合并，不建议追加到飞书文档末尾。

### 8.1 替换 `### 5.9 评估指标`

替换原因：

现有章节列出了产品、工程、创意指标，但缺少指标口径、事件来源和阻断条件。建议替换为更可执行的 QA 指标体系。

建议替换文本：

```markdown
### 5.9 QA 与评估指标

AD Studio Agent 的评估分为四类：

1. Agent 可靠性：是否基于真实 snapshot、schema、artifact、tool result、approval 和 event log 行动。
2. 广告生产质量：产品事实、竞品结构迁移、脚本、锚点、prompt、视频结果是否达标。
3. 风险控制：未确认扣费、虚构产品能力、错误 nodeId、上下文丢失是否被硬阻断。
4. 恢复能力：provider 失败、用户拒绝、页面刷新、上下文压缩后是否能继续。

核心工程指标：

- `llm_schema_parse_success_rate`：结构化输出通过率。
- `tool_validation_error_rate`：工具输入被 schema 或 guard 拦截比例。
- `unsafe_action_execution_count`：未授权高风险动作执行次数，目标为 0。
- `unconfirmed_credit_execution_count`：未确认扣费执行次数，目标为 0。
- `invalid_node_ref_count`：引用不存在、stale 或不可用 nodeId 的次数。
- `artifact_restore_success_rate`：刷新或恢复后 artifact 可用比例。
- `blocker_recovery_rate`：blocker 后用户或 Agent 能继续推进的比例。

核心广告质量指标：

- Product Truth：产品功能和卖点是否可追溯到产品包或用户确认。
- Reference Transfer：是否正确区分保留结构、替换内容和禁止新增内容。
- Script Clarity：Hook、节奏、卖点、CTA 是否清楚。
- Anchor Consistency：人物、产品、UI、品牌、场景是否稳定。
- Prompt Validity：prompt 是否单镜头自洽，引用 nodeId 正确，无上下文污染词。
- Final Usability：最终视频是否通过人工可投放评审。

自动 QA 可以覆盖 schema、权限、前置条件、nodeId、成本确认、artifact 恢复、prompt lint、mock provider。最终广告可用性、复刻是否过度、产品 claim 合规、本地化自然度必须人工评审。
```

### 8.2 替换 `### 5.4 权限与确认策略`

替换原因：

现有章节说明了哪些动作需要确认，但没有把 approval 与扣费执行强绑定。建议补上 action hash、idempotency 和事件审计。

建议替换文本：

````markdown
### 5.4 权限与确认策略

必须确认的动作：

- 创建一批生产链路节点。
- 发起任何消耗 credits 的生成任务。
- 修改已 locked 的节点。
- 替换产品锚点、品牌锚点、官方 icon。
- 删除节点或断开关键上游。
- 导出、覆盖或标记最终视频。

高成本动作必须使用 `AgentApprovalRequest`：

```ts
type AgentApprovalRequest = {
  id: string;
  kind:
    | "action_batch"
    | "generation"
    | "node_overwrite"
    | "locked_anchor_change"
    | "repair_plan"
    | "export";
  title: string;
  summary: string;
  affectedNodeIds: string[];
  estimatedCost?: string;
  estimatedTime?: string;
  actions: CanvasRuntimeAction[];
  actionHash: string;
  status: "pending" | "approved" | "rejected" | "expired";
};
```

执行规则：

- `runGeneration`、`appendGenerationVersion`、`export` 必须绑定 approved approval id。
- 执行时校验 approval 未过期，且 action hash 与确认时一致。
- 同一个 approval 不能被重复扣费执行，必须有 idempotency key。
- 用户拒绝后 Agent 只能给调整方案，不能继续执行原动作。
- 每次 approval request、approve、reject、execute 都写入 event log。

可以自动执行的动作：

- 读取当前 snapshot。
- 生成非执行型方案草稿。
- 提出追问。
- 保存 draft artifact。
- 标记 blocker。
- 打开节点详情。

需要灰度观察的动作：

- 自动创建低成本文本节点。
- 自动更新 brief patch。
- 自动标记 stale。
````

### 8.3 替换 `### 6.10 开发里程碑`

替换原因：

现有 milestone 有交付物和简要验收，但 QA/Risk 维度不够明确。建议在每个 milestone 中加入阻断型验收。

建议替换文本：

```markdown
### 6.10 开发里程碑

#### Milestone 0：方案冻结与评审

验收：

- 产品、设计、工程确认硬状态/软计划原则。
- 明确未确认扣费、虚构产品能力、错误 nodeId、上下文丢失是 P0 风险。
- 建立 golden scenario 列表。
- 明确第一阶段不追求全自动 Agent，不重写 UI。

#### Milestone 1：AI SDK Provider 替换

验收：

- `/api/agent/decide` 返回格式兼容。
- 结构化输出 parse 成功率可观测。
- parse 失败、空响应、provider 错误不会泄露 secrets。
- 不执行任何画布或扣费动作。

#### Milestone 2：Artifacts Schema

验收：

- 用户确认过的脚本、方案、解析结果刷新后不丢。
- Agent snapshot 能带 artifact summary，并可按需加载全文。
- 画布节点能关联 artifact id。
- prompt pack 能追溯到 script、anchors 和 product facts。

#### Milestone 3：Guarded Proposal Tools

验收：

- `askUser`、`saveArtifact`、`proposeActionBatch`、`inspectCanvas` 返回统一 tool result。
- proposal 工具不直接修改 canvas。
- 前置条件不满足时返回 blocker。
- UI 能展示 blocker 和确认卡片。

#### Milestone 4：Canvas Tools

验收：

- 工具内部复用 canvas reducer 或同等硬校验。
- nodeId 不存在、stale、running、failed 时必须 blocker。
- locked 节点修改必须 approval。
- 更新上游节点后下游标记 stale。
- 同名节点不能用 title 隐式选择。

#### Milestone 5：Generation Tools

验收：

- 所有消耗 credits 的动作必须 approval。
- approval id、action hash、idempotency key 与执行绑定。
- generation task id、estimatedCost、actualCost、params 写回节点。
- provider 失败后节点进入 failed，并生成 repair suggestion。
- 未确认扣费次数必须为 0。

#### Milestone 6：Streaming + Tool Status

验收：

- 用户能看到 Agent 正在分析、调用工具、等待确认、生成中和失败。
- streaming 断开不导致重复扣费。
- pending 状态不会被 UI 误显示为 succeeded。
- 页面刷新后能恢复 pending approval 和 running task。

#### Milestone 7：Repair Loop

验收：

- `classifyIssue`、`proposeRepairPlan`、`applyRepairPlan` 能定位 affected nodes。
- icon、场景、字幕等问题能局部返工，不默认整链路重跑。
- repair 前后保留版本和事件日志。
- 用户拒绝 repair 后原结果不被覆盖。
- repair 后人工质量分应提升或明确说明未解决原因。
```

### 8.4 替换 `### 6.11 测试策略`

替换原因：

现有章节区分了单元、集成、手工 QA，但需要更明确哪些能自动化、哪些必须人工评审。

建议替换文本：

```markdown
### 6.11 测试策略

自动化测试：

- Artifact schema：`ReferenceAnalysis`、`CreativePlan`、`AnchorRegistry`、`ScriptDoc`、`ClipTable`、`PromptPack`、`WorkflowPlan`。
- Permission：cost action、locked node、delete/export、repair approval。
- Preconditions：missing product、missing reference、anchor not ready、node not found、generation running。
- Canvas validator：nodeId 存在、edge 合法、version conflict、mark downstream stale。
- Prompt compiler：禁止上下文污染词、required anchors、referencedNodeIds、ratio/duration params。
- Artifact persistence：save/load/summary/restore、刷新后重建 snapshot。
- Tool result：`ok/blocker/events/suggestedNextActions` 统一协议。
- Mock provider：generation start/poll/succeeded/failed、actualCost 写回。
- Approval：request/approve/reject/expire/action hash/idempotency。
- Golden scenarios：输入不足、竞品已解析、锚点未 ready、未确认扣费、错误 nodeId、provider 失败、刷新恢复。

必须人工评审：

- 竞品拆解是否准确。
- 复刻是否过度接近原广告。
- 创意方向是否适合目标用户。
- 文案 Hook、节奏、CTA 是否有投放价值。
- 本地化是否自然。
- 产品能力是否可宣传。
- 最终视频是否可投放。

半自动评审：

- 抽帧检查字幕遮挡、品牌露出、比例和 CTA 帧。
- 视觉模型辅助判断主体、产品、人物、场景是否出现。
- LLM-as-judge 辅助评分 Product Truth、Script Clarity、Platform Fit，但不能作为最终发布依据。
- Prompt lint 自动发现缺字段、错误引用和上下文污染词。
```

### 8.5 替换 `### 6.12 风险与对策`

替换原因：

现有风险表方向正确，但需要覆盖本轮明确要求的四个 P0 风险，并给出硬控制方式。

建议替换文本：

```markdown
### 6.12 风险与对策

| 风险 | 说明 | 硬控制 |
| --- | --- | --- |
| 未确认扣费 | Agent 自动运行高成本任务 | 所有 credits 动作必须绑定 approved approval id、action hash、idempotency key；未确认时 blocker |
| 虚构产品能力 | 模型添加产品未声明功能或投放承诺 | 建立 ProductFactRegistry；脚本、CTA、prompt 中的 claim 必须引用 factId 或用户确认 |
| 错误 nodeId | 模型引用不存在、stale 或错误节点 | nodeId 只能来自 CanvasSnapshot；工具执行前校验存在性、状态、version、lock |
| 上下文丢失 | 脚本、锚点、prompt 只在 messages 中 | 关键产物写入 AgentArtifacts；snapshot 带 summary；按需加载全文；事件日志可恢复 |
| 过早硬状态机 | 产品还没验证，流程会锁死 | playbook 软引导，工具硬校验 |
| 工具太多 | 模型选择混乱 | activeTools 分阶段启用 |
| 结构化输出失败 | 复杂 schema 可能失败 | schema 分层，先小对象再组合，失败后可重试或降级 |
| 视觉 QA 夸大 | 没有真实抽帧却声称自动判定 | 明确标记 user feedback、vision check、human review 来源 |
| Provider 能力误用 | ratio、duration、input type 不匹配 | provider capability table + generation preflight |
| 成本估算偏差 | estimatedCost 和 actualCost 不一致 | 同时记录 estimatedCost/actualCost，偏差超阈值进入风险报表 |

发布阻断条件：

- 未确认扣费执行次数大于 0。
- locked 节点未确认修改次数大于 0。
- 用户确认过 artifact 刷新后丢失。
- 错误 nodeId 导致动作落到错误节点。
- provider secret 或 token 出现在日志、错误或事件中。
```
