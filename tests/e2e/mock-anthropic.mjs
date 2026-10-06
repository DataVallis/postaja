// E2E stand-in for the Anthropic Messages API (never used outside tests). The app talks to it through the SDK's
// standard ANTHROPIC_BASE_URL, so production code has no test switch. It answers every request with a submit_post
// tool call built from the user's request; a request containing "POCENI" yields a rule-breaking draft both times.
import http from "node:http";

const port = Number(process.env.MOCK_ANTHROPIC_PORT ?? 3199);
http
  .createServer((req, res) => {
    if (req.method !== "POST" || !req.url?.startsWith("/v1/messages")) { res.writeHead(404).end(); return; }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const r = JSON.parse(body);
      const user = String(r.messages?.[0]?.content ?? "");
      const brief = user.split("\n")[1] ?? "objava";
      const thread = r.tools?.[0]?.input_schema?.required?.includes("parts");
      const caption = user.includes("POCENI") ? `Poceni ${brief}` : `${brief}. Link v bio`;
      const input = thread ? { parts: [caption], hashtags: ["e2e"], topic_summary: brief } : { caption, hashtags: ["e2e"], topic_summary: brief };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        id: "msg_e2e", type: "message", role: "assistant", model: r.model, stop_reason: "tool_use", stop_sequence: null,
        content: [{ type: "tool_use", id: "toolu_e2e", name: "submit_post", input }],
        usage: { input_tokens: 1200, output_tokens: 150, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }));
    });
  })
  .listen(port, "127.0.0.1");
