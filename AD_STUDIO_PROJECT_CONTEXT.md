# Ad Studio Project Context

本文件用于记录 Ad Studio 项目的关键共识，避免上下文压缩、切换 Codex 线程或并行开发时丢失产品判断。后续重要产品决策、模块边界、参考项目结论都应追加到这里。

## 文档使用说明

本文件是 Ad Studio 的长期项目共识，不是临时对话记录。

维护规则：

- 只记录已经形成的产品判断、架构边界、实现约定和后续明确动作。
- 不写“我刚才做了什么”“用户说了什么”这类对话过程。
- 对 mock、临时方案、待替换实现必须明确标注边界，避免被后续误认为最终设计。
- 新增内容优先按“背景 / 决策 / 影响模块 / 后续动作”组织。
- 如果旧内容已过时，直接修正文档，不在后面追加相互矛盾的说明。
- 文件路径、入口、状态机、协议字段要尽量具体，方便切换线程后继续开发。

## 1. 产品定位

Ad Studio 是面向广告素材设计师和投放创意团队的 AI 广告生产平台。

它不是单点生图或生视频工具，而是把广告生产链路组织成可控、可追踪、可复用的工作台：

```text
产品理解 -> 竞品拆解 / 创意方向 -> 脚本 -> 锚点资产 -> 分镜图 -> 分镜视频 -> 最终广告视频
```

第一版目标是跑通到可预览、可交付的广告视频结果，不能只停留在策略、脚本或 prompt。

核心用户关心的是：

- 快速得到可用素材。
- 复刻市场上已经验证过的竞品广告结构。
- 控制产品理解、脚本、人物、场景、UI、品牌资产不跑偏。
- 看清每个节点的输入、输出、模型、耗时、成本和版本。

## 2. 产品三层架构

Ad Studio 当前按三层来组织：

```text
深度层：Agent Workbench
工具层：Ad Video / Ad Image
资产层：Products / Assets
```

### 深度层：Agent Workbench

用于复杂广告生产，包括：

- 从 0 生成广告。
- 复刻竞品广告。

Agent Workbench 强依赖产品包。左侧 Agent 对话负责阶段推进和边界确认，右侧 Canvas 负责沉淀节点、结果和证据链。

### Agent Workbench 的核心定义

Agent Workbench 不是“左侧聊天 + 右侧展示”的普通双栏页面，而是一个由 Agent 操作 Canvas 的广告生产工作台。

核心关系：

```text
Agent = 广告生产编排者 / 画布操作者
Canvas = 生产状态、节点关系和结果证据链
Generation = 单个文/图/视频节点的生成能力
Assets = 可复用产品上下文和素材库
```

Agent 的职责不是把所有内容都生成在聊天消息里，而是驱动画布发生明确动作：

- 创建节点。
- 编辑文本、图片、视频节点的内容或参数。
- 连接节点，建立输入输出关系。
- 引用上游节点作为当前节点输入。
- 触发节点生成结果。
- 写入节点输出。
- 追加节点版本。
- 锁定用户确认过的节点结果。
- 标记输入变化后的 `stale` 状态。
- 请求用户确认下一步。

因此左侧 Agent 对话本质上是流程控制台，负责说明当前阶段、收敛决策、发起动作和等待确认；右侧 Canvas 是真实生产状态。Agent 的每一次关键动作都应该能在 Canvas 上留下节点、连线、版本或状态变化，而不是只停留在对话文本里。

### 工具层：Ad Video / Ad Image

用于轻量生成：

- Ad Video：快速生成广告视频、模板预填、数字人口播、商品演示、App Demo 等。
- Ad Image：快速生成广告图片、产品主图、App 素材、社媒投放图等。

它们默认是独立表单入口，不默认进入 Agent 工作台。

但从架构上，Ad Video / Ad Image 不应只当作两个页面。它们也是未来画布中视频节点和图片节点的基础生成与编辑能力。

### 资产层：Products / Assets

用于沉淀可复用资产：

- 产品包。
- Logo / Icon。
- 产品图。
- App UI / 截图。
- 人物参考图。
- 场景参考图。
- 竞品素材。
- 历史生成结果。

产品包是 Agent 工作流必需输入，Ad Video / Ad Image 可选引用。

