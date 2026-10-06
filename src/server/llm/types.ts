// LLM adapter (ADR-010): the generation code talks to this interface, never to a provider SDK directly.

export type SystemBlock = { text: string; cache?: boolean };
export type ToolSpec = { name: string; description: string; inputSchema: Record<string, unknown> };
export type Usage = { inputTokens: number; outputTokens: number; cacheWriteTokens: number; cacheReadTokens: number };

export type StructuredRequest = {
  model: string;
  system: SystemBlock[];
  user: string;
  tool: ToolSpec;
  maxTokens: number;
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
