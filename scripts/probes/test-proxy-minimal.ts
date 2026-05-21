/**
 * 最小复现：Playwright + Kookeey 代理 + 简单 page.goto，定位 ERR_CONNECTION_CLOSED 原因。
 */
import { chromium } from "playwright";

async function tryWith(launchOpts: Record<string, unknown>, label: string) {
  console.log(`\n--- ${label} ---`);
  const browser = await chromium.launch(launchOpts as never);
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  });
  const page = await ctx.newPage();
  // 用 api.ipify 做最简单的 check（不上 TikTok 直接试代理通不通）
  try {
    const t0 = Date.now();
    const resp = await page.goto("https://api.ipify.org/?format=json", {
      timeout: 25_000,
      waitUntil: "domcontentloaded"
    });
    const body = await resp?.text();
    console.log(`  ipify status=${resp?.status()} t=${Date.now() - t0}ms body=${body}`);
  } catch (e) {
    console.log(`  ipify FAILED:`, e instanceof Error ? e.message : String(e));
  }
  // 再试 TikTok
  try {
    const t0 = Date.now();
    const resp = await page.goto(
      "https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?period=30&region=US",
      { timeout: 30_000, waitUntil: "domcontentloaded" }
    );
    console.log(`  tt status=${resp?.status()} t=${Date.now() - t0}ms`);
  } catch (e) {
    console.log(`  tt FAILED:`, e instanceof Error ? e.message : String(e));
  }
  await browser.close();
}

async function main() {
  const proxyUrl = process.env.TIKTOK_PROXY_URL!;
  const u = new URL(proxyUrl);
  const server = `${u.protocol}//${u.host}`;
  const username = decodeURIComponent(u.username);
  const password = decodeURIComponent(u.password);
  console.log(`server=${server} user=${username.slice(0, 4)}...${username.slice(-4)} pass=${password.slice(0, 4)}...`);

  // 试 1：当前生产方式
  await tryWith(
    {
      headless: true,
      args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
      proxy: { server, username, password }
    },
    "Variant A: 当前 launch args + proxy 拆 user/pass"
  );

  // 试 2：删掉自定义 args
  await tryWith(
    {
      headless: true,
      proxy: { server, username, password }
    },
    "Variant B: 不带任何 args"
  );

  // 试 3：context-level proxy（newContext({ proxy }) 比 launch({ proxy }) 更新）
  console.log("\n--- Variant C: context-level proxy ---");
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    proxy: { server, username, password }
  });
  const page = await ctx.newPage();
  try {
    const t0 = Date.now();
    const resp = await page.goto("https://api.ipify.org/?format=json", {
      timeout: 25_000,
      waitUntil: "domcontentloaded"
    });
    const body = await resp?.text();
    console.log(`  ipify status=${resp?.status()} t=${Date.now() - t0}ms body=${body}`);
  } catch (e) {
    console.log(`  ipify FAILED:`, e instanceof Error ? e.message : String(e));
  }
  try {
    const t0 = Date.now();
    const resp = await page.goto(
      "https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?period=30&region=US",
      { timeout: 30_000, waitUntil: "domcontentloaded" }
    );
    console.log(`  tt status=${resp?.status()} t=${Date.now() - t0}ms`);
  } catch (e) {
    console.log(`  tt FAILED:`, e instanceof Error ? e.message : String(e));
  }
  await browser.close();
}

main().catch((e) => {
  console.error("crash:", e);
  process.exit(1);
});
