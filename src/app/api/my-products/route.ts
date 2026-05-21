import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { myProductTypeSchema } from "@/lib/domain/schemas";

// GET  /api/my-products           列出当前 demo-user 的产品（含 ad 计数）
// POST /api/my-products           新建产品（仅初始字段；解析结果走 PATCH 单独写回）
//
// 暂时 createdBy 硬编码 'demo-user'。后续接 auth 时把 createdBy 从 session 取。

export const runtime = "nodejs";

const DEMO_USER = "demo-user";

const createBodySchema = z.object({
  name: z.string().min(1).max(200),
  type: myProductTypeSchema,
  intro: z.string().max(4000).optional().default(""),
  painPoints: z.string().max(2000).optional().default(""),
  url: z.string().max(500).optional().default(""),
  images: z.array(z.string()).max(20).optional().default([]),
  useForCloning: z.boolean().optional().default(true)
});

export async function GET() {
  try {
    const rows = await db
      .select()
      .from(schema.myProducts)
      .where(eq(schema.myProducts.createdBy, DEMO_USER))
      .orderBy(desc(schema.myProducts.createdAt));
    return NextResponse.json({ products: rows });
  } catch (error) {
    console.error("[GET /api/my-products] failed:", error);
    return NextResponse.json(
      {
        error: "DB error",
        message: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = createBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request shape", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const [row] = await db
      .insert(schema.myProducts)
      .values({
        name: parsed.data.name.trim(),
        type: parsed.data.type,
        intro: parsed.data.intro.trim(),
        painPoints: parsed.data.painPoints.trim(),
        url: parsed.data.url.trim(),
        images: parsed.data.images.filter(Boolean),
        useForCloning: parsed.data.useForCloning ? 1 : 0,
        createdBy: DEMO_USER
      })
      .returning();
    return NextResponse.json({ product: row }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/my-products] failed:", error);
    return NextResponse.json(
      {
        error: "DB error",
        message: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
