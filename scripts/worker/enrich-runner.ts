/**
 * Worker (67) 上的 detail 富化守护进程。
 *
 * 跑法：
 *   tsx --env-file=.env.local scripts/worker/enrich-runner.ts
 *
 * 行为：
 *   - 轮询 enrich_queue（pending && scheduled_for <= now()）
 *   - 用 `FOR UPDATE SKIP LOCKED` 抢一条
 *   - 拉 TikTok detail 页面 → 抽 transcript / landing / metrics
 *   - 把 ads 行更新 transcript/landing_page_url/metrics/enriched_at
 *   - 同时也"重新入队" embed_queue（因为 transcript 让 embedding 变更高质量）
 *
 * 失败处理：
 *   - 单条任务 catch 后写 last_error
 *   - 失败按线性回退 5m / 15m / 60m 重试
 *   - 连续失败 5 次 backoff 30s
 *   - SIGTERM/SIGINT 优雅退出
 *
 * Detail 富化只支持 TikTok（Meta detail 走官方 API 是另一条路径）。
 */

import { sql } from "drizzle-orm";
import { db } from "../../src/lib/db";
import { fetchTiktokAdDetail } from "../../src/lib/fetchers/tiktokDetailFetcher";

const POLL_INTERVAL_MS = 5_000;
const BACKOFF_MS = 30_000;
const MAX_CONSECUTIVE_FAILURES = 5;
const RETRY_DELAY_MINUTES = [5, 15, 60];

let shouldExit = false;
let consecutiveFailures = 0;

process.on("SIGINT", () => {
  console.log("[enrich-runner] SIGINT, will exit after current job");
  shouldExit = true;
});
process.on("SIGTERM", () => {
  console.log("[enrich-runner] SIGTERM, will exit after current job");
  shouldExit = true;
});

function nowIso() {
  return new Date().toISOString();
}

type ClaimedRow = {
  id: string;
  ad_id: string;
  attempts: number;
  max_attempts: number;
};

async function claimNext(): Promise<ClaimedRow | null> {
  const rows = await db.execute<ClaimedRow>(sql`
    UPDATE enrich_queue
    SET status = 'running', claimed_at = now(), updated_at = now()
    WHERE id = (
      SELECT id FROM enrich_queue
      WHERE status = 'pending' AND scheduled_for <= now()
      ORDER BY scheduled_for ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, ad_id, attempts, max_attempts
  `);
  return rows[0] ?? null;
}

async function markDone(id: string) {
  await db.execute(sql`
    UPDATE enrich_queue
    SET status = 'done', completed_at = now(), updated_at = now(), last_error = NULL
    WHERE id = ${id}
  `);
}

async function markFailureOrRetry(
  id: string,
  attempts: number,
  maxAttempts: number,
  message: string
) {
  const nextAttempt = attempts + 1;
  const trunc = message.slice(0, 1000);
  if (nextAttempt >= maxAttempts) {
    await db.execute(sql`
      UPDATE enrich_queue
      SET status = 'failed',
          attempts = ${nextAttempt},
          last_error = ${trunc},
          completed_at = now(),
          updated_at = now()
      WHERE id = ${id}
    `);
    return;
  }
  const delayMin =
    RETRY_DELAY_MINUTES[Math.min(attempts, RETRY_DELAY_MINUTES.length - 1)] ??
    60;
  await db.execute(sql`
    UPDATE enrich_queue
    SET status = 'pending',
        attempts = ${nextAttempt},
        last_error = ${trunc},
        scheduled_for = now() + (${delayMin}::int || ' minutes')::interval,
        claimed_at = NULL,
        updated_at = now()
    WHERE id = ${id}
  `);
}

type AdRow = {
  id: string;
  source: "tiktok" | "meta" | "google";
  source_id: string;
};

async function loadAd(adId: string): Promise<AdRow | null> {
  const rows = await db.execute<AdRow>(sql`
    SELECT id, source, source_id FROM ads WHERE id = ${adId}
  `);
  return rows[0] ?? null;
}

