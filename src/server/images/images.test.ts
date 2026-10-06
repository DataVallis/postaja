// Image template, renderer and fal client (TASK-015): pure helpers, real rendering, the provider protocol with a fake fetch.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { inspectFont, woffToSfnt } from "../files/font";
import { billedMegapixels, createFalClient, generationSize, ImageError } from "./fal";
import { renderSlides } from "./render";
import { backgroundPrompt, brandColors, brandTemplate, slideTexts } from "./service";
import { DEFAULT_COLORS, DEFAULT_TEMPLATE, fitSize, headlineLines, onColor, slideTree } from "./template";

describe("template helpers", () => {
  it("splits headlines on sentence ends unless the text has its own line breaks", () => {
    expect(headlineLines("You give. It's locked. It's paid out in steps.")).toEqual(["You give.", "It's locked.", "It's paid out in steps."]);
    expect(headlineLines("Prva vrstica. Še vedno\nDruga")).toEqual(["Prva vrstica. Še vedno", "Druga"]);
    expect(headlineLines("Brez pike")).toEqual(["Brez pike"]);
    expect(headlineLines("   ")).toEqual([]);
  });

  it("fits the font to the longest line within bounds", () => {
    const big = fitSize(["Kratko"], 920, 1, false);
    const small = fitSize(["Precej daljša vrstica, ki mora biti manjša"], 920, 1, false);
    expect(big).toBe(104);
    expect(small).toBeLessThan(big);
    expect(small).toBeGreaterThanOrEqual(40);
    expect(fitSize(["x".repeat(500)], 920, 1, false)).toBe(40); // never unreadably small
    expect(fitSize(["Koda"], 920, 1, true, 92)).toBe(92);
  });

  it("picks readable text on an accent colour", () => {
    expect(onColor("#ffffff")).toBe("#12172b");
    expect(onColor("#39ff14")).toBe("#12172b"); // neon green → dark text
    expect(onColor("#e0112b")).toBe("#ffffff"); // CHERR.IO red → white
    expect(onColor("nope")).toBe("#ffffff");
  });

  it("colours the accent line and puts the label first (card layout)", () => {
    const tree = slideTree(DEFAULT_TEMPLATE, DEFAULT_COLORS, { width: 1080, height: 1350, background: null, label: "The problem", headline: "Prva.\nDruga.", logo: null });
    const body = (tree.props.children as { props: { children: { props: { style: { color?: string }; children: string } }[] } }[])[0];
    const [label, l1, l2] = body.props.children;
    expect(label.props.children).toBe("THE PROBLEM");
    expect(l1.props.style.color).toBe(DEFAULT_COLORS.text);
    expect(l2.props.style.color).toBe(DEFAULT_COLORS.accent);
  });

  it("reads a saved template leniently and falls back to defaults", () => {
    expect(brandTemplate(undefined)).toEqual(DEFAULT_TEMPLATE);
    expect(brandTemplate({ template: { layout: "center", typeface: "mono" } })).toMatchObject({ layout: "center", typeface: "mono", accentLine: "last" });
    expect(brandTemplate({ template: { layout: "bogus" } })).toEqual(DEFAULT_TEMPLATE);
    expect(brandColors({ primary: "#e0112b" })).toEqual({ ...DEFAULT_COLORS, accent: "#e0112b" });
    expect(brandColors({ primary: "#e0112b", accent: "#39ff14", background: "#000000" })).toEqual({ background: "#000000", text: DEFAULT_COLORS.text, accent: "#39ff14" });
  });

  it("takes the texts from the plan: slides for carousels, else overlay text, topic or brief", () => {
    const tpl = DEFAULT_TEMPLATE;
    expect(slideTexts({ format: "carousel", brief: "b", plan: { category: "Problem", slides: ["Ena", " ", "Dva"] } }, tpl)).toEqual([{ label: "Problem", headline: "Ena" }, { label: null, headline: "Dva" }]);
    expect(slideTexts({ format: "image", brief: "b", plan: { overlayText: "Naslov", topic: "Tema" } }, tpl)).toEqual([{ label: null, headline: "Naslov" }]);
    expect(slideTexts({ format: "image", brief: "b", plan: { topic: "Tema", category: "X" } }, { ...tpl, label: "none" })).toEqual([{ label: null, headline: "Tema" }]);
    expect(slideTexts({ format: "text", brief: "Brief", plan: {} }, tpl)).toEqual([{ label: null, headline: "Brief" }]);
    expect(slideTexts({ format: "carousel", brief: "b", plan: { slides: ["A"] } }, { ...tpl, layout: "photo" })).toEqual([{ label: null, headline: null }]);
  });

  it("asks the image model for the plan's picture in the brand style and never for letters", () => {
    const p = backgroundPrompt({ brief: "b", plan: { imagePrompt: "Isometric desk" } }, { imageStyle: "navy and amber", negativePrompt: "people" });
    expect(p).toContain("Isometric desk");
    expect(p).toContain("Style: navy and amber");
    expect(p).toContain("No text, no letters");
    expect(p).toContain("Avoid: people");
    expect(backgroundPrompt({ brief: "Brief", plan: {} }, {})).toMatch(/^Brief\n/);
  });
});

