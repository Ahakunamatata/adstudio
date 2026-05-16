"use client";

import type { AppRoute } from "@/lib/domain/schemas";
import { pageTitles } from "@/lib/routes/routes";

type TopbarProps = {
  route: AppRoute;
};

export function Topbar({ route }: TopbarProps) {
  return (
    <header className="topbar">
      <div>
        <h1 id="page-title">{pageTitles[route] ?? "Ad Studio"}</h1>
      </div>
    </header>
  );
}
