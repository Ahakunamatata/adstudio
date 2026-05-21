/**
 * Worker (67) 上的爬虫守护进程。
 *
 * 跑法（systemd）：
 *   tsx --env-file=.env.local scripts/worker/crawler-runner.ts
 *
 * 行为：
 *   - 无限循环，每 POLL_INTERVAL_MS 查一次 crawl_jobs 表
 *   - 用 `FOR UPDATE SKIP LOCKED` 抢一条 pending 任务（多 worker 安全）
 *   - 跑对应 source 的 fetcher（一期只 tiktok）
 *   - 把抓到的 ads 通过现有 upsertAdRow 入库
 *   - 算 Jina embedding（如果还没算）
 *   - 更新 crawl_jobs 状态：started_at, completed_at, ads_found, ads_new, error_message
 *
 * 失败处理：
 *   - 单个 job 失败标 failed + 写 errorMessage，不阻塞下一个
 *   - 连续失败超过 N 次（fetcher 级别），停 30 秒退避
 *   - SIGTERM/SIGINT 优雅退出，正在跑的 job 跑完再退
 */

import { sql } from "drizzle-orm";
import { db, schema } from "../../src/lib/db";
import { fetchTiktokAds } from "../../src/lib/fetchers/tiktokFetcher";
import { fetchMetaAdLibrary } from "../../src/lib/fetchers/metaAdLibraryFetcher";
import { upsertAdRow } from "../../src/lib/db/upsertAd";
import type { NewAd } from "../../src/lib/db/schema";

const POLL_INTERVAL_MS = 5_000;
const BACKOFF_MS = 30_000;
const MAX_CONSECUTIVE_FAILURES = 5;
// 路径 B：低速慢爬 —— 每个 job 之间默认 sleep N 秒，避免对代理 / 目标站突发压力。
// 用住宅代理 1m sticky 时，这能让 chromium 启动 → 握手 → XHR 完成都在一个 IP 内完成。
const JOB_INTERVAL_MS = Number(process.env.CRAWLER_JOB_INTERVAL_MS ?? 45_000);
// 路径 B：临时性网络错误自动重试。Kookeey 这种代理偶尔 ERR_CONNECTION_CLOSED /
// SSL_PROTOCOL_ERROR，多试几次大多数能过。
const MAX_RETRIES_PER_JOB = Number(process.env.CRAWLER_MAX_RETRIES ?? 2);
const RETRY_BACKOFF_MS = Number(process.env.CRAWLER_RETRY_BACKOFF_MS ?? 15_000);

let shouldExit = false;
let consecutiveFailures = 0;

process.on("SIGINT", () => {
  console.log("[crawler-runner] SIGINT received, will exit after current job");
  shouldExit = true;
});
process.on("SIGTERM", () => {
  console.log("[crawler-runner] SIGTERM received, will exit after current job");
  shouldExit = true;
});

function nowIso() {
  return new Date().toISOString();
}

async function claimNextJob() {
  // FOR UPDATE SKIP LOCKED 让多 worker 安全：当前 worker 锁住一行后其他 worker 跳过
  const rows = await db.execute<{
    id: string;
    product_id: string | null;
    source: "tiktok" | "meta" | "google";
    keyword: string;
    region: string;
  }>(sql`
    UPDATE crawl_jobs
    SET status = 'running', started_at = now()
    WHERE id = (
      SELECT id FROM crawl_jobs
      WHERE status = 'pending' AND scheduled_for <= now()
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, product_id, source, keyword, region
  `);
  return rows[0] ?? null;
}

async function markJobCompleted(
  jobId: string,
  adsFound: number,
  adsNew: number
) {
  await db
    .update(schema.crawlJobs)
    .set({
      status: "completed",
      adsFound,
      adsNew,
      completedAt: new Date(),
      errorMessage: null
    })
    .where(sql`id = ${jobId}`);
}

async function markJobFailed(jobId: string, errorMessage: string) {
  await db
    .update(schema.crawlJobs)
    .set({
      status: "failed",
      completedAt: new Date(),
      errorMessage: errorMessage.slice(0, 1000)
    })
    .where(sql`id = ${jobId}`);
}

// 单次 fetcher 调用，按 source 分发。错误已被分类。
async function runFetcherOnce(job: {
  source: "tiktok" | "meta" | "google";
  keyword: string;
  region: string;
}): Promise<
  | { ok: true; ads: NewAd[] }
  | {
      ok: false;
      error: string;
      message: string;
      retryable: boolean;
    }
