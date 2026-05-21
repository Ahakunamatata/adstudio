#!/usr/bin/env node
// ============================================================
// Studio Pipeline CLI
// ============================================================
// 命令：
//   studio run <workflow.json>            跑一个 batch（断点续跑）
//   studio status <batch_id>              查看 batch 状态
//   studio review <batch_id> <task_id>    标记某 task 的某个候选为 chosen
//   studio commit <batch_id> [task_id]    把 chosen 候选拷贝到 public/assets 并打印入库指令
//   studio list                           列出所有 batch
//
// 注：所有命令都从仓库根的 scripts/studio-pipeline 目录执行
//     cd scripts/studio-pipeline && npm run studio -- <command> ...

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import kleur from "kleur";
import { runBatch } from "./runner.js";
import { initOrLoadState, batchDir, save, statePath } from "./state.js";
import type { Workflow, BatchState } from "./types.js";

const args = process.argv.slice(2);
const cmd = args[0];

async function main() {
  switch (cmd) {
    case "run":
      return cmdRun(args.slice(1));
    case "status":
      return cmdStatus(args.slice(1));
    case "review":
      return cmdReview(args.slice(1));
    case "commit":
      return cmdCommit(args.slice(1));
    case "list":
      return cmdList();
    case "help":
    case undefined:
      return printHelp();
    default:
      console.log(kleur.red(`unknown command: ${cmd}`));
      printHelp();
      process.exit(1);
  }
}

function printHelp(): void {
  console.log(
    kleur.bold("Studio Pipeline · 素材生成流水线"),
    "\n\n",
    "用法：\n",
    kleur.cyan("  studio run <workflow.json>"),
    "          跑一个 batch（断点续跑）\n",
    kleur.cyan("  studio status <batch_id>"),
    "             查看 batch 状态\n",
    kleur.cyan("  studio review <batch_id> <task_id>"),
    "    挑选某 task 的最佳候选\n",
    kleur.cyan("  studio commit <batch_id> [task_id]"),
    "    把 chosen 候选入库\n",
    kleur.cyan("  studio list"),
    "                         列出所有 batch\n"
  );
}

// ---------- run ----------

async function cmdRun(argv: string[]): Promise<void> {
  const wfPath = argv[0];
  if (!wfPath) {
    console.log(kleur.red("缺参数：studio run <workflow.json>"));
    process.exit(1);
  }
  if (!fs.existsSync(wfPath)) {
    console.log(kleur.red(`workflow 文件不存在：${wfPath}`));
    process.exit(1);
  }

  // 解析 CLI flags
  const onlyArg = argv.find((a) => a.startsWith("--only="));
  const only = onlyArg ? onlyArg.slice("--only=".length).split(",") : undefined;

  const stratArg = argv.find((a) => a.startsWith("--upload="));
  const upload_strategy = (stratArg
    ? stratArg.slice("--upload=".length)
    : "fal_storage") as "fal_storage" | "public_dir" | "manual_url";

  const wf: Workflow = JSON.parse(fs.readFileSync(wfPath, "utf-8"));
  const state = initOrLoadState(wf, wfPath);

  console.log(
    kleur.bold().cyan(`▶ Batch: ${wf.batch_id}`),
    kleur.dim(`(${Object.keys(state.tasks).length} tasks)`)
  );
  console.log(kleur.dim(`workflow: ${wfPath}`));
  console.log(
    kleur.dim(`provider: ${process.env.VIDEO_PROVIDER ?? "ark"}, upload: ${upload_strategy}`)
  );
  if (only) console.log(kleur.dim(`only: ${only.join(",")}`));

  await runBatch(wf, state, { only, upload_strategy });
}

// ---------- status ----------

function loadState(batchId: string): BatchState {
  const sp = statePath(batchId);
  if (!fs.existsSync(sp)) {
    console.log(kleur.red(`batch ${batchId} 不存在`));
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(sp, "utf-8"));
}

async function cmdStatus(argv: string[]): Promise<void> {
  const id = argv[0];
  if (!id) {
    console.log(kleur.red("缺参数：studio status <batch_id>"));
    process.exit(1);
  }
  const state = loadState(id);
  console.log(kleur.bold().cyan(`Batch: ${state.batch_id}`));
  console.log(kleur.dim(`started: ${state.started_at}`));
  console.log("");

  const rows = Object.entries(state.tasks).map(([k, t]) => {
    const color =
      t.status === "succeeded" || t.status === "committed"
        ? kleur.green
        : t.status === "failed"
        ? kleur.red
        : kleur.yellow;
    const extra = t.candidates
      ? ` (${t.candidates.length} cands${
          t.chosen_index ? `, chosen=c${t.chosen_index}` : ""
        })`
      : t.uploaded_image_url
      ? ` (img ok)`
      : "";
    return `  ${k.padEnd(28)}  ${color(t.status)}${kleur.dim(extra)}`;
  });
  console.log(rows.join("\n"));
}

// ---------- review ----------

