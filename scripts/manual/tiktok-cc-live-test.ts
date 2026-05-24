/**
 * Manual live test for tiktokCreativeCenterFetcher.
 *
 * 跟 scripts/smoke/tiktok-cc-fetcher-smoke.ts 区别：
 *   - smoke 用 __fixtures__ + monkey-patch globalThis.fetch
 *   - 本脚本用真实 session 文件 + 真实 fetch 调 TikTok creative_radar_api
 *
 * 用法：
 *   # browse 模式（trending top ads）
 *   pnpm tsx scripts/manual/tiktok-cc-live-test.ts \
 *     --session /path/to/session.json --region US --limit 5
 *
 *   # keyword search 模式
 *   pnpm tsx scripts/manual/tiktok-cc-live-test.ts \
 *     --session /path/to/session.json --region US --keyword skincare --limit 5
 *
 *   也可以省 --session，从 TIKTOK_CC_SESSION_PATH env var 读。
 *   不传 --keyword 时行为完全等同 browse 模式（向后兼容）。
 *
 * 退出码：
 *   0 = 成功
 *   1 = 参数错误
 *   2 = fetcher 返回 ok=false（session_expired / rate_limited 等）
 */

import { fetchTiktokCreativeCenter } from "../../src/lib/fetchers/tiktokCreativeCenterFetcher";

// 简单 argparse —— 跟 scripts/seed-meta-ads.ts / ingest-tiktok.ts 同风格，不引入额外库
const args = process.argv.slice(2);
function arg(name: string, fallback?: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
}

async function main() {
  const sessionPath = arg("session", process.env.TIKTOK_CC_SESSION_PATH);
  const region = arg("region", "US")!;
  const limit = parseInt(arg("limit", "5")!, 10);
  const keyword = arg("keyword"); // 可选，留空走 browse mode

  if (!sessionPath) {
    console.error(
      "必须提供 --session <path> 或设置 TIKTOK_CC_SESSION_PATH env var"
    );
    process.exit(1);
  }

  console.log(
    `📡 fetching live: region=${region}, period=30, limit=${limit}, keyword=${keyword ?? "(browse)"}, session=${sessionPath}`
  );

  const result = await fetchTiktokCreativeCenter({
    region,
    period: 30,
    limit,
    sessionPath,
    ...(keyword ? { keyword } : {})
  });

  if (!result.ok) {
    console.error(
      `❌ failed: error=${result.error}, message=${result.message}, statusCode=${result.statusCode ?? "n/a"}`
    );
    process.exit(2);
  }

  console.log(
    `✅ ok: totalCount=${result.totalCount}, pageCount=${result.pageCount}, ads.length=${result.ads.length}, searchMode=${result.raw.searchMode}${result.raw.searchId ? `, searchId=${result.raw.searchId}` : ""}`
  );
  console.log("");
  // 重要：video / thumbnail URL 必须完整复制（含 query 参数）才能过 TikTok CDN
  // 鉴权。之前 .slice(0, 80) 截断后丢 query → 浏览器 Access Denied，误判 video
  // 链路坏了。现在完整打印；只有 creativeBody 还截（textual content 200+ 字太长）。
  console.log(
    "⚠️  video/thumbnail URLs are printed full — copy them complete (with query params) for browser test"
  );
  console.log("");

  const BODY_TRUNCATE = 60;
  for (const [i, ad] of result.ads.entries()) {
    const fullBody = ad.adCreativeBodies?.[0] ?? "";
    const bodyTruncated = fullBody.length > BODY_TRUNCATE;
    const bodyDisplay = bodyTruncated
      ? `"${fullBody.slice(0, BODY_TRUNCATE)}..." (truncated, full ${fullBody.length} chars)`
      : `"${fullBody}"`;

    console.log(`--- ad #${i + 1} ---`);
    console.log(`  id              : ${ad.id}`);
    console.log(`  source          : ${ad.source}`);
    console.log(`  advertiserName  : ${ad.advertiserName ?? "null"}`);
    console.log(`  creativeBody[0] : ${bodyDisplay}`);
    console.log(`  videoUrl        : ${ad.videoUrl ?? "null"}`);
    console.log(`  thumbnailUrl    : ${ad.thumbnailUrl ?? "null"}`);
    console.log("");
  }
}

main().catch((e) => {
  console.error("live test crashed:", e);
  process.exit(1);
});
