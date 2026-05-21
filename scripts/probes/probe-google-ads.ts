/**
 * 探 Google Ad Transparency Center：找出真返回广告列表的 XHR endpoint。
 *
 * 跑法：
 *   tsx scripts/probes/probe-google-ads.ts "fitness app"
 *
 * Google Ad Transparency 公开页面：
 *   https://adstransparency.google.com/?region=anywhere&q=fitness+app
 * 不需要登录。Playwright 加载 + 拦截 XHR + 找含 ad 列表的 JSON。
 */
import fs from "node:fs/promises";
import { chromium } from "playwright";

const keyword = process.argv[2] ?? "fitness app";
const outFile = `/tmp/google-ads-probe-${keyword.replace(/\s+/g, "_")}.json`;

type Captured = {
  url: string;
  status: number;
  bodyLen: number;
  topKeys: string[];
  hasAdShape: boolean;
};

async function main() {
  const proxyUrl = process.env.TIKTOK_PROXY_URL;
  const launchOpts: Parameters<typeof chromium.launch>[0] = {
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"]
  };
  if (proxyUrl) {
    const u = new URL(proxyUrl);
    launchOpts.proxy = {
      server: `${u.protocol}//${u.host}`,
      ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
      ...(u.password ? { password: decodeURIComponent(u.password) } : {})
    };
  }

  const browser = await chromium.launch(launchOpts);
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 }
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  const page = await ctx.newPage();

  const captured: Captured[] = [];
  page.on("response", async (resp) => {
    const url = resp.url();
    // Google Ad Transparency 的 RPC endpoint 通常在 adstransparency.google.com
    if (!url.includes("adstransparency.google.com") && !url.includes("/SearchService/") && !url.includes("AdsTransparency"))
      return;
    if (url.endsWith(".js") || url.endsWith(".css") || url.endsWith(".png") || url.endsWith(".woff2")) return;
    let body = "";
    try {
      body = await resp.text();
    } catch {
      return;
    }
    if (body.length < 50) return;
    const lower = body.toLowerCase();
    const hasAdShape =
      lower.includes("advertiser") ||
      lower.includes("creative_id") ||
      lower.includes("ad_creative") ||
      lower.includes("video_url") ||
      lower.includes("\"ads\"");
    let parsed: unknown = null;
    try {
      // Google 经常用 `)]}'` 前缀防 XSSI
      const cleaned = body.replace(/^\)\]\}'?\s*/, "");
      parsed = JSON.parse(cleaned);
    } catch {
      // ignore
    }
    captured.push({
      url,
      status: resp.status(),
      bodyLen: body.length,
      topKeys:
        typeof parsed === "object" && parsed !== null
          ? Object.keys(parsed as object).slice(0, 8)
          : [],
      hasAdShape
    });
    if (hasAdShape) {
      console.log(`  ★ AD-SHAPE [${resp.status()}] ${url.slice(0, 200)}`);
      const idx = captured.length - 1;
      await fs.writeFile(`/tmp/google-ads-body-${idx}.json`, body).catch(() => undefined);
    }
  });

  const targetUrl = `https://adstransparency.google.com/?region=anywhere&q=${encodeURIComponent(keyword)}`;
  console.log(`→ goto: ${targetUrl}`);
  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  } catch (e) {
    console.log("goto warn:", e instanceof Error ? e.message : String(e));
  }
  await page.waitForTimeout(5000);
  await page.evaluate(() => window.scrollBy(0, 1500)).catch(() => undefined);
  await page.waitForTimeout(5000);

  const title = await page.title();
  console.log(`  page title: "${title}"`);
  const adsRendered = await page
    .$$eval(
      "[class*='advertiser'],[class*='Advertiser'],[role='listitem']",
      (els) => els.length
    )
    .catch(() => 0);
  console.log(`  visible ad-like elements: ${adsRendered}`);

  await fs.writeFile(outFile, JSON.stringify(captured, null, 2), "utf-8");
  console.log(`\n=== summary ===`);
  console.log(`  total captured: ${captured.length}`);
  console.log(`  ad-shape: ${captured.filter((c) => c.hasAdShape).length}`);
  for (const e of captured.filter((c) => c.hasAdShape).slice(0, 5)) {
    console.log(`  [${e.status}] ${e.url.slice(0, 180)} keys=${JSON.stringify(e.topKeys)} len=${e.bodyLen}`);
  }
  console.log(`\nfull: ${outFile}`);
  await browser.close();
}

main().catch((e) => {
  console.error("crash:", e);
  process.exit(1);
});
