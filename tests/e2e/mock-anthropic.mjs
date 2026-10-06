// E2E stand-in for the Anthropic Messages API (never used outside tests). The app talks to it through the SDK's
// standard ANTHROPIC_BASE_URL, so production code has no test switch. It answers every request with a submit_post
// tool call built from the user's request; a request containing "POCENI" yields a rule-breaking draft both times.
//
// It also stands in for the fal.ai queue API (TASK-015) via FAL_BASE_URL: submit → status COMPLETED → result → a JPEG.
// A prompt containing "ZAVRNI" is refused like a safety-checker hit.
import http from "node:http";
import sharp from "sharp";

const port = Number(process.env.MOCK_ANTHROPIC_PORT ?? 3199);
const base = `http://127.0.0.1:${port}`;
const falPrompts = new Map();
let falSeq = 0;

function fal(req, res) {
  const send = (status, body, type = "application/json") => { res.writeHead(status, { "content-type": type }); res.end(type === "application/json" ? JSON.stringify(body) : body); };
  // Result files are public on fal's CDN; everything else needs the key.
  if (!req.url.startsWith("/fal-files/") && req.headers.authorization !== "Key e2e-not-a-real-key") return send(401, { detail: "bad key" });
  const status = req.url.match(/^\/fal-ai\/flux-pro\/requests\/([\w-]+)\/status$/);
  if (status) return send(200, { status: "COMPLETED" });
  const result = req.url.match(/^\/fal-ai\/flux-pro\/requests\/([\w-]+)$/);
  if (result) {
    const { prompt, width, height } = falPrompts.get(result[1]) ?? {};
    return send(200, { images: [{ url: `${base}/fal-files/${result[1]}.jpg?w=${width}&h=${height}`, width, height, content_type: "image/jpeg" }], has_nsfw_concepts: [String(prompt).includes("ZAVRNI")] });
  }
  const file = req.url.match(/^\/fal-files\/[\w-]+\.jpg\?w=(\d+)&h=(\d+)$/);
  if (file) {
    // A teal-to-amber picture, so a test can tell the background is there.
    const [w, h] = [Number(file[1]), Number(file[2])];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="#1fb5a8"/><stop offset="1" stop-color="#f2a33a"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
    sharp(Buffer.from(svg)).jpeg().toBuffer().then((b) => send(200, b, "image/jpeg"));
    return;
  }
  if (req.method === "POST" && req.url === "/fal-ai/flux-pro/v1.1") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const r = JSON.parse(body);
      const id = `req-${++falSeq}`;
      falPrompts.set(id, { prompt: r.prompt, width: r.image_size.width, height: r.image_size.height });
      send(200, { request_id: id, status_url: `${base}/fal-ai/flux-pro/requests/${id}/status`, response_url: `${base}/fal-ai/flux-pro/requests/${id}` });
    });
    return;
  }
  send(404, { detail: "not found" });
}

http
  .createServer((req, res) => {
    if (req.url?.startsWith("/fal-")) return fal(req, res);
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
