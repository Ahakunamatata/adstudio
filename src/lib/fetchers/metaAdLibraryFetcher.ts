// MetaAdLibraryFetcher: 公开 Meta Ad Library 网页 → 拦 GraphQL XHR → 我方 ads 行。
//
// 不走 Graph API（用户 App 没 Identity Verification 跑不动 ads_archive），改走
// 公开搜索页 `https://www.facebook.com/ads/library/?q=KW&country=US...`，里面的
// XHR endpoint 是 `https://www.facebook.com/api/graphql/`（POST），返回结构：
//
//   data.ad_library_main.search_results_connection {
//     edges: [
//       { node: { collated_results: [ { ad_archive_id, snapshot {...}, ... } ] } }
//     ],
//     page_info: { end_cursor, has_next_page }
//   }
//
// snapshot 字段比 ads_archive Graph 还全：body.text / title / caption / cta_text /
// link_url / videos[] / images[] / page_name / page_categories / page_like_count /
// start_date / end_date / publisher_platform 等。
//
// 反爬：Meta 用 JavaScript challenge 拦 curl（curl 拿到 403 + challenge HTML），
// 但 Playwright 浏览器执行 JS 后能拿到真页面。需要住宅代理（datacenter IP 被识别
// 风险高），用 TIKTOK_PROXY_URL env（命名沿用 TikTok 那个，避免再加新 env key）。

import type { NewAd } from "@/lib/db/schema";
import {
  launchBrowserSession,
  gotoWithRetry,
  type BrowserSession
} from "./playwright/browser";

const DEFAULT_TIMEOUT_MS = 90_000; // FB challenge + 等 ad-shape graphql + 滚动 ≈ 50s，加 retry buffer
const GRAPHQL_PATH = "/api/graphql/";

export type MetaAdLibraryFetchParams = {
  keyword: string; // 单个 keyword（Meta 搜索语法不支持多条 OR/AND）
  region: string; // ISO-3166 alpha-2，e.g. "US"
  // active_status: 默认 "all"（含已停跑的）；要"只在投"传 "active"
  activeStatus?: "all" | "active" | "inactive";
  // ad_type: 默认 "all"；可指定 "political_and_issue_ads" / "employment_ads" 等
  adType?: "all" | "political_and_issue_ads" | "employment_ads" | "housing_ads";
  limit?: number; // default 30
  signal?: AbortSignal;
};

export type MetaAdLibraryFetchErrorKind =
  | "anti_bot"
  | "captcha"
  | "rate_limited"
  | "network"
  | "parse_error"
  | "unknown";

export type MetaAdLibraryFetchResult =
  | { ok: true; ads: NewAd[]; pageCount: number; raw: unknown }
  | {
      ok: false;
      error: MetaAdLibraryFetchErrorKind;
      message: string;
      statusCode?: number;
    };

// ─────────────── types (subset of real GraphQL response) ───────────────

type MetaSnapshotVideo = {
  video_hd_url?: string;
  video_sd_url?: string;
  video_preview_image_url?: string;
};

type MetaSnapshot = {
  page_id?: string;
  page_name?: string;
  page_profile_uri?: string;
  page_profile_picture_url?: string;
  page_like_count?: number;
  page_categories?: string[];
  byline?: string;
  caption?: string;
  cta_text?: string;
  cta_type?: string;
  link_url?: string;
  link_description?: string;
  body?: { text?: string };
  title?: string;
  display_format?: string;
  videos?: MetaSnapshotVideo[];
  images?: Array<{ original_image_url?: string; resized_image_url?: string }>;
  cards?: Array<{
    title?: string;
    body?: string;
    link_url?: string;
    video_hd_url?: string;
    video_sd_url?: string;
    image_url?: string;
  }>;
};

type MetaAdItem = {
  ad_archive_id: string;
  collation_id?: string;
  ad_id?: string | null;
  page_id?: string;
  page_name?: string;
  is_active?: boolean;
  start_date?: number; // unix seconds
  end_date?: number;
  publisher_platform?: string[];
  spend?: unknown;
  currency?: string;
  categories?: string[];
  snapshot?: MetaSnapshot;
};

type MetaGraphQLResponse = {
  data?: {
    ad_library_main?: {
      search_results_connection?: {
        edges?: Array<{
          node?: {
            collated_results?: MetaAdItem[];
          };
        }>;
        page_info?: { end_cursor?: string; has_next_page?: boolean };
      };
    };
  };
};

