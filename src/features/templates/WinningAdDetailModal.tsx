"use client";

import { Database, Play, RotateCw, X } from "lucide-react";
import type { WinningAd } from "@/lib/domain/schemas";

type WinningAdDetailModalProps = {
  ad: WinningAd | null;
  onClose: () => void;
  onReplicate: (adTitle: string, prompt: string) => void;
};

export function WinningAdDetailModal({ ad, onClose, onReplicate }: WinningAdDetailModalProps) {
  if (!ad) return null;

  return (
    <div className="template-detail-overlay open" role="dialog" aria-modal="true" aria-label={`${ad.title} winning ad detail`}>
      <button className="template-detail-close icon-btn" type="button" aria-label="关闭爆款广告详情" onClick={onClose}>
        <X size={18} />
      </button>

      <div className="template-detail-shell winning-detail-shell">
        <section className="template-detail-preview">
          <div className={`template-video-frame ${ad.thumbClass}`}>
            <div className="template-video-topline">
              <span><Play size={14} /> Real ad preview</span>
              <span>{ad.platform}</span>
            </div>
            <strong>{ad.label}</strong>
            <div className="template-video-progress" />
          </div>
          <div className="winning-source-card">
            <Database size={18} />
            <div>
              <strong>{ad.sourceLabel}</strong>
              <small>{ad.region} · {ad.timeWindow}</small>
            </div>
          </div>
        </section>

        <section className="template-detail-panel">
          <div className="template-detail-head">
            <div>
              <div className="card-meta">
                <span>爆款广告库</span>
                <span>{ad.format}</span>
              </div>
              <h2>{ad.title}</h2>
              <p>{ad.hook}</p>
            </div>
          </div>

          <div className="winning-metric-grid">
            <span><small>Views</small><strong>{ad.metrics.views}</strong></span>
            <span><small>Revenue</small><strong>{ad.metrics.revenue}</strong></span>
            <span><small>ROAS</small><strong>{ad.metrics.roas}</strong></span>
            <span><small>Engagement</small><strong>{ad.metrics.engagementRate}</strong></span>
          </div>

          <div className="template-script-box">
            <div className="template-script-head">
              <strong>客观拆解预览</strong>
              <small>真实广告只进入 Agent 复刻，不直接变成 prompt 模板</small>
            </div>
            {ad.breakdown.map((item) => (
              <div className="template-script-block" key={item}>
                <p>{item}</p>
              </div>
            ))}
          </div>

          <div className="replicate-prompt-card">
            <strong>复刻元指令</strong>
            <p>{ad.replicatePrompt}</p>
          </div>

          <div className="template-detail-actions">
            <button
              className="primary-btn"
              type="button"
              onClick={() => {
                onReplicate(ad.title, ad.replicatePrompt);
                onClose();
              }}
            >
              <RotateCw size={16} /> 在 Agent 中复刻
            </button>
            <button className="ghost-btn" type="button" onClick={onClose}>关闭</button>
          </div>
        </section>
      </div>
    </div>
  );
}
