# Ad Studio Template Material Schema

本文件固化模板素材模块的产品协议。目标是让模板库不只是预填 prompt 的卡片，而是能持续沉淀“已验证广告结构”和“可生成模板”的系统。

## 1. 核心结论

模板素材模块分成两条路径：

```text
AI 模板库
自家跑通过的视频 / 图片模板 -> 可公开 prompt、可替换槽位、可直接生成

爆款广告库
真实投放广告 + 效果数据 -> 不直接暴露成 prompt，进入 Agent 复刻流程
```

这两条路径不能混成一个概念。

- AI 模板库解决“我马上想生成一条类似广告”。
- 爆款广告库解决“我想基于被市场验证过的广告结构做复刻”。

## 2. 模板模块边界

模板侧负责：

- 定义广告脚本 schema。
- 展示可生成模板详情弹窗。
- 管理 prompt、参考素材、可替换槽位、模型参数。
- 从产品包或产品 URL 解析结果中填充模板槽位。
- 为 Agent 提供已结构化的复刻输入。

Agent 侧负责：

- 对真实爆款广告执行客观拆解。
- 把拆解结果迁移到用户产品。
- 推进脚本、分镜、资产锚点和最终视频生成。

模板页点击逻辑：

```text
AI 模板卡片 -> 模板详情弹窗 -> 使用模板 -> Ad Video / Ad Image 预填表单

真实爆款广告卡片 -> 数据详情弹窗 -> 在 Agent 中复刻 -> Agent clone setup / workbench
```

## 3. 通用客观拆解

所有视频都先尝试进入同一层“客观拆解”。这一层只记录视频事实，不做创意改写。

```ts
type ObjectiveBreakdown = {
  source: {
    url?: string;
    platform?: "tiktok" | "meta" | "youtube" | "upload" | "internal";
    durationSec: number;
    region?: string;
    industry?: string;
    metrics?: {
      views?: number;
      estimatedRevenue?: number;
      roas?: number;
      engagementRate?: number;
      spend?: number;
      conversions?: number;
      collectedAt?: string;
    };
  };
  timeline: TimelineSegment[];
  transcript?: TranscriptSegment[];
  detectedAssets: DetectedAsset[];
  cta?: string;
  claims: string[];
  riskNotes: string[];
};

type TimelineSegment = {
  startSec: number;
  endSec: number;
  visual: string;
  camera?: string;
  subject?: string;
  scene?: string;
  productExposure?: "none" | "partial" | "clear" | "hero";
  onScreenText?: string;
  dialogue?: string;
  musicOrSfx?: string;
  emotion?: string;
};

type TranscriptSegment = {
  startSec: number;
  endSec: number;
  text: string;
  speaker?: string;
};

type DetectedAsset = {
  kind: "product" | "app_ui" | "logo" | "person" | "scene" | "prop" | "subtitle";
  description: string;
  timeRange?: string;
};
```

注意：

- 不是所有视频都适合模板化。
- 客观拆解可以失败或低置信度。
- 数据表现好不等于可生成、可复刻或可合法复用。

## 4. 脚本 Schema 家族

客观拆解之后，先判断视频属于哪一种广告形态，再进入对应 schema。不要让大模型自由输出，也不要把所有视频硬塞进一个结构。

第一版固定 5 个 schema。

### 4.1 UGC Demo

适用于商品演示、开箱、达人种草、生活方式推荐。

```ts
type UGCVideoTemplate = {
  schema: "ugc_demo";
  duration: string;
  shootingEquipment: string;
  videoStyle: string;
  music: string;
  specialEffects: string[];
  goldenFirst3Seconds: SlotRichText;
  content: SlotRichText;
  scriptText: SlotRichText;
  language: string;
};
```

推荐槽位：

```text
product_name
product_image
pain_point
main_benefit
usage_scene
proof
cta
creator_style
```

### 4.2 App Demo Hook

适用于 App 功能展示、警报 Hook、手机 UI、工具类 App、游戏试玩的强钩子开场。

```ts
type AppDemoHookTemplate = {
  schema: "app_demo_hook";
  duration: string;
  hook: TimedSlotBlock;
  demo: TimedSlotBlock;
  proofOrRelief: TimedSlotBlock;
  cta: TimedSlotBlock;
  phoneUiRequirements: SlotRichText;
  subtitleStyle: string;
  language: string;
};
```

推荐槽位：

```text
product_name
app_ui
target_user
pain_point
feature
benefit
proof
cta
```

### 4.3 Story Hook CTA

适用于剧情广告、幽默广告、冲突广告、服务类广告、TVC 短剧情。

```ts
type StoryHookCtaTemplate = {
  schema: "story_hook_cta";
  style: string;
  hook: TimedSlotBlock;
  content: TimedSlotBlock;
  cta: TimedSlotBlock;
  dialogue: SlotRichText;
  sceneRequirements: string;
  language: string;
};
```

推荐槽位：

```text
product_name
character
conflict
pain_point
solution
service_scene
brand_asset
cta
```

