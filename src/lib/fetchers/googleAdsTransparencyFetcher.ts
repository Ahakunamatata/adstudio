// GoogleAdsTransparencyFetcher: 公开 Google Ad Transparency Center →
// 拦 RPC XHR / 解析 SSR data → 我方 ads 行。
//
// 端点：https://adstransparency.google.com/?region=anywhere&q=KW
//
// 内部 XHR：Google 用 GRPC-Web style RPC，path 包含 SearchService。data
// 在 page hydrate 后 fetch。我们用 stealth playwright 加载页面 + 拦 XHR +
// 滚动触发懒加载。
//
// 关键反爬：Google 严格检测 chromium fingerprint，必须用 playwright-extra +
// stealth plugin（已通过 launchBrowserSession 接入）。

import type { NewAd } from "@/lib/db/schema";
import {
  launchBrowserSession,
  gotoWithRetry,
  type BrowserSession
} from "./playwright/browser";

const DEFAULT_TIMEOUT_MS = 60_000;
const TARGET_HOST = "adstransparency.google.com";

export type GoogleAdsFetchParams = {
  keyword: string;
  region: string; // ISO-3166 alpha-2, "US" / "GB" / "JP"...
  limit?: number;
  signal?: AbortSignal;
};

export type GoogleAdsFetchErrorKind =
  | "anti_bot"
  | "captcha"
  | "rate_limited"
  | "network"
  | "parse_error"
  | "unknown";

export type GoogleAdsFetchResult =
  | { ok: true; ads: NewAd[]; pageCount: number; raw: unknown }
  | {
      ok: false;
      error: GoogleAdsFetchErrorKind;
      message: string;
      statusCode?: number;
    };

// Google AdsTransparency 返回的"广告卡片"字段（启发式 flatten 后的常见 key）。
// 不依赖具体 schema 因为 Google 不发布 API；用宽松候选 key matching。
type FlatAdMaybe = {
  advertiser_name?: string;
  advertiser_id?: string;
  creative_id?: string;
  ad_creative_id?: string;
  region?: string;
  domain?: string;
  destination?: string;
  destination_url?: string;
  preview_url?: string;
  thumbnail?: string;
  format?: string; // VIDEO / IMAGE / TEXT
  body_text?: string;
  text?: string;
  title?: string;
  last_shown_date?: string;
  first_shown_date?: string;
};

// Flatten arbitrary nested JSON to dot-paths（同 tiktokDetailFetcher 做法）
function flatten(obj: unknown, prefix: string, acc: Record<string, unknown>): void {
  if (obj == null) return;
  if (typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => flatten(v, `${prefix}[${i}]`, acc));
    return;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v != null && typeof v === "object") flatten(v, key, acc);
    else acc[key] = v;
  }
}

