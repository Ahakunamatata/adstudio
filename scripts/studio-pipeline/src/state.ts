// ============================================================
// 状态持久化：runs/{batch_id}/state.json
// ============================================================
// 设计原则：每个 task 操作后立即落盘，让 Ctrl+C 杀掉后能 resume

import fs from "node:fs";
import path from "node:path";
import type { BatchState, TaskState, Workflow } from "./types.js";
import { stateKey } from "./types.js";

const RUNS_ROOT = path.resolve(process.cwd(), "runs");

export function batchDir(batchId: string): string {
  return path.join(RUNS_ROOT, batchId);
}

export function statePath(batchId: string): string {
  return path.join(batchDir(batchId), "state.json");
}

/** 初始化一个全新 batch 的 state，或加载已有 */
export function initOrLoadState(wf: Workflow, workflowPath: string): BatchState {
  const sp = statePath(wf.batch_id);
  fs.mkdirSync(batchDir(wf.batch_id), { recursive: true });

  if (fs.existsSync(sp)) {
    const loaded = JSON.parse(fs.readFileSync(sp, "utf-8")) as BatchState;
    // 合并：如果 workflow 新增了 task，补上 pending 条目
    for (const t of wf.tasks) {
      const k = stateKey(t);
      if (!loaded.tasks[k]) {
        loaded.tasks[k] = {
          id: t.id,
          step: t.step,
          status: "pending",
        };
      }
    }
    save(loaded);
    return loaded;
  }

  const state: BatchState = {
    batch_id: wf.batch_id,
    template_id: wf.template_id,
    workflow_path: path.resolve(workflowPath),
    started_at: new Date().toISOString(),
    tasks: {},
  };
  for (const t of wf.tasks) {
    state.tasks[stateKey(t)] = {
      id: t.id,
      step: t.step,
      status: "pending",
    };
  }
  save(state);
  return state;
}

export function save(state: BatchState): void {
  const sp = statePath(state.batch_id);
  fs.writeFileSync(sp, JSON.stringify(state, null, 2));
}

export function updateTask(
  state: BatchState,
  key: string,
  patch: Partial<TaskState>
): void {
  state.tasks[key] = { ...state.tasks[key], ...patch };
  save(state);
}

/** 把 batch 目录下的相对路径转成绝对路径 */
export function resolveInBatch(batchId: string, ...parts: string[]): string {
  return path.join(batchDir(batchId), ...parts);
}
