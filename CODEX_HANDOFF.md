# Codex Handoff - Ad Studio

Last updated: 2026-05-21（晚上加场 —— Meta Ad Library Web 抓 + Kookeey 代理 + 慢爬重试）

## Current Goal

Continue the `adstudio` product prototype without relying on a large old Codex chat thread. The current focus is the `ad-模板-素材功能` work: AI template library, "我的产品爆款" personalized scrape flow, winning ad library, and the route from template or winning ad into generation or Agent Workbench.

## Project Path

```text
/Users/climber_glc/Desktop/AI_Climber/adstudio
```

## Resume Shortcut

When resuming from phone or a new Codex thread, the user wants to say only:

```text
继续 adstudio
```

Treat that as:

1. Read this file.
2. Run `git status --short` and `git diff --stat`.
3. Read `package.json` and relevant project docs.
4. Inspect the source files related to the current task.
5. Continue from the current code state.

## Current Worktree Snapshot

There are existing uncommitted changes in the project. Do not assume they are all from the current assistant and do not revert them.

Known changed areas at the time this handoff was created:

- **2026-05-20 added (S1)**:
  - `.env.local` 新增 `META_APP_ID / META_APP_SECRET / DATABASE_URL`
  - `.env.example` 同步更新（Anthropic-compat base + MiniMax-M2.7 + 新加 Meta vars 占位）
  - `.npmrc`（新文件，pin store-dir，实际被 pnpm 11 忽略，留作未来参考）
  - `drizzle.config.ts`（新）
  - `drizzle/0000_init.sql`（新，Drizzle 自动生成）
  - `drizzle/meta/`（Drizzle 状态文件夹）
  - `src/lib/db/schema.ts`（新）
  - `src/lib/db/index.ts`（新）
  - `src/lib/db/upsertAd.ts`（新）
  - `src/lib/fetchers/types.ts`（新）
  - `src/lib/fetchers/metaFetcher.ts`（新）
  - `src/lib/llm/minimaxEmbedding.ts`（新）
  - `src/app/api/my-products/match-ads/route.ts`（新）
  - `scripts/db-smoke.ts`（新）
  - `scripts/seed-meta-ads.ts`（新）
  - `src/lib/domain/schemas.ts` 加 `dbAdInlineSchema` + `DbAdInline` 类型，`myProductScrapedAdSchema` 新增可选 `adData` 字段
  - `src/features/my-products/useMyProducts.ts` 新增 `fetchMatchedAdsFromDb` + `dbAdToScraped`，重写 `scheduleScrape` 尾部异步分支
  - `src/features/my-products/MyProductsView.tsx` 渲染层双路径：DB ad 走 `adData` 卡片 + `snapshotUrl` 跳转，mock TopAd 走原 `topAdMap` + 详情弹窗
  - package.json + pnpm-lock.yaml（新增 drizzle-orm 0.45.2 / drizzle-kit 0.31.10 / postgres 3.4.9 / dotenv 17.4.2 / tsx 4.22.2）
- `AD_STUDIO_PRODUCT_ARCHITECTURE.md`
- `AD_STUDIO_PROJECT_CONTEXT.md`
- `AD_STUDIO_TEMPLATE_SCHEMA.md`
- `next-env.d.ts`
- `src/app/globals.css`
- `src/app/layout.tsx`
- `src/components/app-shell/AdStudioApp.tsx`
- `src/features/home/HomeView.tsx`
- `src/features/home/TemplateShowcase.tsx`
- `src/features/templates/TemplateCard.tsx`
- `src/features/templates/TemplatesView.tsx`
- `src/features/templates/TemplateDetailModal.tsx`
- `src/features/templates/WinningAdCard.tsx`
- `src/features/templates/WinningAdDetailModal.tsx`
- `src/features/my-products/MyProductsView.tsx` (new, 2026-05-19)
- `src/features/my-products/MyProductDraftModal.tsx` (new, 2026-05-19)
- `src/features/my-products/useMyProducts.ts` (new, 2026-05-19)
- `src/lib/domain/schemas.ts`
- `src/lib/mock-data/myProducts.ts` (new, 2026-05-19)
- `src/lib/mock-data/products.ts`
- `src/lib/mock-data/templates.ts`
- `src/lib/mock-data/index.ts`
- `CLAUDE.md`

## Recent Completed Work

