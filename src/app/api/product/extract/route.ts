import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createGoogleGenerativeAI, type GoogleLanguageModelOptions } from "@ai-sdk/google";
import { generateText, Output } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  canUseAiSdkGoogleProvider,
  getGeminiAgentConfig,
  normalizeGeminiModelId,
  type GeminiAgentConfig
} from "@/features/agent-runtime/ai-sdk/model-config";
import { canonicalizeProductUrl } from "@/lib/url/canonicalize";

type ExtractedProductImage = {
  id: string;
  url: string;
  alt: string;
};

type ExtractedProduct = {
  name: string;
  type: string;
  description: string;
  summary: string;
  painPoints: string;
  productUrl?: string;
  rawDescription?: string;
  cleanedIntro?: string;
  cleanedPainPoints?: string;
  images: ExtractedProductImage[];
  extractionWarnings?: string[];
};

type StructuredProductData = {
  name: string;
  description: string;
  imageUrls: string[];
  applicationCategory: string;
  operatingSystem: string;
};

type FetchHtmlResult = {
  html: string;
  url: string;
};

type FetchProductPageResult = FetchHtmlResult & {
  usedBrowser: boolean;
  looksLikeAntibot: boolean;
  warnings: string[];
};

type CacheEntry = {
  expiresAt: number;
  payload: { product: ExtractedProduct; error?: string };
};

export const runtime = "nodejs";

const MAX_HTML_BYTES = 1_800_000;
const FETCH_TIMEOUT_MS = 9500;
const BROWSER_FETCH_TIMEOUT_MS = 30_000;
const LLM_EXTRACTION_TIMEOUT_MS = 18_000;
const MAX_LLM_PAGE_TEXT_CHARS = 5200;
const MAX_REDIRECTS = 4;
const EXTRACTION_CACHE_TTL_MS = 1000 * 60 * 20;
const EXTRACTION_CACHE_MAX_ITEMS = 80;
const extractionCache = new Map<string, CacheEntry>();

const llmProductExtractionSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  type: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().min(1).max(1600).optional(),
  summary: z.string().trim().min(1).max(420).optional(),
  painPoints: z.string().trim().min(1).max(700).optional(),
  confidence: z.number().min(0).max(1).optional()
});

type GeminiContentPart = {
  text?: string;
};

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: GeminiContentPart[];
    };
  }>;
  promptFeedback?: {
    blockReason?: string;
  };
};

type OpenAiCompatibleChatResponse = {
  choices?: Array<{
    message?: {
      content?:
        | string
        | Array<{
            type?: string;
            text?: string;
          }>;
    };
  }>;
  error?: {
    message?: string;
  };
};

function decodeHtml(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&#x27;", "'")
    .replaceAll("&nbsp;", " ")
    .trim();
}

function stripTags(value: string) {
  return value
    .replace(/<\s*br\s*\/?\s*>/gi, " ")
    .replace(/<\/(?:p|div|li|h\d)>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function normalizeText(value: string, maxLength = 900) {
  return decodeHtml(stripTags(value).replace(/\s+/g, " ")).slice(0, maxLength).trim();
}

function normalizeMarketingText(value: string, maxLength = 1400) {
  return decodeHtml(
    value
      .replace(/\\u003cbr\\u003e/gi, " ")
      .replace(/<\s*br\s*\/?\s*>/gi, " ")
      .replace(/<\/(?:p|div|li|h\d)>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
  )
    .slice(0, maxLength)
    .trim();
}

function getReadablePageText(html: string, maxLength = 3600) {
  return normalizeMarketingText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " "),
    maxLength
  );
}

function getPageQuality(html: string) {
  const title = getTitle(html);
  const text = getReadablePageText(html, 2400);
  const combinedText = `${title} ${text}`.toLowerCase();
  const looksLikeAntibot =
    /(captcha|cloudflare|access denied|forbidden|are you human|verify you are|enable javascript|unusual traffic|robot check|请求被拒绝|访问被拒绝|人机验证|安全检查)/i.test(
      combinedText
    );
  const weakContent = text.length < 260 && !getMetaValues(html).get("description");

  return {
    textLength: text.length,
    looksLikeAntibot,
    weakContent,
    shouldUseBrowser: looksLikeAntibot || weakContent
  };
}

function isBetterBrowserHtml(candidateHtml: string, currentHtml: string) {
  const candidateQuality = getPageQuality(candidateHtml);
  const currentQuality = getPageQuality(currentHtml);
  if (currentQuality.looksLikeAntibot && !candidateQuality.looksLikeAntibot) return true;
  return candidateQuality.textLength > currentQuality.textLength + 450;
}

function canUseBrowserFallbackAfterFetchError(url: URL) {
  const hostname = url.hostname.toLowerCase();
  return (
    hostname === "play.google.com" ||
    hostname === "apps.apple.com" ||
    hostname === "www.apple.com" ||
    hostname === "apple.com" ||
    /(^|\.)amazon\.[a-z.]+$/i.test(hostname)
  );
}

function getAttributes(tag: string) {
  const attributes = new Map<string, string>();
  const attrPattern = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of tag.matchAll(attrPattern)) {
    attributes.set(match[1].toLowerCase(), decodeHtml(match[2] ?? match[3] ?? match[4] ?? ""));
  }
  return attributes;
}

function getTitle(html: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? normalizeText(match[1]) : "";
}

function getHeading(html: string) {
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return match ? normalizeText(match[1]) : "";
}

function getMetaValues(html: string) {
  const values = new Map<string, string>();
  for (const match of html.matchAll(/<meta\s+[^>]*>/gi)) {
    const attributes = getAttributes(match[0]);
    const key = attributes.get("property") ?? attributes.get("name") ?? attributes.get("itemprop");
    const content = attributes.get("content");
    if (key && content && !values.has(key.toLowerCase())) {
      values.set(key.toLowerCase(), normalizeText(content, 1200));
    }
  }
  return values;
}

