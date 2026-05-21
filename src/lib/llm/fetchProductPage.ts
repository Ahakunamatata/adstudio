// Server-only product-page fetcher.
//
// 两段式策略（"100% URL 都能解析"的硬要求）：
//   1. 先用 native fetch 拉一次，足够快（200-500ms）。
//      绝大多数独立站、App Store、Shopify、产品 landing 一发就能拿到完整 HTML。
//   2. 如果检测到反爬墙（title="Amazon.com" / "Robot Check" / body 太短）或者
//      内容质量太差 → 自动 fallback 到 Playwright 真浏览器加载（5-15s），
//      Amazon / Cloudflare / 国内电商通通能穿透。
//
// Playwright fallback 只在反爬命中时启动，对正常站不增加延迟。

const DEFAULT_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 1_500_000; // 1.5MB 上限，防超大页面把进程拖死
const BODY_TEXT_CAP = 8000;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

export class ProductPageError extends Error {
  constructor(
    message: string,
    public code:
      | "INVALID_URL"
      | "TIMEOUT"
      | "NETWORK"
      | "HTTP_ERROR"
      | "BAD_CONTENT_TYPE"
      | "TOO_LARGE"
      | "EMPTY"
  ) {
    super(message);
    this.name = "ProductPageError";
  }
}

export type ProductPageContent = {
  finalUrl: string;
  title: string;
  description: string;
  bodyText: string;
  // og:image / twitter:image / 首个有效 <img> 的 src，用作"产品主视觉"
  // —— 让前端 modal 解析完能直接放图给用户预览，不用手填。
  mainImageUrl: string | null;
  // true 表示我们 fetch 到的内容看起来是 robot wall / captcha / 短壳页，
  // 不是真产品页（Amazon / 部分独立站 / 大公司反爬严的常见现象）。
  // 上层（LLM prompt）拿到这个信号就**别拿 page 内容当产品描述用**，
  // 改靠 URL 域名 + 用户补充信息推断。
  looksLikeAntibot: boolean;
  fetchedAt: string;
  bytes: number;
};

export async function fetchProductPage(
  rawUrl: string,
  options: { timeoutMs?: number; signal?: AbortSignal; forceBrowser?: boolean } = {}
): Promise<ProductPageContent> {
  const url = validateUrl(rawUrl);
  if (!url) throw new ProductPageError(`invalid URL: ${rawUrl}`, "INVALID_URL");

  // 强制走浏览器（user 显式要求 / debug）
  if (options.forceBrowser) {
    return fetchWithPlaywright(url.toString(), options.timeoutMs ?? 25_000);
  }

  // 先用 native fetch 试一次
  let simpleResult: ProductPageContent | null = null;
  try {
    simpleResult = await fetchWithNativeFetch(rawUrl, options);
  } catch (error) {
    // simple fetch 完全失败（网络错误 / 超时 / 协议错） → 直接上浏览器
    if (error instanceof ProductPageError && error.code === "INVALID_URL") {
      throw error;
    }
    console.warn(`[fetchProductPage] native fetch failed, falling to Playwright:`, error);
    return fetchWithPlaywright(url.toString(), options.timeoutMs ?? 25_000);
  }

  // simple fetch 成功但是反爬墙/内容质量差 → 用 Playwright 重试
  if (simpleResult.looksLikeAntibot) {
    console.log(`[fetchProductPage] antibot wall detected, retrying with Playwright`);
    try {
      const browserResult = await fetchWithPlaywright(
        url.toString(),
        options.timeoutMs ?? 25_000
      );
      // 浏览器 fallback 拿到真页面就返回浏览器版本
      if (!browserResult.looksLikeAntibot) return browserResult;
      // 浏览器也被反爬挡（罕见）→ 至少返回浏览器拿到的 og:image / title 等
      return browserResult;
    } catch (error) {
      console.warn(`[fetchProductPage] Playwright fallback failed:`, error);
      // 浏览器也死了，返回 simple fetch 结果，让上层 LLM 用 URL 推断兜底
      return simpleResult;
    }
  }

  return simpleResult;
}

