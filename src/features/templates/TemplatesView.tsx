"use client";

import { useMemo, useState } from "react";
import type { TemplateFormat, TemplateIndustry, TopAd } from "@/lib/domain/schemas";
import {
  templateFormats,
  templateIndustries,
  templateIndustryMap,
  templates,
  topAdMap,
  topAds,
  topAdsCoveredIndustries
} from "@/lib/mock-data";
import { MyProductsView } from "@/features/my-products/MyProductsView";
import { TemplateCard } from "./TemplateCard";
import { TopAdDetailModal } from "./TopAdDetailModal";

type TemplatesViewProps = {
  active: boolean;
  onOpenTemplate: (templateId: string) => void;
  onReplicateAd?: (adTitle: string, prompt: string) => void;
  onCloneInAgent?: (topAdId: string, myProductId?: string) => void;
};

type LibraryTab = "ai-templates" | "my-products" | "top-ads";

const coveredTopAdIndustryIds = new Set<TemplateIndustry>(topAdsCoveredIndustries);

function buildTopAdClonePrompt(ad: TopAd) {
  const insights = ad.insights.map((insight) => `- ${insight.label}（${insight.category}）`).join("\n");
  return [
    `请在 Agent 中复刻这条 TikTok 爆款广告的高层结构：${ad.title}`,
    `品牌：${ad.brand}`,
    `地区：${ad.region}`,
    "已预标爆款逻辑：",
    insights,
    "不要直接复制原广告脚本或品牌表达。请先拆解，再迁移到当前产品包。"
  ].join("\n");
}

