// The Anthropic adapter against a local stand-in of the Messages API: no forced tool use (current models refuse it),
// one follow-up turn when Claude answers in text, and readable provider errors.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAnthropicClient } from "./anthropic";
import { LlmError, type StructuredRequest } from "./types";

type Reply = { status?: number; body: unknown };
const bodies: Record<string, unknown>[] = [];
let replies: Reply[] = [];
let server: http.Server;
let base = "";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      bodies.push(JSON.parse(raw));
      const r = replies.shift() ?? { status: 500, body: {} };
      res.writeHead(r.status ?? 200, { "content-type": "application/json" });
      res.end(JSON.stringify(r.body));
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.ANTHROPIC_BASE_URL = base;
});
afterAll(() => { server.close(); delete process.env.ANTHROPIC_BASE_URL; });

const usage = { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const msg = (content: unknown[], stop = "end_turn") => ({ id: "m", type: "message", role: "assistant", model: "m", stop_reason: stop, stop_sequence: null, content, usage });
const req: StructuredRequest = { model: "claude-sonnet-5-5", system: [{ text: "S" }], user: "U", tool: { name: "submit", description: "d", inputSchema: { type: "object", properties: {} } }, maxTokens: 100 };

describe("anthropic adapter", () => {
  it("offers the tool with tool_choice auto and returns its input", async () => {
    bodies.length = 0;
    replies = [{ body: msg([{ type: "tool_use", id: "t", name: "submit", input: { a: 1 } }], "tool_use") }];
    const out = await createAnthropicClient("k").structured(req);
    expect(out.input).toEqual({ a: 1 });
    expect(bodies[0].tool_choice).toEqual({ type: "auto" });
    expect((bodies[0].system as { text: string }[])[0].text).toContain('calling the tool "submit"');
  });

  it("asks once more when Claude answers in text, and adds up the usage", async () => {
    bodies.length = 0;
    replies = [
      { body: msg([{ type: "text", text: "Here is my plan…" }]) },
      { body: msg([{ type: "tool_use", id: "t", name: "submit", input: { ok: true } }], "tool_use") },
    ];
    const out = await createAnthropicClient("k").structured(req);
    expect(out.input).toEqual({ ok: true });
    expect(out.usage.inputTokens).toBe(20);
    const second = bodies[1].messages as { role: string }[];
    expect(second.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });

  it("web search (TASK-049): offers Anthropic's server tool, continues a paused turn, counts searches and their cost", async () => {
    bodies.length = 0;
    const searched = { ...usage, server_tool_use: { web_search_requests: 2 } };
    replies = [
      { body: { ...msg([{ type: "server_tool_use", id: "s1", name: "web_search", input: { query: "q" } }], "pause_turn"), usage: searched } },
      { body: { ...msg([{ type: "tool_use", id: "t", name: "submit", input: { found: 1 } }], "tool_use"), usage: { ...usage, server_tool_use: { web_search_requests: 1 } } } },
    ];
    const out = await createAnthropicClient("k").structured({ ...req, webSearch: { maxUses: 5 } });
    expect(out.input).toEqual({ found: 1 });
    expect(out.usage.webSearches).toBe(3);
    expect(bodies[0].tools).toEqual([
      { name: "submit", description: "d", input_schema: { type: "object", properties: {} } },
      { type: "web_search_20250305", name: "web_search", max_uses: 5 },
    ]);
    expect((bodies[1].messages as { role: string }[]).map((m) => m.role)).toEqual(["user", "assistant"]);
    const { costMicroUsd } = await import("./cost");
    const p = { inputPerMtok: 0n, outputPerMtok: 0n, cacheWritePerMtok: 0n, cacheReadPerMtok: 0n };
    expect(costMicroUsd(out.usage, p)).toBe(30_000n); // $0.01 per search
  });

  it("gives up after two text answers, and does not retry a cut-off answer", async () => {
    replies = [{ body: msg([{ type: "text", text: "a" }]) }, { body: msg([{ type: "text", text: "b" }]) }];
    await expect(createAnthropicClient("k").structured(req)).rejects.toMatchObject({ code: "NO_TOOL_CALL" });
    bodies.length = 0;
    replies = [{ body: msg([{ type: "text", text: "…" }], "max_tokens") }];
    await expect(createAnthropicClient("k").structured(req)).rejects.toBeInstanceOf(LlmError);
    expect(bodies).toHaveLength(1);
  });

  it("keeps Anthropic's explanation of a 400", async () => {
    replies = [{ status: 400, body: { type: "error", error: { type: "invalid_request_error", message: "tool_choice: not supported" } } }];
    await expect(createAnthropicClient("k").structured(req)).rejects.toMatchObject({ code: "PROVIDER", message: "anthropic 400: tool_choice: not supported" });
  });
});