describe("renderer", () => {
  it("built-in fonts cover č š ž ć đ", () => {
    for (const f of ["Inter-Bold.woff", "JetBrainsMono-Bold.woff"]) {
      expect(inspectFont(woffToSfnt(fs.readFileSync(path.join("assets/fonts", f)))).missingGlyphs).toEqual([]);
    }
  });

  it("renders one PNG per slide at the requested size, background on the cover only", async () => {
    const bg = await sharp({ create: { width: 900, height: 1100, channels: 3, background: "#ff0000" } }).jpeg().toBuffer();
    const logo = await sharp({ create: { width: 1600, height: 1600, channels: 4, background: "#ffffff" } }).png().toBuffer();
    const pngs = await renderSlides({ ...DEFAULT_TEMPLATE, overlay: 0, footerText: "Polygon" }, DEFAULT_COLORS, { width: 1080, height: 1350 },
      [{ label: "Čas", headline: "Šola. Žaba." }, { label: null, headline: "Drugi" }], { background: bg, logo });
    expect(pngs).toHaveLength(2);
    for (const png of pngs) expect(await sharp(png).metadata()).toMatchObject({ format: "png", width: 1080, height: 1350 });
    // Top-left pixel: red photo on the cover, the brand background on the second slide.
    const px = async (png: Uint8Array) => [...(await sharp(png).extract({ left: 5, top: 5, width: 1, height: 1 }).raw().toBuffer()).subarray(0, 3)];
    const [r] = await px(pngs[0]);
    expect(r).toBeGreaterThan(200);
    expect(await px(pngs[1])).toEqual([0x12, 0x17, 0x2b]);
  });

  it("a plain template ignores the background", async () => {
    const bg = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#ff0000" } }).jpeg().toBuffer();
    const [png] = await renderSlides({ ...DEFAULT_TEMPLATE, background: "plain", layout: "center", typeface: "mono" }, DEFAULT_COLORS, { width: 1080, height: 1080 }, [{ label: null, headline: "Koda" }], { background: bg });
    const px = [...(await sharp(png).extract({ left: 5, top: 5, width: 1, height: 1 }).raw().toBuffer()).subarray(0, 3)];
    expect(px).toEqual([0x12, 0x17, 0x2b]);
  });
});

