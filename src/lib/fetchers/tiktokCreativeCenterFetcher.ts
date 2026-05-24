// TikTok Creative Center REST fetcher
//
// 跟 tiktokFetcher.ts（Playwright + XHR 拦截）走不同路径。这里假设有 ops
// 维护一份 session 文件（cookie + 动态签名头），fetcher 直接拼 REST URL
// 走 fetch，不开浏览器。
//
// 端点：GET https://ads.tiktok.com/creative_radar_api/v1/top_ads/v2/list
//   query: period | page | limit | order_by | country_code
//   headers: cookie / timestamp / user-sign / web-id / anonymous-user-id
//
// 与 metaFetcher.ts 类似：错误一律收敛到 { ok: false, error, message } 形态，
// 不抛异常，方便 worker / API route 走友好提示路径。
//
// source 区分：本路径产 NewAd.source = 'tiktok_cc'，跟现有 Playwright 路径
// （source = 'tiktok'）分两个池子，下游 enrich / rank 可以分别策略。

import { ProxyAgent } from "undici";

import type { NewAd } from "@/lib/db/schema";
import type { TiktokAdItem, TiktokListResponse } from "./types";
import {
  loadSession,
  assembleHeaders,
  SessionExpiredError,
  SessionMissingError,
  type TtCcSession
} from "./tiktokCreativeCenterSession";

const PAGE_SIZE = 20; // TikTok creative_radar_api 单页固定 20
const INTER_PAGE_SLEEP_MS = 800;
const DEFAULT_LIMIT = 100;