function pickString(flat: Record<string, unknown>, candidates: string[]): string | null {
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

// 从 RPC 响应或 SSR 数据里抽 ad 信息
function extractAdsFromBodies(bodies: unknown[]): FlatAdMaybe[] {
  const ads: FlatAdMaybe[] = [];
  for (const body of bodies) {
    const flat: Record<string, unknown> = {};
    flatten(body, "", flat);
    // 看 flat 里有多少个 advertiser_id / creative_id / domain — 用做 ad 数量启发
    // 简化：每出现一个 ad-shaped 字段集就组成一条 ad
    const advertiserName = pickString(flat, ["advertiser_name", "advertiser.name"]);
    const advertiserId = pickString(flat, ["advertiser_id"]);
    const creativeId = pickString(flat, ["creative_id", "ad_id"]);
    const domain = pickString(flat, ["domain", "destination_url", "destination"]);
    const previewUrl = pickString(flat, ["preview_url", "thumbnail"]);
    if (advertiserName || advertiserId || creativeId) {
      ads.push({
        advertiser_name: advertiserName ?? undefined,
        advertiser_id: advertiserId ?? undefined,
        creative_id: creativeId ?? undefined,
        domain: domain ?? undefined,
        preview_url: previewUrl ?? undefined
      });
    }
  }
  return ads;
}

// 把 Google ad item 映射到我方 NewAd 行
export function googleAdItemToNewAd(item: FlatAdMaybe, region: string): NewAd {
  const sourceId = item.creative_id ?? item.advertiser_id ?? `noid-${Date.now()}-${Math.random()}`;
  const id = `google-${sourceId}`;
  const now = new Date();
  return {
    id,
    source: "google",
    sourceId,
    advertiserName: item.advertiser_name ?? null,
    advertiserPageId: item.advertiser_id ?? null,
    adCreativeBodies: item.body_text || item.text ? [item.body_text || item.text!] : null,
    adCreativeTitles: item.title ? [item.title] : null,
    adCreativeLinkDescriptions: null,
    adCreativeLinkCaptions: null,
    videoUrl: null,
    thumbnailUrl: item.preview_url ?? item.thumbnail ?? null,
    snapshotUrl:
      item.advertiser_id && item.creative_id
        ? `https://adstransparency.google.com/advertiser/${item.advertiser_id}/creative/${item.creative_id}`
        : null,
    region,
    publisherPlatforms: ["google"],
    languages: null,
    deliveryStartAt: null,
    deliveryStopAt: null,
    firstSeenAt: now,
    lastSeenAt: now,
    status: "active",
    raw: item as unknown as object,
    transcript: null,
    landingPageUrl: item.destination_url ?? item.destination ?? null,
    metrics:
      item.format
        ? ({ format: item.format } as Record<string, unknown>)
        : null,
    enrichedAt: now,
    createdAt: now,
    updatedAt: now
  } as NewAd;
}

export async function fetchGoogleAdsTransparency(
  params: GoogleAdsFetchParams
): Promise<GoogleAdsFetchResult> {
  if (!params.region || !/^[A-Z]{2}$/.test(params.region)) {
    return {
      ok: false,
      error: "unknown",
      message: `fetchGoogleAdsTransparency: region must be ISO-3166 alpha-2, got "${params.region}"`
    };
  }
  if (!params.keyword || params.keyword.trim().length === 0) {
    return { ok: false, error: "unknown", message: "keyword required" };
  }

  const limit = Math.max(1, Math.min(params.limit ?? 30, 100));
  const internal = new AbortController();
  const timeoutMs = DEFAULT_TIMEOUT_MS;
  const timeoutHandle = setTimeout(() => internal.abort(), timeoutMs);
  const onCallerAbort = () => internal.abort();
  params.signal?.addEventListener("abort", onCallerAbort);

  let session: BrowserSession | null = null;
  const capturedBodies: unknown[] = [];
  let lastHttpStatus: number | null = null;
  let pageContent = "";

  try {
    session = await launchBrowserSession({
      headless: true,
      navTimeoutMs: timeoutMs
    });

    // 拦截所有 adstransparency.google.com / SearchService / RPC 端点
    session.page.on("response", async (resp) => {
      const url = resp.url();
      if (!url.includes(TARGET_HOST) && !url.includes("SearchService")) return;
      if (url.endsWith(".js") || url.endsWith(".css") || url.endsWith(".png")) return;
      lastHttpStatus = resp.status();
      try {
        const text = await resp.text();
        if (text.length < 50) return;
        // Google 经常用 `)]}'` 前缀防 XSSI
        const cleaned = text.replace(/^\)\]\}'?\s*/, "");
        try {
          capturedBodies.push(JSON.parse(cleaned));
        } catch {
          // 不是 JSON（可能是 HTML SSR），存原文 fallback
          if (text.includes("advertiser") || text.includes("creative_id")) {
            capturedBodies.push({ __raw_html: text.slice(0, 200_000) });
          }
        }
      } catch {
        // 忽略
      }
    });

    // Google AdsTransparency 不支持 region 参数（region=anywhere 是默认）
    // —— 我们的 region 字段用作 ad 入库时的 region 标识，不影响搜索本身
    const targetUrl = `https://${TARGET_HOST}/?region=anywhere&q=${encodeURIComponent(params.keyword)}`;

    try {
      await gotoWithRetry(session.page, targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: timeoutMs,
        maxRetries: 1,
        retryBackoffMs: 4_000
      });
    } catch (navErr) {
      if (internal.signal.aborted) {
        return {
          ok: false,
          error: "network",
          message: `navigation aborted/timeout after ${timeoutMs}ms`
        };
      }
      return {
        ok: false,
        error: "network",
        message: `goto failed: ${navErr instanceof Error ? navErr.message : String(navErr)}`
      };
    }

    // 等 hydration + 滚动触发 lazy load
    await session.page.waitForTimeout(3000).catch(() => undefined);
    for (let i = 0; i < 3; i++) {
      try {
        await session.page.evaluate(() => window.scrollBy(0, 2000));
        await session.page.waitForTimeout(2500);
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

    // 从 DOM 直接抽 advertiser 卡片（最稳）
    let domAds: FlatAdMaybe[] = [];
    try {
      domAds = await session.page.evaluate(() => {
        // Google AdsTransparency 用 [role='listitem'] 或 .advertiser-card 类的容器
        const items = Array.from(
          document.querySelectorAll(
            "[role='listitem'],[class*='advertiser'],[data-advertiser-id]"
          )
        );
        const out: Array<{
          advertiser_name?: string;
          advertiser_id?: string;
          creative_id?: string;
          domain?: string;
          preview_url?: string;
        }> = [];
        for (const el of items) {
          const advertiserId =
            (el as HTMLElement).getAttribute("data-advertiser-id") ?? undefined;
          const creativeId =
            (el as HTMLElement).getAttribute("data-creative-id") ?? undefined;
          const linkHref = el.querySelector("a")?.getAttribute("href") ?? "";
          const advFromHref = linkHref.match(/\/advertiser\/([A-Z0-9]+)/i)?.[1];
          const crFromHref = linkHref.match(/\/creative\/([A-Z0-9]+)/i)?.[1];
          const text = (el as HTMLElement).innerText ?? "";
          const advertiserName = text.split("\n")[0]?.trim() || undefined;
          const img = el.querySelector("img");
          const preview = img?.getAttribute("src") ?? undefined;
          if (advertiserId || creativeId || advFromHref || crFromHref) {
            out.push({
              advertiser_name: advertiserName,
              advertiser_id: advertiserId ?? advFromHref ?? undefined,
              creative_id: creativeId ?? crFromHref ?? undefined,
              preview_url: preview
            });
          }
        }
        return out;
      });
    } catch (e) {
      console.warn(
        "[googleAdsTransparency] DOM extraction failed:",
        e instanceof Error ? e.message : String(e)
      );
    }

    // XHR 抓到的 ads
    const xhrAds = extractAdsFromBodies(capturedBodies);

    // merge + dedupe
    const seen = new Set<string>();
    const merged: FlatAdMaybe[] = [];
    for (const ad of [...domAds, ...xhrAds]) {
      const k = ad.creative_id ?? ad.advertiser_id ?? "";
      if (!k || seen.has(k)) continue;
      seen.add(k);
      merged.push(ad);
      if (merged.length >= limit) break;
    }

    if (merged.length === 0) {
      return {
        ok: false,
        error: "anti_bot",
        message: `No ads extracted from Google AdsTransparency for "${params.keyword}". DOM=${domAds.length} XHR=${capturedBodies.length}`,
        statusCode: lastHttpStatus ?? undefined
      };
    }

    const ads = merged.map((item) => googleAdItemToNewAd(item, params.region));

    return {
      ok: true,
      ads,
      pageCount: ads.length,
      raw: { domAdsCount: domAds.length, xhrBodiesCount: capturedBodies.length }
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
    if (session) await session.dispose();
  }
}

export const __internals = {
  flatten,
  pickString,
  extractAdsFromBodies,
  googleAdItemToNewAd
};
