# AD Studio Agent 后端与持久化方案

版本：2026-05-20  
状态：并行设计审计稿  
范围：Agent 后端、持久化、任务状态、事件审计、无后端 MVP 到正式后端迁移  
非范围：本轮不修改核心源码，不设计 AI SDK provider、Artifacts schema 细节实现、Guarded Tools 代码实现

---

## 0. 结论摘要

AD Studio Agent 的持久化原则应该和长期方案一致：

```text
硬事实进后端，软计划可在前端短期缓存。
```

当前 `localStorage` 和 `.next/cache` 本地文件能支撑单人 Demo、刷新恢复、基础项目历史、画布节点草稿、Vidu 任务历史回填，但撑不到“可确认、可审计、可恢复、可复用”的 Agent 生产工作台。

推荐路线：

1. 无后端 MVP：保留当前 localStorage + 本地 JSON 文件，但抽象出 store adapter，把 `AgentArtifacts`、`ApprovalRequest`、`CanvasState`、`GenerationTask`、`EventLog` 先写成项目级 JSON 文档。
2. 正式后端：用 Postgres 作为事实源，Supabase 是合适选项；大媒体文件走对象存储；Vercel KV 只做短期缓存/锁/热状态，不做事实源。
3. Canvas 不应该只存 `CanvasSnapshot`。应持久化节点、边、版本，`CanvasSnapshot` 是派生出来喂给 Agent 的输入视图。
4. Generation 必须从“前端 history”升级为后端任务表 + provider task id + 轮询/回调 + 节点版本写回。
5. EventLog 必须 append-only，用来审计 approval、tool call、canvas mutation、task status、repair，而不是只靠 message history。

---

## 1. 已读取资料与当前实现证据

### 1.1 文档资料

- 飞书文档：`AD Studio Agent 长期开发方案`，wiki token 已解析为 docx，标题与本地路线图一致。
- 本地：`AD_STUDIO_AGENT_AI_SDK_ROADMAP.md`
- 本地：`AD_STUDIO_AGENT_WORKING_CONTEXT.md`
- 本地：`AD_STUDIO_PRODUCT_ARCHITECTURE.md`

### 1.2 当前代码事实

当前实现已经有三类持久化：

| 范围 | 当前位置 | 事实 |
| --- | --- | --- |
| Agent runtime | `src/features/workbench/AgentWorkbenchView.tsx` | 使用 `ad-studio:agent-runtime:chat-only:v1:${sessionId}` 存 `AgentRuntimeState` 到 localStorage。 |
| Canvas state | `src/features/workbench/WorkbenchCanvas.tsx` | 使用 `ad-studio:canvas-state:v1:${sessionId}` 存完整前端 canvas state 到 localStorage。 |
| Workspace/project history | `src/components/app-shell/AdStudioApp.tsx` + `src/lib/agent-workspace-store.ts` | 浏览器存 `ad-studio:agent-workspace:v2`，同时 PUT 到 `/api/agent/workspace`，后端写 `.next/cache/ad-studio-agent-workspace.json`。 |
| Generation history | `src/components/app-shell/AdStudioApp.tsx` + `src/lib/vidu-history.ts` | 浏览器存 `ad-studio:generation-state:v1`，Vidu history 同步到 `.next/cache/ad-studio-vidu-history.json`，GET 时会刷新 provider task 状态。 |
| Agent snapshot | `src/features/agent-runtime/agent-snapshot.ts` | `CanvasSnapshot` 只包含节点摘要、边摘要、locked/stale 列表，是运行时输入，不是完整事实源。 |
| Approval | `src/features/workbench/agent-types.ts` | `PendingAgentConfirmation` 存在于 `AgentRuntimeState` 内，没有独立 durable record 和状态流转。 |

这些实现对 Demo 有价值，但本质是“单机浏览器状态 + 开发期本地文件”，不是生产后端。

---

## 2. 当前 localStorage / 前端状态能撑到哪一步

### 2.1 能支撑的范围

当前方案可以支撑：

- 单用户、单浏览器、开发环境 Demo。
- 页面刷新后恢复 Agent 对话、项目列表、画布节点和生成历史。
- 快速生成入口的历史任务展示。
- Vidu provider task 的基础回填：本地文件里保存 `providerTaskId` 后，GET history 时调用 provider 查询并更新状态。
- Agent 工作台的“对话优先”阶段：当前 prompt 明确要求“只保留对话能力，不要输出画布动作”。
- 轻量素材/产品信息：非 blob 的 `previewUrl` 可以随 session 保存，blob URL 会被清理。

