"use client";

import { CheckCircle2, Clock3, FileVideo, ImageIcon, Info, Link, Loader2, PackageCheck, ShieldCheck, TriangleAlert, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent as ReactDragEvent } from "react";
import type { CanvasRuntimeAction } from "@/features/canvas/types";
import type { AgentQuickAction } from "@/features/workbench/agent-types";
import {
  addProductAssetCatalogListener,
  createProductDraftFromExtraction,
  getProductImageDisplayUrl,
  loadProductAssetCatalog,
  saveStoredProductAsset,
  type ProductAssetRecord,
  type ProductImageAsset
} from "@/lib/mock-data";
import type {
  AgentConfirmationEvent,
  AgentEvent,
  AgentQuestionAnswerValue,
  AgentQuestionField,
  AgentQuestionForm,
  AgentQuestionSubmission,
  AgentQuestionSubmittedAsset
} from "./agent-events";

type AgentEventRendererProps = {
  events: AgentEvent[];
  sessionId?: string;
  submittedFormIds?: Set<string>;
  onQuickAction: (action: AgentQuickAction) => void;
  onSubmitText?: (text: string) => void;
  onSubmitQuestion?: (submission: AgentQuestionSubmission) => void;
  onUploadQuestionFiles?: (input: AgentQuestionUploadInput) => AgentQuestionSubmittedAsset[];
};

export type AgentQuestionUploadInput = {
  formId: string;
  fieldId: string;
  uploadRole?: AgentQuestionField["uploadRole"];
  files: File[];
};

function getStatusLabel(label: Extract<AgentEvent, { kind: "status" }>["label"]) {
  const labels: Record<Extract<AgentEvent, { kind: "status" }>["label"], string> = {
    thinking: "正在理解",
    planning: "整理中",
    waiting_user: "需要补充信息",
    executing: "处理中",
    done: "已收到信息",
    received: "已收到信息",
    error: "连接失败，可重试"
  };
  return labels[label];
}

function getApprovalStatusLabel(status: NonNullable<AgentConfirmationEvent["status"]>) {
  const labels: Record<NonNullable<AgentConfirmationEvent["status"]>, string> = {
    pending: "待确认",
    approved: "已确认",
    executing: "执行中",
    executed: "已执行",
    rejected: "已取消",
    execution_failed: "执行失败"
  };
  return labels[status];
}

function getCanvasActionStatusLabel(status: Extract<AgentEvent, { kind: "canvas_action" }>["status"]) {
  const labels: Record<Extract<AgentEvent, { kind: "canvas_action" }>["status"], string> = {
    pending: "待执行",
    running: "执行中",
    done: "已执行",
    failed: "执行失败"
  };
  return labels[status];
}

function isLowSignalStatusEvent(event: Extract<AgentEvent, { kind: "status" }>) {
  return event.label === "done" || event.label === "received";
}

const internalDebugTermPattern =
  /\b(fallbackUsed|fallbackReason|runtime|workspace|snapshot|schema|structured fact|provider|GenerationTask|MediaAsset|ApprovalRequest|Approval request|recoverable|actionHash|idempotencyKey|M3\.?2|Zod|LLM|canvasActions|uploadedAssets|executable|connectNodes|source|target|nodeId|validator|Action\s*\d+)\b|Agent LLM 决策失败|决策失败|目标节点.*不存在|不能连接到自身/i;

function sanitizeVisibleAgentText(text: string) {
  if (!internalDebugTermPattern.test(text)) return text;
  const visibleLines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !internalDebugTermPattern.test(line));
  return visibleLines.join("\n") || "连接失败，可重试。";
}

function isInternalDebugText(text: string) {
  return internalDebugTermPattern.test(text);
}

