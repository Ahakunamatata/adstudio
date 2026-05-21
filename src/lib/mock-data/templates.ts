import type {
  Template,
  TemplateFormat,
  TemplateIndustry,
  TemplateRichTextToken,
  WinningAd
} from "@/lib/domain/schemas";

export type TemplateIndustryMeta = {
  id: TemplateIndustry;
  label: string;
  summary: string;
  thumbClass: string;
};

export const templateIndustries: TemplateIndustryMeta[] = [
  { id: "ecommerce", label: "电商零售", summary: "服饰、美妆、家居、日用、3C、宠物用品", thumbClass: "thumb-industry-ecommerce" },
  { id: "food-beverage", label: "食品饮料", summary: "餐饮品牌、零食、保健品、酒水", thumbClass: "thumb-industry-food" },
  { id: "health", label: "健康医疗", summary: "健身、护肤、个护、医美、营养品", thumbClass: "thumb-industry-health" },
  { id: "app", label: "App 工具", summary: "工具类、效率、安全、社交、生活服务", thumbClass: "thumb-industry-app" },
  { id: "game", label: "游戏", summary: "手游、休闲游戏、试玩、电竞", thumbClass: "thumb-industry-game" },
  { id: "finance", label: "金融", summary: "银行、保险、投资、加密、信贷", thumbClass: "thumb-industry-finance" },
  { id: "education", label: "教育", summary: "K12、语言学习、技能培训、在线课程", thumbClass: "thumb-industry-education" },
  { id: "travel", label: "旅行出行", summary: "酒店、机票、本地服务、出行", thumbClass: "thumb-industry-travel" },
  { id: "saas", label: "B2B / SaaS", summary: "企业软件、订阅服务、办公协作", thumbClass: "thumb-industry-saas" },
  { id: "real-estate-auto", label: "房产汽车", summary: "房产、汽车、大宗消费", thumbClass: "thumb-industry-realestate" }
];

export const templateIndustryMap = Object.fromEntries(
  templateIndustries.map((industry) => [industry.id, industry])
) as Record<TemplateIndustry, TemplateIndustryMeta>;

export type TemplateFormatMeta = {
  id: TemplateFormat;
  label: string;
  summary: string;
};

export const templateFormats: TemplateFormatMeta[] = [
  { id: "ugc", label: "UGC 短视频", summary: "真人感、对镜口述、生活场景" },
  { id: "app-demo", label: "App / 游戏 Demo", summary: "截屏 + Hook + 安装 CTA" },
  { id: "avatar", label: "数字人口播", summary: "AI Avatar 单人讲产品" },
  { id: "tvc", label: "商品演示", summary: "电商主图、TVC、商品镜头" },
  { id: "clone", label: "爆款复刻", summary: "从真实广告拆解的元指令脚本" }
];

export const templateFormatMap = Object.fromEntries(
  templateFormats.map((format) => [format.id, format])
) as Record<TemplateFormat, TemplateFormatMeta>;

// Legacy mixed-dimension categories are kept for HomeView/TemplateShowcase until that carousel moves to industry browsing.
export const templateCategories = [
  { id: "tiktok", label: "TikTok Ads", summary: "高强度开场与移动端转化模板" },
  { id: "youtube", label: "YouTube Shorts", summary: "评测、对比和推荐型短视频" },
  { id: "app", label: "App", summary: "App 功能展示、警报 Hook 和口播解释" },
  { id: "ecommerce", label: "Ecommerce", summary: "商品演示、主图和促销转化素材" },
  { id: "ugc", label: "UGC", summary: "生活化口吻和创作者视角模板" },
  { id: "viral", label: "Viral Hook", summary: "游戏、冲突、惊讶和强钩子素材" }
];

export const winningAdFilters = [
  { id: "all", label: "全部" },
  { id: "Ecommerce", label: "Ecommerce" },
  { id: "App", label: "App" },
  { id: "Local Services", label: "Local Services" },
  { id: "Beauty", label: "Beauty" },
  { id: "Game", label: "Game" }
];

function text(value: string): TemplateRichTextToken {
  return { type: "text", value };
}

function slot(
  key: string,
  label: string,
  value: string,
  source: "template" | "product_pack" | "user_input" | "agent_rewrite" = "template"
): TemplateRichTextToken {
  return { type: "slot", key, label, value, editable: true, required: true, source };
}

function asset(
  key: string,
  label: string,
  accept: Array<"image" | "video" | "logo" | "app_ui">,
  previewUrl?: string
): TemplateRichTextToken {
  return { type: "asset", key, label, accept, required: true, previewUrl };
}

