import { NextResponse } from "next/server";
import { z } from "zod";
import {
  extractJsonObject,
  minimaxChatCompletion,
  MinimaxApiError,
  MinimaxConfigError
} from "@/lib/llm/minimax";
import { fetchProductPage, ProductPageError } from "@/lib/llm/fetchProductPage";
import { canonicalizeProductUrl } from "@/lib/url/canonicalize";
import { templateIndustrySchema } from "@/lib/domain/schemas";

// POST /api/my-products/parse
//
// Input  : { name, url?, intro?, painPoints?, productType? }
// Output : { industry, keywords[], cleanedIntro, cleanedPainPoints, raw }
//
// 让 LLM 把用户填的零散文本归一成结构化产品画像，供「我的产品爆款」Tab
// 自动派生抓取关键词。失败时由调用方降级到本地 naive 解析。

export const runtime = "nodejs";

// name 改成可选 —— 支持「贴 URL 一键解析」模式（用户只给 URL，name 由 AI 推断）。
// 至少 name / url 之一必须有，下面手动校验。
const requestSchema = z.object({
  name: z.string().max(200).optional().default(""),
  // Amazon 这种 URL 经常 600+ 字符（含 dib token / sr / ref / tracking 参数），
  // 给 2000 上限留足空间，比 IDN punycode / signed URLs 还宽松。
  url: z.string().max(2000).optional().default(""),
  intro: z.string().max(4000).optional().default(""),
  painPoints: z.string().max(2000).optional().default(""),
  productType: z.string().max(40).optional().default("")
});

const llmResponseSchema = z.object({
  // URL-first 模式 LLM 推断的产品名（如果用户没填）。一般是从页面 title /
  // og:title / 正文里第一个 brand 词推断。
  productName: z.string().max(120).optional().default(""),
  // App / Ecommerce / Game / SaaS / Other —— 跟 myProductTypeSchema 对齐
  productType: z.enum(["App", "Ecommerce", "Game", "SaaS", "Other"]).optional(),
  industry: templateIndustrySchema,
  keywords: z.array(z.string().min(1).max(60)).min(1).max(10),
  searchQueries: z.array(z.string().min(2).max(80)).min(5).max(12),
  cleanedIntro: z.string().max(800).optional().default(""),
  cleanedPainPoints: z.string().max(600).optional().default("")
});

const SYSTEM_PROMPT = `你是一个广告投放策略分析师，专门为出海广告主做产品理解和爆款脚本归因。
用户会给你一个产品的零散信息：名字、URL、介绍、用户痛点、产品类型。
**当用户只给了 URL 时（name/intro/painPoints 为空）**，你要根据 URL 拉到的页面信息**自己推断**产品名、产品类型、介绍、痛点。
你的任务是把零散信息归一成结构化的产品画像，供后续在 TikTok / Meta / Google 广告库里搜相关爆款使用。

规则：
1. productName：
   - 用户已经填了 → 直接复用（不要改）
   - 用户没填 → 从页面 title / og:title / 品牌词 中提炼一个干净的产品名（去掉 "- App Store" / "| Official Site" 这种尾缀）
2. productType 必须从下面 5 个英文枚举里选一个：
   - "App"（手机 App，含 iOS/Android/小程序）
   - "Ecommerce"（独立站 / 电商商品 / Amazon listing / Shopify 等）
   - "Game"（手游 / 端游 / Web game）
   - "SaaS"（B2B / B2C 在线工具 / 订阅服务）
   - "Other"（其他无法归类）
   优先级：用户填的 > 页面里能看出的（如域名含 .app / play.google.com → App；含 amazon / shopify → Ecommerce）
3. industry 必须从下面 10 个英文枚举里选一个：
   ecommerce, food-beverage, health, app, game, finance, education, travel, saas, real-estate-auto
4. keywords：5-8 个英文关键词或短词组：
   - 搜索/检索友好的概念词（"anti-theft alarm", "loss prevention"）
   - 不是产品名本身或长句
   - 全部小写，不重复
5. searchQueries：5-10 个**用来去广告库搜索的实际查询词**：
   - 每条 1-3 个词，最多 4 个词
   - 从不同角度：核心功能、使用场景、目标人群、问题表述、竞品类目
   - 避免完全包含 product_name（除非产品名本身是通用品类词）
   - 全部小写英文
6. cleanedIntro：1-2 句话产品介绍，**中文**输出，去掉营销噪音 / emoji。
7. cleanedPainPoints：1-2 句话总结用户痛点，**中文**输出。
   - 如果用户没填且页面里看不出，自己根据产品类型合理推断。

输出**仅** JSON，不要解释，不要 markdown。结构：
{
  "productName": "...",
  "productType": "App|Ecommerce|Game|SaaS|Other",
  "industry": "...",
  "keywords": ["...", "..."],
  "searchQueries": ["...", "...", "..."],
  "cleanedIntro": "...",
  "cleanedPainPoints": "..."
}`;