function resolveUrl(url: string, baseUrl: string) {
  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return "";
  }
}

function collectStructuredObjects(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap((item) => collectStructuredObjects(item));
  if (!value || typeof value !== "object") return [];

  const item = value as Record<string, unknown>;
  return [
    item,
    ...collectStructuredObjects(item["@graph"]),
    ...collectStructuredObjects(item.mainEntity),
    ...collectStructuredObjects(item.itemListElement)
  ];
}

function getStructuredText(value: unknown, maxLength = 1200): string {
  if (typeof value === "string") return normalizeText(value, maxLength);
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = getStructuredText(item, maxLength);
      if (text) return text;
    }
  }
  if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    return getStructuredText(item.name, maxLength) || getStructuredText(item.text, maxLength);
  }
  return "";
}

function getStructuredImageUrls(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((item) => getStructuredImageUrls(item));
  if (typeof value === "object") {
    const item = value as Record<string, unknown>;
    return [
      ...getStructuredImageUrls(item.url),
      ...getStructuredImageUrls(item.contentUrl),
      ...getStructuredImageUrls(item.logo)
    ];
  }
  return [];
}

function getStructuredProductData(html: string): StructuredProductData {
  const structuredObjects: Record<string, unknown>[] = [];

  for (const match of html.matchAll(/<script\s+[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      structuredObjects.push(...collectStructuredObjects(JSON.parse(decodeHtml(match[1]))));
    } catch {
      // Ignore invalid structured data and keep using regular page metadata.
    }
  }

  const productLikeObject = structuredObjects.find((item) => {
    const rawType = item["@type"];
    const types = Array.isArray(rawType) ? rawType : [rawType];
    return types.some((type) => typeof type === "string" && /Product|SoftwareApplication|MobileApplication|WebApplication/i.test(type));
  });

  if (!productLikeObject) {
    return { name: "", description: "", imageUrls: [], applicationCategory: "", operatingSystem: "" };
  }

  return {
    name: getStructuredText(productLikeObject.name),
    description: getStructuredText(productLikeObject.description, 1600),
    imageUrls: [
      ...getStructuredImageUrls(productLikeObject.image),
      ...getStructuredImageUrls(productLikeObject.logo)
    ],
    applicationCategory: getStructuredText(productLikeObject.applicationCategory, 120),
    operatingSystem: getStructuredText(productLikeObject.operatingSystem, 120)
  };
}

function getSrcSetUrls(srcset: string) {
  return srcset
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function toImageAssets(urls: string[], baseUrl: string, label: string, maxImages = 6) {
  return uniqueStrings(urls.map((url) => normalizeImageUrl(resolveUrl(url, baseUrl))).filter(Boolean))
    .slice(0, maxImages)
    .map((url, index) => ({
      id: `${label}-${index + 1}`,
      url,
      alt: index === 0 ? "Product primary image" : `Product image ${index + 1}`
    }));
}

function normalizeImageUrl(url: string) {
  if (!url) return "";
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.hostname === "play-lh.googleusercontent.com") {
      const base = getGooglePlayImageBase(parsedUrl.toString());
      if (!/=w\d+|=s\d+/i.test(parsedUrl.toString())) return `${base}=w512-h512-rw`;
      return parsedUrl.toString().replace(/=[whs]\d+(?:-h\d+)?(?:-[^/?#&]+)*/i, (suffix) => {
        if (/w(?:48|64|76|96|128)-h|=s(?:38|64|76|96|128)/i.test(suffix)) return "=w512-h512-rw";
        return suffix;
      });
    }
  } catch {
    return url;
  }
  return url;
}

function getImages(html: string, metaValues: Map<string, string>, baseUrl: string, structuredImageUrls: string[] = []) {
  const urls = [
    ...structuredImageUrls,
    metaValues.get("og:image"),
    metaValues.get("twitter:image"),
    metaValues.get("twitter:image:src")
  ].filter(Boolean) as string[];

  for (const match of html.matchAll(/<link\s+[^>]*>/gi)) {
    const attributes = getAttributes(match[0]);
    const rel = attributes.get("rel")?.toLowerCase() ?? "";
    const href = attributes.get("href");
    if (href && (rel.includes("icon") || rel.includes("apple-touch-icon"))) urls.push(href);
  }

  for (const match of html.matchAll(/<img\s+[^>]*>/gi)) {
    const attributes = getAttributes(match[0]);
    const src = attributes.get("src") ?? attributes.get("data-src") ?? attributes.get("data-original") ?? attributes.get("data-lazy-src");
    if (src) urls.push(src);
    const srcset = attributes.get("srcset") ?? attributes.get("data-srcset");
    if (srcset) urls.push(...getSrcSetUrls(srcset));
    if (urls.length >= 14) break;
  }

  return toImageAssets(urls, baseUrl, "link-image", 6);
}

function createFallbackProduct(url: string): ExtractedProduct {
  let host = "产品链接";
  let type = "Link";
  let description = "暂未从链接中读取到完整产品介绍，可在保存前手动补充。";
  let summary = "基于产品链接创建的产品资产草稿，需要补充产品定位和核心功能。";
  let painPoints = "待补充：目标用户遇到的问题、为什么需要这个产品、产品解决后的关键收益。";

  try {
    const parsedUrl = new URL(url);
    host = parsedUrl.hostname.replace(/^www\./, "");
    const path = parsedUrl.pathname.toLowerCase();
    if (/(\.|^)apple\.com$/i.test(parsedUrl.hostname) && path.includes("/watch")) {
      host = "Apple Watch";
      type = "Product";
      description = "Apple Watch 是一款智能穿戴产品，围绕健康监测、运动记录、通知连接和日常安全能力，帮助用户更持续地管理身体状态与日常生活。";
      summary = description;
      painPoints = "用户希望用一个可靠设备持续追踪健康、运动和日常状态；用户需要在通知、运动、安全提醒和生活服务之间获得更顺畅的一体化体验；购买前用户会关注功能是否真实高频、佩戴是否舒适，以及是否值得升级";
    } else if (/(\.|^)apple\.com$/i.test(parsedUrl.hostname) && path.includes("/iphone")) {
      host = "iPhone";
      type = "Product";
      description = "iPhone 是一款智能手机产品，围绕影像能力、移动性能、系统生态和智能体验，承接日常沟通、创作、娱乐和效率场景。";
      summary = description;
      painPoints = "用户希望手机在拍摄、续航、性能和系统体验上更稳定；换机前用户会关注升级是否明显、生态衔接是否顺畅，以及价格是否值得";
    } else if (parsedUrl.hostname === "play.google.com") {
      const appId = parsedUrl.searchParams.get("id") ?? "";
      host = appId ? appId.split(".").slice(-2).join(" ") : "Google Play App";
      type = "App";
      description = "暂未从 Google Play 页面读取到完整内容，可先基于 App 链接创建草稿，并在保存前补充产品定位。";
      summary = description;
      painPoints = "用户需要快速理解这款 App 的核心功能、适用场景和下载理由；广告创作前需要补充目标人群、关键卖点和用户具体痛点";
    } else if (/amazon\.[a-z.]+$/i.test(parsedUrl.hostname)) {
      type = "Ecommerce";
      description = "暂未从商品页读取到完整内容，可先基于商品链接创建电商产品草稿，并在保存前补充卖点、价格带和使用场景。";
      summary = description;
      painPoints = "用户在购买前需要确认商品价值、适用场景、可信度和与同类产品的差异；广告创作需要明确解决的具体需求和转化理由";
    }
  } catch {
    // Keep the generic label for invalid fallback input.
  }

  return {
    name: host,
    type,
    description,
    summary,
    painPoints,
    productUrl: url,
    rawDescription: "",
    cleanedIntro: description,
    cleanedPainPoints: painPoints,
    images: []
  };
}

function isGooglePlayAppUrl(url: URL) {
  return url.hostname === "play.google.com" && url.pathname.includes("/store/apps/details");
}

function buildFetchUrl(parsedUrl: URL) {
  const nextUrl = new URL(parsedUrl.toString());
  if (isGooglePlayAppUrl(nextUrl)) {
    if (!nextUrl.searchParams.get("hl")) nextUrl.searchParams.set("hl", "zh-CN");
    if (!nextUrl.searchParams.get("gl")) nextUrl.searchParams.set("gl", "US");
  }
  return nextUrl;
}

function stripGooglePlayTitleSuffix(value: string) {
  return value
    .replace(/\s*[-–]\s*(?:Apps on Google Play|Google Play 上的应用)\s*$/i, "")
    .replace(/\s*-\s*Google Play\s*$/i, "")
    .trim();
}

function decodeJavaScriptString(value: string) {
  try {
    return JSON.parse(`"${value.replace(/\u2028|\u2029/g, " ")}"`) as string;
  } catch {
    return value
      .replace(/\\u003c/gi, "<")
      .replace(/\\u003e/gi, ">")
      .replace(/\\u0026/gi, "&")
      .replace(/\\u003d/gi, "=")
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, "\"");
  }
}

