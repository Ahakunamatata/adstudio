import { NextResponse } from "next/server";
import { getViduTask, ViduApiError } from "@/lib/vidu";

export const runtime = "nodejs";

type TaskRouteContext = {
  params: Promise<{ taskId: string }>;
};

function toErrorResponse(error: unknown) {
  if (error instanceof ViduApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  return NextResponse.json({ error: "Vidu 任务查询失败，请稍后重试。" }, { status: 500 });
}

export async function GET(_request: Request, context: TaskRouteContext) {
  try {
    const { taskId } = await context.params;
    const result = await getViduTask(taskId);
    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
