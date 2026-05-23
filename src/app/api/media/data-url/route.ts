import { NextResponse } from "next/server";

export const runtime = "nodejs";

const maxAssetBytes = 16 * 1024 * 1024;

function getErrorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function isSupportedMediaType(contentType: string) {
  return /^image\//i.test(contentType) || /^video\//i.test(contentType);
}

export async function POST(request: Request) {
  let body: { url?: unknown };
  try {
    body = (await request.json()) as { url?: unknown };
  } catch {
    return getErrorResponse("素材缓存请求格式错误。");
  }

  if (typeof body.url !== "string" || !body.url.trim()) {
    return getErrorResponse("缺少素材 URL。");
  }

  let assetUrl: URL;
  try {
    assetUrl = new URL(body.url);
  } catch {
    return getErrorResponse("素材 URL 无效。");
  }

  if (assetUrl.protocol !== "http:" && assetUrl.protocol !== "https:") {
    return getErrorResponse("只支持缓存远程素材 URL。");
  }

  let response: Response;
  try {
    response = await fetch(assetUrl, { cache: "no-store" });
  } catch {
    return getErrorResponse("远程素材读取失败。", 502);
  }

  if (!response.ok) {
    return getErrorResponse("远程素材读取失败。", response.status);
  }

  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  if (!isSupportedMediaType(contentType)) {
    return getErrorResponse("远程素材不是图片或视频。", 415);
  }

  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxAssetBytes) {
    return getErrorResponse("远程素材过大，无法缓存。", 413);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > maxAssetBytes) {
    return getErrorResponse("远程素材过大，无法缓存。", 413);
  }

  return NextResponse.json({
    dataUrl: `data:${contentType};base64,${bytes.toString("base64")}`
  });
}
