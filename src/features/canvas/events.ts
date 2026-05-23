import type { CanvasRuntimeAction } from "./types";

export const CANVAS_ACTION_EVENT = "adstudio:canvas-action";

export function dispatchCanvasAction(action: CanvasRuntimeAction) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<CanvasRuntimeAction>(CANVAS_ACTION_EVENT, { detail: action }));
}

export function dispatchCanvasActions(actions: CanvasRuntimeAction[], delayMs = 90) {
  if (typeof window === "undefined") return;
  actions.forEach((action, index) => {
    window.setTimeout(() => dispatchCanvasAction(action), index * delayMs);
  });
}
