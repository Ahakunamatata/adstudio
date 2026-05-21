import type { TopAd } from "@/lib/domain/schemas";

// ────────────────────────────────────────────────────────────────
// 爆款广告 mock 数据
//
// 一期覆盖：电商（4）/ App（6）/ 游戏（2）
// 其他 7 个行业暂无数据（行业大卡显示"即将接入"）
//
// 数据真实性说明：
// 数字（播放量/ROAS/互动率）是根据 TikTok Creative Center 公开榜单
// 的合理量级编造的 mock，不代表真实广告效果。
// 上线接入真实 API 前，要把这些数据替换为爬取结果。
//
// insights 质量基线（这是 AI 轻量标的产品定义）：
//   ✅ "春节情绪 + 中奖钩子"          —— 具体到一条广告
//   ✅ "6 包 = 中奖暗示视觉符号"      —— 可视化、有数字
//   ✅ "越南本地化口语 voiceover"     —— 精确到地区/语种
//   ❌ "真实场景拍摄"                 —— 适用于所有 UGC
//   ❌ "节奏紧凑、有 CTA"             —— 适用于所有广告
//   ❌ "情绪渲染"                     —— 抽象、没信息
// ────────────────────────────────────────────────────────────────

export const topAds: TopAd[] = [
  {
    id: "topad-nescafe-vn-tet",
    title: "Đón năm mới cùng Nescafé · 6 chỉ vàng mỗi ngày",
    industry: "ecommerce",
    source: "tiktok-creative-center",
    brand: "Nescafé Vietnam",
    region: "VN",
    regionFlag: "🇻🇳",
    platform: "TikTok",
    publishedAt: "2026-01-12",
    campaignDays: 14,
    durationSec: 15,
    thumbClass: "thumb-topad-nescafe",
    metrics: {
      views: "121.29M",
      engagement: "4.2%"
    },
    insights: [
      { label: "春节情绪 + 中奖钩子", category: "emotion" },
      { label: "6 包 = 中奖暗示视觉符号", category: "visual" },
      { label: "越南本地化口语 voiceover", category: "localization" }
    ]
  },
  {
    id: "topad-bearbrand-id",
    title: "Bukan cuma relationship · BEAR BRAND",
    industry: "ecommerce",
    source: "tiktok-creative-center",
    brand: "Bear Brand",
    region: "ID",
    regionFlag: "🇮🇩",
    platform: "TikTok",
    publishedAt: "2026-02-03",
    campaignDays: 22,
    durationSec: 16,
    thumbClass: "thumb-topad-bearbrand",
    metrics: {
      views: "163.83M",
      engagement: "3.1%"
    },
    insights: [
      { label: "关系暗喻牛奶纯净度", category: "emotion" },
      { label: "印尼日常关怀场景", category: "localization" },
      { label: "悬念式 hook 反转结构", category: "structure" }
    ]
  },
  {
    id: "topad-whitening-strips-us",
    title: "Veneers who · #whiteningstrips · #drdent",
    industry: "ecommerce",
    source: "tiktok-creative-center",
    brand: "drdent",
    region: "US",
    regionFlag: "🇺🇸",
    platform: "TikTok",
    publishedAt: "2026-03-08",
    campaignDays: 7,
    durationSec: 45,
    thumbClass: "thumb-topad-whitening",
    metrics: {
      views: "106.23M",
      roas: "1.011",
      engagement: "0.02%"
    },
    insights: [
      { label: "震惊结果做开场反钩", category: "hook" },
      { label: "男性使用美容品反差", category: "visual" },
      { label: "前 1 秒大字号承诺转化", category: "structure" }
    ]
  },
  {
    id: "topad-omegasmart-vn",
    title: "OmegaSmart · Dutch Lady 智能升级",
    industry: "ecommerce",
    source: "tiktok-creative-center",
    brand: "Dutch Lady",
    region: "VN",
    regionFlag: "🇻🇳",
    platform: "TikTok",
    publishedAt: "2026-03-22",
    campaignDays: 5,
    durationSec: 30,
    thumbClass: "thumb-topad-omega",
    metrics: {
      views: "84.06M",
      revenue: "$25.6M",
      roas: "0.0059",
      engagement: "1.8%"
    },
    insights: [
      { label: "产品名 + 数字背书前置", category: "hook" },
      { label: "母亲第一视角讲述", category: "emotion" },
      { label: "包装变化前后对比镜头", category: "visual" }
    ]
  },
  {
    id: "topad-familylocator-th",
    title: "ลูกถึงบ้านยัง · Family Locator แจ้งเตือนทันที",
    industry: "app",
    source: "tiktok-creative-center",
    brand: "Family Locator",
    region: "TH",
    regionFlag: "🇹🇭",
    platform: "TikTok",
    publishedAt: "2026-02-18",
    campaignDays: 28,
    durationSec: 15,
    thumbClass: "thumb-topad-familylocator",
    metrics: {
      views: "47.2M",
      roas: "1.42",
      engagement: "3.8%"
    },
    insights: [
      { label: "晚归焦虑 → 安心反转", category: "emotion" },
      { label: "手机屏幕实拍 UI 演示", category: "visual" },
      { label: "0-2 秒钟表特写制造紧迫", category: "hook" }
    ]
  },
  {
    id: "topad-holderhp-id",
    title: "Holder hp Kasur · viral life hack",
    industry: "app",
    source: "tiktok-creative-center",
    brand: "Holder HP",
    region: "ID",
    regionFlag: "🇮🇩",
    platform: "TikTok",
    publishedAt: "2026-04-02",
    campaignDays: 11,
    durationSec: 22,
    thumbClass: "thumb-topad-holder",
    metrics: {
      views: "39.4M",
      engagement: "5.1%"
    },
    insights: [
      { label: "床上看手机痛点共鸣", category: "emotion" },
      { label: "9 秒一镜到底安装演示", category: "structure" },
      { label: "印尼方言旁白", category: "localization" }
    ]
  },
  {
    id: "topad-photoeditor-us",
    title: "I'm not a photographer · AI Photo Editor",
    industry: "app",
    source: "tiktok-creative-center",
    brand: "Photo Editor Pro",
    region: "US",
    regionFlag: "🇺🇸",
    platform: "TikTok",
    publishedAt: "2026-03-15",
    campaignDays: 16,
    durationSec: 18,
    thumbClass: "thumb-topad-photoeditor",
    metrics: {
      views: "28.7M",
      roas: "1.18",
      engagement: "2.9%"
    },
    insights: [
      { label: "自嘲反差作开场", category: "hook" },
      { label: "原图 vs AI 修图分屏", category: "visual" },
      { label: "TikTok UGC 第一人称视角", category: "structure" }
    ]
  },
  {
    id: "topad-antitheft-vn",
    title: "Đừng để mất điện thoại · Anti-Theft Alarm",
    industry: "app",
    source: "tiktok-creative-center",
    brand: "Anti-Theft Alarm Pro",
    region: "VN",
    regionFlag: "🇻🇳",
    platform: "TikTok",
    publishedAt: "2026-04-08",
    campaignDays: 18,
    durationSec: 16,
    thumbClass: "thumb-topad-antitheft",
    metrics: {
      views: "62.8M",
      roas: "2.04",
      engagement: "4.5%"
    },
    insights: [
      { label: "公共场所小偷场景实拍", category: "visual" },
      { label: "强声警报触发抓包瞬间", category: "hook" },
      { label: "越南本地口语 voiceover", category: "localization" }
    ]
  },
  {
    id: "topad-findmy-id",
    title: "HP hilang? Lacak sekarang · FindMyDevice",
    industry: "app",
    source: "meta-ad-library",
    brand: "FindMyDevice",
    region: "ID",
    regionFlag: "🇮🇩",
    platform: "Meta",
    publishedAt: "2026-03-25",
    campaignDays: 21,
    durationSec: 22,
    thumbClass: "thumb-topad-findmy",
    metrics: {
      views: "44.6M",
      roas: "1.62",
      engagement: "3.2%"
    },
    insights: [
      { label: "丢手机崩溃情绪 → 找回喜悦", category: "emotion" },
      { label: "实时定位地图界面强展示", category: "visual" },
      { label: "印尼语 + 英文双语字幕", category: "localization" }
    ]
  },
  {
    id: "topad-applock-br",
    title: "Ninguém vê meu celular · App Lock Vault",
    industry: "app",
    source: "google-ads",
    brand: "App Lock Vault",
    region: "BR",
    regionFlag: "🇧🇷",
    platform: "Google",
    publishedAt: "2026-04-15",
    campaignDays: 9,
    durationSec: 14,
    thumbClass: "thumb-topad-applock",
    metrics: {
      views: "33.1M",
      engagement: "5.8%"
    },
    insights: [
      { label: "好奇心钩子：别人翻你手机", category: "hook" },
      { label: "葡萄牙语日常吐槽语气", category: "localization" },
      { label: "应用解锁动画前后对比", category: "visual" }
    ]
  },
  {
    id: "topad-match3-us",
    title: "Only 1% can clear level 8 · Puzzle Saga",
    industry: "game",
    source: "tiktok-creative-center",
    brand: "Puzzle Saga",
    region: "US",
    regionFlag: "🇺🇸",
    platform: "TikTok",
    publishedAt: "2026-04-19",
    campaignDays: 7,
    durationSec: 12,
    thumbClass: "thumb-topad-match3",
    metrics: {
      views: "52.1M",
      roas: "1.83",
      engagement: "6.4%"
    },
    insights: [
      { label: "1% 通关挑战激将法", category: "hook" },
      { label: "故意做错关卡引发评论", category: "structure" },
      { label: "Combo 爆炸特效黄金 3 秒", category: "visual" }
    ]
  },
  {
    id: "topad-runner-br",
    title: "Subway Surfers style · Run Forever",
    industry: "game",
    source: "tiktok-creative-center",
    brand: "Run Forever",
    region: "BR",
    regionFlag: "🇧🇷",
    platform: "TikTok",
    publishedAt: "2026-03-28",
    campaignDays: 14,
    durationSec: 15,
    thumbClass: "thumb-topad-runner",
    metrics: {
      views: "31.5M",
      roas: "0.94",
      engagement: "4.7%"
    },
    insights: [
      { label: "横屏跑酷 + 失败时刻引爆点", category: "hook" },
      { label: "葡萄牙语夸张配音", category: "localization" },
      { label: "屏幕分屏对比新老画质", category: "visual" }
    ]
  }
];

export const topAdsCoveredIndustries = ["ecommerce", "app", "game"] as const;

export const topAdMap = Object.fromEntries(topAds.map((ad) => [ad.id, ad])) as Record<string, TopAd>;
