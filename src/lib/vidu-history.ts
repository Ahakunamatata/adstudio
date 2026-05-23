import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GenerationKind, GenerationTask } from "@/features/generation/types";
import { getViduTask, type ViduTaskResult } from "@/lib/vidu";

type ViduHistory = Record<GenerationKind, GenerationTask[]>;

const historyFilePath = path.join(process.cwd(), ".next", "cache", "ad-studio-vidu-history.json");

const emptyHistory: ViduHistory = {
  video: [],
  image: []
};

const seededTasks: ViduHistory = {
  video: [
    {
      id: "vidu-seed-953476036895469568",
      kind: "video",
      surface: "standalone",
      prompt:
        "Reference-based 5s vertical app ad video: use the provided app screenshot as the product anchor, show a parent opening a family locator app, route card animates in, late-arrival alert appears, warm home lighting, handheld close-up, clean UI, clear CTA space.",
      modelId: "viduq3-turbo",
      modelName: "Vidu Q3 Turbo",
      modeKey: "reference",
      modeLabel: "参考生",
      params: {
        ratio: "9:16",
        duration: "5s",
        quality: "720p",
        motion: "balanced",
        camera: "handheld",
        internal_source: "standalone"
      },
      slots: [
        {
          id: "vidu-seed-video-ref",
          slotKey: "reference_image",
          kind: "image",
          label: "参考图",
          fileName: "reference-1.png",
          previewUrl: "/assets/example-family-locator.png",
          status: "uploaded"
        },
        {
          id: "vidu-seed-video-product",
          slotKey: "product_image",
          kind: "image",
          label: "产品图",
          fileName: "product-1.png",
          previewUrl: "/assets/example-family-locator.png",
          status: "uploaded"
        }
      ],
      status: "succeeded",
      progress: 100,
      credits: 50,
      createdAt: "2026-05-17 14:06",
      durationLabel: "73s",
      providerTaskId: "953476036895469568",
      output: {
        kind: "video",
        title: "Video draft",
        ratio: "9:16"
      },
      context: {
        surface: "standalone"
      }
    }
  ],
  image: [
    {
      id: "vidu-seed-953477089795784704",
      kind: "image",
      surface: "standalone",
      prompt:
        "Create a polished mobile app install ad image from the provided app screenshot. Keep the product UI readable, premium clean composition, bright trust-focused family safety mood, vertical 3:4 layout, clear empty CTA area, no extra text.",
      modelId: "viduq2",
      modelName: "Vidu Q2 Image",
      modeKey: "image-reference",
      modeLabel: "参考生图",
      params: {
        ratio: "3:4",
        resolution: "1080p",
        internal_source: "standalone"
      },
      slots: [
        {
          id: "vidu-seed-image-product",
          slotKey: "reference_image",
          kind: "image",
          label: "参考图",
          fileName: "product-1.png",
          previewUrl: "/assets/example-family-locator.png",
          status: "uploaded"
        }
      ],
      status: "succeeded",
      progress: 100,
      credits: 12,
      createdAt: "2026-05-17 14:10",
      durationLabel: "46s",
      providerTaskId: "953477089795784704",
      output: {
        kind: "image",
        title: "Image draft",
        ratio: "3:4"
      },
      context: {
        surface: "standalone"
      }
    }
  ]
};

function isGenerationKind(value: string): value is GenerationKind {
  return value === "video" || value === "image";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isGenerationTask(value: unknown): value is GenerationTask {
  const record = isRecord(value) ? value : {};
  return typeof record.id === "string" && (record.kind === "video" || record.kind === "image") && typeof record.prompt === "string";
}

function isViduHistoryTask(value: unknown): value is GenerationTask {
  if (!isGenerationTask(value)) return false;
  return Boolean(value.providerTaskId) || value.modelId.startsWith("vidu");
}

function parseHistory(value: unknown): ViduHistory {
  const record = isRecord(value) ? value : {};
  return {
    video: Array.isArray(record.video) ? record.video.filter(isViduHistoryTask) : [],
    image: Array.isArray(record.image) ? record.image.filter(isViduHistoryTask) : []
  };
}

async function readStoredHistoryFile(): Promise<ViduHistory> {
  try {
    return parseHistory(JSON.parse(await readFile(historyFilePath, "utf8")));
  } catch {
    return emptyHistory;
  }
}

async function writeStoredHistoryFile(history: ViduHistory) {
  await mkdir(path.dirname(historyFilePath), { recursive: true });
  await writeFile(historyFilePath, JSON.stringify(history, null, 2));
}

function taskKey(task: GenerationTask) {
  return task.providerTaskId ? `provider:${task.providerTaskId}` : `local:${task.id}`;
}

function mergeTasks(base: GenerationTask[], incoming: GenerationTask[]) {
  const merged = new Map<string, GenerationTask>();
  for (const task of base) {
    merged.set(taskKey(task), task);
  }
  for (const task of incoming) {
    const existing = merged.get(taskKey(task));
    merged.set(taskKey(task), existing ? { ...existing, ...task, output: { ...existing.output, ...task.output } } : task);
  }
  return Array.from(merged.values());
}

function taskOutput(kind: GenerationKind, task: ViduTaskResult) {
  const creation = task.creations[0];
  if (!creation) return {};

  if (kind === "video") {
    return {
      assetUrl: creation.coverUrl,
      downloadUrl: creation.url ?? creation.watermarkedUrl
    };
  }

  return {
    assetUrl: creation.url,
    downloadUrl: creation.url ?? creation.watermarkedUrl
  };
}

function taskStatus(state: string): GenerationTask["status"] {
  if (state === "success") return "succeeded";
  if (state === "failed") return "failed";
  if (state === "created" || state === "queueing") return "queued";
  return "running";
}

async function refreshTask(task: GenerationTask): Promise<GenerationTask> {
  if (!task.providerTaskId) return task;

  try {
    const viduTask = await getViduTask(task.providerTaskId);
    const status = taskStatus(viduTask.state);
    return {
      ...task,
      status,
      progress: status === "succeeded" || status === "failed" ? 100 : task.progress,
      credits: viduTask.credits ?? task.credits,
      errorMessage: status === "failed" ? viduTask.errCode || task.errorMessage : undefined,
      output: {
        ...task.output,
        ...taskOutput(task.kind, viduTask)
      }
    };
  } catch {
    return task;
  }
}

async function refreshHistory(history: ViduHistory): Promise<ViduHistory> {
  return {
    video: await Promise.all(history.video.map(refreshTask)),
    image: await Promise.all(history.image.map(refreshTask))
  };
}

export async function getLocalViduHistory() {
  const storedHistory = await readStoredHistoryFile();
  const mergedHistory = {
    video: mergeTasks(seededTasks.video, storedHistory.video),
    image: mergeTasks(seededTasks.image, storedHistory.image)
  };
  const refreshedHistory = await refreshHistory(mergedHistory);
  await writeStoredHistoryFile(refreshedHistory);
  return refreshedHistory;
}

export async function saveLocalViduHistory(input: unknown) {
  const record = isRecord(input) ? input : {};
  const storedHistory = await readStoredHistoryFile();

  let nextHistory = storedHistory;
  for (const [kind, value] of Object.entries(record)) {
    if (!isGenerationKind(kind) || !Array.isArray(value)) continue;
    nextHistory = {
      ...nextHistory,
      [kind]: mergeTasks(nextHistory[kind], value.filter(isViduHistoryTask))
    };
  }

  await writeStoredHistoryFile(nextHistory);
  return nextHistory;
}