## 3. 核心用户路径

### 路径 A：复刻竞品广告

这是第一版最重要的 demo 主路径。

```text
首页 -> Agent 复刻广告 -> 选择/创建产品包 -> 上传竞品素材
-> 选择解析重点 -> Agent Workbench
-> 客观拆解 -> 迁移复刻方案 -> 脚本确认
-> 人物 / App UI / 场景锚点 -> 分镜图 -> 分镜视频 -> 最终视频
```

关键要求：

- 解析前必须让用户选择关注重点。
- 拆解结果要分为“客观拆解”和“迁移复刻”。
- 复刻不是抄素材，而是保留结构，替换产品、场景、卖点和 CTA。
- 不允许模型擅自增加当前产品未声明的功能承诺。

### 路径 B：从 0 生成广告

适合用户已经知道要做什么广告，但没有竞品素材。

```text
首页 -> Agent 生成广告 -> 选择/创建产品包 -> 设置国家/语言/渠道/比例/时长
-> Agent Workbench -> 创意方向 x3 -> 选择方向
-> 脚本 -> 锚点资产 -> 分镜图 -> 视频
```

### 路径 C：模板进入

适合用户不知道做什么，先找灵感。

```text
首页模板区 / Templates -> 点击模板 -> Ad Video 或 Ad Image 预填表单
```

模板不是独立工作流，只负责预填 prompt、参考素材、比例、模型参数和槽位。

### 路径 D：空白生成

适合用户只想快速生成图或视频。

```text
首页 / 导航 -> Ad Video 或 Ad Image -> 空白表单 -> 上传参考素材 -> 生成
```

## 4. 当前原型状态

当前项目目录：

```text
/Users/hakunamatata/Desktop/CodeX项目/ads studio
```

当前已经迁移到 Next / React 原型，核心文件：

- `src/components/app-shell/AdStudioApp.tsx`：本地路由、任务入口、全局状态承接。
- `src/features/home/Launcher.tsx`：首页 Agent / Video / Image 输入入口。
- `src/features/workbench/AgentWorkbenchView.tsx`：Agent Workbench 左侧对话与右侧画布装配。
- `src/features/workbench/WorkbenchCanvas.tsx`：基于 `@xyflow/react` 的生产画布。
- `src/features/canvas/types.ts`：画布运行时动作协议。
- `src/features/canvas/actions.ts`：画布 reducer 级业务动作实现。
- `src/features/canvas/events.ts`：浏览器事件方式的 Agent -> Canvas action dispatch。
- `src/lib/domain/schemas.ts`：核心领域类型。
- `src/lib/mock-data/`：当前原型 mock 数据。
- `AD_STUDIO_PRODUCT_ARCHITECTURE.md`：较完整的产品架构文档。

旧的 `index.html`、`styles.css`、`app.js`、`legacy-prototype/` 只作为历史原型参考，不应作为当前实现入口。

## 5. 参考项目与借鉴边界

### open-design

路径：

```text
/Users/hakunamatata/Desktop/CodeX项目/open-design
```

参考范围：

- Agent 左侧对话的实现思路。
- 结构化问题表单。
- 方向选择卡。
- 进度卡。
- 工具执行状态。
- 用户确认后继续推进的交互节奏。

不直接照搬 open-design 的对话规则。Ad Studio 的 Agent 左侧不是泛设计助手，而是广告生产流程控制台。

Ad Studio 里要转化成：

- 产品包确认卡。
- 竞品解析重点卡。
- 复刻方向选择卡。
- 脚本确认卡。
- 锚点资产确认卡。
- 分镜确认卡。
- 执行进度卡。

### xyflow-demo

路径：

```text
/Users/hakunamatata/Desktop/CodeX项目/xyflow-demo
```

本地运行：

```text
http://127.0.0.1:5173/
```

参考范围：

- 右侧画布的基础交互。
- 无限画布。
- 节点卡片设计。
- 连接点。
- 快速创建节点。
- 选中态。
- 节点下方面板。
- 连线视觉和动效。

注意：xyflow-demo 功能偏多，包含一些当前 Ad Studio 不需要的工具栏、会员、素材抽屉、音频/脚本等冗余能力。Ad Studio 只保留广告生产需要的画布能力。

