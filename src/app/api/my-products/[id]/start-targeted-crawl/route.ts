import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

// POST /api/my-products/[id]/start-targeted-crawl
//
// 给该产品建一组 crawl_jobs：每个 (source × keyword × region) 一条 pending 任务。
// Worker (67) 上的 crawler-runner 会轮询 pending 拿去跑。
//
// 一期：只投 TikTok（Meta 等身份验证 / Google Sprint C）。
// 关键词：传入 searchQueries（来自 parse 的结构化产出），加产品 inferredKeywords 兜底。

export const runtime = "nodejs";

const requestSchema = z.object({
  // Sprint A：用 searchQueries 优先（覆盖广），fallback inferredKeywords
  searchQueries: z.array(z.string().min(2).max(80)).max(15).optional(),
  // 默认 US；以后可让用户在前端选
  regions: z
    .array(z.string().length(2))
    .min(1)
    .max(5)
    .optional()
    .default(["US"]),
  // 默认 tiktok；Meta 等开通后加
  sources: z
    .array(z.enum(["tiktok", "meta", "google", "tiktok_cc"]))
    .optional()
    .default(["tiktok", "tiktok_cc"])
});

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { id: productId } = await context.params;
  if (!isValidUuid(productId)) {
    return NextResponse.json({ ok: false, error: "Invalid product id" }, { status: 400 });
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // empty body 允许，全用默认
    body = {};
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid request shape", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // 拿到 product 的 keywords / searchQueries（先看请求体，没的话回去查 DB）
  const [product] = await db
    .select()
    .from(schema.myProducts)
    .where(eq(schema.myProducts.id, productId))
    .limit(1);

  if (!product) {
    return NextResponse.json({ ok: false, error: "Product not found" }, { status: 404 });
  }

  let queries = parsed.data.searchQueries ?? [];
  if (queries.length === 0) {
    queries = product.inferredKeywords ?? [];
  }
  if (queries.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "no_keywords",
        message: "Product has no inferredKeywords yet — wait for parse to finish or pass searchQueries explicitly"
      },
      { status: 412 }
    );
  }

  // dedupe + 去掉过长 / 过短
  const cleanQueries = Array.from(
    new Set(queries.map((q) => q.trim().toLowerCase()).filter((q) => q.length >= 2 && q.length <= 80))
  );

  // 一期上限：单产品最多 10 个 keyword × 1 region × 1 source = 10 jobs
  const cappedQueries = cleanQueries.slice(0, 10);
  const cappedRegions = parsed.data.regions.slice(0, 3);
  const cappedSources = parsed.data.sources.slice(0, 3);

  type NewJob = typeof schema.crawlJobs.$inferInsert;
  const jobs: NewJob[] = [];
  for (const source of cappedSources) {
    for (const region of cappedRegions) {
      for (const keyword of cappedQueries) {
        jobs.push({
          productId,
          source,
          keyword,
          region: region.toUpperCase(),
          status: "pending"
        });
      }
    }
  }

  if (jobs.length === 0) {
    return NextResponse.json(
      { ok: false, error: "no_jobs", message: "Empty job matrix" },
      { status: 400 }
    );
  }

  try {
    const inserted = await db.insert(schema.crawlJobs).values(jobs).returning({
      id: schema.crawlJobs.id,
      source: schema.crawlJobs.source,
      keyword: schema.crawlJobs.keyword,
      region: schema.crawlJobs.region
    });
    return NextResponse.json({
      ok: true,
      productId,
      jobsQueued: inserted.length,
      jobs: inserted
    });
  } catch (error) {
    console.error("[start-targeted-crawl] insert failed:", error);
    return NextResponse.json(
      {
        ok: false,
        error: "db_insert_failed",
        message: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
