// E2E stand-in for the Anthropic Messages API (never used outside tests). The app talks to it through the SDK's
// standard ANTHROPIC_BASE_URL, so production code has no test switch. It answers every request with a submit_post
// tool call built from the user's request; a request containing "POCENI" yields a rule-breaking draft both times.
//
// It also stands in for the fal.ai queue API (TASK-015) via FAL_BASE_URL: submit → status COMPLETED → result → a JPEG.
// A prompt containing "ZAVRNI" is refused like a safety-checker hit.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

/** A 3 s clip like an image-to-video model returns (TASK-022), made once with ffmpeg. */
let clip;
function testClip() {
  if (!clip) {
    const out = path.join(mkdtempSync(path.join(tmpdir(), "mock-clip-")), "clip.mp4");
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=768x960:rate=25", "-t", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", out]);
    clip = readFileSync(out);
  }
  return clip;
}

const port = Number(process.env.MOCK_ANTHROPIC_PORT ?? 3199);
/** Same shape as tests/fixtures/design.ts cardDesign (the mock is plain JS). */
const DESIGN = {
  summary: "Dark night-blue cards, one red accent, bold white headlines with the key words in red, a thin red rule above a logo footer.",
  illustrationStyle: "Moody product photography, deep blue shadows, single red rim light",
  palette: { background: "#0b0f1a", surface: "#161c2c", text: "#f5f3ee", muted: "#9aa3b5", accent: "#e0112b" },
  typography: { heading: "sans", body: "sans" },
  templates: [
    { id: "cover", name: "Naslovnica", use: "Single image or carousel cover",
      background: { type: "illustration", color: "background", overlay: { color: "background", opacity: 0.8, fade: "bottom" } },
      elements: [
        { type: "text", slot: "label", x: 7, y: 34, w: 60, h: 5, color: "text", fill: "accent", maxSize: 2.4, minSize: 1.6, padding: 1.2, letterSpacing: 0.18, uppercase: true },
        { type: "text", slot: "headline", x: 7, y: 41, w: 86, h: 36, color: "text", emphasis: "accent", maxSize: 9, minSize: 4 },
        { type: "shape", x: 0, y: 84.5, w: 100, h: 0.3, color: "accent" },
        { type: "image", source: "logo", x: 7, y: 88, w: 24, h: 7 },
        { type: "text", slot: "footer", x: 36, y: 88, w: 57, h: 7, color: "text", maxSize: 3.6, minSize: 2, valign: "middle" },
      ],
      sample: { label: "The problem", headline: "Daš. Zaklenjeno je.\n*Izplača se v korakih.*", footer: "Polygon" } },
    { id: "points", name: "Seznam", use: "Carousel inner slide",
      background: { type: "color", color: "surface" },
      elements: [
        { type: "text", slot: "number", x: 7, y: 7, w: 20, h: 8, color: "accent", maxSize: 6 },
        { type: "text", slot: "headline", x: 7, y: 18, w: 86, h: 30, color: "text", emphasis: "accent", maxSize: 7, minSize: 3.5 },
        { type: "shape", x: 7, y: 90, w: 12, h: 0.6, color: "accent" },
      ],
      sample: { number: "02", headline: "Kako *deluje*" } },
  ],
};
const base = `http://127.0.0.1:${port}`;
const falPrompts = new Map();
/** What the app asked fal for (model, number of style references); GET /fal-log returns it for a test to check. */
const falLog = [];
let falSeq = 0;