function block(label: string, startSec: number, endSec: number, content: TemplateRichTextToken[]) {
  return { label, startSec, endSec, content };
}

export const templates: Template[] = [
  {
    id: "tiktok-app",
    title: "TikTok App 危机 Hook",
    route: "video",
    toast: "已套用 TikTok App 危机 Hook 模板",
    categoryIds: ["tiktok", "app", "viral"],
    meta: ["Video", "TikTok"],
    thumbClass: "thumb-app",
    label: "APP ALERT VIDEO",
    industry: "app",
    format: "app-demo",
    recommendedModel: "Seedance 2.0",
    defaultRatio: "9:16",
    defaultDuration: "15s",
    requiredSlots: ["product_pack", "app_ui", "cta"],
    schema: "app_demo_hook",
    summary: "用强焦虑开场承接 App 功能证明，适合定位、安全、提醒、效率工具类产品。",
    verificationStatus: "Prompt tested",
    verticals: ["App", "Family Safety", "Utility"],
    formats: ["App Demo Hook", "TikTok", "9:16"],
    funnelStage: "Conversion",
    previewAsset: "/assets/thumb-app-alert.png",
    credits: "7.5 credits",
    prompt:
      "15s vertical TikTok app ad. Open with a tense hook: a parent checks why the child has not arrived home. Show a realistic phone alert, anxious expression, then relief after Family Locator confirms the location. Thai language, bold subtitles, cinematic handheld shots, clear CTA.",
    scriptBlocks: [
      block("Hook", 0, 3, [
        text("Parent checks the phone and realizes "),
        slot("pain_point", "Pain point", "the child has not arrived home", "product_pack"),
        text(". Add bold subtitle: "),
        slot("hook_line", "Hook line", "Why is she still not home?")
      ]),
      block("Demo", 4, 11, [
        text("Show "),
        asset("app_ui", "@Image 1 App UI", ["app_ui"], "/assets/asset-app-ui.png"),
        text(" with live location update, route status, and safety alert for "),
        slot("product_name", "Product", "Family Locator", "product_pack"),
        text(".")
      ]),
      block("CTA", 12, 15, [
        text("Parent relaxes. End with logo and CTA: "),
        slot("cta", "CTA", "Download Family Locator today", "product_pack"),
        text(".")
      ])
    ],
    referenceAssets: [
      { key: "app_ui", label: "App UI", kind: "app_ui", required: true, previewUrl: "/assets/asset-app-ui.png" },
      { key: "parent_scene", label: "Parent scene", kind: "image", required: false, previewUrl: "/assets/asset-thai-mother.png" }
    ]
  },
  {
    id: "ugc-product",
    title: "商品演示 UGC",
    route: "video",
    toast: "已套用商品演示 UGC 模板",
    categoryIds: ["tiktok", "youtube", "ecommerce", "ugc", "viral"],
    meta: ["Video", "Ecommerce"],
    thumbClass: "thumb-kitchen",
    label: "UGC PRODUCT DEMO",
    industry: "ecommerce",
    format: "ugc",
    recommendedModel: "Seedance 2.0",
    defaultRatio: "9:16",
    defaultDuration: "15s",
    requiredSlots: ["product_image", "selling_point", "cta"],
    schema: "ugc_demo",
    summary: "把商品从痛点、上手演示到效果证明压缩成 15 秒 UGC，适合电商冷启动测试。",
    verificationStatus: "Human verified",
    verticals: ["Ecommerce", "Home", "Kitchenware"],
    formats: ["UGC Demo", "Product Commerce", "9:16"],
    funnelStage: "Acquisition",
    previewAsset: "/assets/thumb-ugc-product.png",
    credits: "7.5 credits",
    prompt:
      "one-take user-generated product demo in a bright home environment. Start with a surprising hook, show the product solving a concrete daily pain point, include natural hand movement, warm light, mobile-first vertical framing, end with a short CTA.",
    scriptBlocks: [
      block("Golden First 3 Seconds", 0, 3, [
        text("Creator holds "),
        asset("product_image", "@Image 1 Product", ["image"], "/assets/thumb-ecommerce-packshot.png"),
        text(" and says: "),
        slot("hook_line", "Hook line", "I did not expect this tiny thing to fix my morning routine.")
      ]),
      block("Content", 4, 12, [
        text("Show the product solving "),
        slot("pain_point", "Pain point", "a concrete daily mess", "product_pack"),
        text(" with close-up hand movement and captions for "),
        slot("main_benefit", "Main benefit", "faster, cleaner prep", "product_pack"),
        text(".")
      ]),
      block("CTA", 13, 15, [
        text("Creator points to product and ends with: "),
        slot("cta", "CTA", "Try it before the next restock sells out", "product_pack"),
        text(".")
      ])
    ],
    referenceAssets: [
      { key: "product_image", label: "Product image", kind: "image", required: true, previewUrl: "/assets/thumb-ecommerce-packshot.png" },
      { key: "usage_scene", label: "Usage scene", kind: "image", required: false, previewUrl: "/assets/asset-bangkok-street.png" }
    ]
  },
  {
    id: "avatar",
    title: "App 功能口播",
    route: "video",
    toast: "已套用数字人口播模板",
    categoryIds: ["youtube", "app", "ugc"],
    meta: ["Video", "Avatar"],
    thumbClass: "thumb-avatar",
    label: "AI AVATAR EXPLAINER",
    industry: "app",
    format: "avatar",
    recommendedModel: "Seedance 2.0",
    defaultRatio: "9:16",
    defaultDuration: "30s",
    requiredSlots: ["script", "avatar_style", "voice"],
    schema: "ugc_demo",
    summary: "用数字人口播解释 App 的核心功能，适合需要快速本地化、多语言批量生产的产品。",
    verificationStatus: "Internal generated",
    verticals: ["App", "SaaS", "Education"],
    formats: ["Avatar", "Explainer", "9:16"],
    funnelStage: "Consideration",
    previewAsset: "/assets/thumb-avatar-explainer.png",
    credits: "12 credits",
    prompt:
      "AI avatar talking-head ad for an app. Confident spokesperson, direct opening hook, three short benefit points, on-screen captions, clean studio background, localized language, vertical 9:16, clear app CTA at the end.",
    scriptBlocks: [
      block("Opening", 0, 5, [
        text("Avatar looks into camera and asks: "),
        slot("hook_line", "Hook line", "Still explaining the same app feature over and over?")
      ]),
      block("Benefit Points", 6, 24, [
        text("Cover three benefits for "),
        slot("product_name", "Product", "Family Locator", "product_pack"),
        text(": "),
        slot("benefit_1", "Benefit 1", "real-time family location"),
        text(", "),
        slot("benefit_2", "Benefit 2", "arrival notifications"),
        text(", "),
        slot("benefit_3", "Benefit 3", "simple safety check-ins"),
        text(".")
      ]),
      block("CTA", 25, 30, [
        text("End with localized CTA: "),
        slot("cta", "CTA", "Start protecting your family today", "product_pack"),
        text(".")
      ])
    ],
    referenceAssets: [
      { key: "avatar_style", label: "Avatar style", kind: "image", required: true, previewUrl: "/assets/thumb-avatar-explainer.png" }
    ]
  },
  {
    id: "image-demo",
    title: "电商产品主图",
    route: "image",
    toast: "已套用电商产品主图模板",
    categoryIds: ["tiktok", "app", "ecommerce", "ugc"],
    meta: ["Image", "4:5"],
    thumbClass: "thumb-image",
    industry: "ecommerce",
    format: "tvc",
    recommendedModel: "GPT Image",
    defaultRatio: "4:5",
    requiredSlots: ["product_image", "headline", "offer"],
    schema: "cinematic_tvc",
    summary: "用于快速生成可投放主图，把产品、利益点、促销信息放进清晰的转化构图。",
    verificationStatus: "Prompt tested",
    verticals: ["Ecommerce", "DTC", "Retail"],
    formats: ["Packshot", "Offer", "4:5"],
    funnelStage: "Conversion",
    previewAsset: "/assets/preview-image-ad.png",
    credits: "2 credits",
    prompt:
      "high-converting ecommerce ad image, premium product packshot, strong offer badge, clean background, benefit-driven layout, space reserved for headline and CTA, 4:5 mobile ad composition.",
    scriptBlocks: [
      block("Composition", 0, 0, [
        text("Place "),
        asset("product_image", "@Image 1 Product", ["image"], "/assets/thumb-ecommerce-packshot.png"),
        text(" as the hero packshot with clean contrast and a readable headline: "),
        slot("headline", "Headline", "Make every morning easier", "product_pack"),
        text(".")
      ]),
      block("Offer", 0, 0, [
        text("Add a restrained offer badge: "),
        slot("offer", "Offer", "20% off today", "user_input"),
        text(" and a visible CTA: "),
        slot("cta", "CTA", "Shop now", "product_pack"),
        text(".")
      ])
    ],
    referenceAssets: [
      { key: "product_image", label: "Product image", kind: "image", required: true, previewUrl: "/assets/thumb-ecommerce-packshot.png" }
    ]
  },
  {
    id: "youtube-review",
    title: "评测对比短视频",
    route: "video",
    toast: "已套用 YouTube 评测对比模板",
    categoryIds: ["youtube", "app", "ecommerce", "ugc"],
    meta: ["Video", "YouTube"],
    thumbClass: "thumb-review",
    label: "REVIEW COMPARISON",
    industry: "ecommerce",
    format: "clone",
    recommendedModel: "Seedance 2.0",
    defaultRatio: "9:16",
    defaultDuration: "30s",
    requiredSlots: ["old_way", "new_way", "proof"],
    schema: "story_hook_cta",
    summary: "用旧方法和新方法对比，把评测、证据和推荐压缩进 Shorts 节奏。",
    verificationStatus: "Prompt tested",
    verticals: ["App", "Ecommerce", "SaaS"],
    formats: ["Review", "Comparison", "Shorts"],
    funnelStage: "Consideration",
    previewAsset: "/assets/thumb-review-comparison.png",
    credits: "12 credits",
    prompt:
      "YouTube Shorts review comparison ad. Split-screen setup, compare old way versus new way, fast cuts, creator-style commentary, credible visual proof, strong final recommendation and CTA.",
    scriptBlocks: [
      block("Old Way", 0, 8, [
        text("Split screen shows the old way: "),
        slot("old_way", "Old way", "calling again and again without knowing where the child is"),
        text(".")
      ]),
      block("New Way", 9, 22, [
        text("Cut to "),
        slot("product_name", "Product", "Family Locator", "product_pack"),
        text(" solving the problem with "),
        slot("proof", "Proof", "arrival alert and map confirmation", "product_pack"),
        text(".")
      ]),
      block("CTA", 23, 30, [
        text("Creator concludes: "),
        slot("cta", "CTA", "This is the app I would actually keep on my phone", "product_pack"),
        text(".")
      ])
    ],
    referenceAssets: [
      { key: "old_way", label: "Old way reference", kind: "video", required: false, previewUrl: "/assets/asset-competitor-video.png" },
      { key: "proof", label: "Proof visual", kind: "image", required: true, previewUrl: "/assets/asset-app-ui.png" }
    ]
  },
  {
    id: "gameplay",
    title: "游戏试玩 Hook",
    route: "video",
    toast: "已套用游戏试玩 Hook 模板",
    categoryIds: ["tiktok", "viral"],
    meta: ["Video", "Game"],
    thumbClass: "thumb-game",
    label: "GAMEPLAY HOOK",
    industry: "game",
    format: "app-demo",
    recommendedModel: "Seedance 2.0",
    defaultRatio: "9:16",
    defaultDuration: "15s",
    requiredSlots: ["gameplay", "challenge", "install_cta"],
    schema: "app_demo_hook",
    summary: "用立即可懂的挑战和爽点展示试玩节奏，适合小游戏、休闲游戏和 App install。",
    verificationStatus: "Internal generated",
    verticals: ["Game", "App"],
    formats: ["Gameplay", "Viral Hook", "9:16"],
    funnelStage: "Acquisition",
    previewAsset: "/assets/thumb-gameplay-hook.png",
    credits: "7.5 credits",
    prompt:
      "vertical mobile game ad with immediate gameplay hook, clear challenge, fast progression, satisfying win moment, expressive captions, punchy sound cue moments, strong install CTA.",
    scriptBlocks: [
      block("Hook", 0, 3, [
        text("Open on the hardest-looking move: "),
        slot("challenge", "Challenge", "one mistake and the level resets"),
        text(".")
      ]),
      block("Gameplay", 4, 12, [
        text("Show "),
        asset("gameplay", "@Video 1 Gameplay", ["video"], "/assets/example-mobile-game.png"),
        text(" with fast progression, reward animation, and caption: "),
        slot("proof", "Proof caption", "Only 2% can beat this level")
      ]),
      block("Install CTA", 13, 15, [
        text("End with app store style CTA: "),
        slot("install_cta", "Install CTA", "Play free now", "product_pack"),
        text(".")
      ])
    ],
    referenceAssets: [
      { key: "gameplay", label: "Gameplay reference", kind: "video", required: true, previewUrl: "/assets/example-mobile-game.png" }
    ]
  }
];

