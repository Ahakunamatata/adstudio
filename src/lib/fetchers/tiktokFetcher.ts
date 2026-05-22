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
// 硬上限：单次 fetch 调用绝对不能超过这个时间。超出就强制关闭 context 让 Playwright 调用都抛错。
// 之前 10min/attempt 是因为内部 AbortController 是软标记，Playwright 不读 —— 现在改成关 context 真打断。
const HARD_TIMEOUT_MS = Number(process.env.TIKTOK_HARD_TIMEOUT_MS ?? 120_000);
const TARGET_HOST = "ads.tiktok.com";
const LIST_API_PATH = "/creative_radar_api/v1/top_ads/v2/list";
// 当 XHR URL 里出现 keyword= 时是真搜索结果（不是 top trending）
const SEARCH_QUERY_MARKER = "keyword=";

// 失败 diagnostic dump：env TIKTOK_DUMP_DIR 指向写权限目录（如 /tmp）时启用
// dump screenshot + HTML，方便看 selector 变化 / captcha / 空页。
// 不抛错 —— 失败也别影响主流程。
async function dumpTiktokFailure(
  page: import("playwright").Page,
  tag: string
): Promise<void> {
  const dumpDir = process.env.TIKTOK_DUMP_DIR;
  if (!dumpDir) return;
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    await fs.mkdir(dumpDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const safeTag = tag.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 40);
    const stem = path.join(dumpDir, `tt-${ts}-${safeTag}`);
    await page.screenshot({ path: `${stem}.png`, fullPage: false }).catch(() => undefined);
    const html = await page.content().catch(() => "");
    if (html) await fs.writeFile(`${stem}.html`, html.slice(0, 200_000)).catch(() => undefined);
    console.warn(`[tiktok] dumped failure artifacts to ${stem}.{png,html}`);
  } catch (e) {
    console.warn(`[tiktok] dump failed:`, e instanceof Error ? e.message : String(e));
  }
}

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

  // 组合 caller signal + 内部 timeout
  const internal = new AbortController();
  const timeoutMs = DEFAULT_TIMEOUT_MS;
  const timeoutHandle = setTimeout(() => internal.abort(), timeoutMs);
  const onCallerAbort = () => internal.abort();
  params.signal?.addEventListener("abort", onCallerAbort);
  // 硬看门狗：HARD_TIMEOUT_MS 一到，把 context 强制关掉 ——
  // 任何正在 await 的 Playwright 调用都会抛 'Target closed' 立即返回，避免单次 fetcher 跑 10 分钟。
  let hardTimeoutFired = false;
  const hardTimeout = setTimeout(() => {
    hardTimeoutFired = true;
    internal.abort();
    if (session) {
      session.context.close().catch(() => undefined);
    }
  }, HARD_TIMEOUT_MS);

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

    // 构造目标 URL。
    // 2026-05-22 升级：search 模式直接把 &keyword=X 塞进 URL，让 SPA 在 mount
    // 阶段自己发 search XHR —— 不依赖 input 交互（旧路径失败率 100%：
    // trending XHR 拿到了，但 input 输入 + Enter 不触发 search XHR）。
    // 旧的 input-based fallback 还保留在下面，万一 URL 路径也不行能兜一层。
    const queryParts: string[] = [
      `period=${period}`,
      `region=${encodeURIComponent(params.region)}`
    ];
    if (params.industry) {
      queryParts.push(`industry=${encodeURIComponent(params.industry)}`);
    }
    if (wantSearch && keywordForSearch.length > 0) {
      // 优先用 URL 触发 search —— TikTok Creative Center SPA 在 mount 时会读
      // URL 里的 keyword 参数 → 自动触发 search XHR。
      queryParts.push(`keyword=${encodeURIComponent(keywordForSearch)}`);
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

    // URL 已经带 keyword → 先等 SPA 自己发 search XHR（20s 上限）。
    // 多数情况下应该这里就够了，下面 input fallback 通常用不上。
    if (wantSearch && keywordForSearch.length > 0 && !searchBody && !internal.signal.aborted) {
      try {
        await session.page.waitForResponse(
          (r) =>
            r.url().includes(LIST_API_PATH) &&
            r.url().includes(SEARCH_QUERY_MARKER),
          { timeout: 20_000 }
        );
      } catch {
        // URL 触发失败，下面 input fallback 接力
      }
    }

    // ── 如果上面 URL 路径没拿到 search XHR：回退到 input + 点搜索按钮 ──
    // 2026-05-22 dump 验证：实际 DOM 结构
    //   input.byted-input.byted-input-size-md[placeholder="Search by brand or product keywords"]
    //   [data-testid="cc_commonCom_autoComplete_seach"]  <- 搜索按钮（注意拼写：seach 不是 search）
    // 之前只点 wrapper + Enter，没点搜索按钮 → keyword 输了但 search 没提交。
    if (wantSearch && keywordForSearch.length > 0 && !searchBody && !internal.signal.aborted) {
      // 直接命中原生 input。byted-input 是 TikTok 的 design system input。
      const inputSelectors = [
        "input.byted-input[placeholder*='brand or product']",
        "input.byted-input.byted-input-size-md",
        "[data-testid='cc_commonCom_autoComplete'] input",
        "input[placeholder*='Search by brand']",
        "input[placeholder*='Search']"
      ];
      let typed = false;
      let inputEl: import("playwright").ElementHandle | null = null;
      for (const sel of inputSelectors) {
        try {
          const el = await session.page.$(sel);
          if (!el) continue;
          // 用 fill 优先（原生 input），失败再点击 + keyboard.type
          await el.scrollIntoViewIfNeeded().catch(() => undefined);
          try {
            await el.fill(keywordForSearch);
            typed = true;
            inputEl = el;
            break;
          } catch {
            // fill 失败时降级到点击 + 键盘输入
            await el.click({ delay: 80 });
            await session.page.keyboard.press("Meta+A").catch(() => undefined);
            await session.page.keyboard.press("Control+A").catch(() => undefined);
            await session.page.keyboard.press("Delete").catch(() => undefined);
            await session.page.keyboard.type(keywordForSearch, { delay: 25 });
            typed = true;
            inputEl = el;
            break;
          }
        } catch {
          // 试下一个 selector
        }
      }

      if (typed) {
        // 等 autocomplete debounce
        await session.page.waitForTimeout(400);
        // 关键修复：明确点 "cc_commonCom_autoComplete_seach" 搜索按钮（注意是 seach 拼错）
        // 不依赖 Enter 提交 —— TikTok 的搜索按钮独立 click 才能触发 search XHR。
        const searchButtonSelectors = [
          "[data-testid='cc_commonCom_autoComplete_seach']",
          "[data-testid='cc_commonCom_autoComplete_search']", // 万一改回正确拼写
          "[class*='AutoComplete'] [class*='search']:not(input)",
          "[class*='SearchButton']",
          "button[class*='search']"
        ];
        let clicked = false;
        for (const sel of searchButtonSelectors) {
          try {
            const btn = await session.page.$(sel);
            if (!btn) continue;
            await btn.click({ delay: 50 });
            clicked = true;
            break;
          } catch {
            // 试下一个
          }
        }
        if (!clicked) {
          // 兜底：按 Enter
          await session.page.keyboard.press("Enter").catch(() => undefined);
        }
        // 等真正带 keyword= 的 XHR 回来；URL 不会变（SPA），靠 XHR URL 拦
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
      // 释放 element handle
      if (inputEl) await inputEl.dispose().catch(() => undefined);
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

    // 调用方要求 search 但没拿到 search XHR：
    // 2026-05-22 策略调整：不再当 anti-bot 失败上报，改为降级用 trending 数据
    // 客户端过滤。trending feed 有 ~30 条/region，过滤出包含 keyword 的就行 ——
    // 比"完全失败"好得多。原因：TikTok 的 search UI 即使 stealth + 正确按钮 click
    // 也偶发不发 search XHR（猜测：需要更复杂的鼠标轨迹模拟才能过反爬）。
    // 用 trending 兜底虽然召回少了，但起码有数据。
    if (wantSearch && usedSource !== "search") {
      // 留个 dump 方便后续真打通 search 时回来 debug，但不阻塞主流程
      await dumpTiktokFailure(session.page, `search-miss-${keywordForSearch}`)
        .catch(() => undefined);
      console.warn(
        `[tiktok] search XHR miss for "${keywordForSearch}" - falling back to client-side keyword filter on trending feed`
      );
      // 落到下面 parseListResponse + 客户端过滤
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

    // 客户端 keyword 过滤：search XHR 没成功时，从 trending 里挑包含 keyword 的
    // 简单 case-insensitive substring 匹配。trending feed 有 brand_name +
    // ad_creative_bodies + ad_creative_titles，几个字段都查一遍。
    let ads = parsed.ads;
    if (wantSearch && usedSource !== "search" && keywordForSearch.length > 0) {
      const needle = keywordForSearch.toLowerCase();
      const before = ads.length;
      ads = ads.filter((ad) => {
        const hay = [
          ad.advertiserName ?? "",
          ...(ad.adCreativeBodies ?? []),
          ...(ad.adCreativeTitles ?? [])
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(needle);
      });
      console.warn(
        `[tiktok] client-filter "${keywordForSearch}": ${before} trending → ${ads.length} matched`
      );
    }
    ads = ads.slice(0, limit);

    return {
      ok: true,
      ads,
      pageCount: ads.length,
      raw: { source: usedSource, body: capturedBody }
    };
  } catch (error) {
    // 任何未覆盖的运行时异常都收敛到 unknown
    const msg = error instanceof Error ? error.message : String(error);
    const lower = msg.toLowerCase();
    const isAbort =
      error instanceof Error &&
      (error.name === "AbortError" ||
        lower.includes("aborted") ||
        lower.includes("timeout") ||
        lower.includes("target closed") ||
        lower.includes("context closed") ||
        lower.includes("browser has been closed"));
    return {
      ok: false,
      error: isAbort ? "network" : "unknown",
      message: hardTimeoutFired
        ? `fetcher hard timeout: ${HARD_TIMEOUT_MS}ms exceeded (context force-closed)`
        : isAbort
          ? `request timed out after ${timeoutMs}ms`
          : `unexpected: ${msg}`
    };
  } finally {
    clearTimeout(timeoutHandle);
    clearTimeout(hardTimeout);
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
