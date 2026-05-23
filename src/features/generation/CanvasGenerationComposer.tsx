"use client";

import { Check, Image as ImageIcon, Sparkles, Video, ArrowUp } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CanvasNode, CanvasNodeSettings } from "@/lib/domain/schemas";
import { CanvasMediaPreviewOverlay, isPlayableVideoSrc, type CanvasMediaPreviewItem } from "@/features/canvas/CanvasMediaPreview";
import {
  estimateGenerationCredits,
  generationDefaults,
  getActiveGenerationParams,
  getActiveGenerationSlots,
  getDefaultGenerationModel,
  getDefaultGenerationParamValues,
  getGenerationMode,
  getGenerationModel
} from "@/lib/mock-data";
import type {
  GenerationKind,
  GenerationModeKey,
  GenerationParam,
  GenerationParamValue,
  GenerationSlot,
  GenerationSlotInput
} from "./types";
import { getMediaFileKind } from "./slot-inputs";
import { GenerationSlotStack } from "./GenerationSlotStack";
import {
  buildViduSlotPayloads,
  getElapsedLabel,
  getErrorMessage,
  getViduOutput,
  getViduProgress,
  isImageOrVideoDataUrl,
  mapViduState,
  readApiError,
  type ViduGenerateResponse,
  type ViduTaskResponse
} from "./vidu-client";

type CanvasGenerationComposerProps = {
  node: CanvasNode;
  parentNodes: CanvasNode[];
  onDisconnectParentRef: (sourceNodeId: string, targetNodeId: string) => void;
  onStart: (input: { prompt: string; model: string; settings: CanvasNodeSettings }) => void;
  onComplete: (result: {
    content: string;
    assetUrl?: string;
    downloadUrl?: string;
    providerTaskId?: string;
    model: string;
    time: string;
    cost: string;
    params: Record<string, GenerationParamValue>;
    slots: GenerationSlotInput[];
  }) => void;
  onFail: (errorMessage: string) => void;
};

type ComposerState = {
  prompt: string;
  modelId: string;
  modeKey: GenerationModeKey;
  paramValues: Record<string, GenerationParamValue>;
};

const previewAssetMap: Record<string, string> = {
  "app-ui": "/assets/asset-app-ui.png",
  character: "/assets/asset-thai-mother.png",
  scene: "/assets/asset-bangkok-street.png",
  storyboard: "/assets/asset-storyboard-c1.png",
  "competitor-video": "/assets/asset-competitor-video.png",
  "final-video": "/assets/preview-video-ugc.png"
};

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("素材读取失败，请重新选择文件。"));
    });
    reader.addEventListener("error", () => reject(new Error("素材读取失败，请重新选择文件。")));
    reader.readAsDataURL(file);
  });
}

function isMediaNode(node: CanvasNode) {
  return node.kind === "image" || node.kind === "video" || node.kind === "upload";
}

function isVideoUrl(value: string | undefined) {
  return /\.(mp4|mov|webm)(\?|#|$)/i.test(value ?? "") || /^data:video\//i.test(value ?? "");
}

function getPrimaryVersion(node: CanvasNode) {
  return node.versions.find((version) => version.id === node.primaryVersionId) ?? node.versions[0] ?? null;
}

function canUsePreviewClassFallback(node: CanvasNode) {
  return !["draft", "queued", "running", "failed", "pending"].includes(node.status);
}

function getNodeAssetUrl(node: CanvasNode) {
  const version = getPrimaryVersion(node);
  return version?.assetUrl ?? node.settings?.assetUrl ?? (canUsePreviewClassFallback(node) ? previewAssetMap[node.previewClass] : undefined);
}

function getNodeDownloadUrl(node: CanvasNode) {
  const version = getPrimaryVersion(node);
  return version?.downloadUrl ?? node.settings?.downloadUrl ?? version?.assetUrl ?? node.settings?.assetUrl;
}

function mapNodeToSlotKey(kind: GenerationKind, node: CanvasNode): GenerationSlotInput["slotKey"] {
  if (kind === "image") {
    return "reference_image";
  }

  if (node.kind === "video" && isVideoUrl(getNodeDownloadUrl(node))) return "reference_video";
  if (node.businessType === "storyboard_frame" || node.previewClass === "storyboard") return "start_frame";
  if (node.businessType === "product_asset" || node.previewClass === "app-ui") return "product_image";
  return "product_image";
}

function canvasNodeToSlotInput(kind: GenerationKind, node: CanvasNode): GenerationSlotInput | null {
  if (!isMediaNode(node)) return null;

  const slotKey = mapNodeToSlotKey(kind, node);
  const assetUrl = slotKey === "reference_video" ? getNodeDownloadUrl(node) : getNodeAssetUrl(node);
  if (!assetUrl) return null;

  return {
    id: `canvas-${node.id}`,
    slotKey,
    kind: slotKey === "reference_video" ? "video" : "image",
    label: node.title,
    fileName: node.title,
    previewUrl: assetUrl,
    status: "referenced"
  };
}

async function cacheGeneratedImageAsset(assetUrl: string | undefined) {
  if (!assetUrl || isImageOrVideoDataUrl(assetUrl)) return assetUrl;

  try {
    const response = await fetch("/api/media/data-url", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ url: assetUrl })
    });
    if (!response.ok) return assetUrl;

    const data = (await response.json()) as { dataUrl?: string };
    return isImageOrVideoDataUrl(data.dataUrl) ? data.dataUrl : assetUrl;
  } catch {
    return assetUrl;
  }
}