### 2.2 不能支撑的范围

当前方案不能可靠支撑：

- 多设备、多用户、团队协作。
- 服务端 Agent loop、后台工具调用、长任务恢复。
- 高成本生成的 durable approval：刷新、跨端、重试后无法证明用户确认了哪一批动作。
- Artifact 的长期复用：脚本、clip table、prompt pack 等仍没有独立 store。
- EventLog 审计：无法追溯“谁在什么时候用哪个工具改了哪个节点”。
- 生成任务一致性：前端 history、canvas node version、provider task 之间没有统一事实源。
- 媒体上传持久化：用户上传的本地文件如果只有 blob URL，刷新后不可恢复。
- schema migration：localStorage 里是整包 JSON，版本迁移和部分修复困难。
- 并发写入：多个 tab 或并行 Agent 工具更新同一项目时容易互相覆盖。

### 2.3 能撑到的产品里程碑

| 阶段 | localStorage 是否足够 | 说明 |
| --- | --- | --- |
| 静态原型 | 足够 | 展示 IA、工作台、节点结构。 |
| 单人 Demo | 基本足够 | 可以用 localStorage + `.next/cache` 保留刷新恢复。 |
| 可用 MVP 内测 | 勉强，需要本地 store adapter | 必须把 artifact、approval、event log 抽出来，避免继续散落在 React state。 |
| 真实用户生产 | 不足 | 需要数据库、对象存储、任务表和审计日志。 |
| 团队协作/多项目资产库 | 完全不足 | 需要用户、权限、项目成员、资产引用、冲突控制。 |

---

## 3. 持久化对象设计

### 3.1 `AgentArtifacts`

定位：Agent 生产中间产物，是“多模型上下文不丢失”的核心事实。

应持久化的内容：

- `intentBrief`
- `referenceAnalysis`
- `creativePlan`
- `anchorRegistry`
- `scriptDoc`
- `clipTable`
- `promptPack`
- `workflowPlan`
- `repairPlan`

推荐存储：

- MVP：项目级 JSON 文件或 local Indexed JSON store，按 artifact id/version 存。
- 正式：Postgres `agent_artifacts` 表，`body jsonb` 保存完整 schema，`summary jsonb` 保存 Agent snapshot 用摘要。

推荐字段：

```text
agent_artifacts
- id
- project_id
- session_id
- artifact_type
- artifact_key
- status: draft | proposed | approved | superseded | rejected
- version
- schema_version
- body jsonb
- summary jsonb
- source_message_id
- source_tool_call_id
- linked_node_ids text[]
- linked_task_ids text[]
- created_by
- created_at
- updated_at
```

关键规则：

- Artifact 不直接等于 message。message 是交互记录，artifact 是可复用生产事实。
- 已确认 artifact 不允许静默覆盖，必须新建 version。
- Agent 每轮输入只带 summary，只有需要编译 prompt 或 repair 时按需加载全文。
- 画布节点通过 `artifact_id` 或 `source_artifact_id` 追溯来源。

### 3.2 `ApprovalRequest`

定位：用户确认记录，是成本、品牌资产和不可逆动作的保护边界。

当前 `PendingAgentConfirmation` 只存在 runtime 内，适合 UI 卡片，不适合作为事实源。应升级为 durable approval request。

推荐存储：

- MVP：项目 JSON 中保存 `approvalRequests[]`，每次 approve/reject 都 append event。
- 正式：Postgres `approval_requests` 表。

推荐字段：

```text
approval_requests
- id
- project_id
- session_id
- kind: action_batch | generation | node_overwrite | locked_anchor_change | repair_plan | export
- title
- summary
- status: pending | approved | rejected | expired | executed | cancelled
- requested_actions jsonb
- affected_node_ids text[]
- affected_artifact_ids text[]
- estimated_credits
- estimated_time_ms
- idempotency_key
- expires_at
- requested_by
- responded_by
- requested_at
- responded_at
- executed_at
```

关键规则：

- 所有消耗 credits 的动作必须有 `approved` approval id。
- approve 只代表用户允许执行，不代表已经执行成功；执行结果必须写 event log。
- 对 locked anchor 的修改必须单独 approval，不要混在普通 action batch 里。
- 每个 tool execution 应携带 `approval_request_id` 或明确返回 blocker。

