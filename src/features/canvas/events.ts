import type { CanvasRuntimeAction } from "./types";

export const CANVAS_ACTION_EVENT = "adstudio:canvas-action";

export function dispatchCanvasAction(action: CanvasRuntimeAction) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<CanvasRuntimeAction>(CANVAS_ACTION_EVENT, { detail: action }));
}
