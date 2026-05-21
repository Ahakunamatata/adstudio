/**
 * Worker (67) 上的 embedding 守护进程（独立于 crawler-runner）。
 *
 * 跑法（systemd）：
 *   tsx --env-file=.env.local scripts/worker/embed-runner.ts
 *
 * 行为：
 *   - 无限循环，轮询 embed_queue
 *   - 用 `FOR UPDATE SKIP LOCKED` 抢一条 pending && scheduled_for <= now() 的任务
 *   - 加载 ad row，调 Jina embedding，写 ad_embeddings
 *   - 成功 → status=done, completed_at=now()
 *   - 失败 → attempts +=1, scheduled_for 推迟（指数回退），attempts >= max_attempts 时 status=failed
 *
 * 为什么独立：
 *   - crawler 跑得快，embedding 受 Jina rate limit 影响慢，两者解耦后互不阻塞
 *   - embedding provider 切换（Jina ↔ Minimax）只动这一个文件
 *   - 后续做"重新 embed 全量"只要往 queue 里塞 row 就行
 *
 * 失败处理：
 *   - 单条任务 catch 后写 last_error；不抛
 *   - 连续 N 次失败 backoff 30s
 *   - SIGTERM/SIGINT 优雅退出
 */

import { sql } from "drizzle-orm";
import { db, schema } from "../../src/lib/db";
import { embedOneOrNull } from "../../src/lib/llm/embedding";

const POLL_INTERVAL_MS = 3_000;
const BACKOFF_MS = 30_000;
const MAX_CONSECUTIVE_FAILURES = 5;
// 失败时下次可重试的延迟：linear backoff 1m / 5m / 15m / 60m / 4h
const RETRY_DELAY_MINUTES = [1, 5, 15, 60, 240];

let shouldExit = false;
let consecutiveFailures = 0;

