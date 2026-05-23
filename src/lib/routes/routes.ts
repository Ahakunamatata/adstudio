import type { AppRoute } from "@/lib/domain/schemas";

export type NavRoute = Exclude<AppRoute, "agent-setup" | "workbench">;

export const routePaths: Record<AppRoute, string> = {
  home: "/",
  agent: "/ai-ad-agent",
  "agent-setup": "/agent/setup",
  workbench: "/ad-workbench",
  video: "/ad-video-generator",
  image: "/ad-image-generator",
  templates: "/ad-template-library",
  assets: "/ad-asset-library"
};

export const routeSeo: Record<AppRoute, { title: string; description: string; indexable: boolean }> = {
  home: {
    title: "Ad Studio | AI Ad Production Studio",
    description: "Create, remix, and manage AI ad creatives from product assets, templates, and agent-guided workflows.",
    indexable: true
  },
  agent: {
    title: "AI Ad Agent | Ad Studio",
    description: "Use an AI ad agent to analyze products, competitor creatives, and campaign goals before building new ad concepts.",
    indexable: true
  },
  "agent-setup": {
    title: "Create AI Ad Agent Task | Ad Studio",
    description: "Set up an AI ad agent task for ad analysis and creative production.",
    indexable: false
  },
  workbench: {
    title: "Ad Workbench | Ad Studio",
    description: "Work on an ad project with agent chat, creative nodes, source assets, and generation results.",
    indexable: false
  },
  video: {
    title: "AI Ad Video Generator | Ad Studio",
    description: "Generate performance ad videos from prompts, product images, reference videos, and creative templates.",
    indexable: true
  },
  image: {
    title: "AI Ad Image Generator | Ad Studio",
    description: "Generate ad images and product creative variants from prompts, references, and campaign-ready presets.",
    indexable: true
  },
  templates: {
    title: "Ad Template Library | Ad Studio",
    description: "Browse ad creative templates for app install ads, UGC videos, ecommerce ads, and product demos.",
    indexable: true
  },
  assets: {
    title: "Ad Asset Library | Ad Studio",
    description: "Manage product assets, product images, and creative references for AI ad generation workflows.",
    indexable: true
  }
};

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

function normalizePathname(pathname: string) {
  const pathOnly = pathname.split(/[?#]/, 1)[0] || "/";
  if (pathOnly === "/") return pathOnly;
  return pathOnly.replace(/\/+$/, "");
}

export function getRoutePath(route: AppRoute) {
  return routePaths[route];
}

export function getRouteFromPath(pathname: string): AppRoute | null {
  const normalizedPathname = normalizePathname(pathname);
  const entry = Object.entries(routePaths).find(([, path]) => normalizePathname(path) === normalizedPathname);
  return entry ? (entry[0] as AppRoute) : null;
}
