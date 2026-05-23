# AD Studio Agent M5 Provider Smoke / GenerationTask 预研

日期：2026-05-22  
状态：预研方案  
范围：M5 受控生成任务、provider smoke、`GenerationTaskRecord` 映射、adapter 设计  
非范围：不接真实生成按钮，不调用真实 provider，不修改 M4 canvas approval 主流程，不接 `ToolLoopAgent`

---

## 0. 当前阶段边界

M5 是“受控生成任务”预研，不是把现有 Vidu 生成按钮接进 Agent，也不是让模型直接执行媒体生成。

当前阶段必须保持这些边界：

- M4 正在处理“用户确认后创建/更新画布结构”，仍不允许调用媒体生成供应商。
- M5 必须从已批准的 `ApprovalRequestRecord` 开始，不能绕过 approval。
- 每次媒体生成都必须落到 `GenerationTaskRecord`，并能追踪 `providerTaskId`、状态、成本、输出和失败原因。
- 输出必须写成 `MediaAssetRecord`，再由受控执行器写回 canvas node version。
- 关键状态变化必须写 `EventLog`，而不是只存在 React state 或全局 history。
- 本预研不调用 `/api/vidu/generate`，不消耗 credits，不新增真实生成入口。

---

## 1. 已审计代码与结论

### 1.1 后端事实源 contract

相关文件：

- `src/lib/agent-project-store.ts`
- `src/lib/agent-workspace-store.ts`
- `src/lib/agent-workspace-model.ts`

当前 M3.5 已经有项目级事实源边界：

- `AgentProjectBundle` 包含 `project`、`sessions`、`artifacts`、`approvalRequests`、`canvasGraph`、`generationTasks`、`mediaAssets`、`events`。
- `ApprovalRequestRecord` 已包含 `kind`、`status`、`requestedActions`、`actionHash`、`idempotencyKey`、`estimatedCredits`、`actualCredits`、`executionResult`。
- `GenerationTaskRecord` 已包含 `approvalRequestId`、`providerTaskId`、`modelId`、`modeKey`、`prompt`、`params`、`slots`、`status`、`credits`、`outputAssetId`、`errorCode`、`errorMessage`、`idempotencyKey`。
- `MediaAssetRecord` 已能表达上传、生成、mock、external URL，并有 `recoverable` 字段提示本地 JSON 或外部 URL 的恢复风险。
- `EventLog` 已覆盖 approval、canvas、generation、asset、repair 等事件类型。

当前限制：

- workspace adapter 仍通过 `/api/agent/workspace` 间接保存 `projectBundles`，没有专用 task API。
- JSON store 没有事务、锁、唯一约束，多 tab 或并发执行仍有重复写入风险。
- `GenerationTaskRecord` 只是 contract 和 typecheck，尚未接入真实生成执行链路。

### 1.2 Agent tools 与 canvas guard

相关文件：

- `src/features/agent-runtime/guarded-tools.ts`
- `src/features/agent-runtime/canvas-action-validator.ts`

当前 guarded tools 只允许：

- `askUser`
- `saveArtifact`
- `proposeActionBatch`
- `inspectCanvas`

其中 `proposeActionBatch` 明确阻止这些动作进入 M3 proposal：

- `runNodeGeneration`
- `appendNodeVersion`
- `failNodeGeneration`
- `setPrimaryVersion`

`canvas-action-validator.ts` 也阻止第一版 Agent 直接触发生成任务，并要求媒体节点 `appendNodeVersion` 必须带真实 provider 结果。这个 guard 应继续保留到 M5，M5 只能通过受控执行器在 approval 校验后写入结果。

---

## 2. 当前 Vidu 生成链路现状

### 2.1 独立生成页链路

相关文件：

- `src/features/generation/GenerationView.tsx`
- `src/features/generation/vidu-client.ts`
- `src/features/generation/types.ts`
- `src/lib/mock-data/generation.ts`
- `src/app/api/vidu/generate/route.ts`
- `src/app/api/vidu/tasks/[taskId]/route.ts`

当前流程：

