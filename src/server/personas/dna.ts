// Persona DNA (TASK-024, spec §5.5): the owner's DNA framework — 13 fields every picture of the persona is generated
// from. The owner fills them in by hand, or describes the person roughly (or pastes/imports an existing DNA) and
// Claude fills every field; the owner can then edit each one. Written in English, because image models read it.
import { z } from "zod";
import { DNA_FIELDS, type DnaField, type PersonaDna } from "../db/schema";
import type { StructuredRequest } from "../llm/types";

export const DNA_TEXT_MAX = 20_000;
export const FIELD_MAX = 600;

/** The framework's labels (as the owner wrote them) and what each field holds — for Claude and the prompt. */
export const DNA_LABELS: Record<DnaField, { label: string; hint: string }> = {
  gender: { label: "Gender", hint: "e.g. Female" },
  age: { label: "Age", hint: "Apparent age, adult (18+), e.g. 24 years old" },
  ethnicity: { label: "Ethnicity / Skin Tone", hint: "Ethnicity and skin tone, distinctive skin features" },
  hairStyle: { label: "Hair Style", hint: "Length, texture, parting, how it is usually worn" },
  hairColour: { label: "Hair Colour", hint: "One exact colour" },
  clothing: { label: "Clothing Style", hint: "Signature outfit, colours, materials, jewellery" },
  mood: { label: "Mood / Emotion", hint: "The usual expression and attitude" },
  environment: { label: "Environment / Setting", hint: "The signature place where the persona is shown" },
  camera: { label: "Camera Angle", hint: "e.g. Mid-shot, eye-level portrait" },
  pose: { label: "Pose / Action", hint: "The signature pose or action" },
  lighting: { label: "Lighting", hint: "Type, direction and quality of light" },
  style: { label: "Style / Medium", hint: "e.g. Photorealistic digital photography" },
  extra: { label: "Extra Notes", hint: "Distinctive features that must always be visible: eyes, marks, accessories" },
};

const field = z.string().trim().max(FIELD_MAX);
export const personaDnaSchema = z.object(Object.fromEntries(DNA_FIELDS.map((f) => [f, field.describe(`${DNA_LABELS[f].label}: ${DNA_LABELS[f].hint}`)])) as Record<DnaField, typeof field>);
export const dnaToolSchema = z.object({
  name: z.string().trim().min(1).max(80).describe("The persona's name (keep the given one; else invent a fitting first name)."),
  dna: personaDnaSchema,
});

export const emptyDna = (): PersonaDna => Object.fromEntries(DNA_FIELDS.map((f) => [f, ""])) as PersonaDna;

/** Fields that make the person who they are — kept in every picture, whatever the scene. */
export const IDENTITY: DnaField[] = ["gender", "age", "ethnicity", "hairStyle", "hairColour", "extra"];

/** The DNA as labelled lines for an image prompt (only filled fields), in the framework's order. */
export function dnaBlock(dna: PersonaDna, fields: readonly DnaField[] = DNA_FIELDS): string {
  return fields.filter((k) => dna[k]?.trim()).map((k) => `${DNA_LABELS[k].label}: ${dna[k].trim()}`).join("\n");
}

/** A DNA is usable when the identity is described: gender, age, ethnicity/skin and hair. */
export function dnaComplete(dna: PersonaDna): boolean {
  return (["gender", "age", "ethnicity", "hairColour"] as const).every((k) => dna[k]?.trim());
}

export function dnaRequest(i: { text: string; name: string; brandName: string; brandContext: string }): Omit<StructuredRequest, "model"> {
  const schema = z.toJSONSchema(dnaToolSchema, { target: "draft-2020-12", io: "input" }) as Record<string, unknown>;
  delete schema.$schema;
  return {
    system: [{
      text: `You fill in the DNA of an AI influencer (a recurring synthetic person) for Postaja. Every photo and video of the
persona is generated from this DNA, so each field must be concrete and visual. Fields:
${DNA_FIELDS.map((f) => `- ${f} (${DNA_LABELS[f].label}): ${DNA_LABELS[f].hint}`).join("\n")}
Rules:
- The owner gives a rough description, or a full DNA (maybe in Slovenian). Keep every detail they give — never
  contradict or soften it — and write it in clear English.
- Fill every field they leave out with one specific choice that fits the description and the brand (no alternatives
  like "brown or black"). Distinctive, memorable features help keep the person recognisable.
- An adult (18+), fictional person. Never a real or famous person's likeness: if asked to copy one, describe an
  original person with a similar vibe instead. No sexualised descriptions.
- Short phrases, like a casting sheet, not prose.`,
      cache: true,
    }],
    user: [
      `<brand name="${i.brandName.replace(/"/g, "'")}">\n${i.brandContext.slice(0, 4000)}\n</brand>`,
      i.name.trim() ? `<persona_name>${i.name.trim()}</persona_name>` : "",
      `<owner_text>\n${i.text.slice(0, DNA_TEXT_MAX)}\n</owner_text>`,
      "Submit the persona's DNA.",
    ].filter(Boolean).join("\n"),
    tool: { name: "submit_persona_dna", description: "Submit the persona's DNA.", inputSchema: schema },
    maxTokens: 2000,
    timeoutMs: 2 * 60_000,
  };
}
