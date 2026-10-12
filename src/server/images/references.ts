// Reference pictures in image corrections (TASK-057): the owner picks pictures from the brand's files (reference
// pictures, image materials, logos) or adds one, and/or tags them in the request as @file-name. Claude sees them next
// to the current images and says which image shows which; the illustration of that image is then edited with them
// (the current picture + the references go to the reference model), so a certificate, product or screen appears as it is.
import { and, eq, inArray } from "drizzle-orm";
import sharp from "sharp";
import type { Db } from "../db/client";
import { brandAssets, brandSources } from "../db/schema";
import { MAX_INPUT_PIXELS } from "../files/images";
import type { Storage } from "../files/storage";
import type { ImageBlock } from "../llm/types";
import type { OrgContext } from "../tenancy/context";
import { forOrg } from "../tenancy/scoped";

export const MAX_REFERENCES = 4;

/** A picture that can be a reference: `key` = "asset:<id>" or "source:<id>". */
export type ReferenceChoice = { key: string; name: string; kind: "reference" | "image" | "logo" };
export type ReferenceImage = { key: string; name: string; dataUri: string; block: ImageBlock };

const KEY = /^(asset|source):([A-Za-z0-9_-]{1,100})$/;

/** Every picture of the brand that may be used as a reference: reference pictures first, then image materials, logos. */
export async function referenceChoices(db: Db, ctx: OrgContext, brandId: string): Promise<ReferenceChoice[]> {
  const s = forOrg(db, ctx);
  const [assets, sources] = await Promise.all([
    s.select(brandAssets, and(eq(brandAssets.brandId, brandId), inArray(brandAssets.kind, ["reference", "logo"]))!) .then((r) => r as unknown as (typeof brandAssets.$inferSelect)[]),
    s.select(brandSources, and(eq(brandSources.brandId, brandId), eq(brandSources.kind, "image"))!) .then((r) => r as unknown as (typeof brandSources.$inferSelect)[]),
  ]);
  const newest = <T extends { createdAt: Date }>(a: T, b: T) => b.createdAt.getTime() - a.createdAt.getTime();
  return [
    ...assets.filter((a) => a.kind === "reference").sort(newest).map((a) => ({ key: `asset:${a.id}`, name: a.filename, kind: "reference" as const })),
    ...sources.sort(newest).map((x) => ({ key: `source:${x.id}`, name: x.filename, kind: "image" as const })),
    ...assets.filter((a) => a.kind === "logo").sort(newest).map((a) => ({ key: `asset:${a.id}`, name: a.filename, kind: "logo" as const })),
  ];
}

/**
 * The pictures a request tags as "@file-name" (file names may hold spaces and "@": the longest name that follows an
 * "@" wins), in the order they appear.
 */
export function mentionedReferences(instruction: string, choices: ReferenceChoice[]): string[] {
  const byLength = [...choices].sort((a, b) => b.name.length - a.name.length);
  const found: { at: number; key: string }[] = [];
  const taken: [number, number][] = [];
  for (const c of byLength) {
    const needle = `@${c.name}`.toLowerCase();
    let from = 0;
    const text = instruction.toLowerCase();
    for (let at = text.indexOf(needle, from); at >= 0; at = text.indexOf(needle, from)) {
      from = at + needle.length;
      if (taken.some(([a, b]) => at < b && at + needle.length > a)) continue;
      taken.push([at, at + needle.length]);
      if (!found.some((f) => f.key === c.key)) found.push({ at, key: c.key });
    }
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.key);
}

/** Picked + tagged references, unique, in that order, at most MAX_REFERENCES; unknown keys are dropped. */
export function resolveReferences(picked: string[], instruction: string, choices: ReferenceChoice[]): string[] {
  const known = new Set(choices.map((c) => c.key));
  const all = [...picked.filter((k) => KEY.test(k)), ...mentionedReferences(instruction, choices)];
  return [...new Set(all)].filter((k) => known.has(k)).slice(0, MAX_REFERENCES);
}

/** The pictures (this brand's only), as data URIs for the image model and as blocks for Claude. */
export async function loadReferences(db: Db, storage: Storage, ctx: OrgContext, brandId: string, keys: string[]): Promise<ReferenceImage[]> {
  const out: ReferenceImage[] = [];
  for (const key of keys.slice(0, MAX_REFERENCES)) {
    const m = key.match(KEY);
    if (!m) continue;
    const t = m[1] === "asset" ? brandAssets : brandSources;
    const [row] = (await forOrg(db, ctx).select(t, and(eq(t.id, m[2]), eq(t.brandId, brandId))!)) as { storageKey: string; filename: string; contentType: string }[];
    if (!row || !row.contentType.startsWith("image/")) continue;
    // Flattened on white (logos and screenshots may be transparent), at most 1536 px.
    const jpeg = await sharp(await storage.get(row.storageKey), { limitInputPixels: MAX_INPUT_PIXELS })
      .resize({ width: 1536, height: 1536, fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 90 }).toBuffer();
    const small = await sharp(jpeg).resize({ width: 768, height: 768, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
    out.push({
      key, name: row.filename, dataUri: `data:image/jpeg;base64,${jpeg.toString("base64")}`,
      block: { mediaType: "image/jpeg", data: small.toString("base64"), caption: `Reference R${out.length + 1} "${row.filename}":` },
    });
  }
  return out;
}
