"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  MyProduct,
  MyProductPlatform,
  MyProductScrapedAd,
  MyProductScrapeStatus,
  MyProductType,
  TemplateIndustry,
  TopAd
} from "@/lib/domain/schemas";
import { topAds } from "@/lib/mock-data";

// ────────────────────────────────────────────────────────────────
// useMyProducts
//
// 单 hook：管理 MyProduct[]，提供：
//   - createProduct: POST /api/my-products + 触发 parsing → ready → scraping → done 状态机
//   - removeProduct: DELETE /api/my-products/[id]
//   - rescrape: 只跑抓取阶段（跳过 parse）
//
// 持久化：Postgres my_products 表（之前用 localStorage，2026-05-20 改造）。
//
// 阶段：
//   Phase 1 (parse) — 调用 POST /api/my-products/parse，让 Minimax 抽 industry /
//     keywords / cleanedIntro / cleanedPainPoints。完成后 PATCH 回 my_products 表
//     做持久化。API 失败时降级回 inferIndustryFromType + deriveKeywordsFromIntro。
//   Phase 2-5 (scrape) — 仍是 setTimeout 动画 + 一次 /match-ads 查询。
//     scrapedAds 当前是 client-only ephemeral（不写 DB），换页/刷新会重查。
// ────────────────────────────────────────────────────────────────

type ParseApiResponse = {
  industry: TemplateIndustry;
  keywords: string[];
  searchQueries?: string[];
  cleanedIntro?: string;
  cleanedPainPoints?: string;
};

// Sprint A：crawl-status 轮询返回的形状
type CrawlSourceSummary = {
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  adsNew: number;
};

type CrawlStatusResponse = {
  ok: boolean;
  summary: {
    total: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
    adsNewTotal: number;
  };
  jobsBySource: {
    tiktok: CrawlSourceSummary;
    meta: CrawlSourceSummary;
    google: CrawlSourceSummary;
  };
};

// DB 行的形状（GET /api/my-products 返回的 products[] 元素）
type DbProductRow = {
  id: string;
  name: string;
  type: MyProductType;
  intro: string;
  painPoints: string;
  url: string;
  images: string[];
  inferredIndustry: string | null;
  inferredKeywords: string[] | null;
  cleanedIntro: string | null;
  cleanedPainPoints: string | null;
  useForCloning: number;
  createdAt: string;
  updatedAt: string;
};

type ParseApiInput = {
  name: string;
  url: string;
  intro: string;
  painPoints: string;
  productType: string;
};

type MatchedAdFromApi = {
  id: string;
  source: "meta" | "tiktok" | "google" | "tiktok_cc";
  title: string;
  advertiserName: string | null;
  creativeBodies: string[];
  videoUrl: string | null;
  thumbnailUrl: string | null;
  snapshotUrl: string | null;
  region: string | null;
  regionFlag: string;
  // 语义检索时返回 0-100，关键词兜底时为 null（前端自己生成 fallback 分数）
  relevanceScore: number | null;
  platforms: string[];
  platformLabel: string;
  languages: string[];
  // 富化字段（Meta fetcher 入库就有；TikTok 经 enrich-runner 后有）
  landingPageUrl: string | null;
  ctaText: string | null;
  pageLikeCount: number | null;
  // LLM rerank 后的"为什么推荐这条"chip 文案，中文 <35 字
  recommendReason: string | null;
  // 用户反馈
  userFeedback?: "positive" | "negative" | null;
  deliveryStartAt: string | null;
  deliveryStopAt: string | null;
  firstSeenAt: string;
};

type MatchAdsResponse = { ads?: MatchedAdFromApi[]; error?: string };

