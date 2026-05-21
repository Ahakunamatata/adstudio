/**
 * 一次性脚本：把数据库里"有 ad，没 embedding"的行批量推到 embed_queue。
 *
 * 跑法：
 *   tsx --env-file=.env.local scripts/worker/enqueue-missing-embeddings.ts
 *
 * 适用场景：
 *   - 刚升级到 embed_queue 架构，需要把旧 ad 补排队
 *   - 切换 embedding 模型后，要重新 embed 全量（先 TRUNCATE ad_embeddings 再跑此脚本）
 *
 * 行为：找到 ads.id 中不在 ad_embeddings 也不在 embed_queue (pending/running) 的，
 * 全部 INSERT 'pending'。一条 INSERT 搞定，整体很快。
 */

import { sql } from "drizzle-orm";
import { db } from "../../src/lib/db";

async function main() {
  const before = await db.execute<{ count: number }>(sql`
    SELECT COUNT(*)::int AS count FROM embed_queue WHERE status = 'pending'
  `);
  console.log(`embed_queue pending before: ${before[0]?.count ?? 0}`);

  const inserted = await db.execute<{ ad_id: string }>(sql`
    INSERT INTO embed_queue (ad_id, status, scheduled_for)
    SELECT a.id, 'pending', now()
    FROM ads a
    WHERE NOT EXISTS (
      SELECT 1 FROM ad_embeddings e WHERE e.ad_id = a.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM embed_queue q
      WHERE q.ad_id = a.id AND q.status IN ('pending', 'running')
    )
    RETURNING ad_id
  `);

  console.log(`enqueued: ${inserted.length} ad(s)`);
  const after = await db.execute<{ count: number }>(sql`
    SELECT COUNT(*)::int AS count FROM embed_queue WHERE status = 'pending'
  `);
  console.log(`embed_queue pending after: ${after[0]?.count ?? 0}`);

  process.exit(0);
}

main().catch((e) => {
  console.error("enqueue failed:", e);
  process.exit(1);
});
