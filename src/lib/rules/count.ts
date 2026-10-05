// Platform-accurate text measurement. Pure, no dependencies — runs on server and in the browser editor (ADR-022).

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** User-perceived characters (č = 1, 👍🏽 = 1, 👨‍👩‍👧 = 1). Used by most platforms. */
export function graphemeLength(text: string): number {
  return Array.from(segmenter.segment(text)).length;
}

export const URL_RE = /https?:\/\/[^\s<>"']+|\bwww\.[^\s<>"']+/giu;
export const HASHTAG_RE = /(?<![\p{L}\p{N}_&/])#[\p{L}\p{N}_]*\p{L}[\p{L}\p{N}_]*/gu;
export const MENTION_RE = /(?<![\p{L}\p{N}_.])@[A-Za-z0-9_.]{1,30}/gu;
const EMOJI_RE = /\p{Extended_Pictographic}/u;

/** X weighted length: URLs count 23; emoji 2; Latin/most Western scripts 1; CJK and others 2 (X counting rules). */
export function xWeightedLength(text: string): number {
  let total = 0;
  const withoutUrls = text.replace(URL_RE, () => {
    total += 23;
    return "";
  });
  for (const { segment } of segmenter.segment(withoutUrls)) {
    if (EMOJI_RE.test(segment)) {
      total += 2;
      continue;
    }
    for (const ch of segment) {
      const cp = ch.codePointAt(0)!;
      const light =
        cp <= 4351 || (cp >= 8192 && cp <= 8205) || (cp >= 8208 && cp <= 8223) || (cp >= 8242 && cp <= 8247);
      total += light ? 1 : 2;
    }
  }
  return total;
}

export type Counting = "graphemes" | "x_weighted";

export function measure(text: string, counting: Counting): number {
  return counting === "x_weighted" ? xWeightedLength(text) : graphemeLength(text);
}

export const hashtags = (text: string) => text.match(HASHTAG_RE) ?? [];
export const mentions = (text: string) => text.match(MENTION_RE) ?? [];
export const urls = (text: string) => text.match(URL_RE) ?? [];
export const emojiCount = (text: string) => {
  let n = 0;
  for (const { segment } of segmenter.segment(text)) if (EMOJI_RE.test(segment)) n++;
  return n;
};