async function fetchWithNativeFetch(
  rawUrl: string,
  options: { timeoutMs?: number; signal?: AbortSignal }
): Promise<ProductPageContent> {
  const url = validateUrl(rawUrl);
  if (!url) throw new ProductPageError(`invalid URL: ${rawUrl}`, "INVALID_URL");

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const localController = new AbortController();
  const timer = setTimeout(() => localController.abort(), timeoutMs);

  // Chain caller-provided signal so cancelling the outer parse also cancels fetch.
  const onOuterAbort = () => localController.abort();
  if (options.signal) {
    if (options.signal.aborted) localController.abort();
    else options.signal.addEventListener("abort", onOuterAbort, { once: true });
  }

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8"
      },
      signal: localController.signal,
      redirect: "follow"
    }).catch((error: unknown) => {
      if (isAbort(error)) throw new ProductPageError(`fetch aborted (${timeoutMs}ms)`, "TIMEOUT");
      throw new ProductPageError(
        `network error: ${error instanceof Error ? error.message : String(error)}`,
        "NETWORK"
      );
    });

    if (!response.ok) {
      throw new ProductPageError(`HTTP ${response.status}`, "HTTP_ERROR");
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!/text\/html|text\/plain|application\/xhtml/i.test(contentType)) {
      throw new ProductPageError(`unsupported content-type: ${contentType}`, "BAD_CONTENT_TYPE");
    }

    const buffer = await response.arrayBuffer().catch((error: unknown) => {
      if (isAbort(error)) throw new ProductPageError(`read aborted`, "TIMEOUT");
      throw new ProductPageError(
        `network error: ${error instanceof Error ? error.message : String(error)}`,
        "NETWORK"
      );
    });
    if (buffer.byteLength === 0) throw new ProductPageError("empty body", "EMPTY");
    if (buffer.byteLength > MAX_HTML_BYTES)
      throw new ProductPageError(`html too large: ${buffer.byteLength} bytes`, "TOO_LARGE");

    const html = new TextDecoder("utf-8").decode(buffer);
    const title = extractTitle(html);
    const description = extractMetaDescription(html);
    const bodyText = stripToText(html).slice(0, BODY_TEXT_CAP);
    const mainImageUrl = extractMainImage(html, response.url || url.toString());
    const looksLikeAntibot = detectAntibotWall(title, bodyText, buffer.byteLength);

    return {
      finalUrl: response.url || url.toString(),
      title,
      description,
      bodyText,
      mainImageUrl,
      looksLikeAntibot,
      fetchedAt: new Date().toISOString(),
      bytes: buffer.byteLength
    };
  } finally {
    clearTimeout(timer);
    if (options.signal) options.signal.removeEventListener("abort", onOuterAbort);
  }
}

