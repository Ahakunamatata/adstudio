import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// ────────────────────────────────────────────────────────────────
// Drizzle DB client (server-side only).
//
// 单例：Next.js dev mode 热重载会重新求值模块；用全局缓存避免每次重载都
// 新建一个 connection pool（postgres-js 默认最多 10 个 connection）。
// 真生产应该按需调 pool size（postgres({ max: 20 })）。
//
// 仅在 API route / server component / scripts 里用，绝不要 import 进
// client component（会泄露 DATABASE_URL 给浏览器 + 包打不开）。
// ────────────────────────────────────────────────────────────────

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env.local and configure it."
  );
}

type Connection = ReturnType<typeof postgres>;
type DrizzleDB = ReturnType<typeof drizzle<typeof schema>>;

declare global {
  var __adStudioPgClient: Connection | undefined;
  var __adStudioDrizzle: DrizzleDB | undefined;
}

const client: Connection =
  globalThis.__adStudioPgClient ?? postgres(databaseUrl, { max: 10 });
if (!globalThis.__adStudioPgClient) globalThis.__adStudioPgClient = client;

export const db: DrizzleDB =
  globalThis.__adStudioDrizzle ?? drizzle(client, { schema });
if (!globalThis.__adStudioDrizzle) globalThis.__adStudioDrizzle = db;

export { schema };