process.on("SIGINT", () => {
  console.log("[embed-runner] SIGINT received, will exit after current job");
  shouldExit = true;
});
process.on("SIGTERM", () => {
  console.log("[embed-runner] SIGTERM received, will exit after current job");
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
  // FOR UPDATE SKIP LOCKED：多 embed-runner 进程并发也安全
  const rows = await db.execute<ClaimedRow>(sql`
    UPDATE embed_queue
    SET status = 'running', claimed_at = now(), updated_at = now()
    WHERE id = (
      SELECT id FROM embed_queue
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
    UPDATE embed_queue
    SET status = 'done', completed_at = now(), updated_at = now(), last_error = NULL
    WHERE id = ${id}
  `);
}

async function markFailureOrRetry(
  id: string,
  attempts: number,
  maxAttempts: number,
  errorMessage: string
) {
  const nextAttempt = attempts + 1;
  const truncated = errorMessage.slice(0, 1000);
  if (nextAttempt >= maxAttempts) {
    // 终态 failed —— 留给人看
    await db.execute(sql`
      UPDATE embed_queue
      SET status = 'failed',
          attempts = ${nextAttempt},
          last_error = ${truncated},
          completed_at = now(),
          updated_at = now()
      WHERE id = ${id}
    `);
    return;
  }
  // 回退：用 attempts（已 +1 前）查 RETRY_DELAY_MINUTES
  const delayMin =
    RETRY_DELAY_MINUTES[Math.min(attempts, RETRY_DELAY_MINUTES.length - 1)] ??
    60;
  await db.execute(sql`
    UPDATE embed_queue
    SET status = 'pending',
        attempts = ${nextAttempt},
        last_error = ${truncated},
        scheduled_for = now() + (${delayMin}::int || ' minutes')::interval,
        claimed_at = NULL,
        updated_at = now()
    WHERE id = ${id}
  `);
}

type AdRow = {
  id: string;
  advertiser_name: string | null;
  ad_creative_bodies: string[] | null;
  ad_creative_titles: string[] | null;
  region: string | null;
  languages: string[] | null;
};

function buildEmbedText(ad: AdRow): string {
  const parts: string[] = [];
  if (ad.advertiser_name) parts.push(`Brand: ${ad.advertiser_name}`);
  if (ad.ad_creative_bodies?.length)
    parts.push(`Creative: ${ad.ad_creative_bodies.join(" ¶ ")}`);
  if (ad.ad_creative_titles?.length)
    parts.push(`Titles: ${ad.ad_creative_titles.join(" / ")}`);
  if (ad.region) parts.push(`Region: ${ad.region}`);
  if (ad.languages?.length) parts.push(`Languages: ${ad.languages.join(",")}`);
  return parts.join("\n");
}

async function runOne(row: ClaimedRow): Promise<void> {
  console.log(
    `[${nowIso()}] [embed ${row.id.slice(0, 8)}] start: ad=${row.ad_id} attempt=${row.attempts + 1}/${row.max_attempts}`
  );

  // 取 ad —— 如果 ad 被删了（外键 cascade），直接标 done（noop）
  const adRows = await db.execute<AdRow>(sql`
    SELECT id, advertiser_name, ad_creative_bodies, ad_creative_titles, region, languages
    FROM ads WHERE id = ${row.ad_id}
  `);
  const ad = adRows[0];
  if (!ad) {
    await markDone(row.id);
    console.log(
      `[${nowIso()}] [embed ${row.id.slice(0, 8)}] ad gone, marked done`
    );
    return;
  }

  // 已经有 embedding 了 —— 也直接标 done（幂等）
  const existing = await db.execute<{ ad_id: string }>(sql`
    SELECT ad_id FROM ad_embeddings WHERE ad_id = ${row.ad_id} LIMIT 1
  `);
  if (existing[0]) {
    await markDone(row.id);
    console.log(
      `[${nowIso()}] [embed ${row.id.slice(0, 8)}] already embedded, marked done`
    );
    return;
  }

  const text = buildEmbedText(ad);
  if (!text || text.length < 3) {
    // 文本太空，跳过（标 failed 终态，避免无限轮训）
    await markFailureOrRetry(
      row.id,
      row.attempts,
      1, // 立即终态化（force max_attempts=1，使下一次 >= max）
      "empty embed text (no advertiser/creative)"
    );
    return;
  }

  let vector: number[] | null = null;
  try {
    vector = await embedOneOrNull(text, "db");
  } catch (e) {
    await markFailureOrRetry(
      row.id,
      row.attempts,
      row.max_attempts,
      `embed call threw: ${e instanceof Error ? e.message : String(e)}`
    );
    consecutiveFailures += 1;
    return;
  }
  if (!vector) {
    await markFailureOrRetry(
      row.id,
      row.attempts,
      row.max_attempts,
      "embed returned null (provider error or fallback exhausted)"
    );
    consecutiveFailures += 1;
    return;
  }

  try {
    await db.insert(schema.adEmbeddings).values({
      adId: row.ad_id,
      model: process.env.JINA_EMBED_MODEL ?? "jina-embeddings-v3",
      embedding: vector
    });
    await markDone(row.id);
    consecutiveFailures = 0;
    console.log(
      `[${nowIso()}] [embed ${row.id.slice(0, 8)}] done (${vector.length} dim)`
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("duplicate") || msg.includes("unique")) {
      // 别的 worker 抢先写了 —— 算成功
      await markDone(row.id);
      consecutiveFailures = 0;
      return;
    }
    await markFailureOrRetry(
      row.id,
      row.attempts,
      row.max_attempts,
      `insert ad_embeddings failed: ${msg}`
    );
    consecutiveFailures += 1;
  }
}

async function main() {
  console.log(
    `[${nowIso()}] embed-runner started (poll=${POLL_INTERVAL_MS}ms)`
  );

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
    } catch (error) {
      console.error(
        `[${nowIso()}] embed loop error (will continue):`,
        error instanceof Error ? error.message : String(error)
      );
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }

  console.log(`[${nowIso()}] embed-runner exited cleanly`);
  process.exit(0);
}

main().catch((error) => {
  console.error(`[${nowIso()}] embed-runner crashed:`, error);
  process.exit(1);
});
