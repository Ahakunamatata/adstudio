import { NextResponse } from "next/server";
import { createViduGeneration, ViduApiError } from "@/lib/vidu";

export const runtime = "nodejs";

function toErrorResponse(error: unknown) {
  if (error instanceof ViduApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  return NextResponse.json({ error: "Vidu 任务创建失败，请稍后重试。" }, { status: 500 });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await createViduGeneration(body);
    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