function describeCanvasAction(action: CanvasRuntimeAction) {
  if (action.type === "createNode") return `创建节点：${action.input.title ?? action.input.businessType ?? action.input.kind}`;
  if (action.type === "deleteNodes") return `删除 ${action.nodeIds.length} 个节点`;
  if (action.type === "renameNode") return `重命名节点：${action.title}`;
  if (action.type === "updateNodeSettings") return `更新节点：${action.title}`;
  if (action.type === "updateNodeContent") return "写入节点内容";
  if (action.type === "connectNodes") return "连接画布节点";
  if (action.type === "disconnectNodes") return "断开画布连接";
  if (action.type === "runNodeGeneration") return "运行生成";
  if (action.type === "appendNodeVersion") return "追加结果版本";
  if (action.type === "failNodeGeneration") return "标记生成失败";
  if (action.type === "setPrimaryVersion") return "设置主版本";
  if (action.type === "lockNode") return "锁定节点";
  if (action.type === "markNodeStale") return "标记返工";
  return "打开节点详情";
}

type QuestionDraftAnswer = string | string[];
type QuestionDraftAnswers = Record<string, QuestionDraftAnswer>;
type QuestionAssetsByField = Record<string, AgentQuestionSubmittedAsset[]>;
type QuestionProductAssetsByField = Record<string, AgentQuestionSubmittedAsset | undefined>;
type QuestionDraftState = {
  answers: QuestionDraftAnswers;
  assetsByField: QuestionAssetsByField;
  productAssetsByField: QuestionProductAssetsByField;
  isSubmitted: boolean;
};

const questionDraftCache = new Map<string, QuestionDraftState>();

function createParsingProductPreview(url: string): ProductAssetRecord {
  const parsedUrl = new URL(url);
  const name = parsedUrl.hostname.replace(/^www\./, "");
  return createProductDraftFromExtraction(url, {
    id: `product-parsing-${parsedUrl.hostname.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || Date.now().toString(36)}`,
    name,
    type: "Link",
    summary: "正在从链接解析产品资产包。",
    painPoints: "解析完成后会补充产品信息。",
    description: "正在解析产品链接。"
  });
}

function normalizeUrlInput(value: string) {
  const trimmedValue = value.trim();
  if (!trimmedValue) return "";
  return /^https?:\/\//i.test(trimmedValue) ? trimmedValue : `https://${trimmedValue}`;
}

function createSubmittedProductAsset(fieldId: string, product: ProductAssetRecord): AgentQuestionSubmittedAsset {
  return {
    id: product.id,
    fieldId,
    uploadRole: "product_pack",
    name: product.name,
    kind: "product",
    source: product.source === "mock" ? "mock" : "upload",
    previewUrl: product.images[0]?.url
  };
}

function hasAnswer(
  field: AgentQuestionField,
  answers: QuestionDraftAnswers,
  assetsByField: QuestionAssetsByField,
  productAssetsByField: QuestionProductAssetsByField
) {
  if (field.type === "product_asset") return Boolean(productAssetsByField[field.id]);
  if (field.type === "upload") return Boolean(assetsByField[field.id]?.length);
  const value = answers[field.id];
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value?.trim());
}

function getMissingLabels(
  form: AgentQuestionForm,
  answers: QuestionDraftAnswers,
  assetsByField: QuestionAssetsByField,
  productAssetsByField: QuestionProductAssetsByField
) {
  const missing: string[] = [];
  const requiredGroups = new Map<string, { label: string; fields: AgentQuestionField[] }>();

  form.fields.forEach((field) => {
    if (!field.required) return;
    if (!field.requiredGroup) {
      if (!hasAnswer(field, answers, assetsByField, productAssetsByField)) missing.push(field.label);
      return;
    }

    const existing = requiredGroups.get(field.requiredGroup);
    requiredGroups.set(field.requiredGroup, {
      label: existing?.label ?? field.requiredGroupLabel ?? field.label,
      fields: existing?.fields ?? form.fields.filter((item) => item.requiredGroup === field.requiredGroup)
    });
  });

  requiredGroups.forEach((group) => {
    if (!group.fields.some((field) => hasAnswer(field, answers, assetsByField, productAssetsByField))) {
      missing.push(group.label);
    }
  });

  return missing;
}

function getAnswerLabel(field: AgentQuestionField, value: QuestionDraftAnswer) {
  if (Array.isArray(value)) {
    return value
      .map((item) => field.options?.find((option) => option.id === item)?.label ?? item)
      .filter(Boolean)
      .join("、");
  }
  return field.options?.find((option) => option.id === value)?.label ?? value;
}