async function applyEnrichment(
  adId: string,
  transcript: string | null,
  landingPageUrl: string | null,
  metrics: Record<string, unknown> | null
): Promise<void> {
  // 只更新非空字段（保留旧值），enriched_at 总是更新
  await db.execute(sql`
    UPDATE ads
    SET transcript = COALESCE(${transcript}, transcript),
        landing_page_url = COALESCE(${landingPageUrl}, landing_page_url),
        metrics = CASE
          WHEN ${metrics ? JSON.stringify(metrics) : null}::jsonb IS NULL
            THEN metrics
          ELSE COALESCE(metrics, '{}'::jsonb) || ${metrics ? JSON.stringify(metrics) : "{}"}::jsonb
        END,
        enriched_at = now(),
        updated_at = now()
    WHERE id = ${adId}
  `);
}

async function reEnqueueEmbed(adId: string): Promise<void> {
  // 富化让 embed 更高质量；如果之前已 embed，给一条新 pending row 让 embed-runner
  // 重算（embed-runner 写 ad_embeddings 用 INSERT，遇 PK 冲突的重 embed 还需要
  // 上层手动删 ad_embeddings；这里只是排队）。
  // 这里只在该 ad 还没排队时入队 —— 不强制重 embed，留给后续 reembed-all 脚本。
  await db.execute(sql`
    INSERT INTO embed_queue (ad_id, status, scheduled_for)
    SELECT ${adId}, 'pending', now()
    WHERE NOT EXISTS (
      SELECT 1 FROM embed_queue
      WHERE ad_id = ${adId} AND status IN ('pending', 'running')
    )
    AND NOT EXISTS (
      SELECT 1 FROM ad_embeddings WHERE ad_id = ${adId}
    )
  `);
}

async function runOne(row: ClaimedRow): Promise<void> {
  console.log(
    `[${nowIso()}] [enrich ${row.id.slice(0, 8)}] start: ad=${row.ad_id} attempt=${row.attempts + 1}/${row.max_attempts}`
  );

  const ad = await loadAd(row.ad_id);
  if (!ad) {
    await markDone(row.id);
    return;
  }
  if (ad.source !== "tiktok") {
    // Meta/Google 的 detail 富化走别的链路；当前 worker 暂时只处理 tiktok
    await markFailureOrRetry(
      row.id,
      row.attempts,
      1,
      `source=${ad.source} not supported by enrich-runner`
    );
    return;
  }

  const result = await fetchTiktokAdDetail(ad.source_id);
  if (!result.ok) {
    // not_found 是终态 —— 没必要重试
    if (result.error === "not_found") {
      await markFailureOrRetry(row.id, row.attempts, 1, result.message);
      return;
    }
    await markFailureOrRetry(
      row.id,
      row.attempts,
      row.max_attempts,
      `${result.error}: ${result.message}`
    );
    consecutiveFailures += 1;
    return;
  }

  try {
    await applyEnrichment(
      row.ad_id,
      result.transcript,
      result.landingPageUrl,
      result.metrics
    );
    if (result.transcript && result.transcript.length > 20) {
      // 拿到了真有内容的 transcript：触发 reembed 排队（已 embed 的不重排）
      await reEnqueueEmbed(row.ad_id);
    }
    await markDone(row.id);
    consecutiveFailures = 0;
    console.log(
      `[${nowIso()}] [enrich ${row.id.slice(0, 8)}] done: transcript=${result.transcript ? result.transcript.length + " chars" : "none"} landing=${result.landingPageUrl ? "yes" : "no"} metrics=${result.metrics ? Object.keys(result.metrics).length : 0}`
    );
  } catch (e) {
    await markFailureOrRetry(
      row.id,
      row.attempts,
      row.max_attempts,
      `apply update failed: ${e instanceof Error ? e.message : String(e)}`
    );
    consecutiveFailures += 1;
  }
}

async function main() {
  console.log(`[${nowIso()}] enrich-runner started (poll=${POLL_INTERVAL_MS}ms)`);
  while (!shouldExit) {
    try {
      const row = await claimNext();
      if (!row) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }
      await runOne(row);
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.warn(
          `[${nowIso()}] ${consecutiveFailures} consecutive failures, backing off ${BACKOFF_MS}ms`
        );
        await new Promise((r) => setTimeout(r, BACKOFF_MS));
        consecutiveFailures = 0;
      }
    } catch (e) {
      console.error(
        `[${nowIso()}] enrich loop error (continuing):`,
        e instanceof Error ? e.message : String(e)
      );
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }
  console.log(`[${nowIso()}] enrich-runner exited cleanly`);
  process.exit(0);
}

main().catch((e) => {
  console.error(`[${nowIso()}] enrich-runner crashed:`, e);
  process.exit(1);
});