- **2026-05-21 (晚)**: Meta Ad Library Web 抓通了 + 接入 Kookeey 韩国代理 + 慢爬重试。

  **背景**：Meta SMS 验证用户那边过不去，`ads_archive` Graph API 实测确认死路（code:10 / subcode:2332004 "App role required"）。改走绕路。

  **1. Kookeey 韩国住宅代理实测可用，但 1m sticky 太短。**
  - 代理 URL：`http://6275523-...:b9c9c9b9-KR-01102016-1m@gate.kookeey.info:1000`，egress 是釜山 LG POWERCOMM 住宅 IP
  - curl 直接 200 拿到 TikTok / FB ad library 页面 HTML
  - **但** chromium 一次 page load 要 30-90s（FB challenge resolve + 等懒加载 graphql），1m sticky 经常在握手中途切 IP → `ERR_CONNECTION_CLOSED` / `ERR_SSL_PROTOCOL_ERROR`
  - **解法 1：retry**。新加 `gotoWithRetry()` 包到 `launchBrowserSession`，专门对付 transient 网络错误，2 次重试。TikTok / Meta fetcher 都用上了。
  - **解法 2：慢爬**。crawler-runner 加 `JOB_INTERVAL_MS=45000`（每个 job 间 sleep 45s）+ `MAX_RETRIES_PER_JOB=2`（fetcher 调用本身也 retry 2 次）。
  - 用户那边 TODO：去 Kookeey 后台把 sticky 调到 10m / 30m（改用户名末尾 `-1m` → `-30m`），调长后成功率会从 ~67% 升到接近 100%，retry 就备份用。

  **2. Meta Ad Library 公开页面 web 抓 —— 绕开 Identity Verification。**
  - 新 `src/lib/fetchers/metaAdLibraryFetcher.ts`：Playwright 打开 `https://www.facebook.com/ads/library/?q=KW&country=US`，拦 GraphQL XHR (`/api/graphql/`)，过滤含 `ad_archive_id` 的 response 作为真广告数据
  - 反爬：Facebook 用 JavaScript challenge（curl 拿 403），但 chromium 执行 JS 后 reload 拿到真页面。需要住宅代理 + 等懒加载 graphql ~10-15s
  - 字段比 Graph API 还全：`page_name` / `body.text`（完整文案，常 500+ 字）/ `title` / `caption` / `cta_text` / `cta_type` / `link_url`（**landing 直接拿到不用富化**）/ `videos[].video_hd_url` / `images[]` / `start_date` / `end_date` / `publisher_platform[]` / `page_like_count`
  - schema mapping：直接填 `landingPageUrl` / `metrics` / `enrichedAt=now()`，Meta 广告**入库就已经是富化完的状态**，不进 enrich_queue
  - 本机端到端实测：3 次跑 2 次成功（"fitness app" / US）拿到完整字段（Conqueror Challenges 这条广告：landing https://www.theconqueror.events/hp-lfnp-v1/, page_like_count 549,655, 4 平台 facebook+instagram+audience_network+messenger）
  - 失败那次是 1m sticky 切 IP，crawler-runner 的 retry 会兜底

  **3. crawler-runner 重构：source 分发 + 重试 + 慢爬。**
  - `runFetcherOnce()` 抽出来按 source 分发（tiktok / meta，google 留 Sprint C）
  - 返回 `{ ok, ads | error, message, retryable }`：transient 错误（network / anti_bot / rate_limited）才重试，captcha / parse_error 直接判失败
  - 配置全走 env：`CRAWLER_JOB_INTERVAL_MS=45000` / `CRAWLER_MAX_RETRIES=2` / `CRAWLER_RETRY_BACKOFF_MS=15000`

  **4. crawl_matrix 加 Meta source。**
  - `seed-crawl-matrix.ts` 改成 seed `["tiktok", "meta"]` 两个 source
  - 现在矩阵 14 keyword × 3 region × 2 source = **84 条规则**，cadence 24h
  - 重 seed 后 `expand-pool` 一轮推 50 个新 job（受 `EXPAND_POOL_MAX=50` 限流）

  **5. 服务器更新。**
  - 67 worker：`.env.local` 加 `TIKTOK_PROXY_URL=http://...kookeey...` env，重启 `adstudio-crawler` 和 `adstudio-enrich-runner`
  - 矩阵 84 行（42 meta + 42 tiktok）seed 完毕
  - 旧 failed/pending crawl_jobs 全部 cancelled，矩阵重置 next_run_at=now()，expand-pool 推了 50 个新任务

  **用户侧 TODO**：
  - 让 Kookeey 同事改 sticky `-1m` → `-30m` 提升单 job 成功率
  - 调整后理论上 TikTok keyword search + Meta Ad Library 都能稳跑

