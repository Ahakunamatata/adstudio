# AD Studio Agent 长期开发方案

版本：2026-05-19  
状态：评审稿  
目标读者：产品、设计、前端、后端、Agent 工程、外部行业顾问  
适用范围：AD Studio Agent 工作台、广告复刻/创作链路、AI SDK 接入、画布生产流、素材与生成任务状态管理

---

## 0. 执行摘要

AD Studio 的 Agent 不应该被设计成一个固定流程表单，也不应该被设计成一个无边界聊天机器人。更合适的方向是：

```text
AD Studio Agent = 广告生产 Harness + 受保护工具 + 结构化产物 + 灵活模型规划 + Vercel AI SDK 基座
```

这里的核心判断是：

- 模型负责理解用户意图、选择下一步、生成策略、编译脚本和提示词。
- AD Studio 负责提供可操作的广告生产环境，包括素材、画布、节点、生成任务、成本、确认、失败恢复。
- Vercel AI SDK 负责模型调用、结构化输出、工具调用、流式 UI、多模型切换和后续 Agent loop。
- RH Agent 值得借鉴的是广告生产软协议和阶段化产物，不值得照搬它过度依赖对话上下文和松散 Markdown 协议的部分。
- Claude Code / learn-claude-code 值得借鉴的是 Harness 思维：不要用硬编码流程替模型思考，要给模型清晰工具、知识、观察和权限边界。

最终目标不是“让 Agent 看起来会聊天”，而是让广告设计师在一套可理解、可确认、可返工、可复用的生产工作台里，把竞品参考、产品资产、脚本、锚点、分镜和视频产出串起来。

---

## 0.1 阅读约定与术语表

本文档以后按“产品经理先能读懂，工程实现再精确”的原则维护。英文名、代码名和框架名不会删除，因为它们要和代码、AI SDK 文档、后续 Codex 线程对齐；但首次出现必须给中文名和业务解释。

写作规则：

- 优先使用中文概念名。
- 第一次出现技术名词时，写成“中文名（English/code name）”。
- 如果一个词对应代码里的类型、函数或文件名，用反引号保留，例如 `AgentArtifacts`。
- 新线程如果新增概念，必须先检查本节是否已有定义；没有定义时先补定义，再展开方案。
- 不允许只用英文缩写做章节标题，例如只写 “Artifact / Approval / ToolLoop”。

高频术语：

| 中文名 | 英文/代码名 | 产品经理可以这样理解 |
| --- | --- | --- |
| 结构校验规则 | Zod schema | 像表单规则。规定某个对象必须有哪些字段、字段是什么类型，防止模型乱给格式。 |
| 结构化输出 | Structured Output | 让模型不要只输出一段话，而是输出可被系统读取的固定格式。 |
| Agent 产物包 | `AgentArtifacts` | Agent 在广告生产中沉淀的关键材料集合，例如竞品解析、创意方案、脚本、分镜、提示词包。 |
| 产物摘要 | artifact summary | 产物的短摘要。每轮给模型看摘要，不把完整脚本、完整提示词都塞进去。 |
| Agent 本轮输入快照 | `AgentInputSnapshot` | Agent 这一次决策前看到的上下文包，包括用户消息、项目状态、画布摘要、产物摘要。 |
| 画布快照 | `CanvasSnapshot` | 当前画布上真实存在的节点、连线、锁定、失败、过期状态。模型只能基于它引用节点。 |
| Agent 产物协议层 | Agent Protocol Layer | 规定广告生产中间产物长什么样，例如创意方案、脚本、锚点表、分镜表。 |
| 素材解析结果 | `AgentMediaAnalysis` | 对用户上传图片/视频的客观分析结果，例如画面、节奏、字幕、卖点、CTA。 |
| 锚点登记表 | `AnchorRegistry` | 记录必须保持稳定的关键资产，例如产品 UI、品牌图标、人物、场景、声音、字幕。 |
| 引用顺序编号 | `bindingIndex` | 当一个提示词引用多张图或多个节点时，用编号表示第几个输入；不能单独当业务含义。 |
| 节点唯一编号 | `nodeId` | 画布节点的唯一 ID。Agent 不能自己编造，只能使用画布快照中真实存在的 ID。 |
| 受保护工具 | guarded tools | Agent 可以请求使用的能力，但工具内部会检查权限、前置条件和风险，不让模型直接乱执行。 |
| 阻塞原因 | blocker | 当前不能继续的明确原因，例如缺产品、缺参考素材、节点不存在、未确认扣费。 |
| 执行确认单 | `ApprovalRequest` | 高风险或扣费动作执行前必须生成的确认记录，后续要能证明用户确认过什么。 |
| 待确认卡 | pending confirmation | UI 上展示给用户确认的卡片。M3.1 里只是预览，不能执行。 |
| 安全锁 | `executable: false` | 表示这张卡不能执行真实动作，只能展示方案，不能改画布、不能生成、不能扣费。 |
| 工具调用循环 Agent | `ToolLoopAgent` | 模型可以多步调用工具、观察结果、再继续下一步的 Agent 形态。必须等工具和确认机制稳定后再接。 |
| 事件流水 | event log | 记录“什么时候、哪个工具、改了什么、结果如何”的流水账，用于恢复和审计。 |
| 项目级存储 | workspace-backed store | 当前无后端阶段的项目级本地存储。比单个组件 state 更稳定，但还不是生产数据库。 |
| 模型通道 | provider | 实际调用哪个模型服务，例如官方 Gemini、OpenAI-compatible、Vercel AI Gateway。 |
| 当前运行状态 | runtime state | 前端当前这一轮 Agent 对话、阶段、消息、临时产物的运行状态。 |

## 1. 用户使用场景：这套流程要解决的问题

### 1.1 目标用户

AD Studio 的核心用户是广告素材设计师、投放创意人员、增长团队和中小品牌营销人员。他们不是来体验模型能力的，他们关心的是：

- 能否快速得到可投放素材。
- 能否复刻已经被市场验证过的广告结构。
- 能否控制产品理解、品牌资产、人物、场景、脚本和字幕不跑偏。
- 能否知道每一步用了什么模型、花了多久、花了多少 credits。
- 能否局部返工，而不是每次从头生成。
- 能否沉淀产品包、参考素材、锚点资产和历史项目。

### 1.2 四类入口场景

#### 场景 A：从 0 创作广告

用户有明确目标，例如：

```text
我要给一个家庭定位 App 做一条泰国 TikTok 9:16 15s 广告。
```

用户希望 Agent 做的是：

- 理解产品和目标市场。
- 补齐广告边界：国家、语言、渠道、比例、时长、受众、语气。
- 给出多个创意方向。
- 让用户确认方向后生成脚本。
- 锁定 App UI/icon、人物、场景等锚点。
- 生成分镜、视频 prompt、视频节点。
- 支持字幕、CTA、局部返工。

关键问题：

- 用户一开始可能只给一句话，信息不足。
- Agent 不能乱补产品功能和投放承诺。
- 不能直接跳到视频生成，否则成本高且不可控。

#### 场景 B：复刻竞品广告

用户有竞品图片或视频，希望改成自己的产品。

用户希望 Agent 做的是：

- 先客观拆解竞品：Hook、镜头节奏、卖点植入、视觉风格、CTA。
- 区分“保留什么”和“替换什么”。
- 明确参考程度：严格复刻剧情、只参考节奏结构、只参考视觉风格。
- 结合目标产品生成迁移方案。
- 锁定新产品的品牌/UI/icon/人物/场景锚点。
- 生成可执行分镜和视频。

关键问题：

- 复刻不是抄袭，而是把已验证结构迁移到新产品。
- Agent 必须区分“客观拆解”和“迁移创作”。
- 如果用户上传的素材解析结果已存在，Agent 不应该重新猜测素材内容。

#### 场景 C：从模板或灵感进入

用户不知道做什么，先看模板或案例。

用户希望的是：

- 从模板快速得到可编辑 prompt 和参数。
- 可以选择直接走 Ad Video / Ad Image 快速生成。
- 也可以把模板升级成深度 Agent 项目。

关键问题：

- 模板入口不应该强迫用户走完整 Agent。
- Agent 应该在需要深度推导、复刻、可控生产链路时介入。

#### 场景 D：快速生成图片或视频

用户只想快速生成一张图或一条视频。

用户希望的是：

- 不被 Agent 长流程打扰。
- 直接上传参考图、填 prompt、选比例和模型。
- 生成结果可被保存为产品资产或项目锚点。

关键问题：

- 快速生成和 Agent 深度生产要共享资产，但不共享强流程。
- 快速生成结果以后可以被 Agent 引用。

### 1.3 这套 Agent 流程真正解决的问题

AD Studio Agent 的核心任务不是“回答用户问题”，而是解决广告生产中的五个结构性问题：

#### 问题 1：用户需求不完整

