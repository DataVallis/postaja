// LLM adapter (ADR-010): the generation code talks to this interface, never to a provider SDK directly.

export type SystemBlock = { text: string; cache?: boolean };
export type ToolSpec = { name: string; description: string; inputSchema: Record<string, unknown> };
export type Usage = { inputTokens: number; outputTokens: number; cacheWriteTokens: number; cacheReadTokens: number };

export type ImageBlock = { mediaType: "image/jpeg" | "image/png"; data: string /* base64 */; caption?: string };

export type StructuredRequest = {
  model: string;
  system: SystemBlock[];
  user: string;
  /** Pictures shown to the model before the text (brand examples, logo, rendered previews). */
  images?: ImageBlock[];
  tool: ToolSpec;
  maxTokens: number;
  /** Long answers (a whole brand design) need more than the default 90 s; such calls are retried at most once. */
  timeoutMs?: number;
};

export interface LlmClient {
  /** Forces one tool call and returns its input (unvalidated JSON) plus token usage. Throws LlmError. */
  structured(req: StructuredRequest): Promise<{ input: unknown; usage: Usage }>;
}

export class LlmError extends Error {
  constructor(public readonly code: "NOT_CONFIGURED" | "PROVIDER" | "NO_TOOL_CALL", message?: string) {
    super(message ?? code);
  }
}
