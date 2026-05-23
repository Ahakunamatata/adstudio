"use client";

import { useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { UploadCloud } from "lucide-react";
import type { CanvasNode, CanvasNodeKind, CanvasNodeSettings } from "@/lib/domain/schemas";
import { CanvasGenerationComposer } from "@/features/generation/CanvasGenerationComposer";
import type { CanvasGenerationResult } from "./types";

type CanvasNodeEditorPopoverProps = {
  node: CanvasNode;
  parentNodes: CanvasNode[];
  style?: CSSProperties;
  onDisconnectParentRef: (sourceNodeId: string, targetNodeId: string) => void;
  onStartNodeGeneration: (nodeId: string, prompt: string, model: string, settings: CanvasNodeSettings) => void;
  onCompleteNodeGeneration: (nodeId: string, result: CanvasGenerationResult) => void;
  onFailNodeGeneration: (nodeId: string, errorMessage: string) => void;
  onPanelDragStart: (event: ReactPointerEvent<HTMLElement>) => void;
  onUpdateNodeSettings: (
    nodeId: string,
    title: string,
    output: string,
    model: string,
    settings?: CanvasNodeSettings
  ) => void;
};

function stopCanvasEvent(event: ReactMouseEvent) {
  event.stopPropagation();
}

function isPanelDragTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return !target.closest(
    "button, input, textarea, select, [contenteditable='true'], .slot-stack, .composer-menu, .composer-dropdown, .composer-prompt, .generation-slot-file-input"
  );
}

function isTextLikeNode(kind: CanvasNodeKind) {
  return kind === "text" || kind === "script" || kind === "prompt" || kind === "plan";
}

function getUploadedMediaKind(file: File): "image" | "video" | "file" {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  return "file";
}

type UploadedMediaMetadata = {
  width?: number;
  height?: number;
  aspectRatio?: string;
  posterDataUrl?: string;
};

function getGreatestCommonDivisor(first: number, second: number) {
  let a = Math.abs(first);
  let b = Math.abs(second);

  while (b) {
    const next = b;
    b = a % b;
    a = next;
  }

  return a || 1;
}

function getAspectRatioLabel(width: number, height: number) {
  const divisor = getGreatestCommonDivisor(width, height);
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

function getScaledCanvasSize(width: number, height: number, maxEdge = 720) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

function captureVideoPoster(video: HTMLVideoElement) {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return undefined;

  const canvas = document.createElement("canvas");
  const scaledSize = getScaledCanvasSize(width, height);
  canvas.width = scaledSize.width;
  canvas.height = scaledSize.height;
  const context = canvas.getContext("2d");
  if (!context) return undefined;

  context.drawImage(video, 0, 0, scaledSize.width, scaledSize.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

function readImageMetadata(dataUrl: string): Promise<UploadedMediaMetadata> {
  return new Promise((resolve) => {
    const image = new Image();
    image.addEventListener("load", () => {
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      resolve({
        width,
        height,
        aspectRatio: width && height ? getAspectRatioLabel(width, height) : undefined
      });
    }, { once: true });
    image.addEventListener("error", () => resolve({}), { once: true });
    image.src = dataUrl;
  });
}

function readVideoMetadata(dataUrl: string): Promise<UploadedMediaMetadata> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    let resolved = false;
    const timeoutId = window.setTimeout(() => resolveOnce(false), 3000);

    function resolveOnce(includePoster: boolean) {
      if (resolved) return;
      resolved = true;
      window.clearTimeout(timeoutId);

      const width = video.videoWidth;
      const height = video.videoHeight;
      const posterDataUrl = includePoster ? captureVideoPoster(video) : undefined;
      video.removeAttribute("src");
      video.load();

      resolve({
        width: width || undefined,
        height: height || undefined,
        aspectRatio: width && height ? getAspectRatioLabel(width, height) : undefined,
        posterDataUrl
      });
    }

    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.addEventListener("loadedmetadata", () => {
      const seekTime = Number.isFinite(video.duration) && video.duration > 0
        ? Math.min(Math.max(0.6, video.duration * 0.16), 2.4, Math.max(0, video.duration - 0.08))
        : 0;
      try {
        video.currentTime = seekTime;
      } catch {
        resolveOnce(false);
      }
    }, { once: true });
    video.addEventListener("seeked", () => resolveOnce(true), { once: true });
    video.addEventListener("loadeddata", () => {
      if (!Number.isFinite(video.duration) || video.duration <= 0) resolveOnce(true);
    }, { once: true });
    video.addEventListener("error", () => resolveOnce(false), { once: true });
    video.src = dataUrl;
    video.load();
  });
}

