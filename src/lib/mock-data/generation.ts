import type {
  GenerationCatalog,
  GenerationKind,
  GenerationMode,
  GenerationModeKey,
  GenerationModel,
  GenerationParam,
  GenerationParamValue,
  GenerationSlot,
  GenerationSlotKey,
  GenerationSlotInput,
  GenerationState
} from "@/features/generation/types";

const videoModes: GenerationMode[] = [
  {
    key: "text-to-video",
    kind: "video",
    label: "文生视频",
    shortLabel: "Text",
    description: "只用 prompt 生成完整广告视频，可选绑定产品图作为品牌参考。",
    allowPromptOnly: true,
    slotKeys: ["product_image"],
    paramIds: ["ratio", "duration", "quality", "motion", "camera", "seed", "internal_source"]
  },
  {
    key: "image-to-video",
    kind: "video",
    label: "图生视频",
    shortLabel: "I2V",
    description: "使用一张首帧或产品图生成广告动态镜头。",
    allowPromptOnly: false,
    slotKeys: ["start_frame", "product_image"],
    paramIds: ["ratio", "duration", "quality", "motion", "camera", "seed", "internal_source"]
  },
  {
    key: "first-last-frame",
    kind: "video",
    label: "首尾帧",
    shortLabel: "F/L",
    description: "用首帧和尾帧控制镜头起止状态，适合商品演示和 App Demo。",
    allowPromptOnly: false,
    slotKeys: ["start_frame", "end_frame", "product_image"],
    paramIds: ["ratio", "duration", "quality", "motion", "camera", "seed", "internal_source"]
  },
  {
    key: "reference",
    kind: "video",
    label: "参考生",
    shortLabel: "Ref",
    description: "用参考图或参考视频约束人物、场景、动作和广告风格。",
    allowPromptOnly: false,
    slotKeys: ["reference_image", "reference_video", "product_image"],
    paramIds: ["ratio", "duration", "quality", "motion", "camera", "seed", "internal_source"]
  }
];

const imageModes: GenerationMode[] = [
  {
    key: "text-to-image",
    kind: "image",
    label: "文生图",
    shortLabel: "Text",
    description: "用 prompt 生成广告图，可选上传参考图数组。",
    allowPromptOnly: true,
    slotKeys: ["reference_image"],
    paramIds: ["ratio", "resolution", "seed", "internal_source"]
  },
  {
    key: "image-reference",
    kind: "image",
    label: "参考生图",
    shortLabel: "Ref",
    description: "用参考图数组生成可投放广告图片。",
    allowPromptOnly: false,
    slotKeys: ["reference_image"],
    paramIds: ["ratio", "resolution", "seed", "internal_source"]
  }
];

const videoSlots: GenerationSlot[] = [
  {
    key: "reference_image",
    kind: "image",
    label: "参考图",
    shortLabel: "Ref",
    min: 0,
    max: 6,
    description: "人物、场景、构图或广告风格参考图。"
  },
  {
    key: "reference_video",
    kind: "video",
    label: "参考视频",
    shortLabel: "Video",
    min: 0,
    max: 2,
    description: "竞品节奏、动作或镜头运动参考视频。"
  },
  {
    key: "start_frame",
    kind: "image",
    label: "首帧",
    shortLabel: "Start",
    min: 0,
    max: 1,
    description: "视频镜头开始画面，适合图生视频。"
  },
  {
    key: "end_frame",
    kind: "image",
    label: "尾帧",
    shortLabel: "End",
    min: 0,
    max: 1,
    description: "视频镜头结束画面，用于首尾帧控制。"
  },
  {
    key: "product_image",
    kind: "image",
    label: "产品图",
    shortLabel: "Product",
    min: 0,
    max: 6,
    description: "商品、App UI、Logo 或包装图，帮助保持品牌一致。"
  }
];

const imageSlots: GenerationSlot[] = [
  {
    key: "reference_image",
    kind: "image",
    label: "参考图",
    shortLabel: "Ref",
    min: 0,
    max: 7,
    description: "传给 Vidu reference2image 的 images 数组，可放产品、人物、风格或 App 截图。"
  }
];