- **2026-05-21 (overnight A.5 + B + 富化)**: 一晚上把 4 件事都落了。

  **1. Sprint A.5 — TikTok 真 keyword search 已修好。**
  - 关键诊断：`creative_radar_api/v1/top_ads/v2/list` 是 endpoint 没错，但 *只* 在用户在前端搜索框输入 + 回车时才会带 `keyword=` 参数返回真正按 keyword 过滤的结果。纯 URL `?search=KW` 不触发，list 默认还是返回 top trending。
  - 改写 `src/lib/fetchers/tiktokFetcher.ts`：
    - 先 `goto` 不带 keyword 的 topads URL（拿 trending 做兜底）
    - 找 search input（多个 selector 候选），fill keyword，press Enter
    - `waitForResponse((r) => r.url().includes(LIST_API_PATH) && r.url().includes("keyword="))`
    - 维护两个 XHR 槽位 `trendingBody` / `searchBody`，调用方要 search 但只拿到 trending → 当 anti-bot 失败上报（不污染检索池）
    - `raw` 字段现在是 `{ source: "search" | "trending", body }`，方便日后排查
  - 新增 `scripts/probes/verify-tiktok-search.ts`：跑两个不同 keyword 检查 jaccard < 0.5 + source == "search"，作为冒烟测试。
  - 本机没住宅代理跑会被 anti-bot 挡（已知），ECS 上需要 IPRoyal 才能稳定跑通。当前 fetcher 的失败分类已覆盖这个分支。

  **2. Worker 可靠性 — embed_queue + 解耦 embedder。**
  - 新表 `embed_queue`（migration 0004_embed_queue.sql）：pending/running/done/failed 状态机，attempts + max_attempts，scheduled_for 控重试时机。
  - `crawler-runner.ts` 不再 inline embed —— 抓到新 ad 只插 `embed_queue` 一行（pending），整个 crawler 流水线对 Jina 失败彻底脱敏。
  - 新增 `scripts/worker/embed-runner.ts`：独立 systemd daemon，poll 3s，`FOR UPDATE SKIP LOCKED` 抢任务，调 Jina，写 ad_embeddings。失败按线性回退 1m/5m/15m/60m/4h 重试，5 次终态化 failed 留人 inspect。
  - 新增 `scripts/worker/enqueue-missing-embeddings.ts`：补排队脚本，一条 SQL 把"有 ad 没 embedding 也没在队"的批量入队。
  - 新增 `deploy/systemd/adstudio-embed-runner.service`：MemoryMax=512M，Restart=always，日志写 `/var/log/adstudio/embed-runner.{out,err}.log`。已在 67 上 enable + start。

  **3. Sprint B 基建 — crawl_matrix + expand-pool 周期化。**
  - 新表 `crawl_matrix`（migration 0005_crawl_matrix.sql）：每行一条"持续监控"规则 (source, keyword, region, cadence_hours, priority, enabled)，`next_run_at` 控制下次到期时间。
  - `scripts/worker/expand-pool.ts`：one-shot 脚本，扫到期 rule → 插 crawl_jobs（防重复同源 keyword/region pending 已存在）→ 更新 next_run_at。MAX_NEW_JOBS_PER_RUN=50, MAX_PENDING_BACKLOG=200 限流。
  - `deploy/systemd/adstudio-expand-pool.service` (oneshot) + `adstudio-expand-pool.timer` (OnBootSec=2min, OnUnitActiveSec=10min, Persistent=true)：每 10 分钟跑一次。
  - `scripts/worker/seed-crawl-matrix.ts`：种子 14 个跨品类高频 keyword × 3 region (US/GB/DE) × tiktok = **42 rules**，cadence 24h。已在 156 上跑过。

  **4. Ad 详情富化 — TikTok detail page 抓 transcript / landing / metrics。**
  - `ads` 表新加 4 列（migration 0006_ad_enrich.sql）：`transcript text` / `landing_page_url text` / `metrics jsonb` / `enriched_at timestamp`。
  - 新表 `enrich_queue`（同 0006_ad_enrich.sql）：跟 embed_queue 同形状但 max_attempts 默认 3。
  - 新 `src/lib/fetchers/tiktokDetailFetcher.ts`：打开 `https://ads.tiktok.com/business/creativecenter/topads/detail/{ad_id}/pc/en`，宽松拦截 `material_detail` / `material_metrics` / `ad_detail` / `info` 等 XHR，flatten + 候选 key matching 抽 transcript（候选词：transcript / voice_over / captions / subtitle / speech_text / asr_text）+ landing + metrics（ctr/cpc/impressions/views/likes/...）。endpoint 名变了也不会哑掉。
  - 新增 `scripts/worker/enrich-runner.ts`：systemd daemon，结构跟 embed-runner 一样。富化成功后还会把该 ad 重排进 embed_queue（如果还没 embed —— 有 transcript 的 embedding 价值高很多）。
  - `crawler-runner.ts` 在 upsert wasNew 时同时入 embed_queue + enrich_queue。
  - `deploy/systemd/adstudio-enrich-runner.service`：MemoryMax=1024M（带 Playwright）。已在 67 上 active。

  **服务器状态（实测）：**
  ```
  q            | s       | count
  -------------+---------+------
  crawl_jobs   | pending |   41
  crawl_jobs   | running |    1   ← crawler 正在干活
  enrich_queue | pending |   17
  enrich_queue | running |    1   ← enrich 正在干活
  enrich_queue | failed  |    2   ← not_found（确实 404，正确分类）
  ```
  - 156 primary：所有 6 个 migration 已 apply，crawl_matrix 42 行已 seed。
  - 67 worker：4 个 systemd unit 全 active：`adstudio-crawler` (改) / `adstudio-embed-runner` (新) / `adstudio-enrich-runner` (新) / `adstudio-expand-pool.timer` (新 timer)。
  - `crawl_matrix` 每天会自动展开 42 个 crawl_jobs，整个池子靠 cron 持续滚动。

  **后续要做：**
  - IPRoyal 住宅代理：本机和 ECS 都没装，TikTok 反爬会卡 search 的 XHR。`TIKTOK_PROXY_URL` 环境变量加上就走代理。
  - Meta Identity Verification（用户侧 SMS 还卡着）打通后可以再加 meta source 进 crawl_matrix。
  - 富化生效后，可以做"重 embed 全量"——TRUNCATE ad_embeddings + 跑 enqueue-missing-embeddings.ts，让 transcript 进入向量空间。

- **2026-05-21 (Sprint A)**: 「我的产品爆款」从假动画升级成真定向爬虫。重要里程碑。
  - DB: 新表 `crawl_jobs`（migration 0003）+ 2 个 enum（status, source）作任务队列
  - `parse` 端点扩 `searchQueries[]`：Minimax 在 `keywords` 之上再生成 5-10 个搜索友好关键词，覆盖更广角度
  - `POST /api/my-products/[id]/start-targeted-crawl`：投递 jobs 矩阵 (source × keyword × region)
  - `GET /api/my-products/[id]/crawl-status`：聚合状态返回 jobsBySource 给前端轮询
  - `scripts/worker/crawler-runner.ts`：长跑 worker，`FOR UPDATE SKIP LOCKED` 拿单条任务，跑 TikTok fetcher，upsert + Jina embed 入库
  - 67 上 systemd 服务 `adstudio-crawler.service`，auto-restart 失败回退
  - `useMyProducts` 删假 setTimeout 5.8s 动画，新增 `startRealCrawl + finalizeScrape + jobsToProgressStatus`，每 2.5s 轮询真实状态
  - MyProductsView 进度文案改成「正在 TikTok 用你的关键词定向抓取…」「为你新抓 X 条」

  **TikTok endpoint 已知限制（需 Sprint A.5 解决）**：用的 `creative_radar_api/v1/top_ads/v2/list` 不真按 keyword 过滤，多 keyword 返回同一批 top trending。所以"为你定向"现在是：crawl 阶段拿宽 pool + match-ads 阶段用 Jina semantic 做"为你排"。要做 keyword-level filtering 需换 TikTok 别的 search endpoint。

  端到端实测：9 个 searchQueries × 1 region × tiktok = 9 jobs，worker ~90s 全跑完，match-ads 切语义模式 top 5 都是 70+ 相关度。

  双机协作：本机 dev、156 (primary, web + PG)、67 (worker) 三处代码已同步，67 systemd 重启 clean，156 prod 已 rebuild。

