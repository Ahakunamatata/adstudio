/**
 * Scrapes a page of TikTok Creative Center Top Ads via Playwright, upserts each
 * ad into the `ads` table, and computes a Jina embedding for every newly
 * inserted ad.
 *
 * Usage:
 *   ./node_modules/.bin/tsx --env-file=.env.local scripts/ingest-tiktok.ts \
 *     "<keyword>" "<REGION_ISO2>" [time_window]
 *
 * Example:
 *   ./node_modules/.bin/tsx --env-file=.env.local scripts/ingest-tiktok.ts \
 *     "anti-theft" "US" "30d"
 *
 * Notes:
 *   - 没有住宅代理 (`TIKTOK_PROXY_URL` 未设置) 的本地跑大概率撞 anti_bot / captcha。
 *     脚本把这种情况当成"已知阻塞"，打印友好提示后正常退出（exit 0），不抛
 *     stack trace。
 *   - Inserts are idempotent (upsertAdRow uses ON CONFLICT). 已经在库的广告
 *     会被更新（lastSeenAt + 部分字段刷新），不会再次计算 embedding。
 *   - Embedding text 跟 scripts/embed-backfill.ts / scripts/ingest-meta.ts
 *     保持一致，确保跨来源入库后能直接被现有的语义检索 cosine 召回。
 *
 * Exit codes (对齐 scripts/ingest-meta.ts):
 *   0 — success / verification_pending equivalents (anti_bot, captcha — 本机已知现象)
 *   1 — upsert had any failed rows / unexpected crash
 *   2 — rate_limited
 *   3 — auth (TikTok 暂时没有这个分支，留位)
 *   4 — network
 *   5 — other (parse_error / unknown)
 */

import { sql } from "drizzle-orm";
import { db, schema } from "../src/lib/db";
import { upsertAdRow } from "../src/lib/db/upsertAd";
import {
  fetchTiktokAds,
  type TiktokTimeWindow
} from "../src/lib/fetchers/tiktokFetcher";
import { embed } from "../src/lib/llm/embedding";
import type { NewAd } from "../src/lib/db/schema";

function parseArgs(): {
  keyword: string;
  region: string;
  timeWindow: TiktokTimeWindow;
} {
  const [keyword, regionArg, windowArg] = process.argv.slice(2);
  if (!keyword || !regionArg) {
    console.error(
      'Usage: tsx --env-file=.env.local scripts/ingest-tiktok.ts "<keyword>" "<REGION_ISO2>" [time_window]'
    );
    console.error('  e.g. tsx scripts/ingest-tiktok.ts "anti-theft" "US" "30d"');
    process.exit(1);
  }
  const region = regionArg.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(region)) {
    console.error(`Region must be ISO-3166 alpha-2, got "${regionArg}"`);
    process.exit(1);
  }
  const validWindows: TiktokTimeWindow[] = ["7d", "30d", "90d", "180d"];
  const timeWindow: TiktokTimeWindow =
    windowArg && (validWindows as string[]).includes(windowArg.trim())
      ? (windowArg.trim() as TiktokTimeWindow)
      : "30d";
  return { keyword, region, timeWindow };
}

function buildEmbeddingText(ad: NewAd): string {
  const parts: string[] = [];
  if (ad.advertiserName) parts.push(`Brand: ${ad.advertiserName}`);
  if (ad.adCreativeBodies && ad.adCreativeBodies.length > 0) {
    parts.push(`Creative: ${ad.adCreativeBodies.join(" ¶ ")}`);
  }
  if (ad.adCreativeTitles && ad.adCreativeTitles.length > 0) {
    parts.push(`Titles: ${ad.adCreativeTitles.join(" / ")}`);
  }
  if (ad.region) parts.push(`Region: ${ad.region}`);
  if (ad.publisherPlatforms && ad.publisherPlatforms.length > 0) {
    parts.push(`Platforms: ${ad.publisherPlatforms.join(",")}`);
  }
  return parts.join("\n");
}