广告生成需要产品、目标市场、渠道、比例、时长、受众、卖点、素材、参考程度。用户通常不会一次性讲清楚。

Agent 的价值：

- 只追问阻塞下一步的问题。
- 不让用户填大表。
- 把隐性边界显性化。

#### 问题 2：竞品复刻容易失真

如果直接让模型“复刻这个广告”，模型容易混淆：

- 视觉风格和产品事实。
- 原广告主体和新产品主体。
- 参考剧情和可投放卖点。
- 已识别信息和模型脑补信息。

Agent 的价值：

- 先拆解，再迁移。
- 先锚点，再分镜。
- 保留结构，替换主体。

#### 问题 3：多模型生成上下文断裂

图片、视频、脚本、分镜可能由不同模型完成。如果没有中间产物，后续模型不知道前面确认了什么。

Agent 的价值：

- 把策略、脚本、锚点、分镜、prompt 都落为结构化产物。
- 通过画布节点和引用关系维持上下游。
- 防止“上一轮说过但下一轮忘了”。

#### 问题 4：生成成本高，错误需要局部返工

广告视频生成成本高，整条重跑不可接受。

Agent 的价值：

- 重要动作前确认。
- 生成前检查前置条件。
- 失败后定位问题归因。
- 只返工受影响节点。

#### 问题 5：资产和经验无法复用

如果每次都是一次性 prompt，产品资产、竞品解析、人物、场景、UI、脚本都无法复用。

Agent 的价值：

- 沉淀产品包。
- 沉淀参考素材解析。
- 沉淀锚点资产。
- 沉淀项目级工作流。

---

## 2. 行业内实践案例：RH Agent 与 Claude Code

### 2.1 RH Agent：广告生产软协议编排

RH Agent 的核心不是某一个模型，也不是一个硬编码后端状态机。它更像一个运行在画布环境里的广告生产软协议系统。

它的主链路可以抽象为：

```text
用户广告需求 / 竞品视频
→ 意图路由
→ 参考素材反推
→ 营销大纲
→ 锚点资产
→ 剧本生成
→ 分镜与计时
→ 视频 Prompt 编译
→ 工作流组装
→ 画布节点执行
→ 用户反馈驱动返工
```

它使用了几类关键协议：

- `State`：控制流，记录当前阶段、下一步、是否需要确认、阻塞条件。
- `creative-doc`：内容流，记录大纲、脚本、clip table 等阶段产物。
- `canvas-snapshot`：资产事实源，记录真实节点 ID、状态、输出 URL。
- `anchorRegistry`：锚点资产映射，把角色、场景、产品、UI 绑定到真实节点。
- `media-context`：多模态视觉输入，把关键帧注入模型上下文。
- `create_workflow / update_node_params / run_node`：画布动作工具。

#### RH Agent 对 AD Studio 的启发

RH Agent 最大的价值在业务结构，而不是技术实现。

值得借鉴：

- 把广告生产拆成可确认阶段。
- 把“竞品反推”和“新广告创作”分开。
- 把脚本、分镜、视频 prompt、画布 workflow 分成不同协议对象。
- 使用 anchor-first 降低人物、场景、产品漂移。
- 把画布快照作为真实节点状态来源。
- 通过用户反馈触发 repair，而不是每次整链路重做。

不应照搬：

- 不应把状态只存在对话上下文里。
- 不应把关键产物只写成松散 Markdown fence。
- 不应允许模型虚构 nodeId 或假设 outputUrl。
- 不应依赖 edge 顺序隐式表达角色/场景含义。
- 不应宣称自动 QA，除非系统真的有轮询、抽帧、视觉评估。

### 2.2 Claude Code / learn-claude-code：Agent Harness 思维

learn-claude-code 的核心理念是：

```text
Agent 是模型，代码是 Harness。
```

也就是说，真正要构建的不是一个用 if/else 假装聪明的流程系统，而是一个让模型能够感知、推理、行动的领域环境。

它把 Harness 拆成：

```text
Harness = Tools + Knowledge + Observation + Action Interfaces + Permissions
```

对应到 AD Studio：

- Tools：分析素材、创建节点、连接节点、生成脚本、运行视频生成、标记返工。
- Knowledge：广告生产规则、平台规范、品牌规则、模型能力说明、prompt 模板。
- Observation：用户消息、产品包、素材解析、画布快照、生成任务状态、历史确认。
- Action Interfaces：画布 action、生成 API、资产库、项目状态更新。
- Permissions：高成本生成确认、品牌资产锁定、节点修改权限、失败重跑规则。

#### Claude Code 对 AD Studio 的启发

最重要的是：不要过早把广告生产写死成硬流程。

应该硬的是：

- 事实。
- 权限。
- 资产状态。
- 生成任务状态。
- 用户确认记录。
- 工具输入输出 schema。
- 成本与不可逆动作。

应该软的是：

- 下一步走哪条创作路径。
- 是否需要追问。
- 是先拆素材，还是先补产品。
- 是走完整 Agent，还是快速生成。
- 返工回退到脚本、锚点、分镜还是 prompt。

### 2.3 Vercel AI SDK：适合承接 Agent 基座

Vercel AI SDK 适合做 AD Studio Agent 的模型调用和工具协议基座，但不应该替 AD Studio 定义广告业务规则。

基于 AI SDK v6 官方文档，当前可确认的适配边界是：

- `generateText` 适合承接当前非流式 Agent decision。它支持 `system`、`prompt/messages`、`output`、`tools`、`activeTools`、`stopWhen`、timeout、usage、warnings 和 step metadata。
- `Output.object()` 适合把当前 `LlmAgentOutput` 约束成 Zod schema 输出，是 Milestone 1 的核心。
- `tool()` 适合后续把 AD Studio 能力封装成 tools。工具使用 `inputSchema`，可选 `outputSchema`、`execute`、`needsApproval`、`strict`；但真实业务动作必须由 AD Studio guard/reducer 执行。
- `needsApproval` 不是现有确认卡片的直接替代。官方流程会返回 approval request，用户响应后再进行后续模型调用，所以仍需要 AD Studio 自己的 durable approval record 和 UI 映射。
- `ToolLoopAgent` 适合 tools、approval、artifacts、event log 稳定后再使用；默认 agent loop 可到 20 steps，必须显式设置 `stopWhen`、`activeTools`、timeout 和成本边界。
- `createAgentUIStreamResponse` 和 `useChat` 适合 Streaming + Tool Status 阶段，不适合 Milestone 1 强行接入。

因此，AI SDK 在 AD Studio 中的角色应该分阶段落地：

- Milestone 1：模型调用 + 结构化输出。
- Milestone 3-5：受保护 tools + approval flow。
- Milestone 6+：streaming UI + ToolLoopAgent。

---

## 3. AD Studio 的预期解决方案效果

### 3.1 产品体验目标

AD Studio Agent 的理想体验是：

```text
用户用自然语言表达广告目标或上传参考素材。
Agent 判断当前可推进的最小下一步。
如果缺信息，Agent 问一个小问题。
如果可以推进，Agent 给出可确认方案。
用户确认后，Agent 用工具更新画布或发起生成任务。
每个产物都落在可检查、可返工、可复用的节点或结构化文档里。
```

### 3.2 用户视角的效果

用户应该感受到：

- Agent 懂广告生产，不是泛聊天。
- Agent 不会一次性逼用户填大表。
- Agent 知道哪些信息缺失，哪些信息已经有。
- Agent 每一步都能解释“为什么现在做这个”。
- Agent 的产出不是孤立文本，而是落在画布节点里。
- Agent 不会擅自烧 credits。
- Agent 能局部返工。
- Agent 记得产品和资产，后续项目能复用。

### 3.3 Artifacts + Canvas 视角的效果

AD Studio 的事实源分为两层：

1. `AgentArtifacts`：广告生产产物协议，负责保存竞品解析、创意方案、锚点注册表、脚本、clip table、prompt pack、workflow plan、repair plan。
2. `Canvas`：生产链路的可视化投影，负责展示节点、连线、版本、锁定、stale 状态和用户操作入口。

Canvas node 可以引用 artifact id，但不应该成为长脚本、prompt、分镜表的唯一存储位置。后续 Tool、Persistence、Approval 都应围绕 artifact id 做读写和审批，再把必要摘要同步到 Canvas。

画布仍然要从“展示结果”升级为“生产状态投影”：

- 每个节点都有业务类型：产品包、竞品素材、竞品解析、创意方案、脚本、锚点、分镜、视频。
- 每个节点有状态：draft、uploaded、running、succeeded、failed、locked、stale。
- 每个节点有版本。
- 每个节点知道上游引用。
- 节点变化会标记下游 stale。
- 生成结果带 provider task id、assetUrl、downloadUrl、cost、time、params、slots。

### 3.4 Agent 视角的效果

