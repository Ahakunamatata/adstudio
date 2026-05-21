// Minimax embedding client.
//
// Endpoint: POST `${MINIMAX_API_BASE}/v1/embeddings`
//
// 现状（2026-05-20）：当前 key plan 对 embedding endpoint 返回 1008
// "insufficient balance"。具体哪些模型名能用未确认。所以本文件设计上：
//   - 调用失败时 *返回 null*，不抛异常，让上游决定降级策略（通常是跳过
//     存 embedding，仅存 ads 主表）
//   - 不在模块加载时检查 key 余额；按需调用
//
// 余额充值 / 切到别家 embedding provider 后:
//   1. 调整 EMBEDDING_DIM 常量
//   2. 调整 ad_embeddings.embedding 列维度（migration）
//   3. minimaxEmbed() 的返回值改为非 null 即可

export const EMBEDDING_DIM = 1024; // schema 当前固定值，换 provider 时必须同步
export const EMBEDDING_MODEL = process.env.MINIMAX_EMBED_MODEL?.trim() || "embo-01";

export type EmbeddingType = "db" | "query";

type MinimaxEmbedResponse = {
  vectors?: number[][];
  base_resp?: { status_code?: number; status_msg?: string };
};

export type EmbedResult =
  | { ok: true; vectors: number[][] }
  | { ok: false; reason: string; statusCode?: number };

export async function minimaxEmbed(
  texts: string[],
  type: EmbeddingType = "db",
  signal?: AbortSignal
): Promise<EmbedResult> {
  if (texts.length === 0) return { ok: true, vectors: [] };

  const apiKey = process.env.MINIMAX_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, reason: "MINIMAX_API_KEY not set" };
  }
  const base = (
    process.env.MINIMAX_API_BASE?.trim() || "https://api.minimaxi.com"
  ).replace(/\/$/, "");

  let httpResp: Response;
  try {
    httpResp = await fetch(`${base}/v1/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        texts,
        type
      }),
      signal
    });
  } catch (error) {
    return {
      ok: false,
      reason: `network: ${error instanceof Error ? error.message : String(error)}`
    };
  }

  let payload: MinimaxEmbedResponse | null = null;
  try {
    payload = (await httpResp.json()) as MinimaxEmbedResponse;
  } catch (error) {
    return {
      ok: false,
      reason: `non-JSON response: ${error instanceof Error ? error.message : String(error)}`,
      statusCode: httpResp.status
    };
  }

  if (!httpResp.ok) {
    return {
      ok: false,
      reason: `http ${httpResp.status}: ${JSON.stringify(payload).slice(0, 200)}`,
      statusCode: httpResp.status
    };
  }

  const base_resp = payload.base_resp;
  if (base_resp && base_resp.status_code && base_resp.status_code !== 0) {
    return {
      ok: false,
      reason: `minimax ${base_resp.status_code}: ${base_resp.status_msg ?? "unknown"}`,
      statusCode: base_resp.status_code
    };
  }

  const vectors = payload.vectors ?? [];
  if (vectors.length !== texts.length) {
    return {
      ok: false,
      reason: `expected ${texts.length} vectors, got ${vectors.length}`
    };
  }
  // sanity: dim check
  const wrong = vectors.find((v) => v.length !== EMBEDDING_DIM);
  if (wrong) {
    return {
      ok: false,
      reason: `dim mismatch: expected ${EMBEDDING_DIM}, got ${wrong.length}. Update EMBEDDING_DIM + schema migration.`
    };
  }
  return { ok: true, vectors };
}

// 便利函数：单条文本 → 单条向量（失败返回 null）
export async function embedOneOrNull(
  text: string,
  type: EmbeddingType = "db",
  signal?: AbortSignal
): Promise<number[] | null> {
  const result = await minimaxEmbed([text], type, signal);
  if (!result.ok) {
    console.warn("[minimaxEmbed] skipped:", result.reason);
    return null;
  }
  return result.vectors[0] ?? null;
}