function collectScriptTextCandidates(html: string) {
  const candidates: string[] = [];
  for (const match of html.matchAll(/"((?:\\.|[^"\\])*)"/g)) {
    const text = normalizeMarketingText(decodeJavaScriptString(match[1]), 2600);
    if (!looksLikeContentText(text)) continue;
    candidates.push(text);
  }
  return uniqueStrings(candidates);
}

function looksLikeContentText(text: string) {
  if (text.length < 80) return false;
  if (/^https?:\/\//i.test(text) || text.startsWith("/store/")) return false;
  if (/%\.@|fkWDob|jsname|google_logo|ServiceLogin|function|AF_initData|<svg/i.test(text)) return false;
  if ((text.match(/[{}[\]^]/g)?.length ?? 0) > 10) return false;
  return /[a-zA-Z\u4e00-\u9fa5]/.test(text);
}

function getProductNameTerms(name: string) {
  return name
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fa5]+/i)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3 && !["app", "the", "and", "for"].includes(term));
}

function textMentionsProductName(text: string, name: string) {
  const terms = getProductNameTerms(name);
  if (!terms.length) return false;
  const comparableText = text.toLowerCase();
  return terms.some((term) => comparableText.includes(term));
}

function scoreDescriptionCandidate(text: string, preferredChinese: boolean, productName = "") {
  let score = Math.min(text.length, 1200);
  if (preferredChinese && /[\u4e00-\u9fa5]/.test(text)) score += 900;
  if (productName && textMentionsProductName(text, productName)) score += 700;
  if (/主要功能|Key Features|核心功能/i.test(text)) score += 240;
  if (/实时|GPS|定位|location|place alerts|地点提醒|SOS|手机定位|phone locator/i.test(text)) score += 180;
  if (/隐私|同意|consent|privacy/i.test(text)) score += 80;
  if (/%\.@|https?:\/\/|ServiceLogin|google/i.test(text)) score -= 800;
  return score;
}