- **2026-05-21 (00:30)**: 阿里云硅谷 ECS 47.77.177.156 上线，本机环境 1:1 复制到服务器。
  - Ubuntu 24.04.4 LTS，4 vCPU / 7GB RAM / 12GB 可用磁盘（其他项目已占 36GB，留意磁盘上限）。
  - SSH：用户原有 `~/.ssh/id_ed25519` 上传到服务器 `authorized_keys`。密码存在 macOS Keychain（service `adstudio-aliyun`, account `root`）作为 backup，`scripts/aliyun-ssh.sh` 包装了 expect-based 密码登录的 fallback。
  - 运行时：Node 22.22.1（原有）+ pnpm 11.1.2（corepack）+ PostgreSQL 18.4（PGDG apt repo）+ pgvector 0.8.2。
  - DB：建了独立 `adstudio` user + `ad_studio` DB，密码 32-hex 自动生成存 server `.env.local`。Migration applied，14 条 seed Meta-mock + Jina embeddings 全部同步到服务器，Phone Alarm 演示产品也在服务器 `my_products`。
  - 生产 server 跑在 `127.0.0.1:3010`（loopback only，外网不可达；要本机访问开 SSH tunnel：`ssh -L 3010:127.0.0.1:3010 -i ~/.ssh/id_ed25519 root@47.77.177.156`）。
  - 端到端语义检索在服务器验证通过，结果质量与本机一致。
  - 端口 3000 被服务器上另一个 next-server 占用，3010 是我们独享。

- **2026-05-20 (晚)**: 切到 Jina embeddings v3，跑通端到端语义检索。
  - 起因：Minimax embedding endpoint 当前 key plan 不带配额（status_code 1008 "insufficient balance"），chat M2.7 正常。Minimax 把 chat / embedding / TTS / image 拆成不同计费池。
  - 切到 Jina v3：1024 维（对齐 schema）、多语言、retrieval-friendly task taxonomy、免费 10M tokens/月，足够覆盖项目几年用量。
  - 新增 `src/lib/llm/embedding.ts`：统一 embed adapter，env `EMBED_PROVIDER=jina|minimax` 切换，dim 强一致校验。Minimax adapter 保留备用（充值后开关切回）。
  - 新增 `scripts/embed-backfill.ts`：扫 ads 表 LEFT JOIN ad_embeddings 取未嵌入的，批量调 Jina 入向量。已对 14 条 seed 跑完。
  - 改 `/api/my-products/match-ads`：从纯 ILIKE 升级为「语义检索优先 + 关键词兜底」。Path 1 调 Jina 拿 query 向量 → pgvector `<=>` cosine 距离 ORDER BY；Path 2 任何失败回到 ILIKE。返回新增 `mode`/`provider`/`model` 字段方便 debug，`relevanceScore` 从距离换算成 0-100。
  - 关键 bug 修复：`db.execute` 原生 SQL 返回的时间戳是 string（不是 Date），shapeAd 加 `toIsoOrNull` 兼容两种来源。这个 bug 一开始让所有语义检索都 silent fall-through 到 keyword 路径返回空 — 用 dev server 日志才看出来。
  - 新增 `lastMatchRunAt` 列（migration `0001_add_last_match_run_at.sql`）+ 删 `src/lib/mock-data/myProducts.ts` dead code。
  - 端到端验证：查询 "anti-theft alarm, phone security, device protection" 返回 PhoneGuard (89) / PhoneShield (86) / Pocket Theft (84) / VaultLock (75) / AlarmBox (75) ...，排序符合预期。
- **2026-05-20 (late)**: `my_products` 表实际接入。前端 `useMyProducts` hook 从 localStorage 改成全走 REST API：
  - 新增 `src/app/api/my-products/route.ts`（GET 列表 / POST 创建）和 `src/app/api/my-products/[id]/route.ts`（PATCH 更新 / DELETE 删除）。`createdBy` 硬编码 `'demo-user'`，等接入真 auth 后从 session 取。
  - `useMyProducts` 重写：初始化 `useEffect` 改成 GET API；`createProduct` 改 async + POST；`removeProduct` 改 optimistic delete；`schedulePipeline` 在 Minimax 解析成功后通过 `persistParseResult` PATCH 回 DB（fallback 解析的值不持久化）。
  - 新增 `scripts/seed-my-products.ts`：幂等地把 Phone Alarm 演示产品写入 DB。已经跑过一次，Phone Alarm 现在在 my_products 表里有真行。
  - 旧 localStorage 数据被 orphan（不再读），用户旧的测试产品如 `aaaa` 会消失。这是预期。
  - 已 typecheck / lint / next build / 端到端 CRUD curl 验证。