1. 用户在独立 `Ad Video` / `Ad Image` 页输入 prompt、选择模型、模式、比例、时长、分辨率并上传素材。
2. 前端用 `createPendingTask()` 先创建一个本地 `GenerationTask`，写入 `generationState.history`。
3. `buildViduSlotPayloads()` 把 slot 里的图片/视频读取为 data URL。
4. 前端 POST `/api/vidu/generate`，body 包含 `kind`、`modeKey`、`modelId`、`prompt`、`params`、`slots`。
5. API route 直接调用 `createViduGeneration(body)`。
6. `src/lib/vidu.ts` 根据 mode 选择 Vidu endpoint：
   - `text-to-video` -> `/text2video`
   - `image-to-video` -> `/img2video`
   - `first-last-frame` -> `/start-end2video`
   - `reference` 或带图片输入 -> `/reference2video`
   - 图片生成 -> `/reference2image`
7. Vidu 返回 `task_id` 后，前端保存为 `providerTaskId`。
8. 前端定时 GET `/api/vidu/tasks/:taskId` 轮询。
9. `mapViduState()` 把 provider 状态映射为 `queued`、`running`、`succeeded`、`failed`。
10. 成功后把 `creations[0]` 映射到 `output.assetUrl` / `output.downloadUrl` 并展示。

当前特点：

- 启动生成是前端按钮直接发起。
- 没有 approval id、action hash 或 idempotency key。
- 本地 `GenerationTask` 不是 `GenerationTaskRecord`，也没有进入 `AgentProjectBundle.generationTasks`。
- 错误只落在前端 `errorMessage`，没有结构化 `errorCode` 和 event log。

### 2.2 生成历史保存链路

相关文件：

- `src/components/app-shell/AdStudioApp.tsx`
- `src/app/api/vidu/history/route.ts`
- `src/lib/vidu-history.ts`

当前流程：

1. `AdStudioApp` 把 generation state 保存到 localStorage：`ad-studio:generation-state:v1`。
2. 只把 Vidu 任务过滤后 PUT 到 `/api/vidu/history`。
3. `/api/vidu/history` 写 `.next/cache/ad-studio-vidu-history.json`。
4. GET history 时，`getLocalViduHistory()` 会合并 seed tasks 和本地任务。
5. GET history 还会对每个 `providerTaskId` 调 `getViduTask()` 刷新状态。

当前特点：

- GET history 会隐式触发 provider 查询。
- history 是全局 video/image 数组，不是 project-scoped task fact。
- `providerTaskId` 作为 merge key，但没有数据库唯一约束。
- 查询失败会静默保留旧 task，不写 event。

### 2.3 画布节点生成链路

相关文件：

- `src/features/generation/CanvasGenerationComposer.tsx`
- `src/features/workbench/WorkbenchCanvas.tsx`
- `src/features/canvas/actions.ts`

当前流程：

1. 用户打开 image/video canvas node 的生成面板。
2. composer 从 parent nodes 生成 slot 输入，或读取本地上传为 data URL。
3. `submit()` 直接 POST `/api/vidu/generate`。
4. `waitForViduResult()` 每 3.2s 轮询 `/api/vidu/tasks/:taskId`，直到 succeeded/failed。
5. 成功后调用 `onComplete()`。
6. `WorkbenchCanvas.completeNodeGeneration()` dispatch `appendNodeVersion`。
7. `src/features/canvas/actions.ts` 用 `providerTaskId`、`assetUrl`、`downloadUrl`、`params`、`slots` 创建 node version，并设为 primary。

当前优点：

- 已经避免旧的占位生成；`runNodeGeneration()` 会失败提示用户到节点生成面板提交真实 Vidu 任务。
- `appendNodeVersion` 会阻止无真实内容的占位写入。

当前缺口：

- 仍是 UI 直接调用 provider，不经过 durable approval。
- 没有 `GenerationTaskRecord`。
- 没有 `MediaAssetRecord`。
- 没有 `EventLog`。
- 画布写回发生在前端 reducer，刷新/并发/重复回调无法被事实源审计。

---

## 3. 新供应商接入 M5 需要验证的字段

新供应商不能先接 UI。应先用文档、mock 和可选 dry-run payload 验证下面字段是否足够映射到 M5。

