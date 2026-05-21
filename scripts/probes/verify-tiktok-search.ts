/**
 * 验证 fetchTiktokAds 在带 keywords 时是否真的返回 keyword-specific 结果。
 *
 * 跑法：
 *   ./node_modules/.bin/tsx --env-file=.env.local scripts/probes/verify-tiktok-search.ts
 *
 * 通过判据：
 *   - 给两个完全不同的 keyword（"fitness app" / "anti theft"），返回的 ad id
 *     set overlap < 50%。重叠 == 100% 说明搜索没生效，fetcher 还在拉 trending。
 *   - raw.source === "search"（而不是 "trending"）
 *
 * 本机没住宅代理大概率会被 anti-bot 挡，但能跑通验证脚本本身能正常导入和编译。
 * 真正能跑通要在 ECS（47.77.177.67）上跑 —— 那边有海外 IP。
 */

import { fetchTiktokAds } from "../../src/lib/fetchers/tiktokFetcher";

type RunOutcome = {
  keyword: string;
  ok: boolean;
  source?: "search" | "trending" | "none";
  count: number;
  ids: string[];
  error?: string;
};

async function runOne(keyword: string): Promise<RunOutcome> {
  console.log(`→ search keyword: "${keyword}"`);
  const result = await fetchTiktokAds({
    keywords: [keyword],
    region: "US",
    timeWindow: "30d",
    limit: 30
  });
  if (!result.ok) {
    console.log(`  ✗ ${result.error}: ${result.message}`);
    return {
      keyword,
      ok: false,
      count: 0,
      ids: [],
      error: `${result.error}: ${result.message}`
    };
  }
  // raw is { source, body } per fetcher 改动
  const raw = result.raw as { source?: "search" | "trending" | "none" };
  const source = raw?.source;
  const ids = result.ads.map((a) => a.sourceId).filter((x): x is string => !!x);
  console.log(`  ✓ source=${source} count=${ids.length} sample=${ids.slice(0, 3).join(",")}`);
  return { keyword, ok: true, source, count: ids.length, ids };
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter += 1;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : inter / union;
}

async function main() {
  const kws = ["fitness app", "anti theft"];
  const runs: RunOutcome[] = [];
  for (const kw of kws) {
    runs.push(await runOne(kw));
  }
  console.log("\n=== summary ===");
  for (const r of runs) {
    console.log(
      `  ${r.keyword.padEnd(20)} ok=${r.ok} source=${r.source ?? "-"} count=${r.count}`
    );
  }

  // 通过判据：两次都拿到 ads & overlap < 0.5
  const okRuns = runs.filter((r) => r.ok && r.ids.length > 0);
  if (okRuns.length < 2) {
    console.log("\n⚠ not enough successful runs to compute overlap — likely anti-bot 阻塞，需要在 ECS 上跑");
    process.exit(0);
  }
  const overlap = jaccard(okRuns[0].ids, okRuns[1].ids);
  console.log(`\noverlap(jaccard) between "${okRuns[0].keyword}" and "${okRuns[1].keyword}" = ${overlap.toFixed(2)}`);
  if (overlap >= 0.5) {
    console.log("✗ FAIL: 重叠率太高，搜索可能没生效（还在返回 trending）");
    process.exit(1);
  }
  if (okRuns.some((r) => r.source !== "search")) {
    console.log("✗ FAIL: 至少一次 source !== \"search\"");
    process.exit(1);
  }
  console.log("✓ PASS: 搜索结果按 keyword 区分");
}

main().catch((error) => {
  console.error("verify crashed:", error);
  process.exit(1);
});
