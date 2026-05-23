# AD Studio Agent Milestone 2 / 2.5: Artifacts Schema + Persistence MVP

日期：2026-05-20

## 背景

Milestone 1 已把 `/api/agent/decide` 接到 AI SDK `generateText` + `Output.object`，当前 response shape 仍由 `LlmAgentOutput` 约束：`message`、`questions`、`confirmation`、`canvasActions`、`briefPatch`、`safetyNotes`。

Milestone 2 不接 ToolLoopAgent，不执行模型生成或媒体生成，也不引入后端数据库。本轮先建立广告生产产物的结构化协议和本地状态边界，让后续 Tool、Persistence、Approval 可以复用同一份 artifact contract。

Milestone 2.5 在不改变 `/api/agent/decide` response shape 的前提下，把 `AgentArtifacts` 接到当前项目级 workspace store。localStorage 仍只是单人本地 MVP cache，项目级 JSON / workspace state 才是当前恢复边界，后续可替换为 Postgres/Supabase adapter。

飞书长期方案链接当前需要登录态，本文没有直接读取正文；以下替换建议基于当前代码结构、Milestone 2 目标和现有 Agent/Canvas/local state 边界整理。

## 当前代码边界

- Agent 对话运行态：`src/features/workbench/agent-types.ts` 的 `AgentRuntimeState`，在 `AgentWorkbenchView.tsx` 里用 `ad-studio:agent-runtime:chat-only:v1:${sessionId}` 存 localStorage。
- Agent snapshot：`src/features/agent-runtime/agent-snapshot.ts`，此前只包含 `session`、`brief`、`messages`、`canvas`、`uploadedAssets`、`pendingConfirmation`。
- LLM response：`src/features/agent-runtime/llm/agent-output-schema.ts` 的 `llmAgentOutputSchema`，本轮不新增 response 字段，避免破坏 `/api/agent/decide` 现有 shape。
- Canvas 事实：`WorkbenchCanvas.tsx` 存完整 canvas state，snapshot 中只给 node/edge 摘要。
- 本地工作区：`src/lib/agent-workspace-store.ts`、`src/lib/agent-workspace-model.ts` 和 `AdStudioApp.tsx` 保存 session/workspace，并在 Milestone 2.5 承载 `artifacts` 与 `eventLog`。

## Artifact Contract

新增 `src/features/agent-runtime/artifacts.ts`：

- `ReferenceAnalysis`：竞品/参考素材的客观解析事实，包括 hook、叙事结构、卖点、风格、风险、追问。
- `CreativePlan`：创意方案/复刻策略，是模型建议，需要用户确认后才能驱动生产。
- `AnchorRegistry`：品牌、产品 UI、人物、场景、字幕、风格等锚点注册表。
- `ScriptDoc`：结构化脚本文档，按镜头拆分时间段、目的、画面、旁白、字幕、产品露出和风险。
- `ClipTable`：镜头到分镜图、视频 prompt、canvas node、验收点的生产映射。
- `PromptPack`：后续可执行的 prompt 集合，保留全文但 snapshot 不传全文。
- `WorkflowPlan`：审批和生产步骤计划，标明依赖和是否需要确认。
- `RepairPlan`：返工归因、影响范围、受影响 artifact/node 和建议动作。
- `AgentArtifacts`：上述产物的聚合根，当前挂在 `AgentRuntimeState.artifacts`，后续可迁移到持久化服务。

每个 artifact 都有统一字段：

- `source`：`fact`、`model_suggestion`、`user_confirmation`、`mixed`，明确事实和建议边界。
- `status`：`draft`、`pending_user`、`confirmed`、`rejected`、`stale`、`needs_repair`。
- `evidenceRefs`：引用上传素材、canvas node、message、artifact 或外部来源。
- `userConfirmation`：标记是否需要用户确认、确认字段、确认人和确认时间。

## Snapshot Strategy

`AgentInputSnapshot` 新增 `artifacts: AgentArtifactSnapshot`，由 `createAgentArtifactSnapshot(runtime.artifacts)` 生成。