| 字段 | 必须验证的问题 | 映射目标 |
| --- | --- | --- |
| model / mode | 模型 id、业务模式、图片/视频能力、默认值、限制是否稳定 | `modelId`、`modelName`、`modeKey`、adapter capabilities |
| prompt | 最大长度、语言支持、敏感词错误、是否支持 negative prompt | `prompt`、`params.negativePrompt`、`errorCode` |
| ratio | 支持哪些比例，是否区分图片/视频/参考模式 | `params.ratio`、`output.ratio` |
| duration | 支持几秒、是否按秒计费、失败是否扣费 | `params.duration`、`credits`、`costUsd` |
| input image/video | 支持 data URL、公网 URL、对象存储 URL、视频参考、首尾帧、数量限制、大小限制 | `slots`、`MediaAssetRecord` |
| callback / polling | 是否有 webhook、签名校验、重放保护、是否只能 polling | poller/callback executor、`EventLog` |
| providerTaskId | 创建任务后是否稳定返回，是否全局唯一，是否可用来查状态 | `providerTaskId`、唯一约束 |
| cost / credits | 创建时返回预估还是完成后返回实际成本，失败/取消如何计费 | `estimatedCredits`、`actualCredits`、`GenerationTaskRecord.credits` |
| success output | 返回几条结果、URL 是否过期、是否有封面、是否有水印 URL、是否可下载 | `MediaAssetRecord.storage`、`GenerationTaskRecord.output` |
| error code/message | 错误码是否结构化，是否区分参数错误、余额不足、内容安全、超时、provider 内部错误 | `errorCode`、`errorMessage`、repair 分类 |
| timeout / retry | 创建超时是否可能已扣费，查询超时是否可重试，是否支持 cancel | idempotency、retry policy、`cancelled` |

最小 smoke 结论必须回答：

- 是否支持 provider task 查询，还是只能 webhook。
- 是否支持请求级幂等键；如果不支持，AD Studio 必须自己做 `projectId + idempotencyKey` 锁。
- 输出 URL 是否长期可访问；如果不是，M5 必须先转存对象存储再写 canvas。
- 失败时是否扣费；如果会扣费，必须在 approval 文案和 task cost 中展示。
- 是否有明确的 rate limit、并发限制和可重试错误码。

---

## 4. 推荐 Provider Adapter 设计

供应商细节不能散落在 UI、Agent tool 或 canvas reducer 中。M5 应新增 provider adapter 层，受控执行器只面向统一接口。

```ts
export type MediaGenerationProviderKey = "vidu" | "cheap_provider" | "mock";

export type MediaGenerationProviderStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type MediaGenerationInput = {
  projectId: string;
  sessionId?: string;
  approvalRequestId: string;
  idempotencyKey: string;
  kind: "image" | "video";
  surface: "standalone" | "canvas" | "agent";
  modelId: string;
  modelName: string;
  modeKey: string;
  prompt: string;
  params: Record<string, string | number | boolean>;
  slots: Array<{
    id: string;
    slotKey: string;
    kind: "image" | "video";
    mediaAssetId?: string;
    publicUrl?: string;
    dataUrl?: string;
    mimeType?: string;
  }>;
};

export type MediaGenerationCreateResult = {
  providerTaskId: string;
  status: MediaGenerationProviderStatus;
  credits?: number;
  costUsd?: number;
  raw?: unknown;
};

export type MediaGenerationPollResult = {
  providerTaskId: string;
  status: MediaGenerationProviderStatus;
  progress?: number;
  credits?: number;
  costUsd?: number;
  output?: {
    kind: "image" | "video";
    assetUrl?: string;
    downloadUrl?: string;
    coverUrl?: string;
    mimeType?: string;
    width?: number;
    height?: number;
    durationMs?: number;
  };
  errorCode?: string;
  errorMessage?: string;
  raw?: unknown;
};

export type MediaGenerationProvider = {
  key: MediaGenerationProviderKey;
  displayName: string;
  capabilities: {
    kinds: Array<"image" | "video">;
    modes: string[];
    ratios: string[];
    durations?: string[];
    supportsPolling: boolean;
    supportsCallback: boolean;
    supportsProviderIdempotency: boolean;
    acceptsDataUrl: boolean;
    acceptsPublicUrl: boolean;
  };
  validate(input: MediaGenerationInput): { ok: true } | { ok: false; errorCode: string; errorMessage: string };
  estimateCost(input: MediaGenerationInput): { credits: number; costUsd?: number };
  createTask(input: MediaGenerationInput): Promise<MediaGenerationCreateResult>;
  getTask(providerTaskId: string): Promise<MediaGenerationPollResult>;
  normalizeCallback?(payload: unknown, headers: Headers): Promise<MediaGenerationPollResult>;
  cancelTask?(providerTaskId: string): Promise<{ status: "cancelled" | "failed"; raw?: unknown }>;
};
```