Agent 每一轮都应该看到一个干净的输入快照：

```ts
type AgentInputSnapshot = {
  session: AgentSession;
  brief: AgentProductionBrief;
  messages: AgentMessage[];
  canvas: CanvasSnapshot;
  uploadedAssets: AgentUploadedAsset[];
  pendingConfirmation: PendingAgentConfirmation | null;
  artifacts: AgentArtifactSnapshot;
  permissions?: AgentPermissionState;
};
```

其中 `artifacts` 在 Milestone 2 已落为 summary snapshot，而不是完整 artifact 全文。它包含 artifact id、kind、source、status、短摘要、事实引用、模型建议引用和待确认字段。

完整 artifacts 包括：

- `referenceAnalysis`
- `creativePlan`
- `anchorRegistry`
- `scriptDoc`
- `clipTable`
- `promptPack`
- `workflowPlan`
- `repairPlan`

### 3.5 工程效果

工程上希望达到：

- 模型调用从手写 fetch/JSON parse 迁移到 AI SDK。
- 关键输出从“prompt 要求 JSON”升级为 Zod schema 验证。
- 工具调用从“模型返回 canvasActions 草稿”升级为受保护工具。
- 高风险动作统一走 approval。
- Agent UI 支持流式状态，但不强制第一阶段完成。
- 所有重要业务对象可被测试和审计。

---

## 4. AD Studio 当前最佳实践思路以及原因

### 4.1 总原则：硬事实，软流程

AD Studio 当前最适合的原则是：

```text
Facts hard, strategy soft.
```

硬事实包括：

- 用户确认。
- 产品包内容。
- 上传素材。
- 素材解析状态。
- 画布节点 ID。
- 节点状态。
- 输出 URL。
- 锁定锚点。
- 生成任务 ID。
- 消耗 credits。

软流程包括：

- 当前是否追问。
- 是否进入复刻链路。
- 是否跳过 storyboard。
- 是先出方案还是先补素材。
- 返工回退到哪一步。

原因：

- 产品逻辑还没验证，硬流程会限制迭代。
- 广告创作本身有多路径，不适合所有用户走同一条链路。
- 模型擅长判断当前上下文下的下一步。
- 但资产、状态、成本、权限不能靠模型记忆。

### 4.2 不做传统强状态机

不建议现在建立类似：

```text
intake -> reference_analysis -> creative_plan -> anchors -> script -> storyboard -> video -> qa
```

的强制状态机。

更建议建立：

```text
可用能力 + 前置条件 + 推荐 playbook + 当前事实快照
```

让模型在边界内选择下一步。

例如：

- 如果没有产品包，`compile_video_prompt` 工具会返回 blocker。
- 如果锚点未完成，`run_video_generation` 工具会返回 blocker。
- 如果用户未确认，`execute_workflow_plan` 工具会返回 approval required。
- 如果用户只想快速生成，不强迫其进入完整 Agent 链路。

### 4.3 把 RH 的 phase 改成可验收 Playbook

RH 的阶段有价值，但在 AD Studio 中不应成为强制状态机。更合适的定义是：

```text
Playbook = 推荐生产路径 + 前置条件 + 用户确认点 + 画布产物 + 失败恢复规则
```

模型可以选择 playbook，也可以根据用户意图跳过某些步骤。但工具层必须检查前置条件，所有高成本、不可逆、覆盖已确认结果的动作都必须进入确认卡。

#### Playbook A：竞品复刻

```text
Product Intake
→ Reference Upload
→ Analysis Focus
→ Objective Reference Analysis
→ Replication Boundary Confirmation
→ Clone Strategy
→ Script
→ Anchor Plan
→ Shot Plan / Prompt Pack
→ Generation
→ Review / Repair
```

验收重点：

- 用户必须提供产品包、竞品素材、解析重点和输出边界。
- Agent 必须先做客观拆解，再做迁移复刻，不允许混为一个输出。
- 确认卡必须覆盖产品包、素材使用、解析重点、客观拆解、复刻方案、脚本和生成执行。
- 画布必须沉淀 `competitor_asset`、`competitor_analysis`、`clone_strategy`、`ad_script`、anchors、storyboard/video 节点。
- 失败时必须能恢复到素材解析、复刻方案、脚本、锚点或生成节点，而不是默认整条重跑。

#### Playbook B：从 0 创作

```text
Product Intake
→ Ad Boundary Confirmation
→ Creative Direction Options
→ User Selects Direction
→ Script
→ Anchor Plan
→ Shot Plan / Prompt Pack
→ Generation
→ Review / Repair
```

验收重点：

- 用户最小输入可以是一句话广告目标 + 产品包。
- Agent 只追问渠道、语言、比例、时长、目标等阻塞信息。
- 创意方向至少给 3 个，用户选择后再进入脚本。
- 画布必须保留创意方向、脚本、锚点和视频生产节点。
- 产品事实不能由模型擅自扩写，所有高风险生成动作必须确认。

#### Playbook C：快速生成升级为 Agent 项目

```text
Quick Ad Video / Ad Image Generation
→ Save Result
→ Upgrade to Agent Project
→ Bind Product / Role
→ Create Canvas Node
→ Agent Suggests Next Step
```

验收重点：

- 快速生成不默认进入 Agent，但成功结果可以升级为 Agent 项目。
- 升级时必须保留 prompt、参考素材、模型参数、比例、时长和 assetUrl。
- 用户需要选择结果角色：reference、anchor、concept 或 draft/final。
- 如果缺产品包，可以先建项目，但再次生成前必须补齐。

#### Playbook D：局部返工

```text
Issue Classification
→ Affected Node Detection
→ Repair Plan
→ User Confirmation
→ Partial Regeneration
→ Downstream Stale / Refresh
→ Version Replacement Confirmation
```

验收重点：

- 用户可以通过自然语言或节点反馈发起返工。
- Agent 必须先分类问题，再定位受影响节点。
- repair plan 必须展示回退点、影响范围、成本和时间。
- 局部重跑必须追加版本，不覆盖旧结果。
- locked 节点默认受保护，下游 stale 必须在画布可见。

### 4.4 把 Claude Code 的 Harness 思维落到 AD Studio

AD Studio 不应该问：

```text
用户说 X 时，系统应该固定进入哪个流程？
```

应该问：

```text
模型要完成这个广告生产任务，需要哪些工具、知识、观察和权限？
```

因此产品设计的重点从“流程图”转为“能力地图”：

- 能分析素材。
- 能读取产品包。
- 能提出方案。
- 能创建画布节点。
- 能锁定锚点。
- 能编译视频 prompt。
- 能运行生成任务。
- 能检查结果。
- 能提出返工计划。

### 4.5 为什么要基于 Vercel AI SDK

当前项目已手写 Gemini/OpenAI-compatible 请求、JSON 提取、schema parse、前端请求状态和 Agent decision API。这在早期能跑通，但长期会遇到：

- 多模型切换成本高。
- 结构化输出可靠性不足。
- tool calling 需要自建协议。
- 流式 UI 和工具状态需要自建。
- approval flow 需要自建。
- Agent loop 越来越复杂。

AI SDK 可以把这些底层能力标准化，让团队把精力放在广告业务 Harness 上。

---

## 5. AD Studio Agent 详细实践方案

### 5.1 分层架构

建议采用 6 层结构：

```text
┌──────────────────────────────────────────┐
│ 1. UX Layer                               │
│ Chat, cards, canvas, drawers, generation  │
├──────────────────────────────────────────┤
│ 2. Agent Runtime Layer                    │
│ messages, snapshot, pending approval      │
├──────────────────────────────────────────┤
│ 3. Agent Protocol Layer                   │
│ artifacts, playbooks, blockers, plans     │
├──────────────────────────────────────────┤
│ 4. Tool / Capability Layer                │
│ ask, analyze, plan, create nodes, run gen  │
├──────────────────────────────────────────┤
│ 5. Product State Layer                    │
│ session, canvas, assets, tasks, versions   │
├──────────────────────────────────────────┤
│ 6. AI SDK Foundation Layer                │
│ model, output schema, tools, stream, loop   │
└──────────────────────────────────────────┘
```

### 5.2 核心协议对象

这些对象应该逐步从“消息里的文本”升级为 Zod schema。

#### 5.2.1 IntentBrief

用途：识别用户这轮输入想干什么。

```ts
type IntentBrief = {
  intent:
    | "greeting"
    | "usage_help"
    | "project_intake"
    | "clone_ad"
    | "create_ad"
    | "quick_generation"
    | "canvas_edit"
    | "repair"
    | "review_result"
    | "unknown";
  confidence: number;
  suggestedPlaybook?: "clone" | "create" | "quick_video" | "quick_image" | "repair";
  reasons: string[];
  missingCriticalInputs: string[];
};
```

#### 5.2.2 ReferenceAnalysis

用途：客观拆解竞品/参考素材。