- **2026-05-20 (09:00)**: Sprint 1 (S1) 基本完成。本机后端 + 真 DB 链路 + 14 条 mock Meta seed 走通。
  - **S1-1 Postgres + pgvector 装好**：本机已有 PG 18.3。`brew install pgvector` 装 0.8.2，建 `ad_studio` 数据库，启用 `vector` 扩展。`DATABASE_URL=postgresql://climber_glc@localhost:5432/ad_studio` 写入 `.env.local`。
  - **S1-2 Drizzle schema**：`src/lib/db/schema.ts` 定义 4 张表（`ads / ad_embeddings / my_products / product_ad_matches`）+ 3 个 enum（`ad_source / ad_status / user_feedback`）。`ads.id` 用 `{source}-{sourceId}` 自然去重。embedding 1024-dim + HNSW + cosine 索引。
  - **S1-3 接进 Next.js**：`drizzle.config.ts`（dotenv 加载 `.env.local`）+ `src/lib/db/index.ts`（单例 Drizzle client 防 dev hot-reload 漏连接）+ `drizzle/0000_init.sql`（首版 migration）+ `scripts/db-smoke.ts`（insert / vector query / cleanup 全通）。
  - **S1-4 Minimax embedding adapter**：`src/lib/llm/minimaxEmbedding.ts` 写好。当前 key plan 在 embedding endpoint 返回 `1008 insufficient balance`，所有候选 model name（`embo-01 / embo-01-text / embo-large / minimax-embedding-01`）都被余额预检卡住，未确认正确 model name。Adapter graceful fallback 设计：失败返回 null，上游决定是否跳过 embedding 存储。**阻塞点 1**：等用户充值 Minimax 才能跑通。
  - **S1-5 DB query API + UI 接入**：`src/app/api/my-products/match-ads/route.ts` 走 V0 ILIKE 匹配（keyword 在 advertiser_name / creative_bodies / creative_titles 子串命中）。`MyProductScrapedAd` 加可选 `adData` 字段冗写 DB ads 关键字段。`useMyProducts.scheduleScrape` 抓取动画末端调 API；DB 有结果用 DB，空库降级回 `pickAdsForIndustry` mock pool。`MyProductsView` 双路径：`scraped.adData` 存在则渲染 DB-style 卡片（点击开 `snapshotUrl`），否则走 mock `topAdMap` 老路径（保留 seed Phone Alarm 演示完整性）。
  - **Bonus 1 MetaFetcher 骨架**：`src/lib/fetchers/metaFetcher.ts` + `src/lib/fetchers/types.ts` + `src/lib/db/upsertAd.ts`。`ingestMetaAds()` 已能调 Meta Graph API → 转换 → upsert，等 Identity Verification 通过即可触发。`upsertAd` 用 `onConflictDoUpdate` 实现幂等。
  - **Bonus 2 Seed 14 条 Meta-格式 mock**：`scripts/seed-meta-ads.ts`。覆盖防盗类（PhoneGuard / PhoneShield / AlarmBox Pro / Pocket Theft Sensor）+ 设备安全（VaultLock / FindMyDevice）+ 通用（VPN / Family Locator / RingGuard / Wallet Watch）+ 无关行业（咖啡 / 瑜伽 / 益智教育 / 消除游戏）做相关性反例对照。地区 DE/FR/IT/ES/NL/PL，跨语言，匹配真实 Meta API 字段结构。
  - **端到端真实跑通**：`POST /api/my-products/match-ads` body `{"keywords":["anti-theft","phone alarm","theft"]}` 现在返回 8 条真实 DB-backed 广告，按时间倒序，含 region flag、platform label、creative bodies、snapshot URL 等完整字段。"coffee + subscription" 反例返回 BlackForest Coffee（精确命中）+ FindMyDevice（"no subscription" 误命中，等 LLM rerank 修）+ Wallet Watch（同理）。
  - **stack 现状**：drizzle-orm 0.45.2 / drizzle-kit 0.31.10 / postgres 3.4.9 / dotenv 17.4.2 / tsx 4.22.2 全部装在 pnpm v11 store v11 下。`.npmrc` 钉死 store-dir v10 那次方案被放弃；改用 `CI=true pnpm install --frozen-lockfile` 整体迁移 node_modules 到 v11 store（23 秒完成，package.json + lockfile MD5 hash 验证不变）。`.npmrc` 留着但效果上是 noop（因为 pnpm 11 硬编码 `/v11` 后缀）。
- **2026-05-20 (02:00)**: Migrated Minimax integration from native `chatcompletion_v2` (OpenAI-style) to **Anthropic-compatible** `POST /anthropic/v1/messages`. New base URL: `https://api.minimaxi.com` (Minimax 国际域名，但本 key 仍可用)。原因：Anthropic 协议下 reasoning 和 visible text 自然分成两个 `content[]` block（`type: "thinking"` 和 `type: "text"`），解析逻辑比之前的 `reasoning_content`/`message.content` 字段拼装更干净；并且未来想换到真 Anthropic Claude API 直接换 key + base 就行。
  - `src/lib/llm/minimax.ts`: 重写。把 messages 里 role=system 的 entries 抽到顶层 `system` 字段（Anthropic 必需），response 解析改成 filter `type === "text"` 拼接，`thinking` block 收集到 `result.thinking`（debug 用）。新增 `inputTokens` / `outputTokens` 返回字段供后续日志/计费。
  - `.env.local` / `.env.example`：`MINIMAX_API_BASE` 改成 `https://api.minimaxi.com`。`MINIMAX_GROUP_ID` 保留变量但 Anthropic 协议下不需要。
  - 端到端测试：同一个 Google Play URL，cleanedPainPoints 这次还推出了"隐私泄露"维度（之前只到"被拿走"）。
- **2026-05-20 (01:20)**: Switched parse model to `MiniMax-M2.7` after user clarification.
  - The correct configured model on this key is `MiniMax-M2.7` (note the dot) on the **国内 `api.minimax.chat`** endpoint. The user's reference snippet pointed at `api.minimax.io` but that endpoint rejects this key with `2049: invalid api key` — the `.io` URL was just the doc template. `.chat` accepts both `MiniMax-M2` and `MiniMax-M2.7`; M2.7 is a true reasoning model (returns `reasoning_content` / `reasoning_details` blocks). Switched defaults: `.env.local` model = `MiniMax-M2.7`, `.env.example` updated, client default in `src/lib/llm/minimax.ts` = `MiniMax-M2.7`.
  - Bumped `max_tokens` defaults because M2.7 spends 500-3000 tokens on internal reasoning before emitting visible output. `minimax.ts` default `max_tokens` is now 4096 (was 1024); parse route now requests 4096 (was 600). Previous values caused empty content + `finish_reason: length`.
  - Quality observation: same input as 2026-05-20 (00:30) but on M2.7 → painPoints went from generic "公共场所" to specific "咖啡馆、图书馆等公共场所充电或使用手机时", which is exactly the kind of concrete scene info that helps downstream ad-library keyword scraping.
- **2026-05-20 (early)**: Connectivity validated + server-side product page fetcher landed.
  - `src/lib/llm/fetchProductPage.ts` (new): server-side product URL fetcher. Validates http(s) URL, sets a realistic desktop UA, 8s timeout via AbortController, follows redirects, rejects non-HTML content-types, caps response at 1.5MB, extracts `<title>` / `og:description` / `twitter:description` / `description` meta, strips scripts/styles/comments to a plain-text body capped at 8000 chars. Defines `ProductPageError` with structured codes (INVALID_URL / TIMEOUT / NETWORK / HTTP_ERROR / BAD_CONTENT_TYPE / TOO_LARGE / EMPTY) so the route can surface specific failures.
  - `src/app/api/my-products/parse/route.ts`: now fetches the user-supplied URL first (best-effort, non-fatal on failure), injects page title + meta description + truncated body text into the user prompt. Response shape gains `page` (when fetch succeeded) and `fetchError` (when it failed) so the client can show provenance later. On Google Play URL with only `name + url + productType` filled, Minimax now infers very specific painPoints ("咖啡馆 / 图书馆 等公共场所担心手机被偷或未经同意被触碰") and concrete keywords (`pickpocket security`, `motion detection alarm`) entirely from the scraped page.