### 3.3 `CanvasSnapshot`

定位：Agent 输入视图，不是主存储模型。

当前 `CanvasSnapshot` 只包含：

- 节点摘要：id/kind/businessType/title/status/locked/parentNodeIds/staleReason
- 边摘要：id/source/target/label
- locked/stale node id 列表

这正适合喂给模型，但不足以恢复真实画布。正式持久化应保存：

- `canvas_nodes`
- `canvas_edges`
- `canvas_node_versions`
- 可选 `agent_snapshots` 作为某轮 Agent 输入快照归档

推荐字段：

```text
canvas_nodes
- id
- project_id
- kind
- business_type
- title
- status
- locked
- group
- position jsonb
- parent_node_ids text[]
- primary_version_id
- settings jsonb
- stale_reason
- created_at
- updated_at

canvas_node_versions
- id
- node_id
- version
- label
- content
- model
- provider
- provider_task_id
- asset_id
- asset_url
- download_url
- params jsonb
- slots jsonb
- cost_credits
- duration_ms
- source_artifact_id
- source_task_id
- created_at

canvas_edges
- id
- project_id
- source_node_id
- target_node_id
- label
- role
- created_at
```

关键规则：

- `CanvasSnapshot` 由上述表派生，必要时按 session turn 保存一份 `agent_snapshots` 便于复盘。
- 不允许模型提交虚构 node id；tool 层只接受已存在 id 或由 `create_node` 返回的新 id。
- 下游 stale 应由 deterministic reducer/tool 根据 edge 和 parentNodeIds 更新。

### 3.4 `GenerationTask`

定位：长任务事实源，连接 provider、canvas version、asset、cost、repair。

当前 `GenerationTask` 类型已经有 `providerTaskId`、`status`、`progress`、`credits`、`output.assetUrl/downloadUrl`、`context.nodeId/projectId`，适合演进成后端表。

推荐存储：

- MVP：继续用 `.next/cache/ad-studio-vidu-history.json`，但按 `projectId/sessionId/nodeId` 建索引，并写入 event log。
- 正式：Postgres `generation_tasks` 表；输出文件进 Blob/Supabase Storage，任务表只保存引用。

推荐字段：

```text
generation_tasks
- id
- project_id
- session_id
- node_id
- node_version_id
- artifact_id
- approval_request_id
- kind: image | video | audio | text
- surface: standalone | canvas | agent
- provider
- provider_task_id
- model_id
- model_name
- mode_key
- prompt
- params jsonb
- slots jsonb
- status: queued | running | succeeded | failed | cancelled
- progress
- credits
- cost_usd
- output_asset_id
- output jsonb
- error_code
- error_message
- idempotency_key
- created_at
- started_at
- completed_at
- updated_at
```

关键规则：

- `provider_task_id` 应有唯一约束，防止重复写入。
- 任务状态更新必须 append event。
- `succeeded` 后写入 `canvas_node_versions`，不要只更新 history。
- 失败后保留 prompt/params/slots，repair 才能定位问题。
- 轮询由后端负责，前端只订阅或刷新后端状态。

### 3.5 `EventLog`

定位：append-only 审计与恢复轨迹，不等同于 chat message。

推荐存储：

- MVP：项目 JSON 中保存 `events[]`，或项目级 JSONL 文件。
- 正式：Postgres `agent_events` 表，按 project_id + sequence 查询。

推荐字段：

```text
agent_events
- id
- project_id
- session_id
- sequence
- actor_type: user | agent | system | tool | provider
- actor_id
- event_type
- object_type
- object_id
- correlation_id
- request_id
- payload jsonb
- created_at
```

关键事件类型：

- `message.created`
- `artifact.created`
- `artifact.versioned`
- `approval.requested`
- `approval.approved`
- `approval.rejected`
- `tool.called`
- `tool.blocked`
- `canvas.node.created`
- `canvas.node.updated`
- `canvas.node.locked`
- `canvas.downstream_stale_marked`
- `generation.queued`
- `generation.provider_task_created`
- `generation.status_changed`
- `generation.succeeded`
- `generation.failed`
- `asset.uploaded`
- `asset.persisted`
- `repair.proposed`

关键规则：

- EventLog 是审计，不是业务表替代品。
- 业务表保存当前状态，EventLog 保存状态变化原因。
- 所有高风险动作必须能从 event log 找到 approval id 和 tool result。