设计原则：

- adapter 只处理供应商协议、状态归一化、错误归一化和 payload 构造。
- adapter 不判断用户是否确认，不写 canvas，不写 project store。
- 执行器负责 approval、idempotency、task record、asset、canvas version、event log。
- 所有原始 provider response 只能作为内部 debug payload 保存，不能暴露 secrets 或完整请求头。
- mock adapter 必须先实现，用于 M5 executor 和验收，不触发真实生成。

---

## 5. `GenerationTaskRecord` 映射

### 5.1 状态映射

| M5 状态 | 含义 | Provider 映射 |
| --- | --- | --- |
| `queued` | 已创建 AD Studio task，等待 provider 或 provider 排队 | Vidu `created` / `queueing` |
| `running` | provider 已开始处理或轮询显示处理中 | Vidu 其他非终态 |
| `succeeded` | provider 成功且输出已写入 asset record | Vidu `success` |
| `failed` | 参数、供应商、内容安全、余额、超时等失败 | Vidu `failed` 或 create/poll 异常 |
| `cancelled` | 用户取消或系统取消，前提是 provider 支持或本地标记停止跟进 | provider cancel / local cancel |

### 5.2 字段映射建议

| `GenerationTaskRecord` 字段 | M5 写入时机 | 说明 |
| --- | --- | --- |
| `id` | 创建 task 前生成 | AD Studio 内部任务 id |
| `projectId` / `sessionId` | 创建 task 前 | 所有事实必须项目级归属 |
| `nodeId` / `nodeVersionId` | canvas surface 时 | `nodeVersionId` 成功写回后补 |
| `artifactId` | 从 prompt pack / storyboard / script 来源带入 | 用于追溯生成参数来源 |
| `approvalRequestId` | 创建 task 前必须存在 | 不能为空，除非 mock/typecheck 明确非执行 |
| `provider` | 创建 task 前 | 如 `vidu`、`cheap_provider`、`mock` |
| `providerTaskId` | provider create 成功后 | 必须唯一；重复回调用它去重 |
| `modelId` / `modelName` | 创建 task 前 | 来自 catalog 或 adapter model registry |
| `modeKey` | 创建 task 前 | 如 `text-to-video`、`image-reference` |
| `prompt` | 创建 task 前 | 保留完整执行 prompt，便于 repair |
| `params` | 创建 task 前 | ratio、duration、resolution、seed 等 |
| `slots` | 创建 task 前 | 应尽量引用 `MediaAssetRecord`，不要只放 blob URL |
| `status` | 全生命周期更新 | 只能通过 executor 更新 |
| `progress` | poll/callback 更新 | provider 没进度时用保守估算 |
| `credits` / `costUsd` | 创建前估算，完成后修正 | 对齐 approval 的 estimated/actual |
| `outputAssetId` | 成功持久化 asset 后 | canvas 写回前应已有 asset |
| `output` | 成功后 | 只放展示摘要，文件事实在 `MediaAssetRecord` |
| `errorCode` / `errorMessage` | 失败后 | 结构化错误码用于 retry/repair |
| `idempotencyKey` | 创建 task 前必须存在 | `projectId + idempotencyKey` 唯一 |

---

## 6. Approval / Task / Asset / Canvas / EventLog 写回关系

推荐执行流：