const videoParams: GenerationParam[] = [
  {
    id: "ratio",
    label: "比例",
    component: "select",
    visibility: "basic",
    required: true,
    defaultValue: "9:16",
    options: [
      { label: "9:16", value: "9:16" },
      { label: "1:1", value: "1:1" },
      { label: "16:9", value: "16:9" }
    ]
  },
  {
    id: "duration",
    label: "时长",
    component: "select",
    visibility: "basic",
    required: true,
    defaultValue: "15s",
    options: [
      { label: "5s", value: "5s" },
      { label: "6s", value: "6s" },
      { label: "10s", value: "10s" },
      { label: "15s", value: "15s" }
    ]
  },
  {
    id: "quality",
    label: "清晰度",
    component: "select",
    visibility: "basic",
    required: true,
    defaultValue: "1080p",
    options: [
      { label: "540p", value: "540p" },
      { label: "720p", value: "720p" },
      { label: "1080p", value: "1080p" }
    ]
  },
  {
    id: "motion",
    label: "运动强度",
    component: "select",
    visibility: "advanced",
    required: false,
    defaultValue: "balanced",
    options: [
      { label: "克制", value: "low" },
      { label: "均衡", value: "balanced" },
      { label: "强动态", value: "high" }
    ]
  },
  {
    id: "camera",
    label: "镜头",
    component: "select",
    visibility: "advanced",
    required: false,
    defaultValue: "auto",
    options: [
      { label: "Auto", value: "auto" },
      { label: "Handheld", value: "handheld" },
      { label: "Push in", value: "push-in" },
      { label: "Static", value: "static" }
    ]
  },
  {
    id: "seed",
    label: "Seed",
    component: "number",
    visibility: "advanced",
    required: false,
    min: 0,
    max: 999999,
    step: 1,
    helper: "留空时使用随机 seed。"
  },
  {
    id: "internal_source",
    label: "Internal Source",
    component: "text",
    visibility: "internal",
    required: false,
    defaultValue: "ad-studio-generation-composer"
  }
];

const imageParams: GenerationParam[] = [
  {
    id: "ratio",
    label: "比例",
    modelIds: ["viduq2"],
    component: "select",
    visibility: "basic",
    required: true,
    defaultValue: "3:4",
    options: [
      { label: "1:1", value: "1:1" },
      { label: "3:4", value: "3:4" },
      { label: "4:3", value: "4:3" },
      { label: "9:16", value: "9:16" },
      { label: "16:9", value: "16:9" },
      { label: "21:9", value: "21:9" },
      { label: "2:3", value: "2:3" },
      { label: "3:2", value: "3:2" },
      { label: "Auto", value: "auto" }
    ]
  },
  {
    id: "ratio",
    label: "比例",
    modelIds: ["viduq1"],
    component: "select",
    visibility: "basic",
    required: true,
    defaultValue: "1:1",
    options: [
      { label: "1:1", value: "1:1" },
      { label: "3:4", value: "3:4" },
      { label: "4:3", value: "4:3" },
      { label: "9:16", value: "9:16" },
      { label: "16:9", value: "16:9" }
    ]
  },
  {
    id: "resolution",
    label: "分辨率",
    modelIds: ["viduq2"],
    component: "select",
    visibility: "basic",
    required: true,
    defaultValue: "1080p",
    options: [
      { label: "1080p", value: "1080p" },
      { label: "2K", value: "2K" },
      { label: "4K", value: "4K" }
    ]
  },
  {
    id: "seed",
    label: "Seed",
    component: "number",
    visibility: "advanced",
    required: false,
    min: 0,
    max: 999999,
    step: 1,
    helper: "留空时使用随机 seed。"
  },
  {
    id: "internal_source",
    label: "Internal Source",
    component: "text",
    visibility: "internal",
    required: false,
    defaultValue: "ad-studio-generation-composer"
  }
];

