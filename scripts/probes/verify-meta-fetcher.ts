/**
 * 端到端验证 metaAdLibraryFetcher：跑一个 keyword，看返回 ads 字段质量。
 *
 * 跑法：
 *   TIKTOK_PROXY_URL=... ./node_modules/.bin/tsx --env-file=.env.local \
 *     scripts/probes/verify-meta-fetcher.ts "fitness app"
 */

import { fetchMetaAdLibrary } from "../../src/lib/fetchers/metaAdLibraryFetcher";

async function main() {
  const keyword = process.argv[2] ?? "fitness app";
  console.log(`→ fetch Meta Ad Library: keyword="${keyword}" region=US`);
  const result = await fetchMetaAdLibrary({
    keyword,
    region: "US",
    limit: 10
  });
  if (!result.ok) {
    console.log(`✗ ${result.error}: ${result.message}`);
    process.exit(1);
  }
  console.log(`✓ got ${result.ads.length} ads`);
  for (const ad of result.ads.slice(0, 5)) {
    console.log(`---`);
    console.log(`  id:        ${ad.id}`);
    console.log(`  page:      ${ad.advertiserName} (${ad.advertiserPageId})`);
    console.log(`  body:      ${ad.adCreativeBodies?.[0]?.slice(0, 100) ?? "(none)"}...`);
    console.log(`  title:     ${ad.adCreativeTitles?.[0] ?? "(none)"}`);
    console.log(`  landing:   ${ad.landingPageUrl ?? "(none)"}`);
    console.log(`  video:     ${ad.videoUrl ? "yes" : "no"}`);
    console.log(`  start_at:  ${ad.deliveryStartAt}`);
    console.log(`  platforms: ${JSON.stringify(ad.publisherPlatforms)}`);
    console.log(`  metrics:   ${JSON.stringify(ad.metrics)}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("verify crashed:", e);
  process.exit(1);
});