type FetchedPage = {
  title: string;
  description: string;
  bodyText: string;
  finalUrl: string;
  mainImageUrl: string | null;
  looksLikeAntibot: boolean;
};

function buildUserPrompt(input: z.infer<typeof requestSchema>, page: FetchedPage | null): string {
  const lines: string[] = ["以下是用户输入："];
  lines.push(`产品名称: ${input.name}`);
  if (input.productType) lines.push(`产品类型: ${input.productType}`);
  if (input.url) lines.push(`产品 URL: ${input.url}`);
  if (input.intro) lines.push(`产品介绍: ${input.intro}`);
  if (input.painPoints) lines.push(`用户痛点: ${input.painPoints}`);

  if (page) {
    lines.push("");
    if (page.looksLikeAntibot) {
      // 反爬墙：抓回来的是 Robot Check / Continue Shopping 类壳页面，**别**当真产品页用
      lines.push("⚠️ 注意：该 URL 服务端抓回来的是反爬墙/空壳页面，下面的页面信息是无效占位，不要直接当作产品介绍来使用。");
      lines.push("请结合 URL 域名 + path 中可识别的关键词 + 产品名(若用户填了) 推断产品。");
      lines.push("特别地：");
      lines.push("- amazon.com / shopify / etsy → productType=Ecommerce, industry=ecommerce");
      lines.push("- apps.apple.com / play.google.com → productType=App，industry 看具体名字推断");
      lines.push("- 如果 URL path 只是 SKU/ID（看不出产品语义），且用户没填 name → productName 留空，cleanedIntro 写'未能解析到具体产品信息，建议补充产品名称'");
    } else {
      lines.push("以下是从产品 URL 服务端抓取到的页面信息（可能含营销噪音，作为参考补充）：");
    }
    if (page.finalUrl) lines.push(`最终 URL: ${page.finalUrl}`);
    if (page.title) lines.push(`页面标题: ${page.title}`);
    if (page.description) lines.push(`页面 meta 描述: ${page.description}`);
    if (page.bodyText && !page.looksLikeAntibot) {
      lines.push(`页面正文摘要（已截断到约 3000 字）:`);
      lines.push(page.bodyText.slice(0, 3000));
    }
  }
  return lines.join("\n");
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request shape", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  // 至少要给 name 或 url 之一，否则 LLM 没东西可解析
  if (!parsed.data.name && !parsed.data.url) {
    return NextResponse.json(
      { error: "Either name or url must be provided" },
      { status: 400 }
    );
  }

  // URL canonicalize：剥 utm_* / fbclid / Amazon dib token 等，平台特定保留核心 path
  // （Amazon /dp/SKU / Shopify /products/handle / Apple /app/id / Google Play ?id=）
  // 用户能贴任何 URL，这里统一清理。downstream fetch 和 DB 存的都是 canonical。
  if (parsed.data.url) {
    const canonical = canonicalizeProductUrl(parsed.data.url);
    if (canonical && canonical !== parsed.data.url) {
      console.log(`[parse] canonicalized URL:\n  in:  ${parsed.data.url}\n  out: ${canonical}`);
      parsed.data.url = canonical;
    }
  }

  // Best-effort: pull HTML from the product URL so the model sees real product copy.
  // Any fetch failure is non-fatal — fall through to user-only prompt.
  let fetchedPage: FetchedPage | null = null;
  let fetchError: { code: string; message: string } | null = null;
  if (parsed.data.url) {
    try {
      // 25s 给 Playwright fallback 留时间（chromium 启动 + page load + 渲染等 5-15s）
      const page = await fetchProductPage(parsed.data.url, { timeoutMs: 25_000 });
      fetchedPage = {
        title: page.title,
        description: page.description,
        bodyText: page.bodyText,
        finalUrl: page.finalUrl,
        mainImageUrl: page.mainImageUrl,
        looksLikeAntibot: page.looksLikeAntibot
      };
    } catch (error) {
      if (error instanceof ProductPageError) {
        fetchError = { code: error.code, message: error.message };
      } else {
        fetchError = {
          code: "UNKNOWN",
          message: error instanceof Error ? error.message : String(error)
        };
      }
      console.warn("[my-products/parse] fetchProductPage failed:", fetchError);
    }
  }

  try {
    const completion = await minimaxChatCompletion({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(parsed.data, fetchedPage) }
      ],
      temperature: 0.2,
      // 4096 gives M2.7 room for reasoning (~700-3000 tokens) + the JSON output (~500 tokens).
      maxTokens: 4096,
      responseFormat: "json"
    });

    const json = extractJsonObject<unknown>(completion.content);
    if (!json) {
      return NextResponse.json(
        { error: "Model did not return valid JSON", raw: completion.content },
        { status: 502 }
      );
    }

    const validated = llmResponseSchema.safeParse(json);
    if (!validated.success) {
      return NextResponse.json(
        {
          error: "Model output failed schema validation",
          details: validated.error.flatten(),
          raw: json
        },
        { status: 502 }
      );
    }

    // Dedupe + normalize keywords just in case the model returned dupes.
    const seen = new Set<string>();
    const keywords: string[] = [];
    for (const keyword of validated.data.keywords) {
      const norm = keyword.trim().toLowerCase();
      if (!norm) continue;
      if (seen.has(norm)) continue;
      seen.add(norm);
      keywords.push(norm);
    }

    // 同一逻辑去重 searchQueries
    const seenQueries = new Set<string>();
    const searchQueries: string[] = [];
    for (const q of validated.data.searchQueries) {
      const norm = q.trim().toLowerCase();
      if (!norm) continue;
      if (seenQueries.has(norm)) continue;
      seenQueries.add(norm);
      searchQueries.push(norm);
    }

    // 推断的产品名/类型：用户已经填了就保留用户输入（不要把空字符串当成"没填"，
    // 用户的不填等于空 → LLM 推断的优先）。
    const productName =
      (parsed.data.name?.trim() || "") || (validated.data.productName?.trim() || "");
    const productType =
      (parsed.data.productType?.trim() || "") || (validated.data.productType || "Other");

    return NextResponse.json({
      productName,
      productType,
      industry: validated.data.industry,
      keywords,
      searchQueries,
      cleanedIntro: validated.data.cleanedIntro,
      cleanedPainPoints: validated.data.cleanedPainPoints,
      mainImageUrl: fetchedPage?.mainImageUrl ?? null,
      // canonical URL：前端拿这个回填 input，让用户看到干净的 URL（不是脏字符串）
      canonicalUrl: parsed.data.url || null,
      // 前端用这个标记来 show "网站反爬，请补充产品名" 提示
      pageBlockedByAntibot: fetchedPage?.looksLikeAntibot ?? false,
      page: fetchedPage
        ? {
            finalUrl: fetchedPage.finalUrl,
            title: fetchedPage.title,
            description: fetchedPage.description,
            bodyTextChars: fetchedPage.bodyText.length,
            mainImageUrl: fetchedPage.mainImageUrl,
            looksLikeAntibot: fetchedPage.looksLikeAntibot
          }
        : null,
      fetchError
    });
  } catch (error) {
    if (error instanceof MinimaxConfigError) {
      return NextResponse.json(
        { error: "Minimax not configured", message: error.message },
        { status: 500 }
      );
    }
    if (error instanceof MinimaxApiError) {
      return NextResponse.json(
        { error: "Minimax upstream error", status: error.status, message: error.message },
        { status: 502 }
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "Unexpected error", message }, { status: 500 });
  }
}
