"use client";

import { useEffect } from "react";
import type { MyProductScrapedAd } from "@/lib/domain/schemas";

type DbAdDetailModalProps = {
  scraped: MyProductScrapedAd | null;
  onClose: () => void;
  onCloneInAgent: (adId: string) => void;
};

// 给 DB-backed ad（含 adData，Meta web 抓 / TikTok 抓的真广告）用的详情弹窗。
// mock TopAd 走 TopAdDetailModal，字段结构完全不同。
export function DbAdDetailModal({ scraped, onClose, onCloneInAgent }: DbAdDetailModalProps) {
  useEffect(() => {
    if (!scraped) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scraped, onClose]);

  if (!scraped?.adData) return null;
  const d = scraped.adData;

  const sourceKey =
    d.source ??
    (scraped.platform === "Meta" ? "meta" : scraped.platform === "TikTok" ? "tiktok" : "google");
  const sourceLabel = sourceKey === "meta" ? "Meta" : sourceKey === "tiktok" ? "TikTok" : "Google";
  const sourceBadgeChar = sourceKey === "meta" ? "M" : sourceKey === "tiktok" ? "T" : "G";

  const likes = d.pageLikeCount && d.pageLikeCount > 0
    ? d.pageLikeCount >= 1_000_000
      ? `${(d.pageLikeCount / 1_000_000).toFixed(1)}M`
      : d.pageLikeCount >= 1000
        ? `${Math.round(d.pageLikeCount / 1000)}K`
        : String(d.pageLikeCount)
    : null;

  const landingHost = d.landingPageUrl
    ? (() => {
        try {
          return new URL(d.landingPageUrl).hostname.replace(/^www\./, "");
        } catch {
          return d.landingPageUrl;
        }
      })()
    : null;

  return (
    <div className="topad-modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="topad-modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dbad-detail-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button className="topad-modal-close" type="button" onClick={onClose} aria-label="关闭">
          ×
        </button>

        <div className="topad-modal-body">
          <div className="topad-modal-media">
            {d.videoUrl ? (
              <video
                className="topad-modal-video"
                src={d.videoUrl}
                muted
                loop
                playsInline
                controls
                poster={d.thumbnailUrl ?? undefined}
              />
            ) : d.thumbnailUrl ? (
              <div
                className="topad-modal-thumb"
                style={{ backgroundImage: `url(${d.thumbnailUrl})`, backgroundSize: "cover" }}
              />
            ) : (
              <div className="topad-modal-thumb">
                <div className="topad-modal-thumb-fallback">
                  {sourceLabel} · {d.advertiserName ?? "(无视频)"}
                </div>
              </div>
            )}
          </div>

          <div className="topad-modal-side">
            <div className="topad-modal-header">
              <div className="topad-modal-meta-row">
                <span className="topad-modal-meta-chip">
                  <span className={`myp-ad-source-badge myp-ad-source-${sourceKey}`}>{sourceBadgeChar}</span>{" "}
                  {sourceLabel}
                </span>
                {d.region ? (
                  <span className="topad-modal-meta-chip">
                    {d.regionFlag ?? "🌐"} {d.region}
                  </span>
                ) : null}
                {d.platformLabel ? <span className="topad-modal-meta-chip">{d.platformLabel}</span> : null}
                <span className="topad-modal-meta-chip verified">✓ {sourceLabel} Ad Library</span>
              </div>
              <h3 id="dbad-detail-title" className="topad-modal-title">
                {d.title}
              </h3>
              <div className="topad-modal-brand">{d.advertiserName ?? "(未知广告主)"}</div>
            </div>

            {/* LLM 推荐理由 —— 详情页最显眼位置 */}
            {d.recommendReason ? (
              <div className="dbad-modal-reason">
                <span className="dbad-modal-reason-icon">💡</span>
                <div>
                  <div className="dbad-modal-reason-label">AI 推荐理由</div>
                  <div className="dbad-modal-reason-text">{d.recommendReason}</div>
                </div>
              </div>
            ) : null}

            {/* 完整 body 文案 —— DB ad 的精华 */}
            {d.creativeBodies.length > 0 ? (
              <div className="topad-modal-section">
                <div className="topad-modal-section-label">📝 完整文案</div>
                <div className="dbad-modal-body-texts">
                  {d.creativeBodies.map((text, i) => (
                    <div key={i} className="dbad-modal-body-block">
                      {text}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {/* CTA + Landing */}
            {(d.ctaText || d.landingPageUrl) ? (
              <div className="topad-modal-section">
                <div className="topad-modal-section-label">🎯 转化路径</div>
                <div className="dbad-modal-cta-row">
                  {d.ctaText ? <span className="myp-ad-cta">{d.ctaText}</span> : null}
                  {d.landingPageUrl ? (
                    <a
                      className="dbad-modal-landing-link"
                      href={d.landingPageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={d.landingPageUrl}
                    >
                      → {landingHost}
                    </a>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="topad-modal-section">
              <div className="topad-modal-section-label">📊 数据 / 投放</div>
              <div className="topad-modal-kv">
                {likes ? (
                  <div>
                    <span>主页粉丝</span>
                    <span>{likes}</span>
                  </div>
                ) : null}
                {d.deliveryStartAt ? (
                  <div>
                    <span>开投日期</span>
                    <span>{d.deliveryStartAt.slice(0, 10)}</span>
                  </div>
                ) : null}
                {d.deliveryStopAt ? (
                  <div>
                    <span>停投日期</span>
                    <span>{d.deliveryStopAt.slice(0, 10)}</span>
                  </div>
                ) : null}
                <div>
                  <span>相关性</span>
                  <span>{scraped.relevanceScore}</span>
                </div>
                {scraped.matchedKeywords.length > 0 ? (
                  <div>
                    <span>命中关键词</span>
                    <span>{scraped.matchedKeywords.slice(0, 3).join(", ")}</span>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="dbad-modal-actions">
              <button
                className="topad-modal-clone"
                type="button"
                onClick={() => onCloneInAgent(scraped.adId)}
              >
                🤖 在 Agent 中复刻这条广告 →
              </button>
              {d.snapshotUrl ? (
                <a
                  className="dbad-modal-secondary-link"
                  href={d.snapshotUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  在 {sourceLabel} 看原广告 ↗
                </a>
              ) : null}
            </div>
            <div className="topad-modal-clone-hint">Agent 会自动拆解 hook / 视觉 / 落地页结构，迁移到你的产品包。</div>
          </div>
        </div>
      </div>
    </div>
  );
}
