/**
 * 精确对比：测试 launchBrowserSession 的几个 extras 中哪个让 TikTok reset。
 * 已知：Variant A（无 extras）通；launchBrowserSession 不通。
 */
import { chromium } from "playwright";

async function tryWith(opts: {
  args?: string[];
  proxy?: { server: string };
  viewport?: { width: number; height: number };
  locale?: string;
  initScript?: boolean;
  defaultTimeout?: number;
}, label: string) {
  console.log(`\n--- ${label} ---`);
  const browser = await chromium.launch({
    headless: true,
    args: opts.args,
    proxy: opts.proxy
  });
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: opts.viewport,
    locale: opts.locale
  });
  if (opts.initScript) {
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
  }
  const page = await ctx.newPage();
  if (opts.defaultTimeout) {
    page.setDefaultNavigationTimeout(opts.defaultTimeout);
    page.setDefaultTimeout(opts.defaultTimeout);
  }
  try {
    const t0 = Date.now();
    const resp = await page.goto(
      "https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?period=30&region=US",
      { timeout: 25_000, waitUntil: "domcontentloaded" }
    );
    console.log(`  TT status=${resp?.status()} t=${Date.now() - t0}ms`);
  } catch (e) {
    console.log(`  TT FAILED:`, (e as Error).message.split("\n")[0]);
  }
  await browser.close();
}

async function main() {
  const PROXY = { server: "http://148.153.211.18:17171" };
  const ARGS = ["--disable-blink-features=AutomationControlled", "--no-sandbox"];

  // Baseline 已知通的：A
  await tryWith({ args: ARGS, proxy: PROXY }, "A: baseline (works in prior test)");

  // 加 viewport
  await tryWith({ args: ARGS, proxy: PROXY, viewport: { width: 1440, height: 900 } }, "+ viewport 1440x900");

  // 加 locale
  await tryWith({ args: ARGS, proxy: PROXY, locale: "en-US" }, "+ locale en-US");

  // 加 init script (override navigator.webdriver)
  await tryWith({ args: ARGS, proxy: PROXY, initScript: true }, "+ init script (webdriver undefined)");

  // 全加（= launchBrowserSession）
  await tryWith({
    args: ARGS,
    proxy: PROXY,
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
    initScript: true,
    defaultTimeout: 30_000
  }, "ALL (= launchBrowserSession)");
}

main().catch((e) => {
  console.error("crash:", e);
  process.exit(1);
});
