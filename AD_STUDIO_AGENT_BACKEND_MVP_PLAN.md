# AD Studio Agent 后端事实源 MVP 方案

日期：2026-05-21  
状态：架构设计稿  
范围：AD Studio Agent 后端事实源、项目级存储边界、最小 API、数据库表结构草案、迁移计划  
非范围：本轮不接真实 Supabase/数据库，不调用 `/api/vidu/generate`，不修改 M3.2 UI，不改画布执行逻辑，不接真实生成

---

## 0. 阅读基线与设计立场

本方案建立在现有 M1-M3.2 基础上，不从零重写：

- 飞书长期方案要求的术语规则：中文名优先，英文/代码名放在括号里，并解释业务含义。
- 本地工作上下文：`AD_STUDIO_AGENT_WORKING_CONTEXT.md`。
- 本地长期路线图：`AD_STUDIO_AGENT_AI_SDK_ROADMAP.md`，重点采用 0.1、3.3、3.4、5.4、6.4、6.5、6.7、6.11、6.13。
- 已有持久化设计：`AD_STUDIO_AGENT_BACKEND_PERSISTENCE_DESIGN.md`。
- 当前产物设计：`AD_STUDIO_AGENT_ARTIFACTS_SCHEMA_DESIGN.md`。
- 当前代码事实：`AgentArtifacts` 已有 schema、summary snapshot、workspace-backed `ArtifactStore`；M3/M3.1 已有 guarded proposal tools 和安全 golden path；M3.2 正在补交互 intake cards。

飞书 wiki 直接静态读取会进入登录页，本设计以本地已同步的长期路线图和 working context 中记录的飞书章节为准。

核心立场：

```text
硬事实进后端，软计划可在前端短期缓存。
```

后端事实源 MVP 的目标不是马上接入 Supabase，也不是重写前端工作台，而是把当前 `localStorage`、`/api/agent/workspace`、`.next/cache` JSON 和 workspace adapter 收束到同一套可替换的 store contract。这样 M4 接 Canvas Tools 和 durable approval 时，不会继续把关键状态散落在 React state 或临时 JSON 里。

---

## 1. 术语与业务含义

| 中文名 | 英文/代码名 | 业务含义 |
| --- | --- | --- |
| 后端事实源 | Backend Fact Source | 系统认可的长期可信数据来源。刷新、跨端、重试和审计都应以它为准。 |
| 前端缓存 | Frontend Cache | 为 UI 交互和单人本地恢复服务的副本，不能作为生产事实。 |
| 项目 | `Project` | 一次广告生产工作的顶层容器，包含会话、产物、画布、素材、生成任务和事件。 |
| Agent 会话 | `Session` / `AgentSession` | 用户和 Agent 在某个项目中的一段交互上下文，承载模式、产品、目标、上传素材和运行阶段。 |
| Agent 产物包 | `AgentArtifacts` | 广告生产中间产物集合，例如竞品解析、创意方案、锚点登记表、脚本、分镜表、提示词包和返工方案。 |
| 执行确认单 | `ApprovalRequest` | 用户对高风险或扣费动作的确认记录。它要能证明用户确认了什么、何时确认、确认后执行了什么。 |
| 画布图 | `CanvasGraph` | 可恢复的画布事实，由节点、连线、节点版本组成。它是画布状态的后端存储模型。 |
| 画布快照 | `CanvasSnapshot` | 给 Agent 决策读取的简化视图，由 `CanvasGraph` 派生，不是主存储模型。 |
| 生成任务 | `GenerationTask` | 图片、视频、音频或文本生成的长任务事实，连接 provider task、approval、artifact、canvas version 和输出资产。 |
| 上传素材 | `UploadedAsset` | 用户上传的原始产品包、竞品素材或参考素材。早期可能只有文件名和 blob URL，生产必须进入对象存储。 |
| 媒体资产 | `MediaAsset` | 已持久化的图片、视频、音频、缩略图或抽帧，可能来自上传，也可能来自生成任务。 |
| 事件流水 | `EventLog` | append-only 的审计与恢复轨迹，用于回答“谁在什么时候用哪个工具改了什么”。 |
| 存储适配器 | Store Adapter | 屏蔽底层存储的接口层。MVP 可以写 JSON，生产可以换 Postgres/Supabase。 |
| 幂等键 | `idempotencyKey` | 防止重复执行同一个高成本动作的唯一键。 |
| 动作哈希 | `actionHash` | 对确认时的动作内容做稳定摘要，防止确认后被静默替换。 |

---

## 2. 当前实现边界

### 2.1 已有能力

- AI SDK 结构化输出（Structured Output）已接入 `/api/agent/decide`，对外仍受 `LlmAgentOutput` 约束。
- Agent 产物包（`AgentArtifacts`）已包含 `ReferenceAnalysis`、`CreativePlan`、`AnchorRegistry`、`ScriptDoc`、`ClipTable`、`PromptPack`、`WorkflowPlan`、`RepairPlan`。
- Agent 输入快照（`AgentInputSnapshot`）已包含 `artifacts: AgentArtifactSnapshot`，只传 summary。
- `ArtifactStore` 已有 memory、本地 localStorage、workspace-backed adapter。
- 工作区存储（workspace store）已把 `StoredAgentWorkspace.artifacts` 和 `StoredAgentWorkspace.eventLog` 写入 `ad-studio:agent-workspace:v2`、`/api/agent/workspace` 和 `.next/cache/ad-studio-agent-workspace.json`。
- M3 guarded proposal tools 已有 `askUser`、`saveArtifact`、`proposeActionBatch`、`inspectCanvas`，但不执行真实画布动作或扣费生成。

### 2.2 缺口

