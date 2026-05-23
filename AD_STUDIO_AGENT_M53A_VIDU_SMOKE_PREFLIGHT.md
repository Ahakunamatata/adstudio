# AD Studio Agent M5.3A Vidu Smoke Preflight

日期：2026-05-23
状态：前置准备
范围：真实 Vidu smoke 的安全执行路径、临时 URL 策略、幂等锁、默认禁用的本地入口
非范围：不真实调用 Vidu，不接 UI，不改 M4 主流程，不让 Agent 直接触发真实生成

---

## 1. 当前结论

M5 Phase 0、M5.1 和 M5.2 已经建立了受控生成的核心边界：

- provider contract 已经收敛到 `MediaGenerationProvider`。
- Vidu dry-run adapter 只做 validate、payload build、状态映射、错误映射和 URL 映射。
- executor 已经要求 `ApprovalRequestRecord.kind === "generation"`，并校验 `actionHash` 和 `idempotencyKey`。
- executor create 阶段只把 task 写成 `queued` 或 `running`，不会提前写 asset 或把 approval 标记为 executed。
- poll 阶段只有 provider 返回 `succeeded` 且有可用 output 时才写 `MediaAssetRecord`、`generation.succeeded` 和 approval `executed`。

M5.3A 本轮只补真实 smoke 前置。真实扣费调用仍然 disabled。

---

## 2. 安全执行路径

真实 Vidu smoke 只能通过一个本地开发入口执行，并且必须复用 M5.2 executor。

### 2.1 创建或选择 approval

优先选择已有 approval：

- `projectId` 匹配。
- `kind === "generation"`。
- `status === "approved"`。
- `actionHash` 匹配本次 generation request 的稳定 hash。
- `idempotencyKey` 匹配本次 request 的稳定 key。
- 未过期。

如果没有匹配 approval，preflight 只能创建或打印一个 `pending` generation approval 草案，然后停止。真实 smoke 前必须由操作者显式把 approval 从 `pending` 变成 `approved`，不能由 Agent 自动确认。

### 2.2 绑定 actionHash

`actionHash` 必须从稳定 generation request 计算，输入至少包含：

- `kind`
- `surface`
- `modelId`
- `modelName`
- `modeKey`
- `prompt`
- `params`
- `slots` 中可审计的 `id`、`slotKey`、`kind`、`mediaAssetId`、`publicUrl` 摘要

不把本地临时文件路径、密钥、完整请求头写入 hash。

建议格式：

```text
generation:vidu-smoke:<stable-hash>
```

### 2.3 绑定 idempotencyKey

`idempotencyKey` 必须由 `projectId + actionHash` 派生。

建议格式：

```text
m53a:<projectId>:<actionHash>
```

执行前先查当前 project bundle 里是否已经存在相同 `idempotencyKey` 的 `GenerationTaskRecord`：

- 已有 `queued` 或 `running`：返回已有 task，不再次创建 provider task。
- 已有 `succeeded`：返回已有 task 和 asset，不重复写 asset。
- 已有 `failed` 或 `cancelled`：不自动重试，必须新建 approval 或明确 retry policy。

### 2.4 调用 executor create

真实 smoke 入口必须调用：

```text
executeControlledGenerationTask(store, {
  projectId,
  approvalRequestId,
  actionHash,
  idempotencyKey,
  generation,
  provider
})
```

executor 负责：

- 校验 approval 项目、类型、状态、hash、idempotency key 和过期时间。
- 把 approval 从 `approved` 转到 `executing`。
- 创建 `GenerationTaskRecord(status="queued")`。
- 写 `generation.queued`。
- 调用 provider `createTask`。
- 写 `providerTaskId`、provider 状态和 `generation.provider_task_created`。

如果 provider create 返回 `queued` 或 `running`，executor 必须保持 approval `executing`，不写 asset，不写 `generation.succeeded`。

### 2.5 poll

真实 smoke 入口必须调用：

```text
pollControlledGenerationTask(store, {
  projectId,
  taskId,
  provider
})
```

poll 阶段规则：

- provider 返回 `queued` 或 `running`：只更新 task status/progress/credits，写 `generation.status_changed`。
- provider 返回 `failed` 或 `cancelled`：task 进入 terminal failure，写 `generation.failed` 或 `generation.cancelled`，approval 进入 `execution_failed`。
- provider 返回 `succeeded`：必须有 output URL，否则按 `generation_missing_output` 失败处理。
- 只有 succeeded 且有 output 时，才写 `MediaAssetRecord` 和 `generation.succeeded`，然后 approval 进入 `executed`。

### 2.6 写入事实源

必须写入的事实关系：