function getParamDisplayValue(param: GenerationParam, value: GenerationParamValue | undefined) {
  const option = param.options?.find((item) => item.value === value);
  if (option) return option.label;
  if (value === undefined || value === "") return "Auto";
  return String(value);
}

function getSettingParamValue(param: GenerationParam, settings: CanvasNodeSettings | undefined) {
  const rawValue = settings?.[param.id as keyof CanvasNodeSettings];
  if (rawValue === undefined || rawValue === "") return undefined;
  if (param.component === "number") {
    const numericValue = Number(rawValue);
    return Number.isFinite(numericValue) ? numericValue : undefined;
  }
  if (param.component === "switch") return rawValue === "true";
  return rawValue;
}

function createInitialState(node: CanvasNode, kind: GenerationKind): ComposerState {
  const defaultModel = getDefaultGenerationModel(kind);
  const modelId =
    node.settings?.modelId ??
    generationDefaults[kind].models.find((model) => model.displayName === node.model)?.id ??
    defaultModel.id;
  const model = getGenerationModel(kind, modelId);
  const modeKey = (node.settings?.modeKey as GenerationModeKey | undefined) ?? model.defaultModeKey;
  const paramValues = getDefaultGenerationParamValues(model);
  const params = getActiveGenerationParams(kind, model.id, modeKey);

  for (const param of params) {
    const value = getSettingParamValue(param, node.settings);
    if (value !== undefined) {
      paramValues[param.id] = value;
    }
  }

  return {
    prompt: node.settings?.prompt ?? (node.status === "draft" ? "" : node.output ?? ""),
    modelId: model.id,
    modeKey,
    paramValues: {
      ...paramValues,
      internal_source: "canvas"
    }
  };
}

function toCanvasSettings(state: ComposerState): CanvasNodeSettings {
  const settings: CanvasNodeSettings = {
    prompt: state.prompt,
    modelId: state.modelId,
    modeKey: state.modeKey
  };

  for (const [key, value] of Object.entries(state.paramValues)) {
    settings[key] = String(value);
  }

  return settings;
}

function getPreferredVideoModeForInputs(inputs: GenerationSlotInput[]): GenerationModeKey | null {
  if (!inputs.length) return null;
  if (inputs.some((input) => input.slotKey === "end_frame")) return "first-last-frame";
  if (inputs.some((input) => input.kind === "video" || input.slotKey === "reference_video")) return "reference";
  if (inputs.some((input) => input.kind === "image")) return "image-to-video";
  return null;
}

function modeCanKeepInputs(kind: GenerationKind, modeKey: GenerationModeKey, inputs: GenerationSlotInput[]) {
  const mode = getGenerationMode(kind, modeKey);
  return inputs.every((input) => mode.slotKeys.includes(input.slotKey));
}

