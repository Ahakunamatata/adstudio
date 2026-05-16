import type { Template } from "@/lib/domain/schemas";

export const templateCategories = [
  { id: "tiktok", label: "TikTok Ads", summary: "高强度开场与移动端转化模板" },
  { id: "youtube", label: "YouTube Shorts", summary: "评测、对比和推荐型短视频" },
  { id: "app", label: "App", summary: "App 功能展示、警报 Hook 和口播解释" },
  { id: "ecommerce", label: "Ecommerce", summary: "商品演示、主图和促销转化素材" },
  { id: "ugc", label: "UGC", summary: "生活化口吻和创作者视角模板" },
  { id: "viral", label: "Viral Hook", summary: "游戏、冲突、惊讶和强钩子素材" }
];

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
    recommendedModel: "Seedance 2.0",
    defaultRatio: "9:16",
    defaultDuration: "15s",
    requiredSlots: ["product_pack", "app_ui", "cta"],
    prompt:
      "15s vertical TikTok app ad. Open with a tense hook: a parent checks why the child has not arrived home. Show a realistic phone alert, anxious expression, then relief after Family Locator confirms the location. Thai language, bold subtitles, cinematic handheld shots, clear CTA."
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
    recommendedModel: "Seedance 2.0",
    defaultRatio: "9:16",
    defaultDuration: "15s",
    requiredSlots: ["product_image", "selling_point", "cta"],
    prompt:
      "one-take user-generated product demo in a bright home environment. Start with a surprising hook, show the product solving a concrete daily pain point, include natural hand movement, warm light, mobile-first vertical framing, end with a short CTA."
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
    recommendedModel: "Seedance 2.0",
    defaultRatio: "9:16",
    defaultDuration: "30s",
    requiredSlots: ["script", "avatar_style", "voice"],
    prompt:
      "AI avatar talking-head ad for an app. Confident spokesperson, direct opening hook, three short benefit points, on-screen captions, clean studio background, localized language, vertical 9:16, clear app CTA at the end."
  },
  {
    id: "image-demo",
    title: "电商产品主图",
    route: "image",
    toast: "已套用电商产品主图模板",
    categoryIds: ["tiktok", "app", "ecommerce", "ugc"],
    meta: ["Image", "4:5"],
    thumbClass: "thumb-image",
    recommendedModel: "GPT Image",
    defaultRatio: "4:5",
    requiredSlots: ["product_image", "headline", "offer"],
    prompt:
      "high-converting ecommerce ad image, premium product packshot, strong offer badge, clean background, benefit-driven layout, space reserved for headline and CTA, 4:5 mobile ad composition."
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
    recommendedModel: "Seedance 2.0",
    defaultRatio: "9:16",
    defaultDuration: "30s",
    requiredSlots: ["old_way", "new_way", "proof"],
    prompt:
      "YouTube Shorts review comparison ad. Split-screen setup, compare old way versus new way, fast cuts, creator-style commentary, credible visual proof, strong final recommendation and CTA."
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
    recommendedModel: "Seedance 2.0",
    defaultRatio: "9:16",
    defaultDuration: "15s",
    requiredSlots: ["gameplay", "challenge", "install_cta"],
    prompt:
      "vertical mobile game ad with immediate gameplay hook, clear challenge, fast progression, satisfying win moment, expressive captions, punchy sound cue moments, strong install CTA."
  }
];

export const templateMap = Object.fromEntries(templates.map((template) => [template.id, template])) as Record<string, Template>;
