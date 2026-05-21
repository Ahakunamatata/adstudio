import { sql } from "drizzle-orm";
import { db, schema } from "./index";
import type { NewAd } from "./schema";
import type { ScrapedAdRecord } from "@/lib/fetchers/types";

// 通用的 ad upsert helper：source + sourceId 联合定位（写入 ads.id 时拼成
// `${source}-${sourceId}`），首次入库 inserted，再次见到同一条则更新
// last_seen_at + 部分允许变化的字段（creative bodies / status / raw）。
//
// 返回值：true = inserted（首次见到这条），false = updated（已存在，刷字段）。
export async function upsertAd(record: ScrapedAdRecord): Promise<boolean> {
  const id = `${record.source}-${record.sourceId}`;
  const now = new Date();
  return upsertAdRow(
    {
      id,
      source: record.source,
      sourceId: record.sourceId,
      advertiserName: record.advertiserName,
      advertiserPageId: record.advertiserPageId,
      adCreativeBodies:
        record.adCreativeBodies.length > 0 ? record.adCreativeBodies : null,
      adCreativeTitles:
        record.adCreativeTitles.length > 0 ? record.adCreativeTitles : null,
      adCreativeLinkDescriptions:
        record.adCreativeLinkDescriptions.length > 0
          ? record.adCreativeLinkDescriptions
          : null,
      adCreativeLinkCaptions:
        record.adCreativeLinkCaptions.length > 0
          ? record.adCreativeLinkCaptions
          : null,
      videoUrl: record.videoUrl,
      thumbnailUrl: record.thumbnailUrl,
      snapshotUrl: record.snapshotUrl,
      region: record.region,
      publisherPlatforms:
        record.publisherPlatforms.length > 0
          ? record.publisherPlatforms
          : null,
      languages: record.languages.length > 0 ? record.languages : null,
      deliveryStartAt: record.deliveryStartAt,
      deliveryStopAt: record.deliveryStopAt,
      firstSeenAt: now,
      lastSeenAt: now,
      status: "active",
      raw: record.raw as object | null,
      createdAt: now,
      updatedAt: now
    },
    now
  );
}

// 接收一个已经组装好的 NewAd 直接 upsert。MetaFetcher 这种已经按 schema 形态产出
// NewAd 的来源走这条，避免再拷一遍字段。
//
// nowOverride：可选，用来精确控制 firstSeenAt === now 判断（首次插入 vs 更新）。
// 不传则用当前时间。
export async function upsertAdRow(
  row: NewAd,
  nowOverride?: Date
): Promise<boolean> {
  const now = nowOverride ?? new Date();
  // 强制 firstSeenAt / lastSeenAt / updatedAt = now，让首次插入的精确毫秒
  // 跟返回行的 firstSeenAt 一致，用于区分 inserted vs updated
  const valuesToInsert: NewAd = {
    ...row,
    firstSeenAt: now,
    lastSeenAt: now,
    updatedAt: now,
    createdAt: row.createdAt ?? now,
    status: row.status ?? "active"
  };

  const result = await db
    .insert(schema.ads)
    .values(valuesToInsert)
    .onConflictDoUpdate({
      target: schema.ads.id,
      set: {
        advertiserName: sql`EXCLUDED.advertiser_name`,
        advertiserPageId: sql`EXCLUDED.advertiser_page_id`,
        adCreativeBodies: sql`EXCLUDED.ad_creative_bodies`,
        adCreativeTitles: sql`EXCLUDED.ad_creative_titles`,
        adCreativeLinkDescriptions: sql`EXCLUDED.ad_creative_link_descriptions`,
        adCreativeLinkCaptions: sql`EXCLUDED.ad_creative_link_captions`,
        videoUrl: sql`EXCLUDED.video_url`,
        thumbnailUrl: sql`EXCLUDED.thumbnail_url`,
        snapshotUrl: sql`EXCLUDED.snapshot_url`,
        publisherPlatforms: sql`EXCLUDED.publisher_platforms`,
        languages: sql`EXCLUDED.languages`,
        deliveryStopAt: sql`EXCLUDED.delivery_stop_at`,
        lastSeenAt: now,
        status: "active",
        raw: sql`EXCLUDED.raw`,
        // 富化字段：Meta fetcher 入库就已经富化好（含 landing / metrics），
        // 复爬时如果新数据非空就刷（用 COALESCE 让 null 不覆盖已有值）；
        // TikTok 这边 enrich-runner 写，但走自己的 UPDATE 不走 upsert，不影响。
        transcript: sql`COALESCE(EXCLUDED.transcript, ads.transcript)`,
        landingPageUrl: sql`COALESCE(EXCLUDED.landing_page_url, ads.landing_page_url)`,
        metrics: sql`COALESCE(EXCLUDED.metrics, ads.metrics)`,
        enrichedAt: sql`COALESCE(EXCLUDED.enriched_at, ads.enriched_at)`,
        updatedAt: now
      }
    })
    .returning({ firstSeenAt: schema.ads.firstSeenAt });

  const inserted = result[0];
  if (!inserted) return false;
  return inserted.firstSeenAt.getTime() === now.getTime();
}
