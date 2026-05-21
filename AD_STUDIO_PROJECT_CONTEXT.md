# Ad Studio Project Context

本文件用于记录 Ad Studio 项目的关键共识，避免上下文压缩、切换 Codex 线程或并行开发时丢失产品判断。后续重要产品决策、模块边界、参考项目结论都应追加到这里。

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

当前是 HTML/CSS/JS 静态原型阶段，核心文件：

- `index.html`：页面结构，包含 Home、Agent、Agent Setup、Workbench、Video、Image、Templates、Assets。
- `styles.css`：当前视觉样式。
- `app.js`：路由切换、Agent setup wizard、模板预填、节点详情 drawer 等交互。
- `AD_STUDIO_PRODUCT_ARCHITECTURE.md`：较完整的产品架构文档。
- `assets/`：当前原型使用的图片素材。

当前目录不是 Git 仓库。多线程并行开发时要注意文件覆盖风险。

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

## 2026-05-17 模板素材 Schema 决策

- 背景：模板模块需要支持“新用户提交产品链接后推荐可用广告模板”，同时区分真实爆款广告和可直接生成的 AI 模板。
- 决策：模板素材分成两条路径：AI 模板库负责可公开 prompt、可替换槽位、可直接进入 Ad Video / Ad Image 的模板；爆款广告库负责展示真实投放广告和效果数据，并通过 Agent 复刻流程完成客观拆解和迁移。
- 决策：所有视频先进入统一的客观拆解底座，记录时间码、画面、对白、字幕、镜头、产品露出、CTA、指标和风险；之后按视频形态映射到固定脚本 schema，而不是让大模型自由输出。
- 决策：第一版固定 5 个脚本 schema：`ugc_demo`、`app_demo_hook`、`story_hook_cta`、`cinematic_tvc`、`replicate_ad`。
- 决策：Topview 风格的“绿色字可编辑”必须落成数据结构。固定文本、可编辑槽位、参考素材分别用 `text`、`slot`、`asset` token 表达，UI 只是这些 token 的渲染结果。
- 影响模块：`src/lib/mock-data/templates.ts`、`src/lib/domain/schemas.ts`、`src/features/templates`、`src/components/app-shell/AdStudioApp.tsx`，以及后续 Agent 复刻输入协议。
- 后续动作：先做 AI 模板库详情弹窗、绿色槽位编辑和 mock 数据；真实爆款广告库、视频理解拆解和外部数据源放到下一阶段。
- 详细协议：见 `AD_STUDIO_TEMPLATE_SCHEMA.md`。