function readUploadedMediaMetadata(dataUrl: string, mediaKind: "image" | "video" | "file"): Promise<UploadedMediaMetadata> {
  if (mediaKind === "image") return readImageMetadata(dataUrl);
  if (mediaKind === "video") return readVideoMetadata(dataUrl);
  return Promise.resolve({});
}

function getMetadataSettings(metadata: UploadedMediaMetadata): CanvasNodeSettings {
  return {
    ...(metadata.width ? { uploadedMediaWidth: String(metadata.width) } : {}),
    ...(metadata.height ? { uploadedMediaHeight: String(metadata.height) } : {}),
    ...(metadata.aspectRatio ? { uploadedMediaAspectRatio: metadata.aspectRatio } : {})
  };
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("无法读取上传文件。"));
    });
    reader.addEventListener("error", () => reject(new Error("无法读取上传文件。")));
    reader.readAsDataURL(file);
  });
}

function UploadNodePanel({
  node,
  onUpdateNodeSettings
}: {
  node: CanvasNode;
  onUpdateNodeSettings: CanvasNodeEditorPopoverProps["onUpdateNodeSettings"];
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const isLocked = node.locked || node.status === "locked";

  async function handleUpload(file: File) {
    setUploading(true);
    setErrorMessage("");

    try {
      const dataUrl = await readFileAsDataUrl(file);
      const mediaKind = getUploadedMediaKind(file);
      const metadata = await readUploadedMediaMetadata(dataUrl, mediaKind);
      const assetFields =
        mediaKind === "file"
          ? {}
          : mediaKind === "video"
            ? {
                assetUrl: metadata.posterDataUrl ?? dataUrl,
                downloadUrl: dataUrl
              }
          : {
              assetUrl: dataUrl,
              downloadUrl: dataUrl
            };
      const settings = {
        ...node.settings,
        ...assetFields,
        ...getMetadataSettings(metadata),
        uploadedFileName: file.name,
        uploadedFileMime: file.type || "application/octet-stream",
        uploadedFileSize: String(file.size),
        uploadedMediaKind: mediaKind,
        prompt: node.settings?.prompt || `上传素材：${file.name}`
      };
      onUpdateNodeSettings(node.id, node.title, `上传素材：${file.name}`, node.model, settings);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "上传失败，请重新选择文件。");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="canvas-upload-panel">
      <input
        ref={fileInputRef}
        className="ad-panel-file-input"
        type="file"
        accept="image/*,video/*"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleUpload(file);
          event.currentTarget.value = "";
        }}
      />
      <button type="button" disabled={isLocked || uploading} onClick={() => fileInputRef.current?.click()}>
        <UploadCloud size={16} />
        {uploading ? "读取中" : "选择文件"}
      </button>
      <p>{node.settings?.uploadedFileName ? `已选择：${node.settings.uploadedFileName}` : "上传节点暂不调用生成模型，只作为下游素材引用。"}</p>
      {errorMessage ? <p className="canvas-upload-error">{errorMessage}</p> : null}
    </div>
  );
}

export function CanvasNodeEditorPopover({
  node,
  parentNodes,
  style,
  onDisconnectParentRef,
  onStartNodeGeneration,
  onCompleteNodeGeneration,
  onFailNodeGeneration,
  onPanelDragStart,
  onUpdateNodeSettings
}: CanvasNodeEditorPopoverProps) {
  if (isTextLikeNode(node.kind)) return null;

  return (
    <aside
      className={`ad-node-generation-panel ad-node-generation-panel--${node.kind} nodrag nopan`}
      onClick={stopCanvasEvent}
      onDoubleClick={stopCanvasEvent}
      onMouseDown={stopCanvasEvent}
      onPointerDownCapture={(event) => {
        if (isPanelDragTarget(event.target)) {
          onPanelDragStart(event);
        }
      }}
      style={style}
    >
      {node.kind === "image" || node.kind === "video" ? (
        <CanvasGenerationComposer
          node={node}
          parentNodes={parentNodes}
          onDisconnectParentRef={onDisconnectParentRef}
          onStart={({ prompt, model, settings }) => onStartNodeGeneration(node.id, prompt, model, settings)}
          onComplete={(result) => onCompleteNodeGeneration(node.id, result)}
          onFail={(errorMessage) => onFailNodeGeneration(node.id, errorMessage)}
        />
      ) : (
        <UploadNodePanel node={node} onUpdateNodeSettings={onUpdateNodeSettings} />
      )}
    </aside>
  );
}
