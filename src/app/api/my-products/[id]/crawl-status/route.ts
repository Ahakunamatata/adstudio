import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

// GET /api/my-products/[id]/crawl-status
//
// 返回该产品的所有 crawl_jobs 状态聚合 + 最近 1 小时内新入库的 ads 数。
// 前端轮询用：填完产品后每 3-5s 拉一次，刷"正在为你抓取"进度条。
//
// 响应：
// {
//   ok: true,
//   summary: {
//     total: 10,
//     pending: 3, running: 1, completed: 5, failed: 1,
//     adsNewTotal: 47
//   },
//   jobsBySource: {
//     tiktok: { total, pending, running, completed, failed, adsNew },
//     meta: ...,
//     google: ...
//   },
//   jobs: [
//     { id, source, keyword, region, status, adsFound, adsNew,
//       startedAt, completedAt, errorMessage }
//   ]
// }

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

type SourceSummary = {
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  adsNew: number;
};

function emptySource(): SourceSummary {
  return { total: 0, pending: 0, running: 0, completed: 0, failed: 0, adsNew: 0 };
}

export async function GET(_request: Request, context: RouteContext) {
  const { id: productId } = await context.params;
  if (!isValidUuid(productId)) {
    return NextResponse.json({ ok: false, error: "Invalid product id" }, { status: 400 });
  }

  try {
    const jobs = await db
      .select({
        id: schema.crawlJobs.id,
        source: schema.crawlJobs.source,
        keyword: schema.crawlJobs.keyword,
        region: schema.crawlJobs.region,
        status: schema.crawlJobs.status,
        adsFound: schema.crawlJobs.adsFound,
        adsNew: schema.crawlJobs.adsNew,
        startedAt: schema.crawlJobs.startedAt,
        completedAt: schema.crawlJobs.completedAt,
        errorMessage: schema.crawlJobs.errorMessage,
        createdAt: schema.crawlJobs.createdAt
      })
      .from(schema.crawlJobs)
      .where(eq(schema.crawlJobs.productId, productId))
      .orderBy(desc(schema.crawlJobs.createdAt))
      .limit(50);

    const summary = {
      total: jobs.length,
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      adsNewTotal: 0
    };
    const jobsBySource: Record<string, SourceSummary> = {
      tiktok: emptySource(),
      meta: emptySource(),
      google: emptySource()
    };

    for (const job of jobs) {
      // job-level state machine 累计
      if (job.status === "pending") summary.pending += 1;
      else if (job.status === "running") summary.running += 1;
      else if (job.status === "completed") summary.completed += 1;
      else if (job.status === "failed") summary.failed += 1;
      else if (job.status === "cancelled") summary.cancelled += 1;
      summary.adsNewTotal += job.adsNew ?? 0;

      // by source
      const src = jobsBySource[job.source];
      if (src) {
        src.total += 1;
        if (job.status === "pending") src.pending += 1;
        else if (job.status === "running") src.running += 1;
        else if (job.status === "completed") src.completed += 1;
        else if (job.status === "failed") src.failed += 1;
        src.adsNew += job.adsNew ?? 0;
      }
    }

    return NextResponse.json({
      ok: true,
      productId,
      summary,
      jobsBySource,
      jobs: jobs.map((j) => ({
        ...j,
        startedAt: j.startedAt?.toISOString() ?? null,
        completedAt: j.completedAt?.toISOString() ?? null,
        createdAt: j.createdAt.toISOString()
      }))
    });
  } catch (error) {
    console.error("[crawl-status] query failed:", error);
    return NextResponse.json(
      {
        ok: false,
        error: "db_query_failed",
        message: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

// 抑制未使用 import 警告（and 留作未来 filter 扩展）
void and;
