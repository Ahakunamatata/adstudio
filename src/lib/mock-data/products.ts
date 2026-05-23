export type ProductImageAsset = {
  id: string;
  url: string;
  alt: string;
};

export type ProductAssetRecord = {
  id: string;
  name: string;
  shortName: string;
  type: string;
  assets: number;
  toneClass: string;
  summary: string;
  painPoints: string;
  description: string;
  productUrl?: string;
  images: ProductImageAsset[];
  source: "mock" | "saved";
};

type ProductExtractionDraft = Partial<ProductAssetRecord> & {
  images?: ProductImageAsset[];
  cleanedIntro?: string;
  cleanedPainPoints?: string;
  rawDescription?: string;
};

const productAssetStorageKey = "ad-studio:product-assets:v1";
const deletedProductAssetStorageKey = "ad-studio:product-assets:deleted:v1";
export const productAssetCatalogChangedEvent = "ad-studio:product-assets:changed";

export const products: ProductAssetRecord[] = [
  {
    id: "product-family-locator",
    name: "Family Locator",
    shortName: "FL",
    type: "App",
    assets: 12,
    toneClass: "",
    summary: "实时位置共享、异常提醒、家庭安全场景，面向父母、儿童和老人照护者。",
    painPoints: "孩子放学未联系、老人走失、家人临时失联、跨城市照护焦虑。",
    description: "家庭定位与安全提醒 App，帮助父母和照护者实时确认家人位置，并在异常场景下快速响应。",
    productUrl: "https://example.com/family-locator",
    images: [
      { id: "family-locator-icon", url: "/assets/example-family-locator.png", alt: "Family Locator ad preview" },
      { id: "family-locator-ui", url: "/assets/asset-app-ui.png", alt: "Family Locator app UI" }
    ],
    source: "mock"
  },
  {
    id: "product-baby-bottle",
    name: "Baby Bottle Brand",
    shortName: "BB",
    type: "Ecommerce",
    assets: 7,
    toneClass: "warm",
    summary: "安全材质、便携保温、夜间喂养效率。",
    painPoints: "新手父母担心材质安全、温度控制和夜间操作。",
    description: "母婴喂养商品，强调安全材质、温度控制和夜间使用效率。",
    productUrl: "https://example.com/baby-bottle",
    images: [
      { id: "baby-bottle-packshot", url: "/assets/example-baby-bottle.png", alt: "Baby Bottle product packshot" },
      { id: "baby-bottle-thumb", url: "/assets/thumb-ecommerce-packshot.png", alt: "Baby Bottle ecommerce thumbnail" }
    ],
    source: "mock"
  },
  {
    id: "product-game-app",
    name: "Game App",
    shortName: "GA",
    type: "Game",
    assets: 9,
    toneClass: "cool",
    summary: "轻度闯关、即时反馈、短局胜利爽感。",
    painPoints: "用户需要快速进入、短时间获得挑战和奖励。",
    description: "轻度休闲闯关游戏，围绕短局反馈、奖励节奏和低门槛上手设计广告卖点。",
    productUrl: "https://example.com/game-app",
    images: [
      { id: "game-app-preview", url: "/assets/example-mobile-game.png", alt: "Game App preview" },
      { id: "game-app-gameplay", url: "/assets/thumb-gameplay-hook.png", alt: "Game App gameplay hook" }
    ],
    source: "mock"
  }
];

function isProductAssetRecord(value: unknown): value is ProductAssetRecord {
  if (!value || typeof value !== "object") return false;
  const product = value as Partial<ProductAssetRecord>;
  return Boolean(product.id && product.name && product.shortName && product.summary && product.painPoints && Array.isArray(product.images));
}

function normalizeProductAsset(product: ProductAssetRecord): ProductAssetRecord {
  return {
    ...product,
    assets: product.images.length || product.assets || 1,
    source: product.source === "mock" ? "mock" : "saved"
  };
}

export function createProductShortName(name: string) {
  const compactName = name.trim().replace(/[^a-zA-Z0-9\u4e00-\u9fa5]+/g, "");
  if (!compactName) return "P";
  return compactName.slice(0, 2).toUpperCase();
}

export function createProductDraftFromExtraction(url: string, product: ProductExtractionDraft): ProductAssetRecord {
  const productUrl = product.productUrl?.trim() || url;
  const fallbackName = (() => {
    try {
      return new URL(productUrl).hostname.replace(/^www\./, "");
    } catch {
      return "产品链接";
    }
  })();
  const name = product.name?.trim() || fallbackName;
  const images = product.images ?? [];
  const cleanedIntro = product.cleanedIntro?.trim() || product.summary?.trim() || product.description?.trim();
  const cleanedPainPoints = product.cleanedPainPoints?.trim() || product.painPoints?.trim();

  return {
    id: product.id ?? `product-${Date.now().toString(36)}`,
    name,
    shortName: createProductShortName(name),
    type: product.type?.trim() || "Link",
    assets: Math.max(images.length, 1),
    toneClass: product.toneClass ?? "cool",
    summary: cleanedIntro || "待补充产品定位和核心功能。",
    painPoints: cleanedPainPoints || "待补充用户痛点和产品解决的问题。",
    description: cleanedIntro || "待补充产品介绍。",
    productUrl,
    images,
    source: "saved"
  };
}

