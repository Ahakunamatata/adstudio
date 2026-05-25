"use client";

import { useMemo, useState, type MouseEvent } from "react";
import type {
  MyProduct,
  MyProductPlatformProgress,
  MyProductScrapedAd,
  MyProductScrapeStatus,
  TopAd
} from "@/lib/domain/schemas";
import { topAdMap } from "@/lib/mock-data";
import { TopAdDetailModal } from "@/features/templates/TopAdDetailModal";
import { DbAdDetailModal } from "./DbAdDetailModal";
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

// DB ad（Meta web 抓 / TikTok 真广告）生成 clone prompt。比 mock TopAd 信息更丰富：
// 实际投放数据 + 完整文案 + 落地页 + CTA。
function buildDbAdClonePrompt(scraped: MyProductScrapedAd, productName: string): string {
  const d = scraped.adData;
  if (!d) {
    return `请在 Agent 中复刻广告 ${scraped.adId} 到产品「${productName}」`;
  }
  const sourceLabel =
    d.source === "meta" ? "Meta" : d.source === "tiktok" ? "TikTok" : d.source === "google" ? "Google" : scraped.platform;
  const bodySnippet = d.creativeBodies[0]?.slice(0, 300) ?? "";
  const parts: string[] = [
    `请在 Agent 中复刻这条 ${sourceLabel} 爆款广告，迁移到产品「${productName}」：`,
    `广告标题：${d.title}`,
    `广告主：${d.advertiserName ?? "(未知)"}${d.region ? ` · 地区：${d.region}` : ""}`
  ];
  if (d.pageLikeCount) parts.push(`主页粉丝：${d.pageLikeCount.toLocaleString()}`);
  if (d.ctaText) parts.push(`CTA：${d.ctaText}`);
  if (d.landingPageUrl) parts.push(`落地页：${d.landingPageUrl}`);
  if (bodySnippet) parts.push(`原文案节选：${bodySnippet}${d.creativeBodies[0] && d.creativeBodies[0].length > 300 ? "…" : ""}`);
  if (scraped.matchedKeywords.length > 0) parts.push(`命中关键词：${scraped.matchedKeywords.join(", ")}`);
  parts.push("不要直接复制原广告脚本或品牌表达，请先拆解 hook / 视觉 / 落地页结构，再迁移到当前产品包。");
  return parts.join("\n");
}

