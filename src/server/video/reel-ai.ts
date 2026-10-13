// Reel from several shots (TASK-058, ADR-087): Claude turns a post into 2–4 shots. A "scene" is drawn as a first frame
// (an illustration Postaja checks for made-up writing) and moved by Kling 3.0; consecutive scenes are one Kling call
// with one shot prompt each (same people and place). A "screen" shows one of the owner's reference pictures (an app
// screen, a certificate, a document) exactly as it is — Postaja shows it, the model never draws it. Captions are short
// and set by Postaja in the brand's fonts. Prompt and tool only.
import { z } from "zod";
import type { StructuredRequest } from "../llm/types";

export const REEL_MIN_S = 6;
export const REEL_MAX_S = 15;
export const REEL_DURATIONS = [8, 12, 15] as const;
export const REEL_WISH_MAX = 800;

const caption = z.string().trim().max(80).describe("On-screen words for this shot (≤ 8 words, in the post's language), or empty. Postaja sets them in the brand's font.");

export const reelSchema = z.object({
  shots: z.array(z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("scene"),
      firstFrame: z.string().trim().min(20).max(1200).describe("The first frame as a picture description: who and what, where, framing, light. Vertical 9:16. Papers and screens in it are blank or turned away."),
      motion: z.string().trim().min(10).max(600).describe("What happens in this shot: one simple action and at most one camera move, present tense."),
      durationS: z.number().int().min(2).max(6),
      caption,
    }),
    z.object({
      kind: z.literal("screen"),
      reference: z.number().int().min(1).max(4).describe("Which of the owner's reference pictures (R1 = 1) this shot shows full screen, exactly as it is."),
      durationS: z.number().int().min(2).max(4),
      caption,
    }),
  ])).min(2).max(4),
});
export type ReelPlan = z.infer<typeof reelSchema>;
export type ReelShot = ReelPlan["shots"][number];

export type ReelInputs = {
  brandName: string; language: string; platform: string | null; durationS: number;
  post: { caption: string | null; brief: string; topic: string | null; imagePrompt: string | null; overlayText: string | null };
  /** The brand's reference pictures by name (R1, R2, …) — shown to Claude as images too. */
  references: string[];
  style: string;
  wish: string;
};

export function reelRequest(i: ReelInputs, invalid?: { draft: unknown; errors: string }): Omit<StructuredRequest, "model"> {
  const schema = z.toJSONSchema(reelSchema, { target: "draft-2020-12", io: "input" }) as Record<string, unknown>;
  delete schema.$schema;
  return {
    system: [{
      text: `You direct short vertical videos (Reels / TikTok / Shorts) for Postaja. For one post you write 2 to 4 shots that tell
it in about ${i.durationS} seconds in total (shot lengths add up to ${i.durationS} ± 2).
Shots:
- "scene": a moving picture made by an AI video model from a first frame. Give the first frame (what is in the picture,
  where, framing, light; vertical 9:16) and the motion (one simple, natural action and at most one camera move).
  Consecutive scenes are filmed as one continuous take with cuts, so keep the same people, clothes and place across them.
- "screen": one of the owner's reference pictures shown full screen exactly as it is (an app screen, a certificate, a
  document, a product photo). Use it whenever the post needs a phone or computer screen, a document, a contract with
  words, a price list or a logo to be seen — never describe readable screens, papers, signs or labels in a scene: AI models
  invent letters. In a scene, a phone or paper is blank, turned away or out of focus.
Rules:
- No text, letters, logos, captions or watermarks inside any first frame or motion. Words appear only as captions, which
  Postaja sets in the brand's fonts: at most 8 words per shot, in the post's language, never repeating the caption sentence
  for sentence; empty when the picture says enough.
- No celebrities or recognisable real people; children only as in an ordinary family scene, fully clothed, never the focus
  of anything unsafe. Nothing violent or sexualised. No speaking or lip-sync (no sound).
- The owner's image prompt and wish, when given, decide the story; follow them.
- The brand's picture style: ${i.style || "natural, warm, real-looking"}.`,
      cache: true,
    }],
    user: [
      `<post brand="${i.brandName.replace(/"/g, "'")}" platform="${i.platform ?? "instagram"}" language="${i.language}">`,
      i.post.topic ? `<topic>${i.post.topic.slice(0, 500)}</topic>` : "",
      `<brief>${i.post.brief.slice(0, 1500)}</brief>`,
      i.post.imagePrompt ? `<owner_image_prompt>${i.post.imagePrompt.slice(0, 1500)}</owner_image_prompt>` : "",
      i.post.overlayText ? `<overlay_text>${i.post.overlayText.slice(0, 300)}</overlay_text>` : "",
      i.post.caption ? `<caption>${i.post.caption.slice(0, 2500)}</caption>` : "",
      "</post>",
      i.references.length
        ? `<owner_references>\n${i.references.map((n, k) => `R${k + 1}: "${n.replace(/"/g, "'")}"`).join("\n")}\n</owner_references>\nThe pictures above are these references, in order. Only these can be shown as screens.`
        : "<owner_references>none — a screen shot is not possible; keep screens and papers out of view.</owner_references>",
      i.wish.trim() ? `<owner_wish>\n${i.wish.trim()}\n</owner_wish>` : "",
      invalid ? `Your previous answer did not validate. Fix:\n${invalid.errors}\n<previous>${JSON.stringify(invalid.draft).slice(0, 4000)}</previous>` : "",
      "Write the shots now.",
    ].filter(Boolean).join("\n"),
    tool: { name: "submit_reel", description: "Submit the reel's shots.", inputSchema: schema },
    maxTokens: 2500,
    timeoutMs: 2 * 60_000,
  };
}

/** What a plan gets wrong beyond the schema: references that do not exist, a total far from the asked length. */
export function reelIssues(plan: ReelPlan, refCount: number, durationS: number): string[] {
  const out: string[] = [];
  plan.shots.forEach((s, i) => { if (s.kind === "screen" && s.reference > refCount) out.push(`- shot ${i + 1}: reference R${s.reference} does not exist (there are ${refCount})`); });
  if (!plan.shots.some((s) => s.kind === "scene")) out.push("- at least one shot must be a scene");
  const total = plan.shots.reduce((n, s) => n + s.durationS, 0);
  if (Math.abs(total - durationS) > 2) out.push(`- the shots add up to ${total} s; make them about ${durationS} s`);
  if (total > REEL_MAX_S) out.push(`- at most ${REEL_MAX_S} s in total`);
  return out;
}

/** Consecutive scenes → one Kling call each group (with one shot prompt per scene). */
export function sceneGroups(shots: ReelShot[]): { start: number; scenes: Extract<ReelShot, { kind: "scene" }>[] }[] {
  const groups: { start: number; scenes: Extract<ReelShot, { kind: "scene" }>[] }[] = [];
  shots.forEach((s, i) => {
    if (s.kind !== "scene") return;
    const last = groups.at(-1);
    if (last && last.start + last.scenes.length === i) last.scenes.push(s);
    else groups.push({ start: i, scenes: [s] });
  });
  return groups;
}

/** Kling 3.0 takes 3–15 s per call: a group shorter than 3 s is asked for 3 s and cut to length. */
export const clipSeconds = (scenes: { durationS: number }[]) => Math.min(REEL_MAX_S, Math.max(3, scenes.reduce((n, s) => n + s.durationS, 0)));

export const NO_WRITING_MOTION = "Realistic, natural motion and physics; the same people and place throughout. No text, letters, captions, logos or readable screens appear at any point; papers and screens stay blank. No speaking.";