// ─────────────── helpers ───────────────

function unixToDate(s: number | undefined): Date | null {
  if (!s || typeof s !== "number" || s <= 0) return null;
  // 部分场景给的是毫秒；s > 10^12 是毫秒，否则秒
  return new Date(s > 1e12 ? s : s * 1000);
}

function pickBestMetaVideo(videos: MetaSnapshotVideo[] | undefined): string | null {
  if (!videos || videos.length === 0) return null;
  for (const v of videos) {
    if (v.video_hd_url) return v.video_hd_url;
  }
  for (const v of videos) {
    if (v.video_sd_url) return v.video_sd_url;
  }
  return null;
}

// 把 cards / extras 里的额外 body 文案也合并进来，提高 embedding 召回率
function collectCreativeBodies(snapshot: MetaSnapshot | undefined): string[] {
  if (!snapshot) return [];
  const out: string[] = [];
  if (snapshot.body?.text) out.push(snapshot.body.text);
  if (snapshot.cards) {
    for (const c of snapshot.cards) {
      if (c.body) out.push(c.body);
    }
  }
  return out;
}

function collectCreativeTitles(snapshot: MetaSnapshot | undefined): string[] {
  if (!snapshot) return [];
  const out: string[] = [];
  if (snapshot.title) out.push(snapshot.title);
  if (snapshot.cards) {
    for (const c of snapshot.cards) {
      if (c.title) out.push(c.title);
    }
  }
  return out;
}

// 把 Meta Ad Library 一条 item 映射到我方 NewAd 行
export function metaAdLibraryItemToNewAd(
  item: MetaAdItem,
  region: string
): NewAd {
  const id = `meta-${item.ad_archive_id}`;
  const now = new Date();
  const snapshot = item.snapshot;
  const videoUrl = pickBestMetaVideo(snapshot?.videos);
  const thumbnailUrl =
    snapshot?.videos?.[0]?.video_preview_image_url ??
    snapshot?.images?.[0]?.original_image_url ??
    snapshot?.images?.[0]?.resized_image_url ??
    null;
  const adCreativeBodies = collectCreativeBodies(snapshot);
  const adCreativeTitles = collectCreativeTitles(snapshot);

  return {
    id,
    source: "meta",
    sourceId: item.ad_archive_id,
    advertiserName: item.page_name ?? snapshot?.page_name ?? null,
    advertiserPageId: item.page_id ?? snapshot?.page_id ?? null,
    adCreativeBodies: adCreativeBodies.length > 0 ? adCreativeBodies : null,
    adCreativeTitles: adCreativeTitles.length > 0 ? adCreativeTitles : null,
    adCreativeLinkDescriptions: snapshot?.link_description
      ? [snapshot.link_description]
      : null,
    adCreativeLinkCaptions: snapshot?.caption ? [snapshot.caption] : null,
    videoUrl,
    thumbnailUrl,
    // Meta Ad Library 公开页面里这条广告的 snapshot URL（可点开看完整 ad）
    snapshotUrl: `https://www.facebook.com/ads/library/?id=${item.ad_archive_id}`,
    region,
    publisherPlatforms:
      item.publisher_platform?.map((p) => p.toLowerCase()) ?? ["facebook"],
    languages: null, // Meta Ad Library 这层不带 language，可能需要从 ad detail 拿
    deliveryStartAt: unixToDate(item.start_date),
    deliveryStopAt: unixToDate(item.end_date),
    firstSeenAt: now,
    lastSeenAt: now,
    status: item.is_active === false ? "down" : "active",
    raw: item as unknown as object,
    // enrichment fields 在 fetcher 阶段就能填一部分（Meta 不像 TikTok 要再开 detail 页）
    transcript: null, // Meta 没字幕，等 ASR 视频时另说
    landingPageUrl: snapshot?.link_url ?? null,
    metrics:
      snapshot?.page_like_count
        ? {
            page_like_count: snapshot.page_like_count,
            cta_type: snapshot.cta_type ?? null,
            cta_text: snapshot.cta_text ?? null,
            display_format: snapshot.display_format ?? null
          }
        : null,
    // 我们在 fetcher 就拿到了 landing 等关键字段，直接当 enriched 处理（避免
    // enrich-runner 二次跑 Meta 浪费一次浏览器 session）
    enrichedAt: now,
    createdAt: now,
    updatedAt: now
  } as NewAd;
}