- 项目（`Project`）仍近似等于 session id，没有独立项目表或 store root。
- 执行确认单（`ApprovalRequest`）仍主要存在于 `PendingAgentConfirmation` 运行态和 confirmation event 里，没有 durable record。
- 画布图（`CanvasGraph`）仍主要由前端 canvas localStorage 承担，`CanvasSnapshot` 只是 Agent 输入视图。
- 生成任务（`GenerationTask`）仍分散在 generation history、Vidu history JSON 和节点 version 字段里。
- 上传素材（`UploadedAsset`）和媒体资产（`MediaAsset`）没有统一持久化边界，blob URL 刷新后不可恢复。
- 事件流水（`EventLog`）当前只覆盖 artifact save/load/restore failure，不足以审计 approval、tool、canvas、task、asset。

---

## 3. 后端事实源 MVP 总体架构

推荐先做一层项目级事实源接口（`AgentProjectStore`），底层仍可写本地 JSON。正式后端只替换 adapter，不替换 Agent/Canvas/Approval 的业务 contract。

```text
Frontend
  - React UI
  - localStorage UI cache
  - M3.2 intake cards

Next.js API Routes
  - project store facade
  - artifact store adapter
  - approval store adapter
  - canvas graph store adapter
  - generation task store adapter
  - asset store adapter
  - event log append

No-backend MVP Storage
  - ad-studio:agent-workspace:v2
  - /api/agent/workspace
  - .next/cache/ad-studio-agent-workspace.json
  - optional .next/cache/ad-studio-agent-projects/{projectId}.json

Production Storage Later
  - Postgres/Supabase for facts
  - object storage for media
  - queue/realtime for long tasks and collaboration
```

### 3.1 分层原则

| 层 | 负责什么 | 不负责什么 |
| --- | --- | --- |
| 前端 UI | 展示、输入、乐观缓存、M3.2 cards | 不作为 approval、task、asset 的生产事实源 |
| Store adapter | 读写项目事实、封装 JSON 或数据库 | 不直接调用模型或 provider |
| Guarded tools | 校验权限、前置条件、approval、nodeId、lock | 不绕过 store 直接改 React state |
| Provider adapter | 创建 provider task、查询状态、处理错误 | 不决定用户是否已确认 |
| EventLog | 记录发生过什么 | 不替代业务表当前状态 |

### 3.2 最小一致性规则

- 所有写入都必须带 `projectId`，可选带 `sessionId`。
- 所有高成本动作必须带 `approvalRequestId`、`actionHash`、`idempotencyKey`。
- `CanvasSnapshot` 必须由 `CanvasGraph` 派生，不能反向当作完整事实写回。
- `AgentArtifacts` 已确认版本不允许静默覆盖，必须新建 version，并用 `supersedesArtifactId` / `supersededByArtifactId` 表达版本替代关系。
- `GenerationTask.succeeded` 后必须能追溯到 `MediaAsset` 和可选 `CanvasNodeVersion`。
- `UploadedAsset` 如果只有 blob URL，只能是前端临时缓存；进入生产事实源时必须有 asset record。
- `EventLog` append-only，业务表保存当前状态，事件流水保存变化原因。

---

## 4. 推荐数据模型

本节同时给出数据库表结构草案和 TypeScript interface。MVP 可以先按这些 interface 写 JSON；Postgres/Supabase 阶段再映射成表。

### 4.1 项目（`Project`）与 Agent 会话（`Session`）

业务含义：项目是广告生产事实的顶层容器；会话是用户和 Agent 的交互上下文。当前可以继续让 `projectId = sessionId`，但接口要预留未来一个项目多会话。

推荐表：

```sql
projects
- id text primary key
- owner_user_id text null
- title text not null
- product_name text null
- mode text not null
- lifecycle text not null
- schema_version int not null
- archived_at timestamptz null
- created_at timestamptz not null
- updated_at timestamptz not null

agent_sessions
- id text primary key
- project_id text not null references projects(id)
- mode text not null
- lifecycle text not null
- current_step_index int not null
- locked boolean not null
- brief jsonb not null
- runtime_summary jsonb null
- created_at timestamptz not null
- updated_at timestamptz not null
```

TypeScript 草案：

```ts
export type AgentProjectRecord = {
  schemaVersion: 1;
  id: string;
  title: string;
  productName?: string;
  mode: "clone" | "create";
  lifecycle: "empty" | "intake" | "ready" | "producing" | "paused" | "archived";
  activeSessionId?: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentSessionRecordV2 = {
  schemaVersion: 1;
  id: string;
  projectId: string;
  session: AgentSession;
  runtimeSummary?: {
    stage: string;
    messageCount: number;
    pendingApprovalId?: string;
    artifactSummaryCount: number;
  };
  createdAt: string;
  updatedAt: string;
};
```

MVP 落点：

- 继续兼容 `StoredAgentWorkspace.sessions`。
- 新增 project envelope 时不要破坏现有 `AgentSessionRecord`。
- `getAgentWorkspaceProjectId(sessionId)` 仍可返回 `sessionId`，但 store interface 不再把项目和会话概念混为一个对象。

### 4.2 Agent 产物包（`AgentArtifacts`）

业务含义：保存广告生产中间产物，避免策略、脚本、分镜和提示词只存在 messages 或画布节点里。

推荐表：

```sql
agent_artifacts
- id text primary key
- project_id text not null references projects(id)
- session_id text null references agent_sessions(id)
- artifact_type text not null
- artifact_key text not null
- status text not null
- source text not null
- version int not null
- schema_version int not null
- body jsonb not null
- summary jsonb not null
- evidence_refs jsonb not null
- linked_node_ids text[] not null default '{}'
- linked_task_ids text[] not null default '{}'
- source_message_id text null
- source_tool_call_id text null
- supersedes_artifact_id text null
- created_by text null
- created_at timestamptz not null
- updated_at timestamptz not null

unique(project_id, artifact_key, version)
```

TypeScript 草案：

