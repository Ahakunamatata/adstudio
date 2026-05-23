"use client";

import { X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";

export type CanvasMediaPreviewItem = {
  kind: "image" | "video";
  title: string;
  src?: string;
  posterSrc?: string;
  playbackSrc?: string;
};

export function isPlayableVideoSrc(value: string | undefined) {
  return /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(value ?? "") || /^data:video\//i.test(value ?? "");
}

export function CanvasMediaPreviewOverlay({
  item,
  onClose
}: {
  item: CanvasMediaPreviewItem | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!item) return undefined;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [item, onClose]);

  if (!item) return null;

  const playbackSrc = item.kind === "video" && isPlayableVideoSrc(item.playbackSrc ?? item.src)
    ? item.playbackSrc ?? item.src
    : undefined;
  const posterSrc = item.posterSrc ?? (item.kind === "image" ? item.src : undefined);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="generation-media-preview-overlay canvas-media-preview-overlay open" role="dialog" aria-modal="true" aria-label={item.title} onClick={onClose}>
      <button className="generation-media-preview-close nodrag nopan" type="button" aria-label="关闭预览" onClick={onClose}>
        <X size={18} />
      </button>
      <div className="generation-media-preview-stage" onClick={(event) => event.stopPropagation()}>
        {item.kind === "image" && item.src ? (
          <span
            className="generation-media-preview-content is-image canvas-media-preview-image"
            role="img"
            aria-label={item.title}
            style={{ backgroundImage: `url(${item.src})` }}
          />
        ) : null}
        {item.kind === "video" ? (
          <div className="generation-media-preview-video canvas-media-preview-video">
            {playbackSrc ? (
              <video
                className="generation-media-preview-content canvas-media-preview-video-player"
                src={playbackSrc}
                poster={posterSrc}
                controls
                autoPlay
                playsInline
              />
            ) : (
              <span
                className="generation-media-preview-content canvas-media-preview-video-poster"
                role="img"
                aria-label={item.title}
                style={posterSrc ? { backgroundImage: `url(${posterSrc})` } : undefined}
              />
            )}
            <span>{playbackSrc ? item.title : `${item.title} 暂无可播放视频源`}</span>
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
