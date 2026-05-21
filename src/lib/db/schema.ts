import { sql } from "drizzle-orm";
import {
  pgEnum,
  pgTable,
  text,
  integer,
  jsonb,
  timestamp,
  uuid,
  primaryKey,
  index,
  vector
} from "drizzle-orm/pg-core";

// ────────────────────────────────────────────────────────────────
// Ad Studio DB schema (Postgres 18 + pgvector 0.8.2)
//
// 设计原则：
//   - ads 是跨用户共享的池子：抓回来一次，所有用户的相关性匹配都从这里查
//   - ads.id 用 `{source}-{source_id}` 格式，天然去重 + 一眼能看出来源
//   - 保留 raw jsonb 字段，存原始 API 响应，方便后期改解析维度或回放 debug
//   - ad_embeddings 单独一张表：嵌入是 expensive 的，分离便于"已抓但未嵌入"
//     这种中间状态查询
//   - my_products 落 DB 但前端暂时还用 localStorage（S1-5 才迁移），避免一次改太多
//   - product_ad_matches 记录每条产品 ↔ 广告的相关性分 + 用户反馈，未来训练
//     个性化 rerank 用
// ────────────────────────────────────────────────────────────────

// ── enums ──────────────────────────────────────────────────────

export const adSourceEnum = pgEnum("ad_source", ["meta", "tiktok", "google"]);
export const adStatusEnum = pgEnum("ad_status", ["active", "down", "stale"]);
export const userFeedbackEnum = pgEnum("user_feedback", ["positive", "negative"]);

// ── ads ────────────────────────────────────────────────────────
// 共享广告池。所有 source 的广告统一格式落到这一张表。
// 每个抓取后端（MetaFetcher / TikTokScraper / GoogleScraper）负责把自己源
// 的字段映射到这套通用 schema。

export const ads = pgTable(
  "ads",
  {
    // `{source}-{source_id}`，e.g. "meta-1234567890" / "tiktok-7234567890123"
    id: text("id").primaryKey(),
    source: adSourceEnum("source").notNull(),
    sourceId: text("source_id").notNull(),

    // advertiser / page
    advertiserName: text("advertiser_name"),
    advertiserPageId: text("advertiser_page_id"),

    // creative text — 数组方便存多条文本（Meta 一条广告可能有多个 creative body）
    adCreativeBodies: text("ad_creative_bodies").array(),
    adCreativeTitles: text("ad_creative_titles").array(),
    adCreativeLinkDescriptions: text("ad_creative_link_descriptions").array(),
    adCreativeLinkCaptions: text("ad_creative_link_captions").array(),

    // media
    videoUrl: text("video_url"),
    thumbnailUrl: text("thumbnail_url"),
    snapshotUrl: text("snapshot_url"), // 平台官方存档页

    // delivery context
    region: text("region"), // ISO-3166 alpha-2，"US" / "DE" / "VN"...
    publisherPlatforms: text("publisher_platforms").array(), // ["facebook","instagram","audience_network"...]
    languages: text("languages").array(),

    deliveryStartAt: timestamp("delivery_start_at", { withTimezone: true }),
    deliveryStopAt: timestamp("delivery_stop_at", { withTimezone: true }),

    // 我方时间戳
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    status: adStatusEnum("status").default("active").notNull(),

    // 原始响应保命字段。后期想加新解析维度直接从 raw 重新提取
    raw: jsonb("raw"),

    // ── enrichment 字段（detail 页面拿到，可空 = 还没富化） ──
    // ASR / 视频字幕拆出来的口播文本 —— 给 LLM rerank / clone 高价值
    transcript: text("transcript"),
    // 实际跳转的着陆页（list endpoint 不返回，要从 detail 拿）
    landingPageUrl: text("landing_page_url"),
    // 该广告聚合指标快照（impression / ctr / spend rolling）
    metrics: jsonb("metrics"),
    // 最近一次 detail 富化时间（NULL 表示还没富化）
    enrichedAt: timestamp("enriched_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
  },
  (table) => [
    index("ads_source_idx").on(table.source),
    index("ads_region_idx").on(table.region),
    index("ads_advertiser_idx").on(table.advertiserName),
    index("ads_first_seen_idx").on(table.firstSeenAt),
    // 状态扫描：定期把超过 X 天没刷新的标 stale
    index("ads_status_last_seen_idx").on(table.status, table.lastSeenAt),
    // 富化扫描：未富化的 ad 优先排队
    index("ads_enriched_at_idx").on(table.enrichedAt)
  ]
);

export type Ad = typeof ads.$inferSelect;
export type NewAd = typeof ads.$inferInsert;

// ── ad_embeddings ──────────────────────────────────────────────
// 单独一张，让"抓到但未嵌入"和"已抓已嵌入"是两个清晰状态。
// 用 HNSW 索引做 ANN（pgvector 0.5+ 支持，比 IVFFlat 召回更稳）

export const adEmbeddings = pgTable(
  "ad_embeddings",
  {
    adId: text("ad_id")
      .primaryKey()
      .references(() => ads.id, { onDelete: "cascade" }),
    model: text("model").notNull(), // e.g. "minimax-embo-01-text"
    // 1024 dim：MiniMax embo-01-text 输出维度。若换 model 需新加列或换表
    embedding: vector("embedding", { dimensions: 1024 }).notNull(),
    embeddedAt: timestamp("embedded_at", { withTimezone: true })
      .defaultNow()
      .notNull()
  },
  (table) => [
    // HNSW + cosine 距离（短文本语义检索的常用组合）
    index("ad_embeddings_hnsw_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops")
    )
  ]
);

