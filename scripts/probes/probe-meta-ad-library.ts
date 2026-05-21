/**
 * 探 Meta Ad Library 公开搜索页：找出真正返回广告列表的 XHR endpoint。
 *
 * 跑法：
 *   ./node_modules/.bin/tsx scripts/probes/probe-meta-ad-library.ts "fitness app"
 *
 * 输出会写 /tmp/meta-probe-{kw}.json，记录所有看起来像广告列表的 XHR URL + 字段。
 */

import fs from "node:fs/promises";
import { chromium } from "playwright";

const keyword = process.argv[2] ?? "fitness app";
const outFile = `/tmp/meta-probe-${keyword.replace(/\s+/g, "_")}.json`;

type Captured = {
  url: string;
  method: string;
  status: number;
  topKeys: string[];
  hasAdShape: boolean;
  bodyLen: number;
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
      username: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password)
    };
  }

  const browser = await chromium.launch(launchOpts);
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
    locale: "en-US"
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  const page = await ctx.newPage();

  const captured: Captured[] = [];
  page.on("response", async (resp) => {
    const url = resp.url();
    // Meta 的 GraphQL 走 /api/graphql/ 或 /ads/library/async/search_ads/
    if (
      !url.includes("graphql") &&
      !url.includes("search_ads") &&
      !url.includes("ads/library")
    )
      return;
    if (url.endsWith(".js") || url.endsWith(".css")) return;
    let body = "";
    try {
      body = await resp.text();
    } catch {
      return;
    }
    if (body.length < 50) return;
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(body);
    } catch {
      // GraphQL 可能返回多行 newline-delimited JSON
      const firstLine = body.split("\n")[0];
      try {
        parsed = JSON.parse(firstLine);
      } catch {
        return;
      }
    }
    const text = body.toLowerCase();
    const hasAdShape =
      text.includes("ad_archive_id") ||
      text.includes("ad_creative_body") ||
      text.includes("page_name") ||
      text.includes("snapshot_url") ||
      text.includes("\"ads\"");
    captured.push({
      url,
      method: resp.request().method(),
      status: resp.status(),
      topKeys:
        typeof parsed === "object" && parsed !== null
          ? Object.keys(parsed as object).slice(0, 8)
          : [],
      hasAdShape,
      bodyLen: body.length
    });
    if (hasAdShape) {
      console.log(`  ★ AD-SHAPE [${resp.status()}] ${url.slice(0, 200)}`);
      // 把 body 也单独写一份方便 schema 分析
      const idx = captured.length - 1;
      await fs.writeFile(`/tmp/meta-probe-body-${idx}.json`, body).catch(() => undefined);
    }
  });

  const targetUrl = `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=US&q=${encodeURIComponent(keyword)}&search_type=keyword_unordered`;
  console.log(`→ goto: ${targetUrl}`);
  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  } catch (e) {
    console.log("  goto warning:", e instanceof Error ? e.message : String(e));
  }

  // 等 challenge resolved + 滚一下触发懒加载
  await page.waitForTimeout(5_000);
  await page.evaluate(() => window.scrollBy(0, 1500)).catch(() => undefined);
  await page.waitForTimeout(5_000);
  await page.evaluate(() => window.scrollBy(0, 3000)).catch(() => undefined);
  await page.waitForTimeout(5_000);

  // 抓页面 title / 截图状态
  const title = await page.title();
  console.log(`  page title: "${title}"`);
  const adCount = await page
    .$$eval("[aria-label='Ad']", (els) => els.length)
    .catch(() => 0);
  console.log(`  visible "Ad" cards: ${adCount}`);

  await fs.writeFile(outFile, JSON.stringify(captured, null, 2), "utf-8");

  const adShape = captured.filter((c) => c.hasAdShape);
  console.log(`\n=== summary ===`);
  console.log(`  total captured: ${captured.length}`);
  console.log(`  ad-shape: ${adShape.length}`);
  for (const e of adShape.slice(0, 5)) {
    console.log(`    [${e.status}] ${e.url.slice(0, 180)}`);
    console.log(`      keys=${JSON.stringify(e.topKeys)} len=${e.bodyLen}`);
  }
  console.log(`\nfull dump: ${outFile}`);

  await browser.close();
}

main().catch((e) => {
  console.error("crash:", e);
  process.exit(1);
});
