"use client";

/* eslint-disable @next/next/no-img-element */

import { type CSSProperties, type MouseEvent as ReactMouseEvent, type RefObject, useEffect, useRef, useState } from "react";
import {
  Check,
  FileText,
  Image as ImageIcon,
  Maximize2,
  Pause,
  Play,
  Sparkles,
  Underline,
  UploadCloud,
  Video,
  X
} from "lucide-react";
import { Handle, NodeToolbar, Position, type NodeProps } from "@xyflow/react";
import type { CanvasNodeKind, NodeStatus } from "@/lib/domain/schemas";
import { CanvasMediaPreviewOverlay, isPlayableVideoSrc, type CanvasMediaPreviewItem } from "./CanvasMediaPreview";
import type { AdCanvasFlowNode } from "./types";

const statusLabels: Record<NodeStatus, string> = {
  draft: "Draft",
  queued: "Queued",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  stale: "Stale",
  locked: "Locked",
  uploaded: "Uploaded",
  waiting_user: "Waiting user",
  pending: "Pending",
  checked: "Checked",
  completed: "Completed"
};

const previewAssetMap: Record<string, string> = {
  "app-ui": "/assets/asset-app-ui.png",
  character: "/assets/asset-thai-mother.png",
  scene: "/assets/asset-bangkok-street.png",
  storyboard: "/assets/asset-storyboard-c1.png",
  "competitor-video": "/assets/asset-competitor-video.png",
  "final-video": "/assets/preview-video-ugc.png"
};

function getKindIcon(kind: CanvasNodeKind) {
  if (kind === "image") return <ImageIcon size={14} />;
  if (kind === "video") return <Video size={14} />;
  if (kind === "upload") return <UploadCloud size={14} />;
  if (kind === "script" || kind === "prompt" || kind === "plan") return <FileText size={14} />;
  return <Sparkles size={14} />;
}

function stopCanvasClick(event: ReactMouseEvent) {
  event.stopPropagation();
}

function isTextLikeNode(kind: CanvasNodeKind) {
  return kind === "text" || kind === "script" || kind === "prompt" || kind === "plan";
}

function normalizeNodeTitle(title: string) {
  return title.trim().replace(/\s+/g, " ");
}

function hasDuplicateTitle(data: AdCanvasFlowNode["data"], title: string) {
  const titleKey = normalizeNodeTitle(title).toLocaleLowerCase();
  return data.nodeTitles.some(
    (node) => node.id !== data.canvasNode.id && normalizeNodeTitle(node.title).toLocaleLowerCase() === titleKey
  );
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getPrimaryVersion(node: AdCanvasFlowNode["data"]["canvasNode"]) {
  return node.versions.find((version) => version.id === node.primaryVersionId) ?? node.versions[0] ?? null;
}

function canUsePreviewClassFallback(node: AdCanvasFlowNode["data"]["canvasNode"]) {
  return !["draft", "queued", "running", "failed", "pending"].includes(node.status);
}

function getPreviewAssetUrl(node: AdCanvasFlowNode["data"]["canvasNode"]) {
  const primaryVersion = getPrimaryVersion(node);
  return primaryVersion?.assetUrl ?? node.settings?.assetUrl ?? (canUsePreviewClassFallback(node) ? previewAssetMap[node.previewClass] : undefined);
}

function getPlaybackAssetUrl(node: AdCanvasFlowNode["data"]["canvasNode"]) {
  const primaryVersion = getPrimaryVersion(node);
  return primaryVersion?.downloadUrl ?? node.settings?.downloadUrl ?? primaryVersion?.assetUrl ?? node.settings?.assetUrl;
}

function parseAspectRatio(value: string | undefined) {
  if (!value) return undefined;

  const [width, height] = value.split(":").map((item) => Number(item));
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return width / height;
  }

  const numericRatio = Number(value);
  return Number.isFinite(numericRatio) && numericRatio > 0 ? numericRatio : undefined;
}

function getUploadCardWidth(aspectRatio: number) {
  if (aspectRatio < 0.75) return 240;
  if (aspectRatio > 1.25) return 336;
  return 276;
}

function getVideoPreviewSeekTime(video: HTMLVideoElement) {
  const duration = video.duration;
  if (!Number.isFinite(duration) || duration <= 0) return 0.6;

  const target = Math.max(0.6, duration * 0.16);
  return Math.min(target, 2.4, Math.max(0, duration - 0.08));
}

function captureVideoPreviewFrame(video: HTMLVideoElement) {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return undefined;

  const maxEdge = 720;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));

  const context = canvas.getContext("2d");
  if (!context) return undefined;

  try {
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.84);
  } catch {
    return undefined;
  }
}

