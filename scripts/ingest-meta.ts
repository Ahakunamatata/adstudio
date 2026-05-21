/**
 * Pulls a page of ads from the Meta Ad Library API, upserts them into the
 * `ads` table, and computes a Jina embedding for every newly inserted ad.
 *
 * Usage:
 *   ./node_modules/.bin/tsx --env-file=.env.local scripts/ingest-meta.ts \
 *     "<search_terms>" "<COMMA_SEPARATED_ISO2_REGIONS>"
 *
 * Example:
 *   ./node_modules/.bin/tsx --env-file=.env.local scripts/ingest-meta.ts \
 *     "anti-theft alarm" "DE,FR,IT,ES,NL,PL"
 *
 * Notes:
 *   - 如果用户的 Meta App 还没通过 Identity Verification，fetchMetaAds 会返回
 *     `verification_pending`。脚本把它当成"已知阻塞"，打印友好提示后正常退出（exit 0），
 *     不抛 stack trace。
 *   - Inserts are idempotent (upsertAdRow uses ON CONFLICT). 已经在库的广告
 *     会被更新（lastSeenAt + 部分字段刷新），不会再次计算 embedding（节省 Jina 调用）。
 *   - Embedding text 跟 scripts/embed-backfill.ts 保持一致，确保不同来源
 *     入库后能直接被现有的语义检索 cosine 召回。
 */

import { sql } from "drizzle-orm";
import { db, schema } from "../src/lib/db";
import { upsertAdRow } from "../src/lib/db/upsertAd";
import { fetchMetaAds } from "../src/lib/fetchers/metaFetcher";
import { embed } from "../src/lib/llm/embedding";
import type { NewAd } from "../src/lib/db/schema";

function parseArgs(): { searchTerms: string; countries: string[] } {
  const [searchTerms, regionsArg] = process.argv.slice(2);
  if (!searchTerms || !regionsArg) {
    console.error(
      'Usage: tsx --env-file=.env.local scripts/ingest-meta.ts "<search_terms>" "<COUNTRY_CODES>"'
    );
    console.error(
      '  e.g. tsx scripts/ingest-meta.ts "anti-theft alarm" "DE,FR,IT,ES,NL,PL"'
    );
    process.exit(1);
  }
  const countries = regionsArg
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter((c) => /^[A-Z]{2}$/.test(c));
  if (countries.length === 0) {
    console.error(
      `No valid ISO-3166 alpha-2 country codes parsed from "${regionsArg}".`
    );
    process.exit(1);
  }
  return { searchTerms, countries };
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
  if (
    ad.adCreativeLinkDescriptions &&
    ad.adCreativeLinkDescriptions.length > 0
  ) {
    parts.push(
      `LinkDescriptions: ${ad.adCreativeLinkDescriptions.join(" / ")}`
    );
  }
  if (ad.adCreativeLinkCaptions && ad.adCreativeLinkCaptions.length > 0) {
    parts.push(`LinkCaptions: ${ad.adCreativeLinkCaptions.join(" / ")}`);
  }
  if (ad.region) parts.push(`Region: ${ad.region}`);
  if (ad.languages && ad.languages.length > 0) {
    parts.push(`Languages: ${ad.languages.join(",")}`);
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
    console.warn(
      `  [embed] skipped (${result.provider}): ${result.reason}`
    );
    return { embedded: 0, skipped: newAds.length };
  }
  const rows = newAds.map((ad, idx) => ({
    adId: ad.id,
    model: result.model,
    embedding: result.vectors[idx],
    embeddedAt: new Date()
  }));
  try {
    // 这条脚本只对"本次新插入"的 ad 做 embedding，理论上不会冲突。
    // 加 onConflictDoNothing 给重跑 / race 兜底。
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
  const { searchTerms, countries } = parseArgs();
  console.log(`▶ search_terms : "${searchTerms}"`);
  console.log(`▶ countries    : ${countries.join(", ")}`);
  console.log(`▶ fetching Meta Ad Library...`);

  const result = await fetchMetaAds({
    searchTerms,
    countries,
    adActiveStatus: "ALL",
    adType: "ALL",
    limit: 50
  });

  if (!result.ok) {
    if (result.error === "verification_pending") {
      console.log("");
      console.log(
        "⏳ Meta API: Identity / Page verification still pending."
      );
      console.log(`   Meta said: ${result.message}`);
      console.log(
        "   This is expected until the user finishes the FB Business / Identity Verification flow."
      );
      console.log(
        "   Once verification clears, re-run this exact command — code is ready."
      );
      // 友好退出，不让 CI 红
      process.exit(0);
    }
    if (result.error === "rate_limited") {
      console.error(`⛔ Meta API rate limited: ${result.message}`);
      process.exit(2);
    }
    if (result.error === "auth") {
      console.error(`⛔ Meta API auth error: ${result.message}`);
      process.exit(3);
    }
    if (result.error === "network") {
      console.error(`⛔ Network error: ${result.message}`);
      process.exit(4);
    }
    console.error(
      `⛔ Meta API error (${result.error}): ${result.message}${result.statusCode ? ` [HTTP ${result.statusCode}]` : ""}`
    );
    process.exit(5);
  }

  console.log(`✓ fetched ${result.pageCount} ad(s) from Meta API`);

  if (result.ads.length === 0) {
    console.log(
      "No ads matched. Try different keywords or widen the country list."
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

  // Embed only the freshly inserted ones — re-embedding an existing ad would
  // waste Jina tokens and overwrite a possibly-different model's vector.
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

  // Final sanity row count via raw SQL
  const totalRows = await db.execute<{ count: string }>(
    sql`SELECT count(*)::text AS count FROM ads WHERE source = 'meta'`
  );
  const totalMetaAds = totalRows[0]?.count ?? "?";

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
  console.log(`  total meta ads    : ${totalMetaAds}`);
  console.log("───────────────────────────────────");

  if (failed > 0) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ ingest-meta crashed:", error);
    process.exit(1);
  });
