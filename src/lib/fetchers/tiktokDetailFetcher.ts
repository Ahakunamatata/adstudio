// TikTokDetailFetcher: 打开 Creative Center 单条广告 detail 页面，拿 list 拉不到
// 的高价值字段：transcript / landing_page_url / 聚合指标。
//
// detail URL 形态（从抓包推断 + 公开页面）：
//   https://ads.tiktok.com/business/creativecenter/topads/detail/{ad_id}/pc/en
//
// 详情页内部会触发若干 XHR，关键的两个：
//   - /creative_radar_api/v1/top_ads/v2/material_detail?material_id=...
//   - /creative_radar_api/v1/top_ads/v2/material_metrics?material_id=...
// （字段名是从行业经验推断的；首次跑通后从 raw 校准）
//
// 为防止 endpoint 变更让整个 enrich 流程哑掉，本 fetcher 用"宽松拦截 + 字段
// 多名兜底"策略：
//   - 任何包含 ad_id 的 JSON XHR 都尝试 parse
//   - parse 后用多个候选 key 路径找 transcript / landing 等
//   - 抓不到的字段返回 null（不抛），enrich-runner 写部分字段即可

import {
  launchBrowserSession,
  type BrowserSession
} from "./playwright/browser";

const DETAIL_PATH = "/business/creativecenter/topads/detail";
const TARGET_HOST = "ads.tiktok.com";
// 拦截 detail/metrics 相关 XHR 用的 path 片段
const DETAIL_XHR_HINTS = [
  "material_detail",
  "material_metrics",
  "ad_detail",
  "top_ads/v2/detail",
  "top_ads/v2/info"
];
const NAV_TIMEOUT_MS = 30_000;
const XHR_WAIT_MS = 10_000;

export type TiktokDetailResult =
  | {
      ok: true;
      transcript: string | null;
      landingPageUrl: string | null;
      metrics: Record<string, unknown> | null;
      raw: { detailBodies: unknown[]; pageTextLen: number };
    }
  | {
      ok: false;
      error: "anti_bot" | "not_found" | "network" | "parse_error" | "unknown";
      message: string;
    };

// 把 nested object 用 dot 路径展平到一层，方便用候选 key 查找
function flatten(
  obj: unknown,
  prefix: string,
  acc: Record<string, unknown>
): void {
  if (obj == null) return;
  if (typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => flatten(v, `${prefix}[${i}]`, acc));
    return;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v != null && typeof v === "object") {
      flatten(v, key, acc);
    } else {
      acc[key] = v;
    }
  }
}

// 在 flat dict 里找第一个非空 string，匹配下列 key 候选（substring）
function findFirstString(
  flat: Record<string, unknown>,
  candidates: string[]
): string | null {
  for (const cand of candidates) {
    for (const [k, v] of Object.entries(flat)) {
      if (!k.toLowerCase().includes(cand)) continue;
      if (typeof v !== "string") continue;
      const s = v.trim();
      if (s.length > 0) return s;
    }
  }
  return null;
}

// 从一组 XHR 响应里抽 transcript / landing / metrics
function extractFromBodies(bodies: unknown[]): {
  transcript: string | null;
  landingPageUrl: string | null;
  metrics: Record<string, unknown> | null;
} {
  const flat: Record<string, unknown> = {};
  for (const b of bodies) flatten(b, "", flat);

  const transcript = findFirstString(flat, [
    "transcript",
    "voice_over",
    "captions",
    "subtitle",
    "speech_text",
    "asr_text"
  ]);
  const landing = findFirstString(flat, [
    "landing_page_url",
    "landing_url",
    "click_url",
    "deeplink_url"
  ]);

  // metrics：把 ctr/cpc/impression/cost 这种 key 收集成 jsonb
  const metricsKeys = [
    "ctr",
    "cpc",
    "cpm",
    "spend",
    "impressions",
    "impression",
    "view_count",
    "play_count",
    "like_count",
    "comment_count",
    "share_count",
    "engagement"
  ];
  const metrics: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(flat)) {
    const lower = k.toLowerCase();
    if (typeof v !== "number" && typeof v !== "string") continue;
    if (metricsKeys.some((mk) => lower.endsWith(`.${mk}`) || lower === mk)) {
      const leaf = lower.split(".").pop()!;
      // 同名 key 多次出现取第一个非零
      if (!(leaf in metrics) || metrics[leaf] === 0) {
        metrics[leaf] = v;
      }
    }
  }

  return {
    transcript,
    landingPageUrl: landing,
    metrics: Object.keys(metrics).length > 0 ? metrics : null
  };
}

export async function fetchTiktokAdDetail(
  adId: string
): Promise<TiktokDetailResult> {
  if (!adId || !/^\d{6,}$/.test(adId)) {
    return {
      ok: false,
      error: "unknown",
      message: `fetchTiktokAdDetail: adId 看起来不是 TikTok numeric id: "${adId}"`
    };
  }

  let session: BrowserSession | null = null;
  const detailBodies: unknown[] = [];
  let pageText = "";

  try {
    session = await launchBrowserSession({
      headless: true,
      navTimeoutMs: NAV_TIMEOUT_MS
    });

    session.page.on("response", async (resp) => {
      const url = resp.url();
      if (!DETAIL_XHR_HINTS.some((h) => url.includes(h))) return;
      try {
        const body = await resp.json();
        detailBodies.push(body);
      } catch {
        // 不是 JSON，跳过
      }
    });

    const targetUrl = `https://${TARGET_HOST}${DETAIL_PATH}/${adId}/pc/en`;
    try {
      await session.page.goto(targetUrl, {
        waitUntil: "networkidle",
        timeout: NAV_TIMEOUT_MS
      });
    } catch {
      // networkidle 经常等不到（SPA polling），继续往下走
    }

    // 给 detail XHR 一段额外等待
    await session.page.waitForTimeout(XHR_WAIT_MS / 5).catch(() => undefined);

    // 兜底：把 HTML 抓一下，404 时能识别出 not_found
    try {
      pageText = await session.page.content();
    } catch {
      // ignore
    }

    if (detailBodies.length === 0) {
      // 没拿到 detail XHR —— 检查是不是 404
      const lower = pageText.toLowerCase();
      if (
        lower.includes("not found") ||
        lower.includes("404") ||
        lower.includes("this page doesn") // "This page doesn't exist"
      ) {
        return {
          ok: false,
          error: "not_found",
          message: `TikTok ad ${adId} detail page returned not found`
        };
      }
      if (
        lower.includes("captcha") ||
        lower.includes("verify you are human")
      ) {
        return {
          ok: false,
          error: "anti_bot",
          message: "TikTok detail page showed captcha"
        };
      }
      return {
        ok: false,
        error: "anti_bot",
        message: `Did not receive detail XHRs for ad ${adId} (likely anti-bot)`
      };
    }

    const extracted = extractFromBodies(detailBodies);
    return {
      ok: true,
      transcript: extracted.transcript,
      landingPageUrl: extracted.landingPageUrl,
      metrics: extracted.metrics,
      raw: {
        detailBodies: detailBodies.slice(0, 3), // 留三条够 debug
        pageTextLen: pageText.length
      }
    };
  } catch (error) {
    return {
      ok: false,
      error: "unknown",
      message: `unexpected: ${error instanceof Error ? error.message : String(error)}`
    };
  } finally {
    if (session) {
      await session.dispose();
    }
  }
}

export const __internals = {
  extractFromBodies,
  flatten,
  findFirstString
};