export function TemplatesView({ active, onOpenTemplate, onReplicateAd, onCloneInAgent }: TemplatesViewProps) {
  const [activeTab, setActiveTab] = useState<LibraryTab>("ai-templates");
  const [selectedIndustry, setSelectedIndustry] = useState<TemplateIndustry | null>(null);
  const [activeFormat, setActiveFormat] = useState<TemplateFormat | "all">("all");
  const [previewTopAdId, setPreviewTopAdId] = useState<string | null>(null);

  const industryTemplateCounts = useMemo(() => {
    const counts: Partial<Record<TemplateIndustry, number>> = {};
    for (const template of templates) {
      counts[template.industry] = (counts[template.industry] ?? 0) + 1;
    }
    return counts;
  }, []);

  const industryTopAdCounts = useMemo(() => {
    const counts: Partial<Record<TemplateIndustry, { total: number; recent: number }>> = {};
    for (const ad of topAds) {
      const entry = counts[ad.industry] ?? { total: 0, recent: 0 };
      entry.total += 1;
      if (ad.campaignDays <= 7) entry.recent += 1;
      counts[ad.industry] = entry;
    }
    return counts;
  }, []);

  const availableFormatsInIndustry = useMemo(() => {
    if (!selectedIndustry) return [];
    const formatSet = new Set<TemplateFormat>();
    for (const template of templates) {
      if (template.industry === selectedIndustry) {
        formatSet.add(template.format);
      }
    }
    return templateFormats.filter((format) => formatSet.has(format.id));
  }, [selectedIndustry]);

  const visibleTemplates = useMemo(() => {
    if (!selectedIndustry) return [];
    return templates.filter((template) => {
      if (template.industry !== selectedIndustry) return false;
      if (activeFormat !== "all" && template.format !== activeFormat) return false;
      return true;
    });
  }, [activeFormat, selectedIndustry]);

  const visibleTopAds = useMemo(() => {
    if (!selectedIndustry) return [];
    return topAds.filter((ad) => ad.industry === selectedIndustry);
  }, [selectedIndustry]);

  const previewTopAd = previewTopAdId ? topAdMap[previewTopAdId] ?? null : null;
  const industryMeta = selectedIndustry ? templateIndustryMap[selectedIndustry] : null;

  function switchTab(tab: LibraryTab) {
    if (tab === activeTab) return;
    setActiveTab(tab);
    setActiveFormat("all");
    setPreviewTopAdId(null);
  }

  function cloneTopAd(topAdId: string) {
    const ad = topAdMap[topAdId];
    if (!ad) return;
    setPreviewTopAdId(null);
    if (onCloneInAgent) {
      onCloneInAgent(topAdId);
      return;
    }
    if (onReplicateAd) {
      onReplicateAd(ad.title, buildTopAdClonePrompt(ad));
      return;
    }
    console.log("Clone top ad in Agent", topAdId);
  }

  const libraryTabs = (
    <div className="library-tabs" role="tablist" aria-label="模板库切换">
      <button
        role="tab"
        aria-selected={activeTab === "ai-templates"}
        className={`library-tab ${activeTab === "ai-templates" ? "is-active" : ""}`}
        type="button"
        onClick={() => switchTab("ai-templates")}
      >
        <span className="library-tab-label">AI 模板库</span>
        <span className="library-tab-meta">{templates.length} 个精选 · 季度更新</span>
      </button>
      <button
        role="tab"
        aria-selected={activeTab === "my-products"}
        className={`library-tab ${activeTab === "my-products" ? "is-active" : ""}`}
        type="button"
        onClick={() => switchTab("my-products")}
      >
        <span className="library-tab-label">我的产品爆款</span>
        <span className="library-tab-meta">URL 输入 · 三平台自动抓取</span>
      </button>
      <button
        role="tab"
        aria-selected={activeTab === "top-ads"}
        className={`library-tab ${activeTab === "top-ads" ? "is-active" : ""}`}
        type="button"
        onClick={() => switchTab("top-ads")}
      >
        <span className="library-tab-label">爆款广告库</span>
        <span className="library-tab-meta">{topAds.length} 条 · TikTok 实时</span>
      </button>
    </div>
  );

  const isMyProductsTab = activeTab === "my-products";

  return (
    <section id="templates" className={`view ${active ? "is-active" : ""}`} aria-label="Templates">
      <section className="section-band">
        {isMyProductsTab ? (
          <>
            <div className="section-head">
              <div>
                <h2>Templates</h2>
                <p>录入你的产品 URL，AI 自动解析卖点 + 三大广告库（TikTok / Meta / Google）只抓与你产品相关的爆款。</p>
              </div>
            </div>

            {libraryTabs}

            <MyProductsView onCloneInAgent={onCloneInAgent} onReplicateAd={onReplicateAd} />
          </>
        ) : selectedIndustry === null ? (
          <>
            <div className="section-head">
              <div>
                <h2>Templates</h2>
                <p>
                  {activeTab === "ai-templates"
                    ? "从你的行业开始。每个行业都对应一组被验证过的爆款脚本与生成参数。"
                    : "全球真实投放过的爆款广告，按地区与效果数据筛选，跳进 Agent 即可复刻。"}
                </p>
              </div>
            </div>

            {libraryTabs}

            <div className="industry-grid">
              {templateIndustries.map((industry) => {
                if (activeTab === "ai-templates") {
                  const count = industryTemplateCounts[industry.id] ?? 0;
                  const isEmpty = count === 0;
                  return (
                    <button
                      key={industry.id}
                      type="button"
                      className={`industry-card ${isEmpty ? "is-empty" : ""}`}
                      onClick={() => {
                        if (isEmpty) return;
                        setSelectedIndustry(industry.id);
                        setActiveFormat("all");
                      }}
                      disabled={isEmpty}
                      aria-disabled={isEmpty}
                    >
                      <div className={`industry-card-thumb ${industry.thumbClass}`} aria-hidden>
                        <span className="industry-card-label-overlay">{industry.label}</span>
                      </div>
                      <div className="industry-card-body">
                        <div className="industry-card-title-row">
                          <h3>{industry.label}</h3>
                          <span className="industry-card-count">{isEmpty ? "即将上线" : `${count} 个模板`}</span>
                        </div>
                        <p>{industry.summary}</p>
                      </div>
                    </button>
                  );
                }

                const stats = industryTopAdCounts[industry.id];
                const isEmpty = !coveredTopAdIndustryIds.has(industry.id) || !stats || stats.total === 0;
                return (
                  <button
                    key={industry.id}
                    type="button"
                    className={`industry-card ${isEmpty ? "is-empty" : ""}`}
                    onClick={() => {
                      if (isEmpty) return;
                      setSelectedIndustry(industry.id);
                    }}
                    disabled={isEmpty}
                    aria-disabled={isEmpty}
                  >
                    <div className={`industry-card-thumb ${industry.thumbClass}`} aria-hidden>
                      <span className="industry-card-label-overlay">{industry.label}</span>
                    </div>
                    <div className="industry-card-body">
                      <div className="industry-card-title-row">
                        <h3>{industry.label}</h3>
                        <span className="industry-card-count">
                          {isEmpty ? "即将接入" : `${stats.total} 条 · 7 天 +${stats.recent}`}
                        </span>
                      </div>
                      <p>{industry.summary}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        ) : activeTab === "ai-templates" ? (
          <>
            <div className="section-head templates-l2-head">
              <div>
                <nav className="templates-breadcrumb" aria-label="返回">
                  <button
                    type="button"
                    className="templates-back"
                    onClick={() => {
                      setSelectedIndustry(null);
                      setActiveFormat("all");
                    }}
                  >
                    ← Templates · AI 模板库
                  </button>
                  <span className="templates-breadcrumb-sep">/</span>
                  <span className="templates-breadcrumb-current">{industryMeta?.label}</span>
                </nav>
                <h2>{industryMeta?.label}</h2>
                <p>{industryMeta?.summary}</p>
              </div>
            </div>

            {libraryTabs}

            <div className="filter-row">
              <button
                className={`chip ${activeFormat === "all" ? "is-selected" : ""}`}
                type="button"
                onClick={() => setActiveFormat("all")}
              >
                全部 · {industryTemplateCounts[selectedIndustry] ?? 0}
              </button>
              {availableFormatsInIndustry.map((format) => (
                <button
                  key={format.id}
                  className={`chip ${activeFormat === format.id ? "is-selected" : ""}`}
                  type="button"
                  onClick={() => setActiveFormat(format.id)}
                  title={format.summary}
                >
                  {format.label}
                </button>
              ))}
            </div>

            <div className="template-grid large">
              {visibleTemplates.map((template) => (
                <TemplateCard key={template.id} template={template} onOpen={onOpenTemplate} />
              ))}
            </div>

            {visibleTemplates.length === 0 ? (
              <div className="templates-empty">
                该形态下暂无模板。回到{" "}
                <button type="button" className="link" onClick={() => setActiveFormat("all")}>
                  全部
                </button>{" "}
                查看本行业其他模板。
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className="section-head templates-l2-head">
              <div>
                <nav className="templates-breadcrumb" aria-label="返回">
                  <button type="button" className="templates-back" onClick={() => setSelectedIndustry(null)}>
                    ← Templates · 爆款广告库
                  </button>
                  <span className="templates-breadcrumb-sep">/</span>
                  <span className="templates-breadcrumb-current">{industryMeta?.label}</span>
                </nav>
                <h2>{industryMeta?.label} · 爆款广告</h2>
                <p>共 {visibleTopAds.length} 条 · 数据源 TikTok Creative Center</p>
              </div>
            </div>

            {libraryTabs}

            <div className="topads-filter-row" aria-label="爆款筛选（一期占位，未启用）">
              <div className="topads-filter-pill">
                <span className="topads-filter-key">地区</span>
                <span className="topads-filter-val">全球 ▾</span>
                <span className="topads-filter-soon">即将上线</span>
              </div>
              <div className="topads-filter-pill">
                <span className="topads-filter-key">时间</span>
                <span className="topads-filter-val">最近 30 天 ▾</span>
              </div>
              <div className="topads-filter-pill">
                <span className="topads-filter-key">ROAS</span>
                <span className="topads-filter-val">≥1.0 ▾</span>
              </div>
              <div className="topads-filter-pill">
                <span className="topads-filter-key">排序</span>
                <span className="topads-filter-val">视频播放量 ▾</span>
              </div>
            </div>

            <div className="topad-grid">
              {visibleTopAds.map((ad) => (
                <TopAdCard key={ad.id} ad={ad} onOpen={() => setPreviewTopAdId(ad.id)} />
              ))}
            </div>
          </>
        )}
      </section>

      <TopAdDetailModal ad={previewTopAd} onClose={() => setPreviewTopAdId(null)} onCloneInAgent={cloneTopAd} />
    </section>
  );
}

function TopAdCard({ ad, onOpen }: { ad: TopAd; onOpen: () => void }) {
  return (
    <button type="button" className="topad-card" onClick={onOpen}>
      <div className={`topad-thumb ${ad.thumbClass ?? ""}`}>
        <div className="topad-region">
          {ad.regionFlag} {ad.region}
        </div>
        <div className="topad-platform">{ad.platform}</div>
      </div>
      <div className="topad-metrics">
        <div className="topad-metric">
          <span className="topad-metric-key">观看</span>
          <span className="topad-metric-val">{ad.metrics.views}</span>
        </div>
        {ad.metrics.roas ? (
          <div className="topad-metric">
            <span className="topad-metric-key">ROAS</span>
            <span className="topad-metric-val">{ad.metrics.roas}</span>
          </div>
        ) : null}
        {ad.metrics.engagement ? (
          <div className="topad-metric">
            <span className="topad-metric-key">互动</span>
            <span className="topad-metric-val">{ad.metrics.engagement}</span>
          </div>
        ) : null}
      </div>
      <h4 className="topad-title">{ad.title}</h4>
      <div className="topad-sub">
        {ad.brand} · 投放 {ad.campaignDays} 天
      </div>
    </button>
  );
}