```ts
type ReferenceAnalysis = {
  sourceAssetId: string;
  mediaType: "image" | "video" | "unknown";
  summary: string;
  hook: string;
  narrativeStructure: string;
  sceneRhythm: string;
  sellingPoints: string[];
  visualStyle: string;
  characters: string[];
  productAnchors: string[];
  brandAssets: string[];
  appUiMentions: string[];
  textOverlays: string[];
  audio: string;
  cta: string;
  shots: Array<{
    id: string;
    timeRange: string;
    scene: string;
    camera: string;
    action: string;
    visual: string;
    onScreenText: string;
    narration: string;
    sellingPoint: string;
    referenceValue: string;
  }>;
  reusableStructure: string[];
  anchorAssetsToLock: string[];
  generationRisks: string[];
  followUpQuestions: string[];
};
```

当前项目已有 `AgentMediaAnalysis`，可以作为第一版 `ReferenceAnalysis` 的基础。

#### 5.2.3 CreativePlan

用途：把参考素材和目标产品转成可确认广告方向。

```ts
type CreativePlan = {
  id: string;
  mode: "clone" | "create";
  title: string;
  targetProduct: string;
  platform: string;
  language: string;
  ratio: string;
  duration: string;
  referenceMode?: "strict_plot" | "structure_only" | "visual_style_only";
  hook: {
    concept: string;
    physicalExpression: string;
  };
  preserveElements: string[];
  replaceElements: string[];
  usp: string;
  cta: string;
  visualStyle: string;
  anchorRequirements: AnchorRequirement[];
  risks: string[];
  needsUserConfirmation: boolean;
};
```

#### 5.2.4 AnchorRegistry

用途：保存语义资产到画布节点的映射。

```ts
type AnchorRegistry = {
  anchors: Array<{
    id: string;
    role: "character" | "scene" | "product" | "ui" | "brand" | "voice" | "subtitle";
    semanticName: string;
    nodeId?: string;
    status: "needed" | "draft" | "generating" | "ready" | "locked" | "failed";
    outputUrl?: string;
    locked: boolean;
    bindingIndex?: number;
    source: "user_upload" | "generated" | "product_pack" | "reference_analysis";
    requirements: string[];
    failureRisks: string[];
  }>;
};
```

AD Studio 不应该只依赖 edge 顺序表达 `@图片1`。`bindingIndex` 可以有，但必须同时存显式 `role`。

#### 5.2.5 ScriptDoc

用途：广告脚本，不只是文本。

```ts
type ScriptDoc = {
  id: string;
  title: string;
  language: string;
  duration: string;
  scenes: Array<{
    id: string;
    timeRange: string;
    visualAction: string;
    narration: string;
    onScreenText: string;
    productBeat: string;
    requiredAnchors: string[];
  }>;
  cta: string;
  userConfirmationRequired: boolean;
};
```

#### 5.2.6 ClipTable

用途：把脚本转成可生成分镜。

```ts
type ClipTable = {
  totalDuration: string;
  clips: Array<{
    id: string;
    start: number;
    end: number;
    purpose: "hook" | "demo" | "proof" | "emotion" | "cta";
    action: string;
    camera: string;
    requiredAnchors: string[];
    generationNotes: string[];
  }>;
};
```

#### 5.2.7 PromptPack

用途：面向图像/视频模型的最终编译提示词。

```ts
type PromptPack = {
  id: string;
  targetNodeType: "storyboard_frame" | "shot_video" | "final_video";
  prompts: Array<{
    clipId: string;
    content: string;
    negativePrompt?: string;
    referencedAnchorIds: string[];
    referencedNodeIds: string[];
    params: Record<string, string | number | boolean>;
  }>;
  boundaryRules: string[];
};
```

#### 5.2.8 WorkflowPlan

用途：把 PromptPack 转成画布动作计划。

```ts
type WorkflowPlan = {
  id: string;
  title: string;
  summary: string;
  actions: CanvasRuntimeAction[];
  estimatedCost?: string;
  estimatedTime?: string;
  requiresConfirmation: boolean;
  blockers: AgentBlocker[];
};
```

#### 5.2.9 AgentBlocker

用途：让工具可以阻断不安全推进，并把原因返回给模型重新规划。

```ts
type AgentBlocker = {
  code:
    | "missing_product"
    | "missing_reference_analysis"
    | "missing_user_confirmation"
    | "anchor_not_ready"
    | "node_not_found"
    | "generation_running"
    | "cost_approval_required"
    | "unsupported_action";
  message: string;
  recoverable: boolean;
  suggestedNextTool?: string;
};
```

### 5.3 工具能力设计

第一阶段不要一口气给模型太多工具。遵循 Claude Code 的做法：从 3-5 个能力开始，真实失败后再加。

#### 第一组：对话与计划工具

```text
ask_user
propose_action_batch
update_brief
save_agent_artifact
```

用途：

- 补信息。
- 生成确认卡片。
- 保存结构化产物。
- 不直接执行高成本操作。

#### 第二组：分析与创意工具

```text
analyze_reference_asset
generate_creative_plan
draft_script
split_script_to_clips
compile_prompt_pack
```

用途：

- 把 RH 的 `reverse-engineer / ecom-idea / ecom-script / script-chunk / video-prompt` 转成 AD Studio 工具。

#### 第三组：画布工具

```text
create_canvas_node
update_canvas_node
connect_canvas_nodes
lock_canvas_node
mark_downstream_stale
open_node_detail
```

用途：

- 模型通过工具提出动作。
- 工具层负责校验 nodeId、状态、锁定、循环引用。

#### 第四组：生成工具

```text
run_node_generation
append_generation_version
fail_generation
poll_generation_status
```

用途：

- 连接 Vidu / 图像模型 / 视频模型。
- 保存 provider task id、assetUrl、cost、params。

#### 第五组：返工工具

```text
classify_issue
propose_repair_plan
apply_repair_plan
```

用途：

- 处理用户反馈，如 icon 不准、场景有人、字幕遮挡、人物漂移、CTA 错误。

### 5.4 权限与确认策略

必须确认的动作：

- 创建一批生产链路节点。
- 发起任何消耗 credits 的生成任务。
- 修改已 locked 的节点。
- 替换产品锚点、品牌锚点、官方 icon。
- 删除节点或断开关键上游。
- 对最终视频进行导出或覆盖。

高成本动作必须使用 durable `AgentApprovalRequest`，并和实际执行绑定：

```ts
type AgentApprovalRequest = {
  id: string;
  projectId: string;
  sessionId: string;
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
  affectedArtifactIds?: string[];
  estimatedCredits?: number;
  estimatedTimeMs?: number;
  actions: CanvasRuntimeAction[];
  actionHash: string;
  idempotencyKey: string;
  status: "pending" | "approved" | "rejected" | "expired" | "executed" | "cancelled";
  requestedAt: string;
  respondedAt?: string;
  executedAt?: string;
  expiresAt?: string;
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

### 5.5 Agent 每轮决策流程

推荐每轮采用：

```text
1. 构建 AgentInputSnapshot。
2. 注入可用工具列表和当前权限。
3. 模型选择：
   - 回答用户；
   - 追问；
   - 保存结构化产物；
   - 提出待确认动作；
   - 调用安全工具；
   - 遇到 blocker 后重新规划。