function markdownLineToHtml(rawLine: string) {
  const headingMatch = rawLine.match(/^(#{1,3})\s+(.+)$/);
  const tag = headingMatch ? (`h${headingMatch[1].length}` as "h1" | "h2" | "h3") : "div";
  const text = headingMatch ? headingMatch[2] : rawLine;
  const formatted = escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s>])_(.+?)_($|[\s<])/g, "$1<em>$2</em>$3")
    .replace(/&lt;u&gt;(.+?)&lt;\/u&gt;/g, "<u>$1</u>");

  return `<${tag}>${formatted || "<br>"}</${tag}>`;
}

function looksLikeRichHtml(value: string) {
  return /<(strong|b|em|i|u|h1|h2|h3|div|p|br)\b/i.test(value);
}

function normalizeTextOutputToHtml(value: string) {
  if (!value.trim()) return "";
  if (looksLikeRichHtml(value) && !/(\*\*|^#{1,3}\s|[\s>]_[^_]+_)/m.test(value)) return value;
  return value.split(/\n/).map(markdownLineToHtml).join("");
}

function getEditorValue(editorRef: RefObject<HTMLDivElement | null>, fallback: string) {
  return editorRef.current?.innerHTML ?? normalizeTextOutputToHtml(fallback);
}

function commitRichText(data: AdCanvasFlowNode["data"], editorRef: RefObject<HTMLDivElement | null>) {
  const { canvasNode } = data;
  const value = getEditorValue(editorRef, canvasNode.output);
  data.onUpdateNodeSettings(canvasNode.id, canvasNode.title, value, canvasNode.model);
}

function formatSelectedText(
  command: "bold" | "italic" | "underline" | "h1" | "h2" | "h3",
  data: AdCanvasFlowNode["data"],
  editorRef: RefObject<HTMLDivElement | null>
) {
  const editor = editorRef.current;
  if (!editor) return;

  editor.focus();
  const commandMap = {
    bold: ["bold"],
    italic: ["italic"],
    underline: ["underline"],
    h1: ["formatBlock", "H1"],
    h2: ["formatBlock", "H2"],
    h3: ["formatBlock", "H3"]
  } as const;
  const [editorCommand, value] = commandMap[command];
  document.execCommand(editorCommand, false, value);
  commitRichText(data, editorRef);
}

function VersionStrip({ data }: { data: AdCanvasFlowNode["data"] }) {
  const { canvasNode } = data;

  if (canvasNode.versions.length < 2) return null;

  return (
    <div className="ad-node-versions">
      {canvasNode.versions.map((version) => (
        <button
          className={version.id === canvasNode.primaryVersionId ? "is-primary" : ""}
          key={version.id}
          type="button"
          onClick={(event) => {
            stopCanvasClick(event);
            data.onSetPrimaryVersion(canvasNode.id, version.id);
          }}
        >
          {version.label}
        </button>
      ))}
    </div>
  );
}

function TextPreview({
  data,
  selected,
  editorRef
}: {
  data: AdCanvasFlowNode["data"];
  selected: boolean;
  editorRef: RefObject<HTMLDivElement | null>;
}) {
  const { canvasNode } = data;
  const isLocked = canvasNode.locked || canvasNode.status === "locked";
  const html = normalizeTextOutputToHtml(canvasNode.output);

  if (selected && !isLocked) {
    return (
      <div
        ref={editorRef}
        className="ad-node-rich-editor nodrag"
        key={`${canvasNode.id}-${canvasNode.primaryVersionId}-${canvasNode.version}`}
        contentEditable
        suppressContentEditableWarning
        dangerouslySetInnerHTML={{ __html: html }}
        onBlur={(event) => {
          const draft = event.currentTarget.innerHTML;
          if (draft !== html) {
            data.onUpdateNodeSettings(canvasNode.id, canvasNode.title, draft, canvasNode.model);
          }
        }}
        onClick={stopCanvasClick}
        onDoubleClick={stopCanvasClick}
        onMouseDown={stopCanvasClick}
      />
    );
  }

  return (
    <div className="ad-node-preview ad-node-preview--text ad-node-text-preview">
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

function VideoPreviewMedia({
  src,
  posterSrc,
  shouldExtractPoster
}: {
  src: string;
  posterSrc?: string;
  shouldExtractPoster: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [derivedPoster, setDerivedPoster] = useState<{ src: string; poster: string } | null>(null);
  const [playbackState, setPlaybackState] = useState<{ src: string; isPlaying: boolean } | null>(null);
  const activeDerivedPoster = derivedPoster?.src === src ? derivedPoster.poster : undefined;
  const isPlaying = playbackState?.src === src && playbackState.isPlaying;

  useEffect(() => {
    if (!shouldExtractPoster || !src.startsWith("data:video/")) return;

    const videoElement = videoRef.current;
    if (!videoElement) return;

    let disposed = false;

    function handleLoadedMetadata(event: Event) {
      if (!(event.currentTarget instanceof HTMLVideoElement)) return;
      const targetTime = getVideoPreviewSeekTime(event.currentTarget);
      if (targetTime <= 0) return;

      try {
        event.currentTarget.currentTime = targetTime;
      } catch {
        // Some browser codecs reject seeking before enough metadata is available.
      }
    }

    function handleSeeked(event: Event) {
      if (disposed) return;
      if (!(event.currentTarget instanceof HTMLVideoElement)) return;
      const poster = captureVideoPreviewFrame(event.currentTarget);
      if (poster) setDerivedPoster({ src, poster });
    }

    videoElement.addEventListener("loadedmetadata", handleLoadedMetadata);
    videoElement.addEventListener("seeked", handleSeeked);
    videoElement.load();

    return () => {
      disposed = true;
      videoElement.removeEventListener("loadedmetadata", handleLoadedMetadata);
      videoElement.removeEventListener("seeked", handleSeeked);
    };
  }, [shouldExtractPoster, src]);

  function togglePlayback(event: ReactMouseEvent<HTMLButtonElement>) {
    stopCanvasClick(event);

    const video = videoRef.current;
    if (!video) return;

    if (video.paused || video.ended) {
      void video.play().catch(() => setPlaybackState({ src, isPlaying: false }));
      return;
    }

    video.pause();
  }

  return (
    <>
      <video
        ref={videoRef}
        className="ad-node-preview-media ad-node-preview-media--video"
        src={src}
        poster={activeDerivedPoster ?? posterSrc}
        muted
        playsInline
        preload="metadata"
        aria-hidden="true"
        onPlay={() => setPlaybackState({ src, isPlaying: true })}
        onPause={() => setPlaybackState({ src, isPlaying: false })}
        onEnded={() => setPlaybackState({ src, isPlaying: false })}
      />
      <button
        className={`ad-node-play nodrag nopan ${isPlaying ? "is-playing" : ""}`}
        type="button"
        aria-label={isPlaying ? "暂停视频预览" : "播放视频预览"}
        onClick={togglePlayback}
        onDoubleClick={stopCanvasClick}
        onMouseDown={stopCanvasClick}
      >
        {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
      </button>
    </>
  );
}

function NodePreview({
  data,
  selected,
  editorRef,
  onPreview
}: {
  data: AdCanvasFlowNode["data"];
  selected: boolean;
  editorRef: RefObject<HTMLDivElement | null>;
  onPreview: (item: CanvasMediaPreviewItem) => void;
}) {
  const { canvasNode } = data;
  const previewClass = `ad-node-preview ad-node-preview--${canvasNode.previewClass}`;

  if (canvasNode.kind === "image" || canvasNode.kind === "video" || canvasNode.kind === "upload") {
    const previewAssetUrl = getPreviewAssetUrl(canvasNode);
    const previewKind = canvasNode.kind === "video" || canvasNode.settings?.uploadedMediaKind === "video" ? "video" : "image";
    const uploadAspectRatio = canvasNode.kind === "upload" ? parseAspectRatio(canvasNode.settings?.uploadedMediaAspectRatio) : undefined;
    const uploadPreviewStyle = uploadAspectRatio
      ? ({ "--upload-preview-aspect-ratio": String(uploadAspectRatio) } as CSSProperties)
      : undefined;
    const playbackAssetUrl = previewKind === "video" ? getPlaybackAssetUrl(canvasNode) : undefined;
    const playableVideoSrc = isPlayableVideoSrc(playbackAssetUrl)
      ? playbackAssetUrl
      : isPlayableVideoSrc(previewAssetUrl)
        ? previewAssetUrl
        : undefined;
    const posterSrc = previewKind === "video" && previewAssetUrl && !isPlayableVideoSrc(previewAssetUrl)
      ? previewAssetUrl
      : undefined;
    const hasPreviewAsset = Boolean(previewKind === "video" ? posterSrc || playableVideoSrc : previewAssetUrl);
    const EmptyIcon = canvasNode.kind === "video" ? Video : canvasNode.kind === "upload" ? UploadCloud : ImageIcon;
    const mediaPreviewItem: CanvasMediaPreviewItem = {
      kind: previewKind,
      title: canvasNode.title,
      src: previewKind === "video" ? posterSrc ?? playableVideoSrc : previewAssetUrl,
      posterSrc,
      playbackSrc: playableVideoSrc
    };

    function openMediaPreview(event: ReactMouseEvent) {
      stopCanvasClick(event);
      onPreview(mediaPreviewItem);
    }

    if (!hasPreviewAsset) {
      return (
        <div className={`${previewClass} ad-node-preview-empty`} aria-label={`${canvasNode.title} 尚无预览素材`}>
          <EmptyIcon size={22} />
        </div>
      );
    }

    const previewMedia = previewKind === "video"
      ? playableVideoSrc ? (
          <VideoPreviewMedia
            src={playableVideoSrc}
            posterSrc={posterSrc}
            shouldExtractPoster={canvasNode.kind === "upload"}
          />
        ) : posterSrc ? (
          <img className="ad-node-preview-media" src={posterSrc} alt="" draggable={false} />
        ) : null
      : previewAssetUrl ? (
        <img className="ad-node-preview-media" src={previewAssetUrl} alt="" draggable={false} />
      ) : null;

    return (
      <div
        className={`${previewClass} ad-node-preview-clickable`}
        data-upload-aspect={uploadAspectRatio ? "true" : undefined}
        style={uploadPreviewStyle}
        role="button"
        tabIndex={0}
        aria-label={`编辑 ${canvasNode.title}`}
        onClick={(event) => {
          stopCanvasClick(event);
          data.onOpenNode(canvasNode.id);
        }}
        onDoubleClick={openMediaPreview}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            data.onOpenNode(canvasNode.id);
          }
        }}
      >
        {previewMedia}
        <button
          className="ad-node-preview-fullscreen nodrag nopan"
          type="button"
          aria-label={`大屏预览 ${canvasNode.title}`}
          onClick={openMediaPreview}
          onDoubleClick={stopCanvasClick}
          onMouseDown={stopCanvasClick}
        >
          <Maximize2 size={13} />
        </button>
      </div>
    );
  }

  return <TextPreview data={data} selected={selected} editorRef={editorRef} />;
}

function TextToolbar({
  visible,
  data,
  editorRef,
  isLocked
}: {
  visible: boolean;
  data: AdCanvasFlowNode["data"];
  editorRef: RefObject<HTMLDivElement | null>;
  isLocked: boolean;
}) {
  function keepEditorSelection(event: ReactMouseEvent) {
    event.preventDefault();
    stopCanvasClick(event);
  }

  function handleClick(event: ReactMouseEvent, action: () => void) {
    event.preventDefault();
    stopCanvasClick(event);
    if (!isLocked) action();
  }

  return (
    <NodeToolbar
      align="center"
      className="ad-node-floating-toolbar ad-node-text-toolbar nodrag nopan"
      isVisible={visible}
      offset={10}
      position={Position.Top}
    >
      <button type="button" aria-label="Bold" disabled={isLocked} onMouseDown={keepEditorSelection} onClick={(event) => handleClick(event, () => formatSelectedText("bold", data, editorRef))}>
        B
      </button>
      <button type="button" aria-label="Italic" disabled={isLocked} onMouseDown={keepEditorSelection} onClick={(event) => handleClick(event, () => formatSelectedText("italic", data, editorRef))}>
        <em>I</em>
      </button>
      <button type="button" aria-label="Underline" disabled={isLocked} onMouseDown={keepEditorSelection} onClick={(event) => handleClick(event, () => formatSelectedText("underline", data, editorRef))}>
        <Underline size={13} />
      </button>
      <button type="button" aria-label="Heading 1" disabled={isLocked} onMouseDown={keepEditorSelection} onClick={(event) => handleClick(event, () => formatSelectedText("h1", data, editorRef))}>
        H1
      </button>
      <button type="button" aria-label="Heading 2" disabled={isLocked} onMouseDown={keepEditorSelection} onClick={(event) => handleClick(event, () => formatSelectedText("h2", data, editorRef))}>
        H2
      </button>
      <button type="button" aria-label="Heading 3" disabled={isLocked} onMouseDown={keepEditorSelection} onClick={(event) => handleClick(event, () => formatSelectedText("h3", data, editorRef))}>
        H3
      </button>
    </NodeToolbar>
  );
}

function CanvasNodeRenderer({ data, selected }: NodeProps<AdCanvasFlowNode>) {
  const { canvasNode, parentTitles } = data;
  const isLocked = canvasNode.locked || canvasNode.status === "locked";
  const isUploadNode = canvasNode.kind === "upload";
  const textEditorRef = useRef<HTMLDivElement | null>(null);
  const [mediaPreview, setMediaPreview] = useState<CanvasMediaPreviewItem | null>(null);
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(canvasNode.title);
  const [titleError, setTitleError] = useState("");
  const uploadAspectRatio = isUploadNode ? parseAspectRatio(canvasNode.settings?.uploadedMediaAspectRatio) : undefined;
  const uploadCardStyle = uploadAspectRatio
    ? ({
        "--upload-card-width": `${getUploadCardWidth(uploadAspectRatio)}px`,
        "--upload-preview-aspect-ratio": String(uploadAspectRatio)
      } as CSSProperties)
    : undefined;

  function beginTitleEdit(event: ReactMouseEvent) {
    stopCanvasClick(event);
    setTitleDraft(canvasNode.title);
    setTitleError("");
    setTitleEditing(true);
  }

  function cancelTitleEdit() {
    setTitleDraft(canvasNode.title);
    setTitleError("");
    setTitleEditing(false);
  }

  function commitTitleEdit() {
    const nextTitle = normalizeNodeTitle(titleDraft);
    if (!nextTitle) {
      setTitleError("节点名称不能为空");
      return;
    }
    if (hasDuplicateTitle(data, nextTitle)) {
      setTitleError("节点名称已存在");
      return;
    }

    if (nextTitle !== canvasNode.title) {
      data.onRenameNode(canvasNode.id, nextTitle);
    }
    setTitleError("");
    setTitleEditing(false);
  }

  return (
    <>
      <CanvasMediaPreviewOverlay item={mediaPreview} onClose={() => setMediaPreview(null)} />
      <TextToolbar
        visible={selected && isTextLikeNode(canvasNode.kind)}
        data={data}
        editorRef={textEditorRef}
        isLocked={isLocked}
      />

      <article
        className={`ad-canvas-node ad-canvas-node--${canvasNode.kind} ${selected ? "is-selected" : ""}`}
        data-status={canvasNode.status}
        data-locked={isLocked ? "true" : "false"}
        data-upload-aspect={uploadAspectRatio ? "true" : undefined}
        style={uploadCardStyle}
      >
        <Handle className="ad-canvas-handle" type="target" position={Position.Left} id="input" />
        <Handle className="ad-canvas-handle" type="source" position={Position.Right} id="output" />

      <header className="ad-node-head">
        <span className="ad-node-kind">
          {getKindIcon(canvasNode.kind)}
          {canvasNode.type}
        </span>
        <span className="ad-node-status">{statusLabels[canvasNode.status]}</span>
      </header>

      {titleEditing ? (
        <div className="ad-node-title-editor nodrag nopan" onClick={stopCanvasClick} onDoubleClick={stopCanvasClick} onMouseDown={stopCanvasClick}>
          <input
            autoFocus
            value={titleDraft}
            aria-label="编辑节点名称"
            onChange={(event) => {
              setTitleDraft(event.currentTarget.value);
              if (titleError) setTitleError("");
            }}
            onBlur={commitTitleEdit}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitTitleEdit();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                cancelTitleEdit();
              }
            }}
          />
          <button type="button" aria-label="保存节点名称" onMouseDown={(event) => event.preventDefault()} onClick={commitTitleEdit}>
            <Check size={13} />
          </button>
          <button type="button" aria-label="取消编辑节点名称" onMouseDown={(event) => event.preventDefault()} onClick={cancelTitleEdit}>
            <X size={13} />
          </button>
        </div>
      ) : (
        <h3 className="ad-node-title" title="双击重命名" onDoubleClick={beginTitleEdit}>
          {canvasNode.title}
        </h3>
      )}
      {titleError ? <p className="ad-node-title-error">{titleError}</p> : null}

      <NodePreview data={data} selected={selected} editorRef={textEditorRef} onPreview={setMediaPreview} />

      {isUploadNode ? null : (
        <>
          <div className="ad-node-meta">
            <span>{canvasNode.model}</span>
            <span>{canvasNode.time}</span>
            <span>{canvasNode.cost}</span>
          </div>

          <div className="ad-node-foot">
            <span>v{canvasNode.version}</span>
            <span>{parentTitles.length ? `Refs ${parentTitles.length}` : "No refs"}</span>
          </div>
        </>
      )}

        {canvasNode.staleReason ? <p className="ad-node-warning">{canvasNode.staleReason}</p> : null}
        {isUploadNode ? null : <VersionStrip data={data} />}
      </article>
    </>
  );
}

export const adCanvasNodeTypes = {
  adCanvasNode: CanvasNodeRenderer
};