---

## 4. 没有后端时的 MVP 方案

目标：不引入正式数据库，也能跑一个可评审、可刷新恢复、可追溯的单人 MVP。

### 4.1 技术形态

保留当前：

- Agent runtime localStorage
- Canvas localStorage
- Workspace localStorage + `.next/cache/ad-studio-agent-workspace.json`
- Vidu history localStorage + `.next/cache/ad-studio-vidu-history.json`

新增设计约束：

- 抽象 store adapter，不让组件直接决定长期存储结构。
- 用项目级 JSON 文件作为“准后端事实源”：

```text
.next/cache/ad-studio-agent-projects/{projectId}.json
```

文件结构建议：

```text
{
  "project": {},
  "sessions": [],
  "runtime": {},
  "artifacts": [],
  "approvalRequests": [],
  "canvas": {
    "nodes": [],
    "edges": []
  },
  "generationTasks": [],
  "assets": [],
  "events": []
}
```

### 4.2 MVP 行为边界

必须明确限制：

- 仅单用户、本地 Demo。
- 不保证多 tab 并发编辑。
- 上传文件如果没有被上传到对象存储，刷新后只能保留文件名和已生成的远程 URL，不能恢复原始 blob。
- 所有高成本生成仍必须有 approval record，即使存在本地 JSON。
- 任务轮询只支持当前运行的 Next.js 本地服务，服务停止后依赖下次打开页面刷新。

### 4.3 MVP 可接受的数据归属

| 对象 | MVP 存储 | 说明 |
| --- | --- | --- |
| AgentRuntimeState | localStorage + project JSON | localStorage 快速恢复 UI，project JSON 准后端恢复。 |
| AgentArtifacts | project JSON | 以 versioned artifact 数组保存。 |
| ApprovalRequest | project JSON | pending/approved/rejected/executed 状态必须可恢复。 |
| Canvas | localStorage + project JSON | localStorage 用于交互，project JSON 用于准事实源。 |
| CanvasSnapshot | 运行时派生，可选落 event | 不作为主存储。 |
| GenerationTask | Vidu history JSON + project JSON | 逐步从全局 history 迁到项目维度。 |
| EventLog | project JSON 或 JSONL | append-only，不覆盖。 |

### 4.4 MVP 验收标准

- 刷新页面后，已确认脚本、creative plan、prompt pack 不丢失。
- 刷新页面后，pending approval 仍然显示且不能绕过。
- 用户拒绝 approval 后，状态和拒绝事件可追溯。
- 生成任务刷新后能继续显示 queued/running/succeeded/failed。
- 生成成功后，canvas node version 和 generation task 能互相追溯。
- 删除项目时，对应 runtime、canvas、artifact、task、event 都能清理或标记 archived。

---

## 5. 有后端后的推荐架构

### 5.1 推荐分层

```text
Frontend
  - React UI
  - optimistic local cache
  - upload/progress display

Next.js API / Server Actions
  - auth/session
  - store adapters
  - guarded tools
  - provider adapters
  - webhook/polling endpoints

Postgres
  - projects/sessions/messages
  - artifacts/approvals/canvas/tasks/assets/events

Object Storage
  - uploaded reference media
  - generated image/video/audio
  - thumbnails/keyframes

Optional Cache/Queue
  - KV/Redis for short locks, polling cursors, stream resume
  - queue/cron for provider polling and retries
```

### 5.2 推荐数据模型

核心表：

- `projects`
- `project_members`，团队协作阶段再启用
- `agent_sessions`
- `agent_messages`
- `agent_artifacts`
- `approval_requests`
- `canvas_nodes`
- `canvas_edges`
- `canvas_node_versions`
- `generation_tasks`
- `assets`
- `agent_events`

可选表：

- `agent_snapshots`：保存每轮 Agent 输入快照，便于调试。
- `tool_calls`：如果希望比 event log 更细地分析工具成功率，可单独建表。
- `provider_accounts` / `provider_model_capabilities`：多 provider 成熟后再建。

### 5.3 请求流

#### Agent 决策流

```text
user message
→ POST /api/agent/chat
→ load project facts: session + artifact summaries + canvas snapshot + pending approval + recent events
→ AI SDK provider/tool loop
→ save message/artifact/approval/tool events
→ stream UI events
```

#### Approval 执行流