### adframelab-demo v3

路径：

```text
/Users/hakunamatata/Desktop/CodeX项目/adframelab-demo v3
```

本地运行：

```text
http://127.0.0.1:5174/
```

核心参考 `Summer Campaign 2026` 项目的节点逻辑。

参考范围：

- 节点业务关系。
- 阶段链路。
- 输入引用。
- 节点版本。
- 主版本。
- 输入变更后节点 stale / 输入已更新。
- 批量生成。
- 从产品洞察到脚本、角色、场景、分镜、视频的生产链路。

Ad Studio 要继承它的业务节点逻辑，但业务语义需要替换成广告复刻 / 广告生成：

```text
产品包 -> 竞品素材 -> 竞品拆解 -> 复刻方案 -> 脚本
-> 人物 / 场景 / App UI 锚点 -> 分镜图 -> 分镜视频 -> 最终视频
```

### qing-ad-creative-generator

路径：

```text
/Users/hakunamatata/Desktop/CodeX项目/qing-ad-creative-generator
```

本地目标运行地址：

```text
http://localhost:3000/ai
```

说明：当前端口有 Next 进程监听，但本次访问 `/ai` 和 `/` 请求超时，因此暂时主要依据源码和文档判断。

参考范围：

- Ad Video / Ad Image 的生成表单。
- 图片 / 视频任务模型。
- 模型 catalog。
- 参数 schema。
- slot / reference asset 机制。
- 任务状态。
- 生成历史。
- 上传素材。
- AI task 与画布节点解耦的设计。

关键判断：

Ad Video / Ad Image 对用户是轻量生成入口；对架构是画布图片节点和视频节点的基础生成与编辑能力。

因此后续应尽量做成同一个 Generation Composer，可在两个地方复用：

- 独立页面：Ad Video / Ad Image。
- 画布节点：Image Node / Video Node 的生成和编辑面板。

## 6. Canvas 节点方向

画布底层视觉节点先收敛为：

- Text。
- Image。
- Video。

业务层通过字段区分语义：

- `product_pack`
- `product_asset`
- `competitor_asset`
- `competitor_analysis`
- `clone_strategy`
- `creative_concept`
- `ad_script`
- `shot_prompt`
- `character_reference`
- `scene_reference`
- `storyboard_frame`
- `shot_video`
- `final_video`
- `avatar_video`

节点详情至少需要展示：

- 输入。
- 输出。
- 模型。
- 状态。
- 耗时。
- 成本。
- 版本。
- 是否锁定。
- 上游引用。

节点重要状态：

- `draft`
- `queued`
- `running`
- `succeeded`
- `failed`
- `stale`
- `locked`

`stale` 表示节点保留旧结果，但当前输入已经变化，需要重新运行。

### Agent / Canvas 行为契约

在实现左侧 Agent 编排之前，需要先让 Canvas Core 能承载 Agent 未来要执行的动作。不要先做一个完全泛用白板，再回头硬套 Agent。

Canvas 需要优先支持这些动作：

- `createNode`：创建业务节点，例如产品包、竞品素材、竞品拆解、脚本、分镜图、视频。
- `updateNodeContent`：编辑节点文本、prompt、参数、素材引用或生成结果。
- `connectNodes`：连接上游输入和下游节点。
- `disconnectNodes`：断开连接，但保留已生成内容。
- `runNodeGeneration`：触发节点生成任务。
- `appendNodeVersion`：为节点追加新版本。
- `setPrimaryVersion`：选择某个版本作为当前展示结果。
- `lockNode`：锁定用户确认过的人物、场景、产品 UI、脚本或分镜结果。
- `markNodeStale`：当上游主版本变化或输入连接变化时，标记下游节点输入已更新。
- `openNodeDetail`：查看输入、输出、模型、耗时、成本、版本和引用关系。

推荐实现顺序：

```text
1. Canvas 节点模型和交互
2. Canvas 节点生成面板接入 Ad Video / Ad Image Composer
3. Agent / Canvas 事件契约
4. 左侧 Agent 流程卡片和阶段状态
5. 真实 Agent 编排策略
```

这个顺序的原因是：Canvas 稳定后，Agent 左侧只需要驱动同一套节点操作；否则左侧对话容易变成和画布割裂的聊天 UI。