```ts
export type AgentArtifactRecord = {
  schemaVersion: 1;
  id: string;
  projectId: string;
  sessionId?: string;
  artifactType:
    | "referenceAnalysis"
    | "creativePlan"
    | "anchorRegistry"
    | "scriptDoc"
    | "clipTable"
    | "promptPack"
    | "workflowPlan"
    | "repairPlan";
  artifactKey: string;
  status: "draft" | "pending_user" | "confirmed" | "rejected" | "stale" | "needs_repair";
  source: "fact" | "model_suggestion" | "user_confirmation" | "mixed";
  version: number;
  body: unknown;
  summary: ArtifactSummary;
  evidenceRefs: Array<{ kind: string; id: string; note?: string }>;
  linkedNodeIds: string[];
  linkedTaskIds: string[];
  sourceMessageId?: string;
  sourceToolCallId?: string;
  supersedesArtifactId?: string;
  createdAt: string;
  updatedAt: string;
};
```

规则：

- 当前 `AgentArtifacts` 聚合对象可继续作为 runtime shape。
- 后端事实源建议拆成 versioned artifact records，避免一个聚合对象被覆盖。
- Artifact 状态名必须和现有 `artifactStatusSchema` 保持一致：`draft`、`pending_user`、`confirmed`、`rejected`、`stale`、`needs_repair`。不要在后端另造 `proposed` / `approved` / `superseded` 这套同义状态。
- 如果需要表达“被新版本替代”，使用 `supersedesArtifactId` 或后续补 `supersededByArtifactId`，不要改变 artifact 的业务确认状态。
- Snapshot 仍只传 `summary`，完整 `body` 按 id 读取。

### 4.3 执行确认单（`ApprovalRequest`）

业务含义：记录用户确认过什么动作，尤其是扣费生成、locked anchor 修改、节点覆盖和最终导出。

推荐表：

```sql
approval_requests
- id text primary key
- project_id text not null references projects(id)
- session_id text null references agent_sessions(id)
- kind text not null
- title text not null
- summary text not null
- status text not null
- requested_actions jsonb not null
- action_hash text not null
- idempotency_key text not null
- affected_node_ids text[] not null default '{}'
- affected_artifact_ids text[] not null default '{}'
- estimated_credits numeric null
- actual_credits numeric null
- estimated_time_ms int null
- expires_at timestamptz null
- requested_by text null
- responded_by text null
- requested_at timestamptz not null
- responded_at timestamptz null
- executed_at timestamptz null
- execution_result jsonb null

unique(project_id, idempotency_key)
```

TypeScript 草案：

```ts
export type ApprovalRequestRecord = {
  schemaVersion: 1;
  id: string;
  projectId: string;
  sessionId?: string;
  kind:
    | "action_batch"
    | "generation"
    | "node_overwrite"
    | "locked_anchor_change"
    | "repair_plan"
    | "export";
  title: string;
  summary: string;
  status:
    | "pending"
    | "approved"
    | "rejected"
    | "expired"
    | "executing"
    | "executed"
    | "execution_failed"
    | "cancelled";
  requestedActions: CanvasRuntimeAction[];
  actionHash: string;
  idempotencyKey: string;
  affectedNodeIds: string[];
  affectedArtifactIds: string[];
  estimatedCredits?: number;
  actualCredits?: number;
  expiresAt?: string;
  requestedAt: string;
  respondedAt?: string;
  executedAt?: string;
  executionResult?: {
    ok: boolean;
    eventIds: string[];
    taskIds?: string[];
    nodeVersionIds?: string[];
    error?: string;
  };
};
```

规则：

- `approved` 只代表用户允许执行，不代表执行成功。
- 执行时必须重新计算 `actionHash`，和确认时一致才允许执行。
- 扣费动作必须先查 `idempotencyKey`，重复请求返回既有结果，不重复扣费。
- `executing`、`executed`、`execution_failed` 负责表达执行生命周期，避免把“用户已确认”和“动作已成功”混为一件事。
- rejected/cancelled/expired/execution_failed 也要保留记录，并写事件流水。

### 4.4 画布图（`CanvasGraph`）与画布快照（`CanvasSnapshot`）

业务含义：画布图是可恢复的生产状态；画布快照是给 Agent 读取的摘要视图。

推荐表：

```sql
canvas_nodes
- id text primary key
- project_id text not null references projects(id)
- kind text not null
- business_type text not null
- title text not null
- status text not null
- locked boolean not null
- group_key text not null
- position jsonb not null
- parent_node_ids text[] not null default '{}'
- primary_version_id text null
- settings jsonb null
- stale_reason text null
- source_artifact_id text null
- created_at timestamptz not null
- updated_at timestamptz not null

canvas_edges
- id text primary key
- project_id text not null references projects(id)
- source_node_id text not null
- target_node_id text not null
- label text null
- role text null
- created_at timestamptz not null

canvas_node_versions
- id text primary key
- project_id text not null references projects(id)
- node_id text not null references canvas_nodes(id)
- version int not null
- label text not null
- content text null
- model text null
- provider text null
- provider_task_id text null
- media_asset_id text null
- asset_url text null
- download_url text null
- params jsonb null
- slots jsonb null
- cost_credits numeric null
- duration_ms int null
- source_artifact_id text null
- source_task_id text null
- created_at timestamptz not null

unique(node_id, version)
```

TypeScript 草案：

```ts
export type CanvasGraphRecord = {
  schemaVersion: 1;
  projectId: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  updatedAt: string;
};

export type CanvasSnapshotRecord = CanvasSnapshot & {
  schemaVersion: 1;
  projectId: string;
  derivedFromGraphVersion: string;
  createdAt: string;
};
```

规则：

- Agent 不能提交虚构 `nodeId`。工具只能接受 `CanvasSnapshot` 中存在的 id，或使用 `createNode` 返回的新 id。
- `CanvasSnapshot` 不保存完整 versions、settings、position 细节，不能当作画布恢复源。
- 下游 stale 标记应由 deterministic reducer/tool 根据 edge 和 `parentNodeIds` 更新。

### 4.5 生成任务（`GenerationTask`）

业务含义：长任务事实源，连接 approval、provider、artifact、canvas version、输出 asset 和成本。

推荐表：