function getBestLongDescription(html: string, fallbackDescription: string, productName = "") {
  const preferredChinese = /<html[^>]+lang=["']zh/i.test(html) || /hl\\u003dzh|hl=zh/i.test(html);
  const candidates = collectScriptTextCandidates(html);
  const relevantCandidates = productName ? candidates.filter((text) => textMentionsProductName(text, productName)) : candidates;
  const candidatePool = relevantCandidates.length ? relevantCandidates : candidates;
  const bestCandidate = candidatePool
    .sort((a, b) => scoreDescriptionCandidate(b, preferredChinese, productName) - scoreDescriptionCandidate(a, preferredChinese, productName))[0];
  if (productName && !relevantCandidates.length) return fallbackDescription;
  return normalizeMarketingText(bestCandidate || fallbackDescription, 1600) || fallbackDescription;
}

function cleanProductName(value: string) {
  return decodeHtml(value)
    .replace(/\s*[-–|]\s*(?:apps on google play|google play 上的应用|app store|official site|官网).*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function compactCopy(value: string, maxLength = 260) {
  return normalizeMarketingText(value, maxLength)
    .replace(/[✨🌟👍🔸🔹✅🔥🚀⭐️★]+/g, "")
    .replace(/\s*[•●]\s*/g, "；")
    .replace(/\s*[-–]\s+/g, "；")
    .replace(/；{2,}/g, "；")
    .trim()
    .slice(0, maxLength);
}

function getProductSignals(name: string, text: string, url: URL) {
  const combined = `${name} ${text} ${url.hostname} ${url.pathname}`.toLowerCase();
  return {
    vpn: /\b(vpn|proxy|secure proxy|ip address|hide ip|change ip|wifi security|unblock|anonymous|隐私|代理|翻墙|解锁|网络安全|ip 地址|公共 wi-?fi)\b/i.test(combined),
    game: /\b(game|games|gaming|puzzle|rpg|strategy|battle|clash|roblox|match-?3|casual)\b|游戏|手游|益智|闯关|战斗|部落|玩家|多人/i.test(combined),
    ecommerce: /\b(shop|store|cart|checkout|amazon|shopify|buy now|price)\b|商品|购买|电商|商城|下单/i.test(combined),
    saas: /\b(saas|workflow|dashboard|automation|crm|analytics|platform|api|team workspace)\b|工作流|自动化|协作|仪表盘|数据分析/i.test(combined),
    location: /\b(gps|location|locator|family safety|phone tracker)\b|定位|位置|家人|家庭安全|找手机/i.test(combined),
    consumerProduct: /\b(iphone|apple watch|watch|wearable|device|hardware|phone|tablet|laptop|camera)\b|智能手表|手机|硬件|设备|穿戴/i.test(combined)
  };
}

function inferProductType(url: URL, structuredProduct: StructuredProductData, text: string, name = "") {
  const category = structuredProduct.applicationCategory.toLowerCase();
  const signals = getProductSignals(name, text, url);
  if (isGooglePlayAppUrl(url)) {
    if (signals.vpn || signals.location || signals.saas) return "App";
    if (/game|游戏/.test(category) || signals.game) return "Game";
    return "App";
  }
  if (/apps\.apple\.com$/i.test(url.hostname)) {
    if (/game|游戏/.test(category) || signals.game) return "Game";
    return "App";
  }
  if (signals.ecommerce) return "Ecommerce";
  if (signals.saas) return "SaaS";
  if (signals.consumerProduct) return "Product";
  if (/game|游戏/.test(category) || signals.game) return "Game";
  if (/\b(?:android|ios|app)\b|应用|软件/.test(`${structuredProduct.operatingSystem} ${text}`.toLowerCase())) return "App";
  return "Link";
}

function createCleanedIntro(name: string, type: string, rawDescription: string, url: URL) {
  const signals = getProductSignals(name, rawDescription, url);
  if (signals.vpn) {
    return `${name} 是一款代理/VPN 工具，帮助用户隐藏或切换 IP，访问受限网站、社交网络、游戏和流媒体内容，并提升公共 Wi-Fi 下的隐私与连接安全。`;
  }
  if (signals.location) {
    return `${name} 是一款位置共享与安全提醒应用，帮助用户查看家人或设备位置，并在到达、离开、异常失联等场景下及时响应。`;
  }
  if (type === "Game") {
    const gameAngles: string[] = [];
    if (/strategy|策略|部落|clash|battle|war|战斗|战争/i.test(rawDescription)) gameAngles.push("策略对战");
    if (/puzzle|益智|match|消除|方块|解谜/i.test(rawDescription)) gameAngles.push("益智挑战");
    if (/multiplayer|好友|多人|社交|online|players|玩家/i.test(rawDescription)) gameAngles.push("多人社交");
    if (/create|创作|sandbox|world|avatar|角色扮演|rpg/i.test(rawDescription)) gameAngles.push("创造与角色扮演");
    const angleText = uniqueStrings(gameAngles).slice(0, 3).join("、") || "即时反馈、挑战目标和持续探索";
    return `${name} 是一款游戏产品，围绕${angleText}提供核心体验，适合用短局成就感、新鲜内容和社交互动来驱动用户尝试与留存。`;
  }
  if (type === "Ecommerce") {
    const copy = compactCopy(rawDescription, 180);
    return copy || `${name} 是一个电商/商品页面，围绕明确的产品卖点、购买理由和使用场景承接转化。`;
  }
  if (type === "SaaS") {
    const copy = compactCopy(rawDescription, 200);
    return copy || `${name} 是一款在线工具/服务，帮助用户提升工作效率、自动化重复流程，并降低协作或运营成本。`;
  }
  if (type === "Product") {
    if (/apple watch|watch/i.test(name)) {
      return `${name} 是一款智能穿戴产品，围绕健康监测、运动记录、通知连接和日常安全能力，帮助用户更持续地管理身体状态与日常生活。`;
    }
    return `${name} 是一款消费产品，围绕明确的功能价值、使用场景和品牌信任，帮助用户完成更高质量的日常体验升级。`;
  }
  const copy = compactCopy(rawDescription, 220);
  return copy || `${name} 的核心定位和功能信息需要继续补充。`;
}

function createMarketingSummary(name: string, type: string, cleanedIntro: string) {
  if (!cleanedIntro) return `${name} 的核心定位和功能信息需要继续补充。`;
  if (cleanedIntro.length <= 160) return cleanedIntro;
  if (type === "Game") return cleanedIntro.split(/[。.!！?？]/)[0].slice(0, 160);
  return cleanedIntro.slice(0, 180);
}

function inferPainPoints(name: string, type: string, rawDescription: string, url: URL) {
  const signals = getProductSignals(name, rawDescription, url);
  const painPoints: string[] = [];

  if (signals.vpn) {
    painPoints.push("用户在学校、公司或跨地区网络环境下容易遇到网站、社交内容、游戏或流媒体访问受限");
    painPoints.push("真实 IP 暴露会带来隐私风险，公共 Wi-Fi 下也担心连接安全和数据泄露");
    painPoints.push("用户希望不用复杂配置，就能快速切换地区并稳定访问目标内容");
  } else if (signals.location) {
    painPoints.push("用户难以及时确认家人或设备位置，容易产生安全焦虑");
    painPoints.push("孩子到校、家人离开关键地点或设备丢失时，缺少即时提醒和快速响应方式");
    painPoints.push("位置共享类产品需要同时建立安全感和隐私授权信任");
  } else if (type === "Game") {
    painPoints.push("用户需要低门槛、短时间内就能获得反馈和成就感的娱乐内容");
    painPoints.push("普通游戏容易缺少持续目标、社交互动或新鲜挑战，导致留存下降");
    painPoints.push("用户希望随时进入游戏，在碎片时间获得放松、竞争或探索体验");
  } else if (type === "Ecommerce") {
    painPoints.push("用户在购买前需要快速理解产品价值、使用场景和可信卖点");
    painPoints.push("同类商品选择多，用户容易因为效果不确定、价格顾虑或信任不足而犹豫");
  } else if (type === "SaaS") {
    painPoints.push("团队在重复流程、数据整理或跨工具协作上耗费时间，影响执行效率");
    painPoints.push("用户需要更清晰的工作流、更低的操作成本和可衡量的业务结果");
  } else if (type === "Product") {
    painPoints.push("用户希望用一个可靠设备持续追踪健康、运动和日常状态，而不是依赖零散记录");
    painPoints.push("用户需要在通知、运动、安全提醒和生活服务之间获得更顺畅的一体化体验");
    painPoints.push("购买前用户会关注功能是否真实高频、佩戴是否舒适，以及是否值得升级");
  }

  return uniqueStrings(painPoints).slice(0, 4).join("；") || "用户需要更快理解产品能解决什么问题、为什么值得信任，以及相比替代方案的关键收益。";
}

function parseGoogleImageArea(url: string) {
  const match = url.match(/[=?&](?:w|s)(\d+)(?:-h(\d+))?/);
  if (!match) return 0;
  const width = Number(match[1]);
  const height = Number(match[2] ?? match[1]);
  return width * height;
}

function getGooglePlayImageBase(url: string) {
  return url.replace(/=[whs]\d+(?:-h\d+)?(?:-[^/?#&]+)*/i, "");
}

function dedupeGooglePlayImageUrls(urls: string[]) {
  const seenBases = new Set<string>();
  const dedupedUrls: string[] = [];

  for (const url of urls) {
    const base = getGooglePlayImageBase(url);
    if (seenBases.has(base)) continue;
    seenBases.add(base);
    dedupedUrls.push(url);
  }

  return dedupedUrls;
}

function getGooglePlayImages(html: string, metaValues: Map<string, string>, structuredProduct: StructuredProductData, baseUrl: string) {
  const decodedHtml = html
    .replace(/\\u003d/g, "=")
    .replace(/\\u0026/g, "&")
    .replace(/\\u002F/g, "/");
  const googleImageUrls = [...decodedHtml.matchAll(/https:\/\/play-lh\.googleusercontent\.com\/[^"\\\],<\s]+/g)].map((match) => match[0]);
  const bestByBase = new Map<string, string>();

  for (const url of googleImageUrls) {
    if (/\/a\/ACg8/i.test(url)) continue;
    if (/w(?:48|96)-h(?:16|32)|=s(?:38|76)/i.test(url)) continue;

    const base = getGooglePlayImageBase(url);
    const current = bestByBase.get(base);
    if (!current || parseGoogleImageArea(url) > parseGoogleImageArea(current)) {
      bestByBase.set(base, url);
    }
  }

  const urls = dedupeGooglePlayImageUrls([
    ...structuredProduct.imageUrls,
    metaValues.get("og:image"),
    metaValues.get("twitter:image"),
    ...Array.from(bestByBase.values()).filter((url) => parseGoogleImageArea(url) >= 20_000)
  ].filter(Boolean) as string[]);

  return toImageAssets(urls, baseUrl, "google-play-image", 8);
}

function createGooglePlayProductFromHtml(html: string, url: string): ExtractedProduct {
  const parsedUrl = new URL(url);
  const metaValues = getMetaValues(html);
  const structuredProduct = getStructuredProductData(html);
  const rawTitle = structuredProduct.name || metaValues.get("og:title") || metaValues.get("twitter:title") || getHeading(html) || getTitle(html);
  const name = cleanProductName(stripGooglePlayTitleSuffix(rawTitle) || parsedUrl.searchParams.get("id") || "Google Play App");
  const shortDescription =
    structuredProduct.description ||
    metaValues.get("og:description") ||
    metaValues.get("twitter:description") ||
    metaValues.get("description") ||
    "";
  const longDescription = getBestLongDescription(html, shortDescription, name);
  const type = inferProductType(parsedUrl, structuredProduct, longDescription, name);
  const rawDescription = longDescription || shortDescription || "页面没有提供可读取的产品介绍，可在保存前手动补充。";
  const cleanedIntro = createCleanedIntro(name, type, rawDescription, parsedUrl);
  const cleanedPainPoints = inferPainPoints(name, type, rawDescription, parsedUrl);

  return {
    name,
    type,
    description: cleanedIntro,
    summary: createMarketingSummary(name, type, cleanedIntro),
    painPoints: cleanedPainPoints,
    rawDescription,
    cleanedIntro,
    cleanedPainPoints,
    images: getGooglePlayImages(html, metaValues, structuredProduct, url)
  };
}

function createProductFromHtml(html: string, url: string): ExtractedProduct {
  const parsedUrl = new URL(url);
  if (isGooglePlayAppUrl(parsedUrl)) return createGooglePlayProductFromHtml(html, url);

  const metaValues = getMetaValues(html);
  const structuredProduct = getStructuredProductData(html);
  const title = structuredProduct.name || metaValues.get("og:title") || metaValues.get("twitter:title") || getHeading(html) || getTitle(html);
  const description = structuredProduct.description || metaValues.get("og:description") || metaValues.get("twitter:description") || metaValues.get("description") || "";
  const name = cleanProductName(title || parsedUrl.hostname.replace(/^www\./, ""));
  const rawDescription = description || "页面没有提供可读取的产品介绍，可在保存前手动补充。";
  const type = inferProductType(parsedUrl, structuredProduct, rawDescription, name);
  const cleanedIntro = createCleanedIntro(name, type, rawDescription, parsedUrl);
  const cleanedPainPoints = inferPainPoints(name, type, rawDescription, parsedUrl);

  return {
    name,
    type,
    description: cleanedIntro,
    summary: createMarketingSummary(name, type, cleanedIntro),
    painPoints: cleanedPainPoints,
    rawDescription,
    cleanedIntro,
    cleanedPainPoints,
    images: getImages(html, metaValues, url, structuredProduct.imageUrls)
  };
}

function normalizeLlmProductType(value: string | undefined) {
  const text = value?.trim();
  if (!text) return "";
  if (/vpn|proxy|utility|工具|代理/i.test(text)) return "App";
  if (/game|游戏/i.test(text)) return "Game";
  if (/e-?commerce|shop|store|retail|商品|电商|商城/i.test(text)) return "Ecommerce";
  if (/saas|software|b2b|工具|平台/i.test(text)) return "SaaS";
  if (/product|hardware|device|wearable|消费品|硬件|设备|穿戴/i.test(text)) return "Product";
  if (/app|mobile|ios|android|应用/i.test(text)) return "App";
  if (/website|site|网页|网站/i.test(text)) return "Website";
  if (/link|链接/i.test(text)) return "Link";
  return text.slice(0, 40);
}

function mergeLlmProduct(product: ExtractedProduct, llmProduct: z.infer<typeof llmProductExtractionSchema>) {
  if ((llmProduct.confidence ?? 0.7) < 0.35) return product;

  return {
    ...product,
    name: llmProduct.name || product.name,
    type: normalizeLlmProductType(llmProduct.type) || product.type,
    description: llmProduct.description || llmProduct.summary || product.description,
    summary: llmProduct.summary || llmProduct.description || product.summary,
    painPoints: llmProduct.painPoints || product.painPoints,
    cleanedIntro: llmProduct.description || llmProduct.summary || product.cleanedIntro,
    cleanedPainPoints: llmProduct.painPoints || product.cleanedPainPoints
  };
}

function createLlmExtractionPrompt(product: ExtractedProduct, html: string, productUrl: string) {
  const pageText = getReadablePageText(html, MAX_LLM_PAGE_TEXT_CHARS);
  const currentProduct = {
    name: product.name,
    type: product.type,
    description: product.description,
    summary: product.summary,
    painPoints: product.painPoints
  };

  return [
    "你是广告投放产品库的信息抽取助手。请根据产品 URL 页面内容，提炼适合广告创作使用的产品画像。",
    `产品 URL：${productUrl}`,
    `当前规则抽取结果：${JSON.stringify(currentProduct)}`,
    `页面可读内容：${pageText}`,
    "输出要求：name 是产品/品牌名；type 从 App、Game、Ecommerce、SaaS、Website、Link 中优先选择；description 用中文写 1-2 句理解后的产品介绍，不要照抄页面原文；summary 用一句中文概括定位和核心能力；painPoints 用中文分号分隔 2-5 个具体用户痛点。VPN/Proxy/安全代理类 Google Play 应用应归为 App，不要因为正文出现 game 就归为 Game。不要编造页面里没有依据的具体功能。"
  ].join("\n\n");
}

function extractJsonObject(text: string): unknown {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  try {
    return JSON.parse(stripped);
  } catch {
    const match = stripped.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Gemini 返回内容不是可解析的 JSON。");
    return JSON.parse(match[0]);
  }
}

function extractOfficialGeminiText(payload: GeminiGenerateContentResponse) {
  return payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim() ?? "";
}

function extractOpenAiCompatibleText(payload: OpenAiCompatibleChatResponse) {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) return content.map((part) => part.text ?? "").join("").trim();
  return "";
}

async function requestOfficialGeminiProductExtraction(config: GeminiAgentConfig, prompt: string) {
  const response = await fetch(config.apiUrl, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": config.apiKey
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [
          {
            text: "你是广告投放产品库的信息抽取助手。只返回 JSON，不要 Markdown。"
          }
        ]
      },
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.15
      }
    }),
    signal: AbortSignal.timeout(LLM_EXTRACTION_TIMEOUT_MS)
  });

  if (!response.ok) throw new Error(`Gemini request failed: HTTP ${response.status}`);
  const payload = (await response.json()) as GeminiGenerateContentResponse;
  if (payload.promptFeedback?.blockReason) throw new Error(`Gemini blocked: ${payload.promptFeedback.blockReason}`);
  const text = extractOfficialGeminiText(payload);
  if (!text) throw new Error("Gemini returned empty content.");
  return text;
}

async function requestOpenAiCompatibleProductExtraction(config: GeminiAgentConfig, prompt: string) {
  const response = await fetch(config.apiUrl, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      messages: [
        {
          role: "developer",
          content: [{ type: "text", text: "你是广告投放产品库的信息抽取助手。只返回 JSON，不要 Markdown。" }]
        },
        {
          role: "user",
          content: [{ type: "text", text: prompt }]
        }
      ],
      stream: false,
      include_thoughts: false,
      reasoning_effort: "low"
    }),
    signal: AbortSignal.timeout(LLM_EXTRACTION_TIMEOUT_MS)
  });

  const raw = await response.text();
  let payload: OpenAiCompatibleChatResponse | null = null;
  try {
    payload = raw ? (JSON.parse(raw) as OpenAiCompatibleChatResponse) : null;
  } catch {
    // Keep payload null and use the status error below.
  }

  if (!response.ok) throw new Error(`Gemini OpenAI-compatible request failed: HTTP ${response.status}`);
  const text = payload ? extractOpenAiCompatibleText(payload) : "";
  if (!text) throw new Error("Gemini OpenAI-compatible returned empty content.");
  return text;
}

