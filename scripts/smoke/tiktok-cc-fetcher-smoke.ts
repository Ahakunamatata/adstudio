/**
 * Smoke script for tiktokCreativeCenterFetcher.
 *
 * 不调真实网络，不碰 DB，不需要 .env。
 *
 * 跑法：
 *   pnpm tsx scripts/smoke/tiktok-cc-fetcher-smoke.ts
 *
 * 做法：
 *   1. 把 fixtures 下的假 session JSON 拷到 /tmp，把 captured_at 改成 now
 *      （避免 7 天 stale check 把测试挂掉）
 *   2. monkey-patch globalThis.fetch，按 URL 里的 page=N 返回对应 fixture page
 *   3. 调 fetchTiktokCreativeCenter，跑断言并打 ✅/❌
 *
 * 退出码：所有断言通过 → 0，任一失败 → 1
 */

import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchTiktokCreativeCenter } from "../../src/lib/fetchers/tiktokCreativeCenterFetcher";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(
  __dirname,
  "..",
  "..",
  "src",
  "lib",
  "fetchers",
  "__fixtures__"
);

type Assertion = {
  label: string;
  pass: boolean;
  detail?: string;
};

const assertions: Assertion[] = [];

function record(label: string, pass: boolean, detail?: string) {
  assertions.push({ label, pass, detail });
}

async function loadFixture<T>(name: string): Promise<T> {
  const buf = await readFile(join(FIXTURES_DIR, name), "utf-8");
  return JSON.parse(buf) as T;
}

async function main() {
  // ── 1. prepare a non-stale session at /tmp ──
  const sessionFixture = await loadFixture<{ captured_at: string }>(
    "tiktok_cc_session.json"
  );
  sessionFixture.captured_at = new Date().toISOString();
  const tmpSessionPath = join(tmpdir(), "tiktok_cc_session_smoke.json");
  await writeFile(tmpSessionPath, JSON.stringify(sessionFixture, null, 2));

  // ── 2. load mock API page bodies ──
  const page1 = await loadFixture<unknown>("tiktok_cc_page1.json");
  const page2 = await loadFixture<unknown>("tiktok_cc_page2.json");

  // ── 3. monkey-patch globalThis.fetch ──
  const fetchCalls: string[] = [];
  const originalFetch = globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    fetchCalls.push(url);
    let body: unknown;
    if (url.includes("page=1")) {
      body = page1;
    } else if (url.includes("page=2")) {
      body = page2;
    } else {
      body = {
        code: 0,
        msg: "OK",
        data: { materials: [], pagination: { has_more: false, total_count: 0 } }
      };
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }) as typeof globalThis.fetch;

  let result;
  try {
    result = await fetchTiktokCreativeCenter({
      region: "US",
      period: 30,
      sessionPath: tmpSessionPath
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  // ── 4. inspect result + assert ──
  console.log("\n── fetch calls ──");
  for (const u of fetchCalls) console.log("  GET", u);

  console.log("\n── result ──");
  console.log("ok:", result.ok);
  if (!result.ok) {
    console.error("error:", result.error, "—", result.message);
    record("result.ok === true", false, `${result.error}: ${result.message}`);
    report();
    process.exit(1);
  }

  console.log("ads.length:", result.ads.length);
  console.log("totalCount:", result.totalCount);
  console.log("pageCount:", result.pageCount);
  console.log("\nads[0]:", JSON.stringify(
    {
      id: result.ads[0]?.id,
      source: result.ads[0]?.source,
      sourceId: result.ads[0]?.sourceId,
      advertiserName: result.ads[0]?.advertiserName,
      adCreativeBodies: result.ads[0]?.adCreativeBodies,
      videoUrl: result.ads[0]?.videoUrl,
      thumbnailUrl: result.ads[0]?.thumbnailUrl,
      enrichedAt: result.ads[0]?.enrichedAt,
      metrics: result.ads[0]?.metrics
    },
    null,
    2
  ));
  console.log("\nads[1].videoUrl (fallback test):", result.ads[1]?.videoUrl);

  record("ads.length === 4", result.ads.length === 4, `actual=${result.ads.length}`);

  const id0 = result.ads[0]?.id ?? "";
  record(
    "ads[0].id matches /^tiktok-\\d+$/",
    /^tiktok-\d+$/.test(id0),
    `id=${id0}`
  );

  record(
    "ads[0].source === 'tiktok_cc'",
    result.ads[0]?.source === "tiktok_cc",
    `source=${result.ads[0]?.source}`
  );

  record(
    "ads[0].advertiserName === null (brand_name='' → null)",
    result.ads[0]?.advertiserName === null,
    `advertiserName=${JSON.stringify(result.ads[0]?.advertiserName)}`
  );

  record(
    "ads[1].videoUrl falls back to 480p when 720p missing",
    typeof result.ads[1]?.videoUrl === "string" &&
      result.ads[1].videoUrl.includes("B_480p"),
    `videoUrl=${result.ads[1]?.videoUrl}`
  );

  report();
}

function report() {
  console.log("\n── assertions ──");
  let failed = 0;
  for (const a of assertions) {
    const mark = a.pass ? "✅" : "❌";
    console.log(`${mark} ${a.label}${a.detail ? `  [${a.detail}]` : ""}`);
    if (!a.pass) failed += 1;
  }
  console.log(
    `\n${assertions.length - failed}/${assertions.length} passed${failed > 0 ? `, ${failed} failed` : ""}`
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("smoke script crashed:", e);
  process.exit(1);
});
