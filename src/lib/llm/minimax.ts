// Minimax client — Anthropic-compatible protocol.
//
// Endpoint: `${MINIMAX_API_BASE}/anthropic/v1/messages`
//   - 默认 base = https://api.minimaxi.com
//   - 请求/响应完全是 Claude (Anthropic) Messages API 格式。
//
// 为什么用 Anthropic 协议而不是 Minimax 原生 chatcompletion_v2：
//   1. content[] 数组里 reasoning 和 text 自然分块（type: "thinking" vs "text"），
//      parse 时只挑 text 就行，不用关心模型内部推理。
//   2. 标准 Claude 格式，未来想换到真 Anthropic Claude API 直接换 URL + key。
//   3. response 里 base_resp.status_code 仍保留，Minimax 业务错误能识别。

export type MinimaxMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type MinimaxCompletionOptions = {
  messages: MinimaxMessage[];
  temperature?: number;
  maxTokens?: number;
  // responseFormat 保留参数兼容旧调用，但 Anthropic 协议没有 json_object 模式；
  // 让调用方在 system prompt 里要求 JSON 输出即可，extractJsonObject 已能脱 ```json 壳。
  responseFormat?: "text" | "json";
  signal?: AbortSignal;
};

export type MinimaxCompletionResult = {
  content: string;
  raw: unknown;
  thinking: string;
  inputTokens?: number;
  outputTokens?: number;
};

export class MinimaxConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MinimaxConfigError";
  }
}

export class MinimaxApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public payload: unknown
  ) {
    super(message);
    this.name = "MinimaxApiError";
  }
}

function getConfig() {
  const apiKey = process.env.MINIMAX_API_KEY?.trim();
  if (!apiKey) {
    throw new MinimaxConfigError(
      "MINIMAX_API_KEY is not set. Copy .env.example to .env.local and fill it in."
    );
  }
  const base = (process.env.MINIMAX_API_BASE?.trim() || "https://api.minimaxi.com").replace(/\/$/, "");
  const model = process.env.MINIMAX_MODEL?.trim() || "MiniMax-M2.7";
  return { apiKey, base, model };
}

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string; signature?: string }
  | { type: string; [key: string]: unknown };

type AnthropicResponse = {
  content?: AnthropicContentBlock[];
  stop_reason?: string;
  model?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  // Minimax 在 Anthropic 兼容层仍会塞这个；real Anthropic 没有
  base_resp?: { status_code?: number; status_msg?: string };
};

export async function minimaxChatCompletion(
  options: MinimaxCompletionOptions
): Promise<MinimaxCompletionResult> {
  const { apiKey, base, model } = getConfig();

  // Anthropic 协议：system 是顶层字段，不在 messages 里。把 messages 里的 role:system 合并出来。
  const systemParts: string[] = [];
  const dialogMessages: { role: "user" | "assistant"; content: string }[] = [];
  for (const message of options.messages) {
    if (message.role === "system") {
      if (message.content) systemParts.push(message.content);
    } else {
      dialogMessages.push({ role: message.role, content: message.content });
    }
  }

  const body: Record<string, unknown> = {
    model,
    // 默认 4096：MiniMax-M2.7 是 reasoning 模型，先生成 thinking block 再吐 text，
    // 给太小会 stop_reason=length 然后 text 为空。
    max_tokens: options.maxTokens ?? 4096,
    messages: dialogMessages
  };
  if (systemParts.length > 0) body.system = systemParts.join("\n\n");
  if (options.temperature != null) body.temperature = options.temperature;

  const response = await fetch(`${base}/anthropic/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body),
    signal: options.signal
  });

  const text = await response.text();
  let payload: unknown = text;
  try {
    payload = JSON.parse(text);
  } catch {
    // leave as raw text
  }

  if (!response.ok) {
    throw new MinimaxApiError(
      `Minimax responded ${response.status}: ${text.slice(0, 200)}`,
      response.status,
      payload
    );
  }

  const data = payload as AnthropicResponse;
  if (data.base_resp && data.base_resp.status_code && data.base_resp.status_code !== 0) {
    throw new MinimaxApiError(
      `Minimax business error ${data.base_resp.status_code}: ${data.base_resp.status_msg ?? "unknown"}`,
      response.status,
      payload
    );
  }

  // Concat all text-type blocks into the visible answer. Collect thinking separately
  // for debug; we never feed it back into the caller's downstream logic.
  const textBuffer: string[] = [];
  const thinkingBuffer: string[] = [];
  for (const block of data.content ?? []) {
    if (block.type === "text" && typeof (block as { text?: unknown }).text === "string") {
      textBuffer.push((block as { text: string }).text);
    } else if (block.type === "thinking" && typeof (block as { thinking?: unknown }).thinking === "string") {
      thinkingBuffer.push((block as { thinking: string }).thinking);
    }
  }
  const content = textBuffer.join("").trim();

  if (!content) {
    throw new MinimaxApiError(
      `Minimax returned no text content (stop_reason=${data.stop_reason ?? "?"})`,
      response.status,
      payload
    );
  }

  return {
    content,
    thinking: thinkingBuffer.join("\n").trim(),
    raw: payload,
    inputTokens: data.usage?.input_tokens,
    outputTokens: data.usage?.output_tokens
  };
}

// Try to pull the first JSON object out of a model response that may include
// markdown fences or chat-style prose. Returns null on failure.
export function extractJsonObject<T = unknown>(text: string): T | null {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenceMatch ? fenceMatch[1].trim() : trimmed;
  const start = body.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        const slice = body.slice(start, i + 1);
        try {
          return JSON.parse(slice) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