async function embedNewAds(newAds: NewAd[]): Promise<{
  embedded: number;
  skipped: number;
}> {
  if (newAds.length === 0) return { embedded: 0, skipped: 0 };
  const texts = newAds.map(buildEmbeddingText);
  const result = await embed(texts, "db");
  if (!result.ok) {
    console.warn(`  [embed] skipped (${result.provider}): ${result.reason}`);
    return { embedded: 0, skipped: newAds.length };
  }
  const rows = newAds.map((ad, idx) => ({
    adId: ad.id,
    model: result.model,
    embedding: result.vectors[idx],
    embeddedAt: new Date()
  }));
  try {
    await db
      .insert(schema.adEmbeddings)
      .values(rows)
      .onConflictDoNothing({ target: schema.adEmbeddings.adId });
    return { embedded: rows.length, skipped: 0 };
  } catch (error) {
    console.warn(
      `  [embed] insert failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return { embedded: 0, skipped: newAds.length };
  }
}

async function main() {
  const { keyword, region, timeWindow } = parseArgs();
  console.log(`▶ keyword       : "${keyword}"`);
  console.log(`▶ region        : ${region}`);
  console.log(`▶ time window   : ${timeWindow}`);
  console.log(
    `▶ proxy         : ${process.env.TIKTOK_PROXY_URL ? "configured" : "(none — anti_bot likely)"}`
  );
  console.log(`▶ scraping TikTok Creative Center Top Ads...`);

  const result = await fetchTiktokAds({
    keywords: keyword ? [keyword] : undefined,
    region,
    timeWindow,
    limit: 30
  });

  if (!result.ok) {
    if (result.error === "anti_bot" || result.error === "captcha") {
      console.log("");
      console.log(
        `⏳ TikTok blocked the request (${result.error}): ${result.message}`
      );
      console.log(
        "   This is expected on a local machine without a residential proxy."
      );
      console.log(
        "   Set TIKTOK_PROXY_URL=http://user:pass@host:port (e.g. IPRoyal) and re-run on a server with non-CN egress IP."
      );
      // 友好退出（对齐 ingest-meta.ts 对 verification_pending 的处理）
      process.exit(0);
    }
    if (result.error === "rate_limited") {
      console.error(`⛔ TikTok rate limited: ${result.message}`);
      process.exit(2);
    }
    if (result.error === "network") {
      console.error(`⛔ Network error: ${result.message}`);
      process.exit(4);
    }
    if (result.error === "parse_error") {
      console.error(`⛔ Parse error: ${result.message}`);
      process.exit(5);
    }
    console.error(
      `⛔ TikTok scrape error (${result.error}): ${result.message}${result.statusCode ? ` [HTTP ${result.statusCode}]` : ""}`
    );
    process.exit(5);
  }

  console.log(`✓ scraped ${result.pageCount} ad(s) from TikTok Creative Center`);

  if (result.ads.length === 0) {
    console.log(
      "No ads matched. Try a different keyword, region, or industry filter."
    );
    return;
  }

  let inserted = 0;
  let updated = 0;
  let failed = 0;
  const freshlyInserted: NewAd[] = [];

  for (const ad of result.ads) {
    try {
      const wasInserted = await upsertAdRow(ad);
      if (wasInserted) {
        inserted += 1;
        freshlyInserted.push(ad);
        console.log(`  + ${ad.id} (${ad.advertiserName ?? "?"})`);
      } else {
        updated += 1;
        console.log(`  ↻ ${ad.id} (${ad.advertiserName ?? "?"})`);
      }
    } catch (error) {
      failed += 1;
      console.warn(
        `  ✗ ${ad.id}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  let embeddingsAdded = 0;
  let embeddingsSkipped = 0;
  if (freshlyInserted.length > 0) {
    console.log(
      `▶ computing embeddings for ${freshlyInserted.length} new ad(s)...`
    );
    const r = await embedNewAds(freshlyInserted);
    embeddingsAdded = r.embedded;
    embeddingsSkipped = r.skipped;
  }

  const totalRows = await db.execute<{ count: string }>(
    sql`SELECT count(*)::text AS count FROM ads WHERE source = 'tiktok'`
  );
  const totalTiktokAds = totalRows[0]?.count ?? "?";

  console.log("");
  console.log("───────────── summary ─────────────");
  console.log(`  fetched           : ${result.pageCount}`);
  console.log(`  inserted (new)    : ${inserted}`);
  console.log(`  updated (existing): ${updated}`);
  console.log(`  upsert failed     : ${failed}`);
  console.log(`  embeddings added  : ${embeddingsAdded}`);
  if (embeddingsSkipped > 0) {
    console.log(`  embeddings skipped: ${embeddingsSkipped}`);
  }
  console.log(`  total tiktok ads  : ${totalTiktokAds}`);
  console.log("───────────────────────────────────");

  if (failed > 0) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ ingest-tiktok crashed:", error);
    process.exit(1);
  });
