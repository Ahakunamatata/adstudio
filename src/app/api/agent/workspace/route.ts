import { NextResponse } from "next/server";
import {
  deleteServerAgentWorkspaceSession,
  getServerAgentWorkspace,
  saveServerAgentWorkspace
} from "@/lib/agent-workspace-server-store";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getServerAgentWorkspace());
  } catch {
    return NextResponse.json({ error: "本地 Agent 工作区读取失败。" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    return NextResponse.json(await saveServerAgentWorkspace(await request.json()));
  } catch {
    return NextResponse.json({ error: "本地 Agent 工作区保存失败。" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const sessionId = requestUrl.searchParams.get("sessionId");
    if (!sessionId) return NextResponse.json({ error: "缺少 sessionId。" }, { status: 400 });
    return NextResponse.json(await deleteServerAgentWorkspaceSession(sessionId));
  } catch {
    return NextResponse.json({ error: "本地 Agent 工作区删除失败。" }, { status: 500 });
  }
}