- **2026-05-19 (evening)**: Replaced naive local keyword extraction in「我的产品爆款」parse phase with a real Minimax LLM call.
  - `src/lib/llm/minimax.ts`: small server-side client for Minimax v2 `chatcompletion_v2`. Reads config from `MINIMAX_API_KEY` / `MINIMAX_API_BASE` / `MINIMAX_MODEL` / `MINIMAX_GROUP_ID`. Distinguishes config errors / upstream errors / network errors. Includes `extractJsonObject` helper that strips ```json fences and extracts the first balanced `{...}` for resilient JSON parsing.
  - `src/app/api/my-products/parse/route.ts`: Next.js API route `POST /api/my-products/parse`. Validates input with zod, builds a Chinese system prompt instructing the model to return `{ industry, keywords[], cleanedIntro, cleanedPainPoints }`, validates output again with zod (industry must be one of the existing `TemplateIndustry` values), de-dupes keywords. Returns 502 on model-output drift, 500 on config, normal 200 otherwise. `runtime = "nodejs"` because fetch + env access.
  - `src/features/my-products/useMyProducts.ts`: `schedulePipeline` now calls `/api/my-products/parse` instead of a 1.6s setTimeout. Added `controllersRef` to track per-product `AbortController` so deleting / rescraping cancels the in-flight fetch. On API failure (no key / network / 5xx / schema drift) it falls back to the previous local `inferIndustryFromType + deriveKeywordsFromIntro` so the UI never hangs in `parsing`.
  - `.env.example` (new, committable): documents the four required env vars for new contributors.
  - **Local setup**: copy `.env.example` to `.env.local` and fill `MINIMAX_API_KEY` (+ optionally `MINIMAX_GROUP_ID`). The dev server must be restarted after editing `.env.local` for Next.js to pick the new values up. Default model is `m2.7`; override via `MINIMAX_MODEL` env var.
- **2026-05-19 (late)**: Polished the「我的产品爆款」Tab based on first browser review:
  - Bug fix in `useMyProducts.ts` `pickAdsForIndustry`: when the industry pool is smaller than the requested perPlatform total, the previous code cycled `pool[i % pool.length]` and produced visible duplicates (e.g., 6 cards = 3 unique ads × 2 platform labels each). Now dedupes properly and caps total at `min(pool.length, wanted)`, distributing platforms by remaining quota.
  - `src/lib/mock-data/topAds.ts`: added 3 new App-industry mock ads themed around anti-theft / device recovery / app-lock so the Phone Alarm seed has 6 unique, on-topic results (TikTok VN anti-theft, Meta ID FindMyDevice, Google BR App Lock Vault). Pool count comment updated to「App（6）」.
  - `src/lib/mock-data/myProducts.ts`: replaced the old `pickAds(industry, take, platforms)` helper with a quota-aware `pickAdsWithQuota` that mirrors the new pipeline distribution, so the Phone Alarm seed has 6 ads matching its 3+2+1 progress numbers.
  - `MyProductDraftModal`: added drag-drop image upload. A dashed drop zone sits below the image grid; supports click-to-pick or dragdrop, multiple files, image-only filter, 5MB per-file cap, dedupes by URL/data-URL, surfaces accepted/rejected hint. Files are read as base64 data URLs and stored in `images[]` (no backend yet). The「新增图片 URL」row is preserved as a secondary entry for hosted images.
- **2026-05-19**: Added a new third tab between AI 模板库 and 爆款广告库 called「我的产品爆款」.
  - `src/features/my-products/MyProductsView.tsx`: empty state + product rail + detail panel + progress board + scraped-ads grid.
  - `src/features/my-products/MyProductDraftModal.tsx`: URL Draft modal matching the design — name, type, intro, pain points, URL, image grid, "用于复刻广告" checkbox, save CTA.
  - `src/features/my-products/useMyProducts.ts`: localStorage-backed product list + mocked async pipeline (parsing → ready → scraping → done) using setTimeout. Real backend接入时只需替换 schedulePipeline 内部为 fetch + SSE。
  - `src/lib/mock-data/myProducts.ts`: 1 seed product ("Phone Alarm – Anti-Theft") in done state so the Tab has content on first load.
  - `src/lib/domain/schemas.ts`: added MyProduct / MyProductScrapeStatus / MyProductPlatformProgress / MyProductScrapedAd schemas and types.
  - `src/features/templates/TemplatesView.tsx`: added 3rd tab button, render `MyProductsView` when active.
  - `src/app/globals.css`: appended `myp-*` styles (rail/detail/progress card/ad card/skeleton/modal). All scoped under the `myp-` prefix.
- Added a template schema/product protocol document in `AD_STUDIO_TEMPLATE_SCHEMA.md`.
- Split the template/material concept into two paths:
  - AI template library: reusable prompt/script/slot templates that can directly prefill Ad Video or Ad Image.
  - Winning ad library: real ad examples with performance data that enter Agent replication, not direct prompt exposure.
- Added richer template and winning-ad types in `src/lib/domain/schemas.ts`.
- Expanded `src/lib/mock-data/templates.ts` with template categories, AI templates, editable script blocks, reference assets, winning ad filters, and winning ad data.
- Added `TemplateDetailModal.tsx` for AI template details, editable green slot fields, and "use template" flow.
- Refactored `TemplateDetailModal.tsx` right panel into a topview-style continuous creative document: title/verification, reference assets, single prose prompt with inline editable dashed-underlined slots, compact asset pills, and one bottom bar combining params plus "使用模板生成".
- Added `WinningAdCard.tsx` and `WinningAdDetailModal.tsx` for winning ad cards, performance metrics, objective breakdown preview, and replication prompt handoff.
- Updated `TemplatesView.tsx` with AI template library / winning ad library tabs.
- Updated `AdStudioApp.tsx` so AI templates can prefill generation state and winning ads can jump into Agent Workbench replication.
- Updated home/template entry points so templates open detail modals instead of applying immediately.
- Added visual styles for the template detail and winning ad UI in `src/app/globals.css`.
- Added `suppressHydrationWarning` on the root `<html>` in `src/app/layout.tsx` so Chrome extension-injected attributes do not block local verification with a Next hydration issue overlay.
- Added mock product-pack template slot values in `src/lib/mock-data/products.ts` and wired `TemplateDetailModal` so `source: "product_pack"` slots prefer current product data before falling back to template defaults.
- Added `CLAUDE.md` as the handoff entrypoint for a teammate using Claude Code.

## Important Behavior

- AI template card -> template detail modal -> "使用模板生成" -> Ad Video or Ad Image with prompt/model/ratio/duration/slots prefilled where supported.
- Winning ad card -> winning ad detail modal -> "在 Agent 中复刻" -> Agent Workbench clone session with the winning ad prompt carried in.
- 「我的产品爆款」Tab:
  - 空状态 -> 点击「＋ 添加第一个产品」打开 URL Draft 弹窗.
  - 弹窗保存 -> 产品立即入库 (status=`parsing`) -> 1.6s 后 -> `ready` -> 2.0s 后 -> `scraping` (TikTok 抓取中) -> 3.4s 后 -> TikTok done + Meta 抓取中 -> 4.6s -> Meta done + Google 抓取中 -> 5.8s -> 全部 done + 渲染个性化爆款卡片.
  - 抓取结果按产品类型映射到行业 (App/Ecommerce/Game/SaaS), 从现有 `topAds` mock 池里挑 6 条, 标上 platform / relevanceScore / matchedKeywords.
  - 「重新抓取」只跑抓取阶段（跳过 parsing），「删除」会清理 timers + 移除产品.
  - 产品列表通过 `localStorage` (`adstudio.myProducts.v1`) 持久化, 首次访问注入一个 done 状态的演示产品 (Phone Alarm – Anti-Theft).
- The current implementation is still local prototype/mock-data driven. There is no real backend, database, persistence, model adapter, or production API integration yet.

## Known Gaps

- **三个真实阻塞（每个独立、需用户解锁）**
  1. **Meta Identity Verification**：+86 手机收不到 FB 2FA SMS，账号 lockout。要换 FB 账号或者用国际手机号重启验证才能拿 Ad Library 数据。`META_APP_ID + META_APP_SECRET` 已存进 `.env.local`，App Token 调用 ads_archive 返回 `code 10 / subcode 2332004 App role required`，等身份验证才能放行。
  2. **Minimax embedding 余额**：Anthropic-compat 聊天接口能用，但 `/v1/embeddings` 报 `1008 insufficient balance`，所有 model name 都被余额预检拦截，正确 model name 未确认。需要充值后再测一遍 `embo-01 / embo-01-text / embo-large`，确认哪个能用 + dim 是否真是 1024。
  3. **阿里云硅谷 ECS**：用户还没开。生产环境必需，且 S2 起 TikTok / Google 自爬必须上海外服务器（避免国内 IP 被 ban）。本地 PG 数据等阿里云就绪后 `pg_dump | pg_restore` 一条命令迁过去。

- Product-pack-driven slot autofill now works for mock product slot keys, but there is still no real product URL parser or product-pack extraction pipeline.
- `requiredSlots` to generation-slot mapping is partial. The final prompt carries the edited script content, but only supported generation slot keys become generation form slots.
- Winning ad replication currently creates a mock Agent session and moves to Workbench; it does not yet create full canvas nodes for objective breakdown, clone strategy, script, storyboard, or final video.
- Template preview assets are local/static placeholders.
- 「我的产品爆款」still partially mocked:
  - Product URL parser **is now real** (Minimax v2 chat completion via `/api/my-products/parse`). With no `MINIMAX_API_KEY`, the hook silently falls back to the local naive extractor so the demo still works.
  - Product URL **is now fetched server-side** before parsing, so Minimax sees the real product page copy, not just user-typed fields. Failure cases (timeout / non-HTML / 4xx / large body) degrade gracefully back to user input.
  - HTML parsing is regex-based, so JS-rendered SPAs (most modern app store pages have a useful static portion via OG meta + ld+json, but the full content is JS-rendered) only yield title + meta + the static body. For deeper extraction (full feature lists, screenshots, reviews) need to swap in server-side Playwright. Acceptable for prototype.
  - No URL fetch cache yet — same URL fetched on every product create / rescrape. Add LRU before any pilot.
  - Scraping is mocked via `setTimeout`; no real TikTok / Meta / Google calls.
  - Scraped ads are picked from the existing `topAds` pool by industry, not from live data. Pool is intentionally small (Ecommerce 4 / App 6 / Game 2); other industries return a fallback set of any 3 ads.
  - `relevanceScore` is a manually generated 95→4 ramp, not a real similarity score.
  - Image upload is local-only: drag-drop reads files into base64 data URLs that get persisted in localStorage. A handful of large images can blow past the ~5MB localStorage quota. When the real backend lands, swap to S3/R2 upload and store hosted URLs.
  - No multi-user / multi-workspace separation — localStorage is per-browser.

## Verification Status

- `curl -I --max-time 10 http://127.0.0.1:3010` returned HTTP 200. A Next dev server was already listening on `127.0.0.1:3010`.
- `./node_modules/.bin/eslint .` passed.
- `./node_modules/.bin/tsc --noEmit` passed after build regenerated `.next/types`.
- `./node_modules/.bin/next build --webpack` passed.
- **2026-05-19 (my-products tab work)**: After adding the new 3rd tab, all of the following passed:
  - `./node_modules/.bin/eslint .` (clean — used eslint-disable + `useMemo` derivation to address `react-hooks/set-state-in-effect`)
  - `./node_modules/.bin/tsc --noEmit`
  - `./node_modules/.bin/next build --webpack`
  - `curl -I http://127.0.0.1:3010/` returned HTTP 200
  - Manual browser smoke check still pending (no Chrome MCP browser connected at the time of writing). To verify locally: open `http://127.0.0.1:3010`, navigate to `Templates`, click the middle "我的产品爆款" tab, see Phone Alarm seed product on first load; click ＋ 新增 to open URL Draft modal; submit -> watch parsing → ready → scraping → done with platform progress bars.
