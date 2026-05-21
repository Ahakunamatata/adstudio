// URL canonicalize（脏 URL → 干净 URL）
//
// 用户贴 URL 时来源各种各样：
//   - Amazon 搜索结果点进去带 dib token / ref / keywords / sr / th 一堆 tracking
//   - 广告点击进来 utm_source/utm_medium/utm_campaign/fbclid/gclid
//   - Shopify 店铺常 ?variant=xxx&utm_*
//   - YouTube 带 ?t= / &list= 等
//
// 这些参数：
//   - 让 URL 又脏又长（>500 char 经常）
//   - 影响 server-side fetch（Amazon 加 dib 偶尔重定向到 search page）
//   - 同产品不同来源被算成不同 URL，DB 去重失败
//
// 本模块入口处一次性 canonicalize：剥 tracking + 平台特定保留 path。
// 用户体验上无感（他能贴任何 URL，程序内部自动清理）。

const TRACKING_PARAMS = new Set([
  // UTM family
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "utm_name",
  // Facebook
  "fbclid",
  "fb_action_ids",
  "fb_action_types",
  "fb_ref",
  "fb_source",
  // Google
  "gclid",
  "gclsrc",
  "dclid",
  "gbraid",
  "wbraid",
  // Microsoft
  "msclkid",
  // Mailchimp
  "mc_cid",
  "mc_eid",
  // Adobe
  "s_cid",
  "s_kwcid",
  // Instagram / TikTok
  "igshid",
  "igsh",
  "_branch_match_id",
  // Analytics
  "_ga",
  "_gl",
  "ref_url",
  "referrer",
  "yclid",
  // Common SaaS
  "hsCtaTracking",
  "hsa_acc",
  "hsa_cam",
  "hsa_grp",
  "hsa_ad",
  "hsa_src",
  "hsa_tgt",
  "hsa_kw",
  "hsa_mt",
  "hsa_net",
  "hsa_ver"
]);

export function canonicalizeProductUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    // 不是合法 URL —— 直接返回（让上层做 URL validation）
    return trimmed;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return trimmed;

  // host 小写化（amazon.com 跟 AMAZON.COM 是同站）
  url.hostname = url.hostname.toLowerCase();

  // 平台特定规则
  const host = url.hostname.replace(/^www\./, "");

  // ── Amazon ───────────────────────────────────────────────
  if (host.endsWith("amazon.com") || host.endsWith("amazon.co.uk") || /amazon\.[a-z.]+$/.test(host)) {
    // 提取 /dp/{ASIN} 或 /gp/product/{ASIN}
    const asinMatch = url.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
    if (asinMatch) {
      url.pathname = `/dp/${asinMatch[1].toUpperCase()}`;
      url.search = ""; // 丢掉所有 query（th / ref / dib / sr / keywords...）
      url.hash = "";
      return url.toString();
    }
    // amazon search / category page：保留 search_alias 和 k= 关键词，去掉 tracking
    return stripTrackingParams(url);
  }

  // ── Shopify (*.myshopify.com 或 /products/handle) ────────
  if (host.endsWith("myshopify.com") || /\/products\/[^/]+/.test(url.pathname)) {
    const handleMatch = url.pathname.match(/\/products\/([^/?#]+)/);
    if (handleMatch) {
      url.pathname = `/products/${handleMatch[1]}`;
      url.search = ""; // 删 ?variant= 和 utm_*
      url.hash = "";
      return url.toString();
    }
  }

  // ── Apple App Store ──────────────────────────────────────
  if (host.endsWith("apps.apple.com")) {
    // /us/app/{slug}/id{appId}
    const m = url.pathname.match(/\/([a-z]{2})\/app\/([^/]+)\/(id\d+)/i);
    if (m) {
      url.pathname = `/${m[1].toLowerCase()}/app/${m[2]}/${m[3]}`;
      url.search = ""; // 删 ?l=zh&mt=8 等
      url.hash = "";
      return url.toString();
    }
  }

  // ── Google Play ──────────────────────────────────────────
  if (host === "play.google.com" && url.pathname.startsWith("/store/apps/details")) {
    // 只保留 ?id= 核心参数
    const id = url.searchParams.get("id");
    if (id) {
      const out = new URL(url.toString());
      out.search = `?id=${encodeURIComponent(id)}`;
      out.hash = "";
      return out.toString();
    }
  }

  // ── YouTube ──────────────────────────────────────────────
  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be") {
    if (host === "youtu.be") {
      // youtu.be/{id} —— path 本身就是 id
      const id = url.pathname.slice(1).split(/[/?#]/)[0];
      if (id) return `https://www.youtube.com/watch?v=${id}`;
    }
    const v = url.searchParams.get("v");
    if (v) return `https://www.youtube.com/watch?v=${encodeURIComponent(v)}`;
  }

  // ── TikTok ───────────────────────────────────────────────
  if (host.endsWith("tiktok.com")) {
    // 保留 path（/@user/video/id），删所有 query（_t / _r 等 tracking）
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  // ── Instagram ────────────────────────────────────────────
  if (host.endsWith("instagram.com")) {
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  // ── 通用规则：删 tracking params ─────────────────────────
  return stripTrackingParams(url);
}

function stripTrackingParams(url: URL): string {
  const keep: [string, string][] = [];
  url.searchParams.forEach((value, key) => {
    if (TRACKING_PARAMS.has(key.toLowerCase())) return;
    if (key.toLowerCase().startsWith("utm_")) return;
    if (key.toLowerCase().startsWith("hsa_")) return;
    keep.push([key, value]);
  });
  url.search = keep.length > 0 ? "?" + keep.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&") : "";
  url.hash = "";
  return url.toString();
}

// 仅供 unit test / debug
export const __internals = { TRACKING_PARAMS, stripTrackingParams };
