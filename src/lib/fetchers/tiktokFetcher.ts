// TikTokFetcher: scrape TikTok Creative Center Top Ads → 我方 ads 行
//
// 目标端点（reverse-engineered from tiktok-cc-recon captures @ 2026-05-16）：
//   GET https://ads.tiktok.com/creative_radar_api/v1/top_ads/v2/list
//     query: period=7|30|90|180, page, limit, order_by, country_code, industry
//     headers: timestamp / user-sign / anonymous-user-id / web-id（动态签名，浏览器算）
//
// 因为签名头是动态生成的（user-sign 每次请求都变），脱离浏览器直接 fetch 不可行。
// 当前策略：用 Playwright 打开 Top Ads 列表页 → 拦截 XHR response → 解析 JSON。
//
// 状态：当前本机执行 *会* 在无住宅代理时被反爬挡（IP/UA/指纹任何一项命中
// TikTok 风控就 captcha / 403 / 空数据）。本 fetcher 的错误分类把这些情况
// 收敛到 `anti_bot / captcha / rate_limited` 之一，CLI 友好提示后退出。
// 真实成功跑通要等：
//   1. 阿里云硅谷 ECS（海外 IP）
//   2. IPRoyal 住宅代理（TIKTOK_PROXY_URL）
//   3. （可能）playwright-extra + stealth plugin

import type {
  TiktokAdItem,
  TiktokListResponse,
  TiktokPagination
} from "./types";
import type { NewAd } from "@/lib/db/schema";
import {
  launchBrowserSession,
  gotoWithRetry,
  type BrowserSession
} from "./playwright/browser";

const DEFAULT_TIMEOUT_MS = 90_000; // search 模式要 page load + 等 trending + search input + 等 search XHR；TikTok 是 SPA 永远不 networkidle
const TARGET_HOST = "ads.tiktok.com";
const LIST_API_PATH = "/creative_radar_api/v1/top_ads/v2/list";
// 当 XHR URL 里出现 keyword= 时是真搜索结果（不是 top trending）
const SEARCH_QUERY_MARKER = "keyword=";

export type TiktokTimeWindow = "7d" | "30d" | "90d" | "180d";

export type TiktokFetchParams = {
  keywords?: string[];
  region: string; // ISO-3166 alpha-2 e.g. "US" / "VN" / "ID"
  industry?: string; // optional TikTok industry filter (label_xxxx)
  timeWindow?: TiktokTimeWindow;
  limit?: number; // default 30
  signal?: AbortSignal;
};

export type TiktokFetchErrorKind =
  | "anti_bot"
  | "rate_limited"
  | "network"
  | "parse_error"
  | "captcha"
  | "unknown";

export type TiktokFetchResult =
  | { ok: true; ads: NewAd[]; pageCount: number; raw: unknown }
  | {
      ok: false;
      error: TiktokFetchErrorKind;
      message: string;
      statusCode?: number;
    };

// ───────────────────────── parser ─────────────────────────

// timeWindow → API `period` 数值
function periodFromWindow(window: TiktokTimeWindow | undefined): number {
  switch (window) {
    case "7d":
      return 7;
    case "90d":
      return 90;
    case "180d":
      return 180;
    case "30d":
    default:
      return 30;
  }
}

// 从 video_info.video_url 拿最高清的 URL（720p > 540p > 480p > 360p）
function pickBestVideoUrl(
  videoUrls: Record<string, string> | undefined
): string | null {
  if (!videoUrls) return null;
  const candidates = ["720p", "540p", "480p", "360p"];
  for (const key of candidates) {
    const url = videoUrls[key];
    if (url) return url;
  }
  // 没匹配到固定档位就回退到第一个有值的
  const entries = Object.entries(videoUrls);
  for (const [, url] of entries) {
    if (url) return url;
  }
  return null;
}