async function extractProductWithConfiguredGemini(config: GeminiAgentConfig, prompt: string) {
  const text =
    config.apiFormat === "openai"
      ? await requestOpenAiCompatibleProductExtraction(config, prompt)
      : await requestOfficialGeminiProductExtraction(config, prompt);
  return llmProductExtractionSchema.parse(extractJsonObject(text));
}

async function enrichProductWithLlm(product: ExtractedProduct, html: string, productUrl: string): Promise<ExtractedProduct> {
  const config = getGeminiAgentConfig();
  const pageText = getReadablePageText(html, 480);
  if (!config.apiKey || pageText.length < 80) return product;
  const prompt = createLlmExtractionPrompt(product, html, productUrl);

  try {
    if (canUseAiSdkGoogleProvider(config)) {
      const google = createGoogleGenerativeAI({
        apiKey: config.apiKey,
        ...(config.aiSdkBaseUrl ? { baseURL: config.aiSdkBaseUrl } : {})
      });

      const result = await generateText({
        model: google(normalizeGeminiModelId(config.model)),
        prompt,
        temperature: 0.1,
        maxRetries: 0,
        timeout: LLM_EXTRACTION_TIMEOUT_MS,
        providerOptions: {
          google: {
            structuredOutputs: false
          } satisfies GoogleLanguageModelOptions
        },
        output: Output.object({
          schema: llmProductExtractionSchema,
          name: "product_url_extraction",
          description: "Structured product information extracted from a product URL."
        })
      });

      return mergeLlmProduct(product, llmProductExtractionSchema.parse(result.output));
    }

    return mergeLlmProduct(product, await extractProductWithConfiguredGemini(config, prompt));
  } catch {
    return product;
  }
}

