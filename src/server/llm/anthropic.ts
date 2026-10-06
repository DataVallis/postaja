// Anthropic implementation of the LLM adapter (ADR-010). The brand block is marked for prompt caching.
import Anthropic from "@anthropic-ai/sdk";
import { LlmError, type LlmClient } from "./types";

export function createAnthropicClient(apiKey: string | undefined = process.env.ANTHROPIC_API_KEY): LlmClient {
  const client = apiKey ? new Anthropic({ apiKey, maxRetries: 2, timeout: 90_000 }) : null;
  return {
    async structured(req) {
      if (!client) throw new LlmError("NOT_CONFIGURED", "ANTHROPIC_API_KEY is not set");
      let res;
      try {
        res = await client.messages.create({
          model: req.model,
          max_tokens: req.maxTokens,
          system: req.system.map((b) => ({ type: "text" as const, text: b.text, ...(b.cache ? { cache_control: { type: "ephemeral" as const } } : {}) })),
          messages: [{
            role: "user",
            content: req.images?.length
              ? [
                  ...req.images.flatMap((im) => [
                    ...(im.caption ? [{ type: "text" as const, text: im.caption }] : []),
                    { type: "image" as const, source: { type: "base64" as const, media_type: im.mediaType, data: im.data } },
                  ]),
                  { type: "text" as const, text: req.user },
                ]
              : req.user,
          }],
          tools: [{ name: req.tool.name, description: req.tool.description, input_schema: req.tool.inputSchema as Anthropic.Tool.InputSchema }],
          tool_choice: { type: "tool", name: req.tool.name },
        });
      } catch (e) {
        // Status and type only — request bodies may contain brand material.
        const status = (e as { status?: number }).status;
        throw new LlmError("PROVIDER", `anthropic ${status ?? "network"} ${(e as Error).name}`);
      }
      const call = res.content.find((c) => c.type === "tool_use");
      if (!call || call.type !== "tool_use") throw new LlmError("NO_TOOL_CALL");
      const u = res.usage;
      return {
        input: call.input,
        usage: {
          inputTokens: u.input_tokens,
          outputTokens: u.output_tokens,
          cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
          cacheReadTokens: u.cache_read_input_tokens ?? 0,
        },
      };
    },
  };
}
