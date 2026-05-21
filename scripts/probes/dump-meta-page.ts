/**
 * Dump 当前 Meta Ad Library 加载完后的 DOM，看真实情况。
 */
import { chromium } from "playwright";

async function main() {
  const proxyUrl = process.env.TIKTOK_PROXY_URL!;
  const u = new URL(proxyUrl);

  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"],
    proxy: {
      server: `${u.protocol}//${u.host}`,
      username: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password)
    }
  });
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 }
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  const page = await ctx.newPage();

  // 拦 graphql 状况
  const gqlInfo: Array<{ url: string; status: number; len: number; hasAd: boolean }> = [];
  page.on("response", async (resp) => {
    if (!resp.url().includes("/api/graphql/")) return;
    try {
      const text = await resp.text();
      gqlInfo.push({
        url: resp.url().slice(0, 80),
        status: resp.status(),
        len: text.length,
        hasAd: text.includes("ad_archive_id")
      });
    } catch {
      // ignore
    }
  });

  console.log("→ goto");
  await page
    .goto(
      "https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=US&q=fitness%20app&search_type=keyword_unordered",
      { waitUntil: "domcontentloaded", timeout: 60_000 }
    )
    .catch((e) =>
      console.log("goto warn:", e instanceof Error ? e.message : String(e))
    );

  // 阶段 1：等 5s 看 challenge 自己 reload
  await page.waitForTimeout(5_000);
  let title = await page.title();
  let bodyLen = (await page.content()).length;
  console.log(`[T+5s] title="${title}" bodyLen=${bodyLen} gqlCount=${gqlInfo.length}`);

  await page.waitForTimeout(5_000);
  title = await page.title();
  bodyLen = (await page.content()).length;
  console.log(`[T+10s] title="${title}" bodyLen=${bodyLen} gqlCount=${gqlInfo.length}`);

  // 滚一下触发懒加载
  await page.evaluate(() => window.scrollBy(0, 2000)).catch(() => undefined);
  await page.waitForTimeout(5_000);
  title = await page.title();
  bodyLen = (await page.content()).length;
  console.log(`[T+15s scroll] title="${title}" bodyLen=${bodyLen} gqlCount=${gqlInfo.length}`);

  // 看 page 上是否有 "Ad Library" 真页面常见元素
  const adRendered = await page
    .$$eval(
      "[role='article'],[aria-label*='Library Ad'],[data-testid*='ad-library-card'],[class*='LibraryAd']",
      (els) => els.length
    )
    .catch(() => 0);
  console.log(`  ad-shape DOM elements: ${adRendered}`);

  // 看 body 文本里有没有"Showing ads" / "results for" 这种真页面标记
  const bodyText = (await page.evaluate(() => document.body.innerText)).slice(0, 500);
  console.log(`  body text head: ${bodyText.replace(/\n/g, " | ")}`);

  console.log("\n=== graphql captures ===");
  for (const g of gqlInfo) console.log(" ", g);

  await browser.close();
}

main().catch((e) => {
  console.error("crash:", e);
  process.exit(1);
});
