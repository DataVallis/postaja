// fal.ai client (TASK-015/017): the queue protocol with a fake fetch, host allowlist, per-model request bodies.
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { billedMegapixels, createFalClient, generationSize, ImageError, requestBody, videoBody } from "./fal";

describe("request bodies", () => {
  it("Ideogram gets the brand's examples as style references and a negative prompt; FLUX gets neither", () => {
    const req = { model: "x", prompt: "p", width: 896, height: 1104, references: ["data:image/jpeg;base64,AAA"], negativePrompt: "text" };
    expect(requestBody("fal-ai/ideogram/v3", req)).toMatchObject({ prompt: "p", image_size: { width: 896, height: 1104 }, image_urls: ["data:image/jpeg;base64,AAA"], negative_prompt: "text", expand_prompt: false });
    const flux = requestBody("fal-ai/flux-pro/v1.1", req);
    expect(flux).not.toHaveProperty("image_urls");
    expect(flux).not.toHaveProperty("negative_prompt");
    expect(requestBody("fal-ai/ideogram/v3", { ...req, references: [] })).not.toHaveProperty("image_urls");
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

describe("videoBody", () => {
  it("Kling 3.0: start image, duration as a string within 3–15 s, no native audio, text kept out", () => {
    expect(videoBody("fal-ai/kling-video/v3/standard/image-to-video", { model: "x", prompt: "Push in.", image: "data:image/jpeg;base64,AA", durationS: 5 })).toEqual({
      prompt: "Push in.", start_image_url: "data:image/jpeg;base64,AA", duration: "5", generate_audio: false,
      negative_prompt: "text, letters, words, watermark, logo, blur, distort, low quality",
    });
    expect(videoBody("fal-ai/kling-video/v3/pro/image-to-video", { model: "x", prompt: "p", image: "i", durationS: 40 }).duration).toBe("15");
  });
  it("Hailuo: 6 or 10 s, prompt optimizer off", () => {
    expect(videoBody("fal-ai/minimax/hailuo-02/standard/image-to-video", { model: "x", prompt: "p", image: "i", durationS: 5 })).toEqual({ prompt: "p", image_url: "i", duration: "6", prompt_optimizer: false });
  });
});