const videoModels: GenerationModel[] = [
  {
    id: "viduq3-turbo",
    kind: "video",
    displayName: "Vidu Q3 Turbo",
    provider: "Vidu",
    description: "Vidu Q3 快速视频模型，优先用于文生视频、图生视频、首尾帧和参考生视频流程跑通。",
    defaultForKind: true,
    defaultModeKey: "text-to-video",
    modeKeys: ["text-to-video", "image-to-video", "first-last-frame", "reference"],
    slotKeys: ["reference_image", "reference_video", "start_frame", "end_frame", "product_image"],
    paramIds: ["ratio", "duration", "quality", "motion", "camera", "seed", "internal_source"],
    defaults: {
      ratio: "9:16",
      duration: "5s",
      quality: "720p",
      motion: "balanced",
      camera: "handheld",
      internal_source: "standalone"
    },
    credits: {
      base: 18,
      multipliers: {
        duration: { "5s": 0.75, "6s": 0.8, "10s": 1, "15s": 1.45 },
        quality: { "540p": 0.8, "720p": 1, "1080p": 1.35 }
      }
    }
  },
  {
    id: "viduq3-pro",
    kind: "video",
    displayName: "Vidu Q3 Pro",
    provider: "Vidu",
    description: "Vidu Q3 高质量视频模型，适合需要更稳定质感的广告短片。",
    defaultModeKey: "text-to-video",
    modeKeys: ["text-to-video", "image-to-video", "first-last-frame", "reference"],
    slotKeys: ["reference_image", "reference_video", "start_frame", "end_frame", "product_image"],
    paramIds: ["ratio", "duration", "quality", "motion", "camera", "seed", "internal_source"],
    defaults: {
      ratio: "9:16",
      duration: "10s",
      quality: "1080p",
      motion: "balanced",
      camera: "handheld",
      internal_source: "standalone"
    },
    credits: {
      base: 24,
      multipliers: {
        duration: { "5s": 0.7, "6s": 0.78, "10s": 1, "15s": 1.4 },
        quality: { "540p": 0.75, "720p": 0.95, "1080p": 1.25 }
      }
    }
  }
];

const imageModels: GenerationModel[] = [
  {
    id: "viduq2",
    kind: "image",
    displayName: "Vidu Q2 Image",
    provider: "Vidu",
    description: "Vidu Q2 图片模型，支持文生图、参考生图和图片编辑。",
    defaultForKind: true,
    defaultModeKey: "text-to-image",
    modeKeys: ["text-to-image", "image-reference"],
    slotKeys: ["reference_image"],
    paramIds: ["ratio", "resolution", "seed", "internal_source"],
    defaults: {
      ratio: "3:4",
      resolution: "1080p",
      internal_source: "standalone"
    },
    credits: {
      base: 8,
      multipliers: {
        resolution: { "1080p": 1, "2K": 1.25, "4K": 1.75 }
      }
    }
  },
  {
    id: "viduq1",
    kind: "image",
    displayName: "Vidu Q1 Image",
    provider: "Vidu",
    description: "Vidu Q1 图片模型，保留为参考生图备用通道。",
    defaultModeKey: "image-reference",
    modeKeys: ["image-reference"],
    slotKeys: ["reference_image"],
    paramIds: ["ratio", "seed", "internal_source"],
    defaults: {
      ratio: "1:1",
      internal_source: "standalone"
    },
    credits: {
      base: 7,
      multipliers: {}
    }
  }
];

export function createMockGenerationSlotInput(kind: GenerationKind, slotKey: GenerationSlotKey, index = 0): GenerationSlotInput | null {
  const slots = kind === "video" ? videoSlots : imageSlots;
  const slot = slots.find((item) => item.key === slotKey);
  if (!slot) return null;

  return {
    id: `mock-${kind}-${slotKey}-${Date.now()}-${index}`,
    slotKey,
    kind: slot.kind,
    label: slot.label,
    fileName: `${slot.shortLabel.toLowerCase()} reference`,
    previewUrl: slot.kind === "video" ? "/assets/asset-competitor-video.png" : "/assets/asset-app-ui.png",
    status: "referenced"
  };
}