## 7. Codex 多线程开发建议

当前还在 HTML 原型阶段，多个线程同时修改 `index.html`、`styles.css`、`app.js` 有覆盖风险。

建议按模块拆线程和文件边界：

### 架构线程

负责：

- 产品架构。
- 核心数据结构。
- 关键决策记录。
- 模块边界。

主要文件：

- `AD_STUDIO_PRODUCT_ARCHITECTURE.md`
- `AD_STUDIO_PROJECT_CONTEXT.md`

### Agent 对话线程

负责：

- 左侧 Agent 对话流程。
- 结构化确认卡。
- 进度卡。
- 方向选择卡。
- Agent setup wizard。

参考 open-design。

### Canvas 线程

负责：

- 右侧画布。
- 节点布局。
- 节点卡片。
- 连线。
- 节点详情面板。

视觉交互参考 xyflow-demo，业务逻辑参考 adframelab-demo v3。

### 节点逻辑线程

负责：

- 节点类型。
- 节点业务语义。
- 输入引用。
- 版本。
- locked / stale。
- 节点状态流转。

核心参考 adframelab-demo v3。

### Video / Image 线程

负责：

- Ad Video 表单。
- Ad Image 表单。
- 模板预填。
- 生成参数。
- 上传参考素材。
- 生成历史。

参考 qing-ad-creative-generator。

后续需要将该模块抽象为可复用的 Generation Composer，供独立页面和画布节点共同使用。

### Assets 线程

负责：

- 产品包。
- 产品 URL 导入。
- 产品包确认。
- 资产库。
- 人物 / 场景 / UI / Logo / 竞品素材 / 历史结果。

## 8. 后续记录规则

后续每次形成关键结论，优先追加到本文件，格式建议：

```text
## YYYY-MM-DD 决策标题

- 背景：
- 决策：
- 影响模块：
- 后续动作：
```

不要把临时想法和未确认方案混进正式决策。未确认内容可以放到“待确认”小节。

## 2026-05-17 Agent 编排与 Mock 边界决策

### 决策摘要

Agent Workbench 的新建项目必须从空白生产链路开始。首页 Agent 输入框承接第一版自然语言需求和素材 metadata，点击创建后进入工作台；进入工作台后，Agent 先理解需求、识别缺口、逐轮追问，把关键边界补齐，再通过确认卡逐步驱动画布。

Agent 模块只保留一个 demo 项目用于展示完整画布能力。除 demo 外，所有新建 Agent 项目不预置脚本、锚点、分镜、视频等下游节点。

当前阶段仍然不接真实后端、不接真实模型 API。实现目标是验证 Agent 编排逻辑和画布动作协议，而不是评估真实素材质量。

### 项目模式

Agent Workbench 明确区分两种项目模式：

```text
blank：新建 Agent 项目，从空白画布开始，由 Agent 按确认批次逐步创建节点。
demo：唯一保留的 Family Locator 示例项目，预置完整链路，用于展示画布能力。
```

新建项目默认使用 `blank`。demo 项目只能通过示例入口打开，不能作为新建项目的默认初始状态。

### 当前编排实现

当前 Agent 是 deterministic mock orchestrator：

```text
首页输入 / 素材元信息
-> AgentSession
-> AgentRuntimeState
-> mock intent router
-> message / question / confirmation / action trace
-> CanvasRuntimeAction[]
-> WorkbenchCanvas reducer
-> 节点、连线、状态、版本变化
```

它不是最终 Agent，也不是固定 wizard。它承担两个设计验证作用：

- 产品交互验证：验证“先输入初始需求 -> Agent 追问 -> 用户确认 -> Agent 操作画布”的体验是否成立。
- 协议验证：验证 `CanvasRuntimeAction` 是否足够支撑 Agent 创建节点、更新节点、连接节点、运行生成、标记 stale 和打开详情。

### 当前入口逻辑

首页 `Launcher` 现在保留三类素材入口：

- 产品包：默认 `Family Locator`。
- 竞品素材：用户可选择图片或视频文件，当前只保存文件名、类型和角色，不做真实上传。
- 参考素材：用户可选择图片或视频文件，当前同样只保存 metadata。

点击创建箭头后：

