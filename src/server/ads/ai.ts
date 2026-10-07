// What Postaja asks Claude for ad copy (TASK-021, spec §5.8). Prompt and tool only; limits come from `ad_networks`.
import { z } from "zod";
import { languageName } from "@/lib/language";
import type { AdCopyIssue, AdObjective } from "../db/schema";
import type { StructuredRequest } from "../llm/types";
import type { NetworkSpec } from "./check";

export const AD_VARIANTS = 3;

export type AdCopyInputs = {
  brandName: string;
  language: string;
  cgp: string;
  objective: AdObjective;
  offer: string;
  landingUrl: string | null;
  brief: string;
  networks: NetworkSpec[];
  /** Earlier posts' topics of the brand: the ads may reuse proof points but should not copy posts. */
  recent: string[];
};

const CGP_MAX = 20_000;

const OBJECTIVE: Record<AdObjective, string> = {
  awareness: "awareness — make the brand and its point of view memorable; no hard sell",
  traffic: "traffic — a clear reason to click through to the landing page",
  leads: "leads — a concrete reason to leave contact details (what they get, why now)",
  sales: "sales — the offer, its value and the next step to buy",
};

/** Shape only: lengths and counts are checked by checkAdCopy, so an over-long draft can be fixed, not thrown away. */
export function adCopySchema(networks: NetworkSpec[], variants = AD_VARIANTS) {
  const net = (n: NetworkSpec) =>
    z.object({
      ...Object.fromEntries(n.fields.map((f) => [f.key, f.max > 1 ? z.array(z.string()).min(1).max(f.max) : z.string()])),
      ...(n.ctas.length ? { cta: z.string() } : {}),
    });
  return z.object({
    variants: z.array(z.object(Object.fromEntries(networks.map((n) => [n.key, net(n)])))).min(1).max(variants),
  });
}

/** The same shape for Claude's tool, with the limits written into it (maxLength, maxItems, CTA enum). */
function toolSchema(networks: NetworkSpec[], variants: number) {
  const net = (n: NetworkSpec) => ({
    type: "object",
    additionalProperties: false,
    required: [...n.fields.map((f) => f.key), ...(n.ctas.length ? ["cta"] : [])],
    properties: {
      ...Object.fromEntries(n.fields.map((f) => [f.key, f.max > 1
        ? { type: "array", minItems: f.min, maxItems: f.max, items: { type: "string", maxLength: f.maxChars }, description: `${f.label}: ${f.min}–${f.max} texts, each at most ${f.maxChars} characters` }
        : { type: "string", maxLength: f.maxChars, description: `${f.label}: at most ${f.maxChars} characters${f.recommended ? `, best within ${f.recommended} (shown before "See more")` : ""}` }])),
      ...(n.ctas.length ? { cta: { type: "string", enum: n.ctas, description: "The network's call-to-action button" } } : {}),
    },
  });
  return {
    type: "object",
    additionalProperties: false,
    required: ["variants"],
    properties: {
      variants: {
        type: "array", minItems: variants, maxItems: variants,
        items: { type: "object", additionalProperties: false, required: networks.map((n) => n.key), properties: Object.fromEntries(networks.map((n) => [n.key, net(n)])) },
      },
    },
  };
}

export function adCopyRequest(i: AdCopyInputs, fix?: { draft: unknown; issues: AdCopyIssue[] }, variants = AD_VARIANTS): Omit<StructuredRequest, "model"> {
  return {
    system: [{
      text: `You are the performance copywriter of Postaja. You write ad copy for ONE brand, from the brand's own instructions (CGP),
in its voice. One ad set = one concept; you write ${variants} clearly different copy variants of it (different hooks/angles:
e.g. pain, outcome, proof), each complete for every ad network asked, in that network's fields. Rules:
- Every field fits its character limit (count every character, spaces and punctuation included). Put the hook within the
  visible length where one is given. Headlines are short and concrete; no clickbait, no ALL CAPS, at most one emoji per text.
- Use only facts, prices, numbers, dates and claims stated in the CGP, the offer or the brief. Never invent them.
- Google Display headlines must each make sense on their own (they are combined by Google); the business name is the brand.
- Pick the CTA button that fits the objective from the network's list.
- Write in the language given. No hashtags in ads unless the CGP asks for them.`,
      cache: true,
    }],
    user: [
      `<brand name="${i.brandName}" language="${languageName(i.language)}">`,
      i.cgp.trim() ? `<cgp>\n${i.cgp.slice(0, CGP_MAX)}\n</cgp>` : "<cgp>(none yet)</cgp>",
      i.recent.length ? `<recent_posts>\n${i.recent.map((r) => `- ${r}`).join("\n")}\n</recent_posts>` : "",
      "</brand>",
      `<ad_set objective="${OBJECTIVE[i.objective]}"${i.landingUrl ? ` landing_url="${i.landingUrl}"` : ""}>`,
      i.offer.trim() ? `<offer>${i.offer.trim()}</offer>` : "<offer>(none: promote the brand itself)</offer>",
      i.brief.trim() ? `<brief>${i.brief.trim()}</brief>` : "",
      "</ad_set>",
      `<networks>\n${i.networks.map((n) => `- ${n.key}: ${n.fields.map((f) => `${f.key} (${f.max > 1 ? `${f.min}–${f.max} × ` : ""}≤ ${f.maxChars}${f.recommended ? `, visible ${f.recommended}` : ""})`).join(", ")}${n.ctas.length ? `; cta one of: ${n.ctas.join(", ")}` : ""}`).join("\n")}\n</networks>`,
      fix
        ? `Your previous copy broke these rules — fix exactly these fields, keep everything else word for word:\n${fix.issues.map((x) => `- variant ${x.variant + 1}, ${x.network}.${x.field}${x.index !== undefined ? `[${x.index + 1}]` : ""}: ${x.code} (${x.actual} vs ${x.limit})`).join("\n")}\n<previous>${JSON.stringify(fix.draft).slice(0, 20_000)}</previous>`
        : `Write the ${variants} copy variants now.`,
    ].filter(Boolean).join("\n"),
    tool: { name: "submit_ad_copy", description: "Submit the ad copy variants.", inputSchema: toolSchema(i.networks, variants) },
    maxTokens: 6000,
    timeoutMs: 4 * 60_000,
  };
}