function formatQuestionSubmission(
  form: AgentQuestionForm,
  answers: QuestionDraftAnswers,
  assetsByField: QuestionAssetsByField,
  productAssetsByField: QuestionProductAssetsByField
) {
  const answerEntries: Record<string, AgentQuestionAnswerValue> = {};
  const lines: string[] = [];

  form.fields.forEach((field) => {
    if (field.type === "product_asset") {
      const asset = productAssetsByField[field.id];
      if (asset) {
        answerEntries[field.id] = asset.name;
        lines.push(`${field.label}：${asset.name}`);
      }
      return;
    }

    if (field.type === "upload") {
      const assets = assetsByField[field.id] ?? [];
      answerEntries[field.id] = assets;
      if (assets.length) lines.push(`${field.label}：${assets.map((asset) => asset.name).join("、")}`);
      return;
    }

    const value = answers[field.id];
    if (!value || (Array.isArray(value) && !value.length)) return;
    answerEntries[field.id] = value;
    const label = getAnswerLabel(field, value);
    if (label.trim()) lines.push(`${field.label}：${label}`);
  });

  return {
    answers: answerEntries,
    summary: lines.length ? lines.join("\n") : `${form.title}：已提交`
  };
}

function ProductAssetQuestionField({
  field,
  isSubmitted,
  selectedProductAsset,
  onSelectProduct
}: {
  field: AgentQuestionField;
  isSubmitted: boolean;
  selectedProductAsset?: AgentQuestionSubmittedAsset;
  onSelectProduct: (asset: AgentQuestionSubmittedAsset) => void;
}) {
  const [productCatalog, setProductCatalog] = useState<ProductAssetRecord[]>(() => loadProductAssetCatalog());
  const [productUrl, setProductUrl] = useState("");
  const [parseStatus, setParseStatus] = useState<"idle" | "loading" | "error">("idle");
  const [parseMessage, setParseMessage] = useState("");
  const [parsingProduct, setParsingProduct] = useState<ProductAssetRecord | null>(null);

  useEffect(() => addProductAssetCatalogListener(() => setProductCatalog(loadProductAssetCatalog())), []);

  async function parseProductUrl() {
    const normalizedUrl = normalizeUrlInput(productUrl);
    if (!normalizedUrl) {
      setParseStatus("error");
      setParseMessage("请输入产品链接");
      return;
    }

    try {
      new URL(normalizedUrl);
    } catch {
      setParseStatus("error");
      setParseMessage("产品链接格式不正确");
      return;
    }

    setParseStatus("loading");
    setParseMessage("");
    const parsingPreview = createParsingProductPreview(normalizedUrl);
    setParsingProduct(parsingPreview);

    try {
      const response = await fetch("/api/product/extract", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ url: normalizedUrl })
      });
      const payload = (await response.json()) as {
        error?: string;
        product?: Partial<ProductAssetRecord> & { images?: ProductImageAsset[] };
      };
      if (!payload.product) throw new Error(payload.error ?? "产品解析失败");

      const draft = createProductDraftFromExtraction(normalizedUrl, payload.product);
      const savedProduct = payload.error ? draft : { ...draft, source: "saved" as const };
      const submittedProduct = createSubmittedProductAsset(field.id, savedProduct);
      onSelectProduct(submittedProduct);
      const nextCatalog = saveStoredProductAsset(savedProduct);
      setProductCatalog(nextCatalog);
      setParsingProduct(null);
      window.setTimeout(() => onSelectProduct(submittedProduct), 0);
      setParseStatus(payload.error ? "error" : "idle");
      setParseMessage(payload.error ?? "已解析并选中产品资产包");
    } catch (error) {
      setParseStatus("error");
      setParseMessage(error instanceof Error ? error.message : "产品解析失败");
    }
  }

  const catalogProducts = productCatalog.slice(0, parsingProduct ? 5 : 6);
  const displayedProducts = parsingProduct
    ? [...catalogProducts.filter((product) => product.id !== parsingProduct.id), parsingProduct]
    : catalogProducts;

  return (
    <div className="agent-product-picker">
      <div className="agent-product-grid" aria-label="产品资产包">
        {displayedProducts.map((product) => {
          const selected = selectedProductAsset?.id === product.id;
          const coverImage = product.images[0]?.url;
          const isParsingCard = parsingProduct?.id === product.id;
          const isLoading = isParsingCard && parseStatus === "loading";
          const isError = isParsingCard && parseStatus === "error";
          const selectProduct = () => onSelectProduct(createSubmittedProductAsset(field.id, product));
          return (
            <button
              className={`agent-product-card ${selected ? "is-selected" : ""} ${isLoading ? "is-loading" : ""} ${isError ? "is-error" : ""}`}
              type="button"
              key={product.id}
              disabled={isSubmitted || isLoading}
              aria-pressed={selected}
              onPointerDown={(event) => {
                if (isSubmitted || isLoading) return;
                event.preventDefault();
                selectProduct();
              }}
              onClick={selectProduct}
            >
              <span
                className="agent-product-thumb"
                style={coverImage ? { backgroundImage: `url("${getProductImageDisplayUrl(coverImage)}")` } : undefined}
                aria-hidden="true"
              >
                {!coverImage ? product.shortName : null}
              </span>
              <span>
                <strong>{product.name}</strong>
                <small>
                  {isLoading ? "解析中..." : isError ? "解析失败，可重试" : `${product.type} · ${product.assets} assets`}
                </small>
              </span>
              {isLoading ? <Loader2 className="spin-icon" size={15} /> : null}
              {selected ? <PackageCheck size={15} /> : null}
            </button>
          );
        })}
      </div>

      <div className="agent-product-link-row">
        <div className="agent-product-link-input">
          <Link size={14} />
          <input
            type="url"
            value={productUrl}
            placeholder="粘贴产品链接解析为资产包"
            disabled={isSubmitted || parseStatus === "loading"}
            onChange={(event) => setProductUrl(event.target.value)}
          />
        </div>
        <button
          className="small-btn"
          type="button"
          disabled={isSubmitted || parseStatus === "loading"}
          onClick={parseProductUrl}
        >
          {parseStatus === "loading" ? <Loader2 className="spin-icon" size={14} /> : null}
          解析
        </button>
      </div>
      {selectedProductAsset ? (
        <div className="agent-product-selected">
          <PackageCheck size={14} />
          <span>已选：{selectedProductAsset.name}</span>
        </div>
      ) : null}
      {parseMessage ? <small className={parseStatus === "error" ? "agent-field-error" : ""}>{parseMessage}</small> : null}
    </div>
  );
}

