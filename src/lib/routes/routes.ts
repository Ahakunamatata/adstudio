import type { AppRoute } from "@/lib/domain/schemas";

export type NavRoute = Exclude<AppRoute, "agent-setup" | "workbench">;

export const pageTitles: Record<AppRoute, string> = {
  home: "Ad Studio",
  agent: "Agent",
  "agent-setup": "创建任务",
  workbench: "Agent Workbench",
  video: "Ad Video",
  image: "Ad Image",
  templates: "Templates",
  assets: "Products / Assets"
};

export const navRoutes: Array<{ id: NavRoute; label: string; ariaLabel: string }> = [
  { id: "home", label: "Home", ariaLabel: "Home" },
  { id: "agent", label: "Agent", ariaLabel: "Agent" },
  { id: "video", label: "Video", ariaLabel: "Ad Video" },
  { id: "image", label: "Image", ariaLabel: "Ad Image" },
  { id: "templates", label: "Templates", ariaLabel: "Templates" },
  { id: "assets", label: "Assets", ariaLabel: "Assets" }
];
