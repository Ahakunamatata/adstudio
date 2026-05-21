import { NextResponse } from "next/server";
import { z } from "zod";
import {
  extractJsonObject,
  minimaxChatCompletion,
  MinimaxApiError,
  MinimaxConfigError
} from "@/lib/llm/minimax";
import { fetchProductPage, ProductPageError } from "@/lib/llm/fetchProductPage";
import { templateIndustrySchema } from "@/lib/domain/schemas";

// POST /api/my-products/parse
//
// Input  : { name, url?, intro?, painPoints?, productType? }
// Output : { industry, keywords[], cleanedIntro, cleanedPainPoints, raw }
//
// 让 LLM 把用户填的零散文本归一成结构化产品画像，供「我的产品爆款」Tab
// 自动派生抓取关键词。失败时由调用方降级到本地 naive 解析。

export const runtime = "nodejs";

const requestSchema = z.object({
  name: z.string().min(1).max(200),
  url: z.string().max(500).optional().default(""),
  intro: z.string().max(4000).optional().default(""),
  painPoints: z.string().max(2000).optional().default(""),
  productType: z.string().max(40).optional().default("")
});

const llmResponseSchema = z.object({
  industry: templateIndustrySchema,
  keywords: z.array(z.string().min(1).max(60)).min(1).max(10),
  searchQueries: z.array(z.string().min(2).max(80)).min(5).max(12),
  cleanedIntro: z.string().max(800).optional().default(""),
  cleanedPainPoints: z.string().max(600).optional().default("")
});

const SYSTEM_PROMPT = `你是一个广告投放策略分析师，专门为出海广告主做产品理解和爆款脚本归因。
用户会给你一个产品的零散信息：名字、URL、介绍、用户痛点、产品类型。
你的任务是把它归一成结构化的产品画像，供后续在 TikTok / Meta / Google 广告库里搜相关爆款使用。

规则：
1. industry 必须从下面这 10 个英文枚举值里选一个，最贴近的：
   ecommerce, food-beverage, health, app, game, finance, education, travel, saas, real-estate-auto
2. keywords：返回 5-8 个英文关键词或短词组。要满足：
   - 是搜索/检索友好的概念词（"anti-theft alarm", "loss prevention", "device security"）
   - 而不是产品名字本身或长句
   - 不要重复，全部小写
3. searchQueries：返回 5-10 个**用来去广告库搜索的实际查询词**。比 keywords 更具体、更贴近真实用户/竞品广告里会出现的词。要满足：
   - 每条 1-3 个词，最多 4 个词
   - 从不同角度切入：核心功能、使用场景、目标人群、问题表述、竞品类目
   - 避免完全包含 product_name（除非产品名本身是通用品类词）
   - 全部小写英文
   - 例如对"防盗手机报警 App"应该有：
     "anti-theft phone alarm", "phone pickpocket alert", "stolen phone protection",
     "loud phone alarm app", "phone security alarm", "lock screen alarm",
     "motion detection phone", "phone safety app"
4. cleanedIntro：用 1-2 句话重新表述产品介绍，去掉重复 / 营销噪音 / emoji。中文输出。
5. cleanedPainPoints：用 1-2 句话总结用户痛点。中文输出。

输出**仅** JSON，不要解释，不要 markdown。结构：
{
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
    lines.push("以下是从产品 URL 服务端抓取到的页面信息（可能含营销噪音，作为参考补充）：");
    if (page.finalUrl) lines.push(`最终 URL: ${page.finalUrl}`);
    if (page.title) lines.push(`页面标题: ${page.title}`);
    if (page.description) lines.push(`页面 meta 描述: ${page.description}`);
    if (page.bodyText) {
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

  // Best-effort: pull HTML from the product URL so the model sees real product copy.
  // Any fetch failure is non-fatal — fall through to user-only prompt.
  let fetchedPage: FetchedPage | null = null;
  let fetchError: { code: string; message: string } | null = null;
  if (parsed.data.url) {
    try {
      const page = await fetchProductPage(parsed.data.url, { timeoutMs: 8000 });
      fetchedPage = {
        title: page.title,
        description: page.description,
        bodyText: page.bodyText,
        finalUrl: page.finalUrl
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

    return NextResponse.json({
      industry: validated.data.industry,
      keywords,
      searchQueries,
      cleanedIntro: validated.data.cleanedIntro,
      cleanedPainPoints: validated.data.cleanedPainPoints,
      page: fetchedPage
        ? {
            finalUrl: fetchedPage.finalUrl,
            title: fetchedPage.title,
            description: fetchedPage.description,
            bodyTextChars: fetchedPage.bodyText.length
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
