// ============================================================
// 任务编排器
// ============================================================
// 职责：
//   1. 按 depends_on 拓扑排序
//   2. 跳过已 succeeded / committed 的任务
//   3. 对每个任务调对应 adapter
//   4. i2v 类型自动展开成 N 条候选并行跑
//   5. 错误隔离：单个 task 挂掉不影响其他 task

import fs from "node:fs";
import path from "node:path";
import kleur from "kleur";
import type {
  BatchState,
  CandidateResult,
  TaskInput,
  Workflow,
} from "./types.js";
import { stateKey } from "./types.js";
import { resolveInBatch, save, updateTask } from "./state.js";
import { findUnfilledSlots, renderPrompt } from "./slot-render.js";
import {
  runI2V,
  downloadVideo,
  type FalSeedanceInput,
} from "./adapters/seedance-fal.js";
import {
  uploadKeyframe,
  waitForKeyframe,
} from "./adapters/gpt-image-manual.js";

const VIDEO_PROVIDER = (process.env.VIDEO_PROVIDER ?? "fal") as "fal" | "ark";
const N_DEFAULT = Number(process.env.DEFAULT_N_CANDIDATES) || 4;

export type UploadStrategy = "fal_storage" | "public_dir" | "manual_url";

export interface RunOptions {
  only?: string[];
  upload_strategy?: UploadStrategy;
}

export async function runBatch(
  wf: Workflow,
  state: BatchState,
  opts: RunOptions = {}
): Promise<void> {
  if (VIDEO_PROVIDER === "ark") {
    throw new Error(
      "Ark provider 尚未在新 adapter 接入。请用 VIDEO_PROVIDER=fal。"
    );
  }

  const order = topoSort(wf.tasks);
  const uploadStrategy: UploadStrategy = opts.upload_strategy ?? "fal_storage";

  for (const task of order) {
    if (opts.only && !opts.only.includes(task.id)) continue;

    const key = stateKey(task);
    const ts = state.tasks[key];
    if (ts && (ts.status === "succeeded" || ts.status === "committed")) {
      console.log(kleur.dim(`⊙ skip ${key} (already ${ts.status})`));
      continue;
    }

    const blocked = (task.depends_on ?? []).filter((dep) => {
      const ds = state.tasks[dep];
      return !ds || (ds.status !== "succeeded" && ds.status !== "committed");
    });
    if (blocked.length > 0) {
      console.log(
        kleur.yellow(`⌛ ${key} blocked by ${blocked.join(", ")}, skipping`)
      );
      continue;
    }

    console.log("");
    console.log(kleur.bold(`▶ Running ${key} (${task.stage} · ${task.model})`));

    try {
      if (task.stage === "t2i") {
        await runT2I(task, state, wf, uploadStrategy);
      } else if (task.stage === "i2v" || task.stage === "t2v") {
        await runVideo(task, state, wf);
      } else {
        throw new Error(`Unknown stage: ${task.stage}`);
      }
    } catch (err: any) {
      console.log(kleur.red(`✗ ${key} failed: ${err.message}`));
      updateTask(state, key, {
        status: "failed",
        error: err.message,
      });
    }
  }

  console.log("");
  console.log(kleur.bold().green("Batch finished."));
  printSummary(state);
}

async function runT2I(
  task: TaskInput,
  state: BatchState,
  wf: Workflow,
  uploadStrategy: UploadStrategy
): Promise<void> {
  const key = stateKey(task);
  const expected = resolveInBatch(wf.batch_id, task.id, "keyframe.png");
  fs.mkdirSync(path.dirname(expected), { recursive: true });

  const prompt = renderPrompt(task.prompt, task.slots);
  const unfilled = findUnfilledSlots(prompt);
  if (unfilled.length > 0) {
    throw new Error(`prompt 还有未填的 slot: ${unfilled.join(", ")}`);
  }

  updateTask(state, key, { status: "waiting_upload" });
  const { local_path } = await waitForKeyframe({
    task_id: task.id,
    prompt,
    expected_path: expected,
    upload_strategy: uploadStrategy,
  });

  const publicUrl = await uploadKeyframe(local_path, uploadStrategy, {
    batch_id: wf.batch_id,
    task_id: task.id,
    template_id: wf.template_id,
  });

  updateTask(state, key, {
    status: "succeeded",
    uploaded_image: local_path,
    uploaded_image_url: publicUrl,
    succeeded_at: new Date().toISOString(),
  });
  console.log(kleur.green(`✓ ${key} → ${publicUrl}`));
}