export const generationDefaults: Record<GenerationKind, GenerationCatalog> = {
  video: {
    kind: "video",
    label: "Ad Video",
    taskLabel: "视频生成",
    historyEmpty: "从底部 composer 开始一次新的视频生成。",
    placeholder: "描述视频主体、产品、镜头、节奏、文案区域、比例和投放场景。",
    models: videoModels,
    modes: videoModes,
    slots: videoSlots,
    params: videoParams,
    mockTasks: []
  },
  image: {
    kind: "image",
    label: "Ad Image",
    taskLabel: "图像生成",
    historyEmpty: "从底部 composer 开始一次新的图片生成。",
    placeholder: "描述图片主体、产品、构图、文案区域、比例、质感和投放渠道。",
    models: imageModels,
    modes: imageModes,
    slots: imageSlots,
    params: imageParams,
    mockTasks: []
  }
};

export function getDefaultGenerationModel(kind: GenerationKind) {
  const catalog = generationDefaults[kind];
  return catalog.models.find((model) => model.defaultForKind) ?? catalog.models[0];
}

export function getGenerationModel(kind: GenerationKind, modelId: string) {
  return generationDefaults[kind].models.find((model) => model.id === modelId) ?? getDefaultGenerationModel(kind);
}

export function getGenerationMode(kind: GenerationKind, modeKey: GenerationModeKey) {
  const catalog = generationDefaults[kind];
  const model = getDefaultGenerationModel(kind);
  return catalog.modes.find((mode) => mode.key === modeKey) ?? catalog.modes.find((mode) => mode.key === model.defaultModeKey) ?? catalog.modes[0];
}

function paramMatchesModel(param: GenerationParam, model: GenerationModel) {
  return !param.modelIds?.length || param.modelIds.includes(model.id);
}

export function getDefaultGenerationParamValues(model: GenerationModel) {
  const values: Record<string, GenerationParamValue> = { ...model.defaults };
  for (const paramId of model.paramIds) {
    const param = [...videoParams, ...imageParams].find((item) => item.id === paramId && paramMatchesModel(item, model));
    if (param?.defaultValue !== undefined && values[paramId] === undefined) {
      values[paramId] = param.defaultValue;
    }
  }
  return values;
}

export function getActiveGenerationSlots(kind: GenerationKind, modelId: string, modeKey: GenerationModeKey) {
  const catalog = generationDefaults[kind];
  const model = getGenerationModel(kind, modelId);
  const mode = getGenerationMode(kind, modeKey);
  return catalog.slots.filter((slot) => model.slotKeys.includes(slot.key) && mode.slotKeys.includes(slot.key));
}

export function getActiveGenerationParams(kind: GenerationKind, modelId: string, modeKey: GenerationModeKey) {
  const catalog = generationDefaults[kind];
  const model = getGenerationModel(kind, modelId);
  const mode = getGenerationMode(kind, modeKey);
  return catalog.params.filter((param) => model.paramIds.includes(param.id) && mode.paramIds.includes(param.id) && paramMatchesModel(param, model));
}

export function estimateGenerationCredits(kind: GenerationKind, modelId: string, paramValues: Record<string, GenerationParamValue>) {
  const model = getGenerationModel(kind, modelId);
  let credits = model.credits.base;

  for (const [paramId, multipliers] of Object.entries(model.credits.multipliers ?? {})) {
    const value = paramValues[paramId];
    const multiplier = multipliers[String(value)];
    if (multiplier) {
      credits *= multiplier;
    }
  }

  return Math.max(1, Math.round(credits));
}

export function createInitialGenerationState(): GenerationState {
  const videoModel = getDefaultGenerationModel("video");
  const imageModel = getDefaultGenerationModel("image");

  return {
    video: {
      prompt: "",
      modelId: videoModel.id,
      modeKey: videoModel.defaultModeKey,
      paramValues: getDefaultGenerationParamValues(videoModel),
      slots: [],
      history: []
    },
    image: {
      prompt: "",
      modelId: imageModel.id,
      modeKey: imageModel.defaultModeKey,
      paramValues: getDefaultGenerationParamValues(imageModel),
      slots: [],
      history: []
    }
  };
}
