"use client";

import {
  ArrowUp,
  ArrowDown,
  Check,
  Clock3,
  Download,
  RefreshCw,
  Image as ImageIcon,
  Layers3,
  Play,
  Sparkles,
  Upload,
  Video,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from "react";
import type { AppRoute } from "@/lib/domain/schemas";
import {
  estimateGenerationCredits,
  generationDefaults,
  getActiveGenerationParams,
  getActiveGenerationSlots,
  getDefaultGenerationParamValues,
  getGenerationMode,
  getGenerationModel
} from "@/lib/mock-data";
import type {
  GenerationAssetKind,
  GenerationKind,
  GenerationModeKey,
  GenerationParam,
  GenerationParamValue,
  GenerationSlot,
  GenerationSlotInput,
  GenerationTask,
  GenerationTaskStatus,
  SingleGenerationState
} from "./types";
import { GenerationImageMentionMenu, type GenerationMentionMenuState } from "./GenerationImageMentionMenu";
import { GenerationSlotStack } from "./GenerationSlotStack";
import {
  assignFilesToGenerationSlots,
  createGenerationSlotInputFromFile,
  filterGenerationSlots,
  getGenerationMentionAssets,
  getGenerationMentionPromptPosition,
  hasMediaDataTransfer,
  revokeGenerationSlotPreview,
  type GenerationMentionAsset
} from "./slot-inputs";
import {
  buildViduSlotPayloads,
  getElapsedLabel,
  getErrorMessage,
  getViduOutput,
  getViduProgress,
  mapViduState,
  readApiError,
  type ViduGenerateResponse,
  type ViduTaskResponse
} from "./vidu-client";

type GenerationStateUpdater = SingleGenerationState | ((current: SingleGenerationState) => SingleGenerationState);

type GenerationPreviewItem = {
  kind: GenerationAssetKind | "text";
  title: string;
  src?: string;
  posterSrc?: string;
  playbackSrc?: string;
  text?: string;
};

type GenerationViewProps = {
  active: boolean;
  kind: GenerationKind;
  state: SingleGenerationState;
  autoSubmitToken?: number | null;
  onStateChange: (kind: GenerationKind, state: GenerationStateUpdater) => void;
  onRouteChange: (route: AppRoute) => void;
  onToast: (text: string) => void;
  onAutoSubmitHandled?: (kind: GenerationKind, token: number) => void;
};

const statusCopy: Record<GenerationTaskStatus, string> = {
  queued: "排队中",
  running: "生成中",
  succeeded: "已完成",
  failed: "失败"
};

const GENERATION_COMPOSER_SCROLL_THRESHOLD = 300;

function isGeneratingStatus(status: GenerationTaskStatus) {
  return status === "queued" || status === "running";
}

function getParamDisplayValue(param: GenerationParam, value: GenerationParamValue | undefined) {
  const option = param.options?.find((item) => item.value === value);
  if (option) return option.label;
  if (value === undefined || value === "") return "Auto";
  return String(value);
}

function updateTask(state: SingleGenerationState, taskId: string, patch: Partial<GenerationTask>) {
  return {
    ...state,
    history: state.history.map((task) => (task.id === taskId ? { ...task, ...patch } : task))
  };
}

function createPendingTask({
  activeSlots,
  credits,
  kind,
  modeKey,
  modeLabel,
  modelId,
  modelName,
  paramValues,
  prompt,
  slots
}: {
  activeSlots: GenerationSlot[];
  credits: number;
  kind: GenerationKind;
  modeKey: GenerationModeKey;
  modeLabel: string;
  modelId: string;
  modelName: string;
  paramValues: Record<string, GenerationParamValue>;
  prompt: string;
  slots: GenerationSlotInput[];
}): GenerationTask {
  const activeSlotKeys = new Set(activeSlots.map((slot) => slot.key));
  const ratio = String(paramValues.ratio ?? "9:16");
  const taskKindLabel = kind === "video" ? "Video" : "Image";

  return {
    id: `${kind}-${Date.now()}`,
    kind,
    surface: "standalone",
    prompt,
    modelId,
    modelName,
    modeKey,
    modeLabel,
    params: paramValues,
    slots: slots.filter((slot) => activeSlotKeys.has(slot.slotKey)),
    status: "queued",
    progress: 8,
    credits,
    createdAt: "Just now",
    output: {
      kind,
      title: `${taskKindLabel} draft`,
      ratio
    },
    context: {
      surface: "standalone"
    }
  };
}

function getSlotPreviewItem(slot: GenerationSlotInput): GenerationPreviewItem | null {
  if (!slot.previewUrl) return null;

  return {
    kind: slot.kind,
    src: slot.previewUrl,
    title: slot.fileName || slot.label
  };
}

function getTaskOutputPreviewItem(task: GenerationTask): GenerationPreviewItem | null {
  if (task.status !== "succeeded") return null;

  if (task.kind === "video") {
    const playbackSrc = task.output.downloadUrl ?? task.output.assetUrl;
    if (!task.output.assetUrl && !playbackSrc) return null;

    return {
      kind: task.output.kind,
      src: task.output.assetUrl,
      playbackSrc,
      posterSrc: task.output.assetUrl,
      title: task.output.title || "Video output"
    };
  }

  const imageSrc = task.output.assetUrl ?? task.output.downloadUrl;
  if (!imageSrc) return null;

  return {
    kind: task.output.kind,
    src: imageSrc,
    title: task.output.title || "Image output"
  };
}

function GenerationTaskPrompt({ prompt }: { prompt: string }) {
  const resolvedPrompt = prompt || "No prompt captured.";
  const promptRef = useRef<HTMLDivElement | null>(null);
  const [canExpand, setCanExpand] = useState(false);

  function measurePrompt() {
    const promptElement = promptRef.current;
    if (!promptElement) return;

    setCanExpand(promptElement.scrollHeight > promptElement.clientHeight + 1 || promptElement.scrollWidth > promptElement.clientWidth + 1);
  }

  return (
    <div className={`generation-task-prompt-wrap ${canExpand ? "has-expanded-prompt" : ""}`} onMouseEnter={measurePrompt}>
      <div ref={promptRef} className="generation-task-prompt" tabIndex={resolvedPrompt.length > 80 ? 0 : undefined} onFocus={measurePrompt}>
        {resolvedPrompt}
      </div>
      <div className="generation-task-prompt-overlay" hidden={!canExpand}>
        {resolvedPrompt}
      </div>
    </div>
  );
}

function GenerationPreviewOverlay({ item, onClose }: { item: GenerationPreviewItem | null; onClose: () => void }) {
  useEffect(() => {
    if (!item) return undefined;

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [item, onClose]);

  if (!item) return null;

  const videoSrc = item.kind === "video" ? item.playbackSrc ?? item.src : undefined;

  return (
    <div
      className="generation-media-preview-overlay open"
      role="dialog"
      aria-modal="true"
      aria-label="Media preview"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <button className="generation-media-preview-close" type="button" aria-label="Close media preview" onClick={onClose}>
        <X size={18} />
      </button>
      <div className="generation-media-preview-stage">
        {item.kind === "image" && item.src ? (
          <span className="generation-media-preview-content is-image" role="img" aria-label={item.title} style={{ backgroundImage: `url(${item.src})` }} />
        ) : null}
        {item.kind === "video" ? (
          <div className="generation-media-preview-video">
            {videoSrc ? (
              <video
                src={videoSrc}
                poster={item.posterSrc ?? item.src}
                controls
                autoPlay
                playsInline
                style={{ maxHeight: "100%", maxWidth: "100%", borderRadius: 8, background: "#050713" }}
              />
            ) : (
              <Video size={28} />
            )}
            <span>{item.title}</span>
          </div>
        ) : null}
        {item.kind === "text" ? (
          <div className="generation-media-preview-text">
            <div className="generation-media-preview-title">{item.title}</div>
            <p>{item.text}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function GenerationDetailOverlay({
  onClose,
  onPreviewMedia,
  task
}: {
  onClose: () => void;
  onPreviewMedia: (item: GenerationPreviewItem) => void;
  task: GenerationTask | null;
}) {
  useEffect(() => {
    if (!task) return undefined;

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose, task]);

  if (!task) return null;

  const outputPreview = getTaskOutputPreviewItem(task);
  const catalog = generationDefaults[task.kind];
  const paramRows = Object.entries(task.params).flatMap(([paramId, value]) => {
    if (value === undefined || value === "") return [];
    const param = catalog.params.find((item) => item.id === paramId);
    return [
      {
        id: paramId,
        label: param?.label ?? paramId,
        value: param ? getParamDisplayValue(param, value) : String(value)
      }
    ];
  });

  return (
    <div
      className="generation-detail-overlay open"
      role="dialog"
      aria-modal="true"
      aria-label="Generation detail"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <button className="generation-detail-close" type="button" aria-label="Close detail" onClick={onClose}>
        <X size={18} />
      </button>

      <div className="generation-detail-dialog">
        <div className="generation-detail-media">
          {outputPreview?.src ? (
            <button className={`generation-detail-output is-${task.kind}`} type="button" onClick={() => onPreviewMedia(outputPreview)} aria-label="Preview output media">
              <span className="generation-output-media" style={{ backgroundImage: `url(${outputPreview.src})` }} />
              {task.kind === "video" ? (
                <span className="generation-play-chip" aria-hidden="true">
                  <Play size={13} />
                </span>
              ) : null}
            </button>
          ) : (
            <div className="generation-detail-empty">No output.</div>
          )}
        </div>

        <aside className="generation-detail-panel">
          <section className="generation-detail-section">
            <div className="generation-detail-label">Model</div>
            <div className="generation-detail-model-row">
              <div className="generation-detail-model">{task.modelName}</div>
              <div className="generation-detail-model-tag">{task.kind === "video" ? "Video" : "Image"}</div>
            </div>
          </section>

          <section className="generation-detail-section">
            <div className="generation-detail-label">Inputs</div>
            <div className="generation-detail-ref-row">
              {task.slots.length ? (
                task.slots.map((slot) => {
                  const slotPreview = getSlotPreviewItem(slot);

                  return slotPreview ? (
                    <button className="generation-task-ref-thumb is-clickable generation-detail-ref-item" type="button" key={`${task.id}-detail-${slot.id}`} onClick={() => onPreviewMedia(slotPreview)}>
                      {slot.previewUrl ? <span style={{ backgroundImage: `url(${slot.previewUrl})` }} /> : slot.kind === "video" ? <Video size={17} /> : <ImageIcon size={17} />}
                    </button>
                  ) : (
                    <span className="generation-task-ref-thumb generation-detail-ref-item" key={`${task.id}-detail-${slot.id}`}>
                      {slot.kind === "video" ? <Video size={17} /> : <ImageIcon size={17} />}
                    </span>
                  );
                })
              ) : (
                <div className="generation-detail-empty">No inputs attached.</div>
              )}
            </div>
          </section>

          <section className="generation-detail-section">
            <div className="generation-detail-label">Prompt</div>
            <button
              className="generation-detail-prompt"
              type="button"
              onClick={() =>
                onPreviewMedia({
                  kind: "text",
                  title: "Prompt",
                  text: task.prompt || "No prompt captured."
                })
              }
            >
              {task.prompt || "No prompt captured."}
            </button>
          </section>

          <section className="generation-detail-section">
            <div className="generation-detail-label">Parameters</div>
            <div className="generation-detail-param-list">
              {paramRows.length ? (
                paramRows.map((param) => (
                  <div className="generation-detail-param-row" key={param.id}>
                    <span>{param.label}</span>
                    <strong>{param.value}</strong>
                  </div>
                ))
              ) : (
                <div className="generation-detail-empty">No parameters captured.</div>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

export function GenerationView({ active, kind, state, autoSubmitToken = null, onStateChange, onRouteChange, onToast, onAutoSubmitHandled }: GenerationViewProps) {
  const catalog = generationDefaults[kind];
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<GenerationPreviewItem | null>(null);
  const [detailTask, setDetailTask] = useState<GenerationTask | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [mentionMenu, setMentionMenu] = useState<GenerationMentionMenuState>({
    anchor: "prompt",
    open: false,
    position: null
  });
  const [isDropActive, setIsDropActive] = useState(false);
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
  const bottomScrollFrame = useRef<number | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const mentionMenuRef = useRef<HTMLDivElement | null>(null);
  const mentionItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const isCollapsedRef = useRef(false);
  const forceExpandedRef = useRef(false);
  const pollTimeouts = useRef<number[]>([]);
  const autoSubmitHandledRef = useRef<number | null>(null);
  const submitRef = useRef<() => Promise<void>>(async () => undefined);

  const selectedModel = getGenerationModel(kind, state.modelId);
  const selectedMode = selectedModel.modeKeys.includes(state.modeKey)
    ? getGenerationMode(kind, state.modeKey)
    : getGenerationMode(kind, selectedModel.defaultModeKey);

  const activeSlots = useMemo(
    () => getActiveGenerationSlots(kind, selectedModel.id, selectedMode.key),
    [kind, selectedMode.key, selectedModel.id]
  );
  const activeParams = useMemo(
    () => getActiveGenerationParams(kind, selectedModel.id, selectedMode.key),
    [kind, selectedMode.key, selectedModel.id]
  );
  const compatibleModes = catalog.modes.filter((mode) => selectedModel.modeKeys.includes(mode.key));
  const basicParams = activeParams.filter((param) => param.visibility === "basic");
  const internalParams = activeParams.filter((param) => param.visibility === "internal");
  const activeSlotKeys = new Set(activeSlots.map((slot) => slot.key));
  const activeSlotUploads = state.slots.filter((slot) => activeSlotKeys.has(slot.slotKey));
  const mentionAssets = getGenerationMentionAssets(state.slots);
  const credits = estimateGenerationCredits(kind, selectedModel.id, state.paramValues);
  const hasPrompt = state.prompt.trim().length > 0;
  const hasRequiredAssets = selectedMode.allowPromptOnly || activeSlotUploads.length > 0;
  const canSubmit = hasPrompt && hasRequiredAssets;

  useEffect(() => {
    return () => {
      if (bottomScrollFrame.current !== null) {
        window.cancelAnimationFrame(bottomScrollFrame.current);
      }
      pollTimeouts.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
      pollTimeouts.current = [];
    };
  }, []);

  useEffect(() => {
    isCollapsedRef.current = isCollapsed;
  }, [isCollapsed]);

  useEffect(() => {
    if (!active) return undefined;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (composerRef.current?.contains(target)) return;

      setOpenMenu(null);
      setMentionStart(null);
      setMentionMenu((current) => (current.open ? { ...current, open: false } : current));
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [active]);

  useEffect(() => {
    if (!active) return undefined;

    const updateCollapsedState = () => {
      const distanceFromBottom = document.documentElement.scrollHeight - window.scrollY - window.innerHeight;

      if (forceExpandedRef.current) {
        forceExpandedRef.current = false;
        setIsCollapsed(true);
        setOpenMenu(null);
        return;
      }

      setIsCollapsed(distanceFromBottom > GENERATION_COMPOSER_SCROLL_THRESHOLD);
    };

    const frameId = window.requestAnimationFrame(updateCollapsedState);
    window.addEventListener("scroll", updateCollapsedState, { passive: true });

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("scroll", updateCollapsedState);
    };
  }, [active]);

  function isNearPageBottom(buffer = 320) {
    return document.documentElement.scrollHeight - (window.scrollY + window.innerHeight) <= buffer;
  }

  function scrollToGenerationBottomAfterLayout(behavior: ScrollBehavior = "auto") {
    if (bottomScrollFrame.current !== null) {
      window.cancelAnimationFrame(bottomScrollFrame.current);
    }

    bottomScrollFrame.current = window.requestAnimationFrame(() => {
      bottomScrollFrame.current = window.requestAnimationFrame(() => {
        bottomScrollFrame.current = null;
        window.scrollTo({
          top: document.documentElement.scrollHeight,
          behavior
        });
      });
    });
  }

  function patch(patchState: Partial<SingleGenerationState>) {
    onStateChange(kind, (current) => ({ ...current, ...patchState }));
  }

  function setParamValue(paramId: string, value: GenerationParamValue | undefined) {
    onStateChange(kind, (current) => {
      const nextValues = { ...current.paramValues };
      if (value === undefined || value === "") {
        delete nextValues[paramId];
      } else {
        nextValues[paramId] = value;
      }
      return { ...current, paramValues: nextValues };
    });
  }

  function selectModel(modelId: string) {
    const model = getGenerationModel(kind, modelId);
    const modeKey = model.modeKeys.includes(state.modeKey) ? state.modeKey : model.defaultModeKey;
    onStateChange(kind, (current) => ({
      ...current,
      modelId,
      modeKey,
      paramValues: getDefaultGenerationParamValues(model),
      slots: filterGenerationSlots(current.slots, (slot) => model.slotKeys.includes(slot.slotKey))
    }));
    setOpenMenu(null);
  }

  function selectMode(modeKey: GenerationModeKey) {
    onStateChange(kind, (current) => ({
      ...current,
      modeKey,
      slots: filterGenerationSlots(current.slots, (slot) => {
        const mode = getGenerationMode(kind, modeKey);
        return mode.slotKeys.includes(slot.slotKey);
      })
    }));
    setOpenMenu(null);
  }

  function addSlotFiles(slot: GenerationSlot, files: File[]) {
    const currentCount = state.slots.filter((item) => item.slotKey === slot.key).length;
    const acceptedFiles = files.slice(0, Math.max(0, slot.max - currentCount));

    if (acceptedFiles.length < files.length || currentCount >= slot.max) {
      onToast(`${slot.label} 已达到 ${slot.max} 个上限`);
    }

    if (!acceptedFiles.length) return;

    patch({
      slots: [
        ...state.slots,
        ...acceptedFiles.map((file, index) => createGenerationSlotInputFromFile(slot, file, currentCount + index))
      ]
    });
    onToast(`已添加${acceptedFiles.length} 个${slot.label}`);
  }

  function addDroppedSlotFiles(files: File[]) {
    const assignment = assignFilesToGenerationSlots({
      kind,
      model: selectedModel,
      modes: catalog.modes,
      slots: catalog.slots,
      modeKey: state.modeKey,
      existingInputs: state.slots,
      files
    });

    if (!assignment.mediaFileCount) {
      onToast("只支持拖入图片或视频素材");
      return;
    }

    if (!assignment.assignments.length) {
      onToast(kind === "image" ? "图片生成当前只支持图片参考" : "当前素材槽已满或模型不支持该素材");
      return;
    }

    const nextMode = getGenerationMode(kind, assignment.modeKey);
    const baseSlots =
      assignment.modeKey === state.modeKey
        ? state.slots
        : filterGenerationSlots(
            state.slots,
            (slot) => nextMode.slotKeys.includes(slot.slotKey) && selectedModel.slotKeys.includes(slot.slotKey)
          );

    patch({
      modeKey: assignment.modeKey,
      slots: [
        ...baseSlots,
        ...assignment.assignments.map(({ slot, file, index }) => createGenerationSlotInputFromFile(slot, file, index))
      ]
    });
    setOpenMenu(null);
    closeMentionMenu();

    const ignoredCount = assignment.rejectedCount + assignment.unsupportedCount;
    onToast(`已添加${assignment.assignments.length} 个素材${ignoredCount ? `，${ignoredCount} 个未添加` : ""}`);
  }

  function removeSlot(inputId: string) {
    const removedSlot = state.slots.find((slot) => slot.id === inputId);
    if (removedSlot) revokeGenerationSlotPreview(removedSlot);
    patch({ slots: state.slots.filter((slot) => slot.id !== inputId) });
  }

  function closeMentionMenu() {
    setMentionMenu((current) => ({ ...current, open: false }));
    setMentionStart(null);
  }

  function openMentionMenu(anchor: GenerationMentionMenuState["anchor"], mentionStartPos: number | null = null, position: GenerationMentionMenuState["position"] = null) {
    setOpenMenu(null);
    setMentionStart(mentionStartPos);
    setSelectedMentionIndex(0);
    setMentionMenu({
      anchor,
      open: true,
      position: anchor === "prompt" ? position : null
    });
  }

  function insertMention(asset: GenerationMentionAsset, textarea: HTMLTextAreaElement | null) {
    const promptValue = state.prompt;
    const reference = `@${asset.id} `;
    const selectionStart = textarea?.selectionStart ?? promptValue.length;
    const selectionEnd = textarea?.selectionEnd ?? selectionStart;
    const shouldReplacePreviousAt = mentionStart === null && selectionStart === selectionEnd && selectionStart > 0 && promptValue[selectionStart - 1] === "@";
    const start = mentionStart ?? (shouldReplacePreviousAt ? selectionStart - 1 : selectionStart);
    const end = mentionStart !== null ? mentionStart + 1 : shouldReplacePreviousAt ? selectionStart : selectionEnd;
    const nextPrompt = promptValue.slice(0, start) + reference + promptValue.slice(end);
    const nextCursorPosition = start + reference.length;

    patch({ prompt: nextPrompt });
    closeMentionMenu();

    window.setTimeout(() => {
      textarea?.focus();
      textarea?.setSelectionRange(nextCursorPosition, nextCursorPosition);
    }, 0);
  }

  function handlePromptChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const nextPrompt = event.target.value;
    const cursorPosition = event.target.selectionStart;
    patch({ prompt: nextPrompt });

    if (cursorPosition > 0 && nextPrompt[cursorPosition - 1] === "@" && mentionAssets.length > 0) {
      const mentionPosition = getGenerationMentionPromptPosition(event.currentTarget, nextPrompt);
      setMentionStart(cursorPosition - 1);
      window.requestAnimationFrame(() => openMentionMenu("prompt", cursorPosition - 1, mentionPosition));
      return;
    }

    if (mentionMenu.open) closeMentionMenu();
  }

  function handlePromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!mentionMenu.open || !mentionAssets.length) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedMentionIndex((current) => (current < mentionAssets.length - 1 ? current + 1 : 0));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedMentionIndex((current) => (current > 0 ? current - 1 : mentionAssets.length - 1));
      return;
    }

    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      const selectedAsset = mentionAssets[selectedMentionIndex];
      if (selectedAsset) insertMention(selectedAsset, event.currentTarget);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeMentionMenu();
    }
  }

  function handleMediaDrag(event: DragEvent<HTMLDivElement>) {
    if (!hasMediaDataTransfer(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDropActive(true);
    if (isCollapsedRef.current) {
      forceExpandedRef.current = true;
      setIsCollapsed(false);
    }
  }

  function handleMediaDragLeave(event: DragEvent<HTMLDivElement>) {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setIsDropActive(false);
  }

  function handleMediaDrop(event: DragEvent<HTMLDivElement>) {
    if (!hasMediaDataTransfer(event.dataTransfer)) return;
    event.preventDefault();
    setIsDropActive(false);
    addDroppedSlotFiles(Array.from(event.dataTransfer.files));
  }

  async function refreshViduTask(localTaskId: string, providerTaskId: string, startedAt: number, showToastOnProgress = false) {
    try {
      const response = await fetch(`/api/vidu/tasks/${encodeURIComponent(providerTaskId)}`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const result = (await response.json()) as ViduTaskResponse;
      const nextStatus = mapViduState(result.state);
      const output = getViduOutput(kind, result);
      const nextProgress = getViduProgress(nextStatus, startedAt);
      const errorMessage = nextStatus === "failed" ? result.errCode || "Vidu 任务生成失败。" : undefined;

      onStateChange(kind, (current) =>
        updateTask(current, localTaskId, {
          status: nextStatus,
          progress: nextProgress,
          credits: result.credits ?? current.history.find((task) => task.id === localTaskId)?.credits ?? credits,
          durationLabel: nextStatus === "succeeded" || nextStatus === "failed" ? getElapsedLabel(startedAt) : undefined,
          errorMessage,
          output: {
            ...(current.history.find((task) => task.id === localTaskId)?.output ?? {
              kind,
              title: `${kind === "video" ? "Video" : "Image"} draft`
            }),
            ...output
          }
        })
      );

      if (showToastOnProgress) {
        onToast(nextStatus === "succeeded" ? "Vidu 生成已完成" : `Vidu 任务状态：${statusCopy[nextStatus]}`);
      }

      return nextStatus === "succeeded" || nextStatus === "failed";
    } catch (error) {
      onStateChange(kind, (current) =>
        updateTask(current, localTaskId, {
          status: "failed",
          progress: 100,
          durationLabel: getElapsedLabel(startedAt),
          errorMessage: getErrorMessage(error)
        })
      );
      onToast(getErrorMessage(error));
      return true;
    }
  }

  function scheduleViduPoll(localTaskId: string, providerTaskId: string, startedAt: number, delay = 2400) {
    const timeoutId = window.setTimeout(async () => {
      pollTimeouts.current = pollTimeouts.current.filter((item) => item !== timeoutId);
      const isDone = await refreshViduTask(localTaskId, providerTaskId, startedAt);
      if (!isDone) {
        scheduleViduPoll(localTaskId, providerTaskId, startedAt, 3200);
      }
    }, delay);

    pollTimeouts.current.push(timeoutId);
  }

  async function submit() {
    if (!canSubmit) {
      if (!hasPrompt) {
        onToast("请先输入生成描述");
      } else {
        onToast(`${selectedMode.label} 至少需要一个参考素材`);
      }
      return;
    }

    const startedAt = Date.now();
    const task = createPendingTask({
      activeSlots,
      credits,
      kind,
      modeKey: selectedMode.key,
      modeLabel: selectedMode.label,
      modelId: selectedModel.id,
      modelName: selectedModel.displayName,
      paramValues: state.paramValues,
      prompt: state.prompt.trim(),
      slots: state.slots
    });

    const shouldKeepBottomPinned = isNearPageBottom();

    onStateChange(kind, (current) => ({ ...current, history: [...current.history, task] }));
    onToast(kind === "video" ? "正在提交 Vidu 视频任务" : "正在提交 Vidu 图片任务");
    if (shouldKeepBottomPinned) {
      scrollToGenerationBottomAfterLayout("auto");
    }

    try {
      const slotPayloads = await buildViduSlotPayloads(activeSlotUploads);

      onStateChange(kind, (current) => updateTask(current, task.id, { status: "running", progress: 16 }));

      const response = await fetch("/api/vidu/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          kind,
          modeKey: selectedMode.key,
          modelId: selectedModel.id,
          prompt: state.prompt.trim(),
          params: state.paramValues,
          slots: slotPayloads
        })
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const result = (await response.json()) as ViduGenerateResponse;
      const nextStatus = mapViduState(result.state);

      onStateChange(kind, (current) =>
        updateTask(current, task.id, {
          providerTaskId: result.taskId,
          modelName: selectedModel.displayName,
          status: nextStatus,
          progress: getViduProgress(nextStatus, startedAt),
          credits: result.credits ?? task.credits,
          createdAt: result.createdAt ? "Just now" : task.createdAt
        })
      );
      onToast(`已提交 Vidu 任务 ${result.taskId.slice(0, 8)}`);
      scheduleViduPoll(task.id, result.taskId, startedAt);
    } catch (error) {
      onStateChange(kind, (current) =>
        updateTask(current, task.id, {
          status: "failed",
          progress: 100,
          durationLabel: getElapsedLabel(startedAt),
          errorMessage: getErrorMessage(error)
        })
      );
      onToast(getErrorMessage(error));
    }
  }

  submitRef.current = submit;

  useEffect(() => {
    if (!active || autoSubmitToken === null) return undefined;
    if (autoSubmitHandledRef.current === autoSubmitToken) return undefined;

    const frameId = window.requestAnimationFrame(() => {
      if (autoSubmitHandledRef.current === autoSubmitToken) return;
      autoSubmitHandledRef.current = autoSubmitToken;
      void submitRef.current();
      scrollToGenerationBottomAfterLayout("smooth");
      onAutoSubmitHandled?.(kind, autoSubmitToken);
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [active, autoSubmitToken, kind, onAutoSubmitHandled]);

  function renderParamOptions(param: GenerationParam) {
    if (!param.options?.length) {
      const value = state.paramValues[param.id];
      return (
        <div className="composer-field-control">
          <input
            type={param.component === "number" ? "number" : "text"}
            min={param.min}
            max={param.max}
            step={param.step}
            placeholder="Auto"
            value={typeof value === "string" || typeof value === "number" ? value : ""}
            onChange={(event) => {
              const nextValue = param.component === "number" ? Number(event.target.value) : event.target.value;
              setParamValue(param.id, event.target.value === "" ? undefined : nextValue);
            }}
          />
          {param.helper ? <small>{param.helper}</small> : null}
        </div>
      );
    }

    return param.options.map((option) => (
      <button
        className={`dropdown-item ${state.paramValues[param.id] === option.value ? "active" : ""}`}
        type="button"
        key={`${param.id}-${String(option.value)}`}
        onClick={() => {
          setParamValue(param.id, option.value);
          setOpenMenu(null);
        }}
      >
        <span>{option.label}</span>
        {state.paramValues[param.id] === option.value ? <Check size={14} /> : null}
      </button>
    ));
  }

  function getTaskRenderKey(task: GenerationTask, index: number) {
    return task.providerTaskId ? `provider:${task.providerTaskId}` : `local:${task.id}:${task.createdAt}:${index}`;
  }

  function renderTask(task: GenerationTask, index: number) {
    const taskTypeLabel = task.kind === "video" ? "Video" : "Image";
    const outputPreview = getTaskOutputPreviewItem(task);
    const outputClassName = `generation-task-output is-${task.kind} is-${task.status} ${outputPreview ? "is-preview-ready is-detail-ready" : ""}`;
    const outputContent = (
      <>
        {isGeneratingStatus(task.status) ? (
          <div className="generation-generating-shell">
            <div className="generation-generating-spinner" />
            <span>
              {task.status === "queued" ? "任务已进入队列" : "生成中"}，进度 {task.progress}%
            </span>
            <div className="generation-progress-bar" aria-hidden="true">
              <span style={{ width: `${task.progress}%` }} />
            </div>
          </div>
        ) : null}

        {task.status === "failed" ? (
          <div className="generation-failed-shell">
            <X size={18} />
            <span>{task.errorMessage || "生成失败，请调整 prompt 或参数后重试。"}</span>
          </div>
        ) : null}

        {!isGeneratingStatus(task.status) && task.status !== "failed" && task.output.assetUrl ? (
          <>
            <span className="generation-output-media" style={{ backgroundImage: `url(${task.output.assetUrl})` }} />
            {task.kind === "video" ? (
              <span className="generation-play-chip" aria-hidden="true">
                <Play size={13} />
              </span>
            ) : null}
          </>
        ) : null}
      </>
    );

    return (
      <article className={`generation-task-item is-${task.status}`} key={getTaskRenderKey(task, index)}>
        <div className="generation-task-header">
          <div className="generation-task-refs" aria-label="Task reference assets">
            {task.slots.length ? (
              task.slots.slice(0, 4).map((slot) => {
                const slotPreview = getSlotPreviewItem(slot);

                return slotPreview ? (
                  <button
                    className="generation-task-ref-thumb is-clickable"
                    type="button"
                    title={slot.fileName || slot.label}
                    key={slot.id}
                    onClick={() => setPreviewItem(slotPreview)}
                  >
                    {slot.previewUrl ? <span style={{ backgroundImage: `url(${slot.previewUrl})` }} /> : slot.kind === "video" ? <Video size={17} /> : <ImageIcon size={17} />}
                  </button>
                ) : (
                  <span className="generation-task-ref-thumb" title={slot.label} key={slot.id}>
                    {slot.kind === "video" ? <Video size={17} /> : <ImageIcon size={17} />}
                  </span>
                );
              })
            ) : (
              <span className="generation-task-ref-thumb is-empty">
                {task.kind === "video" ? <Video size={17} /> : <ImageIcon size={17} />}
              </span>
            )}
          </div>

          <div className="generation-task-header-right">
            <GenerationTaskPrompt prompt={task.prompt} />
            <div className="generation-task-meta">
              <span>{taskTypeLabel}</span>
              <span className="generation-task-meta-sep" />
              <span>{task.modelName}</span>
              <span className="generation-task-meta-sep" />
              <span>{task.modeLabel}</span>
              <span className={`generation-status-badge is-${task.status}`}>{statusCopy[task.status]}</span>
            </div>
          </div>
        </div>

        {outputPreview ? (
          <button className={outputClassName} data-kind={task.kind} type="button" aria-label="Open generation detail" onClick={() => setDetailTask(task)}>
            {outputContent}
          </button>
        ) : (
          <div className={outputClassName} data-kind={task.kind}>
            {outputContent}
          </div>
        )}

        <div className="generation-task-footer">
          <span className="generation-task-time">
            {task.createdAt} · {task.credits} credits{task.durationLabel ? ` · ${task.durationLabel}` : ""}
          </span>
          <div className="generation-task-actions">
            {isGeneratingStatus(task.status) ? (
              <button
                className="task-action-btn"
                type="button"
                onClick={() => {
                  if (!task.providerTaskId) {
                    onToast("等待 Vidu 返回任务 ID");
                    return;
                  }
                  void refreshViduTask(task.id, task.providerTaskId, Date.now(), true);
                }}
              >
                <RefreshCw size={13} />
                刷新
              </button>
            ) : null}
            {task.status === "succeeded" ? (
              <>
                <button
                  className="task-action-btn"
                  type="button"
                  onClick={() => {
                    const downloadUrl = task.output.downloadUrl ?? task.output.assetUrl;
                    if (!downloadUrl) {
                      onToast("生成物暂无可下载 URL");
                      return;
                    }
                    window.open(downloadUrl, "_blank", "noopener,noreferrer");
                  }}
                >
                  <Download size={13} />
                  下载
                </button>
                <button
                  className="task-action-btn"
                  type="button"
                  onClick={() => {
                    patch({
                      prompt: task.prompt,
                      modelId: task.modelId,
                      modeKey: task.modeKey,
                      paramValues: task.params,
                      slots: task.slots
                    });
                    scrollToGenerationBottomAfterLayout("auto");
                  }}
                >
                  <RefreshCw size={13} />
                  再次生成
                </button>
              </>
            ) : null}
          </div>
        </div>
      </article>
    );
  }

  return (
    <section id={kind} className={`view ${active ? "is-active" : ""}`} aria-label={kind === "video" ? "Ad Video" : "Ad Image"}>
      <section className="custom-generator generation-composer-surface" data-generator={kind}>
        <div className="generation-stage-head">
          <div className="generation-stage-stats" aria-label="Generation summary">
            <span>
              <Layers3 size={14} />
              {catalog.models.length} models
            </span>
            <span>
              <Clock3 size={14} />
              {state.history.length} tasks
            </span>
            <span>
              <Sparkles size={14} />
              {credits} credits
            </span>
          </div>
        </div>

        <div className="generator-history generation-history-board">
          {state.history.length ? (
            <div className="generation-history-stream">{state.history.map(renderTask)}</div>
          ) : (
            <div className="history-empty">
              <span className="history-spark" aria-hidden="true">
                <Sparkles size={20} />
              </span>
              <p>{catalog.historyEmpty}</p>
            </div>
          )}
        </div>

        <div className="generator-dialog-wrapper">
          <div
            ref={composerRef}
            className={`composer-dialog generation-composer-dialog ${isCollapsed ? "collapsed" : ""} ${isDropActive ? "is-drop-active" : ""}`}
            data-composer={kind}
            onDragEnter={handleMediaDrag}
            onDragOver={handleMediaDrag}
            onDragLeave={handleMediaDragLeave}
            onDrop={handleMediaDrop}
          >
            {isDropActive ? (
              <div className="input-drop-overlay" aria-hidden="true">
                <Upload size={18} />
                <span>{kind === "video" ? "松开上传图片或视频" : "松开上传参考图"}</span>
              </div>
            ) : null}
            <button
              className={`return-btn ${isCollapsed ? "visible" : ""}`}
              type="button"
              onClick={() => {
                forceExpandedRef.current = false;
                setIsCollapsed(false);
                scrollToGenerationBottomAfterLayout("smooth");
              }}
            >
              回到底部
              <ArrowDown size={12} aria-hidden="true" />
            </button>

            <div className="composer-main-area">
              <div
                className="composer-slots-row"
                aria-label={`${kind} reference inputs`}
                onMouseDownCapture={() => {
                  if (isCollapsedRef.current) {
                    forceExpandedRef.current = true;
                    setIsCollapsed(false);
                  }
                }}
              >
                {activeSlots.map((slot) => {
                  const uploads = state.slots.filter((item) => item.slotKey === slot.key);

                  return (
                    <GenerationSlotStack
                      isCollapsedDialog={isCollapsed}
                      key={slot.key}
                      slot={slot}
                      uploads={uploads}
                      onFilesSelected={(files) => addSlotFiles(slot, files)}
                      onPreviewUpload={(input) => {
                        const preview = getSlotPreviewItem(input);
                        if (preview) setPreviewItem(preview);
                      }}
                      onRemoveUpload={(input) => removeSlot(input.id)}
                    />
                  );
                })}
              </div>

              <div className="composer-prompt-area">
                <textarea
                  ref={promptRef}
                  id={`${kind}-prompt`}
                  className="composer-prompt"
                  placeholder={catalog.placeholder}
                  value={state.prompt}
                  onChange={handlePromptChange}
                  onFocus={() => {
                    setOpenMenu(null);
                    if (isCollapsedRef.current) {
                      forceExpandedRef.current = true;
                      setIsCollapsed(false);
                    }
                  }}
                  onKeyDown={handlePromptKeyDown}
                  onPointerDown={() => setOpenMenu(null)}
                />
                {mentionMenu.open && mentionMenu.anchor === "prompt" ? (
                  <GenerationImageMentionMenu
                    assets={mentionAssets}
                    insertAsset={(asset) => insertMention(asset, promptRef.current)}
                    itemRefs={mentionItemRefs}
                    menu={mentionMenu}
                    menuRef={mentionMenuRef}
                    selectedIndex={selectedMentionIndex}
                    setSelectedIndex={setSelectedMentionIndex}
                  />
                ) : null}
              </div>
            </div>

            <div className="generation-composer-context">
              <span>{selectedModel.description}</span>
              {internalParams.length ? <span>{internalParams.length} internal param reserved</span> : null}
            </div>

            <div className="composer-bottom-bar">
              <div className="composer-dropdown">
                <button className="pill-btn" type="button" onClick={() => setOpenMenu(openMenu === "task" ? null : "task")}>
                  {kind === "video" ? <Video size={16} /> : <ImageIcon size={16} />}
                  <span>{catalog.taskLabel}</span>
                  <span className="chevron">▾</span>
                </button>
                <div className={`composer-menu ${openMenu === "task" ? "open" : ""}`}>
                  <div className="menu-title">任务类型</div>
                  <button className={`dropdown-item ${kind === "video" ? "active" : ""}`} type="button" onClick={() => onRouteChange("video")}>
                    <span>视频生成</span>
                    {kind === "video" ? <Check size={14} /> : null}
                  </button>
                  <button className={`dropdown-item ${kind === "image" ? "active" : ""}`} type="button" onClick={() => onRouteChange("image")}>
                    <span>图像生成</span>
                    {kind === "image" ? <Check size={14} /> : null}
                  </button>
                </div>
              </div>

              <div className="composer-dropdown">
                <button className="pill-btn" type="button" onClick={() => setOpenMenu(openMenu === "model" ? null : "model")}>
                  <span className="dot" />
                  <span data-model-label>{selectedModel.displayName}</span>
                  <span className="chevron">▾</span>
                </button>
                <div className={`composer-menu model-menu ${openMenu === "model" ? "open" : ""}`}>
                  <div className="menu-title">模型</div>
                  {catalog.models.map((model) => (
                    <button
                      className={`dropdown-item model-dropdown-item ${selectedModel.id === model.id ? "active" : ""}`}
                      type="button"
                      key={model.id}
                      onClick={() => selectModel(model.id)}
                    >
                      <span>
                        <strong>{model.displayName}</strong>
                        <small>{model.provider}</small>
                      </span>
                      {selectedModel.id === model.id ? <Check size={14} /> : null}
                    </button>
                  ))}
                </div>
              </div>

              {compatibleModes.length ? (
                <div className="composer-dropdown">
                  <button className="pill-btn" type="button" onClick={() => setOpenMenu(openMenu === "mode" ? null : "mode")}>
                    <span>{selectedMode.label}</span>
                    <span className="chevron">▾</span>
                  </button>
                  <div className={`composer-menu ${openMenu === "mode" ? "open" : ""}`}>
                    <div className="menu-title">{kind === "video" ? "视频模式" : "图片模式"}</div>
                    {compatibleModes.map((mode) => (
                      <button
                        className={`dropdown-item ${selectedMode.key === mode.key ? "active" : ""}`}
                        type="button"
                        key={mode.key}
                        onClick={() => selectMode(mode.key)}
                      >
                        <span>{mode.label}</span>
                        {selectedMode.key === mode.key ? <Check size={14} /> : null}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {basicParams.map((param) => (
                <div className="composer-dropdown" key={param.id}>
                  <button className="pill-btn config-pill-btn" type="button" onClick={() => setOpenMenu(openMenu === `param:${param.id}` ? null : `param:${param.id}`)}>
                    <span className="config-summary-label">{param.label}</span>
                    <span className="config-summary-sep">·</span>
                    <span>{getParamDisplayValue(param, state.paramValues[param.id])}</span>
                    <span className="chevron">▾</span>
                  </button>
                  <div className={`composer-menu config-menu ${openMenu === `param:${param.id}` ? "open" : ""}`}>
                    <div className="menu-title">{param.label}</div>
                    {renderParamOptions(param)}
                  </div>
                </div>
              ))}

              <div className="spacer" />

              <div className="composer-right-actions">
                <span className="token-count">
                  <Sparkles size={13} />
                  <span>{canSubmit ? credits : 0}</span>
                </span>
                <button className="send-btn" type="button" aria-label={kind === "video" ? "生成视频" : "生成图片"} disabled={!canSubmit} onClick={submit}>
                  <ArrowUp size={16} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
      <GenerationDetailOverlay task={detailTask} onClose={() => setDetailTask(null)} onPreviewMedia={setPreviewItem} />
      <GenerationPreviewOverlay item={previewItem} onClose={() => setPreviewItem(null)} />
    </section>
  );
}
