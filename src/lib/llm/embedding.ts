// 统一 embedding 入口。
//
// 选 provider 的优先级：
//   1. EMBED_PROVIDER 环境变量（"jina" / "minimax"）
//   2. 默认 "jina"（因为 Minimax 当前 key plan 不带 embedding 配额，1008）
//
// 接口同一，调用方不需要知道底下用的谁。换 provider 改 env 即可。
//
// 维度强约束 1024 —— 跟 schema `vector(1024)` 列对齐，换维度需要 migration。

import {
  minimaxEmbed,
  EMBEDDING_DIM as MINIMAX_DIM
} from "./minimaxEmbedding";

export const EMBEDDING_DIM = 1024;

if (MINIMAX_DIM !== EMBEDDING_DIM) {
  // 双向 sanity check —— 两个 provider 的 dim 必须对齐
  throw new Error(
    `Embedding dim drift: minimax=${MINIMAX_DIM}, expected=${EMBEDDING_DIM}`
  );
}

export type EmbeddingType = "db" | "query";

export type EmbedResult =
  | { ok: true; vectors: number[][]; provider: string; model: string }
  | { ok: false; reason: string; provider: string; statusCode?: number };

type JinaResponse = {
  model?: string;
  data?: Array<{ embedding: number[]; index: number }>;
  usage?: { total_tokens?: number; prompt_tokens?: number };
  detail?: string; // jina 错误字段
};

function getProvider(): "jina" | "minimax" {
  const value = process.env.EMBED_PROVIDER?.trim().toLowerCase();
  if (value === "minimax") return "minimax";
  return "jina";
}

async function embedViaJina(
  texts: string[],
  type: EmbeddingType,
  signal?: AbortSignal
): Promise<EmbedResult> {
  const apiKey = process.env.JINA_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, reason: "JINA_API_KEY not set", provider: "jina" };
  }
  const model =
    process.env.JINA_EMBED_MODEL?.trim() || "jina-embeddings-v3";

  // Jina v3 用 task 区分检索的 corpus vs query 端
  const task = type === "query" ? "retrieval.query" : "retrieval.passage";

  let response: Response;
  try {
    response = await fetch("https://api.jina.ai/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        task,
        dimensions: EMBEDDING_DIM,
        input: texts
      }),
      signal
    });
  } catch (error) {
    return {
      ok: false,
      reason: `network: ${error instanceof Error ? error.message : String(error)}`,
      provider: "jina"
    };
  }

  let payload: JinaResponse | null = null;
  try {
    payload = (await response.json()) as JinaResponse;
  } catch (error) {
    return {
      ok: false,
      reason: `non-JSON response: ${error instanceof Error ? error.message : String(error)}`,
      provider: "jina",
      statusCode: response.status
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: `http ${response.status}: ${payload?.detail ?? JSON.stringify(payload).slice(0, 200)}`,
      provider: "jina",
      statusCode: response.status
    };
  }

  const data = payload?.data ?? [];
  if (data.length !== texts.length) {
    return {
      ok: false,
      reason: `expected ${texts.length} vectors, got ${data.length}`,
      provider: "jina"
    };
  }

  // 顺序保证：Jina data[].index 应等于输入数组顺序，但为安全起见 sort 一下
  data.sort((a, b) => a.index - b.index);
  const vectors = data.map((d) => d.embedding);

  const wrong = vectors.find((v) => v.length !== EMBEDDING_DIM);
  if (wrong) {
    return {
      ok: false,
      reason: `dim mismatch: expected ${EMBEDDING_DIM}, got ${wrong.length}`,
      provider: "jina"
    };
  }
  return { ok: true, vectors, provider: "jina", model };
}

async function embedViaMinimax(
  texts: string[],
  type: EmbeddingType,
  signal?: AbortSignal
): Promise<EmbedResult> {
  const result = await minimaxEmbed(texts, type, signal);
  if (result.ok) {
    return {
      ok: true,
      vectors: result.vectors,
      provider: "minimax",
      model: process.env.MINIMAX_EMBED_MODEL?.trim() || "embo-01"
    };
  }
  return {
    ok: false,
    reason: result.reason,
    provider: "minimax",
    statusCode: result.statusCode
  };
}

export async function embed(
  texts: string[],
  type: EmbeddingType = "db",
  signal?: AbortSignal
): Promise<EmbedResult> {
  if (texts.length === 0) {
    return { ok: true, vectors: [], provider: getProvider(), model: "" };
  }
  const provider = getProvider();
  if (provider === "jina") {
    return embedViaJina(texts, type, signal);
  }
  return embedViaMinimax(texts, type, signal);
}

export async function embedOneOrNull(
  text: string,
  type: EmbeddingType = "db",
  signal?: AbortSignal
): Promise<number[] | null> {
  const result = await embed([text], type, signal);
  if (!result.ok) {
    console.warn(`[embed:${result.provider}] skipped:`, result.reason);
    return null;
  }
  return result.vectors[0] ?? null;
}

// 拿到 provider/model 元数据，存进 ad_embeddings.model 列时用
export function describeProvider(): string {
  const provider = getProvider();
  if (provider === "jina") {
    return process.env.JINA_EMBED_MODEL?.trim() || "jina-embeddings-v3";
  }
  return process.env.MINIMAX_EMBED_MODEL?.trim() || "embo-01";
}
