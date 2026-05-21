// ============================================================
// fal.ai · Seedance 2.0 Image-to-Video Adapter
// ============================================================
// 用官方 SDK `@fal-ai/client`，它包了：
//   - 自动重试
//   - 队列 submit + 轮询
//   - 文件 storage 上传（拿 https://v3.fal.media/... URL）
//
// 文档：
//   https://fal.ai/models/bytedance/seedance-2.0/image-to-video/api
//   https://fal.ai/docs/documentation/model-apis/fal-cdn
//
// Seedance 2.0 (fal) 的关键参数限制（必须遵守）：
//   - resolution: "480p" | "720p"  （没有 1080p）
//   - duration:   "auto" | "4"-"15"
//   - aspect_ratio: "auto" | "21:9" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16"
//   - generate_audio: boolean (默认 true，我们做 TVC 通常要 false)

import fs from "node:fs";
import path from "node:path";
import { fal } from "@fal-ai/client";

const FAL_KEY = process.env.FAL_KEY ?? "";
const FAL_ENDPOINT = process.env.FAL_ENDPOINT ?? "bytedance/seedance-2.0/image-to-video";

// fal SDK 接受 FAL_KEY 环境变量，也可显式 config。这里显式一次保证生效。
if (FAL_KEY) {
  fal.config({ credentials: FAL_KEY });
}

function assertKey(): void {
  if (!FAL_KEY) {
    throw new Error(
      "FAL_KEY 未配置。请在 .env 里填入：\n  FAL_KEY=fal_xxx\n获取：https://fal.ai/dashboard/keys"
    );
  }
}

// ============================================================
// 1) 上传本地图片到 fal storage，拿 CDN URL
// ============================================================

export async function uploadImageToFal(localPath: string): Promise<string> {
  assertKey();
  if (!fs.existsSync(localPath)) {
    throw new Error(`image not found: ${localPath}`);
  }
  const buf = fs.readFileSync(localPath);
  // 推断 mime
  const ext = path.extname(localPath).toLowerCase();
  const mime =
    ext === ".png" ? "image/png"
    : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg"
    : ext === ".webp" ? "image/webp"
    : "application/octet-stream";

  // fal.storage.upload 接受 Blob / File / Buffer
  // 用 Node Blob 包一下 Buffer
  const blob = new Blob([buf], { type: mime });
  // 给文件一个识别名（便于 fal 端日志）
  Object.defineProperty(blob, "name", { value: path.basename(localPath) });

  const url = await fal.storage.upload(blob as any);
  return url;
}

// ============================================================
// 2) 提交一个 I2V 任务，并轮询到完成
// ============================================================

export interface FalSeedanceInput {
  prompt: string;
  image_url: string;
  /** 默认 9:16 */
  aspect_ratio?: "auto" | "21:9" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16";
  /** 默认 "10"，fal 接受字符串枚举 */
  duration?: "auto" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "11" | "12" | "13" | "14" | "15";
  /** 默认 "720p"，注意 fal 没 1080p */
  resolution?: "480p" | "720p";
  /** TVC 通常无人声，默认我们关掉 */
  generate_audio?: boolean;
  /** 可选 seed */
  seed?: number;
}

export interface FalSeedanceResult {
  request_id: string;
  video_url: string;
  seed?: number;
}

/**
 * 提交 + 等待 + 返回结果（subscribe 模式）
 * fal SDK 内置轮询，写起来比手写 status loop 干净
 */
export async function runI2V(
  input: FalSeedanceInput,
  onLog?: (msg: string) => void
): Promise<FalSeedanceResult> {
  assertKey();

  const result = await fal.subscribe(FAL_ENDPOINT, {
    input: {
      prompt: input.prompt,
      image_url: input.image_url,
      aspect_ratio: input.aspect_ratio ?? "9:16",
      duration: input.duration ?? "10",
      resolution: input.resolution ?? "720p",
      generate_audio: input.generate_audio ?? false,
      ...(input.seed != null ? { seed: input.seed } : {}),
    },
    logs: true,
    onQueueUpdate: (update: any) => {
      const status = update?.status;
      if (status === "IN_PROGRESS" && Array.isArray(update.logs)) {
        for (const log of update.logs) {
          if (log?.message) onLog?.(log.message);
        }
      } else if (status === "IN_QUEUE" && typeof update.position === "number") {
        onLog?.(`queued (position: ${update.position})`);
      }
    },
  });

  // result.data 是模型输出，result.requestId 是 request 标识
  const data: any = (result as any).data ?? result;
  const requestId: string = (result as any).requestId ?? data?.request_id ?? "";
  const videoUrl: string | undefined = data?.video?.url;
  if (!videoUrl) {
    throw new Error(
      `fal succeeded but no video.url in result: ${JSON.stringify(data).slice(0, 300)}`
    );
  }
  return { request_id: requestId, video_url: videoUrl, seed: data?.seed };
}

// ============================================================
// 3) 下载视频到本地
// ============================================================

export async function downloadVideo(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
}