function isPrivateIpAddress(address: string) {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
  }
  return false;
}

async function assertPublicUrl(url: URL) {
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("只支持 http 或 https 产品链接。");
  if (!url.hostname || url.username || url.password) throw new Error("产品链接格式不正确。");
  if (/^(localhost|127\.|0\.0\.0\.0$)|\.local$/i.test(url.hostname)) throw new Error("不支持访问本地或内网地址。");

  const literalIpVersion = isIP(url.hostname);
  if (literalIpVersion && isPrivateIpAddress(url.hostname)) throw new Error("不支持访问本地或内网地址。");
  if (literalIpVersion) return;

  const addresses = await lookup(url.hostname, { all: true, verbatim: false });
  if (!addresses.length || addresses.some((address) => isPrivateIpAddress(address.address))) {
    throw new Error("不支持访问本地或内网地址。");
  }
}

async function readLimitedText(response: Response, maxBytes: number) {
  if (!response.body) return (await response.text()).slice(0, maxBytes);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    text += decoder.decode(value, { stream: bytesRead <= maxBytes });
    if (bytesRead >= maxBytes) {
      await reader.cancel();
      break;
    }
  }

  text += decoder.decode();
  return text;
}

async function fetchHtml(initialUrl: URL): Promise<FetchHtmlResult> {
  let currentUrl = buildFetchUrl(initialUrl);
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    await assertPublicUrl(currentUrl);
    const response = await fetch(currentUrl.toString(), {
      cache: "no-store",
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"
      },
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`产品页面读取失败：HTTP ${response.status}`);
      currentUrl = buildFetchUrl(new URL(location, currentUrl));
      continue;
    }

    if (!response.ok) throw new Error(`产品页面读取失败：HTTP ${response.status}`);

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      throw new Error("产品链接不是可解析的网页内容。");
    }

    return {
      html: await readLimitedText(response, MAX_HTML_BYTES),
      url: currentUrl.toString()
    };
  }

  throw new Error("产品页面跳转次数过多。");
}