// ─────────────── parser ───────────────

function parseMetaGraphQLResponse(
  payload: MetaGraphQLResponse,
  region: string
): { ads: NewAd[]; hasNextPage: boolean; endCursor: string | null } {
  const conn = payload?.data?.ad_library_main?.search_results_connection;
  const edges = conn?.edges ?? [];
  const ads: NewAd[] = [];
  for (const edge of edges) {
    const items = edge?.node?.collated_results ?? [];
    for (const item of items) {
      if (!item.ad_archive_id) continue;
      try {
        ads.push(metaAdLibraryItemToNewAd(item, region));
      } catch {
        // 单条 parse 失败不阻塞整批
      }
    }
  }
  return {
    ads,
    hasNextPage: !!conn?.page_info?.has_next_page,
    endCursor: conn?.page_info?.end_cursor ?? null
  };
}

// ─────────────── error classification ───────────────

function classifyMetaError(args: {
  httpStatus?: number;
  pageContent?: string;
}): MetaAdLibraryFetchErrorKind {
  const { httpStatus, pageContent } = args;
  const lower = pageContent?.toLowerCase() ?? "";
  if (
    lower.includes("captcha") ||
    lower.includes("please confirm") ||
    lower.includes("we're sorry") // FB's 锁号兜底
  ) {
    return "captcha";
  }
  if (httpStatus === 429) return "rate_limited";
  if (httpStatus === 403) return "anti_bot";
  return "unknown";
}

// ─────────────── main entry ───────────────

