/**
 * S1-3 smoke test for the Drizzle client + schema.
 *
 * 跑法（在项目根）:
 *   ./node_modules/.bin/tsx --env-file=.env.local scripts/db-smoke.ts
 *
 * 它会:
 *   1. 插入一条假的 meta 广告
 *   2. 插入对应的 embedding (1024 维全 0.1 的占位向量)
 *   3. 用 pgvector cosine 距离查回来
 *   4. 删干净
 *
 * 失败会非零退出。成功打印 "✅ smoke pass"。
 * 任何时候都可以 rerun，幂等。
 */

import { sql } from "drizzle-orm";
import { db, schema } from "../src/lib/db";

const SMOKE_AD_ID = "meta-smoke-test-9999999";

async function cleanup() {
  await db.delete(schema.adEmbeddings).where(sql`ad_id = ${SMOKE_AD_ID}`);
  await db.delete(schema.ads).where(sql`id = ${SMOKE_AD_ID}`);
}

async function main() {
  // start clean (in case a previous run died mid-way)
  await cleanup();

  // 1. insert ad
  const inserted = await db
    .insert(schema.ads)
    .values({
      id: SMOKE_AD_ID,
      source: "meta",
      sourceId: "smoke-test-9999999",
      advertiserName: "Smoke Test Advertiser",
      adCreativeBodies: ["A sample ad body for smoke testing."],
      region: "DE",
      publisherPlatforms: ["facebook", "instagram"],
      languages: ["en"]
    })
    .returning({ id: schema.ads.id });
  if (inserted.length !== 1) throw new Error("insert ad failed");
  console.log("✓ inserted ad", inserted[0].id);

  // 2. insert embedding (1024-dim, all 0.1)
  const fakeEmbedding = Array.from({ length: 1024 }, () => 0.1);
  await db.insert(schema.adEmbeddings).values({
    adId: SMOKE_AD_ID,
    model: "smoke-test-fake",
    embedding: fakeEmbedding
  });
  console.log("✓ inserted embedding (1024 dim)");

  // 3. query back with cosine distance against a target vector
  const targetVector = Array.from({ length: 1024 }, () => 0.1);
  const targetVectorLiteral = `[${targetVector.join(",")}]`;
  const result = await db.execute<{ ad_id: string; distance: number }>(
    sql`
      SELECT
        ad_id,
        embedding <=> ${targetVectorLiteral}::vector AS distance
      FROM ad_embeddings
      WHERE ad_id = ${SMOKE_AD_ID}
    `
  );
  // postgres-js returns rows on the result directly (it's iterable)
  const row = result[0];
  if (!row) throw new Error("query returned no row");
  console.log(
    `✓ cosine distance to identical vector = ${Number(row.distance).toFixed(6)} (expected ≈ 0)`
  );

  // 4. cleanup
  await cleanup();
  console.log("✓ cleaned up");

  console.log("\n✅ smoke pass");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ smoke fail:", error);
    process.exit(1);
  });