```text
approval approved
→ validate approval status/idempotency
→ execute guarded actions
→ update canvas/artifacts/tasks
→ append event log
→ return action trace
```

#### Generation 流

```text
runGeneration tool
→ require approved approval_request_id
→ create generation_tasks row
→ call provider
→ save provider_task_id
→ poll or webhook update status
→ on success persist asset
→ append canvas_node_version
→ mark downstream stale if needed
→ append event log
```

### 5.4 Agent 输入快照生成

正式后端不应该把全量项目 JSON 塞给模型。推荐每轮动态构建：

```text
AgentInputSnapshot =
  session summary
  + production brief
  + last N messages
  + canvas snapshot
  + artifact summaries
  + pending approval
  + running generation tasks
  + recent relevant events
  + permissions
```

长 artifact 全文按需加载，例如 compile prompt 时加载 `scriptDoc`、`clipTable`、`anchorRegistry`。

---

## 6. Supabase / Postgres / 文件存储 / Vercel KV / Blob 适配判断

### 6.1 Postgres

适合做主事实源。

原因：

- 项目、节点、边、版本、任务、approval 之间关系强。
- 需要事务保证 approval 和 action execution 的一致性。
- JSONB 适合保存 evolving artifact schema。
- 可做唯一约束、状态机约束、审计查询。

建议：正式后端以 Postgres 为核心。

### 6.2 Supabase

适合 AD Studio 当前阶段。

优点：

- 托管 Postgres + JSONB + RLS。
- Supabase Storage 可存上传素材和生成结果。
- Realtime 可用于任务状态、canvas 更新和协作基础。
- Edge Functions/Cron 可承担轻量任务轮询。

风险：

- RLS 策略需要认真设计，否则团队项目和资产库权限容易错。
- 大文件、视频下载链路要规划 CDN、签名 URL 和过期策略。
- 如果部署主站在 Vercel，Supabase 与 Vercel Blob 二选一时要避免资产分散。

建议：如果团队没有已有后端，Supabase 是首选。

### 6.3 文件存储

适合 MVP 和开发期，不适合生产主存储。

可用范围：

- `.next/cache` 本地项目 JSON。
- 本地 JSONL event log。
- demo seed data。

不适合：

- 多用户生产。
- 并发写入。
- 审计权限。
- 云部署持久化，Vercel serverless 文件系统不可作为长期存储。

### 6.4 Vercel KV

不适合做 AD Studio Agent 的事实源。

适合：

- 短期 task polling cursor。
- 幂等锁。
- stream resume token。
- rate limit / debouncing。
- provider webhook 临时去重。

不适合：

- Artifact 全文。
- Canvas graph。
- Approval record。
- Generation task 主表。
- EventLog 审计。

### 6.5 Vercel Blob / Supabase Storage

适合媒体资产和大文件。

应存：

- 用户上传图片/视频。
- 产品图、icon、UI 截图。
- 生成图片/视频/audio。
- 视频 keyframes、缩略图、QA 抽帧。

不应存：

- approval 状态。
- canvas graph。
- generation task 状态。
- event log。

推荐：

- 如果正式后端选 Supabase，优先 Supabase Storage，减少权限体系分裂。
- 如果主部署和资产分发强依赖 Vercel，可选 Vercel Blob，但仍用 Postgres 保存 asset metadata。

---

## 7. 阶段迁移路径、风险和验收标准

### Stage 0：当前状态冻结

目标：承认当前 localStorage / `.next/cache` 只是开发期持久化。

动作：

- 不扩大组件内 localStorage 使用范围。
- 不把 artifacts 继续塞进 message body。
- 不让 generation task 只存在前端 history。

风险：

- 继续堆功能会造成后续迁移困难。

验收：

- 新增功能设计都先定义 store interface。
- 文档明确哪些数据是事实源，哪些只是 UI cache。

### Stage 1：无后端 MVP Store Adapter

目标：在不引入数据库的情况下，把持久化边界统一起来。

动作：

- 新增 `agent-runtime/persistence` store interface。
- 用 project JSON 实现 `ArtifactStore`、`ApprovalStore`、`CanvasStore`、`GenerationTaskStore`、`EventLogStore`。
- 当前 localStorage 继续作为浏览器 cache。

风险：

- JSON 文件并发写覆盖。
- schema 变化需要迁移脚本。

验收：