```text
approved ApprovalRequest
→ 重算 actionHash
→ 检查 idempotencyKey
→ approval: approved -> executing
→ create GenerationTaskRecord(status=queued)
→ append generation.queued
→ provider.createTask()
→ update task.providerTaskId/status/credits
→ append generation.provider_task_created
→ poll or callback
→ update task status/progress
→ append generation.status_changed
→ on success: persist output as MediaAssetRecord
→ append asset.persisted
→ append CanvasNodeVersion and set primary
→ append canvas.node.updated
→ task.status=succeeded + outputAssetId
→ append generation.succeeded
→ approval: executing -> executed
```

失败流：

```text
provider create/poll/callback failed
→ task.status=failed
→ task.errorCode/errorMessage
→ append generation.failed
→ approval: executing -> execution_failed
→ 保留 prompt/params/slots/provider payload 摘要
→ 后续 repair/retry 从同一 task 派生新 approval
```

幂等规则：

- 执行前先查 `projectId + idempotencyKey` 是否已有 task。
- 如果已有 running task，直接返回已有 task，不再次调用 provider。
- 如果已有 succeeded task，返回已有 asset/canvas version，不重复写结果。
- 如果已有 failed task，默认不自动重试；retry 必须创建新的 approval 或明确 reuse policy。
- callback 和 polling 都要按 `provider + providerTaskId` 去重。
- terminal 状态更新必须幂等：重复 succeeded callback 不能重复创建 asset 或 node version。

---

## 7. 为什么本线程不接真实生成

本线程不接真实 provider 调用，原因不是技术上不能 POST，而是 M5 的安全目标要求先建立任务系统：

- 当前 `/api/vidu/generate` 是真实扣费入口，直接调用会绕过 approval。
- 当前独立生成页和画布 composer 都把任务事实放在前端 state / Vidu history，不能作为审计事实源。
- 没有 `projectId + idempotencyKey` 唯一约束时，重复点击、重复确认、重复回调都可能重复扣费或重复写 canvas。
- 没有 `MediaAssetRecord` 时，provider URL 过期后无法保证项目可恢复。
- M4 正在做 canvas proposal，M5 不能提前改它的主流程。

如果后续必须用真实供应商 API 才能判断能力，必须先让用户明确确认会消耗额度，并提供测试账号、预算、模型、模式、输入素材和调用次数上限。

本预研的真实 provider 调用次数：0。

---

## 8. M5 真正开发的分阶段计划

### Phase 0：Mock provider + contract typecheck

- 新增 mock provider adapter，只返回固定 `providerTaskId` 和 fixture output。
- 新增 executor typecheck，覆盖 approval -> task -> asset -> canvas version -> event log 的对象映射。
- 不接 UI，不调用真实 provider。

验收：

- `corepack pnpm exec tsc --noEmit`
- `corepack pnpm lint`
- mock task 能写入 `GenerationTaskRecord`、`MediaAssetRecord` 和 events。

### Phase 1：Provider adapter 包装现有 Vidu

- 把 `src/lib/vidu.ts` 包成 `viduProviderAdapter`。
- 不改变 `/api/vidu/generate` 现有快速生成入口。
- adapter 单测只验证 payload normalization，不发真实请求。
- 明确 Vidu 的限制：视频参考当前实现实际只传图片，Q3 快速模型提示暂不接视频参考；图片/视频 output URL 需要评估持久化策略。

验收：

- adapter validate 能拦截缺 prompt、缺首尾帧、比例不支持、slot 类型不支持。
- 不需要 `VIDU_API_KEY` 也能跑 mock/typecheck。

### Phase 2：Generation executor API

- 新增受控执行入口，例如 `POST /api/agent/generation-tasks/execute`。
- 输入必须包含 `projectId`、`approvalRequestId`、`actionHash`、`idempotencyKey`。
- executor 从 project store 读取 approval 并校验状态、过期、hash、幂等。
- 创建 task 后再调用 adapter。

验收：

- 未批准 approval 返回 blocker/错误，不调用 adapter。
- action hash 不一致返回错误。
- 重复 idempotency key 返回已有 task。

### Phase 3：Polling / callback runner

- 后端负责 poll 或 callback，不让前端直接轮询供应商。
- callback 必须校验签名或共享 secret，防重放。
- 每次状态变化写 `generation.status_changed`。

验收：

