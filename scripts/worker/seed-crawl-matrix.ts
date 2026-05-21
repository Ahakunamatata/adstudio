/**
 * 一次性脚本：往 crawl_matrix 里塞一批"全局监控"规则（product_id = NULL）。
 *
 * 跑法：
 *   tsx --env-file=.env.local scripts/worker/seed-crawl-matrix.ts
 *
 * 选词逻辑：手工挑了一些跨品类、出海广告主常关心的高频品类词。
 * 每个 keyword × 每个 region × 每个 source 都成一行规则，cadence 24h（每天重抓一次）。
 *
 * 重复运行安全：用 ON CONFLICT DO NOTHING（基于 idempotency key）跳过已有行。
 * 不依赖 unique constraint —— 用 NOT EXISTS 检测即可，避免新加约束的迁移负担。
 */

import { sql } from "drizzle-orm";
import { db } from "../../src/lib/db";

const SEED_KEYWORDS = [
  // 安防/家居
  "anti theft",
  "smart lock",
  "security camera",
  // 美容
  "skincare routine",
  "hair growth",
  // 健身/健康
  "fitness app",
  "weight loss",
  // 电商杂货
  "kitchen gadget",
  "cleaning hack",
  // 数码
  "phone accessories",
  // 服饰
  "shapewear",
  // App / SaaS
  "ai writer",
  // 户外
  "camping gear",
  // 玩具/亲子
  "kids learning"
];

const SEED_REGIONS = ["US", "GB", "DE"];
// Meta 不走 Graph API（App 没 Identity Verification），改走 Web 抓 Ad Library
// 公开页面（metaAdLibraryFetcher.ts）。Google 留 Sprint C。
const SEED_SOURCES: Array<"tiktok" | "meta" | "google"> = ["tiktok", "meta"];

async function main() {
  let inserted = 0;
  let skipped = 0;
  for (const source of SEED_SOURCES) {
    for (const keyword of SEED_KEYWORDS) {
      for (const region of SEED_REGIONS) {
        try {
          const result = await db.execute<{ id: string }>(sql`
            INSERT INTO crawl_matrix (
              source, keyword, region, cadence_hours, priority, enabled,
              next_run_at, notes
            )
            SELECT ${source}, ${keyword}, ${region}, 24, 0, 1, now(),
              ${"seed-2026-05"}
            WHERE NOT EXISTS (
              SELECT 1 FROM crawl_matrix
              WHERE product_id IS NULL
                AND source = ${source}
                AND keyword = ${keyword}
                AND region = ${region}
            )
            RETURNING id
          `);
          if (result.length > 0) inserted += 1;
          else skipped += 1;
        } catch (e) {
          console.warn(
            `  seed ${source}/${keyword}/${region} failed:`,
            e instanceof Error ? e.message : String(e)
          );
        }
      }
    }
  }
  console.log(`crawl_matrix seed done: inserted=${inserted}, skipped(dup)=${skipped}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("seed crashed:", e);
  process.exit(1);
});
