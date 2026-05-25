import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

// GET /api/my-products/[id]/matched-ads
//
// 从 product_ad_matches 拿持久化的匹配结果（match-ads 调过一次就缓存了）。
// JOIN ads 拿广告完整字段一起返回，前端拿到就能直接 render，不用再跑 LLM rerank。
//
// 字段输出跟 /api/my-products/match-ads 的 shapeAd 一致，前端两边走同一条
// 路径（dbAdToScraped）。

export const runtime = "nodejs";

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

function toIsoOrNull(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

type MatchedRow = {
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
  landingPageUrl: string | null;
  metrics: Record<string, unknown> | null;
  deliveryStartAt: Date | string | null;
  deliveryStopAt: Date | string | null;
  firstSeenAt: Date | string;
  relevanceScore: number;
  matchedKeywords: string[] | null;
  recommendReason: string | null;
  userFeedback: "positive" | "negative" | null;
  surfacedAt: Date | string;
};

function shapeRow(row: MatchedRow) {
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
      platforms[0] ??
      (row.source === "meta"
        ? "Meta"
        : row.source === "tiktok" || row.source === "tiktok_cc"
          ? "TikTok"
          : row.source === "google"
            ? "Google"
            : row.source),
    languages: row.languages ?? [],
    landingPageUrl: row.landingPageUrl,
    ctaText,
    pageLikeCount,
    deliveryStartAt: toIsoOrNull(row.deliveryStartAt),
    deliveryStopAt: toIsoOrNull(row.deliveryStopAt),
    firstSeenAt: toIsoOrNull(row.firstSeenAt) ?? new Date().toISOString(),
    relevanceScore: row.relevanceScore,
    recommendReason: row.recommendReason,
    userFeedback: row.userFeedback,
    matchedKeywords: row.matchedKeywords ?? []
  };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid product id" }, { status: 400 });
  }

  try {
    const rows = await db.execute<MatchedRow>(sql`
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
        m.relevance_score AS "relevanceScore",
        m.matched_keywords AS "matchedKeywords",
        m.recommend_reason AS "recommendReason",
        m.user_feedback AS "userFeedback",
        m.surfaced_at AS "surfacedAt"
      FROM product_ad_matches m
      JOIN ads ON ads.id = m.ad_id
      WHERE m.product_id = ${id}
      ORDER BY m.relevance_score DESC NULLS LAST, m.surfaced_at DESC
    `);

    if (rows.length === 0) {
      return NextResponse.json({ ads: [], cached: false });
    }

    return NextResponse.json({
      ads: rows.map(shapeRow),
      cached: true,
      // 第一条的 surfacedAt 等于 my_products.last_match_run_at（同一时间写）
      lastMatchRunAt: toIsoOrNull(rows[0].surfacedAt)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to fetch matches", message },
      { status: 500 }
    );
  }
}

// PATCH /api/my-products/[id]/matched-ads
//
// 写用户对某条 ad 的 ✓/✗ 反馈（用于训练 personalized rerank）。
// Body: { adId: string, userFeedback: 'positive' | 'negative' | null }

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid product id" }, { status: 400 });
  }
  let body: { adId?: string; userFeedback?: "positive" | "negative" | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.adId || typeof body.adId !== "string") {
    return NextResponse.json({ error: "adId required" }, { status: 400 });
  }
  if (
    body.userFeedback !== null &&
    body.userFeedback !== "positive" &&
    body.userFeedback !== "negative"
  ) {
    return NextResponse.json(
      { error: "userFeedback must be positive / negative / null" },
      { status: 400 }
    );
  }
  try {
    await db.execute(sql`
      UPDATE product_ad_matches
      SET user_feedback = ${body.userFeedback}
      WHERE product_id = ${id} AND ad_id = ${body.adId}
    `);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to update feedback",
        message: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