async function fetchHtmlWithBrowser(initialUrl: URL): Promise<FetchHtmlResult> {
  await assertPublicUrl(initialUrl);
  const { chromium } = await import("playwright-core");
  const browserArgs = ["--disable-dev-shm-usage", "--no-sandbox"];
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;

  try {
    try {
      browser = await chromium.launch({
        channel: process.env.PRODUCT_EXTRACT_BROWSER_CHANNEL || "chrome",
        headless: true,
        args: browserArgs
      });
    } catch (error) {
      const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
      if (!executablePath) throw error;
      browser = await chromium.launch({
        executablePath,
        headless: true,
        args: browserArgs
      });
    }

    const context = await browser.newContext({
      locale: "zh-CN",
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
      extraHTTPHeaders: {
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8"
      }
    });
    const page = await context.newPage();
    const response = await page.goto(initialUrl.toString(), {
      waitUntil: "domcontentloaded",
      timeout: BROWSER_FETCH_TIMEOUT_MS
    });
    if (!response || response.status() >= 400) {
      throw new Error(`浏览器补抓失败：HTTP ${response?.status() ?? "unknown"}`);
    }

    await page.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => undefined);
    const finalUrl = new URL(page.url());
    await assertPublicUrl(finalUrl);

    return {
      html: (await page.content()).slice(0, MAX_HTML_BYTES),
      url: finalUrl.toString()
    };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

async function fetchProductPage(initialUrl: URL): Promise<FetchProductPageResult> {
  let nativeResult: FetchHtmlResult;
  try {
    nativeResult = await fetchHtml(initialUrl);
  } catch (error) {
    if (!canUseBrowserFallbackAfterFetchError(initialUrl)) throw error;

    try {
      const browserResult = await fetchHtmlWithBrowser(buildFetchUrl(initialUrl));
      const browserQuality = getPageQuality(browserResult.html);
      return {
        ...browserResult,
        usedBrowser: true,
        looksLikeAntibot: browserQuality.looksLikeAntibot,
        warnings: browserQuality.looksLikeAntibot ? ["浏览器补抓后页面仍像反爬或验证码页。"] : []
      };
    } catch {
      throw error;
    }
  }

  const quality = getPageQuality(nativeResult.html);

  if (!quality.shouldUseBrowser) {
    return {
      ...nativeResult,
      usedBrowser: false,
      looksLikeAntibot: quality.looksLikeAntibot,
      warnings: []
    };
  }

  try {
    const browserResult = await fetchHtmlWithBrowser(new URL(nativeResult.url));
    const browserQuality = getPageQuality(browserResult.html);
    if (isBetterBrowserHtml(browserResult.html, nativeResult.html)) {
      return {
        ...browserResult,
        usedBrowser: true,
        looksLikeAntibot: browserQuality.looksLikeAntibot,
        warnings: browserQuality.looksLikeAntibot ? ["浏览器补抓后页面仍像反爬或验证码页。"] : []
      };
    }
  } catch {
    // Browser fallback is best-effort; deterministic extraction remains available.
  }

  return {
    ...nativeResult,
    usedBrowser: false,
    looksLikeAntibot: quality.looksLikeAntibot,
    warnings: quality.looksLikeAntibot ? ["页面疑似反爬或验证码页，已尽量提取可读信息。"] : ["页面可读正文偏少，已生成可编辑草稿。"]
  };
}

function getCachedPayload(cacheKey: string) {
  const entry = extractionCache.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    extractionCache.delete(cacheKey);
    return null;
  }
  extractionCache.delete(cacheKey);
  extractionCache.set(cacheKey, entry);
  return entry.payload;
}

