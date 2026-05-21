/**
 * 给 ads 表里所有还没 embedding 的广告补算 embedding 入 ad_embeddings 表。
 *
 * 跑法：
 *   ./node_modules/.bin/tsx --env-file=.env.local scripts/embed-backfill.ts
 *
 * 幂等：每次只处理 LEFT JOIN ad_embeddings 后 embedded_at IS NULL 的行；
 * 已经嵌入过的不重复处理（除非强制 --force，下方未实现）。
 *
 * 一条广告的 "embedding 文本" = advertiserName + creativeBodies + Titles
 *   + linkDescriptions + linkCaptions，全部拼一起。后续 schema 加 transcript /
 *   OCR 后这里也要更新。
 *
 * Provider 由 .env.local 的 EMBED_PROVIDER 决定，默认 jina。
 *
 * 批处理：每次提交 8 条上 Jina（每批一个 API 调用，省 round-trip 时间）。
 * Jina v3 free tier 10M tokens/mo，14 条 seed 大概只用 600-1200 tokens。
 */

import { eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "../src/lib/db";
import { embed, describeProvider } from "../src/lib/llm/embedding";

const BATCH_SIZE = 8;

type AdRow = typeof schema.ads.$inferSelect;

function buildEmbeddingText(ad: AdRow): string {
  const parts: string[] = [];
  if (ad.advertiserName) parts.push(`Brand: ${ad.advertiserName}`);
  if (ad.adCreativeBodies?.length) {
    parts.push(`Creative: ${ad.adCreativeBodies.join(" ¶ ")}`);
  }
  if (ad.adCreativeTitles?.length) {
    parts.push(`Titles: ${ad.adCreativeTitles.join(" / ")}`);
  }
  if (ad.adCreativeLinkDescriptions?.length) {
    parts.push(
      `LinkDescriptions: ${ad.adCreativeLinkDescriptions.join(" / ")}`
    );
  }
  if (ad.adCreativeLinkCaptions?.length) {
    parts.push(`LinkCaptions: ${ad.adCreativeLinkCaptions.join(" / ")}`);
  }
  if (ad.region) parts.push(`Region: ${ad.region}`);
  if (ad.languages?.length) parts.push(`Languages: ${ad.languages.join(",")}`);
  return parts.join("\n");
}

async function main() {
  const provider = describeProvider();
  console.log(`Embedding provider: ${provider}`);

  // 找出所有还没 embedding 的 ad
  const pendingAds = await db
    .select({
      id: schema.ads.id,
      source: schema.ads.source,
      sourceId: schema.ads.sourceId,
      advertiserName: schema.ads.advertiserName,
      advertiserPageId: schema.ads.advertiserPageId,
      adCreativeBodies: schema.ads.adCreativeBodies,
      adCreativeTitles: schema.ads.adCreativeTitles,
      adCreativeLinkDescriptions: schema.ads.adCreativeLinkDescriptions,
      adCreativeLinkCaptions: schema.ads.adCreativeLinkCaptions,
      videoUrl: schema.ads.videoUrl,
      thumbnailUrl: schema.ads.thumbnailUrl,
      snapshotUrl: schema.ads.snapshotUrl,
      region: schema.ads.region,
      publisherPlatforms: schema.ads.publisherPlatforms,
      languages: schema.ads.languages,
      deliveryStartAt: schema.ads.deliveryStartAt,
      deliveryStopAt: schema.ads.deliveryStopAt,
      firstSeenAt: schema.ads.firstSeenAt,
      lastSeenAt: schema.ads.lastSeenAt,
      status: schema.ads.status,
      raw: schema.ads.raw,
      createdAt: schema.ads.createdAt,
      updatedAt: schema.ads.updatedAt
    })
    .from(schema.ads)
    .leftJoin(
      schema.adEmbeddings,
      eq(schema.adEmbeddings.adId, schema.ads.id)
    )
    .where(isNull(schema.adEmbeddings.adId));

  console.log(`Found ${pendingAds.length} ads without embedding.`);
  if (pendingAds.length === 0) {
    console.log("✅ nothing to do.");
    return;
  }

  let processed = 0;
  let failed = 0;

  for (let i = 0; i < pendingAds.length; i += BATCH_SIZE) {
    const batch = pendingAds.slice(i, i + BATCH_SIZE);
    const texts = batch.map((ad) => buildEmbeddingText(ad as AdRow));

    process.stdout.write(
      `[${i + 1}-${Math.min(i + BATCH_SIZE, pendingAds.length)}/${pendingAds.length}] embedding... `
    );

    const result = await embed(texts, "db");
    if (!result.ok) {
      console.log(`❌ ${result.reason}`);
      failed += batch.length;
      continue;
    }

    const rows = batch.map((ad, idx) => ({
      adId: ad.id,
      model: result.model,
      embedding: result.vectors[idx],
      embeddedAt: new Date()
    }));

    try {
      await db.insert(schema.adEmbeddings).values(rows);
      console.log(`✓ inserted ${rows.length}`);
      processed += rows.length;
    } catch (error) {
      console.log(
        `❌ insert failed: ${error instanceof Error ? error.message : String(error)}`
      );
      failed += rows.length;
    }
  }

  console.log(`\n📊 Result: ${processed} embedded, ${failed} failed.`);

  // sanity check: print row count via raw SQL
  const total = await db.execute<{ count: string }>(
    sql`SELECT count(*)::text AS count FROM ad_embeddings`
  );
  console.log(`Total rows in ad_embeddings: ${total[0]?.count}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ backfill crashed:", error);
    process.exit(1);
  });