export function getProductImageDisplayUrl(url: string) {
  const trimmedUrl = url.trim();
  if (!trimmedUrl || trimmedUrl.startsWith("/") || trimmedUrl.startsWith("blob:") || trimmedUrl.startsWith("data:")) return trimmedUrl;

  try {
    const parsedUrl = new URL(trimmedUrl);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) return trimmedUrl;
    if (parsedUrl.hostname === "play-lh.googleusercontent.com") return parsedUrl.toString();
    return `/api/product/image?url=${encodeURIComponent(parsedUrl.toString())}`;
  } catch {
    return trimmedUrl;
  }
}

function loadDeletedProductAssetIds() {
  if (typeof window === "undefined") return new Set<string>();

  try {
    const rawIds = window.localStorage.getItem(deletedProductAssetStorageKey);
    if (!rawIds) return new Set<string>();
    const parsedIds = JSON.parse(rawIds) as unknown;
    if (!Array.isArray(parsedIds)) return new Set<string>();
    return new Set(parsedIds.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set<string>();
  }
}

function saveDeletedProductAssetIds(ids: Set<string>) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(deletedProductAssetStorageKey, JSON.stringify(Array.from(ids)));
  } catch {
    // Keep the current UI usable if localStorage is unavailable.
  }
}

export function mergeProductAssetCatalog(savedProducts: ProductAssetRecord[]) {
  const catalog = new Map<string, ProductAssetRecord>();
  const deletedProductIds = loadDeletedProductAssetIds();
  for (const product of savedProducts) {
    if (!deletedProductIds.has(product.id)) catalog.set(product.id, normalizeProductAsset(product));
  }
  for (const product of products) {
    if (!deletedProductIds.has(product.id) && !catalog.has(product.id)) catalog.set(product.id, normalizeProductAsset(product));
  }
  return Array.from(catalog.values());
}

export function notifyProductAssetCatalogChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(productAssetCatalogChangedEvent));
}

export function addProductAssetCatalogListener(listener: () => void) {
  if (typeof window === "undefined") return () => undefined;

  function handleStorage(event: StorageEvent) {
    if (event.key === productAssetStorageKey || event.key === deletedProductAssetStorageKey) listener();
  }

  window.addEventListener(productAssetCatalogChangedEvent, listener);
  window.addEventListener("storage", handleStorage);

  return () => {
    window.removeEventListener(productAssetCatalogChangedEvent, listener);
    window.removeEventListener("storage", handleStorage);
  };
}

export function loadStoredProductAssets() {
  if (typeof window === "undefined") return [];

  try {
    const rawProducts = window.localStorage.getItem(productAssetStorageKey);
    if (!rawProducts) return [];
    const parsedProducts = JSON.parse(rawProducts) as unknown;
    if (!Array.isArray(parsedProducts)) return [];
    return parsedProducts.filter(isProductAssetRecord).map((product) => normalizeProductAsset({ ...product, source: "saved" }));
  } catch {
    return [];
  }
}

export function loadProductAssetCatalog() {
  return mergeProductAssetCatalog(loadStoredProductAssets());
}

export function saveStoredProductAsset(product: ProductAssetRecord) {
  const savedProduct = normalizeProductAsset({ ...product, source: "saved" });
  const storedProducts = loadStoredProductAssets();
  const nextProducts = [savedProduct, ...storedProducts.filter((item) => item.id !== savedProduct.id)];
  const deletedProductIds = loadDeletedProductAssetIds();
  deletedProductIds.delete(savedProduct.id);

  try {
    window.localStorage.setItem(productAssetStorageKey, JSON.stringify(nextProducts));
    saveDeletedProductAssetIds(deletedProductIds);
  } catch {
    // Keep the current UI usable if localStorage is unavailable.
  }

  notifyProductAssetCatalogChanged();
  return mergeProductAssetCatalog(nextProducts);
}

export function deleteStoredProductAsset(productId: string) {
  const storedProducts = loadStoredProductAssets();
  const nextProducts = storedProducts.filter((item) => item.id !== productId);
  const deletedProductIds = loadDeletedProductAssetIds();
  deletedProductIds.add(productId);

  try {
    window.localStorage.setItem(productAssetStorageKey, JSON.stringify(nextProducts));
    saveDeletedProductAssetIds(deletedProductIds);
  } catch {
    // Keep the current UI usable if localStorage is unavailable.
  }

  notifyProductAssetCatalogChanged();
  return mergeProductAssetCatalog(nextProducts);
}

export const productAssets = [
  { title: "Logo / Icon", tag: "locked", thumbClass: "logo-thumb", label: "FL" },
  { title: "App UI 截图", tag: "product_asset", thumbClass: "ui-thumb" },
  { title: "泰国母亲人物参考", tag: "character_reference", thumbClass: "person-thumb" },
  { title: "曼谷街景", tag: "scene_reference", thumbClass: "scene-thumb" },
  { title: "竞品视频", tag: "competitor_asset", thumbClass: "video-thumb" },
  { title: "C1 分镜视频", tag: "shot_video", thumbClass: "result-thumb" }
];