export type AdEmbedding = typeof adEmbeddings.$inferSelect;
export type NewAdEmbedding = typeof adEmbeddings.$inferInsert;

// ── my_products ────────────────────────────────────────────────
// 用户自助录入的产品。Schema 跟前端 localStorage 现有结构对齐，便于 S1-5 迁移。

export const myProducts = pgTable(
  "my_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    type: text("type").notNull(), // "App" / "Ecommerce" / "Game" / ...
    intro: text("intro").default("").notNull(),
    painPoints: text("pain_points").default("").notNull(),
    url: text("url").default("").notNull(),
    images: jsonb("images").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),

    // Minimax 解析输出
    inferredIndustry: text("inferred_industry"),
    inferredKeywords: text("inferred_keywords").array().default(sql`'{}'::text[]`),
    cleanedIntro: text("cleaned_intro"),
    cleanedPainPoints: text("cleaned_pain_points"),

    useForCloning: integer("use_for_cloning").default(1).notNull(), // 0/1 boolean
    createdBy: text("created_by").default("demo-user").notNull(),

    // 最近一次 /api/my-products/match-ads 跑完的时间。NULL 表示从没跑过。
    // 用来做缓存/重抓决策：例如「last_match_run_at 超过 24h 就自动重抓」。
    lastMatchRunAt: timestamp("last_match_run_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
  },
  (table) => [
    index("my_products_created_by_idx").on(table.createdBy),
    index("my_products_created_at_idx").on(table.createdAt)
  ]
);

export type MyProductRow = typeof myProducts.$inferSelect;
export type NewMyProductRow = typeof myProducts.$inferInsert;

// ── product_ad_matches ─────────────────────────────────────────
// 产品 ↔ 广告 N:N。relevanceScore 是 LLM rerank 给的 0-100。
// userFeedback 留着收用户 ✓/✗ 反馈，未来训练 personalized rerank。

export const productAdMatches = pgTable(
  "product_ad_matches",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => myProducts.id, { onDelete: "cascade" }),
    adId: text("ad_id")
      .notNull()
      .references(() => ads.id, { onDelete: "cascade" }),
    relevanceScore: integer("relevance_score").notNull(),
    matchedKeywords: text("matched_keywords").array().default(sql`'{}'::text[]`),
    userFeedback: userFeedbackEnum("user_feedback"),
    surfacedAt: timestamp("surfaced_at", { withTimezone: true })
      .defaultNow()
      .notNull()
  },
  (table) => [
    primaryKey({ columns: [table.productId, table.adId] }),
    index("pam_product_score_idx").on(
      table.productId,
      table.relevanceScore.desc()
    ),
    index("pam_ad_idx").on(table.adId)
  ]
);

export type ProductAdMatch = typeof productAdMatches.$inferSelect;
export type NewProductAdMatch = typeof productAdMatches.$inferInsert;

