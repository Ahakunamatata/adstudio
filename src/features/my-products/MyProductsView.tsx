"use client";

import { useMemo, useState } from "react";
import type {
  MyProduct,
  MyProductPlatformProgress,
  MyProductScrapeStatus,
  TopAd
} from "@/lib/domain/schemas";
import { topAdMap } from "@/lib/mock-data";
import { TopAdDetailModal } from "@/features/templates/TopAdDetailModal";
import { MyProductDraftModal } from "./MyProductDraftModal";
import { useMyProducts } from "./useMyProducts";

type MyProductsViewProps = {
  // 把当前选中的「我的产品」ID 一起带到上层处理函数，让 Agent 会话知道
  // 这次复刻是为哪个产品做的（之后可用来回填 product-pack 节点）。
  onCloneInAgent?: (topAdId: string, myProductId?: string) => void;
  onReplicateAd?: (adTitle: string, prompt: string) => void;
};

const STATUS_LABEL: Record<MyProductScrapeStatus, string> = {
  idle: "等待开始",
  parsing: "解析产品中",
  ready: "解析完成",
  scraping: "全网抓取中",
  done: "已完成",
  error: "失败"
};

const STATUS_TONE: Record<MyProductScrapeStatus, string> = {
  idle: "myp-status-idle",
  parsing: "myp-status-parsing",
  ready: "myp-status-ready",
  scraping: "myp-status-scraping",
  done: "myp-status-done",
  error: "myp-status-error"
};

function platformIcon(platform: string) {
  if (platform === "TikTok") return "🎵";
  if (platform === "Meta") return "📘";
  if (platform === "Google") return "🔎";
  return "🌐";
}

function buildTopAdClonePrompt(ad: TopAd, productName: string) {
  const insights = ad.insights.map((insight) => `- ${insight.label}（${insight.category}）`).join("\n");
  return [
    `请在 Agent 中复刻这条 ${ad.platform} 爆款广告，迁移到产品「${productName}」：`,
    `广告标题：${ad.title}`,
    `品牌：${ad.brand} · 地区：${ad.region}`,
    "已预标爆款逻辑：",
    insights,
    "不要直接复制原广告脚本或品牌表达，请先拆解，再迁移到当前产品包。"
  ].join("\n");
}