- After the product-pack slot autofill change, `./node_modules/.bin/eslint .`, `./node_modules/.bin/next build --webpack`, and then `./node_modules/.bin/tsc --noEmit` all passed again.
- After the continuous-document AI template modal refactor, `npx tsc --noEmit -p tsconfig.json` and `npx eslint src/features/templates/` passed.
- Browser check on `http://127.0.0.1:3010` passed for Templates -> AI 模板库 -> 电商零售 -> 商品演示 UGC: no script section blocks/head/prompt preview/tags/ghost button, inline editable slots render as lime dashed underline, asset slots render as compact blue pills, bottom params and primary button share one row, and ESC/X/backdrop all close the modal.
- Chrome local UI check passed:
  - Home template card opened `TemplateDetailModal`.
  - Editing a green slot updates the prompt carried into generation on submit.
  - "使用模板生成" landed in Ad Video with the edited prompt and product reference slot prefilled.
  - Templates -> 爆款广告库 opened `WinningAdDetailModal`.
  - "在 Agent 中复刻" opened Agent Workbench with winning-ad prompt context and focus choices.
- 2026-05-18 startup check: port `3010` was initially empty, `pnpm dev` triggered a pnpm prompt to remove and reinstall `node_modules`, so it was cancelled. Starting directly with `./node_modules/.bin/next dev --webpack --hostname 127.0.0.1 --port 3010` succeeded and `curl -I --max-time 10 http://127.0.0.1:3010` returned HTTP 200.
- 2026-05-19 startup check: port `3010` was initially empty. Starting directly with `./node_modules/.bin/next dev --webpack --hostname 127.0.0.1 --port 3010` succeeded; `node` is listening on `127.0.0.1:3010` and `curl -I --max-time 10 http://127.0.0.1:3010/` returned HTTP 200.
- `pnpm lint` and `pnpm dev` can trigger pnpm's `node_modules` purge/reinstall prompt; use direct binaries for local verification/startup unless the pnpm local state is fixed.

