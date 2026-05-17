"use client";

import type { AppRoute } from "@/lib/domain/schemas";
import { navRoutes, type NavRoute } from "@/lib/routes/routes";

type RailIconProps = {
  className?: string;
  id: NavRoute;
  size?: number;
};

function RailIcon({ className, id, size = 21 }: RailIconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none">
      {id === "home" ? (
        <>
          <path d="M3.7 10.2 12 3l8.3 7.2" />
          <path d="M5.6 9.7v9.1c0 .9.7 1.6 1.6 1.6h9.6c.9 0 1.6-.7 1.6-1.6V9.7" />
          <rect className="rail-icon-accent" x="10" y="12.8" width="4" height="7.6" rx="1.1" />
        </>
      ) : null}
      {id === "agent" ? (
        <>
          <path d="M12 3.7 13.6 9l5.3 1.6-5.3 1.6L12 17.5l-1.6-5.3-5.3-1.6L10.4 9 12 3.7Z" />
          <circle className="rail-icon-accent" cx="12" cy="10.6" r="2.1" />
          <path d="M18.8 4.5v3.2" />
          <path d="M20.4 6.1h-3.2" />
          <circle cx="5.3" cy="18.6" r="1.8" />
        </>
      ) : null}
      {id === "video" ? (
        <>
          <rect x="3" y="6.7" width="12.7" height="10.6" rx="2" />
          <path className="rail-icon-accent" d="m15.7 10.1 4.8-3v9.8l-4.8-3v-3.8Z" />
        </>
      ) : null}
      {id === "image" ? (
        <>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <circle cx="9" cy="9" r="1.8" />
          <path className="rail-icon-accent" d="M6.2 19.8 13.6 12.4c.8-.8 2-.8 2.8 0l3.4 3.4v2.2c0 1-.8 1.8-1.8 1.8H6.2Z" />
        </>
      ) : null}
      {id === "templates" ? (
        <>
          <rect x="4" y="4" width="16" height="6.2" rx="1.3" />
          <rect x="4" y="14" width="8" height="6" rx="1.3" />
          <rect className="rail-icon-accent" x="15" y="14" width="5" height="6" rx="1.2" />
        </>
      ) : null}
      {id === "assets" ? (
        <>
          <path d="M12 3.8 18.7 7.5 12 11.2 5.3 7.5 12 3.8Z" />
          <path className="rail-icon-accent" d="m12 11.2 6.7-3.7v7.4L12 18.6v-7.4Z" />
          <path d="m5.3 7.5 6.7 3.7v7.4l-6.7-3.7V7.5Z" />
          <path d="M8.2 16.5 12 18.6l3.8-2.1" />
        </>
      ) : null}
    </svg>
  );
}

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
        return (
          <button
            key={item.id}
            className={`rail-btn ${route === item.id ? "is-active" : ""}`}
            aria-label={item.ariaLabel}
            type="button"
            onClick={() => onRouteChange(item.id)}
          >
            <RailIcon className="icon rail-icon" id={item.id} size={21} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </aside>
  );
}
