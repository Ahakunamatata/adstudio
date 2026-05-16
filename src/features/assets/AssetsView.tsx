"use client";

import { useState } from "react";
import type { AgentMode } from "@/lib/domain/schemas";
import { productAssets, products } from "@/lib/mock-data";

type AssetsViewProps = {
  active: boolean;
  onStartAgent: (mode: AgentMode, prompt?: string) => void;
};

export function AssetsView({ active, onStartAgent }: AssetsViewProps) {
  const [selectedProductName, setSelectedProductName] = useState(products[0].name);
  const selectedProduct = products.find((product) => product.name === selectedProductName) ?? products[0];

  return (
    <section id="assets" className={`view ${active ? "is-active" : ""}`} aria-label="Assets">
      <div className="assets-layout">
        <aside className="asset-list">
          <div className="section-head compact">
            <div>
              <h2>Products</h2>
              <p>产品包与复用资产</p>
            </div>
          </div>
          {products.map((product) => (
            <button
              className={`product-pack ${selectedProductName === product.name ? "is-selected" : ""}`}
              type="button"
              key={product.name}
              onClick={() => setSelectedProductName(product.name)}
            >
              <div className={`product-icon ${product.toneClass}`}>{product.shortName}</div>
              <div>
                <strong>{product.name}</strong>
                <small>{product.type} · {product.assets} assets</small>
              </div>
            </button>
          ))}
        </aside>

        <section className="asset-detail">
          <div className="asset-detail-head">
            <div>
              <span className="entry-tag">Product Pack</span>
              <h2>{selectedProduct.name}</h2>
            </div>
            <div className="topbar-actions">
              <button className="ghost-btn" type="button">
                编辑
              </button>
              <button className="primary-btn" type="button" onClick={() => onStartAgent("clone")}>
                用于复刻广告
              </button>
            </div>
          </div>
          <div className="product-summary">
            <div className="product-logo">{selectedProduct.shortName}</div>
            <div>
              <h3>核心卖点</h3>
              <p>{selectedProduct.summary}</p>
            </div>
            <div>
              <h3>痛点</h3>
              <p>{selectedProduct.painPoints}</p>
            </div>
          </div>
          <div className="asset-grid">
            {productAssets.map((asset) => (
              <article className="asset-card" key={asset.title}>
                <div className={`asset-thumb ${asset.thumbClass}`}>{asset.label}</div>
                <strong>{asset.title}</strong>
                <span>{asset.tag}</span>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
