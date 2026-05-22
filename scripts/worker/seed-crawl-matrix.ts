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

// 全局监控关键词矩阵：跨 10+ 出海主流品类的 30 个高频品类词。
// 不要太具体（"PhoneGuard X3" 不行），要可被千百个广告主复用的概念词。
const SEED_KEYWORDS = [
  // —— 美容 / 护肤 / 美妆（出海大类）——
  "skincare routine",
  "anti aging",
  "hair growth",
  "korean skincare",
  "makeup tutorial",
  // —— 健身 / 减肥 / 健康 ——
  "fitness app",
  "weight loss",
  "meal kit",
  "supplement",
  "sleep tracker",
  // —— 服饰 / 鞋包 ——
  "shapewear",
  "athleisure",
  // —— 家居 / 厨房 / 清洁 ——
  "kitchen gadget",
  "cleaning hack",
  "smart home",
  "home organizer",
  // —— 数码 / 电子 ——
  "phone accessories",
  "wireless earbuds",
  "power bank",
  // —— 户外 / 露营 / 运动 ——
  "camping gear",
  "hiking gear",
  // —— App / SaaS / AI 工具 ——
  "ai writer",
  "photo editor",
  "video editor",
  "language learning",
  // —— 亲子 / 教育 ——
  "kids learning",
  // —— 安防 / 防盗（Meta 列敏感词，仅 TikTok）——
  "anti theft",
  "security camera",
  "smart lock",
  // —— 宠物 / 食品 ——
  "pet supplies",
  "dog toys",
  "coffee subscription"
];

// 出海主战场（按客户分布）：
// US/GB/DE 已有，新加 JP（日本好货）/ IN（东南亚低价）/ BR（南美增长大盘）
const SEED_REGIONS = ["US", "GB", "DE", "JP", "IN", "BR"];
// Meta 不走 Graph API（App 没 Identity Verification），改走 Web 抓 Ad Library
// 公开页面（metaAdLibraryFetcher.ts）。
//
// 2026-05-22 Google 暂时移除：dump 验证 adstransparency.google.com 没有原生
// keyword search（?q= 参数 SPA 不读 → 始终首页），XHR 只返回 ad ID list 没有
// advertiser_name / creative_body。要做 keyword search 得自建（按 ID 调 detail
// RPC × 3758 个，太贵），优先级排到 Meta / TikTok 后面。crawl_matrix.enabled=0
// 把已有 google 规则停掉。
const SEED_SOURCES: Array<"tiktok" | "meta" | "google"> = ["tiktok", "meta"];

// Meta 对部分关键词标"敏感"（武器 / 防盗 / 监控）→ captcha 高发，
// 这些只让 TikTok 跑，不投 Meta（避免浪费 worker 周期）。
const META_SENSITIVE_KEYWORDS = new Set([
  "anti theft",
  "security camera",
  "smart lock"
]);

async function main() {
  let inserted = 0;
  let skipped = 0;
  let skippedSensitive = 0;
  for (const source of SEED_SOURCES) {
    for (const keyword of SEED_KEYWORDS) {
      // 敏感词只投 TikTok，跳 Meta（Meta 会 captcha 浪费 worker）
      if (source === "meta" && META_SENSITIVE_KEYWORDS.has(keyword)) {
        skippedSensitive += SEED_REGIONS.length;
        continue;
      }
      for (const region of SEED_REGIONS) {
        try {
          const result = await db.execute<{ id: string }>(sql`
            INSERT INTO crawl_matrix (
              source, keyword, region, cadence_hours, priority, enabled,
              next_run_at, notes
            )
            SELECT ${source}, ${keyword}, ${region}, 24, 0, 1, now(),
              ${"seed-2026-05-v2"}
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
  console.log(
    `crawl_matrix seed done: inserted=${inserted}, skipped(dup)=${skipped}, skipped(sensitive on meta)=${skippedSensitive}`
  );
  // 总规模（移除 google 之后）：30 keyword × 6 region × 2 source - 18 (meta 敏感) = 342 规则
  // 历史 google 行（192 条）通过 enabled=0 单独停掉，不在这里重建
  process.exit(0);
}

main().catch((e) => {
  console.error("seed crashed:", e);
  process.exit(1);
});
