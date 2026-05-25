// 抓取器→DB 的标准化中间格式。每个 fetcher（Meta/TikTok/Google）把自己源
// 的字段映射到这一形态，再调通用 upsertAd() 入库。

export type ScrapedAdRecord = {
  source: "meta" | "tiktok" | "google" | "tiktok_cc";
  sourceId: string;
  advertiserName: string | null;
  advertiserPageId: string | null;
  adCreativeBodies: string[];
  adCreativeTitles: string[];
  adCreativeLinkDescriptions: string[];
  adCreativeLinkCaptions: string[];
  videoUrl: string | null;
  thumbnailUrl: string | null;
  snapshotUrl: string | null;
  region: string | null;
  publisherPlatforms: string[];
  languages: string[];
  deliveryStartAt: Date | null;
  deliveryStopAt: Date | null;
  raw: unknown;
};

export type IngestSummary = {
  fetched: number;
  inserted: number;
  updated: number;
  failed: number;
  errors: string[];
};

// ────────────────────────────────────────────────────────────────
// TikTok Creative Center raw shapes
//
// 这些类型是基于 `/Users/climber_glc/Desktop/AI_Climber/tiktok-cc-recon/captures/`
// 里 2026-05-16 实际抓到的 `creative_radar_api/v1/top_ads/v2/list` 响应推导出来的。
// 真实端点：GET https://ads.tiktok.com/creative_radar_api/v1/top_ads/v2/list
//   query: period | page | limit | order_by | country_code | industry
//   require headers: timestamp / user-sign / anonymous-user-id / web-id（动态签名）
//
// 顶层 envelope: { code, msg, request_id, data: { materials: TiktokAdItem[], pagination } }
// ────────────────────────────────────────────────────────────────

export type TiktokVideoInfo = {
  vid?: string;
  duration?: number;
  cover?: string;
  width?: number;
  height?: number;
  // 360p / 480p / 540p / 720p — TikTok 一条广告会返回多档清晰度
  video_url?: Record<string, string>;
};

export type TiktokAdItem = {
  id: string;
  ad_title?: string;
  brand_name?: string;
  cost?: number;
  ctr?: number;
  like?: number;
  favorite?: boolean;
  industry_key?: string;
  objective_key?: string;
  is_search?: boolean;
  video_info?: TiktokVideoInfo;
  // TODO(real-sample): 还有可能存在的字段（landing_page / cta / country_code 等），
  // 真实跑通带签名后再补，目前 recon capture 里 list endpoint 没暴露这些
};

export type TiktokPagination = {
  page?: number;
  size?: number;
  has_more?: boolean;
  total_count?: number;
};

export type TiktokListResponse = {
  code?: number;
  msg?: string;
  request_id?: string;
  data?: {
    materials?: TiktokAdItem[];
    pagination?: TiktokPagination;
  };
};
