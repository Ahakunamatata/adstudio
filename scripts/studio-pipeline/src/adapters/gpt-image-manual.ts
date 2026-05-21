// ============================================================
// 半自动 t2i Adapter · gpt-image-2 (ChatGPT 手工跑)
// ============================================================
// 工作流：
//   1. CLI 打印 prompt → 你复制到 ChatGPT GPT Image 2.0 生成
//   2. 你把生成的图片下载到 runs/{batch}/{task_id}/keyframe.png
//   3. 在 CLI 里按 Enter 继续
//   4. pipeline 自动把图片上传到 fal storage 拿公网 URL（无需手粘）
//
// 注意：fal storage URL 是 https://v3.fal.media/files/{path}
//       这个 URL 可以直接喂给 Seedance 2.0 image-to-video。

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as procStdin, stdout as procStdout } from "node:process";
import kleur from "kleur";
import { uploadImageToFal } from "./seedance-fal.js";

export interface ManualT2IInput {
  task_id: string;
  prompt: string;
  expected_path: string;
  upload_strategy: "fal_storage" | "public_dir" | "manual_url";
}

export async function waitForKeyframe(input: ManualT2IInput): Promise<{
  local_path: string;
}> {
  console.log("");
  console.log(
    kleur.bold().cyan(
      `╭─ [${input.task_id}] T2I · 请用 ChatGPT GPT Image 2.0 生成下面这张图 ─`
    )
  );
  console.log(kleur.dim("│"));
  for (const line of input.prompt.split("\n")) {
    console.log(kleur.dim("│ ") + line);
  }
  console.log(kleur.dim("│"));
  console.log(kleur.bold().cyan(`╰─ 生成后把图片保存到：`));
  console.log(kleur.yellow().bold(`   ${input.expected_path}`));
  console.log("");
  console.log(
    kleur.dim(`(已经准备好图片后，回车继续；或键入 'skip' 跳过这个任务)`)
  );

  const rl = readline.createInterface({ input: procStdin, output: procStdout });
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const answer = (await rl.question("> ")).trim();
    if (answer === "skip") {
      rl.close();
      throw new Error("user skipped this t2i task");
    }
    if (fs.existsSync(input.expected_path)) {
      const stat = fs.statSync(input.expected_path);
      if (stat.size > 1024) {
        rl.close();
        console.log(
          kleur.green(`✓ 检测到图片 (${(stat.size / 1024).toFixed(1)} KB)`)
        );
        return { local_path: input.expected_path };
      }
      console.log(kleur.red(`文件太小（${stat.size}B），重传一下？`));
      continue;
    }
    console.log(kleur.red(`未在 ${input.expected_path} 找到文件，再放一次？`));
  }
}

/**
 * 把本地图片上传到公网，返回 URL。
 * 默认走 fal_storage：调 fal SDK 上传，拿 https://v3.fal.media/... URL。
 * public_dir / manual_url 是兜底方案。
 */
export async function uploadKeyframe(
  localPath: string,
  strategy: "fal_storage" | "public_dir" | "manual_url",
  ctx: { batch_id: string; task_id: string; template_id?: string }
): Promise<string> {
  if (strategy === "fal_storage") {
    console.log(kleur.dim("  uploading keyframe to fal storage..."));
    const url = await uploadImageToFal(localPath);
    console.log(kleur.green(`  ✓ uploaded: ${url}`));
    return url;
  }

  if (strategy === "manual_url") {
    const rl = readline.createInterface({
      input: procStdin,
      output: procStdout,
    });
    const url = (
      await rl.question(
        kleur.cyan(`粘贴图片公网 URL（imgbb / sm.ms / 七牛 / TOS 都行）：\n> `)
      )
    ).trim();
    rl.close();
    if (!url.startsWith("http")) throw new Error("URL 必须以 http 开头");
    return url;
  }

  if (strategy === "public_dir") {
    const base = process.env.PUBLIC_BASE_URL;
    if (!base) {
      throw new Error("PUBLIC_BASE_URL 未配置。在 .env 里设置后再试。");
    }
    const tplDir = ctx.template_id ?? "unknown";
    const destRel = `assets/templates/${tplDir}/keyframes/${ctx.task_id}.png`;
    const destAbs = path.resolve(process.cwd(), "../../public", destRel);
    fs.mkdirSync(path.dirname(destAbs), { recursive: true });
    fs.copyFileSync(localPath, destAbs);
    const url = `${base.replace(/\/$/, "")}/${destRel}`;
    console.log(kleur.green(`✓ 已拷贝到 ${destAbs}`));
    console.log(kleur.green(`  公网 URL: ${url}`));
    return url;
  }

  throw new Error(`unknown upload strategy: ${strategy}`);
}