- 刷新后 artifact、approval、canvas、task、event 都可恢复。
- approval 未确认时 generation tool 必须 blocker。
- event log 可重放出最近一次关键状态变化。

### Stage 2：Artifacts + Approval 进 Postgres

目标：先把最关键的 Agent 事实源迁出前端。

动作：

- 建 `agent_artifacts` 和 `approval_requests`。
- `saveArtifact`、`requestApproval`、`respondApproval` 改走后端。
- Agent snapshot 带 artifact summary 和 pending approval。

风险：

- artifact schema 过大导致模型输入膨胀。
- approval 与 action execution 状态不一致。

验收：

- 已确认 artifact 刷新/跨设备不丢。
- approval record 能追溯请求、响应、执行状态。
- 未 approved 的高成本动作无法执行。

### Stage 3：Canvas Graph + EventLog 进 Postgres

目标：画布成为生产事实源。

动作：

- 建 `canvas_nodes`、`canvas_edges`、`canvas_node_versions`、`agent_events`。
- Canvas reducer 变成前端 optimistic view，后端 action validator 是最终边界。
- 每次 canvas mutation append event。

风险：

- 前端乐观更新与后端拒绝产生冲突。
- 节点版本和 artifact/task 引用混乱。

验收：

- nodeId 不存在、locked node 修改、循环引用会被后端拒绝。
- 节点版本能追溯到 artifact/task/approval。
- EventLog 能回答“谁改了什么、为什么改、影响哪些下游”。

### Stage 4：GenerationTask + Asset Storage 进后端

目标：长任务可靠恢复。

动作：

- 建 `generation_tasks` 和 `assets`。
- 上传素材进入对象存储，前端只拿 asset id/url。
- provider polling/webhook 更新任务表。
- 成功后写 canvas node version。

风险：

- provider 回调重复或乱序。
- 任务成功但资产下载/转存失败。
- 成本与实际 provider 账单对不上。

验收：

- 刷新/重开页面后 running task 仍能继续显示状态。
- 重复 webhook 不会重复生成 node version。
- 失败任务保留 error、prompt、params、slots，repair 可引用。
- output asset 可长期访问或按权限签名访问。

### Stage 5：Realtime / Collaboration / Queue

目标：支持团队协作和更可靠的后台执行。

动作：

- Realtime 订阅 task/canvas/event。
- 加 project membership 和 RLS。
- 引入 queue 或 scheduled polling worker。
- 加短期 KV lock/idempotency。

风险：

- 权限设计复杂。
- 并发 canvas action 冲突。
- 实时事件过多导致 UI 抖动。

验收：

- 两个客户端看到一致 task/canvas 状态。
- 无权限用户不能读取项目资产和 event log。
- 同一 approval 不会被重复执行。

---

## 8. 推荐实施顺序

短期不要直接“大上后端”。更稳的顺序：

1. 先定义 store interface 和对象边界。
2. 无后端 MVP 用 project JSON 实现这些 store。
3. Artifacts 和 Approval 先迁 Postgres。
4. Canvas graph 和 EventLog 再迁 Postgres。
5. GenerationTask 和 asset storage 最后打通 provider polling、node version 写回。
6. Realtime、队列、协作在真实多人需求出现后再加。

最小接口建议：

```text
AgentProjectStore
- loadProject(projectId)
- saveProjectPatch(projectId, patch)

ArtifactStore
- createArtifact(input)
- updateArtifactStatus(id, status)
- listArtifactSummaries(projectId)
- getArtifact(id)

ApprovalStore
- requestApproval(input)
- respondApproval(id, decision)
- getPendingApproval(projectId)

CanvasStore
- applyCanvasActions(projectId, actions, context)
- getCanvasSnapshot(projectId)

GenerationTaskStore
- createTask(input)
- updateTaskStatus(providerTaskId, patch)
- listProjectTasks(projectId)

EventLogStore
- append(event)
- listRecent(projectId, limit)
```

---

## 9. 建议更新飞书文档

以下建议都按“章节替换/插入”设计，避免在文档末尾追加长内容。

### 9.1 替换章节：`6.2 建议新增目录`

替换原因：

当前目录建议已有 `persistence/`，但没有明确后端 store adapter、任务持久化、事件日志、对象存储边界。建议把 persistence 从泛化目录升级为可执行分层。

建议替换文本：

````markdown
### 6.2 建议新增目录