function renderQuestionAssetPreview(asset: AgentQuestionSubmittedAsset) {
  const previewUrl = asset.previewUrl;

  return (
    <span className={`agent-upload-preview ${asset.kind === "video" ? "is-video" : "is-image"}`} aria-hidden="true">
      {asset.kind === "video" && previewUrl ? <video src={previewUrl} muted playsInline preload="metadata" /> : null}
      {asset.kind !== "video" && previewUrl ? (
        <span className="agent-upload-preview-media" style={{ backgroundImage: `url("${previewUrl}")` }} />
      ) : null}
      {!previewUrl ? asset.kind === "video" ? <FileVideo size={18} /> : <ImageIcon size={18} /> : null}
      {asset.kind === "video" ? <FileVideo className="agent-upload-type-icon" size={13} /> : null}
    </span>
  );
}

function QuestionCard({
  form,
  draftKey,
  archived,
  onSubmitText,
  onSubmitQuestion,
  onUploadQuestionFiles
}: {
  form: AgentQuestionForm;
  draftKey: string;
  archived?: boolean;
  onSubmitText?: (text: string) => void;
  onSubmitQuestion?: (submission: AgentQuestionSubmission) => void;
  onUploadQuestionFiles?: (input: AgentQuestionUploadInput) => AgentQuestionSubmittedAsset[];
}) {
  const [answers, setAnswers] = useState<QuestionDraftAnswers>(() => {
    const cachedDraft = questionDraftCache.get(draftKey);
    if (cachedDraft) return cachedDraft.answers;

    const initialAnswers: QuestionDraftAnswers = {};
    form.fields.forEach((field) => {
      if (field.type === "radio") {
        const defaultOption = field.options?.find((option) => option.id === "structure_only") ?? field.options?.[0];
        if (defaultOption && !field.required) initialAnswers[field.id] = defaultOption.id;
      }
    });
    return initialAnswers;
  });
  const [assetsByField, setAssetsByField] = useState<QuestionAssetsByField>(() => questionDraftCache.get(draftKey)?.assetsByField ?? {});
  const [productAssetsByField, setProductAssetsByField] = useState<QuestionProductAssetsByField>(() => questionDraftCache.get(draftKey)?.productAssetsByField ?? {});
  const [isSubmitted, setIsSubmitted] = useState(() => questionDraftCache.get(draftKey)?.isSubmitted || false);
  const uploadInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const missingLabels = useMemo(
    () => getMissingLabels(form, answers, assetsByField, productAssetsByField),
    [answers, assetsByField, form, productAssetsByField]
  );
  const cardSubmitted = isSubmitted || Boolean(archived);
  const canSubmit = missingLabels.length === 0 && !cardSubmitted;

  function persistDraft(nextDraft: Partial<QuestionDraftState>) {
    const currentDraft = questionDraftCache.get(draftKey) ?? {
      answers,
      assetsByField,
      productAssetsByField,
      isSubmitted
    };
    questionDraftCache.set(draftKey, {
      ...currentDraft,
      ...nextDraft
    });
  }

  useEffect(() => {
    questionDraftCache.set(draftKey, {
      answers,
      assetsByField,
      productAssetsByField,
      isSubmitted: cardSubmitted
    });
  }, [answers, assetsByField, cardSubmitted, draftKey, productAssetsByField]);

  function setFieldAnswer(fieldId: string, value: QuestionDraftAnswer) {
    setAnswers((current) => {
      const nextAnswers = {
        ...current,
        [fieldId]: value
      };
      persistDraft({ answers: nextAnswers });
      return nextAnswers;
    });
  }

  function toggleCheckboxValue(field: AgentQuestionField, optionId: string) {
    const currentValue = answers[field.id];
    const current = Array.isArray(currentValue) ? currentValue : [];
    const exists = current.includes(optionId);
    const next = exists ? current.filter((item) => item !== optionId) : [...current, optionId];
    setFieldAnswer(field.id, field.maxSelections ? next.slice(-field.maxSelections) : next);
  }

  function addFieldFiles(field: AgentQuestionField, files: File[]) {
    if (!files.length) return;
    const assets = onUploadQuestionFiles?.({
      formId: form.id,
      fieldId: field.id,
      uploadRole: field.uploadRole,
      files
    });
    if (!assets?.length) return;

    setAssetsByField((current) => {
      const nextAssetsByField = {
        ...current,
        [field.id]: [...(current[field.id] ?? []), ...assets]
      };
      persistDraft({ assetsByField: nextAssetsByField });
      return nextAssetsByField;
    });
  }

  function selectProductAsset(fieldId: string, asset: AgentQuestionSubmittedAsset) {
    setProductAssetsByField((current) => {
      const nextProductAssetsByField = {
        ...current,
        [fieldId]: asset
      };
      persistDraft({ productAssetsByField: nextProductAssetsByField });
      return nextProductAssetsByField;
    });
  }

  function handleFileInputChange(field: AgentQuestionField, event: ChangeEvent<HTMLInputElement>) {
    addFieldFiles(field, Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  function handleUploadDrop(field: AgentQuestionField, event: ReactDragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.files.length) return;
    event.preventDefault();
    addFieldFiles(field, Array.from(event.dataTransfer.files));
  }

  function submitQuestion() {
    if (!canSubmit) return;

    const { answers: formattedAnswers, summary } = formatQuestionSubmission(
      form,
      answers,
      assetsByField,
      productAssetsByField
    );
    const assets = [
      ...Object.values(productAssetsByField).filter((asset): asset is AgentQuestionSubmittedAsset => Boolean(asset)),
      ...Object.values(assetsByField).flat()
    ];
    const submission: AgentQuestionSubmission = {
      formId: form.id,
      title: form.title,
      answers: formattedAnswers,
      assets,
      summary
    };

    if (onSubmitQuestion) {
      onSubmitQuestion(submission);
    } else {
      onSubmitText?.(summary);
    }
    persistDraft({ isSubmitted: true });
    setIsSubmitted(true);
  }

  return (
    <div className={`agent-card question-card ${cardSubmitted ? "is-submitted" : ""}`}>
      <strong>{form.title}</strong>
      {form.description ? <p>{form.description}</p> : null}
      <div className="agent-form-fields">
        {form.fields.map((field) => {
          const fieldAssets = assetsByField[field.id] ?? [];
          const fieldAnswer = answers[field.id];

          return (
            <div className="agent-form-field" key={field.id}>
              <div className="agent-form-label">
                <span>{field.label}</span>
                {field.required ? <small>必填</small> : null}
              </div>
              {field.help ? <p>{field.help}</p> : null}

              {field.type === "product_asset" ? (
                <ProductAssetQuestionField
                  field={field}
                  isSubmitted={cardSubmitted}
                  selectedProductAsset={productAssetsByField[field.id]}
                  onSelectProduct={(asset) => selectProductAsset(field.id, asset)}
                />
              ) : null}

              {field.type === "text" ? (
                <input
                  className="agent-text-input"
                  type="text"
                  value={typeof fieldAnswer === "string" ? fieldAnswer : ""}
                  placeholder={field.placeholder}
                  disabled={cardSubmitted}
                  onChange={(event) => setFieldAnswer(field.id, event.target.value)}
                />
              ) : null}

              {field.type === "textarea" ? (
                <textarea
                  className="agent-textarea"
                  value={typeof fieldAnswer === "string" ? fieldAnswer : ""}
                  placeholder={field.placeholder}
                  disabled={cardSubmitted}
                  rows={4}
                  onChange={(event) => setFieldAnswer(field.id, event.target.value)}
                />
              ) : null}

              {field.type === "upload" ? (
                <div
                  className="agent-upload-dropzone"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => handleUploadDrop(field, event)}
                >
                  {fieldAssets.length ? (
                    <div className="agent-upload-list" aria-label={`${field.label}已上传素材`}>
                      {fieldAssets.map((asset) => (
                        <span className="agent-upload-chip" key={asset.id} title={asset.name}>
                          {renderQuestionAssetPreview(asset)}
                          <span>
                            <strong>{asset.name}</strong>
                            <small>{asset.kind === "video" ? "视频素材" : "图片素材"}</small>
                          </span>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <input
                    ref={(node) => {
                      uploadInputRefs.current[field.id] = node;
                    }}
                    className="hidden-file-input"
                    type="file"
                    accept={field.accept ?? "image/*,video/*"}
                    multiple={field.multiple ?? true}
                    disabled={cardSubmitted}
                    onChange={(event) => handleFileInputChange(field, event)}
                  />
                  <button
                    className="agent-upload-button"
                    type="button"
                    disabled={cardSubmitted}
                    onClick={() => uploadInputRefs.current[field.id]?.click()}
                  >
                    <Upload size={15} />
                    <span>上传图片/视频</span>
                  </button>
                  <small>{field.placeholder ?? "支持图片或视频文件"}</small>
                </div>
              ) : null}

              {field.options?.length ? (
                <div
                  className={`agent-option-grid ${field.display === "segmented" ? "is-segmented" : ""}`}
                  role={field.type === "checkbox" ? "group" : "radiogroup"}
                >
                  {field.options.map((option) => {
                    const selected = Array.isArray(fieldAnswer)
                      ? fieldAnswer.includes(option.id)
                      : fieldAnswer === option.id;
                    return (
                      <button
                        className={selected ? "is-selected" : ""}
                        type="button"
                        key={option.id}
                        disabled={cardSubmitted}
                        aria-pressed={selected}
                        onClick={() => {
                          if (field.type === "checkbox") {
                            toggleCheckboxValue(field, option.id);
                            return;
                          }
                          setFieldAnswer(field.id, option.id);
                        }}
                      >
                        <span>{option.label}</span>
                        {option.description ? <small>{option.description}</small> : null}
                      </button>
                    );
                  })}
                </div>
              ) : field.type !== "text" &&
                field.type !== "textarea" &&
                field.type !== "upload" &&
                field.type !== "product_asset" &&
                field.placeholder ? (
                <small>{field.placeholder}</small>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="agent-question-footer">
        <span className={`agent-question-missing ${missingLabels.length ? "is-missing" : ""}`}>
          {cardSubmitted
            ? "已提交"
            : missingLabels.length
              ? `还缺：${missingLabels.join("、")}`
              : "信息已完整，可以继续"}
        </span>
        <button className="small-btn is-selected" type="button" disabled={!canSubmit} onClick={submitQuestion}>
          {cardSubmitted ? "已提交" : form.submitLabel ?? "继续"}
        </button>
      </div>
    </div>
  );
}

function renderConfirmation(confirmation: AgentConfirmationEvent, onQuickAction: (action: AgentQuickAction) => void) {
  const isExecutable = confirmation.executable !== false;
  const actionPreview = confirmation.actions?.map(describeCanvasAction) ?? [];
  const hasGenerationApproval = confirmation.approvalKind === "generation" || confirmation.kind === "controlled_generation";
  const hasCanvasApproval = Boolean(confirmation.approvalRequestId) && !hasGenerationApproval;

  return (
    <div className={`agent-card confirmation-card ${hasCanvasApproval ? "is-canvas-approval" : ""} ${hasGenerationApproval ? "is-generation-approval" : ""}`}>
      <div className="card-meta">
        <span>{isExecutable ? "等待确认" : "方案预览"}</span>
        {confirmation.status ? <small>{getApprovalStatusLabel(confirmation.status)}</small> : null}
      </div>
      <strong>{confirmation.title}</strong>
      <p>{confirmation.summary}</p>
      {hasCanvasApproval ? (
        <div className="approval-safety-row">
          <ShieldCheck size={14} />
          <span>本次只创建/更新画布结构，不生成媒体、不扣费。</span>
        </div>
      ) : null}
      {hasGenerationApproval ? (
        <div className="approval-safety-row is-generation">
          <TriangleAlert size={14} />
          <span>确认后会触发真实生成，可能产生 credits；结果保存状态会在任务卡中更新。</span>
        </div>
      ) : null}
      <ul>
        {confirmation.bullets.map((bullet) => (
          <li key={bullet}>{bullet}</li>
        ))}
      </ul>
      {actionPreview.length ? (
        <div className="approval-action-preview" aria-label="待确认画布动作">
          <div>
            <span>将执行</span>
            <strong>{actionPreview.length} 个画布动作</strong>
          </div>
          <ol>
            {actionPreview.slice(0, 8).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
          {actionPreview.length > 8 ? <small>另有 {actionPreview.length - 8} 个动作会在确认后一起执行</small> : null}
        </div>
      ) : null}
      {hasCanvasApproval || hasGenerationApproval ? (
        <div className="approval-footnote">
          <span>{hasGenerationApproval ? "真实生成任务" : `影响画布内容 ${confirmation.affectedNodeIds?.length ?? 0} 项`}</span>
          <span>预计 {confirmation.estimatedCredits ?? 0} credits</span>
        </div>
      ) : null}
      <div className="agent-card-actions">
        {confirmation.secondaryLabel ? (
          <button className="small-btn" type="button" onClick={() => onQuickAction("request_adjustment")}>
            {confirmation.secondaryLabel}
          </button>
        ) : null}
        {isExecutable ? (
          <button
            className="small-btn is-selected"
            type="button"
            onClick={() => onQuickAction("confirm_pending")}
          >
            {confirmation.confirmLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function createMergedQuestionForm(forms: AgentQuestionForm[]): AgentQuestionForm {
  if (forms.length === 1) return forms[0];

  return {
    id: forms.map((form) => form.id).join("__"),
    title: "信息收集卡",
    description: "请一次补齐以下信息，提交后会加入当前 Agent 会话。",
    submitLabel: "继续",
    fields: forms.flatMap((form) =>
      form.fields.map((field) => ({
        ...field,
        id: `${form.id}:${field.id}`,
        requiredGroup: field.requiredGroup ? `${form.id}:${field.requiredGroup}` : undefined
      }))
    )
  };
}

function getRenderableAgentEvents(events: AgentEvent[]) {
  const items: Array<
    | { kind: "event"; event: Exclude<AgentEvent, { kind: "question" }>; key: string }
    | { kind: "question"; form: AgentQuestionForm; key: string }
  > = [];
  let questionForms: AgentQuestionForm[] = [];
  let questionStartIndex = 0;

  function flushQuestions() {
    if (!questionForms.length) return;
    items.push({
      kind: "question",
      form: createMergedQuestionForm(questionForms),
      key: `question-${questionStartIndex}-${questionForms.map((form) => form.id).join("-")}`
    });
    questionForms = [];
  }

  events.forEach((event, index) => {
    if (event.kind === "question") {
      if (!questionForms.length) questionStartIndex = index;
      questionForms.push(event.form);
      return;
    }

    flushQuestions();
    if (event.kind === "status" && isLowSignalStatusEvent(event)) return;
    items.push({ kind: "event", event, key: `event-${index}-${event.kind}` });
  });

  flushQuestions();
  return items;
}

export function AgentEventRenderer({
  events,
  sessionId = "agent-session",
  submittedFormIds = new Set<string>(),
  onQuickAction,
  onSubmitText,
  onSubmitQuestion,
  onUploadQuestionFiles
}: AgentEventRendererProps) {
  const renderableEvents = getRenderableAgentEvents(events);

  return (
    <div className="agent-event-flow">
      {renderableEvents.map((item) => {
        if (item.kind === "question") {
          return (
            <div key={item.key}>
              <QuestionCard
                form={item.form}
                draftKey={`${sessionId}:${item.form.id}`}
                archived={submittedFormIds.has(item.form.id)}
                onSubmitText={onSubmitText}
                onSubmitQuestion={onSubmitQuestion}
                onUploadQuestionFiles={onUploadQuestionFiles}
              />
            </div>
          );
        }

        const event = item.event;

        if (event.kind === "text") {
          return <p key={item.key}>{sanitizeVisibleAgentText(event.text)}</p>;
        }

        if (event.kind === "intake_submission") {
          return (
            <div className="agent-card intake-submission-card" key={item.key}>
              <div className="card-meta">
                <span>已收到信息</span>
              </div>
              <strong>{event.submission.title}</strong>
              <p>
                信息已保存，素材 {event.submission.uploadedAssetIds.length} 个
                {event.submission.productName ? `，产品：${event.submission.productName}` : ""}。
              </p>
            </div>
          );
        }

        if (event.kind === "status") {
          return (
            <div className={`agent-event-pill status-${event.label}`} key={item.key}>
              <Info size={13} />
              <span>{getStatusLabel(event.label)}</span>
              {event.detail ? <small>{sanitizeVisibleAgentText(event.detail)}</small> : null}
            </div>
          );
        }

        if (event.kind === "warning") {
          if (isInternalDebugText(event.text)) return null;
          return (
            <div className="agent-event-pill warning" key={item.key}>
              <TriangleAlert size={13} />
              <span>{event.text}</span>
            </div>
          );
        }

        if (event.kind === "confirmation") {
          return <div key={`confirmation-${event.confirmation.id}`}>{renderConfirmation(event.confirmation, onQuickAction)}</div>;
        }

        if (event.kind === "retry") {
          return (
            <div className="agent-card-actions" key={item.key}>
              <button className="small-btn" type="button" onClick={() => onSubmitText?.(event.text)}>
                {event.label}
              </button>
            </div>
          );
        }

        if (event.kind === "canvas_action") {
          return (
            <div className="agent-event-tool" key={item.key}>
              {event.status === "done" ? <CheckCircle2 size={14} /> : <Clock3 size={14} />}
              <span>{describeCanvasAction(event.action)}</span>
              <small>{getCanvasActionStatusLabel(event.status)}</small>
            </div>
          );
        }

        return (
          <div className="agent-event-tool" key={item.key}>
            <CheckCircle2 size={14} />
            <span>{event.summary}</span>
            <small>画布结果</small>
          </div>
        );
      })}
    </div>
  );
}
