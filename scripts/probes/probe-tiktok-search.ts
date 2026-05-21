/**
 * 探测脚本：找出 TikTok Creative Center 的真 search-by-keyword endpoint。
 *
 * 跑法：
 *   ./node_modules/.bin/tsx scripts/probes/probe-tiktok-search.ts "anti theft"
 *
 * 行为：
 *   1. Playwright 加载 https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en
 *      （或带 ?period=30&search=KW 之类的搜索参数）
 *   2. 拦截所有 XHR，找返回 ads 列表的 endpoint
 *   3. 打印它的 URL / 关键 query params / response shape
 *
 * 输出会写到 /tmp/tiktok-probe-{keyword}.json，方便对比不同 keyword 的 endpoint。
 */

import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const keyword = process.argv[2] ?? "anti theft";
const outFile = `/tmp/tiktok-probe-${keyword.replace(/\s+/g, "_")}.json`;

type CapturedRequest = {
  url: string;
  method: string;
  status: number;
  hasAdList: boolean;
  responsePreview: unknown;
};

async function main() {
  console.log(`probe keyword: "${keyword}"`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 }
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  const page = await context.newPage();

  const captured: CapturedRequest[] = [];

  page.on("response", async (response) => {
    const url = response.url();
    // 只关心 TikTok 自家 API
    if (!url.includes("ads.tiktok.com") && !url.includes("creative_radar")) return;
    if (url.endsWith(".js") || url.endsWith(".css") || url.endsWith(".png") || url.endsWith(".jpg") || url.endsWith(".woff2") || url.includes("hot-update")) return;

    let bodyText = "";
    try {
      bodyText = await response.text();
    } catch {
      return;
    }
    if (!bodyText.startsWith("{") && !bodyText.startsWith("[")) return;

    let parsed: unknown = null;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      return;
    }

    // 启发式判断是不是 ads 列表
    const text = bodyText.toLowerCase();
    const hasAdList =
      (text.includes("\"ads\"") || text.includes("\"materials\"") || text.includes("\"items\"")) &&
      (text.includes("\"video_info\"") || text.includes("\"cover\"") || text.includes("\"ad_id\"") || text.includes("\"item_id\""));

    captured.push({
      url,
      method: response.request().method(),
      status: response.status(),
      hasAdList,
      responsePreview:
        typeof parsed === "object" && parsed !== null
          ? Object.keys(parsed as object).slice(0, 10)
          : null
    });
    if (hasAdList) {
      console.log(`  ★ AD LIST: ${response.status()} ${url.slice(0, 180)}`);
    }
  });

  // 尝试 3 个 URL 变体
  const variants = [
    // 主搜索页（首页）
    `https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?period=30&region=US`,
    // 带 search 查询参数
    `https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?period=30&region=US&search=${encodeURIComponent(keyword)}`,
    // 另一种 search 入口
    `https://ads.tiktok.com/business/creativecenter/topads/search/pc/en?keyword=${encodeURIComponent(keyword)}`
  ];

  for (const url of variants) {
    console.log(`\n→ loading: ${url}`);
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 25_000 });
      // 滚一下，触发懒加载
      await page.evaluate(() => window.scrollBy(0, 800));
      await page.waitForTimeout(3000);
    } catch (error) {
      console.warn(`  ! navigation error:`, error instanceof Error ? error.message : String(error));
    }
  }

  // 第二轮：尝试在页面里输入 keyword 模拟搜索（如果有搜索框）
  try {
    const searchInputs = await page.$$("input[placeholder*='earch'], input[placeholder*='搜索'], input[type='search']");
    if (searchInputs.length > 0) {
      console.log(`\n→ found ${searchInputs.length} search input(s); typing keyword`);
      await searchInputs[0].fill(keyword);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(5000);
    } else {
      console.log("\n→ no search input found on page");
    }
  } catch (error) {
    console.warn("  ! search interaction failed:", error instanceof Error ? error.message : String(error));
  }

  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, JSON.stringify(captured, null, 2), "utf-8");

  const adListEndpoints = captured.filter((c) => c.hasAdList);
  console.log(`\n=== summary ===`);
  console.log(`total captured XHRs: ${captured.length}`);
  console.log(`endpoints returning ad list: ${adListEndpoints.length}`);
  for (const e of adListEndpoints) {
    console.log(`  - ${e.method} ${e.status} ${e.url.slice(0, 200)}`);
  }
  console.log(`\nfull dump: ${outFile}`);

  await browser.close();
}

main().catch((error) => {
  console.error("probe crashed:", error);
  process.exit(1);
});