// 把 TikTok 一条广告 item 映射到我方 NewAd 行
//
// 字段 sourceing 注释（基于 recon capture，2026-05-16）：
//   - id          ← item.id           （TikTok 内部 ad id，e.g. "7633468359447166983"）
//   - brand_name  ← advertiser；空串很常见，TikTok Creative Center 不强制
//   - ad_title    ← creative copy / caption（实际是个简短 hook，例 "$2.08/Day - ..."）
//   - video_info  ← 视频 + cover；多档清晰度，挑最高
//   - industry_key / objective_key 暂时 stash 进 raw，未来需要时单独提
//
// TODO(real-sample): 等服务器跑通带签名的真实拉取后，再校验以下假设：
//   - 是否能拿到 landing_page_url / cta_text（recon 里的 list endpoint 没暴露）
//   - country / languages 是否要从 list response 之外的 detail endpoint 拿
//   - 是否有 ad_delivery_start/stop time（目前 list 只有 like/ctr/cost 这种聚合指标）
export function tiktokItemToNewAd(
  item: TiktokAdItem,
  region: string
): NewAd {
  const id = `tiktok-${item.id}`;
  const now = new Date();
  const videoUrl = pickBestVideoUrl(item.video_info?.video_url);
  const thumbnailUrl = item.video_info?.cover ?? null;
  // Creative Center 的 ad title 是真实的广告 hook/caption
  const adCreativeBodies = item.ad_title ? [item.ad_title] : null;

  return {
    id,
    source: "tiktok",
    sourceId: item.id,
    advertiserName: item.brand_name && item.brand_name.length > 0
      ? item.brand_name
      : null,
    // TikTok 没有 facebook page id 概念，留空
    advertiserPageId: null,
    adCreativeBodies,
    // ad_title 既是 caption 又是 hook，title 字段先复用同一份；
    // 如果未来 detail endpoint 拆出独立 title，这里可以分开
    adCreativeTitles: item.ad_title ? [item.ad_title] : null,
    adCreativeLinkDescriptions: null,
    adCreativeLinkCaptions: null,
    videoUrl,
    thumbnailUrl,
    snapshotUrl: null, // TikTok Creative Center 没有 Meta 那种 snapshot_url，留 null
    region,
    publisherPlatforms: ["tiktok"],
    languages: null, // TODO(real-sample): list endpoint 不带 language，detail 可能带
    deliveryStartAt: null,
    deliveryStopAt: null,
    firstSeenAt: now,
    lastSeenAt: now,
    status: "active",
    // raw 保命：把整个 item 留下，未来想加新维度直接 reparse
    raw: item as unknown as object,
    createdAt: now,
    updatedAt: now
  };
}

// 从 TikTok list response envelope 解析出 ads 数组
//
// envelope shape：{ code, msg, request_id, data: { materials: [], pagination: {} } }
// code === 0 是成功；非 0 多半是签名失效或风控拦截。
function parseListResponse(
  payload: TiktokListResponse,
  region: string
): { ads: NewAd[]; pagination: TiktokPagination | null } {
  const materials = payload?.data?.materials ?? [];
  const ads = materials.map((item) => tiktokItemToNewAd(item, region));
  return {
    ads,
    pagination: payload?.data?.pagination ?? null
  };
}

// ─────────────────── error classification ───────────────────

// TikTok 反爬 / 风控信号分类。
// 因为我们走 Playwright 拦 XHR，错误来源分两类：
//   A. Playwright 自己的错误（网络 / abort / timeout）→ network / unknown
//   B. TikTok 返回的 envelope code / HTTP status → anti_bot / captcha / rate_limited
//
// 实测线索（从 tiktok-cc-recon 抓到的）：
//   - envelope.code === 40000 范围：参数错误 / 签名失效
//   - envelope.code === 50000 范围：服务器拒绝（往往是反爬）
//   - HTTP 429：rate limited（罕见，TikTok 多用 captcha 拦）
//   - HTML body 含 "captcha" / "verify" 字样：captcha challenge
//   - 空 materials 数组但 code === 0：region/industry 可能没数据，但更常见是 IP 被 fingerprint 屏蔽
function classifyTiktokError(args: {
  httpStatus?: number;
  envelopeCode?: number;
  envelopeMsg?: string;
  pageContent?: string;
}): TiktokFetchErrorKind {
  const { httpStatus, envelopeCode, envelopeMsg, pageContent } = args;
  const msgLower = envelopeMsg?.toLowerCase() ?? "";
  const pageLower = pageContent?.toLowerCase() ?? "";

  if (
    pageLower.includes("captcha") ||
    pageLower.includes("verify you are human") ||
    msgLower.includes("captcha")
  ) {
    return "captcha";
  }
  if (httpStatus === 429 || msgLower.includes("rate limit")) {
    return "rate_limited";
  }
  if (httpStatus === 403 || msgLower.includes("forbidden")) {
    return "anti_bot";
  }
  if (envelopeCode && envelopeCode >= 40000) {
    // 40000 段多半是签名失效或参数错，从外部看也是反爬触发的
    return "anti_bot";
  }
  if (httpStatus && httpStatus >= 500) {
    return "unknown";
  }
  return "unknown";
}

