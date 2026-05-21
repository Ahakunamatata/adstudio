// ============================================================
// Studio Pipeline · 类型定义
// ============================================================
// 一个 workflow.json 描述一个 batch（典型 = 一个母模板的全部变体）
// 每个 task 是一个独立的生成动作（t2i 或 i2v）
// 任务之间通过 `depends_on` 串联（i2v 必须等 t2i 的 keyframe 就绪）

export type TaskStage = "t2i" | "i2v" | "t2v";

export type Model =
  // 文生图
  | "gpt-image-2-manual"     // 半自动：打印 prompt → 等你回填图
  // 图生视频 / 文生视频
  | "seedance-2.0"            // 默认 standard
  | "seedance-2.0-fast"       // fast 版
  | "seedance-2.0-fal";       // 通过 fal.ai 走

// 一条任务的输入
export interface TaskInput {
  /** 任务唯一 ID，建议格式 {母模板}-{变体}（如 M2-v2a） */
  id: string;
  /** 子任务后缀，用于一个变体同时跑多个阶段，如 "M2-v2a:keyframe" / "M2-v2a:motion" */
  step: "keyframe" | "motion";
  /** 该任务的阶段 */
  stage: TaskStage;
  /** 用哪个模型 */
  model: Model;
  /** prompt（已经 slot-rendered 的，或带 slot 占位） */
  prompt: string;
  /** 槽位变量；run 时会把 prompt 里的 {{slot}} 替换掉 */
  slots?: Record<string, string>;
  /** 依赖的其他任务（同 batch 内）；通常 motion 依赖 keyframe */
  depends_on?: string[];
  /** 输入图（i2v 必填）；可以是本地相对路径，runner 自动上传到公网；也可以直接是 URL */
  keyframe?: string;
  /** 生成参数 */
  params?: {
    aspect?: "9:16" | "16:9" | "4:5" | "1:1" | "21:9";
    duration_seconds?: number;    // Seedance: 4-15
    resolution?: "720p" | "1080p" | "2k";
    n_candidates?: number;        // 一次跑几条候选
  };
  /** 备注（人类看的） */
  notes?: string;
}

// 一个 batch 的输入
export interface Workflow {
  /** batch ID，用作 runs/{batch_id}/ 目录 */
  batch_id: string;
  /** 描述（人类看的） */
  description?: string;
  /** 该 batch 涉及的母模板，方便后续 commit 入库时找路径 */
  template_id?: string;
  /** 任务列表 */
  tasks: TaskInput[];
}

// --------- 运行时状态（持久化到 state.json） ---------

export type TaskStatus =
  | "pending"          // 还没开始
  | "waiting_upload"   // t2i 在等你回填图
  | "submitted"        // 已提交到 provider，task_id 已拿到
  | "running"          // provider 正在跑
  | "succeeded"        // 全部 N 条候选都跑完
  | "partially_failed" // N 条里有失败的
  | "failed"
  | "committed";       // 已选定 1 条入库

export interface CandidateResult {
  /** 候选序号 1..n */
  index: number;
  /** provider 返回的 task ID（可拿来追问 / 看额度） */
  provider_task_id: string;
  /** 本地落盘的文件相对路径 */
  local_path: string;
  /** provider 给的下载 URL（24h 内有效） */
  source_url?: string;
  /** 文件 hash，commit 时校验用 */
  sha256?: string;
}

export interface TaskState {
  id: string;
  step: "keyframe" | "motion";
  status: TaskStatus;
  /** 用于 t2i：你回填的图片路径（绝对或相对） */
  uploaded_image?: string;
  /** 用于 t2i：图片上传到公网后的 URL（i2v 用这个 URL 作为参考图） */
  uploaded_image_url?: string;
  /** 用于 i2v / t2v：N 条候选的结果 */
  candidates?: CandidateResult[];
  /** 最终被选中的候选 index（commit 后填） */
  chosen_index?: number;
  /** 错误信息（如有） */
  error?: string;
  /** 时间戳 */
  submitted_at?: string;
  succeeded_at?: string;
}

export interface BatchState {
  batch_id: string;
  template_id?: string;
  workflow_path: string;
  started_at: string;
  tasks: Record<string, TaskState>;  // key = `${id}:${step}`
}

// helper：构造 task 的 state key
export function stateKey(t: { id: string; step: "keyframe" | "motion" }): string {
  return `${t.id}:${t.step}`;
}