```sql
generation_tasks
- id text primary key
- project_id text not null references projects(id)
- session_id text null references agent_sessions(id)
- node_id text null
- node_version_id text null
- artifact_id text null
- approval_request_id text null references approval_requests(id)
- kind text not null
- surface text not null
- provider text not null
- provider_task_id text null
- model_id text not null
- model_name text not null
- mode_key text not null
- prompt text not null
- params jsonb not null
- slots jsonb not null
- status text not null
- progress int not null
- credits numeric not null
- cost_usd numeric null
- output_asset_id text null
- output jsonb null
- error_code text null
- error_message text null
- idempotency_key text not null
- created_at timestamptz not null
- started_at timestamptz null
- completed_at timestamptz null
- updated_at timestamptz not null

unique(provider, provider_task_id)
unique(project_id, idempotency_key)
```

TypeScript 草案：

```ts
export type GenerationTaskRecord = {
  schemaVersion: 1;
  id: string;
  projectId: string;
  sessionId?: string;
  nodeId?: string;
  nodeVersionId?: string;
  artifactId?: string;
  approvalRequestId?: string;
  kind: "image" | "video" | "audio" | "text";
  surface: "standalone" | "canvas" | "agent";
  provider: string;
  providerTaskId?: string;
  modelId: string;
  modelName: string;
  modeKey: string;
  prompt: string;
  params: Record<string, string | number | boolean>;
  slots: GenerationSlotInput[];
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  progress: number;
  credits: number;
  outputAssetId?: string;
  output?: {
    kind: "image" | "video" | "audio" | "text";
    title: string;
    assetUrl?: string;
    downloadUrl?: string;
    ratio?: string;
  };
  errorCode?: string;
  errorMessage?: string;
  idempotencyKey: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
};
```

规则：

- M4 前不要调用真实 `/api/vidu/generate`，但应先把 task record contract 固定。
- 任务状态更新必须 append event。
- 成功后写入 `MediaAsset`，再写可选 `CanvasNodeVersion`。
- 失败要保留 prompt、params、slots，便于 repair。

### 4.6 上传素材（`UploadedAsset`）与媒体资产（`MediaAsset`）

业务含义：上传素材是用户提供的源材料；媒体资产是可长期引用的文件对象。生产阶段不能依赖 blob URL。

推荐表：

```sql
media_assets
- id text primary key
- project_id text not null references projects(id)
- session_id text null references agent_sessions(id)
- kind text not null
- role text not null
- source text not null
- original_file_name text null
- mime_type text null
- byte_size bigint null
- width int null
- height int null
- duration_ms int null
- storage_provider text null
- storage_key text null
- public_url text null
- signed_url_expires_at timestamptz null
- thumbnail_asset_id text null
- analysis jsonb null
- analysis_status text null
- created_at timestamptz not null
- updated_at timestamptz not null
```

TypeScript 草案：

```ts
export type MediaAssetRecord = {
  schemaVersion: 1;
  id: string;
  projectId: string;
  sessionId?: string;
  kind: "product" | "image" | "video" | "audio" | "file" | "thumbnail" | "keyframe";
  role:
    | "product_pack"
    | "competitor_asset"
    | "reference_asset"
    | "generated_output"
    | "storyboard_frame"
    | "canvas_version_asset";
  source: "upload" | "generation" | "mock" | "external_url";
  originalFileName?: string;
  mimeType?: string;
  byteSize?: number;
  width?: number;
  height?: number;
  durationMs?: number;
  storage?: {
    provider: "local_json" | "supabase_storage" | "vercel_blob" | "external";
    key?: string;
    publicUrl?: string;
    signedUrlExpiresAt?: string;
  };
  analysisStatus?: "idle" | "running" | "succeeded" | "failed";
  analysis?: AgentMediaAnalysis;
  createdAt: string;
  updatedAt: string;
};
```

MVP 映射：

- 现有 `AgentUploadedAsset` 可作为 UI 输入对象继续存在。
- 写入事实源时生成 `MediaAssetRecord`。
- 如果当前只有 blob URL，`storage.provider = "local_json"`，并标记 `recoverable = false` 或在 event 中记录 `asset.not_persisted`。
- 对象存储阶段再替换为 Supabase Storage 或 Vercel Blob。

### 4.7 事件流水（`EventLog`）

业务含义：append-only 审计与恢复轨迹，不等同于 chat message。

推荐表：

```sql
agent_events
- id text primary key
- project_id text not null references projects(id)
- session_id text null references agent_sessions(id)
- sequence bigint not null
- actor_type text not null
- actor_id text null
- event_type text not null
- object_type text null
- object_id text null
- correlation_id text null
- request_id text null
- payload jsonb not null
- created_at timestamptz not null

unique(project_id, sequence)
```

TypeScript 草案：

```ts
export type AgentEventLogRecord = {
  schemaVersion: 1;
  id: string;
  projectId: string;
  sessionId?: string;
  sequence: number;
  actorType: "user" | "agent" | "system" | "tool" | "provider";
  actorId?: string;
  eventType:
    | "message.created"
    | "artifact.created"
    | "artifact.versioned"
    | "artifact.status_changed"
    | "approval.requested"
    | "approval.approved"
    | "approval.rejected"
    | "approval.executed"
    | "tool.called"
    | "tool.blocked"
    | "canvas.node.created"
    | "canvas.node.updated"
    | "canvas.node.locked"
    | "canvas.downstream_stale_marked"
    | "generation.queued"
    | "generation.provider_task_created"
    | "generation.status_changed"
    | "generation.succeeded"
    | "generation.failed"
    | "asset.uploaded"
    | "asset.persisted"
    | "asset.not_persisted"
    | "repair.proposed";
  objectType?: string;
  objectId?: string;
  correlationId?: string;
  requestId?: string;
  payload: Record<string, unknown>;
  createdAt: string;
};
```

规则：

- 事件流水只追加，不覆盖。
- MVP 可以限制最近 200 或 1000 条，但要明确这是本地 MVP 限制。
- 任何 approval response、tool result、task status、canvas mutation 都要能查到对应 event。

