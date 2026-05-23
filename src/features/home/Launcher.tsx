"use client";

import { ArrowUp, Check, Image as ImageIcon, Link, Loader2, Plus, Sparkles, Trash2, Upload, Video, X } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { GenerationDraft, GenerationKind, GenerationModeKey, GenerationParam, GenerationParamValue, GenerationSlot } from "@/features/generation/types";
import { GenerationImageMentionMenu, type GenerationMentionMenuState } from "@/features/generation/GenerationImageMentionMenu";
import { GenerationSlotStack } from "@/features/generation/GenerationSlotStack";
import {
  assignFilesToGenerationSlots,
  createGenerationSlotInputFromFile,
  filterGenerationSlots,
  getGenerationMentionAssets,
  getGenerationMentionPromptPosition,
  getMediaFileKind,
  getMediaFiles,
  hasMediaDataTransfer,
  revokeGenerationSlotPreview,
  type GenerationMentionAsset
} from "@/features/generation/slot-inputs";
import type { AgentMediaAnalysis, AgentMode, AgentUploadedAsset, AppRoute } from "@/lib/domain/schemas";
import {
  estimateGenerationCredits,
  generationDefaults,
  getActiveGenerationParams,
  getActiveGenerationSlots,
  getDefaultGenerationModel,
  getDefaultGenerationParamValues,
  getGenerationMode,
  getGenerationModel,
  launcherCopy,
  addProductAssetCatalogListener,
  createProductDraftFromExtraction,
  createProductShortName,
  getProductImageDisplayUrl,
  loadProductAssetCatalog,
  saveStoredProductAsset,
  type ProductAssetRecord,
  type ProductImageAsset
} from "@/lib/mock-data";

export type LauncherMode = "agent" | "video" | "image";

type LauncherProps = {
  onRouteChange: (route: AppRoute) => void;
  onStartAgent: (mode: AgentMode, prompt: string, uploadedAssets?: AgentUploadedAsset[]) => void;
  onStartGeneration?: (kind: GenerationKind, draft: GenerationDraft) => void;
  onModeChange?: (mode: LauncherMode) => void;
  promptId?: string;
  showTabs?: boolean;
  ready?: boolean;
};

function getParamDisplayValue(param: GenerationParam, value: GenerationParamValue | undefined) {
  const option = param.options?.find((item) => String(item.value) === String(value));
  return option?.label ?? String(value ?? param.defaultValue ?? "Auto");
}

function createGenerationDraft(kind: GenerationKind): GenerationDraft {
  const model = getDefaultGenerationModel(kind);
  return {
    prompt: "",
    modelId: model.id,
    modeKey: model.defaultModeKey,
    paramValues: getDefaultGenerationParamValues(model),
    slots: []
  };
}

function createProductAgentAsset(product: ProductAssetRecord): AgentUploadedAsset {
  return {
    id: product.id,
    role: "product_pack",
    name: product.name,
    kind: "product",
    source: product.source === "mock" ? "mock" : "upload"
  };
}

function revokeAgentPreviewUrl(previewUrl: string | undefined) {
  if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
}

type MediaAnalyzeResponse = {
  analysis?: AgentMediaAnalysis;
  error?: string;
};

