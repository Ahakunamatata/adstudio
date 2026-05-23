import { NextResponse } from "next/server";
import { getLocalViduHistory, saveLocalViduHistory } from "@/lib/vidu-history";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getLocalViduHistory());
  } catch {
    return NextResponse.json({ error: "本地 Vidu 历史读取失败。" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    return NextResponse.json(await saveLocalViduHistory(await request.json()));
  } catch {
    return NextResponse.json({ error: "本地 Vidu 历史保存失败。" }, { status: 500 });
  }
}