4. 工具执行或返回 blocker。
5. 更新 runtime state / artifacts / canvas。
6. 前端渲染文本、卡片、状态、画布变化。
```

### 5.6 状态控制：硬层和软层

#### 硬层

```ts
type AgentHardState = {
  sessionId: string;
  lifecycle: "empty" | "intake" | "ready" | "producing" | "paused";
  assets: AgentUploadedAsset[];
  canvas: CanvasSnapshot;
  pendingConfirmation: PendingAgentConfirmation | null;
  artifacts: AgentArtifacts;
  permissions: AgentPermissionState;
};
```

硬层只能由 AD Studio 工具和业务 reducer 更新，不能由模型自由写。

#### 软层

```ts
type AgentSoftPlan = {
  currentGoal: string;
  suggestedPlaybook?: string;
  candidateNextActions: string[];
  reasoningSummary: string;
  blockers: AgentBlocker[];
};
```

软层可以由模型生成，用来解释和建议，但不能直接当事实源。

### 5.7 UI 设计要求

Agent 工作台采用“左侧 Agent 控制台 + 右侧 Canvas 事实源”。

左侧 Agent 控制台需要支持：

- 当前目标卡：说明本轮 playbook、当前阶段、下一步。
- 追问卡：只问阻塞下一步的问题，提供按钮/短输入，不使用大表单。
- 方案卡：展示创意方向、复刻方向、风险和推荐理由。
- 解析卡：展示竞品客观拆解、用户关注重点覆盖情况、不确定项。
- 脚本卡：展示时间轴、口播、字幕、CTA 和产品事实引用。
- 锚点卡：展示人物、场景、产品、UI、品牌锚点状态。
- 执行确认卡：展示将执行什么、为什么现在执行、影响哪些节点、预计成本和时间、可调整项。
- 错误修正卡：展示失败类型、发生位置、影响范围、恢复动作。

右侧 Canvas 需要支持：

- 节点业务类型：产品包、竞品素材、竞品解析、创意方案、脚本、锚点、分镜、视频。
- 节点状态：`draft`、`waiting_confirmation`、`queued`、`running`、`succeeded`、`failed`、`locked`、`stale`。
- 上游引用：节点必须能看到来自哪个产品包、素材、脚本或锚点。
- 版本记录：返工和重跑必须追加版本，不能覆盖旧结果。
- 关键状态可视化：locked、stale、failed 必须一眼可见。
- 节点详情：输入、输出、模型、耗时、成本、params、provider task id。

确认卡必须用于以下动作：

- 创建批量生产节点。
- 发起任何消耗 credits 的生成。
- 锁定或修改产品、品牌、人物、场景、UI 锚点。
- 修改 locked 节点。
- 执行 repair plan。
- 导出或覆盖最终视频。

确认卡最小字段：

| 字段 | 说明 |
| --- | --- |
| 标题 | 用户要确认的事项 |
| Agent 要做什么 | 动作摘要 |
| 为什么现在做 | 前置条件和当前阶段 |
| 影响范围 | 受影响节点和下游 stale |
| 成本/时间 | 估算 credits 与耗时 |
| 可调整项 | 用户可改的参数 |
| 主操作 | 确认继续 |
| 次操作 | 修改、跳过、取消 |

### 5.8 失败恢复策略

失败状态不能只显示“生成失败”。AD Studio Agent 的失败卡必须把失败转成可执行下一步。

失败卡最小字段：

| 字段 | 说明 |
| --- | --- |
| 失败类型 | 信息缺失、资产未完成、生成失败、品牌错误、人物漂移、场景污染、脚本方向错、字幕问题 |
| 发生位置 | 节点 ID、节点标题、当前 playbook 阶段 |
| 影响范围 | 哪些下游节点 stale，哪些 locked 节点不受影响 |
| 可恢复性 | 可自动重试、需用户补信息、需人工确认、不可恢复 |
| 建议动作 | 补信息、重试当前节点、回退脚本、回退锚点、局部重跑 |
| 主操作 | 按推荐方式修复 |
| 次操作 | 查看详情、手动调整、取消 |

第一阶段失败恢复规则：

| 类型 | 示例 | UX 恢复方式 |
| --- | --- | --- |
| 信息缺失 | 没有产品包、缺渠道/语言 | 追问卡补齐，不推进高成本动作 |
| 素材解析失败 | 竞品视频无法解析 | 重新上传、选择关键帧、手动描述 |
| 产品事实冲突 | 竞品功能当前产品没有 | 删除桥段、替换卖点、补充产品事实 |
| 方案不被认可 | 用户不认可创意或复刻方向 | 回退 CreativePlan，重新生成方向 |
| 锚点未完成 | 人物/场景/UI 没有 locked | 阻断视频生成，先补锚点 |
| 生成失败 | provider timeout | 当前节点 failed，允许重试或调整 prompt |
| 品牌/UI 错误 | icon 不准、App UI 错 | 回退 brand/ui anchor，局部重跑下游 |
| 人物漂移 | 分镜人物不一致 | 回退 character anchor |
| 字幕问题 | 遮挡 UI、语言错 | 回退 subtitle/video assembly |

局部返工必须遵守：

- 先分类问题，再定位受影响节点。
- repair plan 必须经用户确认。
- 重跑必须追加版本，不覆盖旧结果。
- locked 节点默认受保护。
- 上游变更导致的下游 stale 必须在画布可见。

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
- `provider_failure_recovery_rate`：provider 失败后能生成 repair/retry plan 的比例。

核心广告质量指标：

- Product Truth：产品功能和卖点是否可追溯到产品包或用户确认。
- Reference Transfer：是否正确区分保留结构、替换内容和禁止新增内容。
- Script Clarity：Hook、节奏、卖点、CTA 是否清楚。
- Anchor Consistency：人物、产品、UI、品牌、场景是否稳定。
- Prompt Validity：prompt 是否单镜头自洽，引用 nodeId 正确，无上下文污染词。
- Final Usability：最终视频是否通过人工可投放评审。

质量 Rubric 建议使用 1-5 分，3 分为可继续迭代，4 分为可交付候选，5 分为高质量样例。最终视频候选的平均分不低于 3.8，Product Truth 不能低于 4，未确认功能承诺必须为 0。

自动 QA 可以覆盖 schema、权限、前置条件、nodeId、成本确认、artifact 恢复、prompt lint、mock provider。最终广告可用性、复刻是否过度、产品 claim 合规、本地化自然度必须人工评审。

---

## 6. 当前项目如何结合 RH Agent、Claude Code 和 Vercel AI SDK 实现

### 6.1 当前状态总览

更新时间：2026-05-23。

本节现在只作为长期方案里的项目看板和决策依据，不再记录每轮线程的过程流水。详细实现、审计证据和替换文本放在本地专项文档或 PR 描述里；飞书正文只保留最新状态、当前边界和下一步计划。

当前项目没有偏离原规划。核心方向仍然是：

- AD Studio 产品层负责广告工作流、画布节点、用户确认、生成任务、失败恢复和成本边界。
- AI SDK / Agent 层负责模型理解、结构化输出、消息生命周期、工具协议和 provider 适配。
- Agent 可以提出方案，但不能直接改画布、不能直接调用真实生成、不能绕过用户确认。
- 高成本或不可逆动作必须经过 durable approval、generation task、media asset 和 event log。

当前已经可以体验：

- 从首页进入 Agent 工作台并发起自然语言对话。
- 用户输入、信息收集卡、上传、卡片提交、刷新恢复、新任务隔离已回到统一 Agent decision。
- Agent 可以提出画布结构方案，用户确认后才创建非扣费画布节点。
- 用户拒绝画布方案时，画布不变，只记录 rejected approval。
- 重复确认不会重复建节点。
- 模型或 provider 失败时，UI 显示友好重试，不暴露内部工程字段。
- 生成成功后，结果可以在 Workbench 任务卡、媒体预览和画布节点中看到，刷新后可以恢复。
- 用户可以从生成结果发起局部返工提案；当前只到 proposal / confirmation 级别，不会直接重跑 Vidu。
- 可以导出本地会话回放，包含消息、表单、确认、生成任务、媒体资产、事件日志和内部 debug log。

当前已经完成的工程验证：

- 真实 Vidu 生成已经通过 M5.3B 受控 smoke 跑通：先写 ApprovalRequest，再写 GenerationTask，Vidu 返回 providerTaskId 后轮询，成功后写 MediaAsset 和 EventLog。
- 本次真实 smoke 没有调用旧 `/api/vidu/generate`，没有从正式 UI 入口触发，输出资产按 Vidu 临时 URL 标记为 `asset.not_persisted`。
- Vidu 任务曾长时间停在 processing/progress=99，说明后续 PM 体验不能依赖单次长 HTTP 等待，必须做任务状态展示、刷新恢复和后台/短轮询。
- M5.4 PM 可体验入口已完成：Workbench 可从 Agent confirmation 出发，用户确认后调用受控 generation execute / poll API，显示任务状态卡，短轮询到结果，并在刷新后恢复任务和输出。
- M5.4 回归使用 mock provider 验证 UI 和状态流；真实 Vidu 网络调用仍以 M5.3B smoke 为证据，正式体验需要显式开启服务端 env gate。
- M5.5 本地 Supabase Storage 转存已完成：Vidu succeeded 后，服务端会下载 provider output 并上传到本地 Supabase Storage；成功后 MediaAsset 变成 `supabase_storage + recoverable=true + asset.persisted`，失败时保留 `external + recoverable=false + asset.not_persisted` 风险路径。
- M5.6 生成结果体验闭环已完成：GenerationTask / MediaAsset 会投影到 CanvasGraph，写入 `canvas.node.created` / `canvas.node.updated`；Workbench 支持结果预览、打开结果、局部返工提案和刷新恢复。
- 内部画布校验错误不再直接进入用户 UI。用户只看到友好文案，详细的 `connectNodes`、`source`、`target`、`nodeId` 等错误进入会话 replay debug log。
- M5.7 本地 DB 事实源工程路径已完成：API 可以优先读写 Supabase/Postgres project store，并保留 JSON fallback；accept:m57 已用 RPC fixture 验证 DB round-trip、幂等、事件追加、生成任务、媒体资产、画布恢复和 session replay DB 读取。
- M5.7.1 真实 Docker Supabase/Postgres smoke 已完成：本地 Supabase CLI 通过 `corepack pnpm dlx supabase` 运行，`supabase db reset` 已应用 migration，`smoke:m57:supabase-real` 已验证真实 Postgres、Supabase Storage、workspace hydrate、session replay DB 读取、append-only event trigger、idempotency 和旧 `/api/vidu/generate` 调用次数为 0。
- M5.8 真实 Workbench/Vidu 端到端验收已完成：从 Workbench UI 发起需求、展示 generation confirmation、用户确认、真实 Vidu create、poll、Supabase Storage 转存、CanvasGraph 结果节点和 session replay 回放均通过；旧 `/api/vidu/generate` 调用次数为 0。为避免内容质量波动污染链路验收，本次 smoke 默认拦截 `/api/agent/decide` 返回确定性 generation confirmation，执行链路仍然真实。
- M5.8 支撑项“轻量状态反馈 UI”已完成第二阶段：普通用户 UI 不再暴露 `GenerationTask`、`MediaAsset`、`recoverable`、`supabase_storage`、`actionHash`、`idempotencyKey`、raw status 等内部词；状态文案收敛为等待 Agent 回复、提交信息、提交生成请求、排队中、生成中、结果已保存、长期保存失败等用户可理解表达。它不是完整 streaming UI，M6 仍后置。

当前还不能体验：

- 默认启动状态下还不能直接调用真实 Vidu；必须显式设置 M5.4 的服务端启用和确认环境变量，避免误扣费。
- “竞品素材 → 解析 → 创意方案 → 脚本 → 分镜 → 视频生成 → 局部返工”已经有骨架闭环，但还没有达到稳定、顺滑、可面向真实用户验收的产品体验。
- 本地 Supabase Docker / Postgres 真实 smoke 已通过；长期本地运行仍需要开发者自行配置 `NEXT_PUBLIC_SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、`SUPABASE_MEDIA_BUCKET`、`AD_STUDIO_AGENT_PROJECT_STORE=supabase` 和 `AD_STUDIO_AGENT_PROJECT_STORE_REQUIRED=1`，并且不能提交任何密钥。
- 真实 LLM 直接输出 generation confirmation 的稳定性仍属于 M5.8 内容/结构化输出问题；真实 Vidu e2e smoke 已证明执行链路可用，但不代表 Agent 内容质量已达标。
- 还没有后台队列、provider callback、replay 权限控制。
- 对象存储目前是本地 Supabase Docker MVP，不是生产云存储；正式部署仍需要研发接入托管 Supabase / Vercel Blob / S3 等生产存储。
- 还没有接 streaming UI，也没有接 ToolLoopAgent。

