import { NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, inArray, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { embed, EMBEDDING_DIM } from "@/lib/llm/embedding";

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
    .array(z.enum(["meta", "tiktok", "google"]))
    .max(3)
    .optional(),
  limit: z.number().int().min(1).max(100).default(20)
});

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
  source: "meta" | "tiktok" | "google";
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
    relevanceScore // null 表示走的关键词兜底；前端可自己生成 fallback 分数
  };
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
  const { keywords, industry, sources, limit } = parsed.data;

  const queryText = buildQueryText(
    keywords.map((k) => k.trim()).filter((k) => k.length >= 2),
    industry
  );

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
            ORDER BY ad_embeddings.embedding <=> ${vectorLiteral}::vector
            LIMIT ${limit}
          `);
          if (rows.length > 0) {
            return NextResponse.json({
              ads: rows.map(shapeAd),
              mode: "semantic",
              provider: embedResult.provider,
              model: embedResult.model
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
