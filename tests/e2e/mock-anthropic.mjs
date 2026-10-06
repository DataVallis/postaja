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
      const tool = r.tools?.[0]?.name;
      const reply = (name, input) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          id: "msg_e2e", type: "message", role: "assistant", model: r.model, stop_reason: "tool_use", stop_sequence: null,
          content: [{ type: "tool_use", id: "toolu_e2e", name, input }],
          usage: { input_tokens: 900, output_tokens: 120, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        }));
      };
      // Plan import (TASK-012): name the columns like the header heuristic does.
      if (tool === "map_plan_columns") {
        const req = JSON.parse(user);
        return reply(tool, { columns: req.headerOnlyGuess, defaultPlatform: null, language: "sl" });
      }
      // Word plans: every "Objava N: …" heading starts a post; paragraphs until "Slika:" are its text, verbatim.
      if (tool === "extract_plan_posts") {
        const doc = user.split("<document>\n")[1]?.split("\n</document>")[0] ?? "";
        const items = [];
        for (const sec of doc.split(/\n(?=#+ Objava \d+)/).filter((x) => /^#+ Objava \d+/.test(x))) {
          const [head, ...rest] = sec.split("\n");
          const body = rest.join("\n").split(/\nSlika: /);
          items.push({ title: head.replace(/^#+\s*/, ""), text: body[0].trim(), imagePrompt: body[1]?.trim(), platform: "LinkedIn" });
        }
        return reply(tool, { sharedImageStyle: "Minimal 3D, navy background", items });
      }
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
