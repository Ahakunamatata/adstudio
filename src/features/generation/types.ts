export type GenerationKind = "video" | "image";

export type GenerationSurface = "standalone" | "canvas";

export type GenerationTaskStatus = "queued" | "running" | "succeeded" | "failed";

export type GenerationModeKey =
  | "text-to-video"
  | "image-to-video"
  | "first-last-frame"
  | "reference"
  | "text-to-image"
  | "image-reference";

export type GenerationSlotKey =
  | "reference_image"
  | "reference_video"
  | "start_frame"
  | "end_frame"
  | "product_image"
  | "person_image"
  | "style_reference";

export type GenerationAssetKind = "image" | "video";

export type GenerationParamVisibility = "basic" | "advanced" | "internal";

export type GenerationParamComponent = "select" | "number" | "switch" | "text";

export type GenerationParamValue = string | number | boolean;

export type GenerationParamOption = {
  label: string;
  value: GenerationParamValue;
};

export type GenerationParam = {
  id: string;
  label: string;
  component: GenerationParamComponent;
  visibility: GenerationParamVisibility;
  required: boolean;
  defaultValue?: GenerationParamValue;
  options?: GenerationParamOption[];
  min?: number;
  max?: number;
  step?: number;
  helper?: string;
};

export type GenerationSlot = {
  key: GenerationSlotKey;
  kind: GenerationAssetKind;
  label: string;
  shortLabel: string;
  min: number;
  max: number;
  description: string;
};

export type GenerationMode = {
  key: GenerationModeKey;
  kind: GenerationKind;
  label: string;
  shortLabel: string;
  description: string;
  allowPromptOnly: boolean;
  slotKeys: GenerationSlotKey[];
  paramIds: string[];
};

export type GenerationModel = {
  id: string;
  kind: GenerationKind;
  displayName: string;
  provider: string;
  description: string;
  defaultForKind?: boolean;
  defaultModeKey: GenerationModeKey;
  modeKeys: GenerationModeKey[];
  slotKeys: GenerationSlotKey[];
  paramIds: string[];
  defaults: Record<string, GenerationParamValue>;
  credits: {
    base: number;
    multipliers?: Record<string, Record<string, number>>;
  };
};

export type GenerationSlotInput = {
  id: string;
  slotKey: GenerationSlotKey;
  kind: GenerationAssetKind;
  label: string;
  fileName: string;
  previewUrl?: string;
  status: "uploaded" | "referenced";
};

export type GenerationTask = {
  id: string;
  kind: GenerationKind;
  surface: GenerationSurface;
  prompt: string;
  modelId: string;
  modelName: string;
  modeKey: GenerationModeKey;
  modeLabel: string;
  params: Record<string, GenerationParamValue>;
  slots: GenerationSlotInput[];
  status: GenerationTaskStatus;
  progress: number;
  credits: number;
  createdAt: string;
  durationLabel?: string;
  output: {
    kind: GenerationKind;
    title: string;
    assetUrl?: string;
    ratio?: string;
  };
  context?: {
    surface: GenerationSurface;
    nodeId?: string;
    projectId?: string;
  };
};

export type GenerationCatalog = {
  kind: GenerationKind;
  label: string;
  taskLabel: string;
  historyEmpty: string;
  placeholder: string;
  models: GenerationModel[];
  modes: GenerationMode[];
  slots: GenerationSlot[];
  params: GenerationParam[];
  mockTasks: GenerationTask[];
};

export type SingleGenerationState = {
  prompt: string;
  modelId: string;
  modeKey: GenerationModeKey;
  paramValues: Record<string, GenerationParamValue>;
  slots: GenerationSlotInput[];
  history: GenerationTask[];
};

export type GenerationState = Record<GenerationKind, SingleGenerationState>;
