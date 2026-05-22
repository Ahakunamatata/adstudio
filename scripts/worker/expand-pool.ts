/**
 * Sprint B 池子扩张器：把 crawl_matrix 里到期的规则展开成 crawl_jobs 任务。
 *
 * 跑法（systemd timer 触发，间隔 5-10 分钟）：
 *   tsx --env-file=.env.local scripts/worker/expand-pool.ts
 *
 * 行为（单次 run）：
 *   1. 扫描 crawl_matrix where enabled=1 && next_run_at <= now() ORDER BY priority DESC
 *   2. 对每条规则：
 *      a. 检查 crawl_jobs 同 (source,keyword,region) 是否还有 pending/running（避免重复）
 *      b. 若无 → INSERT 一条 pending crawl_job
 *      c. 更新 matrix 行：last_run_at = now(), next_run_at = now() + cadence_hours
 *   3. 受 MAX_NEW_JOBS_PER_RUN 限制，避免单次跑爆 worker 池子
 *
 * 退出码：0 总是。失败的单条不阻塞整批（log + 计数）。
 */

import { sql } from "drizzle-orm";
import { db } from "../../src/lib/db";

const MAX_NEW_JOBS_PER_RUN = Number(process.env.EXPAND_POOL_MAX ?? 50);
const MAX_PENDING_BACKLOG = Number(process.env.EXPAND_POOL_BACKLOG ?? 200);
// 公平性：每个 source 在 backlog 里最多占 PER_SOURCE_CAP 条 pending，
// 超过就让位给别的 source。避免 meta 多产把 tiktok / google 饿死。
const PER_SOURCE_PENDING_CAP = Number(process.env.EXPAND_POOL_PER_SOURCE_CAP ?? 80);

function nowIso() {
  return new Date().toISOString();
}

type DueRule = {
  id: string;
  product_id: string | null;
  source: "tiktok" | "meta" | "google";
  keyword: string;
  region: string;
  cadence_hours: number;
};

async function loadDueRules(): Promise<DueRule[]> {
  const rows = await db.execute<DueRule>(sql`
    SELECT id, product_id, source, keyword, region, cadence_hours
    FROM crawl_matrix
    WHERE enabled = 1 AND next_run_at <= now()
    ORDER BY priority DESC, next_run_at ASC
    LIMIT ${MAX_NEW_JOBS_PER_RUN}
  `);
  return rows;
}

async function backlogSize(): Promise<number> {
  const rows = await db.execute<{ c: number }>(sql`
    SELECT COUNT(*)::int AS c FROM crawl_jobs WHERE status IN ('pending', 'running')
  `);
  return rows[0]?.c ?? 0;
}

// 按 source 拆 pending/running 数量，用来做"哪个 source 已经够多了，让位给别人"判断
async function pendingPerSource(): Promise<Record<string, number>> {
  const rows = await db.execute<{ source: string; c: number }>(sql`
    SELECT source, COUNT(*)::int AS c
    FROM crawl_jobs
    WHERE status IN ('pending', 'running')
    GROUP BY source
  `);
  const map: Record<string, number> = {};
  for (const r of rows) map[r.source] = r.c;
  return map;
}

async function hasOpenJob(rule: DueRule): Promise<boolean> {
  // 避免重复：同一 (source, keyword, region) 已有 pending/running 就跳过
  const rows = await db.execute<{ id: string }>(sql`
    SELECT id FROM crawl_jobs
    WHERE source = ${rule.source}
      AND keyword = ${rule.keyword}
      AND region = ${rule.region}
      AND status IN ('pending', 'running')
    LIMIT 1
  `);
  return rows.length > 0;
}

async function insertJob(rule: DueRule): Promise<void> {
  await db.execute(sql`
    INSERT INTO crawl_jobs (product_id, source, keyword, region, status, scheduled_for)
    VALUES (${rule.product_id}, ${rule.source}, ${rule.keyword}, ${rule.region}, 'pending', now())
  `);
}

async function updateRuleNextRun(rule: DueRule): Promise<void> {
  // 用 SQL 算 next_run_at（避免本机时钟漂移）
  await db.execute(sql`
    UPDATE crawl_matrix
    SET last_run_at = now(),
        next_run_at = now() + (${rule.cadence_hours}::int || ' hours')::interval,
        updated_at = now()
    WHERE id = ${rule.id}
  `);
}

async function main() {
  console.log(`[${nowIso()}] expand-pool start`);
  const backlog = await backlogSize();
  const perSource = await pendingPerSource();
  console.log(`  current backlog: ${backlog} pending/running`, perSource);

  // 早期硬上限：远超全局上限时 skip。但即使触发，也保留 fairness —— 任何 source
  // 当前 pending < PER_SOURCE_PENDING_CAP 时仍允许插入，防止 google 这种新 source
  // 永远被 meta + tiktok 的存量挤掉。
  const overAllSource = Object.keys(perSource).every(
    (s) => (perSource[s] ?? 0) >= PER_SOURCE_PENDING_CAP
  );
  if (backlog >= MAX_PENDING_BACKLOG && overAllSource) {
    console.log(
      `  backlog ${backlog} >= ${MAX_PENDING_BACKLOG} AND all sources >= per-source cap ${PER_SOURCE_PENDING_CAP}, skip`
    );
    process.exit(0);
  }

  const rules = await loadDueRules();
  console.log(`  due rules: ${rules.length}`);

  let inserted = 0;
  let skipped = 0;
  let failed = 0;
  let skippedSourceFull = 0;

  // pendingPerSource 是快照值，本轮新插入的也要计入，否则会超过 cap
  const liveCount: Record<string, number> = { ...perSource };

  for (const rule of rules) {
    try {
      const sourceBacklog = liveCount[rule.source] ?? 0;
      if (sourceBacklog >= PER_SOURCE_PENDING_CAP) {
        // 这个 source 已经够多了 —— 把规则推迟一点（不是 cadence_hours 那么久，
        // 让别的 source 先去；下次 timer 触发再回来看），避免占用 LIMIT 配额。
        // 用 1 小时延迟，timer 又转回来时大概率 backlog 已经消化掉一部分。
        await db.execute(sql`
          UPDATE crawl_matrix
          SET next_run_at = now() + interval '1 hour', updated_at = now()
          WHERE id = ${rule.id}
        `);
        skippedSourceFull += 1;
        continue;
      }
      if (await hasOpenJob(rule)) {
        // 还是要 bump next_run_at —— 不然每分钟都会 rescan
        await updateRuleNextRun(rule);
        skipped += 1;
        continue;
      }
      await insertJob(rule);
      await updateRuleNextRun(rule);
      liveCount[rule.source] = sourceBacklog + 1;
      inserted += 1;
    } catch (e) {
      failed += 1;
      console.warn(
        `  rule ${rule.id.slice(0, 8)} (${rule.source}/${rule.keyword}/${rule.region}) failed:`,
        e instanceof Error ? e.message : String(e)
      );
    }
  }

  console.log(
    `[${nowIso()}] expand-pool done: inserted=${inserted}, skipped(dup)=${skipped}, skipped(source-full)=${skippedSourceFull}, failed=${failed}`
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("expand-pool crashed:", e);
  process.exit(1);
});