---

## 5. Store Adapter Contract

推荐先新增接口草案，不替换现有实现。当前 `ArtifactStore` 已存在，后续新增 project-level facade。

```ts
export type AgentProjectStore = {
  loadProject(projectId: string): Promise<AgentProjectBundle | null>;
  saveProjectPatch(projectId: string, patch: AgentProjectPatch): Promise<AgentProjectBundle>;
  archiveProject(projectId: string): Promise<void>;
};

export type ArtifactRepository = {
  createArtifact(input: CreateArtifactInput): Promise<AgentArtifactRecord>;
  updateArtifactStatus(input: UpdateArtifactStatusInput): Promise<AgentArtifactRecord>;
  listArtifactSummaries(projectId: string): Promise<ArtifactSummary[]>;
  getArtifact(artifactId: string): Promise<AgentArtifactRecord | null>;
};

export type ApprovalRepository = {
  requestApproval(input: CreateApprovalRequestInput): Promise<ApprovalRequestRecord>;
  respondApproval(input: RespondApprovalInput): Promise<ApprovalRequestRecord>;
  getPendingApprovals(projectId: string): Promise<ApprovalRequestRecord[]>;
  markExecuted(input: MarkApprovalExecutedInput): Promise<ApprovalRequestRecord>;
};

export type CanvasGraphRepository = {
  getCanvasGraph(projectId: string): Promise<CanvasGraphRecord>;
  applyCanvasActions(input: ApplyCanvasActionsInput): Promise<CanvasGraphMutationResult>;
  getCanvasSnapshot(projectId: string): Promise<CanvasSnapshotRecord>;
};

export type GenerationTaskRepository = {
  createTask(input: CreateGenerationTaskInput): Promise<GenerationTaskRecord>;
  updateTaskStatus(input: UpdateGenerationTaskStatusInput): Promise<GenerationTaskRecord>;
  listProjectTasks(projectId: string): Promise<GenerationTaskRecord[]>;
};

export type MediaAssetRepository = {
  createAsset(input: CreateMediaAssetInput): Promise<MediaAssetRecord>;
  markPersisted(input: MarkMediaAssetPersistedInput): Promise<MediaAssetRecord>;
  getAsset(assetId: string): Promise<MediaAssetRecord | null>;
  listProjectAssets(projectId: string): Promise<MediaAssetRecord[]>;
};

export type EventLogRepository = {
  append(event: CreateAgentEventInput): Promise<AgentEventLogRecord>;
  listRecent(projectId: string, limit?: number): Promise<AgentEventLogRecord[]>;
};
```

No-backend MVP 的 `AgentProjectBundle` 可以是一个 JSON 文件：

```ts
export type AgentProjectBundle = {
  schemaVersion: 1;
  project: AgentProjectRecord;
  sessions: AgentSessionRecordV2[];
  artifacts: AgentArtifactRecord[];
  approvalRequests: ApprovalRequestRecord[];
  canvasGraph: CanvasGraphRecord;
  generationTasks: GenerationTaskRecord[];
  mediaAssets: MediaAssetRecord[];
  events: AgentEventLogRecord[];
  updatedAt: string;
};
```

---

## 6. 最小 API 路由设计

当前已有 `/api/agent/workspace` 可继续保留，新增 API 先作为 facade 草案，不要求本轮实现。

### 6.1 项目与快照

| Method | Route | 用途 | MVP 行为 |
| --- | --- | --- | --- |
| `GET` | `/api/agent/projects/:projectId` | 读取项目 bundle | 从 workspace JSON 或 project JSON 读取 |
| `PATCH` | `/api/agent/projects/:projectId` | 保存项目元信息和 session patch | 写入 JSON，append `project.updated` event |
| `DELETE` | `/api/agent/projects/:projectId` | 归档或删除项目 | MVP 可映射现有 session delete |
| `GET` | `/api/agent/projects/:projectId/snapshot` | 构建 Agent 输入快照 | 由 session、artifact summaries、canvas snapshot、pending approval、recent events 派生 |

### 6.2 产物与确认

| Method | Route | 用途 | MVP 行为 |
| --- | --- | --- | --- |
| `GET` | `/api/agent/projects/:projectId/artifacts` | 列出 artifact summaries | 从 workspace artifacts 聚合派生 |
| `POST` | `/api/agent/projects/:projectId/artifacts` | 创建 artifact record | 先写 JSON，不替换现有 `ArtifactStore` |
| `GET` | `/api/agent/artifacts/:artifactId` | 读取 artifact 全文 | 按 id 读取 JSON body |
| `POST` | `/api/agent/projects/:projectId/approvals` | 创建 durable approval | 只创建记录，不执行动作 |
| `POST` | `/api/agent/approvals/:approvalId/respond` | approve/reject | 校验 pending、actionHash、expiresAt，写 event |
| `POST` | `/api/agent/approvals/:approvalId/execute` | 执行已确认动作 | M4 前保持 disabled 或只 dry-run |

### 6.3 画布、任务与资产

| Method | Route | 用途 | MVP 行为 |
| --- | --- | --- | --- |
| `GET` | `/api/agent/projects/:projectId/canvas` | 读取画布图 | 从 project JSON 或现有 canvas local backup 迁入 |
| `POST` | `/api/agent/projects/:projectId/canvas/actions` | 应用 guarded canvas actions | M4 才接真实 reducer，本轮不实现 |
| `GET` | `/api/agent/projects/:projectId/tasks` | 列出生成任务 | 从 Vidu history/project JSON 合并 |
| `POST` | `/api/agent/projects/:projectId/tasks` | 创建 generation task | 只创建 queued/dry-run task，不调用 provider |
| `PATCH` | `/api/agent/tasks/:taskId` | 更新 task 状态 | 供 polling/webhook adapter 后续使用 |
| `POST` | `/api/agent/projects/:projectId/assets` | 创建 asset record | MVP 只记录 metadata，不上传对象存储 |
| `PATCH` | `/api/agent/assets/:assetId` | 标记持久化或分析状态 | 写 JSON 和 event |
| `GET` | `/api/agent/projects/:projectId/events` | 查询最近事件 | 从 project JSON event log 返回 |