- 重复 callback 不重复写 asset。
- provider 查询失败可重试，不把 running 误判 terminal。
- timeout 后进入 failed，并保留可 repair 参数。

### Phase 4：MediaAsset + Canvas 写回

- 成功后先转存输出文件到对象存储或明确记录 external URL 风险。
- 写 `MediaAssetRecord`。
- 再 append canvas node version，并把 `source_task_id` / `media_asset_id` 关联到 node version。
- 标记下游 stale。

验收：

- canvas node version 能追溯到 task 和 asset。
- task 能反查 output asset。
- 下游节点 stale 行为只由 reducer/executor 触发。

### Phase 5：UI 状态与 repair/retry

- UI 只展示后端 task 状态，不直接调用 provider。
- 失败任务展示保留参数、错误分类和局部 retry 入口。
- retry 必须新建 approval 或使用明确的 retry approval。

验收：

- 刷新后 running/failed/succeeded task 可恢复。
- retry 不复用旧 idempotency key 扣费。
- 用户拒绝 retry approval 后不会执行。

---

## 9. 风险

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| 继续复用当前前端 history 当事实源 | 任务与项目、approval、canvas 脱节 | M5 executor 必须写 `AgentProjectBundle.generationTasks` |
| provider 不支持 idempotency | 网络重试可能重复扣费 | AD Studio 自己做 `projectId + idempotencyKey` 锁和 task 去重 |
| provider create 超时但实际创建成功 | 误重试导致双任务 | create 前先落 local task，重试策略必须先查已有 task；必要时 provider 支持 payload trace |
| output URL 短期有效 | 刷新或稍后打开无法恢复媒体 | 成功后优先转存对象存储；否则 `recoverable=false` 并提示 |
| callback 重放或重复 polling | 重复写 asset / canvas version | `provider + providerTaskId` 唯一，terminal event 幂等 |
| cost 预估与实际不一致 | approval 文案和实际扣费不一致 | approval 存 estimated，task/approval 完成后写 actual |
| 错误码不稳定 | repair 难分类 | adapter 做 error taxonomy，保存原始 code 摘要 |
| M5 改动污染 M4 | canvas approval 主流程不稳定 | M5 先做独立 executor/mock，不改 M4 主流程 |

---

## 10. 验收标准

### 10.1 本预研文档验收

- 文档说明当前 Vidu 链路、history、polling、canvas 写回现状。
- 文档列出新供应商 smoke 必查字段。
- 文档给出 provider adapter interface。
- 文档给出 `GenerationTaskRecord`、`ApprovalRequestRecord`、`MediaAssetRecord`、canvas version、`EventLog` 的关系。
- 文档明确不接真实生成的原因。
- 文档给出 M5 分阶段计划、风险和验收标准。
- 本线程真实 provider 调用次数为 0。

### 10.2 后续 M5 工程验收

- 未批准 approval 不能创建 provider task。
- approval `actionHash` 不一致不能执行。
- `projectId + idempotencyKey` 重复时不重复扣费。
- 每次生成都有 `GenerationTaskRecord`。
- provider task 创建、状态变化、成功、失败都有 event log。
- 成功任务必须有 `MediaAssetRecord`。
- 成功写回 canvas node version 后能追溯 `sourceTaskId` / `outputAssetId`。
- 失败任务保留 prompt、params、slots、errorCode、errorMessage。
- 重复 callback / 重复 polling 不重复写 asset 或 canvas version。
- UI 回归仍满足 M3.3：`corepack pnpm accept:m33` 中 `/api/vidu/generate` 调用次数为 0。

---

## 11. 本次预研结论

现有 Vidu 链路可以作为 provider adapter 的参考实现，但不能直接作为 M5 执行链路复用。它目前更像“快速生成体验 + 本地历史”，缺少 approval、idempotency、GenerationTask fact、MediaAsset fact 和 EventLog 审计。

M5 的最小正确接入方式是先做 mock provider 和受控 executor，再把 Vidu 或新供应商包成 adapter。只有当 executor 能证明重复确认、重复回调、刷新恢复和失败 repair 都不会重复扣费或丢事实后，才应该把真实 provider 接入用户可触发路径。