// ── workbench_node_artifacts ───────────────────────────────────
// Workbench canvas 节点的 LLM 生成结果。
// 一个 node 可能多版本（用户反复点「重新生成」），按 createdAt DESC 取最新。
// content jsonb 是 Zod 校验过的结构化产物（每个 businessType 一种 shape）。
// raw_text 留原始 LLM 响应做 debug + 兜底 fallback。
//
// session_id / node_id 都用 text — client side 生成的 ID（不是 UUID），跟当前
// 前端 cloneCanvas.ts 生成的 nodeId 兼容。

export const workbenchArtifactBusinessTypeEnum = pgEnum(
  "workbench_artifact_business_type",
  [
    "objective_breakdown",
    "clone_strategy",
    "ad_script",
    "storyboard_frame",
    "final_video"
  ]
);

export const workbenchNodeArtifacts = pgTable(
  "workbench_node_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: text("session_id").notNull(),
    nodeId: text("node_id").notNull(),
    businessType: workbenchArtifactBusinessTypeEnum("business_type").notNull(),
    content: jsonb("content").notNull(),
    rawText: text("raw_text"),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull()
  },
  (table) => [
    index("workbench_artifacts_session_idx").on(table.sessionId),
    index("workbench_artifacts_node_idx").on(table.nodeId, table.createdAt.desc())
  ]
);

export type WorkbenchNodeArtifact = typeof workbenchNodeArtifacts.$inferSelect;
export type NewWorkbenchNodeArtifact = typeof workbenchNodeArtifacts.$inferInsert;

// ── crawl_jobs ─────────────────────────────────────────────────
// 爬虫任务队列。Worker (67) 轮询此表，挑 status='pending' && scheduled_for<=now()
// 的任务跑 TikTok/Meta/Google 爬取。
//
// 用 product_id 串起"为这个用户的产品定向爬"：
//   - product_id NOT NULL → 用户触发的（Sprint A）
//   - product_id NULL → cron 触发的批量爬（Sprint B 矩阵）
//
// 关键索引：(status, scheduled_for) 给 worker 轮询；(product_id, created_at desc)
// 给前端展示该产品的爬虫历史。
//
// SKIP LOCKED + FOR UPDATE 配合，让多 worker 并发也安全（一个任务不会被两个 worker 抢到）。

export const crawlJobStatusEnum = pgEnum("crawl_job_status", [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled"
]);

export const crawlJobSourceEnum = pgEnum("crawl_job_source", [
  "tiktok",
  "meta",
  "google"
]);

export const crawlJobs = pgTable(
  "crawl_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id").references(() => myProducts.id, {
      onDelete: "cascade"
    }),
    source: crawlJobSourceEnum("source").notNull(),
    keyword: text("keyword").notNull(),
    region: text("region").notNull(),
    status: crawlJobStatusEnum("status").default("pending").notNull(),
    adsFound: integer("ads_found").default(0).notNull(),
    adsNew: integer("ads_new").default(0).notNull(),
    errorMessage: text("error_message"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true })
  },
  (table) => [
    // worker 轮询用
    index("crawl_jobs_dispatch_idx").on(table.status, table.scheduledFor),
    // 前端按产品看
    index("crawl_jobs_product_idx").on(
      table.productId,
      table.createdAt.desc()
    )
  ]
);

export type CrawlJob = typeof crawlJobs.$inferSelect;
export type NewCrawlJob = typeof crawlJobs.$inferInsert;

// ── embed_queue ────────────────────────────────────────────────
// 把"算 embedding"从爬虫流水线里解耦出去：
//   - crawler-runner 抓到新 ad → 只插 embed_queue 一行（fast，不卡爬虫）
//   - embed-runner 单独的进程 → 轮询 embed_queue，调 Jina，写 ad_embeddings
//
// 为什么解耦：
//   - Jina rate limit / 偶发 5xx 不应该让爬虫整批 ad 重跑
//   - embed 失败可以独立 retry（attempts + max_attempts）
//   - 切换 embedding provider（Minimax 余额回来时）只改 embed-runner，爬虫零感知
//   - 后续做"reembedding 全量"（model 升级）也复用这张表
//
// 状态机：pending → running → done / failed
// done/failed 都是终态；done 行可以定期清理（保留 7 天做审计）。
// failed 行（attempts >= max_attempts）等人工 inspect。