### 6.4 API 约束

- 所有 mutation API 都要写 `EventLog`。
- M4 前 `/api/agent/approvals/:approvalId/execute` 和 `/api/agent/projects/:projectId/canvas/actions` 可以只返回 blocker，避免误接真实执行。
- `POST /api/agent/projects/:projectId/tasks` 在没有 approved approval 时必须返回 409 blocker。
- 不新增任何外部网络调用，不调用 `/api/vidu/generate`。
- 错误响应不得包含 secret、provider raw payload、完整 prompt 请求体。

---

## 7. 分阶段迁移计划

### 阶段 A：无后端 MVP

目标：在不接数据库的前提下，把事实边界固定住。

动作：

- 保留 `localStorage`、`/api/agent/workspace`、`.next/cache/ad-studio-agent-workspace.json`。
- 继续使用 workspace-backed `ArtifactStore`。
- 新增项目级 bundle 设计，建议路径为 `.next/cache/ad-studio-agent-projects/{projectId}.json`。
- 把 Approval、CanvasGraph、GenerationTask、MediaAsset、EventLog 的 TypeScript contract 先放入设计文档或独立类型草案。
- M3.2 UI 不变，当前 confirmation 仍不可执行。

验收：

- artifact refresh recovery 不退化。
- pending approval 可以被设计为 durable record，但不执行真实动作。
- 所有新 API 草案都能映射到 JSON store。

### 阶段 B：Store Adapter

目标：让业务代码只依赖 store interface，不关心 JSON 还是数据库。

动作：

- 新增 `AgentProjectStore` facade，底层读写 workspace JSON。
- `ArtifactStore` 保持现状，只补 versioned artifact record 映射。
- 新增 `ApprovalRepository` 本地 JSON adapter。
- 新增 `CanvasGraphRepository` 本地 JSON adapter，但暂不替换 WorkbenchCanvas 的执行逻辑。
- 新增 `EventLogRepository`，扩展 event kind。

验收：

- 已确认 artifact、pending approval、recent events 刷新不丢。
- `CanvasSnapshot` 可由 `CanvasGraphRecord` 派生。
- M3/M3.1 golden path 不受影响。

### 阶段 C：Postgres/Supabase

目标：把生产事实迁入数据库。

动作：

- 先迁 `projects`、`agent_sessions`、`agent_artifacts`、`approval_requests`、`agent_events`。
- 再迁 `canvas_nodes`、`canvas_edges`、`canvas_node_versions`。
- 最后迁 `generation_tasks`、`media_assets`。
- Supabase Row Level Security（RLS）按 project member 权限设计，但团队协作可后置。

验收：

- 多设备刷新后 artifact、approval、canvas graph、task 状态一致。
- approval 与 action execution 在事务边界内写入。
- `EventLog` 可追溯 high-cost action 的 approval id。

### 阶段 D：对象存储

目标：上传素材和生成结果可恢复、可复用、可审计。

动作：

- 选 Supabase Storage 或 Vercel Blob，不要同时分散两套。
- 上传素材进入 `media_assets`，前端只持有 asset id 和 URL。
- 生成结果成功后先 persist asset，再写 canvas version。
- 大视频 URL 使用签名 URL 或 CDN URL，记录过期时间。

验收：

- 刷新后上传素材不因 blob URL 失效而丢失。
- Agent 能通过 `MediaAssetRecord.id` 引用产品包、竞品素材、分镜图和生成视频。

### 阶段 E：队列与实时更新（Queue/Realtime）

目标：长任务和协作状态不依赖前端轮询。

动作：

- 使用队列或 cron 轮询 provider task。
- 使用 Realtime 或 SSE 推送 task/canvas/event 更新。
- 用 KV/Redis 只保存短期锁、轮询游标、stream resume 和幂等去重。

验收：

- 前端关闭后任务仍可继续轮询。
- 任务成功后能推送到 UI 并写回 canvas version。
- 多人编辑冲突有锁或版本检查。

---

## 8. M4 前必须完成与 M5/M6 后置

### M4 前必须完成

M4 如果只做 proposal-only / dry-run Canvas Tools，可以先冻结 contract，不必一次性落完整后端实现。M4 如果要接真正可执行的 Canvas Tools 或可执行 approval，必须先完成：

- 执行确认单（`ApprovalRequest`）durable record，包括 `actionHash`、`idempotencyKey`、`status`、`respondedAt`。
- 事件流水（`EventLog`）扩展到 approval、tool、canvas dry-run、generation dry-run。
- 画布图（`CanvasGraph`）store contract，至少能从当前 canvas state 导出和派生 `CanvasSnapshot`。
- 生成任务（`GenerationTask`）contract，明确没有 approved approval 时返回 blocker。
- 媒体资产（`MediaAsset`）metadata contract，至少标记 blob URL 不可恢复。
- 最小 API route 草案和 store adapter 草案冻结。
- golden path 验证：M3.2 UI 不被破坏，M3.1 安全锁仍然成立。

M4 前不必须完成真实 Postgres，不必须完成对象存储，不必须完成 Realtime。
M4 前也不应该接真实扣费生成。真正调用 provider 的生成能力仍属于 M5，并且必须绑定已确认的 `ApprovalRequest`。

### M5/M6 可以后置

- Supabase/Postgres 实体表落地与 RLS。
- 对象存储上传、签名 URL、CDN 策略。
- provider webhook 或后台队列轮询。
- Realtime/SSE task 更新。
- 团队协作、成员权限、冲突合并。
- 全量 `tool_calls` 独立表和 BI 分析。
- 完整 `agent_snapshots` 每轮归档。

---

## 9. 风险清单与对策