设计原则：

- 只传 artifact summary，不把完整脚本、prompt、clip 细节每轮塞进 prompt。
- summary 保留 artifact id、kind、source、status、短摘要、事实引用、模型建议引用、待确认字段。
- `PromptPack.prompt`、`ScriptDoc.scenes.visual/narration/onScreenText` 等长文本留在 artifact store，后续工具执行时按 id 精确读取。
- `/api/agent/decide` response shape 不变；当前模型仍只返回 `LlmAgentOutput`。

## Store Boundary

Milestone 2 新增 `src/features/agent-runtime/artifact-store.ts`，Milestone 2.5 扩展为 workspace-backed adapter：

- `ArtifactStore` 只定义 `load`、`save`、`patch`、`clear`。
- `createMemoryArtifactStore` 用于类型测试、未来服务端 adapter 和无 localStorage 环境。
- `createBrowserLocalArtifactStore` 使用 `ad-studio:agent-artifacts:v1:${sessionId}`，只作为轻量本地 adapter，不接后端数据库。
- `createBrowserWorkspaceArtifactStore` 使用 `ad-studio:agent-workspace:v2` 和 `/api/agent/workspace` 读写项目级 workspace，完整 `AgentArtifacts` 写入 `workspace.artifacts`，并同步到 `.next/cache/ad-studio-agent-workspace.json`。
- 旧 `ad-studio:agent-artifacts:v1:${sessionId}` 只作为迁移来源；恢复到 workspace 后会从旧 key 移除。
- `mergeAgentArtifacts` 通过 `agentArtifactsSchema.parse` 保证 patch 后仍符合协议。

## Milestone 2.5 Persistence MVP

落地边界：

- `StoredAgentWorkspace` 新增 `artifacts: AgentWorkspaceArtifactRecord[]` 和 `eventLog: AgentWorkspaceEvent[]`。
- `AgentWorkbenchView` 切换 session 时先从 workspace artifact store 恢复，再把 artifacts 合并进 `AgentRuntimeState.artifacts`。
- `AgentInputSnapshot.artifacts` 继续只由 `createAgentArtifactSnapshot(runtime.artifacts)` 生成 summary，不传完整 `ScriptDoc`、`PromptPack`、`ClipTable`。
- `AgentRuntimeState` localStorage 仍保存 UI 运行态副本，但不再是 artifact 的唯一恢复路径。
- `eventLog` 至少记录 `artifact.saved`、`artifact.loaded`、`artifact.restore_failed`，恢复失败会写入可观测事件并 fallback 到空 artifact 或 runtime cache。

迁移方向：

- 当前 MVP：browser localStorage + `/api/agent/workspace` + `.next/cache/ad-studio-agent-workspace.json`。
- 正式后端：把 `ArtifactStore` adapter 换成 Postgres/Supabase，`body jsonb` 保存全文，`summary jsonb` 保存 snapshot 摘要；EventLog 迁到 append-only `agent_events`。
- localStorage 只做 UI cache 和本地开发恢复，不作为生产事实源。

## 飞书文档建议替换

### 建议替换章节：Agent Fact Source / Canvas 事实源

替换原因：当前文档如果仍把 Canvas node 作为唯一事实源，会导致脚本、分镜、prompt、repair plan 的长内容与 UI 节点状态混在一起。Milestone 2 需要把“生产产物协议”和“画布可视化状态”拆开。

建议文本：

```md
Agent 的事实源分为两层：

1. Artifacts：广告生产产物的结构化协议，负责保存竞品解析、创意方案、锚点注册表、脚本、clip table、prompt pack、workflow plan、repair plan。每个 artifact 必须声明 source、status、evidenceRefs 和 userConfirmation，用于区分事实、模型建议和用户确认。
2. Canvas：生产链路的可视化投影，负责展示节点、连线、版本、锁定、stale 状态和用户可操作入口。Canvas node 可以引用 artifact id，但不应成为长脚本、prompt、分镜表的唯一存储位置。

后续 ToolLoop、Persistence、Approval 都应围绕 artifact id 做读写和审批，再把必要摘要同步到 Canvas。
```