export function MyProductsView({ onCloneInAgent, onReplicateAd }: MyProductsViewProps) {
  const { products, hydrated, createProduct, removeProduct, rescrape } = useMyProducts();
  const [preferredId, setPreferredId] = useState<string | null>(null);
  const [draftOpen, setDraftOpen] = useState(false);
  const [previewTopAdId, setPreviewTopAdId] = useState<string | null>(null);

  const selectedId = useMemo(() => {
    if (preferredId && products.some((product) => product.id === preferredId)) return preferredId;
    return products[0]?.id ?? null;
  }, [preferredId, products]);

  const selected = useMemo(
    () => products.find((product) => product.id === selectedId) ?? null,
    [products, selectedId]
  );

  const previewTopAd = previewTopAdId ? topAdMap[previewTopAdId] ?? null : null;

  async function handleCreate(payload: Parameters<typeof createProduct>[0]) {
    setDraftOpen(false);
    try {
      const created = await createProduct(payload);
      setPreferredId(created.id);
    } catch (error) {
      console.error("[MyProductsView] create failed:", error);
      // 简易提示，未来可以换成 toast。
      window.alert(
        `创建产品失败：${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  function handleClonePreview(topAdId: string) {
    const ad = topAdMap[topAdId];
    if (!ad) return;
    setPreviewTopAdId(null);
    if (onCloneInAgent) {
      // 把当前选中产品的 ID 传上去，让 Agent 会话记住「为哪个产品复刻」。
      onCloneInAgent(topAdId, selected?.id);
      return;
    }
    if (onReplicateAd && selected) {
      onReplicateAd(ad.title, buildTopAdClonePrompt(ad, selected.name));
    }
  }

  if (!hydrated) {
    return (
      <div className="myp-shell-loading" role="status">
        加载中…
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <>
        <EmptyState onAdd={() => setDraftOpen(true)} />
        {draftOpen ? (
          <MyProductDraftModal
            onClose={() => setDraftOpen(false)}
            onSubmit={handleCreate}
          />
        ) : null}
      </>
    );
  }

  return (
    <>
      <div className="myp-shell">
        <aside className="myp-rail">
          <div className="myp-rail-head">
            <div>
              <h3>我的产品</h3>
              <p>{products.length} 个 · 已抓取 {products.reduce((acc, product) => acc + product.scrapedAds.length, 0)} 条爆款</p>
            </div>
            <button type="button" className="myp-rail-add" onClick={() => setDraftOpen(true)}>
              ＋ 新增
            </button>
          </div>
          <div className="myp-rail-list">
            {products.map((product) => (
              <button
                key={product.id}
                type="button"
                className={`myp-rail-card ${selectedId === product.id ? "is-selected" : ""}`}
                onClick={() => setPreferredId(product.id)}
              >
                <div className="myp-rail-card-thumb">
                  {product.images[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={product.images[0]} alt="" onError={(event) => {
                      (event.currentTarget as HTMLImageElement).style.display = "none";
                    }} />
                  ) : (
                    <span>{product.name.slice(0, 1).toUpperCase()}</span>
                  )}
                </div>
                <div className="myp-rail-card-meta">
                  <strong>{product.name}</strong>
                  <small>{product.type} · {STATUS_LABEL[product.status]}</small>
                </div>
                <span className={`myp-rail-dot ${STATUS_TONE[product.status]}`} aria-hidden />
              </button>
            ))}
          </div>
        </aside>

        {selected ? (
          <ProductDetail
            product={selected}
            onRescrape={() => rescrape(selected.id)}
            onRemove={() => removeProduct(selected.id)}
            onOpenAd={(adId) => setPreviewTopAdId(adId)}
          />
        ) : (
          <div className="myp-detail-empty">从左侧选择一个产品</div>
        )}
      </div>

      {draftOpen ? (
        <MyProductDraftModal
          onClose={() => setDraftOpen(false)}
          onSubmit={handleCreate}
        />
      ) : null}

      <TopAdDetailModal ad={previewTopAd} onClose={() => setPreviewTopAdId(null)} onCloneInAgent={handleClonePreview} />
    </>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="myp-empty">
      <div className="myp-empty-icon" aria-hidden>🎯</div>
      <h2>添加你的产品，自动锁定全网爆款</h2>
      <p>
        填一次产品 URL，我们会在 TikTok、Meta、Google 三大广告库里
        持续帮你抓取相关爆款视频，并把它们沉淀在你的产品看板里。
      </p>
      <button type="button" className="myp-primary-btn myp-empty-cta" onClick={onAdd}>
        ＋ 添加第一个产品
      </button>
      <ul className="myp-empty-checklist">
        <li>✓ AI 自动解析产品介绍、痛点、关键词</li>
        <li>✓ 三平台并行抓取，预计 1-2 分钟</li>
        <li>✓ 结果按相关性排序，可直接进入 Agent 复刻</li>
      </ul>
    </div>
  );
}

function ProductDetail({
  product,
  onRescrape,
  onRemove,
  onOpenAd
}: {
  product: MyProduct;
  onRescrape: () => void;
  onRemove: () => void;
  onOpenAd: (topAdId: string) => void;
}) {
  const isWorking = product.status === "parsing" || product.status === "scraping";
  return (
    <section className="myp-detail">
      <header className="myp-detail-head">
        <div className="myp-detail-head-main">
          <div className="myp-detail-eyebrow">PRODUCT WORKBENCH</div>
          <h2>{product.name}</h2>
          <div className="myp-detail-meta-row">
            <span className={`myp-status-pill ${STATUS_TONE[product.status]}`}>
              {STATUS_LABEL[product.status]}
            </span>
            <span className="myp-detail-meta">{product.type}</span>
            {product.url ? (
              <a href={product.url} target="_blank" rel="noreferrer" className="myp-detail-link">
                源 URL ↗
              </a>
            ) : null}
          </div>
        </div>
        <div className="myp-detail-head-actions">
          <button type="button" className="myp-ghost-btn" onClick={onRescrape} disabled={isWorking}>
            🔄 重新抓取
          </button>
          <button type="button" className="myp-ghost-btn myp-danger" onClick={onRemove}>
            删除
          </button>
        </div>
      </header>

      <div className="myp-detail-body">
        <div className="myp-detail-section myp-detail-summary">
          <div className="myp-detail-summary-block">
            <h4>产品介绍</h4>
            <p>{product.intro || "—"}</p>
          </div>
          <div className="myp-detail-summary-block">
            <h4>用户痛点</h4>
            <p>{product.painPoints || "—"}</p>
          </div>
          <div className="myp-detail-summary-block">
            <h4>AI 推断的关键词</h4>
            {product.inferredKeywords.length > 0 ? (
              <div className="myp-tag-row">
                {product.inferredKeywords.map((keyword) => (
                  <span key={keyword} className="myp-tag">{keyword}</span>
                ))}
              </div>
            ) : (
              <p className="myp-muted">解析后会在这里显示。</p>
            )}
          </div>
          {product.images.length > 0 ? (
            <div className="myp-detail-summary-block">
              <h4>产品图片</h4>
              <div className="myp-thumb-row">
                {product.images.slice(0, 8).map((src, idx) => (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    key={`${src}-${idx}`}
                    src={src}
                    alt={`产品图 ${idx + 1}`}
                    onError={(event) => {
                      (event.currentTarget as HTMLImageElement).style.opacity = "0.2";
                    }}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <ProgressPanel product={product} />

        <ScrapedAdsPanel product={product} onOpenAd={onOpenAd} />
      </div>
    </section>
  );
}

function ProgressPanel({ product }: { product: MyProduct }) {
  const totalNew = product.progress.reduce((acc, p) => acc + (p.count ?? 0), 0);
  return (
    <div className="myp-detail-section">
      <div className="myp-section-head">
        <h4>抓取进度</h4>
        <span className="myp-muted">
          {product.status === "done"
            ? totalNew > 0
              ? `为你新抓 ${totalNew} 条 · 共 ${product.scrapedAds.length} 条匹配 · 最新于 ${formatTime(product.updatedAt)}`
              : `共 ${product.scrapedAds.length} 条匹配 · 最新于 ${formatTime(product.updatedAt)}`
            : product.status === "scraping"
              ? "正在 TikTok 用你的关键词定向抓取…（Meta / Google 待开通）"
              : product.status === "parsing"
                ? "AI 正在解析产品特征…"
                : "等待开始抓取"}
        </span>
      </div>
      <div className="myp-progress-grid">
        {product.progress.map((entry) => (
          <PlatformProgressCard key={entry.platform} entry={entry} status={product.status} />
        ))}
      </div>
    </div>
  );
}

function PlatformProgressCard({ entry, status }: { entry: MyProductPlatformProgress; status: MyProductScrapeStatus }) {
  const isActive = entry.status === "fetching";
  const isDone = entry.status === "done";
  const muted = status === "parsing" || status === "ready" || status === "idle";
  return (
    <div className={`myp-progress-card ${isActive ? "is-active" : ""} ${isDone ? "is-done" : ""} ${muted ? "is-muted" : ""}`}>
      <div className="myp-progress-head">
        <span className="myp-progress-icon">{platformIcon(entry.platform)}</span>
        <strong>{entry.platform}</strong>
        <span className="myp-progress-state">
          {entry.status === "done" ? `✓ ${entry.count} 条` : entry.status === "fetching" ? "抓取中…" : "排队"}
        </span>
      </div>
      <div className="myp-progress-bar">
        <span
          className={`myp-progress-fill ${isDone ? "is-full" : isActive ? "is-half" : ""}`}
          aria-hidden
        />
      </div>
    </div>
  );
}

function ScrapedAdsPanel({ product, onOpenAd }: { product: MyProduct; onOpenAd: (topAdId: string) => void }) {
  if (product.status !== "done") {
    return (
      <div className="myp-detail-section">
        <div className="myp-section-head">
          <h4>个性化爆款</h4>
        </div>
        <div className="myp-skeleton-grid">
          {[0, 1, 2].map((idx) => (
            <div key={idx} className="myp-skeleton-card">
              <div className="myp-skeleton-thumb" />
              <div className="myp-skeleton-line" />
              <div className="myp-skeleton-line short" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="myp-detail-section">
      <div className="myp-section-head">
        <h4>个性化爆款 · 仅与你产品相关</h4>
        <span className="myp-muted">点开查看完整数据 + Agent 复刻</span>
      </div>
      <div className="myp-ad-grid">
        {product.scrapedAds.map((scraped) => {
          // DB-backed ad（scraped.adData 存在）走新路径；mock TopAd 走老路径 topAdMap 查询。
          if (scraped.adData) {
            const d = scraped.adData;
            const thumbStyle = d.thumbnailUrl
              ? { backgroundImage: `url(${d.thumbnailUrl})`, backgroundSize: "cover" as const }
              : undefined;
            // source 徽章：Meta 蓝 / TikTok 黑粉 / Google 绿
            // 优先用 d.source（DB ads.source 原值），fallback 用 scraped.platform 推
            const sourceKey = d.source ?? (scraped.platform === "Meta" ? "meta" : scraped.platform === "TikTok" ? "tiktok" : "google");
            const sourceBadge = sourceKey === "meta" ? "M" : sourceKey === "tiktok" ? "T" : "G";
            const likes = d.pageLikeCount && d.pageLikeCount >= 1000
              ? d.pageLikeCount >= 1_000_000
                ? `${(d.pageLikeCount / 1_000_000).toFixed(1)}M`
                : `${Math.round(d.pageLikeCount / 1000)}K`
              : d.pageLikeCount?.toString();
            return (
              <button
                key={`${scraped.adId}-${scraped.platform}`}
                type="button"
                className="myp-ad-card"
                onClick={() => {
                  if (d.snapshotUrl) window.open(d.snapshotUrl, "_blank", "noopener,noreferrer");
                  else onOpenAd(scraped.adId);
                }}
              >
                <div className="myp-ad-thumb" style={thumbStyle}>
                  <div className="myp-ad-region">
                    {d.regionFlag ?? "🌐"} {d.region ?? ""}
                  </div>
                  <div className="myp-ad-platform">
                    <span className={`myp-ad-source-badge myp-ad-source-${sourceKey}`}>{sourceBadge}</span>
                    {d.platformLabel ?? scraped.platform}
                  </div>
                </div>
                <div className="myp-ad-body">
                  <div className="myp-ad-title">{d.title}</div>
                  <div className="myp-ad-sub">
                    {d.advertiserName ?? "(未知广告主)"}
                    {likes ? ` · ${likes} likes` : ""}
                    {d.deliveryStartAt ? ` · ${d.deliveryStartAt.slice(0, 10)} 起投` : ""}
                  </div>
                  {(d.ctaText || d.landingPageUrl) ? (
                    <div className="myp-ad-cta-row">
                      {d.ctaText ? <span className="myp-ad-cta">{d.ctaText}</span> : null}
                      {d.landingPageUrl ? (
                        <span className="myp-ad-landing" title={d.landingPageUrl}>
                          → {new URL(d.landingPageUrl).hostname.replace(/^www\./, "")}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="myp-ad-keyword-row">
                    <span className="myp-ad-score">相关性 {scraped.relevanceScore}</span>
                    {scraped.matchedKeywords.slice(0, 2).map((keyword) => (
                      <span key={keyword} className="myp-ad-keyword">{keyword}</span>
                    ))}
                  </div>
                </div>
              </button>
            );
          }

          // Mock TopAd render（老路径，保留给 seed Phone Alarm 演示）
          const ad = topAdMap[scraped.adId];
          if (!ad) return null;
          return (
            <button
              key={`${scraped.adId}-${scraped.platform}`}
              type="button"
              className="myp-ad-card"
              onClick={() => onOpenAd(scraped.adId)}
            >
              <div className={`myp-ad-thumb ${ad.thumbClass ?? ""}`}>
                <div className="myp-ad-region">
                  {ad.regionFlag} {ad.region}
                </div>
                <div className="myp-ad-platform">{platformIcon(scraped.platform)} {scraped.platform}</div>
              </div>
              <div className="myp-ad-body">
                <div className="myp-ad-title">{ad.title}</div>
                <div className="myp-ad-sub">
                  {ad.brand} · 观看 {ad.metrics.views}
                </div>
                <div className="myp-ad-keyword-row">
                  <span className="myp-ad-score">相关性 {scraped.relevanceScore}</span>
                  {scraped.matchedKeywords.slice(0, 2).map((keyword) => (
                    <span key={keyword} className="myp-ad-keyword">{keyword}</span>
                  ))}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function formatTime(iso: string) {
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit", month: "2-digit", day: "2-digit" });
  } catch {
    return iso;
  }
}