| 风险 | 说明 | 对策 |
| --- | --- | --- |
| localStorage 被误当事实源 | 清缓存、跨端、多 tab 都可能丢关键状态 | 文档和 contract 明确 localStorage 只是 UI cache |
| approval 不可审计 | 扣费后无法证明用户确认过什么 | durable `ApprovalRequest` + `EventLog` + `actionHash` |
| 重复执行扣费 | 用户刷新或重试导致同一 action 重复调用 | `idempotencyKey` 唯一约束，重复返回已有结果 |
| CanvasSnapshot 被误用为主存储 | snapshot 信息不足，无法恢复版本和 settings | `CanvasGraph` 是主存储，snapshot 只派生 |
| 生成任务和画布脱节 | provider 成功但节点 version 未更新 | `GenerationTask` 成功后事务化写 asset 和 node version |
| 上传素材不可恢复 | blob URL 刷新后失效 | `MediaAsset` 标记 recoverability，生产阶段接对象存储 |
| artifact 被静默覆盖 | 用户确认过的方案被模型后续覆盖 | versioned artifact record，用 supersedes/supersededBy 表达版本替代，不改变确认状态 |
| 模型虚构 nodeId | Agent 引用不存在或 stale 节点 | tool 层校验 nodeId 只能来自 `CanvasSnapshot` |
| 过早引入数据库拖慢 M3.2 | UI intake 还在打磨，后端重构会扩大风险 | 先做 adapter contract 和 JSON MVP，不替换 UI |
| 事件日志膨胀 | 本地 JSON 过大 | MVP 限制最近 N 条，生产迁 append-only 表 |
| secret 泄漏 | 错误或 event 写入 provider payload | error sanitization，只存 providerTaskId 和摘要 |

发布阻断条件：

- 未确认扣费执行次数大于 0。
- locked 节点未确认修改次数大于 0。
- 用户确认过 artifact 刷新后丢失。
- approval `actionHash` 不一致仍允许执行。
- generation task 成功但没有 output asset 或 canvas version 追溯。
- provider secret、token 或 `.env` 值出现在日志、事件或错误响应中。

---

## 10. 验收标准

### 10.1 无后端 MVP 验收

- 刷新后 `AgentArtifacts` 可从 workspace-backed store 恢复。
- pending `ApprovalRequest` 设计上能从 project JSON 恢复，且 rejected/approved 都有事件。
- `CanvasSnapshot` 能由 `CanvasGraphRecord` 派生，不再被定义为主事实源。
- dry-run `GenerationTask` 不调用 `/api/vidu/generate`，没有 approved approval 时返回 blocker。
- `MediaAssetRecord` 能表达 upload/mock/generation/external URL，以及 blob URL 不可恢复。
- `EventLog` 至少覆盖 artifact、approval、tool blocked、task dry-run、asset metadata。
- M3.2 UI 不被修改，M3.1 confirmation 的 `executable: false` 不被改变。

### 10.2 Store Adapter 验收

- 新增 adapter 不要求替换当前 UI，但所有新事实对象都有 `load/list/create/update/append` 接口。
- 删除项目时，session、artifact、approval、canvas、task、asset、event 有清理或 archived 策略。
- `projectId`、`sessionId` 在所有对象中一致。
- 类型检查通过，schema parse 失败不会静默吞掉。

### 10.3 Postgres/Supabase 阶段验收

- 已确认 artifact、pending approval、running generation task 跨端不丢。
- 所有 high-cost action 能追溯 approval id、action hash、idempotency key、tool event。
- generation succeeded 后能查到 task、asset、canvas node version 的关联链。
- EventLog 能回答“谁在什么时候用哪个工具改了什么，以及影响哪些节点”。

---

## 11. 建议更新飞书文档

### 11.1 建议更新章节：0.1 阅读约定与术语表

替换原因：M4 前会出现新的后端事实源对象，需要先补中文术语，避免后续只用英文表名沟通。

建议替换文本：

```md
新增术语：

| 中文名 | 英文/代码名 | 产品经理可以这样理解 |
| --- | --- | --- |
| 后端事实源 | Backend Fact Source | 系统认可的长期可信数据来源。刷新、跨端、重试和审计都应以它为准。 |
| 画布图 | CanvasGraph | 可恢复的画布事实，由节点、连线和节点版本组成。CanvasSnapshot 只是从它派生出来给 Agent 看的摘要。 |
| 生成任务 | GenerationTask | 图片或视频生成的长任务记录，连接用户确认、provider task、生成结果、画布版本和成本。 |
| 上传素材 | UploadedAsset | 用户上传的产品包、竞品素材或参考素材。生产阶段不能只依赖 blob URL。 |
| 媒体资产 | MediaAsset | 已持久化的图片、视频、音频、缩略图或抽帧，可以被 Agent、画布和生成任务长期引用。 |
| 存储适配器 | Store Adapter | 屏蔽底层存储的接口层。MVP 可以写本地 JSON，生产可以换 Postgres/Supabase。 |
| 幂等键 | idempotencyKey | 防止同一个扣费动作因为刷新或重试被执行多次。 |
| 动作哈希 | actionHash | 对用户确认时的动作内容做摘要，防止确认后动作被静默替换。 |
```

### 11.2 建议更新章节：3.3 Artifacts + Canvas 视角的效果

替换原因：当前章节已区分 Artifacts 和 Canvas，但还需要补上后端事实源里 CanvasGraph 与 CanvasSnapshot 的关系。

建议替换文本：

```md
AD Studio 的事实源分为三层：

1. AgentArtifacts：广告生产产物协议，负责保存竞品解析、创意方案、锚点登记表、脚本、clip table、prompt pack、workflow plan、repair plan。
2. CanvasGraph：画布的可恢复生产事实，负责保存节点、连线、节点版本、锁定、stale、来源 artifact 和生成任务引用。
3. CanvasSnapshot：从 CanvasGraph 派生出来给 Agent 读取的摘要视图，只包含节点/连线摘要、locked/stale 列表，不能作为画布主存储。

Canvas node 可以引用 artifact id，但不应该成为长脚本、prompt、分镜表的唯一存储位置。后续 Tool、Persistence、Approval 都应围绕 artifact id 和 canvas graph id 做读写和审批，再把必要摘要同步到 Canvas。
```