export function Launcher({
  onRouteChange,
  onStartAgent,
  onStartGeneration,
  onModeChange,
  promptId = "launcher-prompt",
  showTabs = true,
  ready = true
}: LauncherProps) {
  const [mode, setMode] = useState<LauncherMode>("agent");
  const [agentMode, setAgentMode] = useState<AgentMode>("clone");
  const [prompt, setPrompt] = useState("");
  const [productCatalog, setProductCatalog] = useState<ProductAssetRecord[]>(() => loadProductAssetCatalog());
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [productUrl, setProductUrl] = useState("");
  const [productDraft, setProductDraft] = useState<ProductAssetRecord | null>(null);
  const [productExtractStatus, setProductExtractStatus] = useState<"idle" | "loading" | "error">("idle");
  const [productExtractMessage, setProductExtractMessage] = useState("");
  const [newProductImageUrl, setNewProductImageUrl] = useState("");
  const [generationDrafts, setGenerationDrafts] = useState<Record<GenerationKind, GenerationDraft>>(() => ({
    video: createGenerationDraft("video"),
    image: createGenerationDraft("image")
  }));
  const [agentAssets, setAgentAssets] = useState<AgentUploadedAsset[]>([]);
  const [generationMenuOpen, setGenerationMenuOpen] = useState<string | null>(null);
  const [activeDropTarget, setActiveDropTarget] = useState<LauncherMode | null>(null);
  const agentPreviewUrlsRef = useRef<Set<string>>(new Set());
  const agentUploadTimersRef = useRef<Map<string, number>>(new Map());
  const agentAssetIdRef = useRef(0);
  const agentPromptRef = useRef<HTMLTextAreaElement | null>(null);
  const launcherSendPointerHandledRef = useRef(false);
  const generationComposerRef = useRef<HTMLDivElement | null>(null);
  const generationPromptRefs = useRef<Record<GenerationKind, HTMLTextAreaElement | null>>({ video: null, image: null });
  const generationMentionMenuRef = useRef<HTMLDivElement | null>(null);
  const generationMentionItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [generationMentionKind, setGenerationMentionKind] = useState<GenerationKind>("video");
  const [generationMentionStart, setGenerationMentionStart] = useState<number | null>(null);
  const [selectedGenerationMentionIndex, setSelectedGenerationMentionIndex] = useState(0);
  const [generationMentionMenu, setGenerationMentionMenu] = useState<GenerationMentionMenuState>({
    anchor: "prompt",
    open: false,
    position: null
  });
  const isAgent = mode === "agent";
  const generationKind = isAgent ? null : mode;
  const copy = isAgent ? launcherCopy.agent[agentMode] : launcherCopy[mode];
  const agentPendingAsset = agentAssets.find(
    (asset) => asset.uploadStatus === "uploading" || asset.analysisStatus === "running"
  );
  const agentMediaPending = Boolean(agentPendingAsset);
  const agentWorkspacePending = isAgent && !ready;
  const agentPendingLabel = agentPendingAsset?.uploadStatus === "uploading" ? "素材上传中" : "素材解析中";

  useEffect(() => {
    return addProductAssetCatalogListener(() => {
      setProductCatalog(loadProductAssetCatalog());
    });
  }, []);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (generationComposerRef.current?.contains(target)) return;

      setGenerationMenuOpen(null);
      setGenerationMentionStart(null);
      setGenerationMentionMenu((current) => (current.open ? { ...current, open: false } : current));
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  useEffect(() => {
    const trackedPreviewUrls = agentPreviewUrlsRef.current;
    const uploadTimers = agentUploadTimersRef.current;
    return () => {
      for (const previewUrl of trackedPreviewUrls) revokeAgentPreviewUrl(previewUrl);
      trackedPreviewUrls.clear();
      for (const timer of uploadTimers.values()) window.clearTimeout(timer);
      uploadTimers.clear();
    };
  }, []);

  function selectMode(nextMode: LauncherMode) {
    setMode(nextMode);
    onModeChange?.(nextMode);
  }

  function runAction() {
    if (mode === "agent") {
      if (agentWorkspacePending) return;
      const currentPrompt = agentPromptRef.current?.value ?? prompt;
      const runnableAssets = agentMode === "create"
        ? agentAssets.filter((asset) => asset.role !== "competitor_asset")
        : agentAssets;
      onStartAgent(agentMode, currentPrompt.trim(), runnableAssets);
      setPrompt("");
      if (agentPromptRef.current) agentPromptRef.current.value = "";
      setAgentAssets([]);
      setSelectedProductId(null);
      setProductDialogOpen(false);
      setProductUrl("");
      setProductDraft(null);
      setProductExtractStatus("idle");
      setProductExtractMessage("");
      return;
    }
    if (onStartGeneration) {
      onStartGeneration(mode, {
        ...generationDrafts[mode],
        prompt: generationDrafts[mode].prompt.trim()
      });
      return;
    }
    onRouteChange(mode);
  }

  function runPointerAction(event: ReactPointerEvent<HTMLButtonElement>) {
    if (agentMediaPending || agentWorkspacePending) return;
    launcherSendPointerHandledRef.current = true;
    event.preventDefault();
    runAction();
    window.setTimeout(() => {
      launcherSendPointerHandledRef.current = false;
    }, 0);
  }

  function runClickAction() {
    if (launcherSendPointerHandledRef.current) return;
    runAction();
  }

  function menuKey(kind: GenerationKind, key: string) {
    return `${kind}:${key}`;
  }

  function patchGenerationDraft(kind: GenerationKind, patch: Partial<GenerationDraft>) {
    setGenerationDrafts((current) => ({
      ...current,
      [kind]: {
        ...current[kind],
        ...patch
      }
    }));
  }

  function setGenerationParamValue(kind: GenerationKind, paramId: string, value: GenerationParamValue | undefined) {
    setGenerationDrafts((current) => {
      const nextValues = { ...current[kind].paramValues };
      if (value === undefined || value === "") {
        delete nextValues[paramId];
      } else {
        nextValues[paramId] = value;
      }

      return {
        ...current,
        [kind]: {
          ...current[kind],
          paramValues: nextValues
        }
      };
    });
  }

  function selectGenerationModel(kind: GenerationKind, modelId: string) {
    setGenerationDrafts((current) => {
      const draft = current[kind];
      const model = getGenerationModel(kind, modelId);
      const modeKey = model.modeKeys.includes(draft.modeKey) ? draft.modeKey : model.defaultModeKey;

      return {
        ...current,
        [kind]: {
          ...draft,
          modelId,
          modeKey,
          paramValues: getDefaultGenerationParamValues(model),
          slots: filterGenerationSlots(draft.slots, (slot) => model.slotKeys.includes(slot.slotKey))
        }
      };
    });
    setGenerationMenuOpen(null);
  }

  function selectGenerationMode(kind: GenerationKind, modeKey: GenerationModeKey) {
    const selectedMode = getGenerationMode(kind, modeKey);
    setGenerationDrafts((current) => ({
      ...current,
      [kind]: {
        ...current[kind],
        modeKey,
        slots: filterGenerationSlots(current[kind].slots, (slot) => selectedMode.slotKeys.includes(slot.slotKey))
      }
    }));
    setGenerationMenuOpen(null);
  }

  function addGenerationSlotFiles(kind: GenerationKind, slot: GenerationSlot, files: File[]) {
    setGenerationDrafts((current) => {
      const draft = current[kind];
      const currentCount = draft.slots.filter((item) => item.slotKey === slot.key).length;
      const acceptedFiles = files.slice(0, Math.max(0, slot.max - currentCount));
      if (!acceptedFiles.length) return current;

      return {
        ...current,
        [kind]: {
          ...draft,
          slots: [
            ...draft.slots,
            ...acceptedFiles.map((file, index) => createGenerationSlotInputFromFile(slot, file, currentCount + index))
          ]
        }
      };
    });
  }

  function addDroppedGenerationFiles(kind: GenerationKind, files: File[]) {
    setGenerationDrafts((current) => {
      const draft = current[kind];
      const catalog = generationDefaults[kind];
      const model = getGenerationModel(kind, draft.modelId);
      const assignment = assignFilesToGenerationSlots({
        kind,
        model,
        modes: catalog.modes,
        slots: catalog.slots,
        modeKey: draft.modeKey,
        existingInputs: draft.slots,
        files
      });

      if (!assignment.assignments.length) return current;

      const nextMode = getGenerationMode(kind, assignment.modeKey);
      const baseSlots =
        assignment.modeKey === draft.modeKey
          ? draft.slots
          : filterGenerationSlots(
              draft.slots,
              (slot) => nextMode.slotKeys.includes(slot.slotKey) && model.slotKeys.includes(slot.slotKey)
            );

      return {
        ...current,
        [kind]: {
          ...draft,
          modeKey: assignment.modeKey,
          slots: [
            ...baseSlots,
            ...assignment.assignments.map(({ slot, file, index }) => createGenerationSlotInputFromFile(slot, file, index))
          ]
        }
      };
    });
    setGenerationMenuOpen(null);
    closeGenerationMentionMenu();
  }

  function removeGenerationSlot(kind: GenerationKind, inputId: string) {
    const removedSlot = generationDrafts[kind].slots.find((slot) => slot.id === inputId);
    if (removedSlot) revokeGenerationSlotPreview(removedSlot);
    patchGenerationDraft(kind, {
      slots: generationDrafts[kind].slots.filter((slot) => slot.id !== inputId)
    });
  }

  function closeGenerationMentionMenu() {
    setGenerationMentionMenu((current) => ({ ...current, open: false }));
    setGenerationMentionStart(null);
  }

  function openGenerationMentionMenu(
    kind: GenerationKind,
    anchor: GenerationMentionMenuState["anchor"],
    mentionStartPos: number | null = null,
    position: GenerationMentionMenuState["position"] = null
  ) {
    setGenerationMenuOpen(null);
    setGenerationMentionKind(kind);
    setGenerationMentionStart(mentionStartPos);
    setSelectedGenerationMentionIndex(0);

    setGenerationMentionMenu({
      anchor,
      open: true,
      position: anchor === "prompt" ? position : null
    });
  }

  function insertGenerationMention(kind: GenerationKind, asset: GenerationMentionAsset, textarea: HTMLTextAreaElement | null) {
    const promptValue = generationDrafts[kind].prompt;
    const reference = `@${asset.id} `;
    const selectionStart = textarea?.selectionStart ?? promptValue.length;
    const selectionEnd = textarea?.selectionEnd ?? selectionStart;
    const shouldReplacePreviousAt = generationMentionStart === null && selectionStart === selectionEnd && selectionStart > 0 && promptValue[selectionStart - 1] === "@";
    const start = generationMentionStart ?? (shouldReplacePreviousAt ? selectionStart - 1 : selectionStart);
    const end = generationMentionStart !== null ? generationMentionStart + 1 : shouldReplacePreviousAt ? selectionStart : selectionEnd;
    const nextPrompt = promptValue.slice(0, start) + reference + promptValue.slice(end);
    const nextCursorPosition = start + reference.length;

    patchGenerationDraft(kind, { prompt: nextPrompt });
    closeGenerationMentionMenu();

    window.setTimeout(() => {
      textarea?.focus();
      textarea?.setSelectionRange(nextCursorPosition, nextCursorPosition);
    }, 0);
  }

  function handleGenerationPromptChange(kind: GenerationKind, event: ChangeEvent<HTMLTextAreaElement>) {
    const nextPrompt = event.target.value;
    const cursorPosition = event.target.selectionStart;
    patchGenerationDraft(kind, { prompt: nextPrompt });

    if (cursorPosition > 0 && nextPrompt[cursorPosition - 1] === "@" && getGenerationMentionAssets(generationDrafts[kind].slots).length > 0) {
      const mentionPosition = getGenerationMentionPromptPosition(event.currentTarget, nextPrompt);
      setGenerationMentionStart(cursorPosition - 1);
      window.requestAnimationFrame(() => openGenerationMentionMenu(kind, "prompt", cursorPosition - 1, mentionPosition));
      return;
    }

    if (generationMentionMenu.open && generationMentionKind === kind) closeGenerationMentionMenu();
  }

  function handleGenerationPromptKeyDown(kind: GenerationKind, event: KeyboardEvent<HTMLTextAreaElement>) {
    const mentionAssets = getGenerationMentionAssets(generationDrafts[kind].slots);
    if (!generationMentionMenu.open || generationMentionKind !== kind || !mentionAssets.length) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedGenerationMentionIndex((current) => (current < mentionAssets.length - 1 ? current + 1 : 0));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedGenerationMentionIndex((current) => (current > 0 ? current - 1 : mentionAssets.length - 1));
      return;
    }

    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      const selectedAsset = mentionAssets[selectedGenerationMentionIndex];
      if (selectedAsset) insertGenerationMention(kind, selectedAsset, event.currentTarget);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeGenerationMentionMenu();
    }
  }

  function clearAgentAssetSideEffects(asset: AgentUploadedAsset | undefined) {
    if (!asset) return;
    const pendingTimer = agentUploadTimersRef.current.get(asset.id);
    if (pendingTimer) {
      window.clearTimeout(pendingTimer);
      agentUploadTimersRef.current.delete(asset.id);
    }
    if (asset.previewUrl) {
      revokeAgentPreviewUrl(asset.previewUrl);
      agentPreviewUrlsRef.current.delete(asset.previewUrl);
    }
  }

  function upsertAgentAsset(asset: AgentUploadedAsset) {
    setAgentAssets((current) => {
      if (asset.role === "reference_asset") return [asset, ...current];

      const replacedAsset = current.find((item) => item.role === asset.role);
      clearAgentAssetSideEffects(replacedAsset);
      return [asset, ...current.filter((item) => item.role !== asset.role)];
    });
  }

  function patchAgentAsset(assetId: string, patch: Partial<AgentUploadedAsset>) {
    setAgentAssets((current) =>
      current.map((asset) => (asset.id === assetId ? { ...asset, ...patch } : asset))
    );
  }

  function markAgentAssetUploaded(assetId: string) {
    const timer = window.setTimeout(() => {
      agentUploadTimersRef.current.delete(assetId);
      patchAgentAsset(assetId, { uploadStatus: "uploaded" });
    }, 450);
    agentUploadTimersRef.current.set(assetId, timer);
  }

  function removeAgentAsset(assetId: string) {
    setAgentAssets((current) => {
      const removedAsset = current.find((asset) => asset.id === assetId);
      clearAgentAssetSideEffects(removedAsset);
      return current.filter((asset) => asset.id !== assetId);
    });
  }

  async function analyzeAgentAsset(asset: AgentUploadedAsset, file: File) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("role", asset.role);
    formData.append("userContext", prompt.trim());

    try {
      const response = await fetch("/api/media/analyze", {
        method: "POST",
        body: formData
      });
      const payload = (await response.json()) as MediaAnalyzeResponse;
      if (!response.ok || !payload.analysis) {
        throw new Error(payload.error ?? "素材解析失败。");
      }

      patchAgentAsset(asset.id, {
        analysisStatus: "succeeded",
        analysis: payload.analysis,
        analysisError: undefined
      });
    } catch (error) {
      patchAgentAsset(asset.id, {
        analysisStatus: "failed",
        analysisError: error instanceof Error ? error.message : "素材解析失败。"
      });
    }
  }

  function handleAgentAssetFile(role: AgentUploadedAsset["role"], file: File) {
    const mediaKind = getMediaFileKind(file);
    const kind: AgentUploadedAsset["kind"] = mediaKind ?? "file";
    const previewUrl = kind === "image" || kind === "video" ? URL.createObjectURL(file) : undefined;
    if (previewUrl) agentPreviewUrlsRef.current.add(previewUrl);
    agentAssetIdRef.current += 1;
    const asset: AgentUploadedAsset = {
      id: `asset-${role}-${file.lastModified}-${agentAssetIdRef.current}`,
      role,
      name: file.name,
      kind,
      source: "upload",
      previewUrl,
      uploadStatus: "uploading",
      analysisStatus: kind === "image" || kind === "video" ? "running" : "idle"
    };
    upsertAgentAsset(asset);
    markAgentAssetUploaded(asset.id);

    if (kind === "image" || kind === "video") void analyzeAgentAsset(asset, file);
  }

  function handleAgentAssetUpload(role: AgentUploadedAsset["role"], fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    handleAgentAssetFile(role, file);
  }

  function addDroppedAgentFiles(files: File[]) {
    const mediaFiles = getMediaFiles(files);
    if (!mediaFiles.length) return;

    if (agentMode === "clone") {
      const [competitorFile, ...referenceFiles] = mediaFiles;
      handleAgentAssetFile("competitor_asset", competitorFile);
      referenceFiles.forEach((file) => handleAgentAssetFile("reference_asset", file));
      return;
    }

    mediaFiles.forEach((file) => handleAgentAssetFile("reference_asset", file));
  }

  function handleMediaDrag(target: LauncherMode, event: DragEvent<HTMLElement>) {
    if (!hasMediaDataTransfer(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setActiveDropTarget(target);
  }

  function handleMediaDragLeave(target: LauncherMode, event: DragEvent<HTMLElement>) {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setActiveDropTarget((current) => (current === target ? null : current));
  }

  function handleAgentDrop(event: DragEvent<HTMLDivElement>) {
    if (!hasMediaDataTransfer(event.dataTransfer)) return;
    event.preventDefault();
    setActiveDropTarget(null);
    addDroppedAgentFiles(Array.from(event.dataTransfer.files));
  }

  function handleGenerationDrop(kind: GenerationKind, event: DragEvent<HTMLDivElement>) {
    if (!hasMediaDataTransfer(event.dataTransfer)) return;
    event.preventDefault();
    setActiveDropTarget(null);
    addDroppedGenerationFiles(kind, Array.from(event.dataTransfer.files));
  }

  function getAssetByRole(role: AgentUploadedAsset["role"]) {
    return agentAssets.find((asset) => asset.role === role);
  }

  function selectProductAsset(product: ProductAssetRecord) {
    setSelectedProductId(product.id);
    upsertAgentAsset(createProductAgentAsset(product));
    setProductDialogOpen(false);
  }

  async function createProductFromUrl() {
    const trimmedUrl = productUrl.trim();
    if (!trimmedUrl) {
      setProductExtractStatus("error");
      setProductExtractMessage("请输入产品链接。");
      return;
    }

    let normalizedUrl = trimmedUrl;
    if (!/^https?:\/\//i.test(normalizedUrl)) normalizedUrl = `https://${normalizedUrl}`;

    try {
      new URL(normalizedUrl);
    } catch {
      setProductExtractStatus("error");
      setProductExtractMessage("产品链接格式不正确。");
      return;
    }

    setProductExtractStatus("loading");
    setProductExtractMessage("");

    try {
      const response = await fetch("/api/product/extract", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ url: normalizedUrl })
      });
      const payload = (await response.json()) as { error?: string; product?: Partial<ProductAssetRecord> & { images?: ProductImageAsset[] } };
      if (!payload.product) throw new Error(payload.error ?? "产品解析失败。");
      setProductDraft(createProductDraftFromExtraction(normalizedUrl, payload.product));
      setProductExtractStatus(payload.error ? "error" : "idle");
      setProductExtractMessage(payload.error ?? "已读取到产品信息，可继续编辑后保存。");
    } catch (error) {
      setProductDraft(null);
      setProductExtractStatus("error");
      setProductExtractMessage(error instanceof Error ? error.message : "产品解析失败。");
    }
  }

  function updateProductDraft(patch: Partial<ProductAssetRecord>) {
    setProductDraft((current) => {
      if (!current) return current;
      const nextProduct = { ...current, ...patch };
      return {
        ...nextProduct,
        shortName: patch.name ? createProductShortName(patch.name) : nextProduct.shortName,
        assets: nextProduct.images.length || nextProduct.assets
      };
    });
  }

  function removeProductImage(imageId: string) {
    if (!productDraft) return;
    updateProductDraft({
      images: productDraft.images.filter((image) => image.id !== imageId)
    });
  }

  function addProductImage() {
    const trimmedUrl = newProductImageUrl.trim();
    if (!trimmedUrl || !productDraft) return;

    try {
      new URL(trimmedUrl);
    } catch {
      setProductExtractStatus("error");
      setProductExtractMessage("图片链接格式不正确。");
      return;
    }

    updateProductDraft({
      images: [
        ...productDraft.images,
        {
          id: `product-image-${Date.now().toString(36)}`,
          url: trimmedUrl,
          alt: `${productDraft.name} product image`
        }
      ]
    });
    setNewProductImageUrl("");
    setProductExtractMessage("");
  }

  function saveProductDraft() {
    if (!productDraft?.name.trim()) {
      setProductExtractStatus("error");
      setProductExtractMessage("产品名称不能为空。");
      return;
    }

    const savedProduct: ProductAssetRecord = {
      ...productDraft,
      name: productDraft.name.trim(),
      shortName: createProductShortName(productDraft.name),
      assets: productDraft.images.length || 1,
      source: "saved"
    };
    const nextCatalog = saveStoredProductAsset(savedProduct);
    setProductCatalog(nextCatalog);
    setProductDraft(null);
    setProductUrl("");
    setProductExtractStatus("idle");
    setProductExtractMessage("产品资产已保存。");
    selectProductAsset(savedProduct);
  }

  function renderAgentAssetPreview(asset: AgentUploadedAsset | undefined) {
    const isBusy = asset?.uploadStatus === "uploading" || asset?.analysisStatus === "running";
    const className = `slot-icon asset-preview-icon ${isBusy ? "is-loading" : ""}`;

    if (asset?.previewUrl && asset.kind === "image") {
      return (
        <span className={className} style={{ backgroundImage: `url(${asset.previewUrl})` }}>
          {isBusy ? (
            <span className="asset-preview-loader" aria-label={agentPendingLabel}>
              <Loader2 className="spin-icon" size={15} />
            </span>
          ) : null}
        </span>
      );
    }

    if (asset?.previewUrl && asset.kind === "video") {
      return (
        <span className={className}>
          <video src={asset.previewUrl} muted playsInline preload="metadata" />
          {isBusy ? (
            <span className="asset-preview-loader" aria-label={agentPendingLabel}>
              <Loader2 className="spin-icon" size={15} />
            </span>
          ) : null}
        </span>
      );
    }

    if (isBusy) {
      return (
        <span className={`${className} asset-uploading-icon`}>
          <Loader2 className="spin-icon" size={16} />
        </span>
      );
    }

    return <span className="slot-icon add-icon">{asset ? <Check size={15} /> : <Upload size={15} />}</span>;
  }

  function getAgentAssetHint(asset: AgentUploadedAsset | undefined, fallback: string) {
    if (!asset) return fallback;
    if (asset.uploadStatus === "uploading") return "上传中";
    if (asset.analysisStatus === "running") return "素材解析中";
    if (asset.uploadStatus === "failed") return "上传失败";
    if (asset.analysisStatus === "failed") return "解析失败，可继续发送";
    return asset.name;
  }

  function renderProductDialog() {
    if (!productDialogOpen) return null;

    return (
      <div className="product-modal-backdrop" role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setProductDialogOpen(false);
      }}>
        <section className="product-modal" role="dialog" aria-modal="true" aria-labelledby="product-modal-title">
          <div className="product-modal-head">
            <div>
              <span className="entry-tag">Product Assets</span>
              <h3 id="product-modal-title">添加产品</h3>
            </div>
            <button className="product-modal-close" type="button" aria-label="关闭产品弹窗" onClick={() => setProductDialogOpen(false)}>
              <X size={18} />
            </button>
          </div>

          <div className="product-link-creator">
            <div className="product-link-input">
              <Link size={16} />
              <input
                type="url"
                placeholder="输入产品链接"
                value={productUrl}
                onChange={(event) => setProductUrl(event.target.value)}
              />
            </div>
            <button className="primary-btn" type="button" onClick={createProductFromUrl} disabled={productExtractStatus === "loading"}>
              {productExtractStatus === "loading" ? <Loader2 className="spin-icon" size={16} /> : <Plus size={16} />}
              创建
            </button>
          </div>

          {productExtractMessage ? (
            <div className={`product-extract-note ${productExtractStatus === "error" ? "is-error" : ""}`}>{productExtractMessage}</div>
          ) : null}

          {productDraft ? (
            <div className="product-draft-editor">
              <div className="product-editor-grid">
                <label>
                  产品名称
                  <input
                    value={productDraft.name}
                    onChange={(event) => updateProductDraft({ name: event.target.value })}
                  />
                </label>
                <label>
                  产品类型
                  <input
                    value={productDraft.type}
                    onChange={(event) => updateProductDraft({ type: event.target.value })}
                  />
                </label>
              </div>
              <label>
                产品介绍
                <textarea
                  value={productDraft.description}
                  onChange={(event) => updateProductDraft({ description: event.target.value, summary: event.target.value })}
                />
              </label>
              <label>
                用户痛点
                <textarea
                  value={productDraft.painPoints}
                  onChange={(event) => updateProductDraft({ painPoints: event.target.value })}
                />
              </label>
              <div className="product-image-editor">
                <div className="product-image-list">
                  {productDraft.images.map((image) => (
                    <div className="product-image-item" key={image.id}>
                      <div className="product-image-preview">
                        {/* eslint-disable-next-line @next/next/no-img-element -- Product asset URLs are user-provided and proxied through /api/product/image. */}
                        <img src={getProductImageDisplayUrl(image.url)} alt={image.alt || productDraft.name} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                      </div>
                      <button type="button" aria-label="删除图片" onClick={() => removeProductImage(image.id)}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                  {!productDraft.images.length ? <div className="product-image-empty">暂无图片</div> : null}
                </div>
                <div className="product-image-add">
                  <input
                    type="url"
                    placeholder="新增图片 URL"
                    value={newProductImageUrl}
                    onChange={(event) => setNewProductImageUrl(event.target.value)}
                  />
                  <button className="ghost-btn" type="button" onClick={addProductImage}>
                    添加图片
                  </button>
                </div>
              </div>
              <div className="product-editor-actions">
                <button className="ghost-btn" type="button" onClick={() => setProductDraft(null)}>
                  取消
                </button>
                <button className="primary-btn" type="button" onClick={saveProductDraft}>
                  保存并选择
                </button>
              </div>
            </div>
          ) : null}

          <div className="product-library-grid" aria-label="历史产品资产">
            {productCatalog.map((product) => (
              <button
                className={`product-library-card ${selectedProductId === product.id ? "is-selected" : ""}`}
                type="button"
                key={product.id}
                onClick={() => selectProductAsset(product)}
              >
                <div
                  className={`product-library-thumb ${product.images[0] ? "has-image" : ""}`}
                  style={product.images[0] ? { backgroundImage: `url(${getProductImageDisplayUrl(product.images[0].url)})` } : undefined}
                >
                  {!product.images[0] ? product.shortName : null}
                </div>
                <div>
                  <strong>{product.name}</strong>
                  <small>{product.type} · {product.assets} assets</small>
                  <p>{product.summary}</p>
                </div>
              </button>
            ))}
          </div>
        </section>
      </div>
    );
  }

  function renderAgentInput() {
    const productAsset = getAssetByRole("product_pack");
    const competitorAsset = getAssetByRole("competitor_asset");
    const referenceAssets = agentAssets.filter((asset) => asset.role === "reference_asset");
    const selectedProduct = productCatalog.find((product) => product.id === productAsset?.id) ?? null;

    return (
      <>
        <div
          className={`launcher-input-shell agent-launcher-shell ${activeDropTarget === "agent" ? "is-drop-active" : ""}`}
          onDragEnter={(event) => handleMediaDrag("agent", event)}
          onDragOver={(event) => handleMediaDrag("agent", event)}
          onDragLeave={(event) => handleMediaDragLeave("agent", event)}
          onDrop={handleAgentDrop}
        >
          {activeDropTarget === "agent" ? (
            <div className="input-drop-overlay" aria-hidden="true">
              <Upload size={18} />
              <span>松开上传图片或视频</span>
            </div>
          ) : null}
          <div className="launcher-main-area agent-main-area">
            <div className={`launcher-assets agent-entry-actions ${agentMode === "create" ? "is-create-mode" : ""}`}>
              <button className={`asset-slot agent-entry-slot ${productAsset ? "is-attached" : ""}`} type="button" onClick={() => setProductDialogOpen(true)}>
                <span className="slot-icon product-entry-icon">{selectedProduct ? selectedProduct.shortName : <Plus size={15} />}</span>
                <span>
                  <strong>添加产品</strong>
                  <small>{productAsset?.name ?? "未选择"}</small>
                </span>
              </button>
              {agentMode === "clone" ? (
                <label className={`asset-slot agent-entry-slot ${competitorAsset ? "is-attached" : ""}`}>
                  <input
                    className="hidden-file-input"
                    type="file"
                    accept="image/*,video/*"
                    onChange={(event) => handleAgentAssetUpload("competitor_asset", event.target.files)}
                  />
                  {renderAgentAssetPreview(competitorAsset)}
                  <span>
                    <strong>添加复刻素材</strong>
                    <small>{getAgentAssetHint(competitorAsset, "图片 / 视频")}</small>
                  </span>
                </label>
              ) : null}
            </div>

            <div className="launcher-prompt-area">
              <textarea
                ref={agentPromptRef}
                id={promptId}
                className="launcher-prompt"
                aria-label="Task prompt"
                placeholder={copy.placeholder}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
              />
              {referenceAssets.length ? (
                <div className="agent-drop-asset-row" aria-label="已拖入参考素材">
                  {referenceAssets.map((asset) => (
                    <span className="agent-drop-asset-chip" key={asset.id} title={asset.name}>
                      {asset.kind === "video" ? <Video size={12} /> : <ImageIcon size={12} />}
                      <span>{asset.name}</span>
                      <button type="button" aria-label={`移除${asset.name}`} onClick={() => removeAgentAsset(asset.id)}>
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className="launcher-controls agent-launcher-controls">
            {agentWorkspacePending || agentMediaPending ? (
              <span className="agent-send-status" role="status">
                <Loader2 className="spin-icon" size={14} />
                {agentWorkspacePending ? "正在恢复会话" : agentPendingLabel}
              </span>
            ) : null}
            <button
              className="launcher-send"
              type="button"
              aria-label={copy.cta}
              title={
                agentWorkspacePending
                  ? "正在恢复会话，稍后可创建任务"
                  : agentMediaPending
                    ? `${agentPendingLabel}，完成后可创建任务`
                    : copy.cta
              }
              onPointerDown={runPointerAction}
              onClick={runClickAction}
              disabled={agentMediaPending || agentWorkspacePending}
            >
              {agentMediaPending || agentWorkspacePending ? <Loader2 className="spin-icon" size={17} /> : <ArrowUp size={18} />}
            </button>
          </div>
        </div>

        <div className="agent-material-mode-switch" aria-label="广告素材工作方式">
          <button
            className={agentMode === "clone" ? "is-active" : ""}
            type="button"
            onClick={() => setAgentMode("clone")}
          >
            克隆广告素材
          </button>
          <button
            className={agentMode === "create" ? "is-active" : ""}
            type="button"
            onClick={() => setAgentMode("create")}
          >
            创作广告素材
          </button>
        </div>
      </>
    );
  }

  function renderGenerationInput(kind: GenerationKind) {
    const catalog = generationDefaults[kind];
    const draft = generationDrafts[kind];
    const selectedModel = getGenerationModel(kind, draft.modelId);
    const selectedMode = selectedModel.modeKeys.includes(draft.modeKey)
      ? getGenerationMode(kind, draft.modeKey)
      : getGenerationMode(kind, selectedModel.defaultModeKey);
    const compatibleModes = catalog.modes.filter((item) => selectedModel.modeKeys.includes(item.key));
    const activeSlots = getActiveGenerationSlots(kind, selectedModel.id, selectedMode.key);
    const activeParams = getActiveGenerationParams(kind, selectedModel.id, selectedMode.key);
    const basicParams = activeParams.filter((param) => param.visibility === "basic");
    const internalParams = activeParams.filter((param) => param.visibility === "internal");
    const activeSlotKeys = new Set(activeSlots.map((slot) => slot.key));
    const activeSlotUploads = draft.slots.filter((slot) => activeSlotKeys.has(slot.slotKey));
    const mentionAssets = getGenerationMentionAssets(draft.slots);
    const credits = estimateGenerationCredits(kind, selectedModel.id, draft.paramValues);
    const canEstimateCredits = draft.prompt.trim().length > 0 && (selectedMode.allowPromptOnly || activeSlotUploads.length > 0);
    const showMentionMenu = generationMentionMenu.open && generationMentionKind === kind;

    function renderParamOptions(param: GenerationParam) {
      if (!param.options?.length) {
        const value = draft.paramValues[param.id];
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
                setGenerationParamValue(kind, param.id, event.target.value === "" ? undefined : nextValue);
              }}
            />
            {param.helper ? <small>{param.helper}</small> : null}
          </div>
        );
      }

      return param.options.map((option) => (
        <button
          className={`dropdown-item ${draft.paramValues[param.id] === option.value ? "active" : ""}`}
          type="button"
          key={`${param.id}-${String(option.value)}`}
          onClick={() => {
            setGenerationParamValue(kind, param.id, option.value);
            setGenerationMenuOpen(null);
          }}
        >
          <span>{option.label}</span>
          {draft.paramValues[param.id] === option.value ? <Check size={14} /> : null}
        </button>
      ));
    }

    return (
      <div ref={generationComposerRef} className="home-generation-composer" data-generator={kind}>
        <div
          className={`composer-dialog generation-composer-dialog ${activeDropTarget === kind ? "is-drop-active" : ""}`}
          onDragEnter={(event) => handleMediaDrag(kind, event)}
          onDragOver={(event) => handleMediaDrag(kind, event)}
          onDragLeave={(event) => handleMediaDragLeave(kind, event)}
          onDrop={(event) => handleGenerationDrop(kind, event)}
        >
          {activeDropTarget === kind ? (
            <div className="input-drop-overlay" aria-hidden="true">
              <Upload size={18} />
              <span>{kind === "video" ? "松开上传图片或视频" : "松开上传参考图"}</span>
            </div>
          ) : null}
          <div className="composer-main-area">
            <div className="composer-slots-row" aria-label={`${kind} reference inputs`}>
              {activeSlots.map((slot) => {
                const uploads = draft.slots.filter((item) => item.slotKey === slot.key);

                return (
                  <GenerationSlotStack
                    key={slot.key}
                    slot={slot}
                    uploads={uploads}
                    onFilesSelected={(files) => addGenerationSlotFiles(kind, slot, files)}
                    onRemoveUpload={(input) => removeGenerationSlot(kind, input.id)}
                  />
                );
              })}
            </div>

            <div className="composer-prompt-area">
              <textarea
                ref={(node) => {
                  generationPromptRefs.current[kind] = node;
                }}
                id={`${promptId}-${kind}`}
                className="composer-prompt"
                aria-label={kind === "video" ? "Ad Video prompt" : "Ad Image prompt"}
                placeholder={catalog.placeholder}
                value={draft.prompt}
                onChange={(event) => handleGenerationPromptChange(kind, event)}
                onFocus={() => setGenerationMenuOpen(null)}
                onKeyDown={(event) => handleGenerationPromptKeyDown(kind, event)}
                onPointerDown={() => setGenerationMenuOpen(null)}
              />
              {showMentionMenu && generationMentionMenu.anchor === "prompt" ? (
                <GenerationImageMentionMenu
                  assets={mentionAssets}
                  insertAsset={(asset) => insertGenerationMention(kind, asset, generationPromptRefs.current[kind])}
                  itemRefs={generationMentionItemRefs}
                  menu={generationMentionMenu}
                  menuRef={generationMentionMenuRef}
                  selectedIndex={selectedGenerationMentionIndex}
                  setSelectedIndex={setSelectedGenerationMentionIndex}
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
              <button className="pill-btn" type="button" onClick={() => setGenerationMenuOpen(generationMenuOpen === menuKey(kind, "task") ? null : menuKey(kind, "task"))}>
                {kind === "video" ? <Video size={16} /> : <ImageIcon size={16} />}
                <span>{catalog.taskLabel}</span>
                <span className="chevron">▾</span>
              </button>
              <div className={`composer-menu ${generationMenuOpen === menuKey(kind, "task") ? "open" : ""}`}>
                <div className="menu-title">任务类型</div>
                <button
                  className={`dropdown-item ${kind === "video" ? "active" : ""}`}
                  type="button"
                  onClick={() => {
                    selectMode("video");
                    setGenerationMenuOpen(null);
                  }}
                >
                  <span>视频生成</span>
                  {kind === "video" ? <Check size={14} /> : null}
                </button>
                <button
                  className={`dropdown-item ${kind === "image" ? "active" : ""}`}
                  type="button"
                  onClick={() => {
                    selectMode("image");
                    setGenerationMenuOpen(null);
                  }}
                >
                  <span>图像生成</span>
                  {kind === "image" ? <Check size={14} /> : null}
                </button>
              </div>
            </div>

            <div className="composer-dropdown">
              <button className="pill-btn" type="button" onClick={() => setGenerationMenuOpen(generationMenuOpen === menuKey(kind, "model") ? null : menuKey(kind, "model"))}>
                <span className="dot" />
                <span>{selectedModel.displayName}</span>
                <span className="chevron">▾</span>
              </button>
              <div className={`composer-menu model-menu ${generationMenuOpen === menuKey(kind, "model") ? "open" : ""}`}>
                <div className="menu-title">模型</div>
                {catalog.models.map((model) => (
                  <button
                    className={`dropdown-item model-dropdown-item ${selectedModel.id === model.id ? "active" : ""}`}
                    type="button"
                    key={model.id}
                    onClick={() => selectGenerationModel(kind, model.id)}
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
                <button className="pill-btn" type="button" onClick={() => setGenerationMenuOpen(generationMenuOpen === menuKey(kind, "mode") ? null : menuKey(kind, "mode"))}>
                  <span>{selectedMode.label}</span>
                  <span className="chevron">▾</span>
                </button>
                <div className={`composer-menu ${generationMenuOpen === menuKey(kind, "mode") ? "open" : ""}`}>
                  <div className="menu-title">{kind === "video" ? "视频模式" : "图片模式"}</div>
                  {compatibleModes.map((mode) => (
                    <button
                      className={`dropdown-item ${selectedMode.key === mode.key ? "active" : ""}`}
                      type="button"
                      key={mode.key}
                      onClick={() => selectGenerationMode(kind, mode.key)}
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
                <button className="pill-btn config-pill-btn" type="button" onClick={() => setGenerationMenuOpen(generationMenuOpen === menuKey(kind, `param:${param.id}`) ? null : menuKey(kind, `param:${param.id}`))}>
                  <span className="config-summary-label">{param.label}</span>
                  <span className="config-summary-sep">·</span>
                  <span>{getParamDisplayValue(param, draft.paramValues[param.id])}</span>
                  <span className="chevron">▾</span>
                </button>
                <div className={`composer-menu config-menu ${generationMenuOpen === menuKey(kind, `param:${param.id}`) ? "open" : ""}`}>
                  <div className="menu-title">{param.label}</div>
                  {renderParamOptions(param)}
                </div>
              </div>
            ))}

            <div className="spacer" />
            <div className="composer-right-actions">
              <span className="token-count">
                <Sparkles size={13} />
                <span>{canEstimateCredits ? credits : 0}</span>
              </span>
              <button className="send-btn" type="button" aria-label={copy.cta} title={copy.cta} onClick={runAction}>
                <ArrowUp size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="agent-hub">
      {showTabs ? (
        <div className="launcher-tabs" aria-label="Create mode">
          <button className={`launcher-tab ${mode === "agent" ? "is-active" : ""}`} type="button" onClick={() => selectMode("agent")}>
            <span className="mode-icon icon-agent" aria-hidden="true" />
            <strong>Agent</strong>
          </button>
          <button className={`launcher-tab ${mode === "video" ? "is-active" : ""}`} type="button" onClick={() => selectMode("video")}>
            <span className="mode-icon icon-video" aria-hidden="true" />
            <strong>Video</strong>
          </button>
          <button className={`launcher-tab ${mode === "image" ? "is-active" : ""}`} type="button" onClick={() => selectMode("image")}>
            <span className="mode-icon icon-image" aria-hidden="true" />
            <strong>Image</strong>
          </button>
        </div>
      ) : null}

      <div className={`launcher-card ${generationKind ? "is-generation-mode" : ""}`}>
        <div className="launcher-title-row">
          <div>
            <h2>{copy.title}</h2>
          </div>
          <span className="cost-pill">{copy.pill}</span>
        </div>

        {generationKind ? renderGenerationInput(generationKind) : renderAgentInput()}
      </div>
      {renderProductDialog()}
    </div>
  );
}
