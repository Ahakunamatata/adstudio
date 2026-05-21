/**
 * Debug: 通过代理打开 TikTok Creative Center，dump 页面上所有可能是搜索框的元素，
 * 帮我们找出正确的 search input selector。
 */

import { launchBrowserSession } from "../../src/lib/fetchers/playwright/browser";

async function main() {
  const session = await launchBrowserSession({ headless: true, navTimeoutMs: 60_000 });
  try {
    const url = "https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?period=30&region=US";
    console.log("→ goto:", url);
    await session.page.goto(url, { waitUntil: "networkidle", timeout: 60_000 }).catch((e) => {
      console.log("  goto warning:", e instanceof Error ? e.message : String(e));
    });
    await session.page.waitForTimeout(5_000);

    // 所有 input
    const inputs = await session.page.$$eval("input", (els) =>
      els.map((el) => ({
        tag: el.tagName,
        type: (el as HTMLInputElement).type,
        placeholder: (el as HTMLInputElement).placeholder,
        name: (el as HTMLInputElement).name,
        id: (el as HTMLInputElement).id,
        class: el.className,
        "aria-label": el.getAttribute("aria-label")
      }))
    );
    console.log("\n=== inputs ===");
    for (const i of inputs) console.log(" ", JSON.stringify(i));

    // 所有看起来像搜索框的 div/button（很多 SPA 用 contenteditable 假 input）
    const searchish = await session.page.$$eval(
      "[class*='search' i],[class*='Search'],[data-testid*='search']",
      (els) =>
        els.slice(0, 20).map((el) => ({
          tag: el.tagName,
          class: el.className.slice(0, 120),
          text: (el.textContent ?? "").slice(0, 60),
          "data-testid": el.getAttribute("data-testid"),
          "aria-label": el.getAttribute("aria-label")
        }))
    );
    console.log("\n=== search-like elements ===");
    for (const s of searchish) console.log(" ", JSON.stringify(s));

    // 检查 ttwid cookie 是否被 set（说明 TikTok 给了我们 session）
    const cookies = await session.context.cookies();
    const tt = cookies.filter((c) => c.name.startsWith("tt") || c.name.includes("session"));
    console.log("\n=== cookies (tt*) ===");
    for (const c of tt) console.log(" ", c.name, "=", c.value.slice(0, 40), "...");
  } finally {
    await session.dispose();
  }
}

main().catch((e) => {
  console.error("crashed:", e);
  process.exit(1);
});