> {
  if (job.source === "tiktok") {
    const result = await fetchTiktokAds({
      keywords: [job.keyword],
      region: job.region,
      limit: 30
    });
    if (result.ok) return { ok: true, ads: result.ads };
    return {
      ok: false,
      error: result.error,
      message: result.message,
      // network / 偶发 anti_bot 是 transient，captcha / parse_error 不重试
      retryable:
        result.error === "network" ||
        result.error === "anti_bot" ||
        result.error === "rate_limited"
    };
  }
  if (job.source === "meta") {
    const result = await fetchMetaAdLibrary({
      keyword: job.keyword,
      region: job.region,
      limit: 30
    });
    if (result.ok) return { ok: true, ads: result.ads };
    return {
      ok: false,
      error: result.error,
      message: result.message,
      retryable:
        result.error === "network" ||
        result.error === "anti_bot" ||
        result.error === "rate_limited"
    };
  }
  // Google 还没支持
  return {
    ok: false,
    error: "unsupported",
    message: `source=${job.source} not yet supported by worker`,
    retryable: false
  };
}

async function runJob(job: {
  id: string;
  source: "tiktok" | "meta" | "google";
  keyword: string;
  region: string;
}): Promise<void> {
  console.log(
    `[${nowIso()}] [job ${job.id.slice(0, 8)}] start: ${job.source} "${job.keyword}" ${job.region}`
  );

  // 路径 B：transient network 错误本地重试 MAX_RETRIES_PER_JOB 次再判失败
  let lastError = "";
  let result: Awaited<ReturnType<typeof runFetcherOnce>> | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES_PER_JOB; attempt++) {
    if (attempt > 0) {
      console.log(
        `[${nowIso()}] [job ${job.id.slice(0, 8)}] retry ${attempt}/${MAX_RETRIES_PER_JOB} after ${RETRY_BACKOFF_MS}ms`
      );
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
    }
    result = await runFetcherOnce(job);
    if (result.ok) break;
    lastError = `${result.error}: ${result.message}`;
    if (!result.retryable) break;
  }

  if (!result || !result.ok) {
    await markJobFailed(job.id, lastError);
    consecutiveFailures += 1;
    return;
  }

  // upsert + 入 embed_queue + enrich_queue（异步 worker 各管各的）
  let adsNew = 0;
  for (const ad of result.ads) {
    try {
      const wasNew = await upsertAdRow(ad);
      if (wasNew) {
        adsNew += 1;
        // embed_queue：还没 embed 也没排队 → 入队
        try {
          await db.execute(sql`
            INSERT INTO embed_queue (ad_id, status, scheduled_for)
            SELECT ${ad.id}, 'pending', now()
            WHERE NOT EXISTS (
              SELECT 1 FROM ad_embeddings WHERE ad_id = ${ad.id}
            )
            AND NOT EXISTS (
              SELECT 1 FROM embed_queue
              WHERE ad_id = ${ad.id}
                AND status IN ('pending', 'running')
            )
          `);
        } catch (e) {
          console.warn(
            `  enqueue embed failed for ${ad.id}:`,
            e instanceof Error ? e.message : String(e)
          );
        }
        // enrich_queue：tiktok 才入队，且没排过队的（拉 detail 比较贵）
        if (ad.source === "tiktok") {
          try {
            await db.execute(sql`
              INSERT INTO enrich_queue (ad_id, status, scheduled_for)
              SELECT ${ad.id}, 'pending', now()
              WHERE NOT EXISTS (
                SELECT 1 FROM enrich_queue
                WHERE ad_id = ${ad.id}
                  AND status IN ('pending', 'running')
              )
            `);
          } catch (e) {
            console.warn(
              `  enqueue enrich failed for ${ad.id}:`,
              e instanceof Error ? e.message : String(e)
            );
          }
        }
      }
    } catch (e) {
      console.warn(
        `  upsert failed for ${ad.id}:`,
        e instanceof Error ? e.message : String(e)
      );
    }
  }

  await markJobCompleted(job.id, result.ads.length, adsNew);
  consecutiveFailures = 0;
  console.log(
    `[${nowIso()}] [job ${job.id.slice(0, 8)}] done: ${result.ads.length} fetched, ${adsNew} new, queued for embed`
  );
}

async function main() {
  console.log(`[${nowIso()}] crawler-runner started (poll=${POLL_INTERVAL_MS}ms)`);

  while (!shouldExit) {
    try {
      const job = await claimNextJob();
      if (!job) {
        // 没活儿干，睡一会再轮
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      await runJob({
        id: job.id,
        source: job.source,
        keyword: job.keyword,
        region: job.region
      });

      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.warn(
          `[${nowIso()}] ${consecutiveFailures} consecutive failures, backing off ${BACKOFF_MS}ms`
        );
        await new Promise((r) => setTimeout(r, BACKOFF_MS));
        consecutiveFailures = 0;
      }

      // 路径 B：每个 job 之间强制 sleep（即使刚刚跑完很快），让浏览器/代理喘口气
      if (!shouldExit) {
        await new Promise((r) => setTimeout(r, JOB_INTERVAL_MS));
      }
    } catch (error) {
      console.error(
        `[${nowIso()}] worker loop error (will continue):`,
        error instanceof Error ? error.message : String(error)
      );
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }

  console.log(`[${nowIso()}] crawler-runner exited cleanly`);
  process.exit(0);
}

main().catch((error) => {
  console.error(`[${nowIso()}] crawler-runner crashed:`, error);
  process.exit(1);
});
