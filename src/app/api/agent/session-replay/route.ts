import { NextResponse } from "next/server";
import { createAgentSessionReplay } from "@/lib/agent-session-replay";
import { getServerAgentSessionReplayWorkspace } from "@/lib/agent-workspace-server-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const sessionId = requestUrl.searchParams.get("sessionId")?.trim();
    if (!sessionId) return NextResponse.json({ error: "缺少 sessionId。" }, { status: 400 });

    const workspace = await getServerAgentSessionReplayWorkspace(sessionId);
    return NextResponse.json(createAgentSessionReplay(workspace, sessionId));
  } catch {
    return NextResponse.json({ error: "本地 Agent 会话回放导出失败。" }, { status: 500 });
  }
}
