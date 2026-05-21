/**
 * Minimal stealth + TikTok smoke test, with verbose progress prints.
 */
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

chromium.use(StealthPlugin());

async function main() {
  const proxyUrl = process.env.TIKTOK_PROXY_URL;
  console.log("[stealth-test] starting; proxy set:", !!proxyUrl);

  const launchOpts: Parameters<typeof chromium.launch>[0] = {
    headless: true,
    args: ["--no-sandbox"]
  };
  if (proxyUrl) {
    const u = new URL(proxyUrl);
    launchOpts.proxy = {
      server: `${u.protocol}//${u.host}`,
      ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
      ...(u.password ? { password: decodeURIComponent(u.password) } : {})
    };
  }

  console.log("[stealth-test] launching chromium...");
  const t0 = Date.now();
  const browser = await chromium.launch(launchOpts);
  console.log(`[stealth-test] launched in ${Date.now() - t0}ms`);

  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  });
  const page = await ctx.newPage();

  try {
    console.log("[stealth-test] goto TikTok...");
    const t1 = Date.now();
    const resp = await page.goto(
      "https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?period=30&region=US",
      { timeout: 30_000, waitUntil: "domcontentloaded" }
    );
    console.log(`[stealth-test] TikTok status=${resp?.status()} in ${Date.now() - t1}ms`);
    const title = await page.title();
    console.log(`[stealth-test] title="${title}"`);
  } catch (e) {
    console.log("[stealth-test] FAILED:", (e as Error).message.split("\n")[0]);
  }

  try {
    console.log("[stealth-test] goto Google AdsTransparency...");
    const t2 = Date.now();
    const resp = await page.goto(
      "https://adstransparency.google.com/?region=anywhere&q=fitness+app",
      { timeout: 30_000, waitUntil: "domcontentloaded" }
    );
    console.log(`[stealth-test] Google status=${resp?.status()} in ${Date.now() - t2}ms`);
    const title = await page.title();
    console.log(`[stealth-test] title="${title}"`);
  } catch (e) {
    console.log("[stealth-test] FAILED Google:", (e as Error).message.split("\n")[0]);
  }

  await browser.close();
  console.log("[stealth-test] done");
}

main().catch((e) => {
  console.error("crash:", e);
  process.exit(1);
});