// 代理选择：
//   1) TIKTOK_CC_PROXY_URL（这条路径专属，可以跟 Playwright TikTok 走不同代理）
//   2) TIKTOK_PROXY_URL（跟现有 Playwright TikTok 路径共用住宅代理，对齐 Meta
//      fetcher 的 fallback 习惯）
//   3) HTTPS_PROXY（通用 node 兜底）
//
// 必须走住宅代理：ECS data center IP（实测 47.77.177.67）会被 TikTok 直接拒
// 40101（no permission），即使 cookies 有效。Mac + Clash residential exit 同
// cookies 就 200 OK。
//
// 没设代理时直连——保留这个分支让本机 smoke test（mock fetch）跟不需要代理
// 的环境都能跑。
function pickProxyUrl(): string | null {
  const candidates = [
    process.env.TIKTOK_CC_PROXY_URL,
    process.env.TIKTOK_PROXY_URL,
    process.env.HTTPS_PROXY
  ];
  for (const v of candidates) {
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

export type TtCcOrderBy = "for_you";

export type TtCcFetchParams = {
  region: string; // 必填，ISO-3166 alpha-2 e.g. "US" / "JP" / "UK"
  period?: 7 | 30 | 90 | 180; // 默认 30
  orderBy?: TtCcOrderBy; // 当前只支持 for_you
  limit?: number; // 总条数上限，默认 100；分页内部循环
  sessionPath?: string; // 不传从 env 读
  signal?: AbortSignal;
};

export type TtCcFetchErrorKind =
  | "session_expired"
  | "session_missing"
  | "rate_limited"
  | "network"
  | "parse_error"
  | "unknown";

export type TtCcFetchResultOk = {
  ok: true;
  ads: NewAd[];
  totalCount: number;
  pageCount: number;
  raw: { firstPage: unknown; lastPage: unknown };
};

export type TtCcFetchResultErr = {
  ok: false;
  error: TtCcFetchErrorKind;
  message: string;
  statusCode?: number;
};

export type TtCcFetchResult = TtCcFetchResultOk | TtCcFetchResultErr;

// ── helpers ────────────────────────────────────────────────────

// 优先 720p；缺时回退到剩下里数字最大的清晰度（1080 / 540 / 480 / 360...）。
function pickVideoUrl(
  videoUrl: Record<string, string> | undefined
): string | null {
  if (!videoUrl) return null;
  if (typeof videoUrl["720p"] === "string" && videoUrl["720p"].length > 0) {
    return videoUrl["720p"];
  }
  const numericKeys = Object.keys(videoUrl).filter((k) => /^\d+p$/.test(k));
  if (numericKeys.length === 0) return null;
  numericKeys.sort((a, b) => parseInt(b, 10) - parseInt(a, 10));
  for (const k of numericKeys) {
    const v = videoUrl[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function materialToNewAd(m: TiktokAdItem, region: string): NewAd {
  const now = new Date();
  const adTitle = m.ad_title;
  const brand = typeof m.brand_name === "string" ? m.brand_name.trim() : "";
  return {
    id: `tiktok-${m.id}`,
    source: "tiktok_cc",
    sourceId: m.id,
    advertiserName: brand.length > 0 ? brand : null,
    advertiserPageId: null,
    adCreativeBodies:
      typeof adTitle === "string" && adTitle.length > 0 ? [adTitle] : null,
    adCreativeTitles: null,
    adCreativeLinkDescriptions: null,
    adCreativeLinkCaptions: null,
    videoUrl: pickVideoUrl(m.video_info?.video_url),
    thumbnailUrl: m.video_info?.cover ?? null,
    snapshotUrl: null,
    region,
    publisherPlatforms: null,
    languages: null,
    deliveryStartAt: null,
    deliveryStopAt: null,
    firstSeenAt: now,
    lastSeenAt: now,
    status: "active",
    raw: m as unknown as object,
    // TikTok CC list endpoint 没有 transcript / landing / 完整 metrics —
    // 标 enrichedAt = null，由 enrich_queue 后续走 detail 富化。
    transcript: null,
    landingPageUrl: null,
    metrics: {
      like: m.like ?? null,
      ctr: m.ctr ?? null,
      cost: m.cost ?? null,
      duration: m.video_info?.duration ?? null,
      objective_key: m.objective_key ?? null,
      industry_key: m.industry_key ?? null
    } as object,
    enrichedAt: null,
    createdAt: now,
    updatedAt: now
  };
}

function buildPageUrl(
  session: TtCcSession,
  params: {
    region: string;
    period: number;
    orderBy: TtCcOrderBy;
    page: number;
  }
): string {
  const url = new URL(session.request_template.endpoint);
  url.searchParams.set("period", String(params.period));
  url.searchParams.set("page", String(params.page));
  url.searchParams.set("limit", String(PAGE_SIZE));
  url.searchParams.set("order_by", params.orderBy);
  url.searchParams.set("country_code", params.region);
  return url.toString();
}

// 把 HTTP status + body.code 折叠成一个错误 kind。
// 已知 code：40101 = session/auth 失效（TikTok 实测在 cookie 过期时返回）。
function classifyApiError(
  status: number,
  body: TiktokListResponse | null
): { kind: TtCcFetchErrorKind; message: string } {
  if (status === 429) {
    return {
      kind: "rate_limited",
      message: `tiktok_cc HTTP 429 rate limited`
    };
  }
  if (body && body.code === 40101) {
    return {
      kind: "session_expired",
      message: `tiktok_cc API code 40101 (session expired): ${body.msg ?? ""}`
    };
  }
  if (status !== 200) {
    return {
      kind: "unknown",
      message: `tiktok_cc HTTP ${status}${body?.msg ? `: ${body.msg}` : ""}`
    };
  }
  // status=200 但 body.code !== 0 —— 其他未见过的业务错误
  return {
    kind: "unknown",
    message: `tiktok_cc API code ${body?.code ?? "?"}: ${body?.msg ?? "(no msg)"}`
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => {
        clearTimeout(t);
        reject(new Error("aborted"));
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

// ── main ──────────────────────────────────────────────────────

/**
 * 分页拉 TikTok Creative Center top ads → NewAd[]。
 *
 * 设计：
 *   - 不调 upsertAdRow，落库由调用方（crawler-runner / API route）负责
 *   - 错误一律折叠到 { ok: false, error }，不抛
 *   - 总条数受 params.limit 控制（默认 100），不会无限翻
 *   - 每翻一页 sleep 800ms（防 rate limit）
 */
export async function fetchTiktokCreativeCenter(
  params: TtCcFetchParams
): Promise<TtCcFetchResult> {
  if (!params.region || params.region.trim().length === 0) {
    return {
      ok: false,
      error: "unknown",
      message: "fetchTiktokCreativeCenter: region is required"
    };
  }

  // ── 1. load session ──
  let session: TtCcSession;
  try {
    session = await loadSession(params.sessionPath);
  } catch (e) {
    if (e instanceof SessionMissingError) {
      return { ok: false, error: "session_missing", message: e.message };
    }
    if (e instanceof SessionExpiredError) {
      return { ok: false, error: "session_expired", message: e.message };
    }
    return {
      ok: false,
      error: "unknown",
      message: `loadSession unexpected error: ${e instanceof Error ? e.message : String(e)}`
    };
  }

  const headers = assembleHeaders(session);
  const period = params.period ?? 30;
  const orderBy = params.orderBy ?? "for_you";
  const limit = params.limit ?? DEFAULT_LIMIT;

  // ── 1b. proxy ──
  // 整个 fetch 调用复用同一个 ProxyAgent（同进程内 TCP keep-alive）。
  // 没设代理时 proxyAgent = null，下面就是直连。
  const proxyUrl = pickProxyUrl();
  const proxyAgent = proxyUrl ? new ProxyAgent(proxyUrl) : null;

  // ── 2. paged fetch ──
  const ads: NewAd[] = [];
  let firstPageRaw: unknown = null;
  let lastPageRaw: unknown = null;
  let pageCount = 0;
  let totalCount = 0;
  let page = 1; // TikTok 是 1-indexed

  while (ads.length < limit) {
    const url = buildPageUrl(session, {
      region: params.region,
      period,
      orderBy,
      page
    });

    let response: Response;
    try {
      // dispatcher 是 undici 的扩展字段；node 原生 fetch 实际就是 undici，
      // 运行时认这个 key，但 TS 标准库的 RequestInit 没有，所以做一次窄化扩展。
      const init: RequestInit & { dispatcher?: ProxyAgent } = {
        method: "GET",
        headers,
        signal: params.signal,
        cache: "no-store"
      };
      if (proxyAgent) init.dispatcher = proxyAgent;
      response = await fetch(url, init);
    } catch (e) {
      return {
        ok: false,
        error: "network",
        message: `tiktok_cc fetch page ${page} failed: ${e instanceof Error ? e.message : String(e)}`
      };
    }

    let body: TiktokListResponse | null = null;
    try {
      body = (await response.json()) as TiktokListResponse;
    } catch (e) {
      // 没拿到 JSON body —— 用 HTTP status 决定 error kind
      if (response.status === 429) {
        return {
          ok: false,
          error: "rate_limited",
          message: `tiktok_cc HTTP 429 (page ${page}), body parse failed`,
          statusCode: 429
        };
      }
      return {
        ok: false,
        error: "parse_error",
        message: `tiktok_cc page ${page} JSON parse failed: ${e instanceof Error ? e.message : String(e)}`,
        statusCode: response.status
      };
    }

    if (response.status !== 200 || (body.code !== undefined && body.code !== 0)) {
      const { kind, message } = classifyApiError(response.status, body);
      return { ok: false, error: kind, message, statusCode: response.status };
    }

    if (page === 1) firstPageRaw = body;
    lastPageRaw = body;
    pageCount += 1;

    const pag = body.data?.pagination;
    if (pag?.total_count !== undefined) {
      totalCount = pag.total_count;
    }

    const materials = body.data?.materials ?? [];
    for (const m of materials) {
      ads.push(materialToNewAd(m, params.region));
      if (ads.length >= limit) break;
    }

    const hasMore = pag?.has_more ?? false;
    if (!hasMore || ads.length >= limit) break;

    page += 1;
    try {
      await sleep(INTER_PAGE_SLEEP_MS, params.signal);
    } catch {
      return {
        ok: false,
        error: "network",
        message: `tiktok_cc fetch aborted between pages`
      };
    }
  }

  return {
    ok: true,
    ads,
    totalCount,
    pageCount,
    raw: { firstPage: firstPageRaw, lastPage: lastPageRaw }
  };
}
