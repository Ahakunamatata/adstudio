# AD Studio Agent M3.3 对话回归验收

版本：2026-05-22  
范围：M3.2 关键用户路径的自动化回归、真实 provider smoke 边界、PM 可读验收清单  
非范围：不修改 Agent runtime 主流程，不接 ToolLoopAgent，不改 provider，不调用真实生成。

## 1. 验收目标

M3.3 不是新增 Agent 能力，而是把 M3.2 已通过审计的关键交互固化成后续线程可重复运行的验收入口。

核心原则：

- UI / state-flow 回归默认使用 mock provider，避免 KIE 或真实模型尾延迟影响验收稳定性。
- 真实 provider 只做 opt-in smoke，用来确认真实通道可用或失败时 UI 边界仍成立。
- 所有路径都必须保持 `/api/vidu/generate` 为 0，画布保持 `0 nodes · 0 links · 0 credits`。
- 用户可见 UI 不能泄露内部词，例如 `runtime`、`workspace`、`snapshot`、`schema`、`Zod`、`fallbackReason`、`provider`、`M3.2`。

## 2. 自动化命令

稳定回归：

```bash
corepack pnpm accept:m33
```

完整验收建议：

```bash
corepack pnpm exec tsc --noEmit
corepack pnpm lint
corepack pnpm build
corepack pnpm accept:m32
corepack pnpm accept:m33
```

真实 provider smoke 需要显式开启：

```bash
M33_REAL_PROVIDER_SMOKE=1 corepack pnpm accept:m33
```

如果要让真实 provider 不可用也阻塞验收，再加严格模式：

```bash
M33_REAL_PROVIDER_SMOKE=1 M33_REAL_PROVIDER_STRICT=1 corepack pnpm accept:m33
```

## 3. Mock 回归与真实 Smoke 边界

| 类型 | 默认运行 | Provider | 失败含义 |
| --- | --- | --- | --- |
| Mock provider 回归 | 是 | Playwright 拦截 `/api/agent/decide` | UI/state-flow 回归，必须修 |
| M3.2 baseline | 是 | 复用 `scripts/m32-acceptance.mjs` 的 mock | M3.2 已验收路径被破坏 |
| 真实 provider smoke | 否 | 不拦截 `/api/agent/decide` | 默认只记录真实通道状态；严格模式才因 provider 不可用失败 |

真实 provider smoke 的通过标准不是“模型一定成功回答”，而是：

- 成功时 UI 不泄露内部词。
- 失败或超时时 UI 显示友好重试/失败状态。
- 不打开错误业务卡片。
- 不调用 `/api/vidu/generate`。
- 画布仍是 `0 nodes · 0 links · 0 credits`。

## 4. Case 覆盖映射

| Case | 自动化覆盖 |
| --- | --- |
| `hi` 不污染任务 | `scripts/m32-acceptance.mjs`，由 `accept:m33` 委托执行 |
| `我要复刻一个广告` | `scripts/m32-acceptance.mjs`，由 `accept:m33` 委托执行 |
| `产品还没准备好` | `scripts/m32-acceptance.mjs`，由 `accept:m33` 委托执行 |
| 上传参考素材 | `scripts/m32-acceptance.mjs`，卡片上传 PNG fixture |
| 填写参考素材描述 | `scripts/m33-regression.mjs`，文本描述提交不依赖上传 |
| `产品是 location tracker` | `scripts/m32-acceptance.mjs`，由 `accept:m33` 委托执行 |
| `先不要生成` | `scripts/m32-acceptance.mjs`，由 `accept:m33` 委托执行 |
| 刷新恢复 | `scripts/m32-acceptance.mjs`，由 `accept:m33` 委托执行 |
| 首页创建第二个新任务 | `scripts/m33-regression.mjs`，验证新 session 隔离 |
| provider 失败友好 retry | `scripts/m32-acceptance.mjs`；真实 smoke 可额外验证 |
| UI 不出现内部词 | M3.2 baseline + M3.3 新增 case 都检查 |
| `/api/vidu/generate` 为 0 | M3.2 baseline + M3.3 新增 case 都检查 |
| canvas 0 nodes / 0 links / 0 credits | M3.2 baseline + M3.3 新增 case 都检查 |

## 5. PM 手工验收清单

### A. 寒暄不污染任务

- 在 Workbench 输入 `hi`。
- 看到自然回复，没有出现复刻信息收集卡。
- 项目摘要仍是未开始任务或未指定产品，不出现复刻任务污染。
- 画布显示 `0 nodes · 0 links · 0 credits`。

### B. 复刻广告信息收集

- 输入 `我要复刻一个广告`。
- 看到可操作的信息收集卡，而不是纯文本说明。
- 卡片至少包含参考广告素材/描述、我的产品/要推广的产品、复刻参考方式。
- 必填项未完成时提交按钮不可用。

### C. 参考素材可上传也可填写

- 上传一张参考图片后，卡片可以提交。
- 不上传文件，只填写参考广告描述并选择产品/参考方式，也可以提交。
- 提交后旧卡片显示已提交，Agent 继续追问下一步边界。

### D. 产品稍后补

- 输入 `我想复刻这个竞品，但是产品还没准备好`。
- 卡片不应强制产品必填。
- 再输入 `产品是 location tracker` 后，Agent 应理解为补充上一轮任务，不重新开完整固定流程。

### E. 不生成边界

- 输入 `先不要生成`。
- Agent 明确表示不会进入生成或执行画布动作。
- 不出现“等待确认执行”一类可执行生成确认。

### F. 刷新恢复

- 完成一次信息卡提交后刷新页面。
- 已提交状态仍在，不重复触发 Agent decision。
- 画布仍为 `0 nodes · 0 links · 0 credits`。

### G. 首页第二个新任务

- 在首页创建第一条复刻任务。
- 回到首页，再创建第二条复刻任务。
- Workbench 进入新的项目/session。
- 第一条任务的 prompt 不被第二条任务覆盖。
- 历史项目中可以区分两个任务。

### H. provider 失败友好重试

- 模拟或遇到 provider 失败时，UI 只显示友好失败/重试入口。
- 不展示内部错误字段、provider 原始响应或技术词。
- 不自动打开复刻信息卡，不写入错误业务 brief。

## 6. 后续线程使用说明

- UI/state-flow 相关改动必须跑 `corepack pnpm accept:m33`。
- provider 或 AI SDK 基建线程可以额外跑 `M33_REAL_PROVIDER_SMOKE=1 corepack pnpm accept:m33`，但不要把真实 provider 波动当作 UI 回归。
- 如果新增 M3.2 关键用户路径，优先扩展 `scripts/m33-regression.mjs`；只有 M3.2 原始验收本身变化时，才修改 `scripts/m32-acceptance.mjs`。
