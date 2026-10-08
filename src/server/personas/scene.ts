// Persona video scene (TASK-025, spec §5.4): Claude turns a post into one short shot of the brand's persona — what
// the first frame shows (for the reference image model) and what happens in the clip (for Kling 3.0). The person
// comes from the passport pictures; Claude never describes a different face. Prompt and tool only.
import { z } from "zod";
import type { PersonaDna } from "../db/schema";
import type { StructuredRequest } from "../llm/types";
import { dnaBlock, IDENTITY } from "./dna";

export const sceneSchema = z.object({
  keyframe: z.string().trim().min(20).max(1500).describe("The first frame as a photo description: setting, outfit, pose, expression, framing and light. Vertical 9:16. Do not describe the face — it comes from the reference pictures."),
  motion: z.string().trim().min(10).max(800).describe("What happens during the clip: one simple, natural action and the camera move, in present tense."),
});
export type Scene = z.infer<typeof sceneSchema>;

export type SceneInputs = {
  personaName: string; dna: PersonaDna; brandName: string; platform: string | null; durationS: number;
  post: { caption: string | null; brief: string; topic: string | null };
  /** The owner's wish (optional). */
  wish: string;
};

export function sceneRequest(i: SceneInputs, invalid?: { draft: unknown; errors: string }): Omit<StructuredRequest, "model"> {
  const schema = z.toJSONSchema(sceneSchema, { target: "draft-2020-12", io: "input" }) as Record<string, unknown>;
  delete schema.$schema;
  return {
    system: [{
      text: `You direct short vertical videos (Reels / TikTok) of an AI influencer for Postaja. For one post you write ONE
continuous shot: the first frame (a photo of the persona, made from their reference pictures) and what happens in the clip.
Rules:
- The person is the persona described by the DNA; keep their look (hair, skin, distinctive features). Their outfit, setting
  and pose follow the DNA unless the post clearly needs another place or outfit.
- One simple, natural action that fits ${i.durationS} seconds (walking, turning to the camera, sipping coffee, pointing at
  something, a laugh). One camera move at most (slow push-in, gentle handheld, slow orbit).
- The clip has no sound: the person does not speak or sing; no lip-sync.
- Photorealistic, like a real phone or camera video. No text, captions, logos, brand names or screens with writing.
- No other recognisable people, no celebrities; extras only as a blurred background. Nothing unsafe or sexualised.
- Respect the owner's wish when given.`,
      cache: true,
    }],
    user: [
      `<persona name="${i.personaName.replace(/"/g, "'")}">\n${dnaBlock(i.dna)}\n</persona>`,
      `<post brand="${i.brandName.replace(/"/g, "'")}" platform="${i.platform ?? "instagram"}">`,
      i.post.topic ? `<topic>${i.post.topic.slice(0, 500)}</topic>` : "",
      `<brief>${i.post.brief.slice(0, 1500)}</brief>`,
      i.post.caption ? `<caption>${i.post.caption.slice(0, 2500)}</caption>` : "",
      "</post>",
      i.wish.trim() ? `<owner_wish>\n${i.wish.trim()}\n</owner_wish>` : "",
      invalid ? `Your previous answer did not validate. Fix:\n${invalid.errors}\n<previous>${JSON.stringify(invalid.draft).slice(0, 4000)}</previous>` : "",
      "Write the shot now.",
    ].filter(Boolean).join("\n"),
    tool: { name: "submit_persona_scene", description: "Submit the shot: first frame and motion.", inputSchema: schema },
    maxTokens: 1500,
    timeoutMs: 2 * 60_000,
  };
}

/** The keyframe prompt for the reference model: the same person, the scene, real-photo cues, vertical. */
export function keyframePrompt(dna: PersonaDna, scene: Scene): string {
  return [
    "The SAME person as in the reference images: keep exactly the same face, facial features, skin, eyes, hair and age.",
    dnaBlock(dna, IDENTITY),
    `Scene: ${scene.keyframe}`,
    "Vertical 9:16 photo, a real photograph indistinguishable from reality: natural skin texture with pores and small imperfections, individual hair strands, realistic light. No retouching, no CGI, no illustration, no plastic skin.",
    "No text, no letters, no logos, no watermark.",
  ].join("\n");
}

/** The video prompt for Kling: what happens, kept realistic and on the same person. */
export function motionPrompt(scene: Scene): string {
  return `${scene.motion}\nRealistic, natural motion and physics; the same person throughout, consistent face and identity; the person does not speak. No text, no captions, no logos.`;
}

/**
 * A post illustration with the persona (TASK-027): the scene Claude described for the image, the same person from the
 * reference pictures, the persona's photographic style; room for the template's words is part of the scene.
 */
export function personaIllustrationPrompt(dna: PersonaDna, subject: string): string {
  return [
    "The SAME person as in the reference images: keep exactly the same face, facial features, skin, eyes, hair and age.",
    dnaBlock(dna, IDENTITY),
    `Scene: ${subject.trim().slice(0, 1500)}`,
    dna.style.trim() ? `Style: ${dna.style.trim()}` : "Style: photorealistic photography.",
    "A real photograph: natural skin texture, realistic light, no retouching, no CGI, no illustration, no plastic skin.",
    "No text, no letters, no numbers, no logos, no watermarks.",
  ].join("\n");
}
