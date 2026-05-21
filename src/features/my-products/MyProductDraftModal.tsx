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
  // URL-first 解析：用户贴 URL → 一键 AI 解析填充所有字段
  const [parsing, setParsing] = useState(false);
  const [parseHint, setParseHint] = useState<string | null>(null);
  const [autoFilledFromUrl, setAutoFilledFromUrl] = useState(false);
  // expanded = true 时显示所有手填字段；false 时只显示 URL hero 区。
  // 用户点了「✨ 解析」成功，或者点「没有 URL，手动填」时展开。
  const [expanded, setExpanded] = useState(false);

  async function parseFromUrl() {
    const url = draft.url.trim();
    if (!url) {
      setParseHint("先贴一个产品 URL");
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      setParseHint("URL 需要 http:// 或 https:// 开头");
      return;
    }
    setParseHint(null);
    setParsing(true);
    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 30_000);
      const response = await fetch("/api/my-products/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // 把用户已填的字段一起送给后端 —— LLM 会优先用用户输入，URL fetch
        // 失败时（如 Amazon 反爬）这些字段就是关键的语义补充。
        body: JSON.stringify({
          url,
          name: draft.name.trim(),
          intro: draft.intro.trim(),
          painPoints: draft.painPoints.trim(),
          productType: draft.type
        }),
        signal: ctrl.signal
      });
      clearTimeout(timeout);
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        setParseHint(`解析失败：${response.status} ${text.slice(0, 80)}`);
        return;
      }
      const data = (await response.json()) as {
        productName?: string;
        productType?: string;
        industry?: string;
        cleanedIntro?: string;
        cleanedPainPoints?: string;
        mainImageUrl?: string | null;
        canonicalUrl?: string | null;
        pageBlockedByAntibot?: boolean;
      };
      // ── productType normalize（case-insensitive + industry fallback）──
      // LLM 偶尔返回 lowercase / trailing space / 别名 → 用 case-insensitive
      // 匹配。如果还是没命中，看 industry 字段反推（ecommerce industry → Ecommerce type）。
      const resolveType = (
        raw: string | undefined,
        industry: string | undefined
      ): MyProductType => {
        const norm = (raw ?? "").trim().toLowerCase();
        for (const opt of PRODUCT_TYPE_OPTIONS) {
          if (opt.toLowerCase() === norm) return opt;
        }
        // industry → type 反推（兜底）
        const ind = (industry ?? "").trim().toLowerCase();
        if (ind === "ecommerce" || ind === "food-beverage" || ind === "real-estate-auto")
          return "Ecommerce";
        if (ind === "app") return "App";
        if (ind === "game") return "Game";
        if (ind === "saas") return "SaaS";
        return "Other";
      };
      const resolvedType = resolveType(data.productType, data.industry);
      console.log("[parseFromUrl] raw productType:", data.productType, "→ resolved:", resolvedType);

      // 自动填充：文本字段尊重用户已填（不覆盖），但 productType / images
      // 让 AI 覆盖（用户没法准确判断 App vs Ecommerce，AI 看 URL 更准）。
      // URL 用 canonicalUrl 回填（剥掉 utm/dib/ref 等 tracking，纯产品 URL）。
      setDraft((prev) => ({
        ...prev,
        url: data.canonicalUrl || prev.url,
        name: prev.name.trim() || data.productName || prev.name,
        type: resolvedType,
        intro: prev.intro.trim() || data.cleanedIntro || prev.intro,
        painPoints: prev.painPoints.trim() || data.cleanedPainPoints || prev.painPoints,
        // 图片：用 AI 拿到的 mainImageUrl 替换默认空数组（用户后续可手动改）
        images:
          data.mainImageUrl && !prev.images.includes(data.mainImageUrl)
            ? [data.mainImageUrl, ...prev.images]
            : prev.images
      }));
      setAutoFilledFromUrl(true);
      setExpanded(true); // 解析成功 → 展开全部字段让用户审核
      if (data.pageBlockedByAntibot) {
        setParseHint(
          "⚠ 该网站反爬较严，AI 没拿到真页面 —— 请在下方补充产品名 + 一句话介绍后再点「重新解析」"
        );
      } else {
        setParseHint("✓ AI 已根据 URL 解析并填充字段，可在下方微调");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setParseHint("解析超时（>30s），请重试或手动填写");
      } else {
        setParseHint(
          `解析失败：${error instanceof Error ? error.message : String(error)}`
        );
      }
    } finally {
      setParsing(false);
    }
  }
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
            {expanded ? (draft.name.trim() || "审核产品信息") : "贴上产品 URL，AI 自动解析"}
          </h2>
          {!expanded ? (
            <p className="myp-modal-subtitle">
              不用手动填 —— 我们会从 URL 抓产品名、类型、介绍、痛点和关键词。
            </p>
          ) : null}
        </div>

        {/* URL-first 解析区：贴 URL → 一键 AI 推断产品名/类型/介绍/痛点/关键词 */}
        <div className={`myp-url-hero ${expanded ? "is-compact" : "is-hero"}`}>
          <span className="myp-field-label">
            🔗 产品 URL
            {!expanded ? (
              <span className="myp-muted-small">（贴上后 AI 自动填充其它字段）</span>
            ) : null}
          </span>
          <div className="myp-url-hero-row">
            <input
              className="myp-field-input myp-url-hero-input"
              type="url"
              value={draft.url}
              placeholder="https://apps.apple.com/... 或 https://yourstore.com/products/..."
              disabled={parsing}
              autoFocus={!expanded}
              onChange={(event) => {
                setDraft((prev) => ({ ...prev, url: event.target.value }));
                setAutoFilledFromUrl(false);
                setParseHint(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !parsing) {
                  event.preventDefault();
                  void parseFromUrl();
                }
              }}
            />
            <button
              type="button"
              className={`myp-url-hero-btn ${parsing ? "is-loading" : ""}`}
              disabled={parsing || draft.url.trim().length === 0}
              onClick={() => void parseFromUrl()}
            >
              {parsing ? "AI 解析中…" : autoFilledFromUrl ? "重新解析" : "✨ AI 解析"}
            </button>
          </div>
          {parseHint ? (
            <div
              className={`myp-url-hero-hint ${
                parseHint.startsWith("✓")
                  ? "is-success"
                  : parseHint.startsWith("⚠")
                    ? "is-warn"
                    : "is-warn"
              }`}
            >
              {parseHint}
            </div>
          ) : null}
          {!expanded ? (
            <button
              type="button"
              className="myp-url-hero-manual-link"
              onClick={() => setExpanded(true)}
            >
              没有 URL？直接手动填 →
            </button>
          ) : null}
        </div>

        {/* 没解析过 + 没手动展开 → 只显示一个底部「取消」按钮，其它字段隐藏 */}
        {!expanded ? (
          <div className="myp-modal-footer myp-modal-footer-minimal">
            <button type="button" className="myp-modal-cancel" onClick={onClose}>
              取消
            </button>
          </div>
        ) : null}

        {expanded ? (
        <>
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
        </>
        ) : null}
      </div>
    </div>
  );
}