export function CanvasGenerationComposer({
  node,
  parentNodes,
  onDisconnectParentRef,
  onStart,
  onComplete,
  onFail
}: CanvasGenerationComposerProps) {
  const kind = node.kind as GenerationKind;
  const catalog = generationDefaults[kind];
  const [state, setState] = useState<ComposerState>(() => createInitialState(node, kind));
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [mediaPreview, setMediaPreview] = useState<CanvasMediaPreviewItem | null>(null);
  const [localSlotInputs, setLocalSlotInputs] = useState<GenerationSlotInput[]>([]);
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(node.settings?.errorMessage ?? null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const runningRef = useRef(false);
  const suppressAutoModeRef = useRef(false);

  const selectedModel = getGenerationModel(kind, state.modelId);
  const baseModeKey = selectedModel.modeKeys.includes(state.modeKey) ? state.modeKey : selectedModel.defaultModeKey;
  const allParentSlots = useMemo(
    () =>
      parentNodes
        .map((parent) => canvasNodeToSlotInput(kind, parent))
        .filter((slot): slot is GenerationSlotInput => Boolean(slot)),
    [kind, parentNodes]
  );
  const allInputSlots = useMemo(() => [...allParentSlots, ...localSlotInputs], [allParentSlots, localSlotInputs]);
  const preferredModeKey = getPreferredVideoModeForInputs(allInputSlots);
  const effectiveModeKey =
    kind === "video" &&
    baseModeKey === "text-to-video" &&
    !suppressAutoModeRef.current &&
    preferredModeKey &&
    selectedModel.modeKeys.includes(preferredModeKey) &&
    modeCanKeepInputs(kind, preferredModeKey, allInputSlots)
      ? preferredModeKey
      : baseModeKey;
  const selectedMode = getGenerationMode(kind, effectiveModeKey);
  const activeSlots = useMemo(
    () => getActiveGenerationSlots(kind, selectedModel.id, selectedMode.key),
    [kind, selectedMode.key, selectedModel.id]
  );
  const activeParams = useMemo(
    () => getActiveGenerationParams(kind, selectedModel.id, selectedMode.key),
    [kind, selectedMode.key, selectedModel.id]
  );
  const activeSlotKeys = useMemo(() => new Set(activeSlots.map((slot) => slot.key)), [activeSlots]);
  const parentSlots = useMemo(
    () => allParentSlots.filter((slot) => activeSlotKeys.has(slot.slotKey)),
    [activeSlotKeys, allParentSlots]
  );
  const slots = useMemo(
    () => [
      ...parentSlots,
      ...localSlotInputs.filter((slot) => activeSlotKeys.has(slot.slotKey))
    ],
    [activeSlotKeys, localSlotInputs, parentSlots]
  );
  const allInputSlotSignature = allInputSlots.map((slot) => `${slot.id}:${slot.slotKey}:${slot.kind}`).join("|");
  const compatibleModes = catalog.modes.filter((mode) => selectedModel.modeKeys.includes(mode.key));
  const basicParams = activeParams.filter((param) => param.visibility === "basic");
  const internalParams = activeParams.filter((param) => param.visibility === "internal");
  const credits = estimateGenerationCredits(kind, selectedModel.id, state.paramValues);
  const hasPrompt = state.prompt.trim().length > 0;
  const hasRequiredAssets = selectedMode.allowPromptOnly || slots.length > 0;
  const isLocked = node.locked || node.status === "locked";
  const isRunning = node.status === "running" || runningRef.current;
  const canSubmit = !isLocked && !isRunning && hasPrompt && hasRequiredAssets;

  useEffect(() => {
    if (!allInputSlots.length) suppressAutoModeRef.current = false;
  }, [allInputSlotSignature, allInputSlots.length]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (composerRef.current?.contains(target)) return;

      setOpenMenu(null);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  function previewSlotInput(input: GenerationSlotInput) {
    setMediaPreview({
      kind: input.kind,
      title: input.label || input.fileName,
      src: input.previewUrl,
      posterSrc: input.previewUrl,
      playbackSrc: input.kind === "video" && isPlayableVideoSrc(input.previewUrl) ? input.previewUrl : undefined
    });
  }

  async function uploadSlotFiles(slot: GenerationSlot, fileList: File[] | FileList | null) {
    const files = Array.from(fileList ?? []).filter((file) => getMediaFileKind(file) === slot.kind);
    if (!files.length) return;

    try {
      const parentCount = parentSlots.filter((input) => input.slotKey === slot.key).length;
      const capacity = Math.max(0, slot.max - parentCount);
      if (!capacity) {
        setErrorMessage(`${slot.label} 已达到引用上限`);
        return;
      }

      const pickedFiles = files.slice(0, capacity);
      const inputs = await Promise.all(
        pickedFiles.map(async (file, index) => ({
          id: `local-${slot.key}-${Date.now().toString(36)}-${index}`,
          slotKey: slot.key,
          kind: slot.kind,
          label: slot.label,
          fileName: file.name || `${slot.shortLabel}-${index + 1}`,
          previewUrl: await readFileAsDataUrl(file),
          status: "uploaded" as const
        }))
      );

      setLocalSlotInputs((current) => {
        const otherSlots = current.filter((input) => input.slotKey !== slot.key);
        const sameSlot = slot.max === 1 ? [] : current.filter((input) => input.slotKey === slot.key).slice(0, Math.max(0, capacity - inputs.length));
        return [...otherSlots, ...sameSlot, ...inputs];
      });
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  function removeSlotInput(input: GenerationSlotInput) {
    if (input.id.startsWith("local-")) {
      setLocalSlotInputs((current) => current.filter((item) => item.id !== input.id));
      return;
    }

    onDisconnectParentRef(input.id.replace(/^canvas-/, ""), node.id);
  }

  function patch(patchState: Partial<ComposerState>) {
    setState((current) => ({ ...current, ...patchState }));
  }

  function setParamValue(paramId: string, value: GenerationParamValue | undefined) {
    setState((current) => {
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
    setState((current) => ({
      ...current,
      modelId,
      modeKey,
      paramValues: {
        ...getDefaultGenerationParamValues(model),
        internal_source: "canvas"
      }
    }));
    setOpenMenu(null);
  }

  function removeInputsForMode(modeKey: GenerationModeKey, options: { clearAll?: boolean } = {}) {
    const mode = getGenerationMode(kind, modeKey);
    const allowedSlotKeys = new Set(mode.slotKeys);
    const shouldRemoveInput = (input: GenerationSlotInput) => options.clearAll || !allowedSlotKeys.has(input.slotKey);

    setLocalSlotInputs((current) => current.filter((input) => !shouldRemoveInput(input)));

    const parentNodeIds = new Set(
      allParentSlots
        .filter(shouldRemoveInput)
        .map((input) => input.id.replace(/^canvas-/, ""))
    );

    parentNodeIds.forEach((parentNodeId) => {
      onDisconnectParentRef(parentNodeId, node.id);
    });
  }

  function selectMode(modeKey: GenerationModeKey) {
    if (kind === "video" && modeKey === "text-to-video" && allInputSlots.length > 0) {
      const confirmed = window.confirm("切换为文生视频会断开当前输入参考图/视频，是否继续？");
      if (!confirmed) {
        setOpenMenu(null);
        return;
      }

      suppressAutoModeRef.current = true;
      removeInputsForMode(modeKey, { clearAll: true });
    } else {
      suppressAutoModeRef.current = false;
      removeInputsForMode(modeKey);
    }

    patch({ modeKey });
    setOpenMenu(null);
  }

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
            value={String(value ?? "")}
            onChange={(event) => {
              const nextValue = event.target.value;
              setParamValue(param.id, nextValue === "" ? undefined : param.component === "number" ? Number(nextValue) : nextValue);
            }}
          />
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

  async function waitForViduResult(taskId: string, startedAt: number) {
    for (;;) {
      await sleep(3200);
      let response: Response;
      try {
        response = await fetch(`/api/vidu/tasks/${encodeURIComponent(taskId)}`, { cache: "no-store" });
      } catch {
        throw new Error("生成状态查询失败，请检查本地服务或网络连接。");
      }
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const result = (await response.json()) as ViduTaskResponse;
      const nextStatus = mapViduState(result.state);
      setProgress(getViduProgress(nextStatus, startedAt));

      if (nextStatus === "failed") {
        throw new Error(result.errCode || "Vidu 任务生成失败。");
      }

      if (nextStatus === "succeeded") {
        return result;
      }
    }
  }

  async function submit() {
    if (!hasPrompt) {
      setErrorMessage("请先输入生成描述");
      return;
    }
    if (!hasRequiredAssets) {
      setErrorMessage(`${selectedMode.label} 至少需要一个可用素材引用`);
      return;
    }
    if (!canSubmit) return;

    const startedAt = Date.now();
    const prompt = state.prompt.trim();
    const settings = toCanvasSettings({ ...state, modeKey: selectedMode.key });

    runningRef.current = true;
    setProgress(8);
    setErrorMessage(null);
    onStart({ prompt, model: selectedModel.displayName, settings });

    try {
      const slotPayloads = await buildViduSlotPayloads(slots);
      setProgress(16);
      let response: Response;
      try {
        response = await fetch("/api/vidu/generate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            kind,
            modeKey: selectedMode.key,
            modelId: selectedModel.id,
            prompt,
            params: state.paramValues,
            slots: slotPayloads
          })
        });
      } catch {
        throw new Error("生成请求发送失败，请检查本地服务或网络连接。");
      }

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const result = (await response.json()) as ViduGenerateResponse;
      const taskStatus = mapViduState(result.state);
      setProgress(getViduProgress(taskStatus, startedAt));
      const finalTask: ViduTaskResponse = taskStatus === "succeeded"
        ? { id: result.taskId, state: result.state, credits: result.credits, creations: [] }
        : await waitForViduResult(result.taskId, startedAt);
      const output = getViduOutput(kind, finalTask);
      const assetUrl = output.assetUrl;
      const downloadUrl = output.downloadUrl;
      const stableAssetUrl = kind === "image" ? await cacheGeneratedImageAsset(assetUrl ?? downloadUrl) : assetUrl;

      onComplete({
        content: [
          `${kind === "video" ? "Vidu 视频" : "Vidu 图片"}生成完成。`,
          `Prompt: ${prompt}`,
          `Model: ${selectedModel.displayName}`,
          `Mode: ${selectedMode.label}`
        ].join("\n"),
        assetUrl: stableAssetUrl,
        downloadUrl,
        providerTaskId: result.taskId,
        model: selectedModel.displayName,
        time: getElapsedLabel(startedAt),
        cost: `${result.credits ?? credits} credits`,
        params: state.paramValues,
        slots
      });
      setProgress(100);
    } catch (error) {
      const message = getErrorMessage(error);
      setErrorMessage(message);
      onFail(message);
    } finally {
      runningRef.current = false;
    }
  }

  return (
    <div className="canvas-generation-composer generation-composer-surface" data-generator={kind}>
      <CanvasMediaPreviewOverlay item={mediaPreview} onClose={() => setMediaPreview(null)} />
      <div ref={composerRef} className="composer-dialog generation-composer-dialog" data-composer={kind}>
        <div className="composer-main-area">
          <div className="composer-slots-row" aria-label={`${kind} reference inputs`}>
            {activeSlots.map((slot) => {
              const uploads = slots.filter((item) => item.slotKey === slot.key);

              return (
                <GenerationSlotStack
                  key={slot.key}
                  slot={slot}
                  uploads={uploads}
                  onFilesSelected={(files) => {
                    void uploadSlotFiles(slot, files);
                  }}
                  onPreviewUpload={previewSlotInput}
                  onRemoveUpload={removeSlotInput}
                />
              );
            })}
          </div>

          <div className="composer-prompt-area">
            <textarea
              className="composer-prompt"
              placeholder={catalog.placeholder}
              value={state.prompt}
              disabled={isLocked}
              onChange={(event) => patch({ prompt: event.target.value })}
              onFocus={() => setOpenMenu(null)}
              onPointerDown={() => setOpenMenu(null)}
            />
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
              <button className="dropdown-item active" type="button">
                <span>{catalog.taskLabel}</span>
                <Check size={14} />
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
            {isRunning ? <span className="canvas-generation-progress">{progress}%</span> : null}
            <span className="token-count">
              <Sparkles size={13} />
              <span>{hasPrompt ? credits : 0}</span>
            </span>
            <button className="send-btn" type="button" aria-label={kind === "video" ? "生成视频" : "生成图片"} disabled={!canSubmit} onClick={submit}>
              <ArrowUp size={16} />
            </button>
          </div>
        </div>

        {errorMessage ? <div className="canvas-generation-error">{errorMessage}</div> : null}
      </div>
    </div>
  );
}
