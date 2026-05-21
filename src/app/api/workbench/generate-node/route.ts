import { NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  extractJsonObject,
  minimaxChatCompletion,
  MinimaxApiError,
  MinimaxConfigError
} from "@/lib/llm/minimax";
import {
  buildUserPrompt,
  getNodeConfig,
  PARENT_CHAIN,
  workbenchBusinessTypeSchema,
  type WorkbenchBusinessType,
  type ParentArtifact
} from "@/lib/llm/workbench-prompts";

// POST /api/workbench/generate-node
//
// 输入：
//   { sessionId, nodeId, businessType, cloneSource, parentNodeIds[] }
//
// 流程：
//   1. 校验 businessType
//   2. 检查上游 PARENT_CHAIN[type] 是否已经在 DB 有 artifact（若链路不是 objective_breakdown 起点）
//   3. 从 DB 读上游 artifact 的 content（按 createdAt DESC 取最新）
//   4. 用 system prompt + user prompt 调 Minimax M2.7
//   5. extractJsonObject + Zod schema 校验
//   6. 入 workbench_node_artifacts 表
//   7. 返回 { ok, artifactId, content }

export const runtime = "nodejs";
export const maxDuration = 60; // M2.7 推理需要 token，给宽松超时

const requestSchema = z.object({
  sessionId: z.string().min(1).max(200),
  nodeId: z.string().min(1).max(200),
  businessType: workbenchBusinessTypeSchema,
  cloneSource: z.object({
    topAdId: z.string(),
    topAdTitle: z.string(),
    topAdBrand: z.string(),
    topAdRegion: z.string(),
    topAdPlatform: z.string(),
    topAdDurationSec: z.number(),
    topAdInsights: z.array(
      z.object({ label: z.string(), category: z.string() })
    ),
    myProductName: z.string().optional()
  })
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid request shape", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { sessionId, nodeId, businessType, cloneSource } = parsed.data;
  const config = getNodeConfig(businessType);

  // 拉所有上游已生成的 artifacts（链式：objective→clone→script→storyboard→final）
  // 为了让模型有完整上下文，我们传整条链路上的所有上游 artifact，不只直接父节点
  const upstreamTypes = collectUpstreamTypes(businessType);
  const parentArtifacts: ParentArtifact[] = [];
  if (upstreamTypes.length > 0) {
    try {
      const rows = await db
        .select({
          businessType: schema.workbenchNodeArtifacts.businessType,
          content: schema.workbenchNodeArtifacts.content,
          createdAt: schema.workbenchNodeArtifacts.createdAt
        })
        .from(schema.workbenchNodeArtifacts)
        .where(
          and(
            eq(schema.workbenchNodeArtifacts.sessionId, sessionId),
            inArray(schema.workbenchNodeArtifacts.businessType, upstreamTypes)
          )
        )
        .orderBy(desc(schema.workbenchNodeArtifacts.createdAt));

      // 每个 businessType 只保留最新的一条
      const latestByType = new Map<WorkbenchBusinessType, unknown>();
      for (const row of rows) {
        if (!latestByType.has(row.businessType as WorkbenchBusinessType)) {
          latestByType.set(row.businessType as WorkbenchBusinessType, row.content);
        }
      }
      // 按链路顺序排列（objective_breakdown 在前，clone_strategy 次之...）
      for (const type of upstreamTypes) {
        const content = latestByType.get(type);
        if (content !== undefined) {
          parentArtifacts.push({ businessType: type, content });
        }
      }
    } catch (error) {
      console.warn("[generate-node] read upstream artifacts failed:", error);
      // 上游读取失败不阻塞 — 仍然让 LLM 试着只基于 sourceAd 生成（次优但不死）
    }

    // 强约束：直接父节点必须存在（除非是链路起点 objective_breakdown）
    const directParent = PARENT_CHAIN[businessType];
    if (directParent && !parentArtifacts.find((p) => p.businessType === directParent)) {
      return NextResponse.json(
        {
          ok: false,
          error: "missing_upstream",
          message: `生成 ${businessType} 之前必须先生成 ${directParent}`
        },
        { status: 412 }
      );
    }
  }

  const userPrompt = buildUserPrompt(businessType, cloneSource, parentArtifacts);

  let completion;
  try {
    completion = await minimaxChatCompletion({
      messages: [
        { role: "system", content: config.systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.4,
      // M2.7 推理模型，thinking + JSON 输出加起来给 8192 才够 5-node prompt 的复杂度
      maxTokens: 8192,
      responseFormat: "json"
    });
  } catch (error) {
    if (error instanceof MinimaxConfigError) {
      return NextResponse.json(
        { ok: false, error: "minimax_not_configured", message: error.message },
        { status: 500 }
      );
    }
    if (error instanceof MinimaxApiError) {
      return NextResponse.json(
        {
          ok: false,
          error: "minimax_upstream",
          message: error.message,
          statusCode: error.status
        },
        { status: 502 }
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: "unexpected",
        message: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }

  const rawText = completion.content;
  const parsedJson = extractJsonObject(rawText);
  if (!parsedJson) {
    return NextResponse.json(
      {
        ok: false,
        error: "invalid_json",
        message: "Model did not return valid JSON",
        raw: rawText.slice(0, 400)
      },
      { status: 502 }
    );
  }

  const validated = config.schema.safeParse(parsedJson);
  if (!validated.success) {
    return NextResponse.json(
      {
        ok: false,
        error: "schema_validation",
        message: "Model output failed schema validation",
        details: validated.error.flatten(),
        raw: parsedJson
      },
      { status: 502 }
    );
  }

  let artifactId: string;
  try {
    const [row] = await db
      .insert(schema.workbenchNodeArtifacts)
      .values({
        sessionId,
        nodeId,
        businessType,
        content: validated.data as object,
        rawText,
        model: "MiniMax-M2.7",
        inputTokens: completion.inputTokens ?? null,
        outputTokens: completion.outputTokens ?? null
      })
      .returning({ id: schema.workbenchNodeArtifacts.id });
    artifactId = row.id;
  } catch (error) {
    console.error("[generate-node] DB insert failed:", error);
    return NextResponse.json(
      {
        ok: false,
        error: "db_insert_failed",
        message: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    artifactId,
    businessType,
    content: validated.data,
    usage: {
      inputTokens: completion.inputTokens,
      outputTokens: completion.outputTokens
    }
  });
}

// 链路：objective_breakdown → clone_strategy → ad_script → storyboard_frame → final_video
// 给定一个 type，返回它之前的所有 type（按链路顺序）
function collectUpstreamTypes(type: WorkbenchBusinessType): WorkbenchBusinessType[] {
  const upstream: WorkbenchBusinessType[] = [];
  let current = PARENT_CHAIN[type];
  while (current) {
    upstream.unshift(current); // 加到前面，保持链路顺序
    current = PARENT_CHAIN[current];
  }
  return upstream;
}
