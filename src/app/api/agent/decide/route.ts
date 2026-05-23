import { NextResponse } from "next/server";
import { decideWithGeminiAgentDetailed, GeminiAgentError, getGeminiAgentRuntimeInfo } from "@/lib/gemini-agent";

export const runtime = "nodejs";

function toErrorResponse(error: unknown) {
  const runtime = getGeminiAgentRuntimeInfo();

  if (error instanceof GeminiAgentError) {
    console.error("[ad-studio-agent] decide failed", {
      reason: error.reason,
      status: error.status,
      message: error.message,
      runtime
    });
    return NextResponse.json(
      {
        error: error.message,
        reason: error.reason,
        runtime
      },
      { status: error.status }
    );
  }

  const detail = error instanceof Error ? error.message : "未知错误。";
  console.error("[ad-studio-agent] decide crashed", {
    detail,
    runtime
  });

  return NextResponse.json(
    {
      error: "Agent 暂时连接失败。",
      detail: detail.slice(0, 500),
      reason: "route_unhandled_error",
      runtime
    },
    { status: 500 }
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { snapshot?: unknown };
    if (!body.snapshot) {
      return NextResponse.json({ error: "缺少 Agent snapshot。" }, { status: 400 });
    }

    const { output, runtime } = await decideWithGeminiAgentDetailed(body.snapshot);
    return NextResponse.json({
      output,
      runtime
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