describe("fal client", () => {
  const jpeg = () => sharp({ create: { width: 64, height: 80, channels: 3, background: "#336699" } }).jpeg().toBuffer();
  /** A fake fal: records requests, answers the queue protocol. */
  function fakeFetch(opts: { imageUrl?: string; nsfw?: boolean; submitStatus?: number; statuses?: string[] } = {}) {
    const calls: { url: string; init?: RequestInit }[] = [];
    const statuses = [...(opts.statuses ?? ["IN_QUEUE", "COMPLETED"])];
    const f = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (init?.method === "POST") {
        if (opts.submitStatus) return new Response("{}", { status: opts.submitStatus });
        return Response.json({ request_id: "abc-1", status_url: "https://queue.fal.run/fal-ai/flux-pro/requests/abc-1/status", response_url: "https://queue.fal.run/fal-ai/flux-pro/requests/abc-1" });
      }
      if (url.endsWith("/status")) return Response.json({ status: statuses.shift() ?? "COMPLETED" });
      if (url.endsWith("/abc-1")) return Response.json({ images: [{ url: opts.imageUrl ?? "https://v3.fal.media/files/x.jpg", width: 64, height: 80 }], has_nsfw_concepts: [opts.nsfw ?? false] });
      return new Response(new Uint8Array(await jpeg()), { status: 200, headers: { "content-type": "image/jpeg" } });
    }) as typeof fetch;
    return { f, calls };
  }

  it("is off without a key", () => {
    expect(createFalClient({ key: "" })).toBeNull();
  });

  it("submits, polls, reads the result and re-encodes the picture", async () => {
    const { f, calls } = fakeFetch();
    const c = createFalClient({ key: "k", fetch: f, pollMs: 1 })!;
    const out = await c.generate({ model: "fal-ai/flux-pro/v1.1", prompt: "desk", width: 864, height: 1072 });
    expect(out).toMatchObject({ contentType: "image/jpeg", width: 64, height: 80 });
    expect(calls[0].url).toBe("https://queue.fal.run/fal-ai/flux-pro/v1.1");
    expect(JSON.parse(String(calls[0].init!.body))).toMatchObject({ prompt: "desk", image_size: { width: 864, height: 1072 }, num_images: 1 });
    expect((calls[0].init!.headers as Record<string, string>).Authorization).toBe("Key k");
    expect(calls.filter((c) => c.url.endsWith("/status"))).toHaveLength(2);
    expect(calls.at(-1)!.url).toBe("https://v3.fal.media/files/x.jpg");
    expect(calls.at(-1)!.init?.headers).toBeUndefined(); // the key never goes to the file host
  });

  it("refuses result files from unknown hosts, flagged images, bad keys and odd model names", async () => {
    await expect(createFalClient({ key: "k", fetch: fakeFetch({ imageUrl: "https://evil.example/x.jpg" }).f, pollMs: 1 })!.generate({ model: "fal-ai/flux-pro/v1.1", prompt: "p", width: 512, height: 512 })).rejects.toMatchObject({ code: "IMAGE_PROVIDER" });
    await expect(createFalClient({ key: "k", fetch: fakeFetch({ imageUrl: "https://evilfal.media/x.jpg" }).f, pollMs: 1 })!.generate({ model: "fal-ai/flux-pro/v1.1", prompt: "p", width: 512, height: 512 })).rejects.toMatchObject({ code: "IMAGE_PROVIDER" });
    await expect(createFalClient({ key: "k", fetch: fakeFetch({ nsfw: true }).f, pollMs: 1 })!.generate({ model: "fal-ai/flux-pro/v1.1", prompt: "p", width: 512, height: 512 })).rejects.toMatchObject({ code: "IMAGE_BLOCKED" });
    await expect(createFalClient({ key: "k", fetch: fakeFetch({ submitStatus: 401 }).f })!.generate({ model: "fal-ai/flux-pro/v1.1", prompt: "p", width: 512, height: 512 })).rejects.toMatchObject({ code: "NO_IMAGE_KEY" });
    await expect(createFalClient({ key: "k", fetch: fakeFetch({ statuses: ["FAILED"] }).f, pollMs: 1 })!.generate({ model: "fal-ai/flux-pro/v1.1", prompt: "p", width: 512, height: 512 })).rejects.toBeInstanceOf(ImageError);
    await expect(createFalClient({ key: "k", fetch: fakeFetch().f })!.generate({ model: "../../etc", prompt: "p", width: 512, height: 512 })).rejects.toMatchObject({ code: "IMAGE_PROVIDER" });
  });

  it("times out a request that never finishes", async () => {
    const { f } = fakeFetch({ statuses: Array(1000).fill("IN_PROGRESS") });
    await expect(createFalClient({ key: "k", fetch: f, pollMs: 1, timeoutMs: 5 })!.generate({ model: "fal-ai/flux-pro/v1.1", prompt: "p", width: 512, height: 512 })).rejects.toMatchObject({ code: "IMAGE_TIMEOUT" });
  });

  it("asks for at most a megapixel in the slide's shape and bills whole megapixels", () => {
    const s = generationSize(1080, 1350);
    expect(s.width * s.height).toBeLessThanOrEqual(1_000_000);
    expect(s.width % 16).toBe(0);
    expect(Math.abs(s.width / s.height - 1080 / 1350)).toBeLessThan(0.02);
    expect(generationSize(512, 512)).toEqual({ width: 512, height: 512 });
    expect(billedMegapixels(864, 1072)).toBe(1);
    expect(billedMegapixels(1080, 1350)).toBe(2);
  });
});
