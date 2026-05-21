import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Next.js uses .env.local for local secrets but drizzle-kit doesn't know about
// Next conventions, so we point dotenv at it explicitly.
config({ path: ".env.local" });

// drizzle-kit 用这个配置：
//   - schema:        TS schema 源
//   - out:           生成的 SQL migration 文件落到哪里
//   - dialect:       postgres
//   - dbCredentials: 连本机 ad_studio（DATABASE_URL 在 .env.local）
//
// 命令速查：
//   pnpm drizzle-kit generate    根据 schema 变化生成新 migration SQL
//   pnpm drizzle-kit migrate     把未应用的 migration 跑到 DB
//   pnpm drizzle-kit studio      启动 Drizzle Studio (web UI 看表)
//   pnpm drizzle-kit push        跳过 migration，schema 直推 DB（仅本地原型用）

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env.local and configure it."
  );
}

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl
  },
  verbose: true,
  strict: true
});
