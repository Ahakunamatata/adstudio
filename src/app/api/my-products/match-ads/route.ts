import { NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, inArray, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { embed, EMBEDDING_DIM } from "@/lib/llm/embedding";
import {
  minimaxChatCompletion,
  MinimaxApiError,
  MinimaxConfigError
} from "@/lib/llm/minimax";

// 提取 JSON 数组（extractJsonObject 只识对象不识数组，rerank 必须用数组）
function extractJsonArray<T = unknown>(text: string): T[] | null {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenceMatch ? fenceMatch[1].trim() : trimmed;
  const start = body.indexOf("[");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) {
        try {
          const arr = JSON.parse(body.slice(start, i + 1)) as T[];
          return Array.isArray(arr) ? arr : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// POST /api/my-products/match-ads
//
// 输入：产品的关键词 + 行业 + 可选 source 过滤
// 输出：DB 里相关的 ads，按相关性降序
//
// 检索策略（优先级）：
//   1. 语义检索：keywords + industry 拼成 query 文本 → embed → pgvector cosine
//      ORDER BY。只命中 ad_embeddings 里有向量的 ad
//   2. 降级关键词 ILIKE：当 embed 失败 / ad_embeddings 为空 / 没结果时兜底
//
// 空库 → 返回 { ads: [] }，不报错。前端走空状态 UI。

export const runtime = "nodejs";

const requestSchema = z.object({
  keywords: z.array(z.string().min(1).max(200)).max(20).default([]),
  industry: z.string().max(40).optional(),
  sources: z
    .array(z.enum(["meta", "tiktok", "google", "tiktok_cc"]))
    .max(4)
    .optional(),
  limit: z.number().int().min(1).max(100).default(20),
  // 用户产品介绍 / 痛点，喂给 LLM rerank prompt（向量检索只看 keywords，
  // 加上产品上下文 LLM 能更准判断"这条对你产品到底有没有用"）。
  cleanedIntro: z.string().max(800).optional(),
  cleanedPainPoints: z.string().max(600).optional(),
  productName: z.string().max(120).optional(),
  // LLM rerank 开关：true 时先 vector 拿 top 30，再 LLM 评分 + 写 reason
  // 重排取 top {limit}。false 时纯向量检索（快，~300ms）。默认 true。
  rerank: z.boolean().default(true),
  // 传入 productId 时，把 match 结果持久化到 product_ad_matches 表，
  // 下次刷新直接 GET /api/my-products/[id]/matched-ads 拿缓存（< 100ms），
  // 不用再跑 LLM rerank（~50s + 配额）。
  persistForProductId: z.string().uuid().optional()
});

// LLM rerank 时多取一些候选喂给 LLM 评分。30 是 sweet spot：
// - 太少（10）→ LLM 无法挑出真正的 best
// - 太多（50+）→ Minimax 一次 prompt 太长，输入 token 起飞
const RERANK_CANDIDATE_LIMIT = 30;

const PUBLISHER_TO_PLATFORM: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  audience_network: "Audience Network",
  messenger: "Messenger",
  threads: "Threads"
};

function regionToFlag(region: string | null): string {
  if (!region) return "🌐";
  const flagOffset = 0x1f1e6;
  const asciiOffset = 65;
  const upper = region.toUpperCase();
  if (upper.length !== 2) return "🌐";
  try {
    return String.fromCodePoint(
      flagOffset + upper.charCodeAt(0) - asciiOffset,
      flagOffset + upper.charCodeAt(1) - asciiOffset
    );
  } catch {
    return "🌐";
  }
}

type AdSearchRow = {
  id: string;
  source: "meta" | "tiktok" | "google" | "tiktok_cc";
  advertiserName: string | null;
  adCreativeBodies: string[] | null;
  adCreativeTitles: string[] | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  snapshotUrl: string | null;
  region: string | null;
  publisherPlatforms: string[] | null;
  languages: string[] | null;
  // 富化字段（Meta fetcher 入库就有；TikTok 经过 enrich-runner 后才有）
  landingPageUrl: string | null;
  metrics: Record<string, unknown> | null;
  // 来自 db.select 时是 Date，来自 db.execute 原生 SQL 时是 string，shapeAd 统一处理
  deliveryStartAt: Date | string | null;
  deliveryStopAt: Date | string | null;
  firstSeenAt: Date | string;
  // distance 仅在语义检索时存在
  distance?: number;
};

function toIsoOrNull(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  // string: 假定已是 ISO，但用 new Date() 标准化（容错时区/无 Z 后缀）
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function shapeAd(row: AdSearchRow) {
  const bodies = row.adCreativeBodies ?? [];
  const titles = row.adCreativeTitles ?? [];
  const primaryTitle =
    titles[0]?.trim() ||
    bodies[0]?.split(/[.。?!?！]/)[0]?.trim().slice(0, 80) ||
    row.advertiserName ||
    "(no title)";
  const platforms = (row.publisherPlatforms ?? []).map(
    (p) => PUBLISHER_TO_PLATFORM[p] ?? p
  );

  // cosine distance ∈ [0, 2]，0 完全相同，2 完全相反。
  // score = (1 - distance/2) × 100，clamped to [0, 100]，给前端展示用
  const relevanceScore =
    row.distance !== undefined
      ? Math.round(Math.max(0, Math.min(100, (1 - row.distance / 2) * 100)))
      : null;

  // 富化指标安全提取（metrics jsonb 是 Record<string, unknown>，要 narrow）
  const m = row.metrics ?? {};
  const ctaText =
    typeof (m as Record<string, unknown>).cta_text === "string"
      ? ((m as Record<string, string>).cta_text as string)
      : null;
  const pageLikeRaw = (m as Record<string, unknown>).page_like_count;
  const pageLikeCount = typeof pageLikeRaw === "number" ? pageLikeRaw : null;

  return {
    id: row.id,
    source: row.source,
    title: primaryTitle,
    advertiserName: row.advertiserName,
    creativeBodies: bodies,
    videoUrl: row.videoUrl,
    thumbnailUrl: row.thumbnailUrl,
    snapshotUrl: row.snapshotUrl,
    region: row.region,
    regionFlag: regionToFlag(row.region),
    platforms,
    platformLabel:
      platforms[0] ?? (row.source === "meta" ? "Meta" : row.source),
    languages: row.languages ?? [],
    // 新富化字段
    landingPageUrl: row.landingPageUrl,
    ctaText,
    pageLikeCount,
    deliveryStartAt: toIsoOrNull(row.deliveryStartAt),
    deliveryStopAt: toIsoOrNull(row.deliveryStopAt),
    firstSeenAt: toIsoOrNull(row.firstSeenAt) ?? new Date().toISOString(),
    relevanceScore, // null 表示走的关键词兜底；前端可自己生成 fallback 分数
    // LLM rerank 后这里会被 reason chip 填上（"赢在 hook X，跟你产品 Y 卖点对得上"）
    recommendReason: null as string | null
  };
}

// ──────────────────────── LLM rerank ─────────────────────────
//
// 输入：候选 ads（top 30 by vector）+ 用户产品上下文
// 输出：每条 ad 的 (score, reason)。重排取 top N。
//
// 设计：一次 batch LLM 调用，所有候选一起喂。
//   - input: ~3000-5000 tokens（30 条 ad 摘要 + 产品上下文）
//   - output: ~800-1500 tokens（N 个评分 + 中文 reason）
//   - 耗时：5-12s（M2.7 reasoning）

type RerankCandidate = {
  index: number;
  ad: ReturnType<typeof shapeAd>;
};

type RerankResult = { index: number; score: number; reason: string };

const RERANK_SYSTEM_PROMPT = `你是出海广告投放策略分析师。我会给你：
1. 一个客户产品的画像（产品名 / 介绍 / 痛点 / 关键词）
2. N 条候选爆款广告（每条带广告主 / hook 文案 / 落地页 / CTA / 平台等信息）

你的任务：判断每条候选广告**对这个客户产品**有多有用，从两个维度：
- 相关性（0-100 分）：这条广告的卖点 / 受众 / 场景跟客户产品有多接近？数字越高越对得上
- 推荐理由（**中文**，<35 字）：用一句话讲清楚"赢在哪 + 跟客户产品的哪一点对得上"。
  例："Hook 用'2 周减脂'数字效应强，跟你的减肥承诺正面对线"
  例："CTA 用 Install now + Amazon 落地页，正好是 App 投放范式"

输出**仅** JSON 数组，不要 markdown，不要解释。结构：
[
  {"index": 1, "score": 92, "reason": "..."},
  {"index": 2, "score": 78, "reason": "..."},
  ...
]
- 必须返回所有 N 个候选（不要遗漏）
- score 是整数 0-100
- reason 严格 <35 字中文`;

type RerankProduct = {
  productName?: string;
  industry?: string;
  keywords?: string[];
  cleanedIntro?: string;
  cleanedPainPoints?: string;
};

function buildRerankPrompt(
  product: RerankProduct,
  candidates: RerankCandidate[]
): string {
  const lines: string[] = [];
  lines.push("【客户产品画像】");
  if (product.productName) lines.push(`产品名：${product.productName}`);
  if (product.industry) lines.push(`行业：${product.industry}`);
  if (product.keywords?.length) lines.push(`关键词：${product.keywords.join(", ")}`);
  if (product.cleanedIntro) lines.push(`介绍：${product.cleanedIntro}`);
  if (product.cleanedPainPoints) lines.push(`痛点：${product.cleanedPainPoints}`);
  lines.push("");
  lines.push(`【候选广告（${candidates.length} 条）】`);
  for (const { index, ad } of candidates) {
    const hook = (ad.creativeBodies[0] ?? ad.title ?? "").slice(0, 180);
    const landing = ad.landingPageUrl
      ? (() => {
          try {
            return new URL(ad.landingPageUrl).hostname.replace(/^www\./, "");
          } catch {
            return "";
          }
        })()
      : "";
    lines.push(
      `[${index}] ${ad.advertiserName ?? ad.source} (${ad.source}/${ad.region ?? "?"}, ${
        ad.pageLikeCount ? `${(ad.pageLikeCount / 1000).toFixed(0)}K likes` : "no likes"
      })`
    );
    if (hook) lines.push(`    hook: ${hook}`);
    if (ad.ctaText || landing)
      lines.push(`    CTA: ${ad.ctaText ?? "?"} → ${landing || "?"}`);
  }
  return lines.join("\n");
}

async function llmRerank(
  product: RerankProduct,
  ads: ReturnType<typeof shapeAd>[],
  limit: number
): Promise<{ rerankedAds: ReturnType<typeof shapeAd>[]; usedRerank: boolean }> {
  if (ads.length <= 1) return { rerankedAds: ads.slice(0, limit), usedRerank: false };
  const candidates: RerankCandidate[] = ads.map((ad, i) => ({ index: i + 1, ad }));
  const userPrompt = buildRerankPrompt(product, candidates);

  try {
    const completion = await minimaxChatCompletion({
      messages: [
        { role: "system", content: RERANK_SYSTEM_PROMPT },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.2,
      maxTokens: 4096,
      responseFormat: "json"
    });
    const parsed = extractJsonArray<RerankResult>(completion.content);
    if (!parsed) {
      console.warn(
        "[match-ads/rerank] LLM did not return JSON array, content preview:",
        completion.content.slice(0, 200)
      );
      return { rerankedAds: ads.slice(0, limit), usedRerank: false };
    }
    const byIndex = new Map<number, RerankResult>();
    for (const r of parsed) {
      if (!r || typeof r.index !== "number" || typeof r.score !== "number") continue;
      byIndex.set(r.index, { index: r.index, score: r.score, reason: r.reason ?? "" });
    }
    const merged = candidates.map(({ index, ad }) => {
      const r = byIndex.get(index);
      if (!r) return { ...ad };
      return {
        ...ad,
        // LLM score 覆盖 cosine 距离换算的 score
        relevanceScore: Math.max(0, Math.min(100, Math.round(r.score))),
        recommendReason:
          r.reason && r.reason.trim().length > 0 ? r.reason.trim() : null
      };
    });
    merged.sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0));
    return { rerankedAds: merged.slice(0, limit), usedRerank: true };
  } catch (error) {
    if (error instanceof MinimaxApiError || error instanceof MinimaxConfigError) {
      console.warn(
        `[match-ads/rerank] LLM call failed (${error.constructor.name}):`,
        error.message
      );
    } else {
      console.warn(
        "[match-ads/rerank] unexpected error, falling back:",
        error instanceof Error ? error.message : String(error)
      );
    }
    return { rerankedAds: ads.slice(0, limit), usedRerank: false };
  }
}

function buildQueryText(
  keywords: string[],
  industry: string | undefined
): string {
  const parts: string[] = [];
  if (keywords.length > 0) parts.push(keywords.join(", "));
  if (industry) parts.push(`Industry: ${industry}`);
  return parts.join(". ");
}

// 把 number[] 转成 pgvector 字面量 '[0.1,0.2,...]'
function toVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

// Personalization：拉这个产品下用户的 feedback，用来在检索时过滤 ✗ 的、boost ✓ 的
// 没 product 上下文（persistForProductId 为空）就不走这一路 —— 试用模式或 ad-hoc 检索。
async function loadFeedbackContext(productId: string | undefined): Promise<{
  negativeAdIds: string[];
  positiveAdIds: string[];
  negativeAdvertisers: string[]; // lowercase 已 normalize
  positiveAdvertisers: string[];
}> {
  const empty = {
    negativeAdIds: [] as string[],
    positiveAdIds: [] as string[],
    negativeAdvertisers: [] as string[],
    positiveAdvertisers: [] as string[]
  };
  if (!productId) return empty;
  try {
    const rows = await db.execute<{
      ad_id: string;
      user_feedback: "positive" | "negative";
      advertiser_name: string | null;
    }>(sql`
      SELECT pam.ad_id, pam.user_feedback, ads.advertiser_name
      FROM product_ad_matches pam
      JOIN ads ON ads.id = pam.ad_id
      WHERE pam.product_id = ${productId}
        AND pam.user_feedback IS NOT NULL
    `);
    const negativeAdIds: string[] = [];
    const positiveAdIds: string[] = [];
    const negAdv = new Set<string>();
    const posAdv = new Set<string>();
    for (const r of rows) {
      const adv = (r.advertiser_name ?? "").trim().toLowerCase();
      if (r.user_feedback === "negative") {
        negativeAdIds.push(r.ad_id);
        if (adv) negAdv.add(adv);
      } else if (r.user_feedback === "positive") {
        positiveAdIds.push(r.ad_id);
        if (adv) posAdv.add(adv);
      }
    }
    // 若同一 advertiser 既被 ✓ 又被 ✗，✓ 优先（不过滤）—— 用户更近的正反馈胜出
    for (const a of posAdv) negAdv.delete(a);
    return {
      negativeAdIds,
      positiveAdIds,
      negativeAdvertisers: Array.from(negAdv),
      positiveAdvertisers: Array.from(posAdv)
    };
  } catch (e) {
    console.warn(
      "[match-ads/feedback] load failed (continuing without personalization):",
      e instanceof Error ? e.message : String(e)
    );
    return empty;
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request shape", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const {
    keywords,
    industry,
    sources,
    limit,
    cleanedIntro,
    cleanedPainPoints,
    productName,
    rerank,
    persistForProductId
  } = parsed.data;

  // 把 match 结果持久化到 product_ad_matches。
  // ⚠️ 关键：不能再 DELETE * 然后 INSERT —— 那会清掉 user_feedback。
  // 改成：UPSERT 新结果 → DELETE 没在本次结果里的 row（但保留已标 ✓/✗ 的不删）。
  // 这样用户的反馈永远跟着 (product_id, ad_id) 走，下一次 rerank 仍然能识别。
  async function persistMatches(ads: ReturnType<typeof shapeAd>[]) {
    if (!persistForProductId || ads.length === 0) return;
    try {
      const matchedKeywordsArr = keywords.slice(0, 3);
      const matchedKeywordsLiteral =
        "{" +
        matchedKeywordsArr
          .map((k) => `"${k.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
          .join(",") +
        "}";
      // 1. UPSERT 本轮所有 ad 到 matches —— 已存在的（含 user_feedback）只更新
      //    relevance / reason / surfaced_at，不动 user_feedback
      const newAdIds: string[] = [];
      for (const ad of ads) {
        newAdIds.push(ad.id);
        try {
          await db.execute(sql`
            INSERT INTO product_ad_matches (
              product_id, ad_id, relevance_score, matched_keywords,
              recommend_reason, surfaced_at
            )
            VALUES (
              ${persistForProductId}, ${ad.id}, ${ad.relevanceScore ?? 0},
              ${matchedKeywordsLiteral}::text[],
              ${ad.recommendReason},
              now()
            )
            ON CONFLICT (product_id, ad_id) DO UPDATE SET
              relevance_score = EXCLUDED.relevance_score,
              recommend_reason = EXCLUDED.recommend_reason,
              surfaced_at = EXCLUDED.surfaced_at
              -- 故意不更新 user_feedback / matched_keywords，保留用户互动数据
          `);
        } catch (e) {
          console.warn(
            `[match-ads/persist] failed for ${ad.id}:`,
            e instanceof Error ? e.message : String(e)
          );
        }
      }
      // 2. 删除"上次有这次没"的过期 matches —— 但保留所有用户已标记的（user_feedback IS NOT NULL）
      //    这样用户标过的 ad 即使本轮没召回到也不丢
      try {
        await db.execute(sql`
          DELETE FROM product_ad_matches
          WHERE product_id = ${persistForProductId}
            AND user_feedback IS NULL
            AND ad_id <> ALL(${newAdIds}::uuid[])
        `);
      } catch (e) {
        console.warn(
          "[match-ads/persist] prune stale matches failed:",
          e instanceof Error ? e.message : String(e)
        );
      }
      // 顺手更新 my_products.last_match_run_at 让前端能判断"上次 match 是啥时候"
      await db.execute(sql`
        UPDATE my_products SET last_match_run_at = now() WHERE id = ${persistForProductId}
      `);
    } catch (e) {
      console.warn(
        "[match-ads/persist] outer failure:",
        e instanceof Error ? e.message : String(e)
      );
    }
  }

  const queryText = buildQueryText(
    keywords.map((k) => k.trim()).filter((k) => k.length >= 2),
    industry
  );

  // 加载用户对该产品过往的 ✓/✗ 反馈 —— 用来过滤 / 加权
  const feedback = await loadFeedbackContext(persistForProductId);
  const hasNegativeFilter =
    feedback.negativeAdIds.length > 0 || feedback.negativeAdvertisers.length > 0;
  // SQL fragments：✗ 的 ad_id 直接排除；✗ 的 advertiser 名（lowercase 比较）连带排除。
  // 这两个加在 vector SQL 和 ILIKE fallback 的 WHERE 里。
  const negativeAdIdFilter =
    feedback.negativeAdIds.length > 0
      ? sql`AND ads.id <> ALL(${feedback.negativeAdIds}::uuid[])`
      : sql``;
  const negativeAdvertiserFilter =
    feedback.negativeAdvertisers.length > 0
      ? sql`AND (ads.advertiser_name IS NULL OR lower(ads.advertiser_name) <> ALL(${feedback.negativeAdvertisers}::text[]))`
      : sql``;

  // ── Path 1: 语义检索 ────────────────────────────────────────
  if (queryText.length > 0) {
    const embedResult = await embed([queryText], "query");
    if (embedResult.ok && embedResult.vectors.length > 0) {
      const vector = embedResult.vectors[0];
      if (vector.length === EMBEDDING_DIM) {
        const vectorLiteral = toVectorLiteral(vector);
        const sourceFilter =
          sources && sources.length > 0
            ? sql`AND ads.source = ANY(${sources}::ad_source[])`
            : sql``;

        try {
          const rows = await db.execute<AdSearchRow>(sql`
            SELECT
              ads.id,
              ads.source,
              ads.advertiser_name AS "advertiserName",
              ads.ad_creative_bodies AS "adCreativeBodies",
              ads.ad_creative_titles AS "adCreativeTitles",
              ads.video_url AS "videoUrl",
              ads.thumbnail_url AS "thumbnailUrl",
              ads.snapshot_url AS "snapshotUrl",
              ads.region,
              ads.publisher_platforms AS "publisherPlatforms",
              ads.languages,
              ads.landing_page_url AS "landingPageUrl",
              ads.metrics,
              ads.delivery_start_at AS "deliveryStartAt",
              ads.delivery_stop_at AS "deliveryStopAt",
              ads.first_seen_at AS "firstSeenAt",
              (ad_embeddings.embedding <=> ${vectorLiteral}::vector)::float AS distance
            FROM ads
            JOIN ad_embeddings ON ad_embeddings.ad_id = ads.id
            WHERE ads.status <> 'down'
            ${sourceFilter}
            ${negativeAdIdFilter}
            ${negativeAdvertiserFilter}
            ORDER BY ad_embeddings.embedding <=> ${vectorLiteral}::vector
            LIMIT ${rerank ? RERANK_CANDIDATE_LIMIT : limit}
          `);
          if (rows.length > 0) {
            const shaped = rows.map(shapeAd);
            if (rerank) {
              // LLM 二次精排 + 推荐理由
              const { rerankedAds, usedRerank } = await llmRerank(
                {
                  productName,
                  industry,
                  keywords,
                  cleanedIntro,
                  cleanedPainPoints
                },
                shaped,
                limit
              );
              // 持久化（必须 await，否则 Next.js 函数返回后 promise 被中断）
              // 给用户加 100-300ms 延迟换"下次刷新秒开"的体验，值
              await persistMatches(rerankedAds);
              return NextResponse.json({
                ads: rerankedAds,
                mode: usedRerank ? "semantic+llm-rerank" : "semantic",
                provider: embedResult.provider,
                model: embedResult.model,
                rerankUsed: usedRerank,
                persisted: !!persistForProductId,
                // 个性化过滤统计（透明度，方便前端展示"基于你的 ✗ 已排除 N 条"）
                personalized: hasNegativeFilter
                  ? {
                      excludedAdIds: feedback.negativeAdIds.length,
                      excludedAdvertisers: feedback.negativeAdvertisers.length
                    }
                  : undefined
              });
            }
            const sliced = shaped.slice(0, limit);
            await persistMatches(sliced);
            return NextResponse.json({
              ads: sliced,
              mode: "semantic",
              provider: embedResult.provider,
              model: embedResult.model,
              persisted: !!persistForProductId
            });
          }
        } catch (error) {
          console.warn(
            "[match-ads] semantic search failed, falling through to keyword:",
            error instanceof Error ? error.message : String(error)
          );
        }
      }
    } else if (!embedResult.ok) {
      console.warn(
        "[match-ads] query embed failed, falling through to keyword:",
        embedResult.reason
      );
    }
  }

  // ── Path 2: 关键词 ILIKE 兜底 ──────────────────────────────
  try {
    const keywordClauses = keywords
      .map((k) => k.trim())
      .filter((k) => k.length >= 2)
      .map((k) => {
        const pattern = `%${k}%`;
        return or(
          sql`${schema.ads.advertiserName} ILIKE ${pattern}`,
          sql`array_to_string(${schema.ads.adCreativeBodies}, ' ') ILIKE ${pattern}`,
          sql`array_to_string(${schema.ads.adCreativeTitles}, ' ') ILIKE ${pattern}`
        );
      });

    const conditions = [];
    if (sources && sources.length > 0) {
      conditions.push(inArray(schema.ads.source, sources));
    }
    if (keywordClauses.length > 0) {
      const keywordOr = or(...keywordClauses);
      if (keywordOr) conditions.push(keywordOr);
    }
    conditions.push(sql`${schema.ads.status} <> 'down'`);
    // 同样应用 feedback 过滤（✗ 的 ad / advertiser 排除）
    if (feedback.negativeAdIds.length > 0) {
      conditions.push(sql`${schema.ads.id} <> ALL(${feedback.negativeAdIds}::uuid[])`);
    }
    if (feedback.negativeAdvertisers.length > 0) {
      conditions.push(
        sql`(${schema.ads.advertiserName} IS NULL OR lower(${schema.ads.advertiserName}) <> ALL(${feedback.negativeAdvertisers}::text[]))`
      );
    }

    const rows = await db
      .select({
        id: schema.ads.id,
        source: schema.ads.source,
        advertiserName: schema.ads.advertiserName,
        adCreativeBodies: schema.ads.adCreativeBodies,
        adCreativeTitles: schema.ads.adCreativeTitles,
        videoUrl: schema.ads.videoUrl,
        thumbnailUrl: schema.ads.thumbnailUrl,
        snapshotUrl: schema.ads.snapshotUrl,
        region: schema.ads.region,
        publisherPlatforms: schema.ads.publisherPlatforms,
        languages: schema.ads.languages,
        landingPageUrl: schema.ads.landingPageUrl,
        metrics: schema.ads.metrics,
        deliveryStartAt: schema.ads.deliveryStartAt,
        deliveryStopAt: schema.ads.deliveryStopAt,
        firstSeenAt: schema.ads.firstSeenAt
      })
      .from(schema.ads)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.ads.firstSeenAt))
      .limit(limit);

    return NextResponse.json({
      ads: rows.map((row) => shapeAd(row as AdSearchRow)),
      mode: "keyword"
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "DB query failed", message },
      { status: 500 }
    );
  }
}