async function runVideo(
  task: TaskInput,
  state: BatchState,
  wf: Workflow
): Promise<void> {
  const key = stateKey(task);
  const n = task.params?.n_candidates ?? N_DEFAULT;

  let imageUrl: string | undefined;
  if (task.stage === "i2v") {
    const kfKey = (task.depends_on ?? []).find((d) => d.endsWith(":keyframe"));
    if (kfKey && state.tasks[kfKey]?.uploaded_image_url) {
      imageUrl = state.tasks[kfKey].uploaded_image_url;
    } else if (task.keyframe?.startsWith("http")) {
      imageUrl = task.keyframe;
    } else {
      throw new Error(
        `i2v ${key} 找不到 keyframe URL。要么 depends_on 已有 t2i task，要么 keyframe 字段填一个 http URL`
      );
    }
  }

  const prompt = renderPrompt(task.prompt, task.slots);
  const unfilled = findUnfilledSlots(prompt);
  if (unfilled.length > 0) {
    throw new Error(`prompt 还有未填的 slot: ${unfilled.join(", ")}`);
  }

  const candDir = resolveInBatch(wf.batch_id, task.id, "candidates");
  fs.mkdirSync(candDir, { recursive: true });

  updateTask(state, key, {
    status: "submitted",
    submitted_at: new Date().toISOString(),
  });

  console.log(kleur.dim(`  submitting ${n} candidates via fal...`));

  // 把 task.params 翻译成 fal 的参数
  const falInput: Omit<FalSeedanceInput, "seed"> = {
    prompt,
    image_url: imageUrl!,
    aspect_ratio: (task.params?.aspect ?? "9:16") as any,
    duration: String(task.params?.duration_seconds ?? 10) as any,
    resolution:
      task.params?.resolution === "1080p"
        ? "720p" // fal 不支持 1080p，自动降到 720p（warn）
        : ((task.params?.resolution ?? "720p") as "480p" | "720p"),
    generate_audio: false, // TVC 默认无人声
  };

  if (task.params?.resolution === "1080p") {
    console.log(
      kleur.yellow(
        `  ⚠ workflow 写了 1080p，但 fal 只支持 480p/720p，已自动降到 720p`
      )
    );
  }

  // 并发跑 N 条候选（不同 seed），用 Promise.allSettled 防止一条挂掉拖全部
  const runs = await Promise.allSettled(
    Array.from({ length: n }, async (_, i) => {
      const seed = Math.floor(Math.random() * 1_000_000);
      const idx = i + 1;
      const onLog = (m: string) => {
        // 用 \r 在同一行刷新更友好，但多 candidate 并发会乱，所以加前缀
        process.stdout.write(kleur.dim(`  · c${idx}: ${m}\n`));
      };
      const result = await runI2V({ ...falInput, seed }, onLog);
      const local = path.join(candDir, `c${idx}.mp4`);
      await downloadVideo(result.video_url, local);
      return {
        index: idx,
        provider_task_id: result.request_id,
        source_url: result.video_url,
        local_path: path.relative(resolveInBatch(wf.batch_id), local),
      } satisfies CandidateResult;
    })
  );

  const candidates: CandidateResult[] = [];
  runs.forEach((r, i) => {
    if (r.status === "fulfilled") {
      candidates.push(r.value);
      console.log(
        kleur.green(`  ✓ c${r.value.index} → ${r.value.local_path}`)
      );
    } else {
      console.log(
        kleur.red(`  ✗ c${i + 1} failed: ${(r.reason as Error).message}`)
      );
    }
  });

  if (candidates.length === 0) throw new Error("all candidates failed");

  const allOk = candidates.length === n;
  updateTask(state, key, {
    status: allOk ? "succeeded" : "partially_failed",
    candidates,
    succeeded_at: new Date().toISOString(),
  });
}

// ----- 工具函数 -----

function topoSort(tasks: TaskInput[]): TaskInput[] {
  const byKey = new Map(tasks.map((t) => [stateKey(t), t]));
  const visited = new Set<string>();
  const order: TaskInput[] = [];
  const visit = (k: string, stack: Set<string>): void => {
    if (visited.has(k)) return;
    if (stack.has(k)) throw new Error(`cycle at ${k}`);
    stack.add(k);
    const t = byKey.get(k);
    if (!t) throw new Error(`unknown task ${k}`);
    for (const dep of t.depends_on ?? []) visit(dep, stack);
    stack.delete(k);
    visited.add(k);
    order.push(t);
  };
  for (const t of tasks) visit(stateKey(t), new Set());
  return order;
}

function printSummary(state: BatchState): void {
  const counts: Record<string, number> = {};
  for (const t of Object.values(state.tasks)) {
    counts[t.status] = (counts[t.status] ?? 0) + 1;
  }
  console.log(kleur.bold("Summary:"));
  for (const [s, n] of Object.entries(counts)) {
    const color =
      s === "succeeded" || s === "committed"
        ? kleur.green
        : s === "failed"
        ? kleur.red
        : kleur.yellow;
    console.log(`  ${color(s)}: ${n}`);
  }
  console.log("");
  console.log(kleur.dim(`State file: runs/${state.batch_id}/state.json`));
}