// Playwright fallback：真浏览器加载页面，拿渲染后的 DOM。对 Amazon / Cloudflare /
// 国内电商这种 native fetch 拿不到真内容的站，这是唯一办法。
//
// 性能：单次 5-15s（chromium 启动 + page load + 等 JS 渲染）。
// 只在反爬命中时调用，正常站走 native fetch（200-500ms）。
async function fetchWithPlaywright(
  urlStr: string,
  timeoutMs: number
): Promise<ProductPageContent> {
  // 动态 import：避免 simple-fetch-only 场景加载 playwright（~50MB）。
  // 用 playwright-extra + stealth 覆盖 fingerprint，对付严反爬站（Amazon /
  // Cloudflare protected）。
  const { chromium: chromiumExtra } = await import("playwright-extra");
  const { default: StealthPlugin } = await import("puppeteer-extra-plugin-stealth");
  // chromium.use 是幂等的，多次 use 同一 plugin 不会出问题
  (chromiumExtra as { use: (p: unknown) => unknown }).use(StealthPlugin());
  const browser = await chromiumExtra.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"]
  });
  try {
    const ctx = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1440, height: 900 },
      locale: "en-US"
    });
    // 反检测：覆盖 navigator.webdriver
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    const page = await ctx.newPage();
    page.setDefaultNavigationTimeout(timeoutMs);
    page.setDefaultTimeout(timeoutMs);

    // domcontentloaded 比 networkidle 稳（SPA 永远 networkidle 不到）
    const response = await page
      .goto(urlStr, { waitUntil: "domcontentloaded", timeout: timeoutMs })
      .catch((e) => {
        throw new ProductPageError(
          `playwright navigation failed: ${e instanceof Error ? e.message : String(e)}`,
          "NETWORK"
        );
      });

    // 给 JS 一点时间渲染（SPA 类站点常见）
    await page.waitForTimeout(1500).catch(() => undefined);

    const finalUrl = page.url();
    const html = await page.content();
    const title = await page.title().catch(() => "");
    // og:image 在 head meta 里，直接从 HTML 抠
    const description = extractMetaDescription(html);
    const bodyText = await page
      .evaluate(() => {
        const body = document.body;
        if (!body) return "";
        // 去掉 script / style / noscript
        const clone = body.cloneNode(true) as HTMLElement;
        clone.querySelectorAll("script,style,noscript,iframe").forEach((n) => n.remove());
        return (clone.innerText || clone.textContent || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, BODY_TEXT_CAP);
      })
      .catch(() => "");
    // 优先用 DOM 找真产品图（Amazon #landingImage / Shopify .product-photo 等），
    // 失败再回退到 og:image / 首图启发式（这对 Amazon 经常拿到 banner gif）。
    const productImgFromDom = await page
      .evaluate(() => {
        // 1. 平台特定的 hero image selector（按优先级）
        const productSelectors = [
          "#landingImage", // Amazon 商品主图
          "#imgBlkFront", // Amazon 书籍
          "#main-image", // Apple App Store
          "img.product-image-photo", // Magento
          ".product-single__photo img", // Shopify
          ".product__media img", // Shopify Dawn theme
          '[itemprop="image"]', // Schema.org product
          '[data-testid="product-image"]',
          '[data-testid="product-hero-image"]',
          ".gallery-image img",
          'meta[name="thumbnail"]'
        ];
        for (const sel of productSelectors) {
          const el = document.querySelector(sel) as HTMLElement | null;
          if (!el) continue;
          let src: string | null = null;
          if (el.tagName === "IMG") {
            const img = el as HTMLImageElement;
            src = img.src || img.getAttribute("data-src") || img.getAttribute("data-old-hires");
          } else if (el.tagName === "META") {
            src = (el as HTMLMetaElement).content;
          } else {
            src = el.getAttribute("src") || el.getAttribute("content");
          }
          if (src && /^https?:\/\//.test(src)) return src;
        }
        // 2. 兜底：找页面里**最大的可见 img**（排除 banner / icon / 头像）
        const imgs = Array.from(document.querySelectorAll("img")) as HTMLImageElement[];
        let best: { src: string; area: number } | null = null;
        for (const img of imgs) {
          const src = img.src;
          if (!src || !/^https?:\/\//.test(src)) continue;
          const lower = src.toLowerCase();
          // 排除 banner / 广告 / 装饰
          if (
            lower.includes("/merch/") ||
            lower.includes("/banner") ||
            lower.includes("sprite") ||
            lower.includes("favicon") ||
            lower.includes("logo") ||
            lower.includes("/ads/") ||
            lower.endsWith(".svg")
          )
            continue;
          // Amazon 特定：/images/I/ 是 product，/images/G/ 是 graphic banner
          if (lower.includes("m.media-amazon.com/images/g/")) continue;
          const area = (img.naturalWidth || img.width || 0) * (img.naturalHeight || img.height || 0);
          if (area < 40_000) continue; // < 200×200 通常是 thumbnail/icon，不要
          // 排除横向 banner 比例（宽高 > 4:1）
          const w = img.naturalWidth || img.width || 0;
          const h = img.naturalHeight || img.height || 0;
          if (w > 0 && h > 0 && w / h > 4) continue;
          if (!best || area > best.area) best = { src, area };
        }
        return best?.src ?? null;
      })
      .catch(() => null);
    const mainImageUrl = productImgFromDom ?? extractMainImage(html, finalUrl);
    const looksLikeAntibot = detectAntibotWall(title, bodyText, html.length);

    return {
      finalUrl,
      title,
      description,
      bodyText,
      mainImageUrl,
      looksLikeAntibot,
      fetchedAt: new Date().toISOString(),
      bytes: html.length
    };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

function isAbort(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  if (error instanceof Error && error.name === "AbortError") return true;
  return false;
}

function validateUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

// 启发式：检测壳页/反爬墙。严格条件：title 是 anti-bot 已知标记 OR
// (内容短 + 含反爬文案) OR 内容极短。
// 不能只看"continue shopping"——Amazon 真产品页 cart 按钮也有这个词。
function detectAntibotWall(title: string, bodyText: string, bytes: number): boolean {
  const titleLower = title.toLowerCase();
  const bodyLower = bodyText.toLowerCase();
  // 1. title 是已知反爬壳页标记
  if (
    titleLower === "amazon.com" ||  // Amazon 壳页 title 就这一行
    titleLower === "robot check" ||
    titleLower === "just a moment..." || // Cloudflare
    titleLower.startsWith("attention required") || // Cloudflare 1020
    titleLower.includes("access denied")
  ) {
    return true;
  }
  // 2. 短内容 + 反爬关键词（双重条件，避免误判）
  const short = bytes < 8000 || bodyText.length < 800;
  if (short) {
    if (
      bodyLower.includes("click the button below to continue") || // Amazon 壳页
      bodyLower.includes("are you a robot") ||
      bodyLower.includes("verifying you are human") ||
      bodyLower.includes("verify you are human") ||
      bodyLower.includes("automated requests") ||
      bodyLower.includes("just a moment") ||
      bodyLower.includes("请输入验证码") ||
      bodyLower.includes("人机验证")
    ) {
      return true;
    }
  }
  // 3. 内容极短（< 2KB），基本是 redirect/error/wall
  if (bytes < 2000 && bodyText.length < 200) return true;
  return false;
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeEntities(match[1]).replace(/\s+/g, " ").trim() : "";
}

// 优先级：og:image > twitter:image > apple-touch-icon > link[rel="image_src"] >
// 页面里第一个 src 看起来像产品图的 <img>（hero / banner / 比例近正方形或宽屏）。
// 返回**绝对 URL**（相对路径用 finalUrl 当 base 解析）。
function extractMainImage(html: string, baseUrl: string): string | null {
  const patterns = [
    /<meta[^>]+(?:property|name)\s*=\s*["']og:image(?::secure_url|:url)?["'][^>]*content\s*=\s*["']([^"']+)["']/i,
    /<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]*(?:property|name)\s*=\s*["']og:image(?::secure_url|:url)?["']/i,
    /<meta[^>]+(?:property|name)\s*=\s*["']twitter:image["'][^>]*content\s*=\s*["']([^"']+)["']/i,
    /<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]*(?:property|name)\s*=\s*["']twitter:image["']/i,
    /<link[^>]+rel\s*=\s*["']image_src["'][^>]*href\s*=\s*["']([^"']+)["']/i,
    /<link[^>]+rel\s*=\s*["']apple-touch-icon(?:-precomposed)?["'][^>]*href\s*=\s*["']([^"']+)["']/i
  ];
  for (const re of patterns) {
    const match = html.match(re);
    if (match) {
      const candidate = decodeEntities(match[1]).trim();
      const abs = toAbsoluteUrl(candidate, baseUrl);
      if (abs && isLikelyImage(abs)) return abs;
    }
  }
  // Fallback: 页面里第一个明显的产品图（hero/banner/cover class 或 alt 含 product）
  const imgRe = /<img[^>]+>/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html)) !== null) {
    const tag = m[0];
    const srcMatch =
      tag.match(/\s(?:data-src|src)\s*=\s*["']([^"']+)["']/i) ??
      tag.match(/\ssrcset\s*=\s*["']([^"',\s]+)/i);
    if (!srcMatch) continue;
    const candidate = decodeEntities(srcMatch[1]).trim();
    const abs = toAbsoluteUrl(candidate, baseUrl);
    if (!abs || !isLikelyImage(abs)) continue;
    // 排除 1×1 像素 / icon / logo / sprite
    const lower = (tag + " " + abs).toLowerCase();
    if (
      lower.includes("sprite") ||
      lower.includes("favicon") ||
      lower.includes("data:image/gif;base64") ||
      /[\?&](?:w|width)=(?:1|2|4|8|16|24|32)\b/.test(lower)
    ) {
      continue;
    }
    return abs;
  }
  return null;
}

function toAbsoluteUrl(candidate: string, base: string): string | null {
  if (!candidate) return null;
  try {
    return new URL(candidate, base).toString();
  } catch {
    return null;
  }
}

function isLikelyImage(url: string): boolean {
  const lower = url.toLowerCase().split("?")[0];
  return (
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".png") ||
    lower.endsWith(".webp") ||
    lower.endsWith(".gif") ||
    lower.includes("/image") ||
    lower.includes("og-image") ||
    lower.startsWith("https://scontent") || // facebook CDN
    lower.startsWith("https://lh3.googleusercontent") // Google Play CDN
  );
}

function extractMetaDescription(html: string): string {
  // og:description and twitter:description are usually richer than plain description on app store pages
  const patterns = [
    /<meta[^>]+(?:property|name)\s*=\s*["'](?:og:description)["'][^>]*content\s*=\s*["']([^"']+)["']/i,
    /<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]*(?:property|name)\s*=\s*["'](?:og:description)["']/i,
    /<meta[^>]+(?:property|name)\s*=\s*["'](?:twitter:description)["'][^>]*content\s*=\s*["']([^"']+)["']/i,
    /<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]*(?:property|name)\s*=\s*["'](?:twitter:description)["']/i,
    /<meta[^>]+(?:name|property)\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']+)["']/i,
    /<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]*(?:name|property)\s*=\s*["']description["']/i
  ];
  for (const re of patterns) {
    const match = html.match(re);
    if (match) {
      const cleaned = decodeEntities(match[1]).replace(/\s+/g, " ").trim();
      if (cleaned.length >= 10) return cleaned;
    }
  }
  return "";
}

function stripToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ --]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/&nbsp;/gi, " ");
  // Note: keep entity decoding cheap & lossy; full unescape would require lookup tables.
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => {
      const num = Number.parseInt(code, 10);
      return Number.isFinite(num) ? String.fromCodePoint(num) : "";
    });
}