// ─────────────────────── main entry ───────────────────────

/**
 * 调 TikTok Creative Center 拉一页 Top Ads。
 *
 * 当前实现：用 Playwright 打开 Top Ads 列表页 → 拦截 XHR response → 解析 JSON。
 * 签名头由真浏览器生成，我们只代理参数。
 *
 * 返回值：
 *   - { ok: true, ads, pageCount, raw }：成功；ads 是已映射到 NewAd 形态
 *   - { ok: false, error, message }：错误已分类，调用方按 error kind 决定行为
 *
 * 任何 exception 都被收敛到 `{ ok: false }`，不抛。
 *
 * 重要：本函数只能在 Node runtime（CLI / job runner）调用。
 * 不要从 Next.js Route Handler 静态 import — playwright 不能在 Edge runtime 跑。
 */
export async function fetchTiktokAds(
  params: TiktokFetchParams
): Promise<TiktokFetchResult> {
  if (!params.region || !/^[A-Z]{2}$/.test(params.region)) {
    return {
      ok: false,
      error: "unknown",
      message: `fetchTiktokAds: region must be ISO-3166 alpha-2, got "${params.region}"`
    };
  }

  const limit = Math.max(1, Math.min(params.limit ?? 30, 50));
  const period = periodFromWindow(params.timeWindow);

  // 组合 caller signal + 内部 30s timeout
  const internal = new AbortController();
  const timeoutMs = DEFAULT_TIMEOUT_MS;
  const timeoutHandle = setTimeout(() => internal.abort(), timeoutMs);
  const onCallerAbort = () => internal.abort();
  params.signal?.addEventListener("abort", onCallerAbort);

  let session: BrowserSession | null = null;
  // 我们维护两个 XHR 槽位：trendingBody（无 keyword） + searchBody（含 keyword=）。
  // 有 keywords 的请求里 search 一定要优先用，没拿到就视为 anti-bot 失败。
  let trendingBody: TiktokListResponse | null = null;
  let searchBody: TiktokListResponse | null = null;
  let listResponseStatus: number | null = null;
  let pageContent = "";

  const wantSearch = !!(params.keywords && params.keywords.length > 0);
  const keywordForSearch = wantSearch
    ? params.keywords!.join(" ").trim()
    : "";

  try {
    session = await launchBrowserSession({
      headless: true,
      navTimeoutMs: timeoutMs
    });

    // 拦截 list endpoint 的 response
    session.page.on("response", async (resp) => {
      const url = resp.url();
      if (!url.includes(LIST_API_PATH)) return;
      try {
        const status = resp.status();
        listResponseStatus = status;
        const isSearchXhr = url.includes(SEARCH_QUERY_MARKER);
        // TikTok 偶尔会返回 text/html 在反爬下，先尝试 JSON，失败再抓 text
        try {
          const body = (await resp.json()) as TiktokListResponse;
          if (isSearchXhr) {
            searchBody = body;
          } else {
            trendingBody = body;
          }
        } catch {
          const text = await resp.text();
          pageContent = text.slice(0, 4000);
        }
      } catch {
        // resp 可能在 navigation 切换间失效，忽略
      }
    });

    // 构造目标 URL。先打开 trending 页（不带 keyword），后面再 type + Enter 触发
    // 真正的 search XHR。这样的好处：能比较 trending vs search 两份 payload，
    // 也能在 search 失败时降级到 trending 兜底。
    const queryParts: string[] = [
      `period=${period}`,
      `region=${encodeURIComponent(params.region)}`
    ];
    if (params.industry) {
      queryParts.push(`industry=${encodeURIComponent(params.industry)}`);
    }
    const targetUrl =
      `https://${TARGET_HOST}/business/creativecenter/inspiration/topads/pc/en?` +
      queryParts.join("&");

    // navigate；abort signal 触发时 Playwright 会抛 timeout/abort error。
    // 用 gotoWithRetry 兜住代理 sticky rotation 导致的 transient 网络错误。
    // 注意：TikTok Creative Center 是 SPA 持续 polling，networkidle 永远等不到 —
    // 用 domcontentloaded（HTML 解析完），后面靠 page.on('response') 拦 list XHR。
    try {
      await gotoWithRetry(session.page, targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30_000, // 单次 navigation 30s 足够拿 HTML shell
        maxRetries: 2,
        retryBackoffMs: 4_000
      });
    } catch (navErr) {
      // 不直接 return — 也许 list XHR 在 networkidle 前就回来了
      const msg = navErr instanceof Error ? navErr.message : String(navErr);
      if (internal.signal.aborted) {
        return {
          ok: false,
          error: "network",
          message: `navigation aborted/timeout after ${timeoutMs}ms`
        };
      }
      // 反爬下 networkidle 永远不到（页面 keep polling）；尽量取一下 html
      try {
        pageContent = await session.page.content();
      } catch {
        // ignore
      }
      // 如果连 trending XHR 都没拿到，且 page 也没 HTML 兜底，直接退
      if (!trendingBody && !pageContent) {
        return {
          ok: false,
          error: "network",
          message: `playwright navigation failed: ${msg}`
        };
      }
    }

    // 给 trending XHR 一点最后机会回来
    if (!trendingBody) {
      try {
        await session.page.waitForResponse(
          (r) => r.url().includes(LIST_API_PATH) && !r.url().includes(SEARCH_QUERY_MARKER),
          { timeout: 5_000 }
        );
      } catch {
        // 没拦到没关系，下面再判
      }
    }

    // ── 如果需要 search：找搜索框、输入 keyword、回车、等 search XHR ──
    // TikTok 的搜索框不是原生 <input>，是带 data-testid="cc_commonCom_autoComplete"
    // 的自定义 div + 内嵌 contenteditable / shadow input。所以我们点 wrapper 让它
    // focus，再用 page.keyboard.type 让事件正确进 React 状态。
    if (wantSearch && keywordForSearch.length > 0 && !internal.signal.aborted) {
      // 优先级：banner 主搜索框 > 列表内嵌过滤搜索框 > 任意带 search 的 div > 原生 input
      const searchWrapperSelectors = [
        "[data-testid='cc_commonCom_autoComplete']",
        "[class*='TopadsSearchBanner_searchContent']",
        "[class*='TopadsSearchBanner_searchContainer']",
        "[class*='TopadsListFilter_searchInput']",
        "[class*='CcAutoCompleteInput_container']",
        "input[placeholder*='Search']",
        "input[placeholder*='search']",
        "input[type='search']"
      ];
      let typed = false;
      for (const sel of searchWrapperSelectors) {
        try {
          const el = await session.page.$(sel);
          if (!el) continue;
          // scroll into view 防止 banner 已被滚出可视区
          await el.scrollIntoViewIfNeeded().catch(() => undefined);
          await el.click({ delay: 80 });
          // 清掉旧值（如果是 reuse session，理论上每次都是新 session 不需要清）
          await session.page.keyboard.press("Meta+A").catch(() => undefined);
          await session.page.keyboard.press("Control+A").catch(() => undefined);
          await session.page.keyboard.press("Delete").catch(() => undefined);
          // page.keyboard.type 触发真键盘事件序列（keydown/input/keyup），
          // React/Vue 自定义 input 都吃；el.fill() 只对原生 input 工作。
          await session.page.keyboard.type(keywordForSearch, { delay: 25 });
          await session.page.waitForTimeout(300); // 等 autocomplete debounce
          await session.page.keyboard.press("Enter");
          typed = true;
          break;
        } catch {
          // 试下一个 selector
        }
      }

      if (typed) {
        // 等真正带 keyword= 的 XHR 回来；韩国住宅代理 → 美国 TikTok 端可能慢，给 30s
        try {
          await session.page.waitForResponse(
            (r) =>
              r.url().includes(LIST_API_PATH) &&
              r.url().includes(SEARCH_QUERY_MARKER),
            { timeout: 30_000 }
          );
        } catch {
          // 兜底等一波；可能 XHR 已经走了 但 waitForResponse miss
          await session.page.waitForTimeout(3_000).catch(() => undefined);
        }
      }
    }

    // 再抓一次页面内容用于 captcha 检测
    if (!pageContent) {
      try {
        pageContent = await session.page.content();
      } catch {
        // ignore
      }
    }

    // ───── 错误判定 ─────
    // 优先选 searchBody（如果调用方要求 search 且拿到了），否则用 trendingBody。
    // TS 不能跨闭包追踪 body 的可空性（闭包内 assignment 不算 flow-analysis
    // 更新），用临时变量 + 显式 cast 让 narrowing 走通。
    const capturedSearch = searchBody as TiktokListResponse | null;
    const capturedTrending = trendingBody as TiktokListResponse | null;
    const usedSource: "search" | "trending" | "none" = capturedSearch
      ? "search"
      : capturedTrending
        ? "trending"
        : "none";
    const capturedBody: TiktokListResponse | null =
      capturedSearch ?? capturedTrending;

    if (!capturedBody) {
      const kind = classifyTiktokError({
        httpStatus: listResponseStatus ?? undefined,
        pageContent
      });
      return {
        ok: false,
        error: kind === "unknown" ? "anti_bot" : kind,
        message:
          kind === "captcha"
            ? "TikTok Creative Center showed a captcha challenge"
            : `Did not receive ${LIST_API_PATH} response (likely anti-bot block; need residential proxy)`,
        statusCode: listResponseStatus ?? undefined
      };
    }

    // 调用方要求 search，但只拿到 trending —— 当成 anti-bot 失败上报，
    // 否则匹配阶段会把 trending 当成"该 keyword 的爆款"，污染检索。
    if (wantSearch && usedSource !== "search") {
      const kind = classifyTiktokError({
        httpStatus: listResponseStatus ?? undefined,
        pageContent
      });
      return {
        ok: false,
        error: kind === "unknown" ? "anti_bot" : kind,
        message: `Captured trending feed but search XHR for keyword="${keywordForSearch}" never returned (likely anti-bot / search input not rendered)`,
        statusCode: listResponseStatus ?? undefined
      };
    }

    const envelopeCode = capturedBody.code;
    if (envelopeCode != null && envelopeCode !== 0) {
      const kind = classifyTiktokError({
        httpStatus: listResponseStatus ?? undefined,
        envelopeCode,
        envelopeMsg: capturedBody.msg,
        pageContent
      });
      return {
        ok: false,
        error: kind,
        message: `TikTok envelope code=${envelopeCode} msg="${capturedBody.msg ?? ""}"`,
        statusCode: listResponseStatus ?? undefined
      };
    }

    // ───── 解析 ─────
    let parsed;
    try {
      parsed = parseListResponse(capturedBody, params.region);
    } catch (parseErr) {
      return {
        ok: false,
        error: "parse_error",
        message: `failed to map TikTok items: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`
      };
    }

    const ads = parsed.ads.slice(0, limit);

    return {
      ok: true,
      ads,
      pageCount: ads.length,
      raw: { source: usedSource, body: capturedBody }
    };
  } catch (error) {
    // 任何未覆盖的运行时异常都收敛到 unknown
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

// Re-export 错误分类纯函数，方便 CLI / 测试不启动 browser 也能验证逻辑
export const __internals = {
  classifyTiktokError,
  parseListResponse,
  tiktokItemToNewAd,
  periodFromWindow,
  pickBestVideoUrl
};