function setCachedPayload(cacheKey: string, payload: { product: ExtractedProduct; error?: string }) {
  extractionCache.set(cacheKey, {
    expiresAt: Date.now() + EXTRACTION_CACHE_TTL_MS,
    payload
  });

  while (extractionCache.size > EXTRACTION_CACHE_MAX_ITEMS) {
    const firstKey = extractionCache.keys().next().value;
    if (!firstKey) break;
    extractionCache.delete(firstKey);
  }
}

export async function POST(request: Request) {
  let productUrl = "";

  try {
    const body = (await request.json()) as { url?: string };
    productUrl = body.url?.trim() ?? "";
    const canonicalProductUrl = canonicalizeProductUrl(productUrl);
    productUrl = canonicalProductUrl;
    const parsedUrl = new URL(canonicalProductUrl);
    const fetchUrl = buildFetchUrl(parsedUrl);
    const cacheKey = fetchUrl.toString();
    const cachedPayload = getCachedPayload(cacheKey);
    if (cachedPayload) return NextResponse.json(cachedPayload);

    const { html, url, warnings } = await fetchProductPage(parsedUrl);
    const finalProductUrl = canonicalizeProductUrl(url);
    const baseProduct = {
      ...createProductFromHtml(html, url),
      productUrl: finalProductUrl,
      ...(warnings.length ? { extractionWarnings: warnings } : {})
    };
    const payload = {
      product: await enrichProductWithLlm(baseProduct, html, finalProductUrl)
    };
    setCachedPayload(cacheKey, payload);
    return NextResponse.json(payload);
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : "无法访问或解析该产品链接，已生成可编辑草稿。";
    const message = /Invalid URL/i.test(rawMessage) ? "产品链接格式不正确。" : rawMessage;
    const status = /只支持|内网|格式/.test(message) ? 400 : 200;
    const payload = {
      error: message,
      product: createFallbackProduct(productUrl)
    };
    if (status === 200 && productUrl) setCachedPayload(productUrl, payload);
    return NextResponse.json(payload, { status });
  }
}