- `ApprovalRequestRecord`：`pending -> approved -> executing -> executed/execution_failed`。
- `GenerationTaskRecord`：记录 approval、provider、providerTaskId、prompt、params、slots、status、credits、output 或 error。
- `MediaAssetRecord`：只有 succeeded 后写。无对象存储前 source 为 `generation`，storage 为 `external`。
- `EventLog`：至少写 `approval.*`、`generation.queued`、`generation.provider_task_created`、必要的 `generation.status_changed`、terminal event 和 asset event。

---

## 3. 本地入口约束

本轮新增的本地 preflight 脚本只能打印 dry-run 计划。

默认状态：

- disabled。
- 不执行真实请求。
- 不接 UI。
- 不被普通用户路径调用。
- 不调用旧 Vidu route。

显式环境变量：

```text
AD_STUDIO_M53A_VIDU_SMOKE_PREFLIGHT=1
```

即使设置了该变量，M5.3A 脚本也只打印计划并停止。任何执行真实 provider 的环境变量在本轮都必须被拒绝。

---

## 4. Live provider skeleton

最小接入方式：

- 新增 `vidu-live-generation-provider.ts`，复用 Vidu dry-run adapter 的 validate、payload build、状态映射、错误映射和 output URL 映射。
- 默认不启用真实 transport。
- 不读取或打印密钥值。
- 不依赖 UI route。
- 不在模块初始化时发请求。
- 只有显式 smoke 开关和人工确认值同时存在时，才允许 transport 被调用。
- 本轮不把 live provider 接入 executor 的允许列表，因此普通 runtime 仍无法使用它。

M5.3B 前，真实调用必须再次停下来确认：

- provider endpoint 和 method。
- 请求体摘要。
- 模型、模式、时长、比例。
- 是否扣费和预算上限。
- 输入素材是否可用于真实 provider。
- 调用次数上限。
- 清理方式和失败成本说明。

---

## 5. Vidu 临时 URL 策略

当前 Vidu 输出 URL 按临时 URL 处理。

无对象存储转存前：

- `MediaAssetRecord.storage.provider` 继续使用 `external`。
- `MediaAssetRecord.storage.publicUrl` 只保存 provider output URL。
- `MediaAssetRecord.storage.signedUrlExpiresAt` 必须写入。
- `MediaAssetRecord.recoverable` 必须是 `false`。
- event 必须写 `asset.not_persisted`。
- 不能把这类 URL 标成长期资产，不能承诺刷新后永久可恢复。

接入对象存储后替换为：

- provider success 后先下载 output。
- 上传到 `vercel_blob` 或 `supabase_storage`。
- `MediaAssetRecord.storage.provider` 改为对象存储 provider。
- 写 `storage.key` 和长期可恢复 URL 或可重新签发的 key。
- `recoverable` 改为 `true`。
- event 改为 `asset.persisted`。
- canvas node version 只引用对象存储后的 asset id，不直接引用 provider 临时 URL。

---

## 6. 幂等和并发锁

当前 JSON store 没有事务、唯一约束或跨进程锁，不能承载真实扣费并发。

M5.3A 的最低策略：

- 脚本级单进程锁：同一进程内用 `projectId + idempotencyKey` 建 Map 锁。
- 本地文件锁：真实 smoke 前在 `.next/cache/ad-studio-m53a-locks/` 下用 exclusive create 写 lock file。
- lock 内容只保存 `projectId`、`idempotencyKey`、`pid`、`createdAt`、`expiresAt`，不保存密钥和完整 provider payload。
- provider create 前获取锁；create 返回 providerTaskId 后，task 写入 store；terminal 或超时后释放锁。
- 如果锁存在，脚本必须停止并返回已有 lock 信息，不得重试创建 provider task。

长期 DB 方案：

- `generation_tasks(project_id, idempotency_key)` 唯一约束。
- `generation_tasks(provider, provider_task_id)` 唯一约束，允许 providerTaskId 非空后生效。
- task 创建和 `generation.queued` event 写入同一事务。
- callback/poll terminal 写入 asset、task terminal 状态和 event 使用事务。
- terminal event 和 asset 写入按 task id 幂等。

---

## 7. M5.3B 前需要确认

真实 smoke 前需要操作者确认：

- 使用哪个 project 和 approval。
- approval 是否已经由人工确认到 `approved`。
- `actionHash` 和 `idempotencyKey` 的最终值。
- provider endpoint、请求体摘要、模型、模式、比例、时长。
- 是否会扣费、预算上限和最多调用次数。
- 输入素材是否是 provider 可访问的 data URL 或公网 URL。
- 临时 URL 接受策略：本次只作为 `asset.not_persisted`，不作为长期资产。
- 并发锁文件是否不存在，或已有 task 是否应直接复用。

本轮真实 provider 调用次数：0。
