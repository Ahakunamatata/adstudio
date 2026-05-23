import type {
  GenerationAssetKind,
  GenerationKind,
  GenerationMode,
  GenerationModeKey,
  GenerationModel,
  GenerationSlot,
  GenerationSlotInput
} from "./types";

export type GenerationMentionAsset = {
  id: string;
  src: string;
  uploadId: string;
};

export function getGenerationSlotAccept(kind: GenerationAssetKind) {
  return kind === "video" ? "video/*" : "image/*";
}

const imageFileNamePattern = /\.(avif|gif|jpe?g|png|webp)$/i;
const videoFileNamePattern = /\.(m4v|mov|mp4|mpeg|mpg|webm)$/i;

export type GenerationSlotFileAssignment = {
  slot: GenerationSlot;
  file: File;
  index: number;
};

export type GenerationSlotDropAssignment = {
  assignments: GenerationSlotFileAssignment[];
  mediaFileCount: number;
  rejectedCount: number;
  unsupportedCount: number;
  modeKey: GenerationModeKey;
};

export function getMediaFileKind(file: File): GenerationAssetKind | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (imageFileNamePattern.test(file.name)) return "image";
  if (videoFileNamePattern.test(file.name)) return "video";
  return null;
}

export function getMediaFiles(files: File[]) {
  return files.filter((file) => getMediaFileKind(file));
}

export function hasMediaDataTransfer(dataTransfer: DataTransfer) {
  const items = Array.from(dataTransfer.items ?? []);
  if (items.length) {
    return items.some((item) => {
      if (item.kind !== "file") return false;
      if (!item.type) return true;
      return item.type.startsWith("image/") || item.type.startsWith("video/");
    });
  }

  if (Array.from(dataTransfer.types).includes("Files")) return true;
  return Array.from(dataTransfer.files ?? []).some((file) => Boolean(getMediaFileKind(file)));
}

function getModeSlots(mode: GenerationMode, model: GenerationModel, slots: GenerationSlot[]) {
  const modelSlotKeys = new Set(model.slotKeys);
  return mode.slotKeys
    .filter((slotKey) => modelSlotKeys.has(slotKey))
    .map((slotKey) => slots.find((slot) => slot.key === slotKey))
    .filter((slot): slot is GenerationSlot => Boolean(slot));
}

function assignFilesToMode(
  mode: GenerationMode,
  model: GenerationModel,
  slots: GenerationSlot[],
  existingInputs: GenerationSlotInput[],
  files: File[]
) {
  const modeSlots = getModeSlots(mode, model, slots);
  const counts = new Map<GenerationSlot["key"], number>();
  const assignments: GenerationSlotFileAssignment[] = [];

  for (const slot of modeSlots) {
    counts.set(slot.key, existingInputs.filter((input) => input.slotKey === slot.key).length);
  }

  for (const file of files) {
    const fileKind = getMediaFileKind(file);
    if (!fileKind) continue;

    const slot = modeSlots.find((item) => {
      const count = counts.get(item.key) ?? 0;
      return item.kind === fileKind && count < item.max;
    });

    if (!slot) continue;

    const index = counts.get(slot.key) ?? 0;
    assignments.push({ slot, file, index });
    counts.set(slot.key, index + 1);
  }

  return assignments;
}

export function assignFilesToGenerationSlots({
  kind,
  model,
  modes,
  slots,
  modeKey,
  existingInputs,
  files
}: {
  kind: GenerationKind;
  model: GenerationModel;
  modes: GenerationMode[];
  slots: GenerationSlot[];
  modeKey: GenerationModeKey;
  existingInputs: GenerationSlotInput[];
  files: File[];
}): GenerationSlotDropAssignment {
  const mediaFiles = getMediaFiles(files);
  const currentMode = modes.find((mode) => mode.key === modeKey);
  const candidateModes = modes.filter((mode) => mode.kind === kind && model.modeKeys.includes(mode.key));
  const orderedModes = [
    ...(currentMode && candidateModes.includes(currentMode) ? [currentMode] : []),
    ...candidateModes.filter((mode) => mode.key !== currentMode?.key)
  ];

  let bestMode = orderedModes[0];
  let bestAssignments: GenerationSlotFileAssignment[] = [];

  for (const mode of orderedModes) {
    const assignments = assignFilesToMode(mode, model, slots, existingInputs, mediaFiles);
    if (assignments.length > bestAssignments.length) {
      bestMode = mode;
      bestAssignments = assignments;
    }
  }

  return {
    assignments: bestAssignments,
    mediaFileCount: mediaFiles.length,
    rejectedCount: Math.max(0, mediaFiles.length - bestAssignments.length),
    unsupportedCount: Math.max(0, files.length - mediaFiles.length),
    modeKey: bestMode?.key ?? modeKey
  };
}

export function createGenerationSlotInputFromFile(slot: GenerationSlot, file: File, index: number): GenerationSlotInput {
  const previewUrl = typeof URL !== "undefined" && "createObjectURL" in URL ? URL.createObjectURL(file) : undefined;

  return {
    id: `local-${slot.key}-${Date.now().toString(36)}-${index}`,
    slotKey: slot.key,
    kind: slot.kind,
    label: slot.label,
    fileName: file.name || `${slot.shortLabel.toLowerCase()}-${index + 1}`,
    previewUrl,
    status: "uploaded"
  };
}

export function revokeGenerationSlotPreview(slot: GenerationSlotInput) {
  if (typeof URL === "undefined" || !slot.previewUrl?.startsWith("blob:")) return;
  URL.revokeObjectURL(slot.previewUrl);
}

export function filterGenerationSlots(slots: GenerationSlotInput[], keepSlot: (slot: GenerationSlotInput) => boolean) {
  return slots.filter((slot) => {
    const keep = keepSlot(slot);
    if (!keep) revokeGenerationSlotPreview(slot);
    return keep;
  });
}

export function getGenerationMentionAssets(slots: GenerationSlotInput[]): GenerationMentionAsset[] {
  return slots
    .filter((slot) => slot.kind === "image" && Boolean(slot.previewUrl))
    .map((slot, index) => ({
      id: `img${index + 1}`,
      src: slot.previewUrl ?? "",
      uploadId: slot.id
    }));
}

export function getGenerationMentionPromptPosition(textarea: HTMLTextAreaElement, prompt: string) {
  const style = window.getComputedStyle(textarea);
  const mirror = document.createElement("div");
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "break-word";
  mirror.style.wordWrap = "break-word";
  mirror.style.width = `${textarea.clientWidth}px`;
  mirror.style.fontFamily = style.fontFamily;
  mirror.style.fontSize = style.fontSize;
  mirror.style.fontWeight = style.fontWeight;
  mirror.style.letterSpacing = style.letterSpacing;
  mirror.style.lineHeight = style.lineHeight;
  mirror.style.padding = style.padding;
  mirror.style.border = style.border;

  const cursorPosition = textarea.selectionStart;
  mirror.textContent = prompt.slice(0, cursorPosition);
  const marker = document.createElement("span");
  marker.textContent = "|";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const markerRect = marker.getBoundingClientRect();
  const mirrorRect = mirror.getBoundingClientRect();
  const left = markerRect.left - mirrorRect.left;
  const top = markerRect.top - mirrorRect.top + textarea.scrollTop;
  document.body.removeChild(mirror);

  return {
    left: Math.max(0, Math.min(left, textarea.clientWidth - 236)),
    top: Math.max(0, Math.min(top + 28, textarea.clientHeight + 10))
  };
}
