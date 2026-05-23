"use client";

/* eslint-disable @next/next/no-img-element */

import { Image as ImageIcon, Maximize2, Plus, Video, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { GenerationSlot, GenerationSlotInput } from "./types";
import { getGenerationSlotAccept } from "./slot-inputs";

const cardWidth = 54;
const cardHeight = 72;
const stackOffset = 8;
const expandGap = 6;
const stackExpandDelayMs = 200;

type GenerationSlotStackProps = {
  isCollapsedDialog?: boolean;
  slot: GenerationSlot;
  uploads: GenerationSlotInput[];
  onFilesSelected: (files: File[]) => void;
  onPreviewUpload?: (input: GenerationSlotInput) => void;
  onRemoveUpload: (input: GenerationSlotInput) => void;
};

const cardRotations = [-6, 4, -3, 5, -4, 3, -2];

function getCardRotation(index: number) {
  return cardRotations[index % cardRotations.length];
}

export function GenerationSlotStack({
  isCollapsedDialog = false,
  slot,
  uploads,
  onFilesSelected,
  onPreviewUpload,
  onRemoveUpload
}: GenerationSlotStackProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const expandTimerRef = useRef<number | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const Icon = slot.kind === "video" ? Video : ImageIcon;
  const isSingle = slot.max === 1;
  const uploadCount = uploads.length;
  const maxReached = uploads.length >= slot.max;
  const canPickFiles = !maxReached;
  const depth = Math.min(uploadCount, 3);
  const collapsedDepth = Math.max(depth - (uploadCount > 0 ? 1 : 0), 0);
  const totalCards = uploadCount + (maxReached ? 0 : 1);
  const expanded = !isCollapsedDialog && isExpanded;
  const stackWidth = expanded
    ? totalCards * cardWidth + Math.max(totalCards - 1, 0) * expandGap
    : cardWidth + collapsedDepth * stackOffset;
  const groupWidth = stackWidth;

  useEffect(() => {
    return () => {
      if (expandTimerRef.current) window.clearTimeout(expandTimerRef.current);
    };
  }, []);

  function clearExpandTimer() {
    if (!expandTimerRef.current) return;
    window.clearTimeout(expandTimerRef.current);
    expandTimerRef.current = null;
  }

  function previewUpload(upload: GenerationSlotInput) {
    if (!onPreviewUpload) return;
    onPreviewUpload(upload);
  }

  function handlePreviewKeyDown(event: KeyboardEvent<HTMLDivElement>, upload: GenerationSlotInput) {
    if (!onPreviewUpload || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    previewUpload(upload);
  }

  return (
    <div
      className="slot-stack-wrap"
      style={{ width: groupWidth, flexBasis: groupWidth }}
      onPointerEnter={() => {
        if (isSingle) return;
        clearExpandTimer();
        expandTimerRef.current = window.setTimeout(() => setIsExpanded(true), stackExpandDelayMs);
      }}
      onPointerLeave={() => {
        if (isSingle) return;
        clearExpandTimer();
        setIsExpanded(false);
        setHoveredIndex(null);
      }}
    >
      <input
        ref={inputRef}
        className="hidden-file-input generation-slot-file-input"
        type="file"
        accept={getGenerationSlotAccept(slot.kind)}
        multiple={slot.max > 1}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length) onFilesSelected(files);
        }}
      />
      <div
        className={`slot-stack generation-slot-stack ${uploadCount ? "has-upload" : ""} ${maxReached ? "is-maxed" : ""} ${expanded ? "is-expanded" : ""} ${isSingle ? "is-single" : ""}`}
        data-name={slot.label}
        data-slot-key={slot.key}
        title={slot.description}
        style={{ width: stackWidth, height: cardHeight }}
      >
        {slot.min > 0 ? <span className="slot-required-mark" aria-hidden="true">*</span> : null}
        {uploads.map((upload, index) => {
          const fromLast = uploads.length - 1 - index;
          let transform = "translateX(0)";
          let zIndex = index + 1;
          let boxShadow: string | undefined;
          let transition: string | undefined;

          if (expanded) {
            const baseX = index * (cardWidth + expandGap);
            if (hoveredIndex === index) {
              transform = `translateX(${baseX}px) translateY(-6px) rotate(${getCardRotation(index) / 2}deg) scale(1.08)`;
              zIndex = 50;
              boxShadow = "0 18px 34px rgba(0, 0, 0, 0.42)";
              transition = "transform 0.32s cubic-bezier(.34,1.3,.64,1), box-shadow 0.28s ease";
            } else {
              transform = `translateX(${baseX}px) rotate(${getCardRotation(index) / 2}deg)`;
            }
          } else {
            const offset = (collapsedDepth - Math.min(fromLast, collapsedDepth)) * stackOffset;
            if (isSingle && hoveredIndex === index) {
              transform = `translateY(-6px) rotate(${getCardRotation(index) / 2}deg) scale(1.08)`;
              boxShadow = "0 18px 34px rgba(0, 0, 0, 0.42)";
              transition = "transform 0.32s cubic-bezier(.34,1.3,.64,1), box-shadow 0.28s ease";
            } else {
              transform = `translateX(${offset}px) rotate(${getCardRotation(index)}deg)`;
              boxShadow = fromLast > 0 ? "2px 0 8px rgba(0, 0, 0, 0.28)" : undefined;
            }
          }
          const isInteractivePreview = Boolean(onPreviewUpload);

          return (
            <div
              className={`stack-card has-file ${expanded || isSingle ? "hoverable" : ""} ${isInteractivePreview ? "is-previewable" : ""}`}
              key={upload.id}
              style={{ transform, zIndex, boxShadow, transition }}
              title={upload.fileName}
              role={isInteractivePreview ? "button" : undefined}
              tabIndex={isInteractivePreview ? 0 : undefined}
              onClick={() => previewUpload(upload)}
              onKeyDown={(event) => handlePreviewKeyDown(event, upload)}
              onPointerEnter={() => {
                if (!expanded && !isSingle) return;
                setHoveredIndex(index);
              }}
              onPointerLeave={() => {
                if (!expanded && !isSingle) return;
                setHoveredIndex((current) => (current === index ? null : current));
              }}
            >
              {upload.previewUrl && upload.kind === "image" ? (
                <img src={upload.previewUrl} alt={upload.fileName} />
              ) : upload.previewUrl && upload.kind === "video" ? (
                <video src={upload.previewUrl} muted playsInline preload="metadata" />
              ) : (
                <span className="stack-file-card">
                  <Icon size={18} />
                  <span>{upload.fileName}</span>
                </span>
              )}
              <span className="slot-preview-glyph" aria-hidden="true">
                <Maximize2 size={11} />
              </span>
              <span className="slot-card-name">{upload.fileName}</span>
              <button
                className="slot-card-remove"
                type="button"
                aria-label={`移除${upload.fileName}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onRemoveUpload(upload);
                }}
              >
                <X size={11} />
              </button>
            </div>
          );
        })}
        {canPickFiles ? (
          <button
            className="stack-card add-card"
            type="button"
            aria-label={`上传${slot.label}`}
            style={{
              transform: expanded
                ? `translateX(${uploads.length * (cardWidth + expandGap)}px)`
                : uploads.length === 0
                  ? "translateX(0)"
                  : `translateX(${Math.max(Math.min(uploads.length, 3) - 1, 0) * stackOffset}px)`,
              zIndex: expanded ? uploads.length + 1 : uploads.length === 0 ? 1 : 0
            }}
            onClick={() => inputRef.current?.click()}
          >
            <Icon size={22} />
            <span className="slot-upload-plus" aria-hidden="true">
              <Plus size={10} />
            </span>
          </button>
        ) : null}
        {!expanded && uploads.length > 1 ? <div className="slot-count-badge">{uploads.length}</div> : null}
        {!isSingle && !expanded && uploads.length > 0 && !maxReached ? (
          <button
            className="slot-add-badge"
            type="button"
            aria-label={`继续上传${slot.label}`}
            onClick={(event) => {
              event.stopPropagation();
              inputRef.current?.click();
            }}
          >
            <Plus size={10} />
          </button>
        ) : null}
        <span className="slot-label" data-kind={slot.kind}>
          {slot.shortLabel}
        </span>
      </div>
    </div>
  );
}
