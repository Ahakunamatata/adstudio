"use client";

/* eslint-disable @next/next/no-img-element */

import type { RefObject } from "react";
import type { GenerationMentionAsset } from "./slot-inputs";

export type GenerationMentionMenuState = {
  anchor: "button" | "prompt";
  open: boolean;
  position: { left: number; top: number } | null;
};

type GenerationImageMentionMenuProps = {
  assets: GenerationMentionAsset[];
  insertAsset: (asset: GenerationMentionAsset) => void;
  itemRefs: RefObject<Array<HTMLButtonElement | null>>;
  menu: GenerationMentionMenuState;
  menuRef: RefObject<HTMLDivElement | null>;
  selectedIndex: number;
  setSelectedIndex: (index: number) => void;
};

export function GenerationImageMentionMenu({
  assets,
  insertAsset,
  itemRefs,
  menu,
  menuRef,
  selectedIndex,
  setSelectedIndex
}: GenerationImageMentionMenuProps) {
  return (
    <div
      ref={menuRef}
      className={`generation-image-mention-menu ${menu.anchor === "button" ? "from-button" : ""}`}
      role="listbox"
      aria-label="选择输入素材"
      style={
        menu.anchor === "prompt" && menu.position
          ? {
              left: menu.position.left,
              top: menu.position.top
            }
          : undefined
      }
    >
      {assets.length ? (
        <div className="generation-image-mention-list">
          {assets.map((asset, index) => (
            <button
              key={asset.uploadId}
              ref={(node) => {
                itemRefs.current[index] = node;
              }}
              className={`generation-image-mention-item ${index === selectedIndex ? "active" : ""}`}
              type="button"
              role="option"
              aria-label={`@${asset.id}`}
              aria-selected={index === selectedIndex}
              onMouseEnter={() => setSelectedIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => insertAsset(asset)}
            >
              <img src={asset.src} alt="" />
              <span>@{asset.id}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="generation-image-mention-empty">还没有上传参考图</div>
      )}
    </div>
  );
}
