// Ad copy checks (TASK-021): every field of every variant against its network's limits (`ad_networks`), the brand's
// banned words and the network's CTA buttons. Pure: shared by generation (fix round) and the editor's save.
import { graphemeLength } from "@/lib/rules";
import type { AdCopyIssue, AdCopyVariant, AdField, AdNetwork } from "../db/schema";

export type NetworkSpec = { key: AdNetwork; fields: AdField[]; ctas: string[] };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The texts of one field as a list (a single text is a list of one; empty entries dropped). */
export const textsOf = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v === undefined ? [] : [v]).map((x) => x.trim()).filter(Boolean);

/** Issues that block "ready" (all codes except long_visible, which is only a warning). */
export const isHard = (i: AdCopyIssue) => i.code !== "long_visible";

export function checkAdCopy(variants: AdCopyVariant[], specs: NetworkSpec[], bannedWords: string[] = []): AdCopyIssue[] {
  const out: AdCopyIssue[] = [];
  const banned = bannedWords.filter((w) => w.trim()).map((w) => ({ w, re: new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(w.trim())}(?![\\p{L}\\p{N}])`, "iu") }));
  variants.forEach((v, variant) => {
    for (const spec of specs) {
      const copy = v[spec.key] ?? {};
      for (const f of spec.fields) {
        const texts = textsOf(copy[f.key]);
        if (texts.length < f.min) out.push({ variant, network: spec.key, field: f.key, code: "too_few", actual: texts.length, limit: f.min });
        if (texts.length > f.max) out.push({ variant, network: spec.key, field: f.key, code: "too_many", actual: texts.length, limit: f.max });
        texts.forEach((t, i) => {
          const index = f.max > 1 ? i : undefined;
          const n = graphemeLength(t);
          if (n > f.maxChars) out.push({ variant, network: spec.key, field: f.key, index, code: "too_long", actual: n, limit: f.maxChars });
          else if (f.recommended && n > f.recommended) out.push({ variant, network: spec.key, field: f.key, index, code: "long_visible", actual: n, limit: f.recommended });
          for (const b of banned) if (b.re.test(t)) out.push({ variant, network: spec.key, field: f.key, index, code: "banned_word", actual: b.w, limit: "" });
        });
      }
      if (spec.ctas.length) {
        const cta = typeof copy.cta === "string" ? copy.cta : "";
        if (!spec.ctas.includes(cta)) out.push({ variant, network: spec.key, field: "cta", code: "bad_cta", actual: cta, limit: spec.ctas.join(" | ") });
      }
    }
  });
  return out;
}