- `AdStudioApp.startAgent()` 创建 `AgentSession`。
- `AgentSession.originalPrompt` 保存用户第一版输入。
- `AgentSession.uploadedAssets` 保存产品包、竞品素材、参考素材 metadata。
- 路由直接进入 `workbench`。

相关文件：

- `src/features/home/Launcher.tsx`
- `src/components/app-shell/AdStudioApp.tsx`
- `src/features/agent/agent-session.ts`
- `src/lib/domain/schemas.ts`

### Agent Runtime 状态

当前工作台左侧不再依赖旧的 `currentStepIndex` wizard 作为主逻辑，而是维护 `AgentRuntimeState`。

核心字段：

- `stage`：当前阶段。
- `brief`：Agent 从 session 和用户输入中理解出的生产边界。
- `messages`：用户消息、Agent 消息、结构化问题卡、确认卡、动作追踪卡。
- `pendingConfirmation`：等待用户确认的下一批画布动作。
- `nodeRefs`：语义节点引用，例如产品包、竞品素材、拆解、复刻方案、脚本、App UI、人物、场景、分镜、最终视频。
- `actionHistory`：已执行的 action batch 记录。

当前阶段枚举：

```text
collecting
awaiting_confirmation
script_review
asset_review
storyboard_review
rework
```

相关文件：

- `src/features/workbench/agent-types.ts`
- `src/features/workbench/agent-orchestrator.ts`
- `src/features/workbench/AgentWorkbenchView.tsx`

### 当前对话策略

Agent 当前按“少量关键边界追问”工作，不做一次性大表。

它会优先识别这些边界：

- 参考程度：严格复刻剧情，还是只参考节奏和叙事结构。
- 主体表达：生活场景为主，还是 App 演示为主。
- 字幕/配音：是否需要泰语配音、硬字幕。
- 产品和规格：产品名、国家/语言、渠道、比例、时长。
- 竞品素材：如果未上传，允许先使用 mock 参考素材占位。

当边界不足时，Agent 发送 question card，例如：

- 用推荐边界继续。
- 严格复刻剧情。
- 只参考节奏结构。

当边界足够时，Agent 不直接生成视频，而是先给 confirmation card，明确说明即将执行哪些画布动作。

### 当前确认批次

当前 mock Agent 设计了三个主确认批次和两个返工批次。

#### 1. 复刻方案确认

目标：先更新产品包、竞品素材、竞品拆解和复刻方案。

动作包括：

- 创建 / 更新产品资料包节点。
- 创建 / 更新竞品素材节点。
- 创建并运行竞品客观拆解节点。
- 创建 / 更新 `复刻方案 · Anchor First` 节点。
- 打开复刻方案节点详情。

产品判断：

- Agent 不应跳过竞品拆解直接生成脚本。
- 参考程度必须先锁定，否则后续脚本容易被模型擅自改写。

#### 2. 脚本与锚点确认

目标：先锁定脚本和稳定输入源，再进入分镜。

动作包括：

- 创建 `15s 泰语广告脚本` 节点。
- 将产品包、竞品拆解、复刻方案连接到脚本节点。
- 锁定脚本节点。
- 创建 / 更新并锁定 App UI / Icon 锚点。
- 创建 / 更新并锁定泰国母亲人物定妆图。
- 创建 / 更新曼谷夜晚街景锚点。

产品判断：

- 人物、App UI/icon、场景图属于 Anchor First 资产。
- 后续分镜图和视频必须引用这些锚点，不能让每个分镜自行发散。

#### 3. 分镜图与分镜视频确认

目标：按 C1-C4 逐镜生成 prompt、分镜图、分镜视频。

动作包括：

- 生成 C1-C4 分镜 prompt 节点。
- 生成 C1-C4 分镜图节点。
- 生成 C1-C4 分镜视频节点。
- 每个视频节点连接对应 prompt、分镜图、App UI/icon。
- 最终视频节点只做汇总，便于局部返工。

产品判断：

- 视频 prompt 必须逐镜自包含，不能写“上一镜头”“下一镜头”。
- 分镜视频要拆成独立节点，避免某一段不准时整条视频重做。

#### 4. icon / 品牌锚点返工

触发方式：

- 用户点击 `icon 不准`。
- 或输入包含 `icon`、`logo`、`图标`、`品牌名`、`名字不对` 等内容。