## Suggested Next Steps

**用户回来后能立即推的下一批（按依赖序）：**

A. **解 Meta SMS 卡点** → Identity Verification 通过 → 拿 Access Token → 直接调 `ingestMetaAds()` 把"anti-theft alarm" "phone security" 这种关键词的真 EU 市场广告灌进库（替换 / 共存 seed 数据）。当前所有代码已就位，只差 token。

B. **解 Minimax embedding 余额** → 重测确认 `embo-01` model name 能用 + dim 1024 没错（如果不是 1024，需要 schema migration）→ 写个 `embedAllAds` script 给 ads 表所有现有行算 embedding → `match-ads` route 加 cosine rerank 第二轮排序。

C. **TikTok 自爬 Playwright + 住宅代理**（S2 主线）：
   - 必须先有阿里云硅谷 ECS（裸 Playwright 走国内 IP 无法 reliably 访问 TikTok Creative Center）
   - 走代理：IPRoyal 住宅代理 $3/GB
   - 框架：复用项目里已经装的 playwright（tiktok-cc-recon 那边也是 playwright）
   - 第一个 target：TikTok Creative Center Top Ads 榜单按 industry × region 翻页

D. **把 seed Phone Alarm 演示从 mock 路径切到真 DB 路径**：
   - 一旦真 Meta 数据 + embedding rerank 上线，seed product 的 `scrapedAds` 可以从 `topAdMap` mock 数据切回 `adData` DB 数据
   - 顺手清掉 `myProductSeed` 里硬编码的 6 条 mock，让默认演示就是"刚抓的真广告"

1. Replace the mock `templateSlots` map with a real product URL/product-pack extraction pipeline.
2. Decide how winning ad replication should materialize canvas nodes in Workbench.
3. Consider mapping more template slot keys into generation form slots instead of carrying them only in the prompt.
4. Wire the「我的产品爆款」mock pipeline to a real backend:
   - ✅ Phase 1 parse: done via Minimax (see Recent Completed Work).
   - ✅ Server-side URL fetcher: done in `src/lib/llm/fetchProductPage.ts`.
   - Next: swap regex HTML stripping for Playwright on heavy SPA pages (Google Play, App Store, Amazon all hide most content behind JS). Add LRU cache + a robots.txt check before going to pilot.
   - Decide scraping strategy for TikTok Creative Center / Meta Ad Library / Google Ads Transparency. Options: (a) self-hosted Playwright + proxy pool, (b) third-party scraping APIs (Apify, ScrapingBee, ScrapingDog), (c) hybrid — pre-scrape popular industry buckets, filter per-product on demand.
   - Replace `setTimeout` scraping progress with SSE / WebSocket task status from the backend.
   - Decide persistence: SQLite/Postgres or just per-user JSON for the prototype-to-pilot phase.
5. Add image upload (drag-drop / file picker) to MyProductDraftModal — current modal only accepts public image URLs.
6. Add user feedback loop on scraped ads (✓ relevant / ✗ irrelevant) so the LLM rerank pipeline can learn user preferences over time.

## Commands

```bash
./node_modules/.bin/next dev --webpack --hostname 127.0.0.1 --port 3010
./node_modules/.bin/eslint .
pnpm build
```

Local dev server is configured in `package.json` for:

```text
http://127.0.0.1:3010
```

## Mobile Continuation Note

Avoid relying on very large historical Codex threads on phone. Keep this handoff updated and start a fresh lightweight Codex thread in the `adstudio` project when mobile loading becomes slow.