export const winningAds: WinningAd[] = [
  {
    id: "winning-sofa-transform",
    title: "Compressed sofa transformation hook",
    platform: "TikTok",
    sourceLabel: "TikTok Top Ads",
    industry: "Ecommerce",
    region: "United States",
    timeWindow: "Last 30 days",
    thumbClass: "thumb-kitchen",
    label: "218.16M views",
    format: "UGC Demo",
    hook: "Man cuts open a compressed couch package and the product expands on camera.",
    metrics: {
      views: "218.16M",
      revenue: "$0",
      roas: "0.056",
      engagementRate: "0.03%"
    },
    breakdown: [
      "0-3s: surprising transformation action starts immediately.",
      "4-10s: product expands while creator reacts in handheld UGC framing.",
      "11-15s: user sits on the sofa to prove the outcome."
    ],
    replicatePrompt:
      "Rewrite this winning UGC transformation structure for my product. Preserve the surprise-first hook, fast proof sequence, handheld TikTok pacing, and final usage proof. Replace the couch, package logic, visual actions, claims, captions, and CTA with my product package. Do not copy the original brand or exact visual identity."
  },
  {
    id: "winning-whitening-proof",
    title: "Whitening strips proof sequence",
    platform: "TikTok",
    sourceLabel: "TikTok Top Ads",
    industry: "Beauty",
    region: "United States",
    timeWindow: "Last 30 days",
    thumbClass: "thumb-review",
    label: "106M views",
    format: "Before / After",
    hook: "Creator shows a close-up product action before revealing a visible result.",
    metrics: {
      views: "106M",
      revenue: "$42.8K",
      roas: "1.011",
      engagementRate: "1.84%"
    },
    breakdown: [
      "0-3s: close-up product action creates curiosity.",
      "4-8s: creator applies the product with simple captions.",
      "9-15s: result reveal becomes the proof moment and CTA bridge."
    ],
    replicatePrompt:
      "Rewrite this before-after proof structure for my product. Preserve the close-up hook, simple usage steps, proof reveal, and creator-style pacing. Replace all beauty-specific claims and visuals with my product's real USP, allowed proof, and CTA."
  },
  {
    id: "winning-cleaning-story",
    title: "Humor cleaning service story",
    platform: "TikTok",
    sourceLabel: "TikTok Top Ads",
    industry: "Local Services",
    region: "United States",
    timeWindow: "Last 30 days",
    thumbClass: "thumb-app",
    label: "High ROAS",
    format: "Story Hook CTA",
    hook: "A messy scene sets up a joke, then a service provider resolves the situation.",
    metrics: {
      views: "24.7M",
      revenue: "$118K",
      roas: "2.43",
      engagementRate: "2.10%"
    },
    breakdown: [
      "0-5s: awkward mess creates a humorous question.",
      "6-12s: service provider appears as the solution.",
      "13-15s: before-after room proof and direct phone CTA."
    ],
    replicatePrompt:
      "Rewrite this humorous local-service story for my product. Keep the awkward setup, fast resolution, and service proof logic. Replace the original mess, brand name, service action, phone number, and final CTA with my product or service details."
  },
  {
    id: "winning-app-alert",
    title: "Safety app alert drama",
    platform: "TikTok",
    sourceLabel: "Top Ads Watchlist",
    industry: "App",
    region: "Thailand",
    timeWindow: "Last 30 days",
    thumbClass: "thumb-app",
    label: "App install",
    format: "App Demo Hook",
    hook: "Parent panic is resolved by a phone alert and location confirmation.",
    metrics: {
      views: "9.8M",
      revenue: "$0",
      roas: "0.82",
      engagementRate: "3.42%"
    },
    breakdown: [
      "0-3s: emotional alert hook with worried parent.",
      "4-10s: phone UI demonstrates the core feature.",
      "11-15s: relief moment and download CTA."
    ],
    replicatePrompt:
      "Rewrite this app alert drama for my product. Preserve the emotional hook, phone UI proof, relief moment, and install CTA. Replace the safety scenario, UI actions, product name, target user, and claims with my product package."
  }
];

export const templateMap = Object.fromEntries(templates.map((template) => [template.id, template])) as Record<string, Template>;
export const winningAdMap = Object.fromEntries(winningAds.map((ad) => [ad.id, ad])) as Record<string, WinningAd>;