export const embedQueueStatusEnum = pgEnum("embed_queue_status", [
  "pending",
  "running",
  "done",
  "failed"
]);

export const embedQueue = pgTable(
  "embed_queue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adId: text("ad_id")
      .notNull()
      .references(() => ads.id, { onDelete: "cascade" }),
    status: embedQueueStatusEnum("status").default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(5).notNull(),
    lastError: text("last_error"),
    // 失败后下次可重试时间（线性回退也好指数也好，都靠 scheduled_for 推迟）
    scheduledFor: timestamp("scheduled_for", { withTimezone: true })
      .defaultNow()
      .notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
  },
  (table) => [
    // worker 轮询主索引
    index("embed_queue_dispatch_idx").on(table.status, table.scheduledFor),
    // 同一 ad 同一时间只允许一个 pending/running，避免重复算
    index("embed_queue_ad_id_idx").on(table.adId)
  ]
);

export type EmbedQueueRow = typeof embedQueue.$inferSelect;
export type NewEmbedQueueRow = typeof embedQueue.$inferInsert;

// ── crawl_matrix ───────────────────────────────────────────────
// Sprint B 基建：把"我们持续关心的 keyword × region × source 组合"沉淀到
// 数据库里，由 expand-pool.ts 周期性地把到期的行展开成 crawl_jobs 任务。
//
// 设计思路：
//   - 一行 = 一条"持续观察"规则。`cadence_hours` 控制下次重抓间隔。
//   - `next_run_at` 是下次允许触发的时间；expand-pool 跑的时候只看
//     `enabled = true && next_run_at <= now()` 的行。
//   - product_id 可空：null 表示全局监控（业内通用爆款方向，cron 维护），
//     非 null 表示用户产品定向（Sprint A 已有，此处提供一致 schema）。
//   - `priority` 大的先排（同周期内 ECS 资源紧时让用户产品先过）。
//   - 不强行 unique(keyword,region,source) —— 不同 product 可以共享同样的
//     (keyword,region,source)，由 priority 决定先后。

export const crawlMatrix = pgTable(
  "crawl_matrix",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id").references(() => myProducts.id, {
      onDelete: "cascade"
    }),
    source: crawlJobSourceEnum("source").notNull(),
    keyword: text("keyword").notNull(),
    region: text("region").notNull(),
    cadenceHours: integer("cadence_hours").default(24).notNull(),
    priority: integer("priority").default(0).notNull(),
    enabled: integer("enabled").default(1).notNull(), // 0/1 boolean
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    nextRunAt: timestamp("next_run_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
  },
  (table) => [
    // expand-pool 扫描主索引
    index("crawl_matrix_due_idx").on(table.enabled, table.nextRunAt),
    // 按产品看
    index("crawl_matrix_product_idx").on(table.productId, table.createdAt.desc())
  ]
);

export type CrawlMatrixRow = typeof crawlMatrix.$inferSelect;
export type NewCrawlMatrixRow = typeof crawlMatrix.$inferInsert;

// ── enrich_queue ───────────────────────────────────────────────
// 单独把"打开广告 detail 页 → 抓 transcript/landing/metrics"做成异步队列：
//   - list endpoint 返回的字段太少，detail 才有 transcript 这类高价值数据
//   - detail 拉取慢（每条要走 Playwright），不能让它卡爬虫
//   - 老 ad 也可以重新富化（detail 内容会跟着指标更新）
//
// 状态机：pending → running → done / failed（同 embed_queue）
// 默认 max_attempts = 3（detail 比 embed 容易超时；失败成本可控）

export const enrichQueueStatusEnum = pgEnum("enrich_queue_status", [
  "pending",
  "running",
  "done",
  "failed"
]);

export const enrichQueue = pgTable(
  "enrich_queue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adId: text("ad_id")
      .notNull()
      .references(() => ads.id, { onDelete: "cascade" }),
    status: enrichQueueStatusEnum("status").default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(3).notNull(),
    lastError: text("last_error"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true })
      .defaultNow()
      .notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
  },
  (table) => [
    index("enrich_queue_dispatch_idx").on(table.status, table.scheduledFor),
    index("enrich_queue_ad_id_idx").on(table.adId)
  ]
);

export type EnrichQueueRow = typeof enrichQueue.$inferSelect;
export type NewEnrichQueueRow = typeof enrichQueue.$inferInsert;