export function MyProductsView({ onCloneInAgent, onReplicateAd }: MyProductsViewProps) {
  const { products, hydrated, createProduct, removeProduct, rescrape, setAdFeedback } = useMyProducts();
  const [preferredId, setPreferredId] = useState<string | null>(null);
  const [draftOpen, setDraftOpen] = useState(false);
  const [previewTopAdId, setPreviewTopAdId] = useState<string | null>(null);
  // DB-backed ad（含 adData）走自己的 modal —— 字段结构跟 mock TopAd 完全不同
  const [previewDbScraped, setPreviewDbScraped] = useState<MyProductScrapedAd | null>(null);

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

  function handleCloneDbAd(_adId: string) {
    const scraped = previewDbScraped;
    setPreviewDbScraped(null);
    if (!scraped || !selected || !scraped.adData) return;
    // DB ad 走 prompt-based 复刻（onReplicateAd） —— 它的 ID 不在 mock topAdMap，
    // 走 onCloneInAgent 会被 AdStudioApp.startCloneFromTopAd 拒掉。
    // prompt 里塞了完整文案/landing/CTA/粉丝数，Agent Workbench 5-node LLM 拆即可。
    const prompt = buildDbAdClonePrompt(scraped, selected.name);
    if (onReplicateAd) {
      onReplicateAd(scraped.adData.title, prompt);
    }
  }

  function handleOpenAd(scraped: MyProductScrapedAd) {
    // DB ad 走 DbAdDetailModal；老 mock TopAd 走 TopAdDetailModal
    if (scraped.adData) {
      setPreviewDbScraped(scraped);
    } else {
      setPreviewTopAdId(scraped.adId);
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
            onOpenAd={handleOpenAd}
            onFeedback={(adId, fb) => setAdFeedback(selected.id, adId, fb)}
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
      <DbAdDetailModal scraped={previewDbScraped} onClose={() => setPreviewDbScraped(null)} onCloneInAgent={handleCloneDbAd} />
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
  onOpenAd,
  onFeedback
}: {
  product: MyProduct;
  onRescrape: () => void;
  onRemove: () => void;
  onOpenAd: (scraped: MyProductScrapedAd) => void;
  onFeedback: (adId: string, feedback: "positive" | "negative" | null) => void;
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

        <ScrapedAdsPanel product={product} onOpenAd={onOpenAd} onFeedback={onFeedback} />
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

type FeedbackFilter = "all" | "liked" | "hide-disliked";

function ScrapedAdsPanel({
  product,
  onOpenAd,
  onFeedback
}: {
  product: MyProduct;
  onOpenAd: (scraped: MyProductScrapedAd) => void;
  onFeedback: (adId: string, feedback: "positive" | "negative" | null) => void;
}) {
  // 默认 hide-disliked：用户没标过的看全部，标 ✗ 的自动隐藏，让 shortlist 更干净
  const [filter, setFilter] = useState<FeedbackFilter>("hide-disliked");

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

  // feedback 计数 + 各 source 数量分布（让用户一眼看到三平台覆盖广不广）
  let likedCount = 0;
  let dislikedCount = 0;
  const sourceCount = { meta: 0, tiktok: 0, google: 0, other: 0 };
  for (const s of product.scrapedAds) {
    const fb = s.adData?.userFeedback;
    if (fb === "positive") likedCount += 1;
    else if (fb === "negative") dislikedCount += 1;
    const src = s.adData?.source;
    if (src === "meta") sourceCount.meta += 1;
    else if (src === "tiktok" || src === "tiktok_cc") sourceCount.tiktok += 1;
    else if (src === "google") sourceCount.google += 1;
    else sourceCount.other += 1;
  }
  // 用 source 分布拼一个简洁文案，藏在 head 右侧
  const sourceParts: string[] = [];
  if (sourceCount.meta) sourceParts.push(`Meta ${sourceCount.meta}`);
  if (sourceCount.tiktok) sourceParts.push(`TikTok ${sourceCount.tiktok}`);
  if (sourceCount.google) sourceParts.push(`Google ${sourceCount.google}`);
  const sourceBreakdown = sourceParts.join(" · ");
  // 用 filter 过滤展示列表（保留对象引用，map 时不重新 alloc）
  const visibleAds = product.scrapedAds.filter((s) => {
    const fb = s.adData?.userFeedback ?? null;
    if (filter === "all") return true;
    if (filter === "liked") return fb === "positive";
    // hide-disliked: 默认隐藏明确 ✗ 的，未标 / ✓ 都显示
    return fb !== "negative";
  });
  const hiddenCount = product.scrapedAds.length - visibleAds.length;

  return (
    <div className="myp-detail-section">
      <div className="myp-section-head">
        <h4>个性化爆款 · 仅与你产品相关</h4>
        <span className="myp-muted">
          {sourceBreakdown || "点开查看完整数据 + Agent 复刻"}
        </span>
      </div>
      {/* feedback 过滤 tab 行：默认隐藏 ✗，可切到只看 ✓ 或全部 */}
      <div className="myp-fb-filter-row">
        <button
          type="button"
          className={`myp-fb-tab ${filter === "all" ? "is-active" : ""}`}
          onClick={() => setFilter("all")}
        >
          全部 <span className="myp-fb-tab-count">{product.scrapedAds.length}</span>
        </button>
        <button
          type="button"
          className={`myp-fb-tab ${filter === "hide-disliked" ? "is-active" : ""}`}
          onClick={() => setFilter("hide-disliked")}
        >
          隐藏 ✗ <span className="myp-fb-tab-count">{product.scrapedAds.length - dislikedCount}</span>
        </button>
        <button
          type="button"
          className={`myp-fb-tab myp-fb-tab-liked ${filter === "liked" ? "is-active" : ""}`}
          onClick={() => setFilter("liked")}
          disabled={likedCount === 0}
          title={likedCount === 0 ? "还没有标记为 ✓ 的广告" : "仅看你标 ✓ 的"}
        >
          ✓ Shortlist <span className="myp-fb-tab-count">{likedCount}</span>
        </button>
        {dislikedCount > 0 && filter !== "all" ? (
          <span className="myp-fb-hidden-hint">已隐藏 {dislikedCount} 条 ✗</span>
        ) : null}
        {filter === "liked" && hiddenCount > 0 ? (
          <span className="myp-fb-hidden-hint">已隐藏 {hiddenCount} 条未标记 / ✗</span>
        ) : null}
      </div>
      {visibleAds.length === 0 ? (
        <div className="myp-fb-empty">
          {filter === "liked"
            ? "还没有标记 ✓ 的广告。在卡片上点 ✓ 把它加入 shortlist。"
            : "当前筛选下没有匹配的广告。"}
        </div>
      ) : null}
      <div className="myp-ad-grid">
        {visibleAds.map((scraped) => {
          // DB-backed ad（scraped.adData 存在）走新路径；mock TopAd 走老路径 topAdMap 查询。
          if (scraped.adData) {
            const d = scraped.adData;
            const thumbStyle = d.thumbnailUrl
              ? { backgroundImage: `url(${d.thumbnailUrl})`, backgroundSize: "cover" as const }
              : undefined;
            // 没缩略图时，用品牌名首字母拼色块 fallback（替代纯灰块）
            const fallbackInitial = (d.advertiserName ?? d.title ?? "?").slice(0, 1).toUpperCase();
            // source 徽章：Meta 蓝 / TikTok 黑粉 / Google 绿
            // 优先用 d.source（DB ads.source 原值），fallback 用 scraped.platform 推
            const sourceKey = (() => {
              if (d.source === "meta") return "meta";
              if (d.source === "tiktok" || d.source === "tiktok_cc") return "tiktok";
              if (d.source === "google") return "google";
              return scraped.platform === "Meta" ? "meta" : scraped.platform === "TikTok" ? "tiktok" : "google";
            })();
            const sourceBadge = sourceKey === "meta" ? "M" : sourceKey === "tiktok" ? "T" : "G";
            const likes = d.pageLikeCount && d.pageLikeCount >= 1000
              ? d.pageLikeCount >= 1_000_000
                ? `${(d.pageLikeCount / 1_000_000).toFixed(1)}M`
                : `${Math.round(d.pageLikeCount / 1000)}K`
              : d.pageLikeCount?.toString();
            // ✓/✗ 反馈状态：DB 持久化的 userFeedback。这里做 toggle —— 再点一次就清空（null）
            const currentFeedback = d.userFeedback ?? null;
            const handleFb = (
              e: MouseEvent<HTMLButtonElement>,
              next: "positive" | "negative"
            ) => {
              // 父级 card 是 button，阻止冒泡，否则点 ✓ 就同时打开了 detail modal
              e.stopPropagation();
              onFeedback(scraped.adId, currentFeedback === next ? null : next);
            };
            return (
              <div
                key={`${scraped.adId}-${scraped.platform}`}
                className={`myp-ad-card-wrap ${currentFeedback === "positive" ? "is-positive" : ""} ${currentFeedback === "negative" ? "is-negative" : ""}`}
              >
                <button
                  type="button"
                  className="myp-ad-card"
                  onClick={() => onOpenAd(scraped)}
                >
                  <div className={`myp-ad-thumb ${d.thumbnailUrl ? "" : `myp-ad-thumb-fallback-${sourceKey}`}`} style={thumbStyle}>
                    {d.thumbnailUrl ? null : (
                      <div className="myp-ad-thumb-letter">{fallbackInitial}</div>
                    )}
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
                    {/* LLM rerank 推荐理由 chip —— "AI 真的懂"的核心展示 */}
                    {d.recommendReason ? (
                      <div className="myp-ad-reason" title={d.recommendReason}>
                        💡 {d.recommendReason}
                      </div>
                    ) : null}
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
                {/* ✓/✗ 反馈按钮：浮在卡片右上角，独立于 card 的 onClick */}
                <div className="myp-ad-feedback-row">
                  <button
                    type="button"
                    className={`myp-ad-feedback-btn myp-ad-feedback-pos ${currentFeedback === "positive" ? "is-active" : ""}`}
                    onClick={(e) => handleFb(e, "positive")}
                    title="这条对我的产品有帮助"
                    aria-label="标记为有用"
                  >
                    ✓
                  </button>
                  <button
                    type="button"
                    className={`myp-ad-feedback-btn myp-ad-feedback-neg ${currentFeedback === "negative" ? "is-active" : ""}`}
                    onClick={(e) => handleFb(e, "negative")}
                    title="这条不相关 / 不感兴趣"
                    aria-label="标记为不相关"
                  >
                    ✗
                  </button>
                </div>
              </div>
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
              onClick={() => onOpenAd(scraped)}
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