```text
src/features/agent-runtime/
  artifacts/
    schemas.ts
    artifact-summary.ts
  ai-sdk/
    ad-studio-agent.ts
    model-config.ts
    output.ts
    tools.ts
    tool-results.ts
  playbooks/
    clone-ad.ts
    create-ad.ts
    quick-generation.ts
    repair.ts
  guards/
    preconditions.ts
    permissions.ts
    blockers.ts
  persistence/
    stores.ts
    local-project-store.ts
    artifact-store.ts
    approval-store.ts
    canvas-store.ts
    generation-task-store.ts
    event-log-store.ts
  prompts/
    ad-studio-agent-instructions.ts
    knowledge-index.ts
```

说明：

- `artifacts` 保存 RH-like 产物，但用 Zod 强 schema。
- `ai-sdk` 封装 Vercel AI SDK。
- `playbooks` 是推荐路线，不是强状态机。
- `guards` 负责硬边界。
- `persistence` 负责 store adapter。无后端 MVP 可先写 local/project JSON；正式后端迁移到 Postgres、对象存储和任务表。
- `prompts` 负责可加载知识和 Agent 指令。
````

### 9.2 替换章节：`6.4 第二阶段：Artifacts 硬协议`

替换原因：

原文说“先存在 `AgentRuntimeState` 或 `AgentSession.canvasState` 中”，容易让 artifact 继续耦合在前端状态里。建议改成“前端只做缓存，项目级 artifact store 是边界”，并明确 DB 迁移方向。

建议替换文本：

````markdown
### 6.4 第二阶段：Artifacts 硬协议

目标：

- 不再只靠 messages 保存策略、脚本、分镜。
- 引入 `AgentArtifacts`，并通过 `ArtifactStore` 保存。
- 前端 `AgentRuntimeState` 只保留当前 UI 运行状态和 artifact summary，不作为长期事实源。

建议类型：

```typescript
type AgentArtifacts = {
  intentBrief?: IntentBrief;
  referenceAnalyses: Record<string, ReferenceAnalysis>;
  creativePlans: Record<string, CreativePlan>;
  anchorRegistry?: AnchorRegistry;
  scriptDocs: Record<string, ScriptDoc>;
  clipTables: Record<string, ClipTable>;
  promptPacks: Record<string, PromptPack>;
  workflowPlans: Record<string, WorkflowPlan>;
  repairPlans: Record<string, RepairPlan>;
};
```

落地方式：

- 无后端 MVP：写入项目级 JSON store，前端 localStorage 只做缓存。
- 正式后端：写入 Postgres `agent_artifacts`，`body jsonb` 保存全文，`summary jsonb` 用于 Agent snapshot。
- 每个 artifact 必须有 `id`、`artifactType`、`version`、`status`、`schemaVersion`、`linkedNodeIds`。
- 用户确认过的 artifact 不允许静默覆盖，必须新建 version。

验收标准：

- 用户确认过的脚本不会因上下文压缩或刷新页面丢失。
- 画布节点能关联到 artifact id。
- prompt pack 能追溯到 script、clip table 和 anchors。
- Agent 每轮输入默认只带 artifact summary，必要时按需加载全文。
````

### 9.3 替换章节：`6.6 第四阶段：Approval Flow`

替换原因：

原文的 `AgentApprovalRequest` 结构方向正确，但需要明确它是 durable record，不再只是 UI pending confirmation，并补充执行状态、幂等和 EventLog。

建议替换文本：

````markdown
### 6.6 第四阶段：Approval Flow

目标：

- 统一所有高风险动作的确认机制。
- 从现有 `PendingAgentConfirmation` 升级为 durable `ApprovalRequest`。
- approval 是成本、品牌资产和不可逆动作的后端事实源。

建议结构：

```typescript
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
  status: "pending" | "approved" | "rejected" | "expired" | "executed" | "cancelled";
  idempotencyKey: string;
  requestedAt: string;
  respondedAt?: string;
  executedAt?: string;
};
```

规则：

- 所有消耗 credits 的动作必须携带 approved approval id。
- approve 只代表用户允许执行，不代表动作已经成功；执行结果必须写 event log。
- 拒绝后 Agent 需要保留 request record，并继续提出调整方案。
- locked anchor 修改必须走独立 approval。

验收标准：

- 所有生成动作都有 approval record。
- 刷新后 pending approval 不丢失。
- 拒绝后 Agent 能继续给调整方案。
- 批量动作执行后有 action trace 和 event log。
````

