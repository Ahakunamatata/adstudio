const TRACKING_PARAM_PATTERNS = [
  /^utm_/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^gbraid$/i,
  /^wbraid$/i,
  /^msclkid$/i,
  /^mc_/i,
  /^s_cid$/i,
  /^s_kwcid$/i,
  /^_ga$/i,
  /^_gl$/i,
  /^yclid$/i,
  /^hsCtaTracking$/i,
  /^hsa_/i,
  /^igshid$/i,
  /^igsh$/i,
  /^_branch_match_id$/i,
  /^spm$/i,
  /^ref$/i,
  /^ref_$/i,
  /^ref_url$/i,
  /^referrer$/i,
  /^tag$/i
];

function stripTrackingParams(url: URL) {
  for (const key of Array.from(url.searchParams.keys())) {
    if (TRACKING_PARAM_PATTERNS.some((pattern) => pattern.test(key))) {
      url.searchParams.delete(key);
    }
  }
  url.hash = "";
}

function normalizeHost(hostname: string) {
  return hostname.toLowerCase().replace(/^m\./, "www.");
}

function isAmazonHost(hostname: string) {
  return /(^|\.)amazon\.[a-z.]+$/i.test(hostname);
}

function canonicalizeAmazonUrl(url: URL) {
  const match = url.pathname.match(/(?:\/dp\/|\/gp\/product\/|\/product\/)([A-Z0-9]{10})(?:[/?#]|$)/i);
  if (!match) return null;
  return `https://${normalizeHost(url.hostname)}/dp/${match[1].toUpperCase()}`;
}

function canonicalizeShopifyUrl(url: URL) {
  const match = url.pathname.match(/\/products\/([^/?#]+)/i);
  if (!match) return null;
  return `${url.protocol}//${url.hostname}/products/${match[1]}`;
}

function canonicalizeGooglePlayUrl(url: URL) {
  if (url.hostname !== "play.google.com" || !url.pathname.includes("/store/apps/details")) return null;
  const appId = url.searchParams.get("id");
  if (!appId) return null;
  return `https://play.google.com/store/apps/details?id=${encodeURIComponent(appId)}`;
}

function canonicalizeAppleAppStoreUrl(url: URL) {
  if (!/(^|\.)apps\.apple\.com$/i.test(url.hostname)) return null;
  const match = url.pathname.match(/\/id(\d+)(?:[/?#]|$)/i);
  if (!match) return null;
  const cleanUrl = new URL(url.toString());
  cleanUrl.search = "";
  cleanUrl.hash = "";
  return cleanUrl.toString();
}

function canonicalizeYoutubeUrl(url: URL) {
  if (url.hostname === "youtu.be") {
    const videoId = url.pathname.split("/").filter(Boolean)[0];
    return videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}` : null;
  }

  if (!/(^|\.)youtube\.com$/i.test(url.hostname)) return null;
  const videoId = url.searchParams.get("v");
  if (videoId) return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;

  const shortsMatch = url.pathname.match(/^\/shorts\/([^/?#]+)/i);
  if (shortsMatch) return `https://www.youtube.com/shorts/${shortsMatch[1]}`;

  return null;
}

function canonicalizeSocialUrl(url: URL) {
  if (!/(^|\.)(tiktok\.com|instagram\.com)$/i.test(url.hostname)) return null;
  const cleanUrl = new URL(url.toString());
  cleanUrl.search = "";
  cleanUrl.hash = "";
  return cleanUrl.toString();
}

export function canonicalizeProductUrl(value: string) {
  const url = new URL(value.trim());
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("只支持 http 或 https 产品链接。");
  }

  if (isAmazonHost(url.hostname)) {
    const amazonUrl = canonicalizeAmazonUrl(url);
    if (amazonUrl) return amazonUrl;
  }

  const platformUrl =
    canonicalizeGooglePlayUrl(url) ||
    canonicalizeAppleAppStoreUrl(url) ||
    canonicalizeYoutubeUrl(url) ||
    canonicalizeSocialUrl(url) ||
    canonicalizeShopifyUrl(url);

  if (platformUrl) return platformUrl;

  stripTrackingParams(url);
  return url.toString();
}
