// Every output is validated against its format preset before it can be "ready" (ADR-020).

export type SafeZone = { top: number; right: number; bottom: number; left: number };

export type FormatPreset = {
  key: string;
  width: number;
  height: number;
  media: "image" | "video" | "pdf";
  maxBytes?: number | null;
  minDurationS?: number | null;
  maxDurationS?: number | null;
  safeZone: SafeZone;
};

export type AssetFacts = { width: number; height: number; bytes: number; media: "image" | "video" | "pdf"; durationS?: number };

export type AssetViolation =
  | { code: "wrong_media"; actual: string; limit: string }
  | { code: "wrong_size"; actual: string; limit: string }
  | { code: "file_too_large"; actual: number; limit: number }
  | { code: "video_too_short" | "video_too_long"; actual: number; limit: number };

export function checkAsset(a: AssetFacts, p: FormatPreset): AssetViolation[] {
  const v: AssetViolation[] = [];
  if (a.media !== p.media) v.push({ code: "wrong_media", actual: a.media, limit: p.media });
  if (a.width !== p.width || a.height !== p.height) v.push({ code: "wrong_size", actual: `${a.width}x${a.height}`, limit: `${p.width}x${p.height}` });
  if (p.maxBytes && a.bytes > p.maxBytes) v.push({ code: "file_too_large", actual: a.bytes, limit: p.maxBytes });
  if (a.media === "video" && a.durationS !== undefined) {
    if (p.minDurationS && a.durationS < p.minDurationS) v.push({ code: "video_too_short", actual: a.durationS, limit: p.minDurationS });
    if (p.maxDurationS && a.durationS > p.maxDurationS) v.push({ code: "video_too_long", actual: a.durationS, limit: p.maxDurationS });
  }
  return v;
}

/** The rectangle where text and logos may be placed. */
export function safeArea(p: Pick<FormatPreset, "width" | "height" | "safeZone">) {
  const { top, right, bottom, left } = p.safeZone;
  return { x: left, y: top, width: p.width - left - right, height: p.height - top - bottom };
}

/** True if the box lies fully inside the safe area. */
export function insideSafeArea(box: { x: number; y: number; width: number; height: number }, p: Pick<FormatPreset, "width" | "height" | "safeZone">) {
  const s = safeArea(p);
  return box.x >= s.x && box.y >= s.y && box.x + box.width <= s.x + s.width && box.y + box.height <= s.y + s.height;
}
