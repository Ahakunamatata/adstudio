"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MyProductType } from "@/lib/domain/schemas";

// Prototype 内拖拽上传：把 File 读成 data URL（base64）塞进 images[].
// 优点：纯前端，不需要后端 / 对象存储。
// 限制：data URL 体积大；多张大图会撑爆 localStorage (约 5MB 限额)。
// 接真后端时，应改为上传到 S3/R2 拿回 https URL，images[] 仍存 URL。
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 单张 5MB 上限，保护 localStorage

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

const PRODUCT_TYPE_OPTIONS: MyProductType[] = ["App", "Ecommerce", "Game", "SaaS", "Service", "Other"];

type DraftPayload = {
  name: string;
  type: MyProductType;
  intro: string;
  painPoints: string;
  url: string;
  images: string[];
  useForCloning: boolean;
};

type MyProductDraftModalProps = {
  initialUrl?: string;
  onClose: () => void;
  onSubmit: (payload: DraftPayload) => void;
};

function buildInitialDraft(initialUrl?: string): DraftPayload {
  return {
    name: "",
    type: "App",
    intro: "",
    painPoints: "",
    url: initialUrl ?? "",
    images: [],
    useForCloning: true
  };
}

// Parent should gate this with `{draftOpen ? <MyProductDraftModal /> : null}` so
// the component re-mounts each time it opens, naturally resetting form state.
export function MyProductDraftModal({ initialUrl, onClose, onSubmit }: MyProductDraftModalProps) {
  const [draft, setDraft] = useState<DraftPayload>(() => buildInitialDraft(initialUrl));
  const [newImageUrl, setNewImageUrl] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [uploadHint, setUploadHint] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const canSubmit = draft.name.trim().length > 0 && draft.url.trim().length > 0;

  const addFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    const accepted: File[] = [];
    const rejectedReasons: string[] = [];
    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        rejectedReasons.push(`${file.name} 非图片`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        rejectedReasons.push(`${file.name} 超过 5MB`);
        continue;
      }
      accepted.push(file);
    }
    if (accepted.length === 0) {
      setUploadHint(rejectedReasons.join("，") || "未发现图片");
      return;
    }
    try {
      const dataUrls = await Promise.all(accepted.map((file) => readFileAsDataUrl(file)));
      setDraft((prev) => {
        const merged = [...prev.images];
        for (const url of dataUrls) {
          if (!merged.includes(url)) merged.push(url);
        }
        return { ...prev, images: merged };
      });
      if (rejectedReasons.length > 0) {
        setUploadHint(`已添加 ${accepted.length} 张，跳过：${rejectedReasons.join("，")}`);
      } else {
        setUploadHint(`已添加 ${accepted.length} 张图片`);
      }
    } catch {
      setUploadHint("读取文件失败，请重试");
    }
  }, []);

  function addImageByUrl() {
    const trimmed = newImageUrl.trim();
    if (!trimmed) return;
    if (draft.images.includes(trimmed)) {
      setNewImageUrl("");
      return;
    }
    setDraft((prev) => ({ ...prev, images: [...prev.images, trimmed] }));
    setNewImageUrl("");
  }

  function removeImage(idx: number) {
    setDraft((prev) => ({ ...prev, images: prev.images.filter((_, i) => i !== idx) }));
  }

  function handleSubmit() {
    if (!canSubmit) return;
    onSubmit({ ...draft, name: draft.name.trim(), url: draft.url.trim() });
  }

  return (
    <div className="myp-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="myp-modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="myp-draft-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button className="myp-modal-close" type="button" onClick={onClose} aria-label="关闭">
          ×
        </button>

        <div className="myp-modal-header">
          <span className="myp-modal-eyebrow">URL DRAFT</span>
          <h2 id="myp-draft-title" className="myp-modal-title">
            {draft.name.trim() || "新增产品"}
          </h2>
        </div>

        <div className="myp-modal-grid">
          <label className="myp-field">
            <span className="myp-field-label">产品名称</span>
            <input
              className="myp-field-input"
              type="text"
              value={draft.name}
              placeholder="例如 Phone Alarm – Anti-Theft"
              onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
            />
          </label>
          <label className="myp-field">
            <span className="myp-field-label">产品类型</span>
            <select
              className="myp-field-input"
              value={draft.type}
              onChange={(event) => setDraft((prev) => ({ ...prev, type: event.target.value as MyProductType }))}
            >
              {PRODUCT_TYPE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="myp-field">
          <span className="myp-field-label">产品介绍</span>
          <textarea
            className="myp-field-textarea"
            rows={5}
            value={draft.intro}
            placeholder="一段话描述产品的核心功能、价值主张与使用场景，AI 会基于此抽取关键词。"
            onChange={(event) => setDraft((prev) => ({ ...prev, intro: event.target.value }))}
          />
        </label>

        <label className="myp-field">
          <span className="myp-field-label">用户痛点</span>
          <textarea
            className="myp-field-textarea"
            rows={3}
            value={draft.painPoints}
            placeholder="用户在没有这款产品时遇到什么具体痛点 / 焦虑 / 任务卡点。"
            onChange={(event) => setDraft((prev) => ({ ...prev, painPoints: event.target.value }))}
          />
        </label>

        <label className="myp-field">
          <span className="myp-field-label">产品 URL</span>
          <input
            className="myp-field-input"
            type="url"
            value={draft.url}
            placeholder="https://..."
            onChange={(event) => setDraft((prev) => ({ ...prev, url: event.target.value }))}
          />
        </label>

        <div className="myp-field">
          <span className="myp-field-label">产品图片 ({draft.images.length})</span>
          {draft.images.length > 0 ? (
            <div className="myp-image-grid">
              {draft.images.map((src, idx) => (
                <div key={`${src}-${idx}`} className="myp-image-cell">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt={`产品图 ${idx + 1}`} onError={(event) => {
                    (event.currentTarget as HTMLImageElement).style.opacity = "0.25";
                  }} />
                  <button
                    type="button"
                    className="myp-image-remove"
                    aria-label="移除图片"
                    onClick={() => removeImage(idx)}
                  >
                    🗑
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div
            className={`myp-drop-zone ${isDragging ? "is-dragging" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            onDragEnter={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
              if (!isDragging) setIsDragging(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              // Only stop highlight when leaving the drop zone (not its children)
              if (event.currentTarget.contains(event.relatedTarget as Node)) return;
              setIsDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragging(false);
              if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
                void addFiles(event.dataTransfer.files);
              }
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(event) => {
                if (event.target.files && event.target.files.length > 0) {
                  void addFiles(event.target.files);
                }
                event.target.value = "";
              }}
            />
            <div className="myp-drop-zone-icon" aria-hidden>
              {isDragging ? "⬇" : "📎"}
            </div>
            <div className="myp-drop-zone-title">
              {isDragging ? "松手即可上传" : "拖拽图片到此处，或点击选择文件"}
            </div>
            <div className="myp-drop-zone-sub">
              支持 PNG / JPG / WebP / GIF，单张 ≤ 5MB（也可下方粘贴 URL）
            </div>
          </div>

          {uploadHint ? <div className="myp-upload-hint">{uploadHint}</div> : null}

          <div className="myp-image-input-row">
            <input
              className="myp-field-input"
              type="url"
              value={newImageUrl}
              placeholder="或粘贴图片 URL"
              onChange={(event) => setNewImageUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addImageByUrl();
                }
              }}
            />
            <button type="button" className="myp-secondary-btn" onClick={addImageByUrl}>
              添加 URL
            </button>
          </div>
        </div>

        <div className="myp-modal-footer">
          <button type="button" className="myp-ghost-btn" onClick={onClose}>
            取消
          </button>
          <label className="myp-checkbox">
            <input
              type="checkbox"
              checked={draft.useForCloning}
              onChange={(event) => setDraft((prev) => ({ ...prev, useForCloning: event.target.checked }))}
            />
            <span>用于复刻广告</span>
          </label>
          <button
            type="button"
            className="myp-primary-btn"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            💾 保存并开始抓取
          </button>
        </div>
      </div>
    </div>
  );
}
