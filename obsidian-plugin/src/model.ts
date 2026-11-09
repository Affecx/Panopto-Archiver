import { studySchema } from "./schema";
import type { Chat } from "./study";
export interface LocalUsage {
  model: string;
  input: number;
  cached: number;
  output: number;
  totalSeconds: number;
  loadSeconds: number;
  promptSeconds: number;
  generationSeconds: number;
  doneReason: string;
}
export function ollamaChat(
  endpoint: string,
  model: string,
  request: (url: string, body: object) => Promise<unknown>,
  maxOutput = 1800,
  onUsage?: (usage: LocalUsage) => void,
  schemaFor = studySchema,
): Chat {
  const url = new URL(endpoint);
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("The local model endpoint must be on loopback");
  return async (system, user) => {
    const response = await request(new URL("/api/chat", url).href, {
      model,
      stream: false,
      format: schemaFor(user),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      options: { temperature: 0.2, num_predict: maxOutput, num_ctx: 8192 },
    });
    const r = response as {
      message?: { content?: unknown };
      model?: string;
      prompt_eval_count?: number;
      prompt_eval_cached_count?: number;
      eval_count?: number;
      total_duration?: number;
      load_duration?: number;
      prompt_eval_duration?: number;
      eval_duration?: number;
      done_reason?: string;
    };
    onUsage?.({
      model: r.model || model,
      input: r.prompt_eval_count || 0,
      cached: r.prompt_eval_cached_count || 0,
      output: r.eval_count || 0,
      totalSeconds: (r.total_duration || 0) / 1e9,
      loadSeconds: (r.load_duration || 0) / 1e9,
      promptSeconds: (r.prompt_eval_duration || 0) / 1e9,
      generationSeconds: (r.eval_duration || 0) / 1e9,
      doneReason: r.done_reason || "unknown",
    });
    if (r.done_reason === "length")
      throw new Error(
        "Local model output was truncated at its token limit. No automatic retry was made.",
      );
    if (typeof r?.message?.content !== "string")
      throw new Error("The local model returned no message");
    return r.message.content;
  };
}

export interface Usage {
  input: number;
  cached: number;
  output: number;
}
