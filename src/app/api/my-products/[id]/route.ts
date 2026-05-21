import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { templateIndustrySchema } from "@/lib/domain/schemas";

// PATCH  /api/my-products/[id]    部分更新（主要给 Minimax 解析回填用）
// DELETE /api/my-products/[id]    删除（级联会删 product_ad_matches）

export const runtime = "nodejs";

const DEMO_USER = "demo-user";

const patchBodySchema = z
  .object({
    inferredIndustry: templateIndustrySchema.optional(),
    inferredKeywords: z.array(z.string()).max(20).optional(),
    cleanedIntro: z.string().max(800).optional(),
    cleanedPainPoints: z.string().max(600).optional(),
    intro: z.string().max(4000).optional(),
    painPoints: z.string().max(2000).optional(),
    images: z.array(z.string()).max(20).optional()
  })
  .strict();

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Invalid product id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = patchBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request shape", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  try {
    const updateFields = {
      ...parsed.data,
      updatedAt: new Date()
    };
    const [row] = await db
      .update(schema.myProducts)
      .set(updateFields)
      .where(
        and(
          eq(schema.myProducts.id, id),
          eq(schema.myProducts.createdBy, DEMO_USER)
        )
      )
      .returning();

    if (!row) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }
    return NextResponse.json({ product: row });
  } catch (error) {
    console.error("[PATCH /api/my-products/:id] failed:", error);
    return NextResponse.json(
      {
        error: "DB error",
        message: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Invalid product id" }, { status: 400 });
  }
  try {
    const deleted = await db
      .delete(schema.myProducts)
      .where(
        and(
          eq(schema.myProducts.id, id),
          eq(schema.myProducts.createdBy, DEMO_USER)
        )
      )
      .returning({ id: schema.myProducts.id });

    if (deleted.length === 0) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, deletedId: deleted[0].id });
  } catch (error) {
    console.error("[DELETE /api/my-products/:id] failed:", error);
    return NextResponse.json(
      {
        error: "DB error",
        message: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  );
}
