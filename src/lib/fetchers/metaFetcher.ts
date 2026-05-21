// MetaFetcher: Meta Ad Library Graph API → 我方 ads 行
//
// 端点：https://graph.facebook.com/v23.0/ads_archive
// 凭证：App Access Token = `${META_APP_ID}|${META_APP_SECRET}`
//
// 状态：APP_ID + APP_SECRET 已就位，但用户的 Identity Verification 还在等审核。
// 验证通过前所有真实调用会返回 code 10 / subcode 2332004 之类。fetchMetaAds 把
// 这种状态分类成 `verification_pending`，调用方（CLI / API route）应该展示
// 友好提示而不是冒红色 stack trace。
//
// Meta API 关键约束（必须知道）：
//   - 商业广告只在 EU/UK/巴西/印度 通过 API 暴露
//   - US / SEA / 其他市场的商业广告：API 只返回政治议题广告
//   - response.data[] 里的字段都是 string / string[] / ISO 时间
//   - paging.next 是已经签好的完整 URL（含 access_token），不要自己拼

import type { NewAd } from "@/lib/db/schema";

const META_API_VERSION = "v23.0";
const DEFAULT_TIMEOUT_MS = 30_000;

export type MetaFetchParams = {
  searchTerms: string; // free-text 搜索词，"anti-theft alarm"
  countries: string[]; // ISO-2，e.g. ["DE","FR","IT","ES","NL","PL"]
  adActiveStatus?: "ALL" | "ACTIVE" | "INACTIVE";
  adType?: "ALL" | "POLITICAL_AND_ISSUE_ADS";
  limit?: number; // Meta 单页最多 250
  timeoutMs?: number; // 默认 30s
};

export type MetaFetchErrorKind =
  | "verification_pending"
  | "rate_limited"
  | "auth"
  | "network"
  | "unknown";

export type MetaFetchResult =
  | { ok: true; ads: NewAd[]; pageCount: number; raw: unknown }
  | {
      ok: false;
      error: MetaFetchErrorKind;
      message: string;
      statusCode?: number;
    };

type MetaArchiveItem = {
  id: string;
  page_id?: string;
  page_name?: string;
  ad_creative_bodies?: string[];
  ad_creative_link_titles?: string[];
  ad_creative_link_descriptions?: string[];
  ad_creative_link_captions?: string[];
  ad_snapshot_url?: string;
  ad_delivery_start_time?: string;
  ad_delivery_stop_time?: string;
  publisher_platforms?: string[];
  languages?: string[];
};

type MetaApiError = {
  message: string;
  type?: string;
  code: number;
  error_subcode?: number;
  fbtrace_id?: string;
};

type MetaArchiveResponse = {
  data?: MetaArchiveItem[];
  paging?: { cursors?: { before?: string; after?: string }; next?: string };
  error?: MetaApiError;
};

const REQUESTED_FIELDS = [
  "id",
  "page_id",
  "page_name",
  "ad_creative_bodies",
  "ad_creative_link_titles",
  "ad_creative_link_descriptions",
  "ad_creative_link_captions",
  "ad_snapshot_url",
  "ad_delivery_start_time",
  "ad_delivery_stop_time",
  "publisher_platforms",
  "languages"
].join(",");

function buildAccessToken(): string | null {
  const appId = process.env.META_APP_ID?.trim();
  const appSecret = process.env.META_APP_SECRET?.trim();
  if (!appId || !appSecret) return null;
  return `${appId}|${appSecret}`;
}

function parseDate(iso?: string): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

// 把 Meta API 的 error 分类成我们的错误枚举
//
// 已知的 Meta error code 对照（来自 Graph API 文档 + 实测）：
//   - 10 + subcode 2332004: App 未完成 Identity / Page Verification
//   - 4:    rate limit (App-level)
//   - 17:   user request limit reached
//   - 190:  invalid OAuth access token
//   - 200:  permissions error
//   - 1 / 2: 临时错误，本视为 unknown
function classifyMetaError(
  status: number,
  apiError?: MetaApiError
): MetaFetchErrorKind {
  if (apiError) {
    if (apiError.code === 10) return "verification_pending";
    // subcode 2332004 specifically about App verification flow
    if (apiError.error_subcode === 2332004) return "verification_pending";
    if (apiError.code === 4 || apiError.code === 17) return "rate_limited";
    if (apiError.code === 190 || apiError.code === 200) return "auth";
    // verification-related substring fallbacks (Meta wording sometimes drifts)
    const msg = apiError.message?.toLowerCase() ?? "";
    if (
      msg.includes("identity") ||
      msg.includes("verification") ||
      msg.includes("app role required") ||
      msg.includes("not have permission")
    ) {
      return "verification_pending";
    }
  }
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403) return "auth";
  return "unknown";
}