async function cmdReview(argv: string[]): Promise<void> {
  const [batchId, taskKey, chosenStr] = argv;
  if (!batchId || !taskKey) {
    console.log(kleur.red("用法：studio review <batch_id> <task_id> <候选index>"));
    console.log(kleur.dim("       例：studio review M2-full-2026-05-21 M2-v2a:motion 2"));
    console.log(
      kleur.dim("       不传 <候选index> 时只列出所有候选，让你看着挑")
    );
    process.exit(1);
  }
  const state = loadState(batchId);
  const t = state.tasks[taskKey];
  if (!t) {
    console.log(kleur.red(`task ${taskKey} 不在 batch ${batchId} 里`));
    process.exit(1);
  }
  if (!t.candidates?.length) {
    console.log(kleur.red(`task ${taskKey} 还没有候选`));
    process.exit(1);
  }

  if (!chosenStr) {
    console.log(kleur.bold(`候选列表（${taskKey}）：`));
    for (const c of t.candidates) {
      const abs = path.join(batchDir(batchId), c.local_path);
      console.log(
        `  c${c.index}: ${kleur.cyan(abs)} (${
          fs.existsSync(abs)
            ? `${(fs.statSync(abs).size / 1024 / 1024).toFixed(2)} MB`
            : "missing"
        })`
      );
    }
    console.log("");
    console.log(
      kleur.dim(`挑好后跑：studio review ${batchId} ${taskKey} <index>`)
    );
    return;
  }

  const chosen = Number(chosenStr);
  if (!t.candidates.find((c) => c.index === chosen)) {
    console.log(kleur.red(`candidate index ${chosen} 不存在`));
    process.exit(1);
  }
  t.chosen_index = chosen;
  save(state);
  console.log(kleur.green(`✓ ${taskKey} chosen = c${chosen}`));
  console.log(kleur.dim(`接下来：studio commit ${batchId} ${taskKey}`));
}

// ---------- commit ----------

async function cmdCommit(argv: string[]): Promise<void> {
  const [batchId, onlyTask] = argv;
  if (!batchId) {
    console.log(kleur.red("用法：studio commit <batch_id> [task_id]"));
    process.exit(1);
  }
  const state = loadState(batchId);
  const targets = Object.entries(state.tasks).filter(([k, t]) => {
    if (onlyTask && k !== onlyTask) return false;
    return t.chosen_index != null && t.status !== "committed";
  });
  if (!targets.length) {
    console.log(
      kleur.yellow(
        "没有可 commit 的任务（需要先 studio review 挑出 chosen）"
      )
    );
    return;
  }

  // 把 chosen 视频拷贝到 adstudio/public/assets/templates/{template_id}/videos/{task_id}.mp4
  const templateId = state.template_id ?? "unknown";
  const publicRoot = path.resolve(process.cwd(), "../../public");
  const videosDir = path.join(
    publicRoot,
    "assets/templates",
    templateId,
    "videos"
  );
  fs.mkdirSync(videosDir, { recursive: true });

  for (const [k, t] of targets) {
    const cand = t.candidates!.find((c) => c.index === t.chosen_index);
    if (!cand) continue;
    const src = path.join(batchDir(batchId), cand.local_path);
    const variantId = t.id.split("-").slice(-1)[0]; // M2-v2a → v2a
    const dest = path.join(videosDir, `${variantId}.mp4`);
    fs.copyFileSync(src, dest);
    t.status = "committed";
    console.log(
      kleur.green(`✓ ${k} → ${path.relative(process.cwd(), dest)}`)
    );
  }
  save(state);

  console.log("");
  console.log(kleur.bold("下一步（手动）："));
  console.log(
    kleur.dim(
      `  打开 src/lib/mock-data/templates.ts，在对应模板的 previewVideo 字段填：\n` +
        `  /assets/templates/${templateId}/videos/{variantId}.mp4`
    )
  );
}

// ---------- list ----------

async function cmdList(): Promise<void> {
  const runsRoot = path.resolve(process.cwd(), "runs");
  if (!fs.existsSync(runsRoot)) {
    console.log(kleur.dim("还没有任何 batch"));
    return;
  }
  const dirs = fs.readdirSync(runsRoot).filter((d) => {
    return fs.existsSync(path.join(runsRoot, d, "state.json"));
  });
  if (!dirs.length) {
    console.log(kleur.dim("还没有任何 batch"));
    return;
  }
  for (const d of dirs) {
    const state = JSON.parse(
      fs.readFileSync(path.join(runsRoot, d, "state.json"), "utf-8")
    ) as BatchState;
    const counts: Record<string, number> = {};
    for (const t of Object.values(state.tasks)) {
      counts[t.status] = (counts[t.status] ?? 0) + 1;
    }
    const summary = Object.entries(counts)
      .map(([s, n]) => `${s}:${n}`)
      .join(" · ");
    console.log(`${kleur.cyan(d)}  ${kleur.dim(summary)}`);
  }
}

main().catch((e) => {
  console.error(kleur.red(`✗ ${e.message}`));
  if (process.env.DEBUG) console.error(e.stack);
  process.exit(1);
});
