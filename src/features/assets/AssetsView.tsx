"use client";

import { Check, Link, Loader2, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { AgentMode, AgentUploadedAsset } from "@/lib/domain/schemas";
import {
  addProductAssetCatalogListener,
  createProductDraftFromExtraction,
  createProductShortName,
  deleteStoredProductAsset,
  getProductImageDisplayUrl,
  loadProductAssetCatalog,
  products as defaultProductCatalog,
  saveStoredProductAsset,
  type ProductAssetRecord,
  type ProductImageAsset
} from "@/lib/mock-data";

type AssetsViewProps = {
  active: boolean;
  onStartAgent: (mode: AgentMode, prompt?: string, uploadedAssets?: AgentUploadedAsset[]) => void;
};

function createProductAgentAsset(product: ProductAssetRecord): AgentUploadedAsset {
  return {
    id: product.id,
    role: "product_pack",
    name: product.name,
    kind: "product",
    source: product.source === "mock" ? "mock" : "upload"
  };
}

function createBlankProductDraft(): ProductAssetRecord {
  return {
    id: `product-${Date.now().toString(36)}`,
    name: "",
    shortName: "P",
    type: "App",
    assets: 1,
    toneClass: "cool",
    summary: "",
    painPoints: "",
    description: "",
    images: [],
    source: "saved"
  };
}

function normalizeUrlInput(value: string) {
  const trimmedValue = value.trim();
  if (!trimmedValue) return "";
  return /^https?:\/\//i.test(trimmedValue) ? trimmedValue : `https://${trimmedValue}`;
}

export function AssetsView({ active, onStartAgent }: AssetsViewProps) {
  const [productCatalog, setProductCatalog] = useState<ProductAssetRecord[]>(defaultProductCatalog);
  const [productDraft, setProductDraft] = useState<ProductAssetRecord | null>(null);
  const [productUrl, setProductUrl] = useState("");
  const [newProductImageUrl, setNewProductImageUrl] = useState("");
  const [productExtractStatus, setProductExtractStatus] = useState<"idle" | "loading" | "error">("idle");
  const [productExtractMessage, setProductExtractMessage] = useState("");

  useEffect(() => {
    const syncProductCatalog = () => {
      setProductCatalog(loadProductAssetCatalog());
    };
    const frame = window.requestAnimationFrame(syncProductCatalog);
    const removeCatalogListener = addProductAssetCatalogListener(syncProductCatalog);

    return () => {
      window.cancelAnimationFrame(frame);
      removeCatalogListener();
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    const frame = window.requestAnimationFrame(() => {
      const nextCatalog = loadProductAssetCatalog();
      setProductCatalog(nextCatalog);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [active]);

  function getProductCoverImage(product: ProductAssetRecord) {
    if (!product.images.length) return null;
    const coverIndex = Array.from(product.id).reduce((sum, char) => sum + char.charCodeAt(0), 0) % product.images.length;
    return product.images[coverIndex];
  }

  function beginEditProduct(product: ProductAssetRecord) {
    setProductDraft({
      ...product,
      images: product.images.map((image) => ({ ...image })),
      source: "saved"
    });
    setNewProductImageUrl("");
    setProductExtractStatus("idle");
    setProductExtractMessage(product.source === "mock" ? "正在编辑示例资产，保存后会成为你的产品资产。" : "");
  }

  function beginNewProduct() {
    const draft = createBlankProductDraft();
    setProductDraft(draft);
    setProductUrl("");
    setNewProductImageUrl("");
    setProductExtractStatus("idle");
    setProductExtractMessage("已创建空白产品资产草稿。");
  }

  async function createProductFromUrl() {
    const normalizedUrl = normalizeUrlInput(productUrl);
    if (!normalizedUrl) {
      setProductExtractStatus("error");
      setProductExtractMessage("请输入产品链接。");
      return;
    }

    try {
      new URL(normalizedUrl);
    } catch {
      setProductExtractStatus("error");
      setProductExtractMessage("产品链接格式不正确。");
      return;
    }

    setProductExtractStatus("loading");
    setProductExtractMessage("");

    try {
      const response = await fetch("/api/product/extract", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ url: normalizedUrl })
      });
      const payload = (await response.json()) as { error?: string; product?: Partial<ProductAssetRecord> & { images?: ProductImageAsset[] } };
      if (!payload.product) throw new Error(payload.error ?? "产品解析失败。");

      const draft = createProductDraftFromExtraction(normalizedUrl, payload.product);
      const nextDraft = payload.error ? draft : { ...draft, source: "saved" as const };
      if (!payload.error) {
        const nextCatalog = saveStoredProductAsset(nextDraft);
        setProductCatalog(nextCatalog);
      }
      setProductDraft(nextDraft);
      setNewProductImageUrl("");
      setProductExtractStatus(payload.error ? "error" : "idle");
      setProductExtractMessage(payload.error ?? "已创建产品资产，可继续编辑字段。");
    } catch (error) {
      setProductExtractStatus("error");
      setProductExtractMessage(error instanceof Error ? error.message : "产品解析失败。");
    }
  }

  function updateProductDraft(patch: Partial<ProductAssetRecord>) {
    setProductDraft((current) => {
      if (!current) return current;
      const nextProduct = { ...current, ...patch };
      return {
        ...nextProduct,
        shortName: patch.name ? createProductShortName(patch.name) : nextProduct.shortName,
        assets: nextProduct.images.length || 1
      };
    });
  }

  function removeProductImage(imageId: string) {
    if (!productDraft) return;
    updateProductDraft({
      images: productDraft.images.filter((image) => image.id !== imageId)
    });
  }

  function addProductImage() {
    const trimmedUrl = newProductImageUrl.trim();
    if (!trimmedUrl || !productDraft) return;

    try {
      new URL(trimmedUrl);
    } catch {
      setProductExtractStatus("error");
      setProductExtractMessage("图片链接格式不正确。");
      return;
    }

    updateProductDraft({
      images: [
        ...productDraft.images,
        {
          id: `product-image-${Date.now().toString(36)}`,
          url: trimmedUrl,
          alt: `${productDraft.name || "Product"} image`
        }
      ]
    });
    setNewProductImageUrl("");
    setProductExtractStatus("idle");
    setProductExtractMessage("");
  }

  function saveProductDraft() {
    if (!productDraft?.name.trim()) {
      setProductExtractStatus("error");
      setProductExtractMessage("产品名称不能为空。");
      return;
    }

    const description = productDraft.description.trim();
    const savedProduct: ProductAssetRecord = {
      ...productDraft,
      name: productDraft.name.trim(),
      shortName: createProductShortName(productDraft.name),
      assets: productDraft.images.length || 1,
      summary: productDraft.summary.trim() || description || "待补充产品定位和核心功能。",
      description: description || productDraft.summary.trim() || "待补充产品介绍。",
      painPoints: productDraft.painPoints.trim() || "待补充用户痛点和产品解决的问题。",
      source: "saved"
    };
    const nextCatalog = saveStoredProductAsset(savedProduct);
    setProductCatalog(nextCatalog);
    setProductDraft(null);
    setProductUrl("");
    setProductExtractStatus("idle");
    setProductExtractMessage("产品资产已保存。");
  }

  function cancelProductDraft() {
    setProductDraft(null);
    setNewProductImageUrl("");
    setProductExtractStatus("idle");
    setProductExtractMessage("");
  }

  function deleteProduct(product: ProductAssetRecord) {
    if (!window.confirm(`删除「${product.name}」产品资产？`)) return;
    const nextCatalog = deleteStoredProductAsset(product.id);
    setProductCatalog(nextCatalog);
    setProductDraft((current) => (current?.id === product.id ? null : current));
    setProductExtractStatus("idle");
    setProductExtractMessage("产品资产已删除。");
  }

  function startCloneWithProduct(product: ProductAssetRecord) {
    onStartAgent("clone", "", [createProductAgentAsset(product)]);
  }

  function renderProductEditorModal() {
    if (!productDraft) return null;

    return (
      <div className="asset-editor-backdrop" role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget) cancelProductDraft();
      }}>
        <section className="asset-editor-modal" role="dialog" aria-modal="true" aria-labelledby="asset-editor-title">
          <div className="product-asset-editor-head">
            <div>
              <span className="entry-tag">{productDraft.productUrl ? "URL Draft" : "Product Draft"}</span>
              <h3 id="asset-editor-title">{productDraft.name || "新产品资产"}</h3>
            </div>
            <button className="product-modal-close" type="button" aria-label="关闭编辑" onClick={cancelProductDraft}>
              <X size={18} />
            </button>
          </div>
          <div className="product-draft-editor asset-draft-editor">
            <div className="product-editor-grid">
              <label>
                产品名称
                <input
                  value={productDraft.name}
                  onChange={(event) => updateProductDraft({ name: event.target.value })}
                  placeholder="例如 Family Locator"
                />
              </label>
              <label>
                产品类型
                <input
                  value={productDraft.type}
                  onChange={(event) => updateProductDraft({ type: event.target.value })}
                  placeholder="App / Ecommerce"
                />
              </label>
            </div>
            <label>
              产品介绍
              <textarea
                value={productDraft.description}
                onChange={(event) => updateProductDraft({ description: event.target.value, summary: event.target.value })}
                placeholder="产品定位是什么，核心功能是什么。"
              />
            </label>
            <label>
              用户痛点
              <textarea
                value={productDraft.painPoints}
                onChange={(event) => updateProductDraft({ painPoints: event.target.value })}
                placeholder="为什么用户需要它，它解决什么具体问题。"
              />
            </label>
            <label>
              产品 URL
              <input
                value={productDraft.productUrl ?? ""}
                onChange={(event) => updateProductDraft({ productUrl: event.target.value })}
                placeholder="产品官网、App Store 或商品页"
              />
            </label>
            <div className="product-image-editor">
              <div className="product-image-list">
                {productDraft.images.map((image) => (
                  <div className="product-image-item" key={image.id}>
                    <div className="product-image-preview">
                      {/* eslint-disable-next-line @next/next/no-img-element -- Product asset URLs are user-provided and proxied through /api/product/image. */}
                      <img src={getProductImageDisplayUrl(image.url)} alt={image.alt || productDraft.name} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                    </div>
                    <button type="button" aria-label="删除图片" onClick={() => removeProductImage(image.id)}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
                {!productDraft.images.length ? <div className="product-image-empty">暂无图片</div> : null}
              </div>
              <div className="product-image-add">
                <input
                  type="url"
                  placeholder="新增图片 URL"
                  value={newProductImageUrl}
                  onChange={(event) => setNewProductImageUrl(event.target.value)}
                />
                <button className="ghost-btn" type="button" onClick={addProductImage}>
                  添加图片
                </button>
              </div>
            </div>
            <div className="product-editor-actions">
              <button className="ghost-btn" type="button" onClick={cancelProductDraft}>
                取消
              </button>
              <button className="ghost-btn" type="button" onClick={() => startCloneWithProduct(productDraft)} disabled={!productDraft.name.trim()}>
                <Check size={15} />
                用于复刻广告
              </button>
              <button className="primary-btn" type="button" onClick={saveProductDraft}>
                <Save size={15} />
                保存资产
              </button>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <section id="assets" className={`view ${active ? "is-active" : ""}`} aria-label="Assets">
      <div className="asset-library-head">
        <div className="asset-library-actions">
          <div className="product-link-input asset-url-input">
            <Link size={16} />
            <input
              type="url"
              placeholder="粘贴产品 URL 自动读取"
              value={productUrl}
              onChange={(event) => setProductUrl(event.target.value)}
            />
          </div>
          <button className="primary-btn" type="button" onClick={createProductFromUrl} disabled={productExtractStatus === "loading"}>
            {productExtractStatus === "loading" ? <Loader2 className="spin-icon" size={16} /> : <Plus size={16} />}
            URL 创建
          </button>
          <button className="ghost-btn" type="button" onClick={beginNewProduct}>
            <Pencil size={16} />
            手动新建
          </button>
        </div>
      </div>

      {productExtractMessage ? (
        <div className={`product-extract-note asset-extract-note ${productExtractStatus === "error" ? "is-error" : ""}`}>{productExtractMessage}</div>
      ) : null}

      <div className="assets-manager-layout">
        <div className="product-asset-grid" aria-label="产品资产卡片">
          {productCatalog.map((product) => {
            const coverImage = getProductCoverImage(product);
            return (
              <article className="product-asset-card" key={product.id}>
                <button
                  className="product-asset-card-main"
                  type="button"
                  aria-label={`编辑 ${product.name}`}
                  onClick={() => beginEditProduct(product)}
                >
                  <div
                    className={`product-asset-cover ${coverImage ? "has-image" : ""}`}
                    style={coverImage ? { backgroundImage: `url(${getProductImageDisplayUrl(coverImage.url)})` } : undefined}
                  >
                    {!coverImage ? product.shortName : null}
                  </div>
                  <div className="product-asset-card-body">
                    <div>
                      <strong>{product.name}</strong>
                      <small>{product.images.length || product.assets} 张产品图</small>
                    </div>
                  </div>
                </button>
                <button
                  className="icon-btn product-asset-delete"
                  type="button"
                  aria-label={`删除 ${product.name}`}
                  title="删除"
                  onClick={() => deleteProduct(product)}
                >
                  <Trash2 size={15} />
                </button>
              </article>
            );
          })}

          {!productCatalog.length ? (
            <div className="product-assets-empty">
              <Plus size={18} />
              <strong>还没有产品资产</strong>
              <p>可以通过 URL 自动读取，或手动创建一个产品资料包。</p>
              <button className="primary-btn" type="button" onClick={beginNewProduct}>新建产品资产</button>
            </div>
          ) : null}
        </div>
      </div>
      {renderProductEditorModal()}
    </section>
  );
}
