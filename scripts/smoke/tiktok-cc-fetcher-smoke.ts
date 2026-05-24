/**
 * Smoke script for tiktokCreativeCenterFetcher.
 *
 * 不调真实网络，不碰 DB，不需要 .env。
 *
 * 跑法：
 *   pnpm tsx scripts/smoke/tiktok-cc-fetcher-smoke.ts
 *
 * Cases：
 *   1. Browse mode：两页拉满 4 条 ad，验字段映射 / 720p fallback / brand 空值
 *   2. Keyword single page：单页 keyword search，验 URL 含 keyword + UUID v4 search_id
 *   3. Keyword multi-page：两页 keyword search，验两次 fetch 的 search_id 是同一个
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

type Assertion = { label: string; pass: boolean; detail?: string };
const assertions: Assertion[] = [];
function record(label: string, pass: boolean, detail?: string) {
  assertions.push({ label, pass, detail });
}

async function loadFixture<T>(name: string): Promise<T> {
  const buf = await readFile(join(FIXTURES_DIR, name), "utf-8");
  return JSON.parse(buf) as T;
}

// 写一份 captured_at = now 的临时 session 到 /tmp，避开 7 天 stale check
async function prepareTempSession(): Promise<string> {
  const sessionFixture = await loadFixture<{ captured_at: string }>(
    "tiktok_cc_session.json"
  );
  sessionFixture.captured_at = new Date().toISOString();
  const tmpSessionPath = join(tmpdir(), "tiktok_cc_session_smoke.json");
  await writeFile(tmpSessionPath, JSON.stringify(sessionFixture, null, 2));
  return tmpSessionPath;
}

// monkey-patch globalThis.fetch，跑 fn，结束后恢复并返回采集到的 URL 列表
async function runWithMockFetch<T>(
  responder: (url: string) => unknown,
  fn: () => Promise<T>
): Promise<{ result: T; calls: string[] }> {
  const calls: string[] = [];
  const original = globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.fetch = (async (input: any) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    calls.push(url);
    const body = responder(url);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }) as typeof globalThis.fetch;
  try {
    const result = await fn();
    return { result, calls };
  } finally {
    globalThis.fetch = original;
  }
}

// ────────────────────────────────────────────────────────────────
// Case 1 — Browse mode（原有 5 个 assertion）
// ────────────────────────────────────────────────────────────────
async function runBrowseCase(sessionPath: string) {
  console.log("\n══ Case 1 — Browse mode ══");
  const page1 = await loadFixture<unknown>("tiktok_cc_page1.json");
  const page2 = await loadFixture<unknown>("tiktok_cc_page2.json");

  const { result, calls } = await runWithMockFetch(
    (url) => {
      if (url.includes("page=1")) return page1;
      if (url.includes("page=2")) return page2;
      return { code: 0, data: { materials: [], pagination: { has_more: false } } };
    },
    () =>
      fetchTiktokCreativeCenter({
        region: "US",
        period: 30,
        sessionPath
      })
  );

  console.log("fetch calls:");
  for (const u of calls) console.log("  GET", u);

  if (!result.ok) {
    record("[browse] result.ok", false, `${result.error}: ${result.message}`);
    return;
  }
  console.log("ok=true, ads.length=", result.ads.length, "pageCount=", result.pageCount);
  console.log("raw.searchMode:", result.raw.searchMode, "raw.searchId:", result.raw.searchId);
  console.log("ads[0]:", JSON.stringify(
    {
      id: result.ads[0]?.id,
      source: result.ads[0]?.source,
      advertiserName: result.ads[0]?.advertiserName,
      videoUrl: result.ads[0]?.videoUrl
    },
    null,
    2
  ));

  record("[browse] ads.length === 4", result.ads.length === 4, `actual=${result.ads.length}`);
  const id0 = result.ads[0]?.id ?? "";
  record(
    "[browse] ads[0].id matches /^tiktok-\\d+$/",
    /^tiktok-\d+$/.test(id0),
    `id=${id0}`
  );
  record(
    "[browse] ads[0].source === 'tiktok_cc'",
    result.ads[0]?.source === "tiktok_cc",
    `source=${result.ads[0]?.source}`
  );
  record(
    "[browse] ads[0].advertiserName === null (brand_name='' → null)",
    result.ads[0]?.advertiserName === null,
    `advertiserName=${JSON.stringify(result.ads[0]?.advertiserName)}`
  );
  record(
    "[browse] ads[1].videoUrl falls back to 480p when 720p missing",
    typeof result.ads[1]?.videoUrl === "string" &&
      result.ads[1].videoUrl.includes("B_480p"),
    `videoUrl=${result.ads[1]?.videoUrl}`
  );
}

// ────────────────────────────────────────────────────────────────
// Case 2 — Keyword search 单页：URL 带 keyword + search_id UUID v4
// ────────────────────────────────────────────────────────────────
const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function runKeywordSinglePageCase(sessionPath: string) {
  console.log("\n══ Case 2 — Keyword single page ══");
  const kwFixture = await loadFixture<unknown>("tiktok_cc_page1_keyword.json");

  const { result, calls } = await runWithMockFetch(
    () => kwFixture,
    () =>
      fetchTiktokCreativeCenter({
        region: "US",
        keyword: "skincare",
        limit: 2,
        sessionPath
      })
  );

  console.log("fetch calls:");
  for (const u of calls) console.log("  GET", u);

  if (!result.ok) {
    record(
      "[keyword-1page] result.ok",
      false,
      `${result.error}: ${result.message}`
    );
    return;
  }
  console.log("ok=true, ads.length=", result.ads.length);
  console.log("raw.searchMode:", result.raw.searchMode, "raw.searchId:", result.raw.searchId);

  record(
    "[keyword-1page] fetch called at least once",
    calls.length >= 1,
    `count=${calls.length}`
  );

  const firstUrl = calls[0] ? new URL(calls[0]) : null;
  const kwParam = firstUrl?.searchParams.get("keyword") ?? "";
  const searchIdParam = firstUrl?.searchParams.get("search_id") ?? "";
  record(
    "[keyword-1page] URL has keyword=skincare",
    kwParam === "skincare",
    `keyword=${kwParam}`
  );
  record(
    "[keyword-1page] URL search_id is UUID v4",
    UUID_V4_RE.test(searchIdParam),
    `search_id=${searchIdParam}`
  );
  record(
    "[keyword-1page] raw.searchMode === 'keyword'",
    result.raw.searchMode === "keyword",
    `searchMode=${result.raw.searchMode}`
  );
}

// ────────────────────────────────────────────────────────────────
// Case 3 — Keyword multi-page：两次 fetch 的 search_id 必须同
// ────────────────────────────────────────────────────────────────
async function runKeywordMultiPageCase(sessionPath: string) {
  console.log("\n══ Case 3 — Keyword multi-page search_id 一致 ══");
  // 复用 browse 的 page1/page2 fixture（schema 同；fetcher 不读 ad_title
  // 是否真含关键词，只看 has_more + pagination 翻页）
  const page1 = await loadFixture<unknown>("tiktok_cc_page1.json");
  const page2 = await loadFixture<unknown>("tiktok_cc_page2.json");

  const { result, calls } = await runWithMockFetch(
    (url) => {
      if (url.includes("page=1")) return page1;
      if (url.includes("page=2")) return page2;
      return { code: 0, data: { materials: [], pagination: { has_more: false } } };
    },
    () =>
      fetchTiktokCreativeCenter({
        region: "US",
        keyword: "moisturizer",
        // 不传 limit → 默认 100，让 has_more 翻页机制决定何时停（fixture
        // page1 has_more=true, page2 has_more=false → 共 2 次请求）
        sessionPath
      })
  );

  console.log("fetch calls:");
  for (const u of calls) console.log("  GET", u);
  if (!result.ok) {
    record(
      "[keyword-2page] result.ok",
      false,
      `${result.error}: ${result.message}`
    );
    return;
  }
  console.log("ok=true, pageCount=", result.pageCount, "raw.searchId:", result.raw.searchId);

  record(
    "[keyword-2page] fetch called exactly twice",
    calls.length === 2,
    `count=${calls.length}`
  );

  const sids = calls.map((u) => new URL(u).searchParams.get("search_id"));
  const allSame = sids.length >= 2 && sids.every((s) => s !== null && s === sids[0]);
  record(
    "[keyword-2page] all pages share the same search_id (UUID v4)",
    allSame && UUID_V4_RE.test(sids[0] ?? ""),
    `search_ids=${JSON.stringify(sids)}`
  );
}

// ────────────────────────────────────────────────────────────────
// main
// ────────────────────────────────────────────────────────────────
async function main() {
  const sessionPath = await prepareTempSession();

  await runBrowseCase(sessionPath);
  await runKeywordSinglePageCase(sessionPath);
  await runKeywordMultiPageCase(sessionPath);

  report();
}

function report() {
  console.log("\n══ assertions ══");
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