// 优先调 cached endpoint /api/my-products/[id]/matched-ads（< 100ms 纯 SQL）。
// 拿到非空结果直接返回，没结果再 fallback 到 /match-ads 跑 LLM rerank。
async function fetchCachedMatches(productId: string): Promise<MatchedAdFromApi[] | null> {
  try {
    const response = await fetch(`/api/my-products/${productId}/matched-ads`, {
      method: "GET"
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { ads?: MatchedAdFromApi[]; cached?: boolean };
    if (data.cached && (data.ads?.length ?? 0) > 0) {
      return data.ads ?? [];
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchMatchedAdsFromDb(payload: {
  keywords: string[];
  industry?: string;
  sources?: Array<"meta" | "tiktok" | "google" | "tiktok_cc">;
  limit?: number;
  // LLM rerank 上下文：产品名/介绍/痛点。喂给 Minimax 让它精排 + 写推荐理由 chip。
  productName?: string;
  cleanedIntro?: string;
  cleanedPainPoints?: string;
  // 默认 true 启用 LLM rerank（多 ~6-10s 延迟，但每条都有 reason chip）
  rerank?: boolean;
  // 传入后端会把结果持久化到 product_ad_matches，下次走 cached endpoint
  persistForProductId?: string;
}): Promise<MatchedAdFromApi[]> {
  // 60s 超时（LLM rerank 要 5-50s + embed 1s + DB 1s + buffer）
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), 60_000);
  try {
    const response = await fetch("/api/my-products/match-ads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, limit: payload.limit ?? 12, rerank: payload.rerank ?? true }),
      signal: timeoutController.signal
    });
    if (!response.ok) {
      console.warn("[match-ads] api responded", response.status);
      return [];
    }
    const data = (await response.json()) as MatchAdsResponse;
    return data.ads ?? [];
  } catch (error) {
    console.warn("[match-ads] fetch failed:", error);
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}

function dbAdToScraped(
  ad: MatchedAdFromApi,
  index: number,
  matchedKeywords: string[]
): MyProductScrapedAd {
  const platform: MyProductPlatform =
    ad.source === "meta"
      ? "Meta"
      : ad.source === "tiktok" || ad.source === "tiktok_cc"
        ? "TikTok"
        : "Google";
  // 语义检索 → 用 API 算的真 cosine score；关键词兜底 → 按位置算降序占位分
  const relevanceScore =
    ad.relevanceScore !== null
      ? ad.relevanceScore
      : Math.max(40, 95 - index * 5);
  return {
    adId: ad.id,
    platform,
    relevanceScore,
    matchedKeywords,
    scrapedAt: nowIso(),
    adData: {
      title: ad.title,
      source: ad.source,
      advertiserName: ad.advertiserName,
      region: ad.region,
      regionFlag: ad.regionFlag,
      platformLabel: ad.platformLabel,
      thumbnailUrl: ad.thumbnailUrl,
      snapshotUrl: ad.snapshotUrl,
      videoUrl: ad.videoUrl,
      creativeBodies: ad.creativeBodies,
      landingPageUrl: ad.landingPageUrl,
      ctaText: ad.ctaText,
      pageLikeCount: ad.pageLikeCount,
      recommendReason: ad.recommendReason,
      userFeedback: ad.userFeedback ?? null,
      deliveryStartAt: ad.deliveryStartAt,
      deliveryStopAt: ad.deliveryStopAt
    }
  };
}

async function parseProductRemote(payload: ParseApiInput, signal: AbortSignal): Promise<ParseApiResponse> {
  const response = await fetch("/api/my-products/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`parse api responded ${response.status}: ${text.slice(0, 160)}`);
  }
  return (await response.json()) as ParseApiResponse;
}

type CreateProductInput = {
  name: string;
  type: MyProductType;
  intro: string;
  painPoints: string;
  url: string;
  images: string[];
  useForCloning: boolean;
};

type Timers = ReturnType<typeof setTimeout>[];

function nowIso() {
  return new Date().toISOString();
}

const PRODUCT_STATUS_FOR_LOADED: MyProductScrapeStatus = "done";

// DB 行 → 客户端 MyProduct 形状。
// status / progress / scrapedAds 是 client-only ephemeral，载入时给默认值；
// 当用户选中该产品时由 MyProductsView 触发 rescrape 拉 ads。
function dbRowToMyProduct(
  row: DbProductRow,
  overrides: Partial<MyProduct> = {}
): MyProduct {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    intro: row.intro,
    painPoints: row.painPoints,
    url: row.url,
    images: Array.isArray(row.images) ? row.images : [],
    useForCloning: row.useForCloning === 1,
    inferredIndustry:
      (row.inferredIndustry as TemplateIndustry | null) ?? undefined,
    inferredKeywords: row.inferredKeywords ?? [],
    status: PRODUCT_STATUS_FOR_LOADED,
    progress: [
      { platform: "TikTok", status: "done", count: 0 },
      { platform: "Meta", status: "done", count: 0 },
      { platform: "Google", status: "done", count: 0 }
    ],
    scrapedAds: [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...overrides
  };
}

async function persistParseResult(
  id: string,
  result: ParseApiResponse
): Promise<void> {
  try {
    const response = await fetch(`/api/my-products/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inferredIndustry: result.industry,
        inferredKeywords: result.keywords,
        ...(result.cleanedIntro ? { cleanedIntro: result.cleanedIntro } : {}),
        ...(result.cleanedPainPoints
          ? { cleanedPainPoints: result.cleanedPainPoints }
          : {})
      })
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.warn(
        `[persistParseResult] ${id} responded ${response.status}: ${text.slice(0, 160)}`
      );
    }
  } catch (error) {
    console.warn("[persistParseResult] network error:", error);
  }
}

function inferIndustryFromType(type: MyProductType): TemplateIndustry {
  switch (type) {
    case "App":
      return "app";
    case "Ecommerce":
      return "ecommerce";
    case "Game":
      return "game";
    case "SaaS":
    case "Service":
      return "saas";
    default:
      return "app";
  }
}

function deriveKeywordsFromIntro(name: string, intro: string): string[] {
  const seeds = `${name} ${intro}`
    .toLowerCase()
    .replace(/[^a-zA-Z0-9一-龥\s\-]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3);
  const dedup = Array.from(new Set(seeds)).slice(0, 6);
  if (dedup.length === 0) return [name.toLowerCase()];
  return dedup;
}

function pickAdsForIndustry(
  industry: TemplateIndustry,
  perPlatform: Record<MyProductPlatform, number>
): MyProductScrapedAd[] {
  const pool = topAds.filter((ad) => ad.industry === industry);
  if (pool.length === 0) {
    return topAds.slice(0, 3).map((ad, index) => buildScrapedAd(ad, platformAt(index), 70 - index * 5));
  }
  // De-dupe: never repeat the same ad even if perPlatform requests more than the pool has.
  // Cap requested total to the unique pool size, then distribute across platforms by quota.
  const wanted = perPlatform.TikTok + perPlatform.Meta + perPlatform.Google;
  const actual = Math.min(pool.length, wanted);
  const quota: Record<MyProductPlatform, number> = {
    TikTok: perPlatform.TikTok,
    Meta: perPlatform.Meta,
    Google: perPlatform.Google
  };
  const platformOrder: MyProductPlatform[] = ["TikTok", "Meta", "Google"];
  const result: MyProductScrapedAd[] = [];
  for (let i = 0; i < actual; i += 1) {
    const ad = pool[i];
    const platform = platformOrder.find((p) => quota[p] > 0) ?? "TikTok";
    quota[platform] -= 1;
    const score = 95 - i * 4;
    result.push(buildScrapedAd(ad, platform, score));
  }
  return result;
}

function platformAt(index: number): MyProductPlatform {
  const order: MyProductPlatform[] = ["TikTok", "Meta", "Google"];
  return order[index % order.length];
}

// Sprint A: 把 source-级 crawl_jobs 状态映射成 UI 单平台 progress
function jobsToProgressStatus(
  src: { total: number; pending: number; running: number; completed: number; failed: number }
): "pending" | "fetching" | "done" {
  if (src.total === 0) return "pending"; // 这个平台没投任务
  if (src.running > 0 || src.pending > 0) return "fetching"; // 还在跑
  return "done"; // 全部 completed/failed
}

function buildScrapedAd(ad: TopAd, platform: MyProductPlatform, score: number): MyProductScrapedAd {
  return {
    adId: ad.id,
    platform,
    relevanceScore: Math.max(40, Math.min(98, score)),
    matchedKeywords: [ad.industry, ad.region, platform === "TikTok" ? "短视频" : platform === "Meta" ? "Feed" : "Search"],
    scrapedAt: nowIso()
  };
}

export function useMyProducts() {
  const [products, setProducts] = useState<MyProduct[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const timersRef = useRef<Map<string, Timers>>(new Map());
  const controllersRef = useRef<Map<string, AbortController>>(new Map());
  // 同步映射当前 products 数组，给 setTimeout 异步回调里读最新状态用。
  // 不能依赖 `setProducts((prev) => { side-effect; return prev })` 的副作用读取
  // 因为 React 18 在 async 上下文里这种用法不保证 updater 被同步触发。
  const productsRef = useRef<MyProduct[]>([]);

  // Initial hydration from API (replaces localStorage). Failure shows empty state.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/my-products");
        if (!response.ok) {
          throw new Error(`GET /api/my-products responded ${response.status}`);
        }
        const data = (await response.json()) as { products?: DbProductRow[] };
        if (cancelled) return;
        const rows = data.products ?? [];
        setProducts(rows.map((row) => dbRowToMyProduct(row)));
      } catch (error) {
        console.warn("[useMyProducts] initial load failed:", error);
      } finally {
        if (!cancelled) {
          setHydrated(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep productsRef in sync with products state after every commit.
  useEffect(() => {
    productsRef.current = products;
  });

  // 记录哪些 product 已经触发过 auto-match，避免 effect 在 products 变化时
  // 反复 fire 同一个产品的 match-ads。
  const autoMatchedIdsRef = useRef<Set<string>>(new Set());

  // Hydrate 完之后（含每次 products 变化），对有 inferredKeywords 但 scrapedAds
  // 还空 + 没 auto-match 过的产品 fire 一次 match-ads，补回 scrapedAds。
  // scrapedAds 还没存进 DB（刷新就丢），这一步从 ads + ad_embeddings 实时回填。
  // 下个 sprint 用 product_ad_matches 表持久化后这段就可以删。
  useEffect(() => {
    if (!hydrated) return;
    const candidates = products.filter(
      (p) =>
        !autoMatchedIdsRef.current.has(p.id) &&
        p.scrapedAds.length === 0 &&
        (p.inferredKeywords?.length ?? 0) > 0 &&
        p.status !== "parsing" &&
        p.status !== "scraping"
    );
    if (candidates.length === 0) return;
    // 立刻标记防止本 effect 在 setProducts 后再次进入还把这些当 candidate
    for (const p of candidates) autoMatchedIdsRef.current.add(p.id);
    let cancelled = false;
    void (async () => {
      console.log(`[useMyProducts] auto-match ${candidates.length} product(s):`, candidates.map((p) => p.name));
      for (const product of candidates) {
        if (cancelled) return;
        try {
          // 1) 先看 product_ad_matches 有没有缓存（~50ms）
          let dbAds = await fetchCachedMatches(product.id);
          if (dbAds && dbAds.length > 0) {
            console.log(
              `[useMyProducts] auto-match "${product.name}": cached ${dbAds.length} ads`
            );
          } else {
            // 2) 没缓存 → 跑完整 match-ads（LLM rerank + 持久化）
            dbAds = await fetchMatchedAdsFromDb({
              keywords: product.inferredKeywords ?? [],
              industry: product.inferredIndustry,
              limit: 12,
              productName: product.name,
              cleanedIntro: product.intro || undefined,
              cleanedPainPoints: product.painPoints || undefined,
              rerank: true,
              persistForProductId: product.id
            });
            console.log(
              `[useMyProducts] auto-match "${product.name}": fresh ${dbAds.length} ads (persisted)`
            );
          }
          if (cancelled || dbAds.length === 0) continue;
          const matched = (product.inferredKeywords ?? []).slice(0, 2);
          const scrapedAds = dbAds
            .slice(0, 8)
            .map((ad, idx) => dbAdToScraped(ad, idx, matched));
          const countByPlatform: Record<MyProductPlatform, number> = {
            TikTok: 0,
            Meta: 0,
            Google: 0
          };
          for (const s of scrapedAds) countByPlatform[s.platform] += 1;
          setProducts((prev) =>
            prev.map((p) =>
              p.id === product.id
                ? {
                    ...p,
                    status: "done",
                    scrapedAds,
                    progress: [
                      { platform: "TikTok", status: "done", count: countByPlatform.TikTok },
                      { platform: "Meta", status: "done", count: countByPlatform.Meta },
                      { platform: "Google", status: "done", count: countByPlatform.Google }
                    ]
                  }
                : p
            )
          );
        } catch (error) {
          console.warn(`[useMyProducts] auto-match "${product.name}" failed:`, error);
          // 失败别清 ref，避免无限重试
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, products]);

  useEffect(() => {
    const timers = timersRef.current;
    const controllers = controllersRef.current;
    return () => {
      timers.forEach((list) => list.forEach((id) => clearTimeout(id)));
      timers.clear();
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
    };
  }, []);

  const updateProduct = useCallback((id: string, patch: Partial<MyProduct> | ((prev: MyProduct) => MyProduct)) => {
    setProducts((prev) =>
      prev.map((product) => {
        if (product.id !== id) return product;
        const next = typeof patch === "function" ? patch(product) : { ...product, ...patch };
        return { ...next, updatedAt: nowIso() };
      })
    );
  }, []);

  const setStatus = useCallback(
    (id: string, status: MyProductScrapeStatus) => {
      updateProduct(id, { status });
    },
    [updateProduct]
  );

  const cancelTimers = useCallback((id: string) => {
    const existing = timersRef.current.get(id);
    if (existing) {
      existing.forEach((timerId) => clearTimeout(timerId));
      timersRef.current.delete(id);
    }
    const controller = controllersRef.current.get(id);
    if (controller) {
      controller.abort();
      controllersRef.current.delete(id);
    }
  }, []);

  // Sprint A: 真 crawl-status 轮询替代假 setTimeout 动画
  //
  // 流程：
  //   1. 立即调 POST /api/my-products/[id]/start-targeted-crawl 投递 N 个 crawl_jobs
  //   2. status='scraping' + 所有平台 'pending'
  //   3. 每 2.5 秒轮询 GET /api/my-products/[id]/crawl-status 取最新状态
  //   4. 把 summary 映射成 platform-by-platform 的 fetching/done 状态
  //   5. 所有 jobs 完成时（或 90 秒超时）停止轮询 → 调 /match-ads 拉相关结果
  //   6. status='done'，刷新 scrapedAds
  const POLL_INTERVAL_MS = 2500;
  const POLL_MAX_DURATION_MS = 120_000; // 2 分钟兜底退出

  // 抓取收尾：调 /match-ads 拉相关 ads → 写入 scrapedAds → status=done
  // 必须放在 startRealCrawl 之前（startRealCrawl 在 try-catch 里调它）
  const finalizeScrape = useCallback(async (id: string) => {
    const snapshot = productsRef.current.find((p) => p.id === id);
    if (!snapshot) {
      timersRef.current.delete(id);
      return;
    }
    const keywords = snapshot.inferredKeywords ?? [];
    const industry = snapshot.inferredIndustry;
    const dbAds = await fetchMatchedAdsFromDb({
      keywords,
      industry,
      limit: 12,
      productName: snapshot.name,
      cleanedIntro: snapshot.intro || undefined,
      cleanedPainPoints: snapshot.painPoints || undefined,
      rerank: true,
      // 新爬完跑一次 match-ads 同时持久化 → 后续刷新走 cache
      persistForProductId: id
    });
    const useDbAds = dbAds.length > 0;
    const scrapedAds: MyProductScrapedAd[] = useDbAds
      ? dbAds
          .slice(0, 8)
          .map((ad, idx) => dbAdToScraped(ad, idx, keywords.slice(0, 2)))
      : pickAdsForIndustry(
          industry ?? inferIndustryFromType(snapshot.type),
          { TikTok: 3, Meta: 2, Google: 1 }
        );
    const countByPlatform: Record<MyProductPlatform, number> = {
      TikTok: 0,
      Meta: 0,
      Google: 0
    };
    for (const s of scrapedAds) countByPlatform[s.platform] += 1;
    setProducts((prev) =>
      prev.map((product) => {
        if (product.id !== id) return product;
        return {
          ...product,
          status: "done",
          progress: [
            // 保留 crawl 阶段的真新增数（如果有），fallback 到 scrapedAds 计数
            {
              platform: "TikTok",
              status: "done",
              count: Math.max(
                product.progress.find((p) => p.platform === "TikTok")?.count ?? 0,
                countByPlatform.TikTok
              )
            },
            {
              platform: "Meta",
              status: "done",
              count: Math.max(
                product.progress.find((p) => p.platform === "Meta")?.count ?? 0,
                countByPlatform.Meta
              )
            },
            {
              platform: "Google",
              status: "done",
              count: Math.max(
                product.progress.find((p) => p.platform === "Google")?.count ?? 0,
                countByPlatform.Google
              )
            }
          ],
          scrapedAds,
          updatedAt: nowIso()
        };
      })
    );
    timersRef.current.delete(id);
  }, []);

  const startRealCrawl = useCallback(
    async (id: string, searchQueries: string[]) => {
      // (1) 投 crawl_jobs。一期只 TikTok。
      try {
        const response = await fetch(
          `/api/my-products/${id}/start-targeted-crawl`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              searchQueries,
              regions: ["US"],
              // 同时投 tiktok + meta（Meta web 抓已上线，且当前 TikTok 矩阵
              // 临时禁用，靠 meta 出货）。worker 会按 source 分发到对应 fetcher。
              sources: ["tiktok", "meta"]
            })
          }
        );
        if (!response.ok) {
          const text = await response.text().catch(() => "");
          console.warn(
            `[startRealCrawl] failed: ${response.status} ${text.slice(0, 120)}`
          );
          // 投递失败：直接标 done + 走 fallback match
          await finalizeScrape(id);
          return;
        }
      } catch (error) {
        console.warn("[startRealCrawl] network error:", error);
        await finalizeScrape(id);
        return;
      }

      // (2) 标 scraping 起步态
      updateProduct(id, {
        status: "scraping",
        progress: [
          { platform: "TikTok", status: "fetching", count: 0 },
          { platform: "Meta", status: "pending", count: 0 },
          { platform: "Google", status: "pending", count: 0 }
        ]
      });

      // (3+4) 轮询
      const startedAt = Date.now();
      const pollOnce = async (): Promise<boolean> => {
        try {
          const response = await fetch(
            `/api/my-products/${id}/crawl-status`,
            { method: "GET" }
          );
          if (!response.ok) return false;
          const data = (await response.json()) as CrawlStatusResponse;
          if (!data.ok) return false;

          // 把 summary 映射到 UI 的 platform progress
          const tt = data.jobsBySource.tiktok;
          const mt = data.jobsBySource.meta;
          const gg = data.jobsBySource.google;
          updateProduct(id, (prev) => ({
            ...prev,
            progress: [
              {
                platform: "TikTok",
                status: jobsToProgressStatus(tt),
                count: tt.adsNew
              },
              {
                platform: "Meta",
                status: jobsToProgressStatus(mt),
                count: mt.adsNew
              },
              {
                platform: "Google",
                status: jobsToProgressStatus(gg),
                count: gg.adsNew
              }
            ]
          }));

          // 所有 job 终态（completed / failed / cancelled）= 收工
          const stillRunning = data.summary.pending + data.summary.running;
          return stillRunning === 0;
        } catch (error) {
          console.warn("[crawl-status poll] failed:", error);
          return false;
        }
      };

      // 轮询循环
      const poll = () => {
        const timers = timersRef.current.get(id) ?? [];
        timersRef.current.set(id, timers);
        timers.push(
          setTimeout(async () => {
            const done = await pollOnce();
            if (done) {
              await finalizeScrape(id);
              return;
            }
            if (Date.now() - startedAt > POLL_MAX_DURATION_MS) {
              console.warn(
                `[crawl-status] poll timeout after ${POLL_MAX_DURATION_MS}ms, finalizing`
              );
              await finalizeScrape(id);
              return;
            }
            poll();
          }, POLL_INTERVAL_MS)
        );
      };
      poll();
    },
    // updateProduct 是 useCallback 稳定，finalizeScrape 在下方
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // rescrape 入口：rescrape 调它，直接走真 crawl 流程
  const scheduleScrape = useCallback(
    (id: string, _baseDelay: number) => {
      void _baseDelay;
      const snapshot = productsRef.current.find((p) => p.id === id);
      const queries = snapshot?.inferredKeywords ?? [];
      if (queries.length === 0) {
        void finalizeScrape(id);
        return;
      }
      void startRealCrawl(id, queries);
    },
    [finalizeScrape, startRealCrawl]
  );

  const schedulePipeline = useCallback(
    (id: string, parseInput: ParseApiInput) => {
      cancelTimers(id);
      timersRef.current.set(id, []);

      const controller = new AbortController();
      controllersRef.current.set(id, controller);

      const applyResult = (result: ParseApiResponse, persist: boolean) => {
        setProducts((prev) =>
          prev.map((product) => {
            if (product.id !== id) return product;
            return {
              ...product,
              status: "ready",
              inferredIndustry: result.industry,
              inferredKeywords: result.keywords,
              updatedAt: nowIso()
            };
          })
        );
        controllersRef.current.delete(id);

        // Fire-and-forget DB persistence. Only persist if it came from the real
        // Minimax parse — fallback values are guessy and we don't want to lock
        // them into the DB (they'd survive next reload).
        if (persist) {
          void persistParseResult(id, result);
        }

        // Sprint A：用 searchQueries（更宽覆盖）优先，没有则回退 keywords。
        const queriesForCrawl =
          result.searchQueries && result.searchQueries.length > 0
            ? result.searchQueries
            : result.keywords;

        // 触发真 crawl-status 轮询（替代假 setTimeout 动画）。300ms 让 UI 渲染 ready 态再进 scraping。
        window.setTimeout(() => {
          if (queriesForCrawl.length === 0) {
            void finalizeScrape(id);
          } else {
            void startRealCrawl(id, queriesForCrawl);
          }
        }, 300);
      };

      parseProductRemote(parseInput, controller.signal)
        .then((result) => {
          applyResult(result, true);
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          if (error instanceof Error && error.name === "AbortError") return;
          // Fallback to local naive inference — keep the pipeline moving.
          console.warn("[my-products] parse API failed, falling back:", error);
          const fallbackIndustry = inferIndustryFromType(
            parseInput.productType as MyProductType
          );
          const fallbackKeywords = deriveKeywordsFromIntro(
            parseInput.name,
            parseInput.intro
          );
          applyResult(
            { industry: fallbackIndustry, keywords: fallbackKeywords },
            false
          );
        });
    },
    [cancelTimers, finalizeScrape, startRealCrawl]
  );

  const createProduct = useCallback(
    async (input: CreateProductInput): Promise<MyProduct> => {
      // POST to DB first to get a real UUID + persisted row.
      const response = await fetch("/api/my-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: input.name.trim(),
          type: input.type,
          intro: input.intro.trim(),
          painPoints: input.painPoints.trim(),
          url: input.url.trim(),
          images: input.images.filter(Boolean),
          useForCloning: input.useForCloning
        })
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
          `POST /api/my-products responded ${response.status}: ${text.slice(0, 160)}`
        );
      }
      const data = (await response.json()) as { product: DbProductRow };
      const row = data.product;

      const next = dbRowToMyProduct(row, {
        status: "parsing",
        progress: [
          { platform: "TikTok", status: "pending", count: 0 },
          { platform: "Meta", status: "pending", count: 0 },
          { platform: "Google", status: "pending", count: 0 }
        ]
      });
      setProducts((prev) => [next, ...prev]);
      schedulePipeline(row.id, {
        name: next.name,
        url: next.url,
        intro: next.intro,
        painPoints: next.painPoints,
        productType: next.type
      });
      return next;
    },
    [schedulePipeline]
  );

  const removeProduct = useCallback(
    (id: string) => {
      cancelTimers(id);
      // Optimistic remove: drop from UI first, hit DB in background.
      setProducts((prev) => prev.filter((product) => product.id !== id));
      void fetch(`/api/my-products/${id}`, { method: "DELETE" }).catch(
        (error) => {
          console.warn("[removeProduct] DELETE failed:", error);
        }
      );
    },
    [cancelTimers]
  );

  const rescrape = useCallback(
    (id: string) => {
      cancelTimers(id);
      updateProduct(id, {
        scrapedAds: [],
        progress: [
          { platform: "TikTok", status: "pending", count: 0 },
          { platform: "Meta", status: "pending", count: 0 },
          { platform: "Google", status: "pending", count: 0 }
        ]
      });
      scheduleScrape(id, 200);
    },
    [cancelTimers, scheduleScrape, updateProduct]
  );

  // 用户对某条广告打 ✓ / ✗ 反馈 —— PATCH /matched-ads + 立刻 optimistic
  // 更新本地 scrapedAd.adData.userFeedback。toggle 行为：再点同样按钮 → null。
  const setAdFeedback = useCallback(
    async (
      productId: string,
      adId: string,
      feedback: "positive" | "negative" | null
    ) => {
      // optimistic UI 更新（先改本地，再发 API；失败回滚）
      setProducts((prev) =>
        prev.map((p) => {
          if (p.id !== productId) return p;
          return {
            ...p,
            scrapedAds: p.scrapedAds.map((s) => {
              if (s.adId !== adId || !s.adData) return s;
              return { ...s, adData: { ...s.adData, userFeedback: feedback } };
            })
          };
        })
      );
      try {
        const response = await fetch(
          `/api/my-products/${productId}/matched-ads`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ adId, userFeedback: feedback })
          }
        );
        if (!response.ok) {
          console.warn("[setAdFeedback] PATCH failed:", response.status);
        }
      } catch (error) {
        console.warn("[setAdFeedback] network error:", error);
      }
    },
    []
  );

  return useMemo(
    () => ({
      products,
      hydrated,
      createProduct,
      removeProduct,
      rescrape,
      setStatus,
      setAdFeedback
    }),
    [products, hydrated, createProduct, removeProduct, rescrape, setStatus, setAdFeedback]
  );
}
