"use client";

import { BarChart3 } from "lucide-react";
import type { WinningAd } from "@/lib/domain/schemas";

type WinningAdCardProps = {
  ad: WinningAd;
  onOpen: (adId: string) => void;
};

export function WinningAdCard({ ad, onOpen }: WinningAdCardProps) {
  return (
    <button className="winning-ad-card" type="button" onClick={() => onOpen(ad.id)}>
      <div className={`thumb ${ad.thumbClass}`}>
        <div className="cutline">{ad.label}</div>
      </div>
      <div className="card-meta">
        <span>{ad.platform}</span>
        <span>{ad.industry}</span>
      </div>
      <h4>{ad.title}</h4>
      <p>{ad.hook}</p>
      <div className="winning-metric-row">
        <span><BarChart3 size={13} /> {ad.metrics.views}</span>
        <span>ROAS {ad.metrics.roas}</span>
      </div>
    </button>
  );
}
