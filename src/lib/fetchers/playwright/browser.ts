// Thin Playwright harness used by the TikTok scraper. Kept tiny so it's easy
// to swap to playwright-extra + stealth, or to a real anti-bot service later.
//
// 设计原则：
//   - Browser/context/page 一组打包成 BrowserSession，scraper 一次调用拿到，结束 dispose。
//   - 代理走 env 变量 `TIKTOK_PROXY_URL`，例 `http://user:pass@us.proxy.iproyal.com:12321`，
//     Playwright `launch({ proxy })` 直接接受这种 URL（含 auth）。生产环境必走住宅代理。
//   - 反检测做最简：override navigator.webdriver + 真实 UA + 1440x900 viewport。
//     不引入 playwright-extra/stealth 因为这玩意 deps 又大又脆，先看 IPRoyal 住宅
//     流量本身够不够，不够再迭代。
//
// 重要约束：本文件 import 自 `playwright`，是 Node-only runtime。
// 不要从任何 Next.js Route Handler 或 React Server Component 静态 import。
// 只能 dynamic import 或在 `scripts/*.ts` CLI 上下文里使用。

import type {
  Browser,
  BrowserContext,
  Page,
  LaunchOptions
} from "playwright";
// playwright-extra wraps playwright chromium with plugin support;
// puppeteer-extra-plugin-stealth covers 20+ fingerprint signals（webdriver /
// chrome / plugins / languages / WebGL / canvas / iframe contentWindow / ...）
// 同时干掉 TikTok / Google AdsTransparency 这种严反爬站的 ERR_CONNECTION_CLOSED。
//
// dynamic require 让 vanilla playwright 调用方（如本地测试）也能用，
// stealth 只在生产 fetcher 路径里启用。
import { chromium as chromiumExtra } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
chromiumExtra.use(StealthPlugin());

const chromium = chromiumExtra;

export type BrowserSession = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  dispose: () => Promise<void>;
};

export type LaunchSessionOptions = {
  headless?: boolean; // default true
  proxyUrl?: string | null; // 默认从 env 读 TIKTOK_PROXY_URL
  userAgent?: string;
  viewport?: { width: number; height: number };
  locale?: string;
  // 调用方 abort（30s timeout 等）只需要在自己侧用 AbortController，
  // 这里只接受布尔信号；Playwright 自己有 page.setDefaultTimeout
  navTimeoutMs?: number;
};

const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * 自带 retry 的 navigate。代理 1m sticky 经常让 goto 在 TLS 握手中途切 IP，
 * 这层 retry 让单条 fetcher 调用对外不感知。
 *
 * 重试条件：ERR_CONNECTION_CLOSED / ERR_SSL_PROTOCOL_ERROR / ERR_NETWORK_CHANGED
 * 这些 transient 网络错误。其他错误（404, captcha 等）不重试。
 */
export async function gotoWithRetry(
  page: import("playwright").Page,
  url: string,
  opts: {
    timeout?: number;
    waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
    maxRetries?: number;
    retryBackoffMs?: number;
  } = {}
): Promise<import("playwright").Response | null> {
  const timeout = opts.timeout ?? 30_000;
  const waitUntil = opts.waitUntil ?? "domcontentloaded";
  const maxRetries = opts.maxRetries ?? 2;
  const retryBackoffMs = opts.retryBackoffMs ?? 4_000;

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await page.goto(url, { timeout, waitUntil });
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      const transient =
        msg.includes("ERR_CONNECTION_CLOSED") ||
        msg.includes("ERR_SSL_PROTOCOL_ERROR") ||
        msg.includes("ERR_NETWORK_CHANGED") ||
        msg.includes("ERR_PROXY_CONNECTION_FAILED") ||
        msg.includes("ERR_TUNNEL_CONNECTION_FAILED");
      if (!transient || attempt === maxRetries) {
        throw e;
      }
      await new Promise((r) => setTimeout(r, retryBackoffMs));
    }
  }
  // unreachable，TS narrowing 用
  throw lastErr instanceof Error ? lastErr : new Error("gotoWithRetry exhausted");
}

export async function launchBrowserSession(
  opts: LaunchSessionOptions = {}
): Promise<BrowserSession> {
  const headless = opts.headless ?? true;
  const proxyUrl = opts.proxyUrl ?? process.env.TIKTOK_PROXY_URL ?? null;
  const userAgent = opts.userAgent ?? DEFAULT_UA;
  const viewport = opts.viewport ?? { width: 1440, height: 900 };
  const locale = opts.locale ?? "en-US";
  const navTimeoutMs = opts.navTimeoutMs ?? 30_000;

  const launchOptions: LaunchOptions = {
    headless,
    args: [
      // disable-blink-features=AutomationControlled 去掉 navigator.webdriver=true
      // 这是 Playwright 默认会暴露的最显眼指纹之一
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox"
    ]
  };
  if (proxyUrl) {
    // Playwright 的 launch({ proxy }) 不接受嵌在 URL 里的 user:pass —— 必须拆成
    // { server, username, password } 三段。URL.parse 自动 decode encoded ASCII。
    try {
      const u = new URL(proxyUrl);
      launchOptions.proxy = {
        server: `${u.protocol}//${u.host}`, // "http://gate.kookeey.info:1000"
        ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
        ...(u.password ? { password: decodeURIComponent(u.password) } : {})
      };
    } catch {
      // 不是合法 URL（极少见），fallback 当 host:port 直传
      launchOptions.proxy = { server: proxyUrl };
    }
  }

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({
    viewport,
    locale,
    userAgent
  });

  // Anti-detection 第二层：context-level init script，每次 navigate 都注入
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    // 别的常见指纹：plugins / languages / chrome 对象。先不动，等真测到被拦再加
  });

  const page = await context.newPage();
  page.setDefaultNavigationTimeout(navTimeoutMs);
  page.setDefaultTimeout(navTimeoutMs);

  const dispose = async () => {
    try {
      await context.close();
    } catch {
      // ignore
    }
    try {
      await browser.close();
    } catch {
      // ignore
    }
  };

  return { browser, context, page, dispose };
}
