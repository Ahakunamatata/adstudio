// TikTok Creative Center session loader.
//
// 跟 tiktokFetcher.ts（Playwright 路径）不同，这条路径假设有 ops 维护一份
// 已经从浏览器抓出来的 session 文件（cookie + 动态签名头），fetcher 直接
// HTTP fetch creative_radar_api，不再开浏览器。
//
// session 文件由 ops 周期性手动 / 半自动刷新；这里只负责读 + 校验 + 装配
// 成可以直接 fetch 的 headers。过期判定一律 hardcode 7 天（起点值，未来
// 根据 TikTok 失效曲线再调）。

import { readFile } from "node:fs/promises";

const DEFAULT_SESSION_PATH = "/var/secrets/tiktok_cc_session.json";
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

export type TtCcSession = {
  platform: "tiktok_cc";
  captured_at: string;
  captured_via?: Record<string, unknown>;
  auth: {
    cookie: string;
    user_sign: string;
    timestamp: string;
    web_id: string;
  };
  request_template: {
    method: string;
    endpoint: string;
    headers?: Record<string, string>;
  };
  validation?: Record<string, unknown>;
};

export class SessionMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionMissingError";
  }
}

export class SessionExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionExpiredError";
  }
}

function resolveSessionPath(explicit?: string): string {
  if (explicit && explicit.length > 0) return explicit;
  const fromEnv = process.env.TIKTOK_CC_SESSION_PATH?.trim();
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return DEFAULT_SESSION_PATH;
}

// 字段级校验。结构错的 session（缺 cookie、endpoint 等）跟"文件不存在"
// 在 ops 角度是同一类问题：session 需要重新生成。统一抛 SessionMissingError。
function validateSession(raw: unknown, path: string): TtCcSession {
  if (raw === null || typeof raw !== "object") {
    throw new SessionMissingError(
      `tiktok_cc session ${path}: not a JSON object`
    );
  }
  const s = raw as Record<string, unknown>;
  if (s.platform !== "tiktok_cc") {
    throw new SessionMissingError(
      `tiktok_cc session ${path}: platform must be "tiktok_cc", got ${JSON.stringify(s.platform)}`
    );
  }
  if (typeof s.captured_at !== "string" || s.captured_at.length === 0) {
    throw new SessionMissingError(
      `tiktok_cc session ${path}: captured_at missing or not string`
    );
  }
  const auth = s.auth as Record<string, unknown> | undefined;
  if (!auth || typeof auth !== "object") {
    throw new SessionMissingError(
      `tiktok_cc session ${path}: auth block missing`
    );
  }
  for (const field of ["cookie", "user_sign", "timestamp", "web_id"]) {
    const v = auth[field];
    if (typeof v !== "string" || v.length === 0) {
      throw new SessionMissingError(
        `tiktok_cc session ${path}: auth.${field} missing or not string`
      );
    }
  }
  const tpl = s.request_template as Record<string, unknown> | undefined;
  if (!tpl || typeof tpl !== "object") {
    throw new SessionMissingError(
      `tiktok_cc session ${path}: request_template missing`
    );
  }
  if (typeof tpl.endpoint !== "string" || !tpl.endpoint.startsWith("http")) {
    throw new SessionMissingError(
      `tiktok_cc session ${path}: request_template.endpoint missing or not URL`
    );
  }
  if (typeof tpl.method !== "string") {
    throw new SessionMissingError(
      `tiktok_cc session ${path}: request_template.method missing`
    );
  }
  return raw as TtCcSession;
}

function assertNotStale(session: TtCcSession, path: string): void {
  const captured = new Date(session.captured_at);
  if (Number.isNaN(captured.getTime())) {
    throw new SessionMissingError(
      `tiktok_cc session ${path}: captured_at not parseable as date`
    );
  }
  const age = Date.now() - captured.getTime();
  if (age > STALE_AFTER_MS) {
    const days = Math.round(age / (24 * 60 * 60 * 1000));
    throw new SessionExpiredError(
      `tiktok_cc session ${path} is ${days}d old (max 7d); ops需要重新捕获`
    );
  }
}

/**
 * 读 + 解析 + 校验 session 文件。
 *
 * 失败语义：
 *   - 文件不存在 / 不可读 / JSON 不合法 / 缺字段 → SessionMissingError
 *   - captured_at 超 7 天 → SessionExpiredError
 *
 * 调用方负责把这两个 error 映射到 fetcher 的 'session_missing' /
 * 'session_expired' 错误码。
 */
export async function loadSession(path?: string): Promise<TtCcSession> {
  const resolved = resolveSessionPath(path);
  let buf: string;
  try {
    buf = await readFile(resolved, "utf-8");
  } catch (e) {
    const isEnoent =
      e instanceof Error && "code" in e && (e as { code?: string }).code === "ENOENT";
    if (isEnoent) {
      throw new SessionMissingError(
        `tiktok_cc session not found at ${resolved} (set TIKTOK_CC_SESSION_PATH)`
      );
    }
    throw new SessionMissingError(
      `tiktok_cc session read failed at ${resolved}: ${e instanceof Error ? e.message : String(e)}`
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(buf);
  } catch (e) {
    throw new SessionMissingError(
      `tiktok_cc session ${resolved}: JSON parse failed: ${e instanceof Error ? e.message : String(e)}`
    );
  }
  const session = validateSession(parsed, resolved);
  assertNotStale(session, resolved);
  return session;
}

/**
 * 把 session 里的 auth + request_template.headers 拼成一份直接可传给 fetch
 * 的 headers map。auth 字段名（snake_case）→ TikTok 实际要求的 header 名
 * （dash-separated）的映射在这里做。
 *
 * cookie / user-sign / timestamp / web-id 会覆盖 request_template.headers
 * 里如果碰巧存在的同名 key（session auth 优先级最高）。
 */
export function assembleHeaders(session: TtCcSession): Record<string, string> {
  const base = session.request_template.headers ?? {};
  return {
    ...base,
    cookie: session.auth.cookie,
    timestamp: session.auth.timestamp,
    "user-sign": session.auth.user_sign,
    "web-id": session.auth.web_id,
    // anonymous-user-id 通常跟 web-id 等价；TikTok 风控同时认两个
    "anonymous-user-id": session.auth.web_id
  };
}
