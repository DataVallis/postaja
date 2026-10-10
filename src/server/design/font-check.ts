// Whether the renderer (Satori) can draw text in a brand font. A font that passes the structural checks in
// files/font.ts can still crash Satori's font parser (variable fonts, CFF2, unusual tables — incident 2026-10-10),
// so uploads are tried here once and rendering never relies on an untested font.
import { createHash } from "node:crypto";
import satori from "satori";

const SAMPLE = "Aa Čč Šš Žž 0123";
const cache = new Map<string, Promise<string | null>>();
const CACHE_MAX = 200;

async function tryRender(bytes: Uint8Array): Promise<string | null> {
  const data = Buffer.from(bytes);
  try {
    await satori({ type: "div", props: { style: { display: "flex", fontFamily: "probe", fontSize: 32 }, children: SAMPLE } } as unknown as Parameters<typeof satori>[0], {
      width: 400, height: 80, fonts: [{ name: "probe", data, weight: 400, style: "normal" }, { name: "probe", data, weight: 700, style: "normal" }],
    });
    return null;
  } catch (e) {
    return (e instanceof Error ? e.message : String(e)).slice(0, 120) || "unknown";
  }
}

/** Null when the font renders, else the renderer's error message. Cached per font content. */
export function fontRenderError(bytes: Uint8Array): Promise<string | null> {
  const key = createHash("sha256").update(bytes).digest("hex");
  let hit = cache.get(key);
  if (!hit) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    hit = tryRender(bytes);
    cache.set(key, hit);
  }
  return hit;
}