当前距离完整体验还差三件事：

| 缺口 | 当前状态 | 为什么重要 |
| --- | --- | --- |
| M5 受控生成 | mock executor、Vidu dry-run adapter、异步 executor、M5.3B 真实 Vidu smoke、M5.4 PM 可体验入口、M5.5 本地 Supabase Storage 转存、M5.6 结果画布投影/预览/局部返工提案、M5.8 Workbench 真实 Vidu e2e smoke 已完成；后台队列/callback 未完成 | 用户确认后才能安全生成，并且生成任务要可追踪、可失败恢复、可审计扣费。 |
| 后端事实源 | store contract、JSON adapter、DB store adapter、migration SQL、本地 Supabase Storage MVP 和真实 Docker migration smoke 已完成；生产对象存储、生产权限、多租户、队列和完整事务事件日志仍待后续研发接入 | 本地 JSON 不能承载多用户、多 tab、长期资产和真实扣费审计。 |
| 长任务体验 | 消息生命周期、UIMessage adapter、生成任务卡、短轮询、刷新恢复、结果预览、会话回放已有；后台轮询和 streaming UI 未接 | 视频生成、轮询、失败恢复会比较慢，用户需要看到过程状态。 |
| 内容质量 | 结构化输出和基础脚本链路已有；广告剧本、分镜表、生图/视频 prompt、创意评审标准还未系统打磨 | 下一阶段需要让 Agent 不只是能跑流程，还要输出像广告创意总监的内容。 |

### 6.2 里程碑看板

| 阶段 | 状态 | 当前结论 | 下一步门槛 |
| --- | --- | --- | --- |
| M1：AI SDK Provider + Structured Output | 已完成 | /api/agent/decide 已接 Vercel AI SDK 的结构化输出，并保留 KIE/OpenAI-compatible fallback。 | provider 变化必须保留 runtime metadata、错误分类和 schema 校验。 |
| M2：Agent 产物协议 | 已完成 | AgentArtifacts、artifact summary、source/status/evidence/confirmation 边界已建立。 | 后续画布节点和生成任务必须引用 artifact id。 |
| M2.5：项目级持久化 MVP | 已完成 | artifacts 和 eventLog 已进入当前 workspace-backed store，刷新恢复基本可用。 | 正式后端前不能把 localStorage 当生产事实源。 |
| M3：Guarded Proposal Tools | 已完成 | askUser、saveArtifact、proposeActionBatch、inspectCanvas 已形成受保护工具雏形。 | 工具只能 proposal / inspect / save，不能执行画布或生成。 |
| M3.2：对话与信息收集卡 | 已完成 | 用户消息、卡片提交、上传、刷新恢复、新任务隔离已回到 Agent decision。 | 后续 UI 和状态流改动必须通过 M3.3 回归。 |
| M3.2.5：AI SDK 对话基建 | 已完成 | provider metadata、错误分类、重试、消息生命周期、UIMessage adapter、tool schema adapter 已补齐。 | 暂不接 useChat、streaming UI、ToolLoopAgent。 |
| M3.3：回归验收自动化 | 已完成 | accept:m33 覆盖 M3.2 baseline、参考素材文字提交、新任务隔离。 | 后续 Agent 对话和状态流改动必须先通过它。 |
| M3.5：后端事实源边界 | 已完成边界 MVP | Project、Session、Artifact、Approval、Canvas、GenerationTask、MediaAsset、EventLog 已收敛为统一 store contract 和 JSON adapter。 | 下一步接专用 API、真实 DB、对象存储和事务事件日志。 |
| M4：Approval + Canvas Proposal | 已完成 | 用户确认前只展示画布动作方案，确认后才执行非扣费画布结构动作；拒绝不改画布，刷新可恢复。 | 后续真实生成必须进入 M5，不能从 M4 confirmation 直接调用 provider。 |
| M5：受控生成任务 | M5.8 e2e 验收已通过 | 已完成 mock provider、Vidu dry-run adapter、异步 executor、live provider smoke gate、真实 Vidu smoke、Workbench 受控生成入口、任务状态卡、短轮询、刷新恢复、本地 Supabase Storage 转存、画布结果投影、媒体预览、局部返工提案、会话回放、内部错误隔离、本地 Docker Supabase/Postgres project store、真实 Docker Supabase smoke，以及真实 Workbench/Vidu e2e smoke。旧 `/api/vidu/generate` 调用次数为 0。 | 下一步是 M5.8 内容质量：体验审计、广告剧本质量、结构化分镜和 prompt 质量打磨。 |
| M5.8：内容质量与创意产物打磨 | 下一阶段 | 打磨 Agent 对话质量、广告剧本、结构化分镜表、生图 prompt、视频 prompt、创意评审和 PM 测试模板。 | 不改底层执行链路，不提前接 ToolLoopAgent。 |
| M6：Streaming + Tool Status | 后续阶段 | 让用户看到 Agent 正在分析、调用工具、等待结果。 | 等内容质量和任务状态体验稳定后再接。 |
| M7：ToolLoopAgent / Repair Loop | 后续阶段 | 让模型在受保护工具边界内多步规划和局部返工。 | 只能在工具、权限、成本、事实源和回归体系稳定后接入。 |

### 6.3 当前架构边界

AD Studio 当前必须坚持两层架构：

| 层 | 职责 | 不能做什么 |
| --- | --- | --- |
| AD Studio 产品层 | 项目、素材、画布、确认、生成任务、资产、事件日志、失败恢复、成本边界 | 不能把模型建议直接当事实，不能绕过 approval 执行真实生成。 |
| AI SDK / Agent 层 | 理解用户意图、生成结构化输出、提出问题、提出方案、选择工具、记录模型运行元数据 | 不能直接改画布，不能直接调用 Vidu，不能直接扣 credits。 |

事实源优先级：

1. 用户确认过的信息、上传资产、产品包和 approval 记录。
2. CanvasGraph、GenerationTask、MediaAsset、EventLog。
3. AgentArtifacts 的已确认版本。
4. 模型建议和未确认草稿。
5. 普通聊天文本。

硬边界：

- 模型不能编造 nodeId、assetId、artifactId、taskId。
- confirmation 只代表用户看到并确认了方案，不等于执行完成。
- approved 只代表用户确认，不等于 executed。
- generation task 必须能回答：谁触发、基于哪个 approval、用了哪个 provider、消耗多少、输出在哪里、失败如何恢复。
- provider 原始错误、密钥、请求体不能直接暴露给用户。