### 11.3 建议更新章节：5.4 权限与确认策略

替换原因：M4 接可执行工具前，confirmation card 必须升级为 durable ApprovalRequest，否则无法审计扣费和 locked anchor 修改。

建议替换文本：

```md
所有高风险动作必须生成 durable ApprovalRequest。pending confirmation 是 UI 展示，ApprovalRequest 才是后端事实。

ApprovalRequest 必须包含：

- projectId、sessionId
- kind：action_batch、generation、node_overwrite、locked_anchor_change、repair_plan、export
- requestedActions
- affectedNodeIds、affectedArtifactIds
- actionHash
- idempotencyKey
- estimatedCredits、actualCredits
- status：pending、approved、rejected、expired、executing、executed、execution_failed、cancelled
- requestedAt、respondedAt、executedAt

执行规则：

- approved 只代表用户允许执行，不代表动作已经成功。
- 执行时必须重新计算 actionHash，和确认时一致才允许继续。
- credits 动作必须携带 approved approval id。
- 同一个 idempotencyKey 不能重复扣费。
- executing、executed、execution_failed 负责表达执行生命周期。
- 拒绝、过期和执行失败都必须写入 EventLog。
```

### 11.4 建议更新章节：6.7 后端与持久化

替换原因：现有章节给出了方向，但需要明确生产级后端如何承接当前 localStorage、`.next/cache` JSON 和 workspace adapter。

建议替换文本：

```md
第五阶段后端与持久化采用分阶段路线：

1. 无后端 MVP：保留 localStorage、/api/agent/workspace 和 .next/cache JSON，但新增 AgentProjectStore、ApprovalStore、CanvasGraphStore、GenerationTaskStore、MediaAssetStore、EventLogStore contract。localStorage 只做 UI cache。
2. Store Adapter：业务代码依赖 store interface，底层仍可写项目级 JSON。AgentArtifacts 继续使用 workspace-backed ArtifactStore，ApprovalRequest、CanvasGraph、GenerationTask、MediaAsset、EventLog 进入同一项目事实包。
3. Postgres/Supabase：projects、agent_sessions、agent_artifacts、approval_requests、canvas_nodes、canvas_edges、canvas_node_versions、generation_tasks、media_assets、agent_events 迁入数据库。
4. 对象存储：上传素材和生成结果进入 Supabase Storage 或 Vercel Blob，前端和 Agent 只引用 asset id 和 URL。
5. 队列/Realtime：provider polling、任务状态推送、协作锁和 stream resume 后置。

M4 如果只做 proposal-only / dry-run Canvas Tools，可以先冻结 store contract。M4 如果要接真正可执行的 Canvas Tools 或可执行 approval，则必须先完成 durable ApprovalRequest、扩展 EventLog、CanvasGraph store contract、GenerationTask contract、MediaAsset metadata contract 和最小 API 草案。真实数据库、对象存储、队列和 Realtime 可以 M5/M6 后置。
```

### 11.5 建议更新章节：6.11 开发里程碑

替换原因：M2.5 已完成 artifact workspace persistence，但 M4 前还缺后端事实源 MVP gate。

建议替换文本：

```md
#### Milestone 3.5：Backend Fact Source MVP

目标：

- 不接真实数据库，不接真实生成，不改 M3.2 UI。
- 在当前 workspace adapter 基础上，固定 Project、Session、AgentArtifacts、ApprovalRequest、CanvasGraph、GenerationTask、MediaAsset、EventLog 的 store contract。
- 明确 localStorage 只是 UI cache，.next/cache JSON 只是无后端 MVP 的准事实源。

交付：

- 新增后端事实源设计文档。
- 给出推荐 Postgres/Supabase 表结构或 TypeScript interface。
- 给出最小 API route 设计。
- 给出无后端 MVP 到 store adapter、Postgres/Supabase、对象存储、队列/Realtime 的迁移计划。
- 标明 M4 前必须完成项和 M5/M6 后置项。

验收：

- 不调用 /api/vidu/generate。
- 不修改 M3.2 UI。
- M3.1 executable=false 安全边界不退化。
- ApprovalRequest、EventLog、CanvasGraph、GenerationTask、MediaAsset 的职责和 store boundary 清楚。
- 后续接 Postgres/Supabase 时只替换 adapter，不重写 Agent snapshot 和 artifact schema。
```

### 11.6 建议更新章节：6.13 风险与对策

替换原因：现有风险里已有 localStorage、approval、generation、asset、event 风险，但需要补具体发布阻断条件。

建议替换文本：

```md
新增发布阻断条件：

- 未确认扣费执行次数大于 0。
- locked 节点未确认修改次数大于 0。
- 用户确认过 artifact 刷新后丢失。
- ApprovalRequest 的 actionHash 不一致仍允许执行。
- 同一个 idempotencyKey 触发重复扣费。
- GenerationTask succeeded 后没有 output asset 或 canvas node version 追溯。
- 上传素材仍只有 blob URL，却被 Agent 当作可长期恢复资产。
- provider secret、token 或 .env 值出现在日志、事件或错误响应中。
```

---

## 12. 本轮建议落地顺序

1. 先评审本设计文档，确认对象边界和 M4 gate。
2. 新增纯类型草案时，只新增 store interface，不替换现有实现。
3. 将 `ApprovalRequest` 和扩展 `EventLog` 作为 M4 前第一优先级。
4. 将 `CanvasGraphRecord` 导出和 snapshot 派生作为第二优先级。
5. 将 `GenerationTaskRecord` 和 `MediaAssetRecord` dry-run contract 作为第三优先级。
6. 等 M3.2 UI 稳定后，再把 confirmation card 绑定 durable approval record。
