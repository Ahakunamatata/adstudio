"use client";

import { Boxes, Home, Image as ImageIcon, LayoutTemplate, Sparkles, Video } from "lucide-react";
import type { AppRoute } from "@/lib/domain/schemas";
import { navRoutes } from "@/lib/routes/routes";

const icons = {
  home: Home,
  agent: Sparkles,
  video: Video,
  image: ImageIcon,
  templates: LayoutTemplate,
  assets: Boxes
} satisfies Record<string, React.ComponentType<{ className?: string; size?: number; strokeWidth?: number }>>;

type RailNavProps = {
  route: AppRoute;
  onRouteChange: (route: AppRoute) => void;
};

export function RailNav({ route, onRouteChange }: RailNavProps) {
  return (
    <aside className="rail" aria-label="Primary navigation">
      <div className="brand-mark" role="img" aria-label="Ad Studio">
        <span className="brand-mark-image" aria-hidden="true" />
      </div>
      {navRoutes.map((item) => {
        const Icon = icons[item.id];
        return (
          <button
            key={item.id}
            className={`rail-btn ${route === item.id ? "is-active" : ""}`}
            aria-label={item.ariaLabel}
            type="button"
            onClick={() => onRouteChange(item.id)}
          >
            <Icon className="icon" size={21} strokeWidth={1.8} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </aside>
  );
}
