import { NextResponse } from "next/server";
import {
  analyzeMediaWithGemini,
  GeminiMediaAnalysisError,
  getGeminiMediaRuntimeInfo
} from "@/lib/gemini-media-analysis";

export const runtime = "nodejs";
export const maxDuration = 120;

const maxUploadBytes = 60 * 1024 * 1024;

function toErrorResponse(error: unknown) {
  const runtimeInfo = getGeminiMediaRuntimeInfo();

  if (error instanceof GeminiMediaAnalysisError) {
    return NextResponse.json(
      {
        error: error.message,
        runtime: runtimeInfo
      },
      { status: error.status }
    );
  }

  const detail = error instanceof Error ? error.message : "未知错误。";
  return NextResponse.json(
    {
      error: "素材解析失败。",
      detail: detail.slice(0, 500),
      runtime: runtimeInfo
    },
    { status: 500 }
  );
}

function inferMimeTypeFromUrl(url: string) {
  if (/\.(mp4|mov|webm)(\?|#|$)/i.test(url)) return "video/mp4";
  if (/\.(png)(\?|#|$)/i.test(url)) return "image/png";
  if (/\.(jpe?g)(\?|#|$)/i.test(url)) return "image/jpeg";
  if (/\.(webp)(\?|#|$)/i.test(url)) return "image/webp";
  return "application/octet-stream";
}

async function readMultipartInput(request: Request) {
  const formData = await request.formData();
  const fileValue = formData.get("file");
  if (!(fileValue instanceof File)) {
    throw new GeminiMediaAnalysisError("缺少待解析的图片或视频文件。", 400);
  }

  if (!fileValue.type.startsWith("image/") && !fileValue.type.startsWith("video/")) {
    throw new GeminiMediaAnalysisError("当前素材解析只支持图片或视频文件。", 400);
  }

  if (fileValue.size > maxUploadBytes) {
    throw new GeminiMediaAnalysisError("素材文件过大，请先使用 60MB 以内的图片或短视频测试。", 413);
  }

  const buffer = Buffer.from(await fileValue.arrayBuffer());
  return {
    mediaUrl: `data:${fileValue.type || "application/octet-stream"};base64,${buffer.toString("base64")}`,
    mimeType: fileValue.type,
    fileName: fileValue.name,
    role: String(formData.get("role") ?? "reference_asset"),
    userContext: String(formData.get("userContext") ?? "")
  };
}

async function readJsonInput(request: Request) {
  const body = (await request.json()) as {
    url?: string;
    mimeType?: string;
    fileName?: string;
    role?: string;
    userContext?: string;
  };

  if (!body.url) {
    throw new GeminiMediaAnalysisError("缺少待解析素材 URL。", 400);
  }

  return {
    mediaUrl: body.url,
    mimeType: body.mimeType || inferMimeTypeFromUrl(body.url),
    fileName: body.fileName || body.url.split("/").pop() || "remote-media",
    role: body.role || "reference_asset",
    userContext: body.userContext || ""
  };
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    const input = contentType.includes("multipart/form-data")
      ? await readMultipartInput(request)
      : await readJsonInput(request);
    const analysis = await analyzeMediaWithGemini(input);

    return NextResponse.json({
      analysis,
      runtime: getGeminiMediaRuntimeInfo()
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
