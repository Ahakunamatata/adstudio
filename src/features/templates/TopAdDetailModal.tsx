"use client";

import { useEffect, useRef } from "react";
import type { TopAd, TopAdInsight } from "@/lib/domain/schemas";

type TopAdDetailModalProps = {
  ad: TopAd | null;
  onClose: () => void;
  onCloneInAgent: (topAdId: string) => void;
};

const insightCategoryLabel: Record<TopAdInsight["category"], string> = {
  emotion: "情绪",
  hook: "钩子",
  visual: "视觉",
  localization: "本地化",
  structure: "结构"
};

export function TopAdDetailModal({ ad, onClose, onCloneInAgent }: TopAdDetailModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!ad) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ad, onClose]);

  useEffect(() => {
    if (!ad?.previewVideo) return;
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = 0;
    void video.play().catch(() => {});
  }, [ad?.id, ad?.previewVideo]);

  if (!ad) return null;

  return (
    <div className="topad-modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="topad-modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="topad-detail-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button className="topad-modal-close" type="button" onClick={onClose} aria-label="关闭">
          ×
        </button>

        <div className="topad-modal-body">
          <div className="topad-modal-media">
            {ad.previewVideo ? (
              <video ref={videoRef} className="topad-modal-video" src={ad.previewVideo} muted loop playsInline controls />
            ) : (
              <div className={`topad-modal-thumb ${ad.thumbClass ?? ""}`}>
                <div className="topad-modal-thumb-fallback">
                  {ad.platform} · {ad.durationSec}s
                </div>
              </div>
            )}
          </div>

          <div className="topad-modal-side">
            <div className="topad-modal-header">
              <div className="topad-modal-meta-row">
                <span className="topad-modal-meta-chip">
                  {ad.regionFlag} {ad.region}
                </span>
                <span className="topad-modal-meta-chip">{ad.platform}</span>
                <span className="topad-modal-meta-chip">{ad.durationSec}s</span>
                <span className="topad-modal-meta-chip verified">✓ TikTok Ad Library</span>
              </div>
              <h3 id="topad-detail-title" className="topad-modal-title">
                {ad.title}
              </h3>
              <div className="topad-modal-brand">{ad.brand}</div>
            </div>

            <div className="topad-modal-section">
              <div className="topad-modal-section-label">📊 数据表现</div>
              <div className="topad-modal-metrics">
                <div className="metric-cell">
                  <span className="metric-label">视频播放量</span>
                  <span className="metric-value">{ad.metrics.views}</span>
                </div>
                {ad.metrics.revenue ? (
                  <div className="metric-cell">
                    <span className="metric-label">预估收入</span>
                    <span className="metric-value">{ad.metrics.revenue}</span>
                  </div>
                ) : null}
                {ad.metrics.roas ? (
                  <div className="metric-cell">
                    <span className="metric-label">ROAS</span>
                    <span className="metric-value">{ad.metrics.roas}</span>
                  </div>
                ) : null}
                {ad.metrics.engagement ? (
                  <div className="metric-cell">
                    <span className="metric-label">互动率</span>
                    <span className="metric-value">{ad.metrics.engagement}</span>
                  </div>
                ) : null}
                {ad.metrics.conversion ? (
                  <div className="metric-cell">
                    <span className="metric-label">转化率</span>
                    <span className="metric-value">{ad.metrics.conversion}</span>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="topad-modal-section">
              <div className="topad-modal-section-label">📍 投放信息</div>
              <div className="topad-modal-kv">
                <div>
                  <span>发布日期</span>
                  <span>{ad.publishedAt}</span>
                </div>
                <div>
                  <span>投放时长</span>
                  <span>{ad.campaignDays} 天</span>
                </div>
                <div>
                  <span>广告主</span>
                  <span>{ad.brand}</span>
                </div>
                <div>
                  <span>地区</span>
                  <span>
                    {ad.regionFlag} {ad.region}
                  </span>
                </div>
              </div>
            </div>

            <div className="topad-modal-section">
              <div className="topad-modal-section-label">💡 为什么这条爆</div>
              <div className="topad-modal-insights">
                {ad.insights.map((insight) => (
                  <div key={`${insight.category}-${insight.label}`} className={`topad-insight insight-${insight.category}`}>
                    <span className="topad-insight-cat">{insightCategoryLabel[insight.category]}</span>
                    <span className="topad-insight-label">{insight.label}</span>
                  </div>
                ))}
              </div>
              <div className="topad-modal-insight-note">
                以上由 AI 自动识别。完整时间码拆解与卖点迁移方案，在 Agent 中查看。
              </div>
            </div>

            <button className="topad-modal-clone" type="button" onClick={() => onCloneInAgent(ad.id)}>
              🤖 在 Agent 中复刻这条广告 →
            </button>
            <div className="topad-modal-clone-hint">Agent 会自动拆解视频脚本，迁移到你的产品包。</div>
          </div>
        </div>
      </div>
    </div>
  );
}