### 6.4 当前执行重点：M5 Vidu 受控生成

Vidu 已经在旧画布生成链路中可用，但这不等于已接入 Agent 受控生成。M5 的目标不是重新接一次 Vidu，而是把现有 Vidu 能力纳入 approval、task、asset 和 event log。

当前 Vidu 适配结论：

- Vidu 适合作为 M5 provider adapter。
- Vidu 是异步任务模型：create 返回 task_id，后续需要轮询或 callback。
- Vidu 状态包括 created、queueing、processing、success、failed。
- 成功输出在 creations[]，包括 url、cover_url、watermarked_url。
- Vidu 输出 URL 官方标注 24 小时有效，所以成功后必须转存对象存储，不能只保存 provider external URL。
- 未确认 Vidu 有请求级 idempotency key，AD Studio 必须用 projectId + idempotencyKey 自己锁。
- 失败扣费规则尚未完整确认，approval 文案不能承诺“失败不扣”。

M5 推荐拆成六步：

| 阶段 | 目标 | 允许做 | 禁止做 |
| --- | --- | --- | --- |
| M5.1 Vidu dry-run adapter | 已完成：把 Vidu 包装成 provider adapter 的静态能力 | validate、payload build、状态映射、错误映射、输出 URL 映射、typecheck | 不真实调用 Vidu，不接 UI，不改 M4 主流程。 |
| M5.2 异步 executor | 已完成：支持 create 后 queued/running，再由 poller 或 callback 更新状态 | generation.status_changed、failed/succeeded、idempotency、approval 状态流 | 不提前把 queued/running 标记为 succeeded。 |
| M5.3A 真实 smoke preflight | 已完成：准备真实 Vidu smoke 的本地安全入口和禁用态 live provider skeleton | dry-run 计划、显式环境开关、脚本级锁、临时 URL 策略、确认清单 | 不真实调用 Vidu，不接 UI，不启用默认 transport。 |
| M5.3B 受控真实 smoke | 已完成：脚本/API 跑通 1 次真实 Vidu 任务 | 已绑定 approval、actionHash、idempotencyKey、task、asset、event log；旧 `/api/vidu/generate` 调用次数为 0 | 不从正式 UI 入口触发，不绕过 executor。 |
| M5.4 PM 可体验入口 | 已完成：Workbench 确认卡后可触发受控生成流程 | 显示任务状态、失败恢复、输出资产、临时 URL 风险；M5.4 验收覆盖重复确认不重复 create、刷新恢复和旧 route 调用为 0 | 不隐藏成本，不隐藏失败，不跳过转存策略。 |
| M5.5 对象存储转存 | 已完成：把 Vidu 临时外链转为本地 Supabase Storage 可恢复资产 | 下载 provider 输出、转存本地 Supabase Storage、写入 storage key、成功写 asset.persisted、失败保留 asset.not_persisted 风险路径 | 不在未转存时承诺长期可用，不把外链当生产资产。 |
| M5.6 生成结果体验闭环 | 已完成：让 PM 在画布和媒体区自然使用生成结果 | 把生成结果挂到画布节点版本、媒体预览、局部返工提案和状态恢复；补会话 replay 和内部错误隔离 | 不扩大到多模型编排或 ToolLoopAgent。 |
| M5.7 本地 DB 事实源 | 已完成：本地 JSON store 可迁移到本地 Docker Supabase/Postgres | Project、Session、Approval、GenerationTask、MediaAsset、CanvasGraph、CanvasSnapshot、EventLog、AgentArtifacts 最小表结构、读写 adapter、fixture 验收和真实 Docker smoke 均已完成；保留 JSON fallback | 不一次性做生产权限、多租户、队列和完整 RLS。 |
| M5.8 Workbench 真实 Vidu e2e | 已完成链路验收 | Workbench UI、deterministic generation confirmation、ApprovalRequest、真实 Vidu create/poll、Supabase Storage、CanvasGraph、session replay 已打通；真实 create 1 次，最终 succeeded，实际记录 55 credits | 不把 deterministic confirmation 当作内容质量通过；真实 LLM 结构化输出仍需 M5.8 主线打磨。 |
| M5.8 轻量状态反馈 UI | 已完成第二阶段 | 普通用户文案已从工程态收敛为用户态；任务状态、资产保存状态和 approval 状态有中文映射；PM replay/debug 仍保留诊断信息 | 这不是 token streaming，不接 useChat、不接 createAgentUIStreamResponse、不接 ToolLoopAgent。 |
| M5.8 内容质量与创意产物打磨 | 下一步：让 Agent 的输出真正像广告创意总监 | 对话追问、创意策略、脚本、分镜表、生图 prompt、视频 prompt、局部返工建议、质量评审 rubric | 不改 execution guard，不绕过 approval，不提前接 ToolLoopAgent。 |

M5.3B 结果：

- 真实 Vidu task 创建成功，providerTaskId 已写入 GenerationTask。
- Vidu 轮询最终返回 succeeded，GenerationTask 进入 succeeded，approval 进入 executed。
- 输出写入 MediaAsset，source=generation，storage.provider=external，recoverable=false，事件写入 asset.not_persisted 和 generation.succeeded。
- 本次真实任务 credits 记录为 55。
- 旧画布生成入口 `/api/vidu/generate` 调用次数为 0。

M5.8 Workbench 真实 Vidu e2e 结果：

- 从 Workbench UI 入口触发，确认卡存在并绑定 ApprovalRequest、actionHash 和 idempotencyKey。
- ApprovalRequest 状态为 pending -> approved -> executing -> executed。
- GenerationTask 状态为 queued -> running/progress=99 -> succeeded。
- 真实 Vidu create 1 次，poll 合计 30 次，providerTaskId 已记录。
- 实际 credits 记录为 55，Vidu 控制台实际扣费以 provider 为准。
- 输出已转存 Supabase Storage，MediaAsset 为 `supabase_storage + recoverable=true`。
- CanvasGraph 有结果节点，事件包含 `canvas.node.created` 和 `canvas.node.updated`。
- session replay 可回放 approval、generation task、media asset 和 canvas change，未泄露 service role key 或 Vidu API key。
- 本次 smoke 默认拦截 `/api/agent/decide` 返回确定性 generation confirmation，目的是隔离 M5.8 内容质量不稳定对执行链路验收的影响。
- 真实任务曾在 28 次 poll 后仍停在 running/progress=99，resume 后同一 providerTaskId succeeded；后续仍需要后台队列或 provider callback。

M5.6 之后必须保留的限制：

- 旧画布 Vidu 链路可以继续作为工具型功能存在，但 Agent 不能直接调用旧 `/api/vidu/generate` 作为主链路。
- 正式 UI 入口不能用一次长 HTTP 等待完整生成，必须使用短轮询、刷新恢复和任务状态卡。
- 本地 Supabase Storage 只是本地体验 MVP，不等于生产后端；生产前仍要补真实 DB、生产对象存储、事务事件日志和队列。
- 转存失败时必须继续把资产标记为 `external + recoverable=false`，不能假装长期可恢复。
- `/api/agent/session-replay` 是本地调试能力，生产前必须加权限、脱敏策略和访问控制。
- M5.7 的 `accept:m57` 是快速 RPC fixture 回归；真实 Docker Supabase 验收使用 `smoke:m57:supabase-real`，需要本地 Supabase Docker 服务和进程级 Supabase env，不应把 service role key 写入代码或提交。
- `smoke:m58:workbench-vidu-real` 是真实扣费 smoke，只能在明确预算和 env gate 后手动运行；不要放进默认回归。

### 6.5 下一步计划

近期主线按以下顺序推进：

1. 先做 Agent 运作逻辑与体验审计文档，帮助 PM 理解每轮对话如何进入 snapshot、模型如何输出、前端如何渲染、事实源如何落盘。
2. M5.8：建立广告创意质量标准，覆盖对话追问、创意策略、Hook、冲突、产品植入、CTA、字幕/配音、本地化和局部返工。
3. M5.8：把剧本、分镜、图像 prompt、视频 prompt 设计成用户可读的结构化表格，而不是只输出长段文字。
4. M5.8：补内容质量验收脚本和 PM 测试记录模板，方便后续基于 session replay 定位问题。
5. 保留 M5.7.1 `smoke:m57:supabase-real` 作为 Docker 环境可用时的 release gate；M6 streaming UI / tool status 等 M5.8 主体验稳定后再推进。
6. 保留 `smoke:m58:workbench-vidu-real` 作为真实 provider 链路抽检，不进入默认 CI；后续优先把 poll_timeout 处理成后台队列/callback 方案。
7. M5.8 状态反馈 UI 已完成第二阶段；后续如果要做真正的 streaming UI，必须作为 M6 独立设计，不要混进内容质量修复。