export async function fetchMetaAdLibrary(
  params: MetaAdLibraryFetchParams
): Promise<MetaAdLibraryFetchResult> {
  if (!params.region || !/^[A-Z]{2}$/.test(params.region)) {
    return {
      ok: false,
      error: "unknown",
      message: `fetchMetaAdLibrary: region must be ISO-3166 alpha-2, got "${params.region}"`
    };
  }
  if (!params.keyword || params.keyword.trim().length === 0) {
    return {
      ok: false,
      error: "unknown",
      message: "fetchMetaAdLibrary: keyword required"
    };
  }

  const limit = Math.max(1, Math.min(params.limit ?? 30, 100));
  const activeStatus = params.activeStatus ?? "all";
  const adType = params.adType ?? "all";

  const internal = new AbortController();
  const timeoutMs = DEFAULT_TIMEOUT_MS;
  const timeoutHandle = setTimeout(() => internal.abort(), timeoutMs);
  const onCallerAbort = () => internal.abort();
  params.signal?.addEventListener("abort", onCallerAbort);

  let session: BrowserSession | null = null;
  // Meta GraphQL 可能返回多个 payload（page1 + 滚动分页 + 边缘 hover refetch），
  // 我们把含 search_results_connection 的全部攒起来，merge 时去重。
  const adShapeBodies: MetaGraphQLResponse[] = [];
  let lastHttpStatus: number | null = null;
  let pageContent = "";

  try {
    session = await launchBrowserSession({
      headless: true,
      navTimeoutMs: timeoutMs
    });

    session.page.on("response", async (resp) => {
      const url = resp.url();
      if (!url.includes(GRAPHQL_PATH)) return;
      lastHttpStatus = resp.status();
      try {
        const text = await resp.text();
        // FB GraphQL 有时返回多 line newline-delimited JSON（@stream）
        const candidates = text.startsWith("{")
          ? [text]
          : text.split("\n").filter((s) => s.startsWith("{"));
        for (const c of candidates) {
          try {
            const obj = JSON.parse(c) as MetaGraphQLResponse;
            if (obj?.data?.ad_library_main?.search_results_connection) {
              adShapeBodies.push(obj);
            }
          } catch {
            // skip
          }
        }
      } catch {
        // resp 可能已失效，忽略
      }
    });

    const targetUrl =
      `https://www.facebook.com/ads/library/?` +
      `active_status=${encodeURIComponent(activeStatus)}` +
      `&ad_type=${encodeURIComponent(adType)}` +
      `&country=${encodeURIComponent(params.region)}` +
      `&q=${encodeURIComponent(params.keyword)}` +
      `&search_type=keyword_unordered`;

    try {
      await gotoWithRetry(session.page, targetUrl, {
        waitUntil: "domcontentloaded", // FB 永远跑不到 networkidle（持续轮询）
        timeout: timeoutMs,
        maxRetries: 2,
        retryBackoffMs: 4_000
      });
    } catch (navErr) {
      const msg = navErr instanceof Error ? navErr.message : String(navErr);
      if (internal.signal.aborted) {
        return {
          ok: false,
          error: "network",
          message: `navigation aborted/timeout after ${timeoutMs}ms`
        };
      }
      try {
        pageContent = await session.page.content();
      } catch {
        // ignore
      }
      if (adShapeBodies.length === 0 && !pageContent) {
        return {
          ok: false,
          error: "network",
          message: `playwright navigation failed: ${msg}`
        };
      }
    }

    // 等 challenge resolve + 真的 ad-shape graphql 回来（实测 T+10~15s）。
    // 等的是 *含 ad_archive_id 的 200 response*，不是任意 200 graphql（sidebar /
    // footer 那些 query 都是 graphql 但不带 ad 数据，命中了会假阳性）。
    try {
      await session.page.waitForResponse(
        async (r) => {
          if (!r.url().includes(GRAPHQL_PATH)) return false;
          if (r.status() !== 200) return false;
          try {
            const t = await r.text();
            return t.includes("ad_archive_id");
          } catch {
            return false;
          }
        },
        { timeout: 30_000 }
      );
    } catch {
      // 30s 没等到，可能 challenge 卡住或代理切了；下面看 adShapeBodies 兜底
    }

    // 滚 3-4 轮触发分页懒加载（每轮等 graphql 回来）
    for (let i = 0; i < 4 && adShapeBodies.length < 5; i++) {
      try {
        await session.page.evaluate(() => window.scrollBy(0, 2500));
        await session.page.waitForTimeout(4_000);
      } catch {
        break;
      }
    }

    if (!pageContent) {
      try {
        pageContent = await session.page.content();
      } catch {
        // ignore
      }
    }

    if (adShapeBodies.length === 0) {
      const kind = classifyMetaError({
        httpStatus: lastHttpStatus ?? undefined,
        pageContent
      });
      return {
        ok: false,
        error: kind === "unknown" ? "anti_bot" : kind,
        message:
          kind === "captcha"
            ? "Meta Ad Library showed a challenge / captcha"
            : `Did not receive ${GRAPHQL_PATH} ad-shape response (likely anti-bot; need residential proxy)`,
        statusCode: lastHttpStatus ?? undefined
      };
    }

    // merge 所有 graphql payloads，去重 ad_archive_id
    const seen = new Set<string>();
    const merged: NewAd[] = [];
    for (const body of adShapeBodies) {
      let parsed;
      try {
        parsed = parseMetaGraphQLResponse(body, params.region);
      } catch (e) {
        return {
          ok: false,
          error: "parse_error",
          message: `failed to map Meta items: ${e instanceof Error ? e.message : String(e)}`
        };
      }
      for (const ad of parsed.ads) {
        if (seen.has(ad.sourceId)) continue;
        seen.add(ad.sourceId);
        merged.push(ad);
        if (merged.length >= limit) break;
      }
      if (merged.length >= limit) break;
    }

    return {
      ok: true,
      ads: merged,
      pageCount: merged.length,
      raw: { payloadCount: adShapeBodies.length }
    };
  } catch (error) {
    const isAbort =
      error instanceof Error &&
      (error.name === "AbortError" ||
        error.message.toLowerCase().includes("aborted") ||
        error.message.toLowerCase().includes("timeout"));
    return {
      ok: false,
      error: isAbort ? "network" : "unknown",
      message: isAbort
        ? `request timed out after ${timeoutMs}ms`
        : `unexpected: ${error instanceof Error ? error.message : String(error)}`
    };
  } finally {
    clearTimeout(timeoutHandle);
    params.signal?.removeEventListener("abort", onCallerAbort);
    if (session) {
      await session.dispose();
    }
  }
}

export const __internals = {
  parseMetaGraphQLResponse,
  metaAdLibraryItemToNewAd,
  classifyMetaError,
  pickBestMetaVideo,
  collectCreativeBodies,
  collectCreativeTitles
};