function metaItemToNewAd(item: MetaArchiveItem, countries: string[]): NewAd {
  const id = `meta-${item.id}`;
  const now = new Date();
  return {
    id,
    source: "meta",
    sourceId: item.id,
    advertiserName: item.page_name ?? null,
    advertiserPageId: item.page_id ?? null,
    adCreativeBodies:
      item.ad_creative_bodies && item.ad_creative_bodies.length > 0
        ? item.ad_creative_bodies
        : null,
    adCreativeTitles:
      item.ad_creative_link_titles && item.ad_creative_link_titles.length > 0
        ? item.ad_creative_link_titles
        : null,
    adCreativeLinkDescriptions:
      item.ad_creative_link_descriptions &&
      item.ad_creative_link_descriptions.length > 0
        ? item.ad_creative_link_descriptions
        : null,
    adCreativeLinkCaptions:
      item.ad_creative_link_captions &&
      item.ad_creative_link_captions.length > 0
        ? item.ad_creative_link_captions
        : null,
    videoUrl: null, // Meta API 不直接给 video URL；snapshot_url 里嵌着原创意
    thumbnailUrl: null,
    snapshotUrl: item.ad_snapshot_url ?? null,
    // Meta API doesn't return per-ad region. 兜底用请求时传的第一个 country。
    // ad_delivery_by_region 是个独立字段，未来可以单独请求 + 解析。
    region: countries[0] ?? null,
    publisherPlatforms:
      item.publisher_platforms && item.publisher_platforms.length > 0
        ? item.publisher_platforms
        : null,
    languages:
      item.languages && item.languages.length > 0 ? item.languages : null,
    deliveryStartAt: parseDate(item.ad_delivery_start_time),
    deliveryStopAt: parseDate(item.ad_delivery_stop_time),
    firstSeenAt: now,
    lastSeenAt: now,
    status: "active",
    raw: item as unknown as object,
    createdAt: now,
    updatedAt: now
  };
}

/**
 * 调 Meta Ads Archive Graph API 拉一页广告。
 *
 * 当前实现单页返回（最多 limit=50）。`pageCount` 字段表示本次请求实际拉到的
 * 广告条数（不是分页页数）。需要翻页时未来扩 `after` cursor + while 循环。
 *
 * 任何错误都被收敛到 `{ ok: false }` 形态，不抛异常，方便调用方走友好提示路径。
 */
export async function fetchMetaAds(
  params: MetaFetchParams
): Promise<MetaFetchResult> {
  const accessToken = buildAccessToken();
  if (!accessToken) {
    return {
      ok: false,
      error: "auth",
      message:
        "META_APP_ID / META_APP_SECRET not set in env (.env.local)"
    };
  }
  if (!params.countries || params.countries.length === 0) {
    return {
      ok: false,
      error: "unknown",
      message: "fetchMetaAds: countries must contain at least one ISO-2 code"
    };
  }
  if (!params.searchTerms || params.searchTerms.trim().length === 0) {
    return {
      ok: false,
      error: "unknown",
      message: "fetchMetaAds: searchTerms is empty"
    };
  }

  const query = new URLSearchParams();
  query.set("access_token", accessToken);
  query.set("search_terms", params.searchTerms);
  query.set("ad_reached_countries", JSON.stringify(params.countries));
  query.set("ad_active_status", params.adActiveStatus ?? "ALL");
  query.set("ad_type", params.adType ?? "ALL");
  query.set("fields", REQUESTED_FIELDS);
  query.set("limit", String(params.limit ?? 50));

  const url = `https://graph.facebook.com/${META_API_VERSION}/ads_archive?${query.toString()}`;

  const controller = new AbortController();
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      // Meta 偶尔慢，禁用 next.js fetch cache 让每次都打真实 API
      cache: "no-store"
    });
  } catch (error) {
    clearTimeout(timeoutHandle);
    const isAbort =
      error instanceof Error &&
      (error.name === "AbortError" ||
        error.message.toLowerCase().includes("aborted"));
    return {
      ok: false,
      error: "network",
      message: isAbort
        ? `request timed out after ${timeoutMs}ms`
        : `network error: ${error instanceof Error ? error.message : String(error)}`
    };
  }
  clearTimeout(timeoutHandle);

  let payload: MetaArchiveResponse;
  try {
    payload = (await response.json()) as MetaArchiveResponse;
  } catch (error) {
    return {
      ok: false,
      error: "unknown",
      message: `Meta API returned non-JSON body: ${error instanceof Error ? error.message : String(error)}`,
      statusCode: response.status
    };
  }

  if (!response.ok || payload.error) {
    const apiError = payload.error;
    const kind = classifyMetaError(response.status, apiError);
    const message = apiError
      ? `Meta API ${apiError.code}${apiError.error_subcode ? `/${apiError.error_subcode}` : ""}: ${apiError.message}`
      : `Meta API HTTP ${response.status}`;
    return { ok: false, error: kind, message, statusCode: response.status };
  }

  const items = payload.data ?? [];
  const ads = items.map((item) => metaItemToNewAd(item, params.countries));

  return {
    ok: true,
    ads,
    pageCount: ads.length,
    raw: payload
  };
}