当前不要并行推进的事项：

- 不要提前接 ToolLoopAgent。
- 不要为了体验快而让 Agent 直接调用旧 Vidu route。
- 不要在转存失败或 not_persisted 标记存在时把 Vidu 临时 URL 当长期资产。
- 不要把真实 provider 波动混进 M3.2 / M4 的 UI 回归。
- 不要把本地 JSON 或本地 Docker DB 当作正式生产事实源。
- 不要在内容质量阶段改动真实生成 guard、approval 或扣费边界。
- 不要把 deterministic generation confirmation smoke 当作真实 Agent 内容质量验收。

### 6.6 新线程执行规则

新线程必须先读文档和代码，再判断。提示词只是入口，文档和代码才是事实源。

每个开发线程至少要读：

- 本文档第 6 部分，理解当前进度、边界和下一步。
- 与任务相关的专项设计文档，例如 M5 读取 AD_STUDIO_AGENT_M5_PROVIDER_SMOKE_PLAN.md。
- 与任务相关的代码文件，例如 provider、executor、approval-flow、project-store。

新线程不能做：

- 不读文档就直接实现。
- 读取或粘贴整份飞书全文。
- 把过程流水追加到第 6 部分。
- 遇到 bug 就靠硬编码单点修复，而不回到 Agent decision、snapshot、approval、task、event log 的主线。

### 6.7 验收与发布阻断

最低回归命令：

- corepack pnpm exec tsc --noEmit
- corepack pnpm lint
- corepack pnpm build
- corepack pnpm accept:m33
- corepack pnpm accept:m4
- corepack pnpm accept:m54
- corepack pnpm accept:m55
- corepack pnpm accept:m56
- corepack pnpm accept:m57
- Docker / Supabase 环境可用时额外运行：corepack pnpm smoke:m57:supabase-real
- 明确要跑真实 provider 且接受扣费时，手动运行：corepack pnpm smoke:m58:workbench-vidu-real

M5 相关新增验收必须额外说明：

- 真实 provider 调用次数。
- /api/vidu/generate 调用次数。
- 是否产生真实扣费。
- 是否写入 GenerationTaskRecord。
- 是否写入 MediaAssetRecord。
- 是否写入对象存储 storage key，或是否明确标记为 external 临时外链。
- 是否写入 EventLog。
- 是否经过 ApprovalRequest、actionHash、idempotencyKey。
- 是否把生成结果投影到 CanvasGraph，并写入 canvas.node.created / canvas.node.updated。
- 是否可以导出会话 replay，且用户 UI 不暴露内部 validator/debug 字段。
- M5.7 额外要求：corepack pnpm accept:m57 覆盖快速 DB fixture 回归；Docker / Supabase 环境可用时运行 corepack pnpm smoke:m57:supabase-real，覆盖真实 Postgres、Storage、EventLog append-only trigger、approval 状态流、generation task 幂等、media asset 恢复、canvasGraph 恢复、session replay DB 读取。
- M5.8 真实 provider 抽检：corepack pnpm smoke:m58:workbench-vidu-real 只在明确接受真实 Vidu 扣费时运行，必须报告真实 create/poll 次数、providerTaskId、credits、storage 状态、canvas 状态、session replay 状态和 `/api/vidu/generate` 调用次数。

发布阻断条件：

| 阻断项 | 原因 |
| --- | --- |
| 未确认就触发真实生成 | 直接违反成本和用户授权边界。 |
| approved 被当成 executed | 会造成用户以为任务完成，但实际 provider 仍在排队或失败。 |
| Vidu 临时 URL 被当成长期资产 | 24 小时后资产可能失效。 |
| provider secret 出现在日志或 UI | 安全事故。 |
| 错误 nodeId / assetId 被执行 | 会污染画布和后续生成链路。 |
| 重复点击导致重复扣费 | idempotency 没有生效。 |
| 内部 validator 错误直接显示给用户 | 会让 PM 和真实用户看到工程实现细节，破坏 Agent 可信度。 |
| session replay 泄露密钥或服务端 token | 调试能力变成安全风险。 |
| 内容质量只靠自由聊天不落结构 | 后续无法复用脚本、分镜、prompt，也无法稳定生成或返工。 |

### 6.8 详细资料索引

长期正文不再展开每个阶段的技术细节。需要细节时看这些本地文档：

| 文档 | 用途 |
| --- | --- |
| AD_STUDIO_AGENT_AI_SDK_ADAPTATION_ASSESSMENT.md | AI SDK 接入边界和 provider 适配评估。 |
| AD_STUDIO_AGENT_ARTIFACTS_SCHEMA_DESIGN.md | AgentArtifacts、artifact summary、workspace-backed store。 |
| AD_STUDIO_AGENT_BACKEND_MVP_PLAN.md | 后端事实源 MVP、表结构、API 和迁移路径。 |
| AD_STUDIO_AGENT_BACKEND_PERSISTENCE_DESIGN.md | persistence 归属和从本地 JSON 到 DB 的迁移。 |
| AD_STUDIO_AGENT_QA_EVALUATION_RISK_CONTROL.md | QA、风险控制、发布阻断。 |
| AD_STUDIO_AGENT_UX_PLAYBOOK_ACCEPTANCE.md | 用户路径、信息收集卡、失败恢复和 UX 验收。 |
| AD_STUDIO_AGENT_M33_ACCEPTANCE.md | M3.3 对话回归验收手册。 |
| AD_STUDIO_AGENT_M5_PROVIDER_SMOKE_PLAN.md | Vidu / provider smoke、GenerationTask、MediaAsset、EventLog 关系。 |
| docs/AD_STUDIO_LOCAL_SUPABASE_STORAGE.md | 本地 Supabase Docker Storage 启动、bucket 创建和 M5.5 转存验收说明。 |
| scripts/m56-generation-result-loop.mjs | M5.6 结果闭环、会话回放和内部错误隔离验收脚本。 |
| supabase/migrations/20260523000000_m57_agent_project_store.sql | M5.7 本地 DB 事实源 schema、RPC、append-only event 约束。 |
| scripts/m57-supabase-project-store.mjs | M5.7 DB store adapter、幂等、replay DB 读取和 fixture 验收脚本。 |
| scripts/m57-real-supabase-project-store.mjs | M5.7.1 真实本地 Docker Supabase/Postgres/Storage smoke 脚本。 |
| scripts/m58-workbench-vidu-real-e2e.mjs | M5.8 Workbench 入口真实 Vidu e2e smoke 脚本，支持 resume，不进入默认回归。 |
| supabase/config.toml | 本地 Supabase Docker 服务端口、DB、Storage 和 migration 配置。 |

---
## 7. 参考资料

### 本地资料

- `AD_STUDIO_PRODUCT_ARCHITECTURE.md`
- `AD_STUDIO_AGENT_WORKING_CONTEXT.md`
- `AD_STUDIO_AGENT_BACKEND_PERSISTENCE_DESIGN.md`
- `AD_STUDIO_AGENT_QA_EVALUATION_RISK_CONTROL.md`
- `AD_STUDIO_AGENT_AI_SDK_ADAPTATION_ASSESSMENT.md`
- `AD_STUDIO_AGENT_UX_PLAYBOOK_ACCEPTANCE.md`
- `AD_STUDIO_AGENT_ARTIFACTS_SCHEMA_DESIGN.md`
- `/Users/hakunamatata/Downloads/资料/RH_Agent_design_review.md`
- `/Users/hakunamatata/Desktop/CodeX项目/GitHub/learn-claude-code/README-zh.md`
- `/Users/hakunamatata/Desktop/CodeX项目/GitHub/learn-claude-code/docs/zh/s03-todo-write.md`
- `/Users/hakunamatata/Desktop/CodeX项目/GitHub/learn-claude-code/docs/zh/s07-task-system.md`
- `/Users/hakunamatata/Desktop/CodeX项目/GitHub/learn-claude-code/docs/zh/s10-team-protocols.md`

### 官方资料

- Vercel AI SDK Agents Overview: https://ai-sdk.dev/docs/agents/overview
- Vercel AI SDK generateText: https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text
- Vercel AI SDK Output: https://ai-sdk.dev/docs/reference/ai-sdk-core/output
- Vercel AI SDK Tool Calling: https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling
- Vercel AI SDK tool: https://ai-sdk.dev/docs/reference/ai-sdk-core/tool
- Vercel AI SDK ToolLoopAgent: https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent
- Vercel AI SDK createAgentUIStreamResponse: https://ai-sdk.dev/docs/reference/ai-sdk-core/create-agent-ui-stream-response
- Vercel AI SDK useChat: https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat
- Vercel AI SDK UI Transport: https://ai-sdk.dev/docs/ai-sdk-ui/transport