动作包括：

- 创建 `官方 App Icon 锚点` upload 节点。
- 连接到 App UI 和 C4 视频。
- 标记 App UI、C4、最终视频 stale。
- 打开官方 icon 节点详情。

产品判断：

- 这类问题通常是锚点资产问题，不应该重写整条脚本。
- 用户应上传真实官方 icon，作为后续 CTA 和 App UI 的最高优先级输入。

#### 5. 字幕返工

触发方式：

- 用户点击 `加字幕`。
- 或输入包含 `字幕`、`subtitle` 的内容。

动作包括：

- 更新最终视频节点为泰语硬字幕版。
- 标记 C1-C4 视频节点 stale。
- 写入字幕规范：底部居中、高对比、不遮挡 App UI。

产品判断：

- 字幕属于视频合成层改动，不应改脚本和锚点资产。

### Canvas Action 协议增强

当前为了让 Agent 能稳定操作画布，对 `CanvasRuntimeAction` 做了小幅增强。

`createNode` 现在支持：

- `id`：Agent 可以传确定性节点 ID，后续 action 能稳定引用。
- `title`
- `input`
- `output`
- `model`
- `status`
- `locked`
- `previewClass`
- `settings`

`runNodeGeneration` 现在支持：

- `content`：mock 生成完成后追加的版本内容。
- `delayMs`：mock 生成延迟。

新增：

- `dispatchCanvasActions(actions, delayMs)`：批量派发画布动作。

相关文件：

- `src/features/canvas/types.ts`
- `src/features/canvas/actions.ts`
- `src/features/canvas/events.ts`
- `src/features/workbench/WorkbenchCanvas.tsx`

### Mock 数据边界

预置完整生产链路会干扰 Agent 编排判断，因此 mock 必须分层收敛：

#### 1. Demo 画布 mock

只允许 demo 项目使用 `src/lib/mock-data/nodes.ts` 中的完整广告链路：

```text
产品包 -> App UI -> 竞品视频 -> 客观拆解 -> 复刻方案
-> 人物 / 场景 / C1 Prompt -> C1 分镜图 -> 最终视频
```

该链路仅用于展示画布能力，不用于新建 Agent 项目。

#### 2. 新建项目初始状态

新建 Agent 项目初始画布为空。用户输入的产品包、竞品素材、参考素材先进入 `AgentSession`，由 Agent 在用户确认后通过 `CanvasRuntimeAction[]` 创建产品包、竞品素材、拆解、方案、脚本、锚点、分镜和视频节点。

#### 3. Agent 编排 mock

`agent-orchestrator.ts` 使用关键词和固定规则理解用户输入：

- 不调用 LLM。
- 不解析真实文件。
- 不读取真实产品链接。
- 不生成真实脚本或素材。

它只模拟广告生产 Agent 的决策节奏和画布动作顺序。

#### 4. 生成结果 mock

画布节点运行时只通过 `setTimeout` 模拟生成：

- `runNodeGeneration` 设置 running。
- 延迟后 `appendNodeVersion` 写入 mock 内容。
- 图片和视频不会产生真实媒体文件。

### 当前效果评估口径

当前版本不适合评估“素材质量”，只适合评估以下问题：

- 用户从首页输入第一版需求后，是否能自然进入工作台。
- Agent 是否主动追问关键边界，而不是要求用户填大表。
- Agent 是否在重要动作前给出确认卡。
- 用户确认后，右侧画布是否真实发生节点、连线、状态、版本变化。
- Agent 是否遵守 Anchor First：先脚本和锚点，再分镜图和视频。
- 返工是否局部化，例如 icon 问题只影响 App UI、C4、最终视频。

### 后续动作

真实化路径：

1. 将 `agent-orchestrator.ts` 的关键词 intent router 替换为真实 LLM tool-calling。
2. 将 `CanvasRuntimeAction[]` 保持为工具调用协议，不要让模型直接改 React state。
3. 将上传素材从 metadata mock 替换为真实 asset record。
4. 将 node generation mock 替换为真实任务系统，但保留 running / succeeded / failed / stale 状态。
5. 将 nodeRefs 从固定 ID 扩展为 Agent-managed reference registry。