function fal(req, res) {
  const send = (status, body, type = "application/json") => { res.writeHead(status, { "content-type": type }); res.end(type === "application/json" ? JSON.stringify(body) : body); };
  // Result files are public on fal's CDN; everything else needs the key.
  if (!req.url.startsWith("/fal-files/") && req.headers.authorization !== "Key e2e-not-a-real-key") return send(401, { detail: "bad key" });
  const status = req.url.match(/^\/fal-ai\/[\w-]+\/requests\/([\w-]+)\/status$/);
  if (status) return send(200, { status: "COMPLETED" });
  const result = req.url.match(/^\/fal-ai\/[\w-]+\/requests\/([\w-]+)$/);
  if (result) {
    const { prompt, width, height, video } = falPrompts.get(result[1]) ?? {};
    if (video) return send(200, { video: { url: `${base}/fal-files/${result[1]}.mp4`, content_type: "video/mp4" } });
    return send(200, { images: [{ url: `${base}/fal-files/${result[1]}.jpg?w=${width}&h=${height}`, width, height, content_type: "image/jpeg" }], has_nsfw_concepts: [String(prompt).includes("ZAVRNI")] });
  }
  if (/^\/fal-files\/[\w-]+\.mp4$/.test(req.url)) return send(200, testClip(), "video/mp4");
  const file = req.url.match(/^\/fal-files\/req-(\d+)\.jpg\?w=(\d+)&h=(\d+)$/);
  if (file) {
    // A teal-to-amber picture, so a test can tell the background is there; a corner mark makes every request's picture
    // different (as a real model's), e.g. so persona passports have no duplicates.
    const [w, h] = [Number(file[2]), Number(file[3])];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="#1fb5a8"/><stop offset="1" stop-color="#f2a33a"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><rect width="8" height="8" fill="rgb(${(Number(file[1]) * 37) % 255},0,0)"/></svg>`;
    sharp(Buffer.from(svg)).jpeg().toBuffer().then((b) => send(200, b, "image/jpeg"));
    return;
  }
  const submit = req.method === "POST" && req.url.match(/^\/fal-ai\/([\w-]+)(?:\/[\w.\/-]+)?$/);
  if (submit) {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const r = JSON.parse(body);
      // Like the real API for current models: forced tool use is refused (400).
      if (r.tool_choice?.type === "tool" || r.tool_choice?.type === "any") {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: 'tool_choice: type "tool" and "any" are not supported for this model.' } }));
        return;
      }
      const id = `req-${++falSeq}`;
      if ((r.image_url || r.start_image_url) && !r.image_size) {
        // Image-to-video: the app must send the clean picture and a prompt without text.
        falPrompts.set(id, { prompt: r.prompt, video: true });
        falLog.push({ model: req.url.slice(1), video: true, duration: r.duration, image: String(r.start_image_url ?? r.image_url).slice(0, 23) });
        return send(200, { request_id: id, status_url: `${base}/fal-ai/${submit[1]}/requests/${id}/status`, response_url: `${base}/fal-ai/${submit[1]}/requests/${id}` });
      }
      // Reference models (TASK-024) take an aspect ratio instead of a size.
      const [aw, ah] = r.aspect_ratio ? r.aspect_ratio.split(":").map(Number) : [0, 0];
      const size = r.image_size ?? (aw >= ah ? { width: 1024, height: Math.round((1024 * ah) / aw) } : { width: Math.round((1024 * aw) / ah), height: 1024 });
      falPrompts.set(id, { prompt: r.prompt, width: size.width, height: size.height, references: r.image_urls?.length ?? 0 });
      falLog.push({ model: req.url.slice(1), references: r.image_urls?.length ?? 0, prompt: String(r.prompt).slice(0, 2000) });
      const app = `fal-ai/${submit[1]}`;
      send(200, { request_id: id, status_url: `${base}/${app}/requests/${id}/status`, response_url: `${base}/${app}/requests/${id}` });
    });
    return;
  }
  send(404, { detail: "not found" });
}

http
  .createServer((req, res) => {
    if (req.url === "/fal-log") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(falLog)); return; }
    if (req.url?.startsWith("/fal-")) return fal(req, res);
    if (req.method !== "POST" || !req.url?.startsWith("/v1/messages")) { res.writeHead(404).end(); return; }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const r = JSON.parse(body);
      // The user turn is a string, or blocks (pictures + captions + the text last) when images are sent.
      const content = r.messages?.[0]?.content ?? "";
      const user = typeof content === "string" ? content : content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      const tool = r.tools?.[0]?.name;
      const reply = (name, input) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          id: "msg_e2e", type: "message", role: "assistant", model: r.model, stop_reason: "tool_use", stop_sequence: null,
          content: [{ type: "tool_use", id: "toolu_e2e", name, input }],
          usage: { input_tokens: 900, output_tokens: 120, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        }));
      };
      // Brand design (TASK-017): a fixed two-template design; a revision bumps the headlines and notes the request.
      if (tool === "submit_brand_design") {
        const current = user.match(/<current_design>\n([\s\S]*?)\n<\/current_design>/);
        if (!current) return reply(tool, DESIGN);
        const d = JSON.parse(current[1]);
        const request = user.match(/<owner_request>\n([\s\S]*?)\n<\/owner_request>/)?.[1] ?? "";
        d.summary = `${d.summary} Popravek: ${request}`.slice(0, 800);
        for (const t of d.templates) for (const e of t.elements) if (e.slot === "headline") e.maxSize = Math.min(20, e.maxSize + 1);
        return reply(tool, d);
      }
      // Post images: the cover with the plan's overlay text (or topic); carousels add one "points" slide per plan slide.
      if (tool === "plan_post_images") {
        // A correction in words: keep the current images; "Naslov: X" sets the first headline, "ilustracij…" redraws it.
        const current = user.match(/<current_images>\n(.*)\n<\/current_images>/);
        if (current) {
          const slides = JSON.parse(current[1]);
          const ask = user.match(/<owner_request>\n([\s\S]*?)\n<\/owner_request>/)[1];
          const head = ask.match(/naslov:\s*(.+)/i);
          if (head) slides[0].slots.headline = head[1].trim();
          if (/ilustracij/i.test(ask)) slides[0].illustration = `${slides[0].illustration} (revised)`;
          return reply(tool, { slides });
        }
        const plan = JSON.parse(user.match(/<plan>(.*)<\/plan>/)[1]);
        const cover = { templateId: "cover", slots: { headline: plan.overlayText ?? plan.topic ?? "Objava", ...(plan.category ? { label: plan.category } : {}), footer: "Polygon" }, illustration: `Illustration for ${plan.topic ?? "post"}` };
        const slides = [cover, ...(plan.slides ?? []).map((x, i) => ({ templateId: "points", slots: { number: `0${i + 1}`, headline: x }, illustration: null }))];
        return reply(tool, { slides });
      }
      // Competitors (TASK-049): the web search tool is offered next to ours; three competitors, the wish in the reason.
      if (tool === "submit_competitors") {
        const searching = r.tools.some((t) => t.type?.startsWith("web_search") && t.max_uses > 0);
        const wish = user.match(/<owner_wish>\n([\s\S]*?)\n<\/owner_wish>/)?.[1] ?? "";
        return reply(tool, { competitors: searching ? [
          { name: "Koda Akademija", website: "https://koda-akademija.example", handles: [{ platform: "instagram", url: "https://instagram.com/koda.akademija" }], reason: `Isti tečaj za ne-programerje. ${wish}`.trim() },
          { name: "Startup Šola", website: "https://startup-sola.example", handles: [], reason: "Podobna publika, višja cena." },
          { name: "Globalna Platforma", website: "https://global.example", handles: [], reason: "Velika tuja platforma." },
        ] : [] });
      }
      // Post ideas (TASK-019): N numbered ideas in the first allowed format, named after the owner's wish when given.
      // Ad copy (TASK-021): fill every field of every network the tool asks for, within its limits; variant n's Meta
      // headline is "Naslov n" so the E2E can find it.
      if (tool === "submit_ad_copy") {
        const v = r.tools[0].input_schema.properties.variants;
        const nets = v.items.properties;
        const variants = Array.from({ length: v.minItems }, (_, i) => Object.fromEntries(Object.entries(nets).map(([key, net]) => [key, Object.fromEntries(Object.entries(net.properties).map(([f, spec]) => {
          if (spec.enum) return [f, spec.enum[0]];
          if (spec.type === "array") return [f, [`Naslov ${i + 1}a`, `Naslov ${i + 1}b`].map((x) => x.slice(0, spec.items.maxLength))];
          return [f, (f === "headline" ? `Naslov ${i + 1}` : `Besedilo ${f} ${i + 1} za oglas`).slice(0, spec.maxLength)];
        }))])));
        return reply(tool, { variants });
      }
      // Ad creatives (TASK-021b): per variant the first template with an illustration, its headline as the words.
      if (tool === "plan_ad_visuals") {
        const templates = JSON.parse(user.match(/<templates>\n(.*)\n<\/templates>/)[1]);
        const heads = [...user.matchAll(/<headline>(.*?)<\/headline>/g)].map((m) => m[1]);
        const t = templates.find((x) => x.illustration) ?? templates[0];
        const visuals = heads.map((h, i) => ({ templateId: t.id, slots: { headline: h, ...(t.slots.includes("label") ? { label: "Webinar" } : {}) }, illustration: t.illustration ? `Ad illustration ${i + 1}` : null }));
        return reply(tool, { visuals });
      }
      // Animation (TASK-023): every element of the image enters one after another with a fade; the headline word by word.
      if (tool === "submit_motion") {
        const els = JSON.parse(user.match(/<elements>\n(.*)\n<\/elements>/)[1]);
        const elements = els.map((e, i) => ({ index: e.index, enter: { effect: e.slot === "headline" ? "words" : "fade", at: 0.2 + i * 0.3, duration: 0.6, ease: "out" }, loop: "none" }));
        return reply(tool, { durationS: Math.max(4, Math.ceil(0.2 + els.length * 0.3 + 2.5)), background: { motion: "zoom_in", amount: 0.06 }, elements });
      }
      // Persona DNA (TASK-024): every field of the framework, the owner's words kept in Extra Notes.
      if (tool === "submit_persona_dna") {
        const text = user.match(/<owner_text>\n([\s\S]*?)\n<\/owner_text>/)[1];
        return reply(tool, { name: "Mila", dna: {
          gender: "Female", age: "26 years old", ethnicity: "Slovenian, fair skin", hairStyle: "Short pixie cut", hairColour: "Jet black",
          clothing: "Yellow rain jacket", mood: "Cheerful", environment: "Ljubljana old town", camera: "Mid-shot, eye-level", pose: "Walking, looking back",
          lighting: "Overcast daylight", style: "Photorealistic digital photography", extra: `Owner: ${text.slice(0, 200)}`,
        } });
      }
      // Persona video (TASK-025): a fixed shot that names the owner's wish, so the E2E can find it.
      if (tool === "submit_persona_scene") {
        const wish = user.match(/<owner_wish>\n([\s\S]*?)\n<\/owner_wish>/)?.[1] ?? "";
        return reply(tool, { keyframe: `Standing in Ljubljana old town at dusk, yellow rain jacket. ${wish}`.trim(), motion: "Turns to the camera and smiles; slow push-in." });
      }
      if (tool === "suggest_post_ideas") {
        const n = Number(user.match(/Propose exactly (\d+) idea/)[1]);
        const format = user.match(/formats="([^",]+)/)[1];
        const wish = user.match(/<owner_wish>\n([\s\S]*?)\n<\/owner_wish>/)?.[1] ?? "Tema";
        const taken = (user.match(/^- .*$/gm) ?? []).length; // rejected + kept ideas listed for replacements
        // Distinct topics (the no-repeat check rejects ideas that share most words).
        const topics = ["kava z ovsenim mlekom", "čajni rituali za deževne dni", "domači piškoti iz pekarne", "glasbeni večer ob petkih", "zajtrk za študente", "poletna terasa na vrtu"];
        const ideas = Array.from({ length: n }, (_, i) => ({ title: `${wish} ${taken + i + 1}: ${topics[(taken + i) % topics.length]}`, angle: `Zgodba o ${topics[(taken + i) % topics.length]}.`, pillar: null, format }));
        return reply(tool, { ideas });
      }
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
