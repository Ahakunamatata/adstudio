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
  GenerationState,
  GenerationTask
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
    description: "用 prompt 生成广告图，可选绑定产品、人物和风格参考。",
    allowPromptOnly: true,
    slotKeys: ["product_image", "person_image", "style_reference"],
    paramIds: ["ratio", "count", "style", "quality", "seed", "internal_source"]
  },
  {
    key: "image-reference",
    kind: "image",
    label: "参考生图",
    shortLabel: "Ref",
    description: "用产品图、人物图或风格图生成可投放广告图片。",
    allowPromptOnly: false,
    slotKeys: ["product_image", "person_image", "style_reference"],
    paramIds: ["ratio", "count", "style", "quality", "seed", "internal_source"]
  }
];

const videoSlots: GenerationSlot[] = [
  {
    key: "reference_image",
    kind: "image",
    label: "参考图",
    shortLabel: "Ref",
    min: 0,
    max: 4,
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
    max: 3,
    description: "商品、App UI、Logo 或包装图，帮助保持品牌一致。"
  }
];

const imageSlots: GenerationSlot[] = [
  {
    key: "product_image",
    kind: "image",
    label: "产品图",
    shortLabel: "Product",
    min: 0,
    max: 4,
    description: "商品包装、App 截图或品牌素材。"
  },
  {
    key: "person_image",
    kind: "image",
    label: "人物图",
    shortLabel: "Person",
    min: 0,
    max: 2,
    description: "创作者、模特或目标用户参考。"
  },
  {
    key: "style_reference",
    kind: "image",
    label: "风格图",
    shortLabel: "Style",
    min: 0,
    max: 3,
    description: "广告构图、色彩、质感或竞品视觉参考。"
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
      { label: "6s", value: "6s" },
      { label: "10s", value: "10s" },
      { label: "15s", value: "15s" },
      { label: "30s", value: "30s" }
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
      { label: "720p", value: "720p" },
      { label: "1080p", value: "1080p" },
      { label: "4K", value: "4K" }
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
    component: "select",
    visibility: "basic",
    required: true,
    defaultValue: "4:5",
    options: [
      { label: "1:1", value: "1:1" },
      { label: "4:5", value: "4:5" },
      { label: "9:16", value: "9:16" },
      { label: "16:9", value: "16:9" }
    ]
  },
  {
    id: "count",
    label: "张数",
    component: "select",
    visibility: "basic",
    required: true,
    defaultValue: 4,
    options: [
      { label: "1 张", value: 1 },
      { label: "2 张", value: 2 },
      { label: "4 张", value: 4 }
    ]
  },
  {
    id: "style",
    label: "风格",
    component: "select",
    visibility: "basic",
    required: false,
    defaultValue: "ugc",
    options: [
      { label: "UGC", value: "ugc" },
      { label: "商品主图", value: "packshot" },
      { label: "App 素材", value: "app" },
      { label: "高端质感", value: "premium" }
    ]
  },
  {
    id: "quality",
    label: "质量",
    component: "select",
    visibility: "basic",
    required: true,
    defaultValue: "standard",
    options: [
      { label: "Standard", value: "standard" },
      { label: "High", value: "high" },
      { label: "Ultra", value: "ultra" }
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
    id: "seedance-2",
    kind: "video",
    displayName: "Seedance 2.0",
    provider: "ByteDance",
    description: "适合移动端广告、UGC 镜头、产品演示和首尾帧控制。",
    defaultForKind: true,
    defaultModeKey: "text-to-video",
    modeKeys: ["text-to-video", "image-to-video", "first-last-frame", "reference"],
    slotKeys: ["reference_image", "reference_video", "start_frame", "end_frame", "product_image"],
    paramIds: ["ratio", "duration", "quality", "motion", "camera", "seed", "internal_source"],
    defaults: {
      ratio: "9:16",
      duration: "15s",
      quality: "1080p",
      motion: "balanced",
      camera: "handheld",
      internal_source: "standalone"
    },
    credits: {
      base: 18,
      multipliers: {
        duration: { "6s": 0.75, "10s": 0.9, "15s": 1, "30s": 1.7 },
        quality: { "720p": 0.85, "1080p": 1, "4K": 1.8 }
      }
    }
  },
  {
    id: "kling-3",
    kind: "video",
    displayName: "Kling 3.0",
    provider: "Kuaishou",
    description: "适合强动态商品演示、多镜头广告和高控制首尾帧。",
    defaultModeKey: "image-to-video",
    modeKeys: ["text-to-video", "image-to-video", "first-last-frame"],
    slotKeys: ["start_frame", "end_frame", "product_image"],
    paramIds: ["ratio", "duration", "quality", "motion", "camera", "seed", "internal_source"],
    defaults: {
      ratio: "9:16",
      duration: "10s",
      quality: "1080p",
      motion: "high",
      camera: "push-in",
      internal_source: "standalone"
    },
    credits: {
      base: 22,
      multipliers: {
        duration: { "6s": 0.72, "10s": 1, "15s": 1.35, "30s": 2 },
        quality: { "720p": 0.8, "1080p": 1, "4K": 1.9 }
      }
    }
  },
  {
    id: "veo",
    kind: "video",
    displayName: "Veo",
    provider: "Google",
    description: "适合高质感品牌短片、真实光影和干净的产品叙事。",
    defaultModeKey: "text-to-video",
    modeKeys: ["text-to-video", "image-to-video", "first-last-frame", "reference"],
    slotKeys: ["reference_image", "start_frame", "end_frame", "product_image"],
    paramIds: ["ratio", "duration", "quality", "motion", "camera", "seed", "internal_source"],
    defaults: {
      ratio: "16:9",
      duration: "10s",
      quality: "1080p",
      motion: "low",
      camera: "static",
      internal_source: "standalone"
    },
    credits: {
      base: 30,
      multipliers: {
        duration: { "6s": 0.8, "10s": 1, "15s": 1.45, "30s": 2.25 },
        quality: { "720p": 0.75, "1080p": 1, "4K": 2.2 }
      }
    }
  }
];

const imageModels: GenerationModel[] = [
  {
    id: "gpt-image",
    kind: "image",
    displayName: "GPT Image",
    provider: "OpenAI",
    description: "适合广告构图、文案区域规划、产品视觉和多参考图编辑。",
    defaultForKind: true,
    defaultModeKey: "text-to-image",
    modeKeys: ["text-to-image", "image-reference"],
    slotKeys: ["product_image", "person_image", "style_reference"],
    paramIds: ["ratio", "count", "style", "quality", "seed", "internal_source"],
    defaults: {
      ratio: "4:5",
      count: 4,
      style: "ugc",
      quality: "high",
      internal_source: "standalone"
    },
    credits: {
      base: 8,
      multipliers: {
        count: { "1": 0.45, "2": 0.7, "4": 1 },
        quality: { standard: 0.85, high: 1, ultra: 1.45 }
      }
    }
  },
  {
    id: "nano-banana",
    kind: "image",
    displayName: "Nano Banana",
    provider: "Google",
    description: "适合快速变体、产品图改造和多参考资产融合。",
    defaultModeKey: "image-reference",
    modeKeys: ["text-to-image", "image-reference"],
    slotKeys: ["product_image", "person_image", "style_reference"],
    paramIds: ["ratio", "count", "style", "quality", "seed", "internal_source"],
    defaults: {
      ratio: "1:1",
      count: 2,
      style: "packshot",
      quality: "standard",
      internal_source: "standalone"
    },
    credits: {
      base: 7,
      multipliers: {
        count: { "1": 0.5, "2": 0.75, "4": 1.2 },
        quality: { standard: 1, high: 1.25, ultra: 1.65 }
      }
    }
  },
  {
    id: "flux",
    kind: "image",
    displayName: "Flux",
    provider: "Black Forest Labs",
    description: "适合高质感静帧、海报式广告图和风格化素材。",
    defaultModeKey: "text-to-image",
    modeKeys: ["text-to-image", "image-reference"],
    slotKeys: ["product_image", "style_reference"],
    paramIds: ["ratio", "count", "style", "quality", "seed", "internal_source"],
    defaults: {
      ratio: "16:9",
      count: 2,
      style: "premium",
      quality: "high",
      internal_source: "standalone"
    },
    credits: {
      base: 9,
      multipliers: {
        count: { "1": 0.5, "2": 0.85, "4": 1.35 },
        quality: { standard: 0.8, high: 1, ultra: 1.55 }
      }
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

function taskSlots(kind: GenerationKind, keys: GenerationSlotKey[]): GenerationSlotInput[] {
  return keys.flatMap((slotKey, index) => {
    const slot = createMockGenerationSlotInput(kind, slotKey, index);
    return slot ? [slot] : [];
  });
}

const videoTasks: GenerationTask[] = [
  {
    id: "mock-video-001",
    kind: "video",
    surface: "standalone",
    prompt:
      "15s TikTok ad for Family Locator. A parent sees a late arrival alert, checks the app, then feels relieved. Thai subtitles, handheld phone close-ups, clear CTA.",
    modelId: "seedance-2",
    modelName: "Seedance 2.0",
    modeKey: "text-to-video",
    modeLabel: "文生视频",
    params: { ratio: "9:16", duration: "15s", quality: "1080p", motion: "balanced", camera: "handheld" },
    slots: taskSlots("video", ["product_image"]),
    status: "succeeded",
    progress: 100,
    credits: 18,
    createdAt: "Today 10:42",
    durationLabel: "31s",
    output: {
      kind: "video",
      title: "Family Locator alert ad",
      assetUrl: "/assets/preview-video-ugc.png",
      ratio: "9:16"
    },
    context: { surface: "standalone" }
  },
  {
    id: "mock-video-002",
    kind: "video",
    surface: "canvas",
    prompt:
      "Product demo shot: phone screen opens the app, route card animates in, parent taps notify. Clean UI, warm home light, product-led motion.",
    modelId: "kling-3",
    modelName: "Kling 3.0",
    modeKey: "first-last-frame",
    modeLabel: "首尾帧",
    params: { ratio: "9:16", duration: "10s", quality: "1080p", motion: "high", camera: "push-in" },
    slots: taskSlots("video", ["start_frame", "end_frame", "product_image"]),
    status: "running",
    progress: 62,
    credits: 22,
    createdAt: "Today 10:57",
    output: {
      kind: "video",
      title: "App UI transition",
      assetUrl: "/assets/asset-competitor-video.png",
      ratio: "9:16"
    },
    context: { surface: "canvas", nodeId: "video_node_12" }
  }
];

const imageTasks: GenerationTask[] = [
  {
    id: "mock-image-001",
    kind: "image",
    surface: "standalone",
    prompt:
      "High-converting 4:5 app ad image for Family Locator. Phone UI hero, worried parent visual, clean headline space, green CTA button.",
    modelId: "gpt-image",
    modelName: "GPT Image",
    modeKey: "text-to-image",
    modeLabel: "文生图",
    params: { ratio: "4:5", count: 4, style: "ugc", quality: "high" },
    slots: taskSlots("image", ["product_image", "person_image"]),
    status: "succeeded",
    progress: 100,
    credits: 8,
    createdAt: "Today 09:28",
    durationLabel: "12s",
    output: {
      kind: "image",
      title: "Family Locator static ad",
      assetUrl: "/assets/preview-image-ad.png",
      ratio: "4:5"
    },
    context: { surface: "standalone" }
  },
  {
    id: "mock-image-002",
    kind: "image",
    surface: "canvas",
    prompt:
      "Premium ecommerce packshot with offer badge, soft studio light, product centered, space for campaign headline.",
    modelId: "nano-banana",
    modelName: "Nano Banana",
    modeKey: "image-reference",
    modeLabel: "参考生图",
    params: { ratio: "1:1", count: 2, style: "packshot", quality: "standard" },
    slots: taskSlots("image", ["product_image", "style_reference"]),
    status: "queued",
    progress: 8,
    credits: 6,
    createdAt: "Today 11:03",
    output: {
      kind: "image",
      title: "Packshot variation",
      assetUrl: "/assets/thumb-ecommerce-packshot.png",
      ratio: "1:1"
    },
    context: { surface: "canvas", nodeId: "image_node_07" }
  }
];

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
    mockTasks: videoTasks
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
    mockTasks: imageTasks
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

export function getDefaultGenerationParamValues(model: GenerationModel) {
  const values: Record<string, GenerationParamValue> = { ...model.defaults };
  for (const paramId of model.paramIds) {
    const param = [...videoParams, ...imageParams].find((item) => item.id === paramId);
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
  return catalog.params.filter((param) => model.paramIds.includes(param.id) && mode.paramIds.includes(param.id));
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
      history: generationDefaults.video.mockTasks
    },
    image: {
      prompt: "",
      modelId: imageModel.id,
      modeKey: imageModel.defaultModeKey,
      paramValues: getDefaultGenerationParamValues(imageModel),
      slots: [],
      history: generationDefaults.image.mockTasks
    }
  };
}