### 4.4 Cinematic TVC

适用于品牌质感片、3D 商品展示、珠宝/美妆/电子产品展示、电影感广告。

```ts
type CinematicTvcTemplate = {
  schema: "cinematic_tvc";
  duration: string;
  subject: SlotRichText;
  mood: string;
  visualNarrative: SlotRichText;
  camera: string;
  lighting: string;
  composition: string;
  productBeautyShot: SlotRichText;
  negativeConstraints: string[];
  referenceAssets: ReferenceAssetSlot[];
};
```

推荐槽位：

```text
product_image
product_name
material
brand_mood
hero_feature
logo
negative_constraints
```

### 4.5 Replicate Ad

适用于真实爆款广告进入 Agent 复刻。它不是直接生成模板，而是复刻流程的中间脚本。

```ts
type ReplicateAdTemplate = {
  schema: "replicate_ad";
  rewriteInstruction: string;
  originalStyle: string;
  compressedDuration: string;
  timedShots: TimedSlotBlock[];
  dialogue: SlotRichText;
  replacementRules: string[];
  unsafeToCopy: string[];
};
```

默认元指令：

```text
Rewrite the script below to promote the user's product. Preserve the advertising structure, pacing, and proof logic, but replace the original product, usage logic, plot, visual descriptions, claims, brand elements, and CTA with new ones based on the user's product package. Do not copy protected brand assets or unverifiable claims.
```

推荐槽位：

```text
user_product
target_audience
usp
usage_logic
visual_replacement
proof
cta
```

## 5. 绿色槽位协议

Topview 的“绿色字可编辑”在 Ad Studio 中必须变成数据结构，而不是只靠样式。

```ts
type SlotRichText = Array<TextToken | SlotToken | AssetToken>;

type TextToken = {
  type: "text";
  value: string;
};

type SlotToken = {
  type: "slot";
  key: string;
  label: string;
  value: string;
  editable: true;
  required: boolean;
  source?: "template" | "product_pack" | "user_input" | "agent_rewrite";
};

type AssetToken = {
  type: "asset";
  key: string;
  label: string;
  accept: Array<"image" | "video" | "logo" | "app_ui">;
  required: boolean;
  value?: string;
};

type TimedSlotBlock = {
  startSec: number;
  endSec: number;
  content: SlotRichText;
};

type ReferenceAssetSlot = {
  key: string;
  label: string;
  kind: "image" | "video" | "logo" | "app_ui";
  required: boolean;
  previewUrl?: string;
};
```

UI 规则：

- `text` 是固定结构，默认黑色/普通文字。
- `slot` 是可替换内容，展示为绿色可编辑文本。
- `asset` 是 `@Image 1`、`@Video 1`、`@Logo 1` 这类引用槽。
- 产品 URL 解析出的产品名、卖点、图片、App UI 优先填入 slot 和 asset。
- 用户点击“使用模板”时，最终 prompt 由这些 token 渲染出来。

## 6. 模板详情弹窗

AI 模板详情弹窗第一版字段：

```text
左侧
- 自动播放 preview video / preview image
- 缩略参考素材

右侧
- 标题
- 适用行业 / 视频形态 / 渠道
- 验证状态：Prompt tested / Human verified / Internal generated
- 可编辑绿色槽位
- 完整 prompt 或脚本 schema
- 模型、比例、清晰度、时长、credits
- Use template / Generate
```

爆款广告详情弹窗字段：

```text
左侧
- 真实广告视频

右侧
- 数据来源
- 地区 / 行业 / 时间窗口
- views / estimated revenue / ROAS / engagement rate
- 客观广告信息
- 在 Agent 中复刻
```

## 7. 模板化判定

真实视频拆解后必须进入三种结果之一：

```text
可模板化
结构清晰，槽位可替换，能用自有素材生成出相似广告结构。

仅可复刻
视频有效，但强依赖真人、事件、品牌、版权素材或真实场景，只能进入 Agent 复刻。

丢弃
数据好但结构不可复用、风险高、无法生成或与产品品类不匹配。
```

## 8. 第一版实现顺序

P0：

1. 扩展模板 mock 数据，加入 `schema`、`slots`、`referenceAssets`、`previewVideoUrl`、`verificationStatus`。
2. 增加模板详情弹窗，卡片点击先打开弹窗，不直接套用。
3. 做绿色槽位编辑 UI。
4. `Use template` 继续复用现有 Ad Video / Ad Image 预填逻辑。
5. 手写 5-10 条 AI 模板样例，不先接外部广告库。

P1：

1. 增加爆款广告库 tab。
2. 接 TikTok / Meta 等公开广告数据源或先用 mock 数据。
3. 真实广告点击后进入 Agent 复刻。
4. 接入视频理解模型，输出 `ObjectiveBreakdown` + `replicate_ad`。

P2：

1. 效果数据回流。
2. 根据真实生成成功率和投放效果给模板排序。
3. 建立模板版本、验证记录和淘汰机制。