### 9.4 插入章节：`6.7 后新增：后端与持久化阶段`

替换原因：

当前路线图从 Artifacts、Tools、Approval 直接走 Streaming 和 ToolLoopAgent，但缺少后端事实源迁移阶段。建议在 Streaming 前插入，避免 UI stream 先行导致状态继续散落前端。

建议替换文本：

````markdown
### 6.7 后端与持久化阶段

目标：

- 明确哪些状态只是前端缓存，哪些必须成为后端事实源。
- 让 Agent artifacts、approval、canvas、generation task、event log 可以刷新恢复、跨端恢复和审计。

推荐路径：

1. 无后端 MVP：保留 localStorage 和 `.next/cache` 本地 JSON，但新增 store adapter。
2. Artifacts + Approval 先迁入 Postgres。
3. Canvas graph + EventLog 迁入 Postgres。
4. GenerationTask + assets 接入对象存储和后台轮询。
5. Realtime、队列、团队协作后置。

存储建议：

- Postgres / Supabase：项目、会话、artifact、approval、canvas graph、generation task、event log 的事实源。
- Supabase Storage 或 Vercel Blob：上传素材、生成图片/视频、缩略图、抽帧。
- Vercel KV：只做短期锁、轮询游标、stream resume、幂等去重，不做事实源。
- localStorage：只做 UI cache 和单人 Demo 恢复，不承载生产事实。

验收标准：

- 已确认 artifact、pending approval、running generation task 刷新后不丢。
- 所有高成本动作可以追溯 approval id。
- generation task 成功后能写回 canvas node version。
- event log 能回答“谁在什么时候用哪个工具改了什么，以及影响了哪些节点”。
````

### 9.5 替换章节：`6.10 开发里程碑`

替换原因：

当前里程碑里 Milestone 2 是 Artifacts，Milestone 5 是 Generation Tools，但没有独立持久化验收。建议加入 `Milestone 2.5` 和 `Milestone 5.5`，不打乱已有并行线程。

建议替换文本：

````markdown
#### Milestone 2.5：Persistence MVP

交付物：

- 新增 store adapter：ArtifactStore、ApprovalStore、CanvasStore、GenerationTaskStore、EventLogStore。
- 无后端阶段先写项目级 JSON，本地 localStorage 仅做缓存。
- Agent snapshot 能从 store 汇总 artifact summary、pending approval、canvas snapshot、running tasks。

验收：

- 刷新后关键 artifact 不丢。
- pending approval 刷新后仍可继续响应。
- event log 至少记录 artifact saved、approval requested/responded、canvas action proposed/executed、generation queued/status changed。

#### Milestone 5.5：Generation Persistence

交付物：

- GenerationTask 从前端 history 升级为项目级任务事实源。
- providerTaskId、status、credits、output asset、nodeVersionId 可追溯。
- 后端负责轮询或接收 provider 状态更新。

验收：

- running task 刷新后能继续恢复。
- provider 重复回调不会重复写 node version。
- generation succeeded 后写回 canvas node version。
- generation failed 后保留 error、prompt、params、slots，repair plan 可引用。
````

### 9.6 替换章节：`6.12 风险与对策`

替换原因：

当前风险表已有“上下文膨胀、生成成本失控、过度信任模型”，但缺少持久化相关风险。建议增加以下条目到风险表。

建议替换文本：

````markdown
| 风险 | 说明 | 对策 |
| --- | --- | --- |
| localStorage 被当成事实源 | 刷新/跨端/清缓存/多 tab 会导致关键状态丢失或覆盖 | localStorage 只做 UI cache；artifact、approval、task、event 进入 store adapter |
| approval 不可审计 | 高成本动作执行后无法证明用户确认了什么 | durable ApprovalRequest + EventLog；执行工具必须携带 approval id |
| generation task 与 canvas 脱节 | provider 成功但节点版本未更新，或前端 history 与画布不一致 | GenerationTask 后端表作为事实源；成功后事务化写 node version |
| 上传资产不可恢复 | blob URL 刷新后失效，后续 Agent 无法引用原素材 | 上传素材进入对象存储；前端只保存 asset id 和签名/公开 URL |
| 事件不可追溯 | repair、stale、工具失败无法复盘 | append-only EventLog，记录 tool、approval、canvas、task 状态变化 |
````
