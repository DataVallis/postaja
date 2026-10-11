// Anthropic implementation of the LLM adapter (ADR-010). The brand block is marked for prompt caching.
//
// Current models (Claude Sonnet 5.5, Opus 5.5, …) refuse forced tool use (tool_choice "tool"/"any" → 400), so the one
// tool is offered with tool_choice "auto" and the system prompt says to answer only through it. If Claude still
// answers in plain text, it is asked once more, in the same conversation, to use the tool. The input is validated by
// the caller (zod) as before.
import Anthropic from "@anthropic-ai/sdk";
import { LlmError, type LlmClient, type Usage } from "./types";

const USE_TOOL = (name: string) =>
  `\n\nAnswer only by calling the tool "${name}" exactly once with the complete result. Do not reply in plain text.`;

function fail(e: unknown): never {
  // Status plus Anthropic's own explanation (e.g. "tools.0.input_schema: …") — never the request body. Class names
  // are minified in the server bundle, so the explanation is what makes a failure diagnosable.
  const status = (e as { status?: number }).status;
  const reason = (e as { error?: { error?: { message?: unknown } } }).error?.error?.message;
  const detail = typeof reason === "string" ? reason.replace(/\s+/g, " ").slice(0, 300) : (e as Error).name;
  console.error(`[llm] anthropic ${status ?? "network"}: ${detail}`);
  throw new LlmError("PROVIDER", `anthropic ${status ?? "network"}: ${detail}`);
}

const add = (a: Usage, u: Anthropic.Usage): Usage => ({
  inputTokens: a.inputTokens + u.input_tokens,
  outputTokens: a.outputTokens + u.output_tokens,
  cacheWriteTokens: a.cacheWriteTokens + (u.cache_creation_input_tokens ?? 0),
  cacheReadTokens: a.cacheReadTokens + (u.cache_read_input_tokens ?? 0),
  webSearches: (a.webSearches ?? 0) + (u.server_tool_use?.web_search_requests ?? 0),
});

/** Anthropic's server-side web search tool (TASK-049); Anthropic runs the searches and returns cited results. */
export const WEB_SEARCH_TOOL = "web_search_20250305";

export function createAnthropicClient(apiKey: string | undefined = process.env.ANTHROPIC_API_KEY): LlmClient {
  const client = apiKey ? new Anthropic({ apiKey, maxRetries: 2, timeout: 90_000 }) : null;
  return {
    async structured(req) {
      if (!client) throw new LlmError("NOT_CONFIGURED", "ANTHROPIC_API_KEY is not set");
      const system = req.system.map((b, i) => ({
        type: "text" as const,
        text: i === req.system.length - 1 ? b.text + USE_TOOL(req.tool.name) : b.text,
        ...(b.cache ? { cache_control: { type: "ephemeral" as const } } : {}),
      }));
      const messages: Anthropic.MessageParam[] = [{
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
      }];
      const tools: Anthropic.ToolUnion[] = [{ name: req.tool.name, description: req.tool.description, input_schema: req.tool.inputSchema as Anthropic.Tool.InputSchema }];
      if (req.webSearch) tools.push({ type: WEB_SEARCH_TOOL, name: "web_search", max_uses: req.webSearch.maxUses });
      let usage: Usage = { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, webSearches: 0 };
      let pauses = 0;
      for (let turn = 0; turn < 2; turn++) {
        let res: Anthropic.Message;
        try {
          res = await client.messages.create(
            { model: req.model, max_tokens: req.maxTokens, system, messages, tools, tool_choice: { type: "auto" } },
            req.timeoutMs ? { timeout: req.timeoutMs, maxRetries: 1 } : undefined,
          );
        } catch (e) {
          fail(e);
        }
        usage = add(usage, res.usage);
        const call = res.content.find((c) => c.type === "tool_use" && c.name === req.tool.name);
        if (call && call.type === "tool_use") return { input: call.input, usage };
        // A long web search pauses the turn; it is continued as is (Anthropic resumes from the assistant content).
        if (res.stop_reason === "pause_turn" && pauses < 3) {
          pauses++;
          turn--;
          messages.push({ role: "assistant", content: res.content });
          continue;
        }
        if (res.stop_reason === "max_tokens" || res.stop_reason === "refusal") break;
        // Claude answered in text: ask once more, in the same conversation.
        messages.push({ role: "assistant", content: res.content }, { role: "user", content: `Now call the tool "${req.tool.name}" with the complete result.` });
      }
      throw new LlmError("NO_TOOL_CALL");
    },
  };
}