### 建议替换章节：Agent Snapshot / Prompt Context

替换原因：把完整脚本、分镜和 prompt 每轮塞进 prompt 会造成上下文膨胀，也容易让模型把未确认建议当事实。

建议文本：

```md
Agent snapshot 只携带 artifact summary，不携带长全文。

snapshot.artifacts 包含：
- summaries：artifact id、kind、source、status、短摘要、事实引用、模型建议引用、是否需要用户确认。
- pendingConfirmationArtifactIds：当前阻塞执行的待确认产物。
- confirmedFactArtifactIds：可以作为事实使用的 artifact/evidence 引用。
- modelSuggestionArtifactIds：仍属于模型建议、不能直接执行的 artifact 引用。

完整 ScriptDoc、PromptPack、ClipTable 等内容应留在 ArtifactStore。只有后续工具执行、用户打开详情或审批某个 artifact 时，才按 id 精确读取全文。
```

### 建议新增章节：Artifact 字段来源语义

替换原因：后续审批、返工和持久化需要明确哪些字段是事实、哪些是建议、哪些需要用户确认。

建议文本：

```md
Artifact 字段来源语义：

- source=fact：来自用户上传素材解析、用户明确输入、已确认产品包或已确认 canvas 结果，可作为事实引用。
- source=model_suggestion：模型推导出的方案、脚本、prompt、workflow 或 repair plan，必须在高风险动作前进入用户确认。
- source=user_confirmation：用户明确确认或修改后的决策，可覆盖同字段的模型建议。
- source=mixed：artifact 内同时包含事实和建议，必须通过 evidenceRefs 和 userConfirmation 标明可执行边界。

status=pending_user 或 userConfirmation.state=needs_confirmation 的 artifact 不得直接驱动生成工具。
```

### 建议新增章节：Milestone 2 Non-Goals

替换原因：避免把 schema 边界误解为已接入执行链路。

建议文本：

```md
Milestone 2 不做：

- 不接 ToolLoopAgent。
- 不执行真实模型生成或媒体生成。
- 不引入后端数据库。
- 不大改 UI。
- 不改变 /api/agent/decide 的 response shape。

Milestone 2 只交付 artifact schema、summary snapshot、最小 ArtifactStore interface/adapter 和类型检查覆盖。
```

### 建议新增章节：Milestone 2.5 Persistence MVP

替换原因：Milestone 2 已有 schema 和 snapshot summary，但如果 artifact 继续只存在 `AgentRuntimeState` 或孤立 localStorage key，刷新、迁移和审计都没有项目级边界。需要在 ToolLoopAgent 和真实生成前先补持久化 MVP。

建议文本：

```md
#### Milestone 2.5：Persistence MVP

目标：

- 把 `AgentArtifacts` 接入当前项目级 workspace store，而不是只挂在前端 runtime 或孤立 localStorage adapter。
- 不引入后端数据库，不接 ToolLoopAgent，不执行真实模型或媒体生成。
- localStorage 只作为单人本地 MVP cache；项目级 store adapter 是迁移到 Postgres/Supabase 的边界。

交付：

- `ArtifactStore` 支持 workspace-backed adapter，读写项目级 `artifacts`。
- `StoredAgentWorkspace` 保存 `artifacts` 和最小 `eventLog`。
- 页面刷新后 `AgentRuntimeState.artifacts` 能从 workspace 恢复。
- `AgentInputSnapshot.artifacts` 只携带 summary，不携带完整 prompt、script、clip table。
- 旧 `ad-studio:agent-artifacts:v1:${sessionId}` 可以迁移到 workspace。
- EventLog 至少记录 `artifact.saved`、`artifact.loaded`、`artifact.restore_failed`。

验收：

- 刷新后关键 artifact 不丢。
- artifact restore 失败不会静默吞掉，必须写 event log 并 fallback。
- `/api/agent/decide` response shape 不变。
- 后续切 Postgres/Supabase 时只替换 store adapter，不重写 Agent snapshot 和 artifact schema。
```
