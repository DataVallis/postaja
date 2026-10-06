// Brand design (TASK-017): the spec rules, text fitting and emphasis, rendering at every shape, the fonts, and the
// shape of what Claude is asked for.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { cardDesign, monoDesign } from "../../../tests/fixtures/design";
import { inspectFont, woffToSfnt } from "../files/font";
import { createDesignRequest, postVisualRequest, postVisualSchema, reviseDesignRequest, type DesignInputs } from "./ai";
import { fitText, parseEmphasis, renderTemplate } from "./render";
import { color, designJsonSchema, designSpecSchema, needsIllustration, templateSlots } from "./spec";

const card = designSpecSchema.parse(cardDesign);
const mono = designSpecSchema.parse(monoDesign);
const px = async (png: Uint8Array, x: number, y: number) => [...(await sharp(png).extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer()).subarray(0, 3)];

describe("spec", () => {
  it("accepts the sample designs and fills defaults", () => {
    const headline = card.templates[0].elements.find((e) => e.type === "text" && e.slot === "headline")!;
    expect(headline).toMatchObject({ font: "heading", weight: 700, align: "left", valign: "top", uppercase: false });
  });

  it("refuses duplicate template ids, templates without a text slot, bad colours and out-of-canvas boxes", () => {
    const dup = { ...cardDesign, templates: [cardDesign.templates[0], { ...cardDesign.templates[1], id: "cover" }] };
    expect(designSpecSchema.safeParse(dup).success).toBe(false);
    const noSlot = { ...cardDesign, templates: [cardDesign.templates[0], { ...cardDesign.templates[1], elements: [{ type: "shape", x: 0, y: 0, w: 10, h: 10, color: "accent" }] }] };
    expect(designSpecSchema.safeParse(noSlot).success).toBe(false);
    expect(designSpecSchema.safeParse({ ...cardDesign, palette: { ...cardDesign.palette, accent: "red" } }).success).toBe(false);
    const outside = structuredClone(cardDesign);
    (outside.templates[0].elements[0] as { x: number }).x = 140;
    expect(designSpecSchema.safeParse(outside).success).toBe(false);
    expect(designSpecSchema.safeParse({ ...cardDesign, templates: [cardDesign.templates[0]] }).success).toBe(false); // at least 2
  });

  it("resolves palette keys, lists slots and knows which templates need an illustration", () => {
    expect(color(card, "accent")).toBe("#e0112b");
    expect(color(card, "#123456")).toBe("#123456");
    expect(templateSlots(card.templates[0])).toEqual(["label", "headline", "footer"]);
    expect(needsIllustration(card.templates[0])).toBe(true);
    expect(needsIllustration(card.templates[1])).toBe(false);
  });

  it("gives Claude a JSON schema for the tool", () => {
    const s = designJsonSchema();
    expect(s.type).toBe("object");
    expect(Object.keys(s.properties as object)).toEqual(["summary", "illustrationStyle", "palette", "typography", "templates"]);
    // Plain JSON Schema only: no $schema, $ref or record constructs (an API 400 on dev, 2026-10-06, made us strict).
    for (const k of ["$schema", "$ref", "propertyNames"]) expect(JSON.stringify(s)).not.toContain(k);
  });
});

describe("text", () => {
  it("reads *emphasis* across words and keeps line breaks", () => {
    expect(parseEmphasis("Daš. *Zaklenjeno je.*\nIzplača *se*")).toEqual([
      [{ word: "Daš.", em: false }, { word: "Zaklenjeno", em: true }, { word: "je.", em: true }],
      [{ word: "Izplača", em: false }, { word: "se", em: true }],
    ]);
    expect(parseEmphasis("brez")).toEqual([[{ word: "brez", em: false }]]);
  });

  it("fits text into its box: smaller for longer text, never below the minimum", () => {
    const o = { max: 100, min: 30, lineHeight: 1.1, widthEm: 0.56, letterSpacing: 0 };
    const short = fitText([["Kratko"]], 900, 400, o);
    const long = fitText([["To", "je", "precej", "daljši", "naslov", "ki", "gre", "čez", "več", "vrstic", "zagotovo"]], 900, 400, o);
    expect(short).toBe(100);
    expect(long).toBeLessThan(short);
    expect(long).toBeGreaterThanOrEqual(30);
    expect(fitText([["x".repeat(200)]], 900, 100, o)).toBe(30);
  });
});

describe("render", () => {
  it("built-in fonts cover č š ž ć đ", () => {
    for (const f of fs.readdirSync("assets/fonts").filter((x) => x.endsWith(".woff"))) {
      expect(inspectFont(woffToSfnt(fs.readFileSync(path.join("assets/fonts", f)))).missingGlyphs, f).toEqual([]);
    }
  });

  it("every sample template renders at 4:5, 1:1 and 16:9", async () => {
    for (const spec of [card, mono]) {
      for (const t of spec.templates) {
        for (const size of [{ width: 1080, height: 1350 }, { width: 1080, height: 1080 }, { width: 1600, height: 900 }]) {
          const png = await renderTemplate(spec, t, size, { slots: t.sample });
          expect(await sharp(png).metadata()).toMatchObject({ format: "png", ...size });
        }
      }
    }
  });

  it("draws the illustration full-bleed, the logo in its box and the emphasis colour", async () => {
    const illustration = new Uint8Array(await sharp({ create: { width: 800, height: 1000, channels: 3, background: "#00ff00" } }).jpeg().toBuffer());
    const logo = new Uint8Array(await sharp({ create: { width: 400, height: 100, channels: 4, background: "#0000ff" } }).png().toBuffer());
    const png = await renderTemplate(card, card.templates[0], { width: 1080, height: 1350 }, { slots: { headline: "*ČŠŽ*", label: "x" }, illustration, logo });
    const [r, g] = await px(png, 20, 20); // top: the green picture, lightly darkened
    expect(g).toBeGreaterThan(150);
    expect(r).toBeLessThan(80);
    // Logo box: x 7–31 %, y 88–95 % → its centre is blue.
    const [lr, lg, lb] = await px(png, Math.round(0.19 * 1080), Math.round(0.915 * 1350));
    expect([lr < 60, lg < 60, lb > 180]).toEqual([true, true, true]);
    // Somewhere in the headline box the emphasis red is drawn.
    const { data, info } = await sharp(png).extract({ left: 75, top: 553, width: 930, height: 486 }).raw().toBuffer({ resolveWithObject: true });
    let red = 0;
    for (let i = 0; i < data.length; i += info.channels) if (data[i] > 190 && data[i + 1] < 60 && data[i + 2] < 80) red++;
    expect(red).toBeGreaterThan(500);
  });

  it("a design asking for the brand font falls back to a built-in one when none is uploaded", async () => {
    const spec = designSpecSchema.parse({ ...monoDesign, typography: { heading: "brand", body: "brand" } });
    const png = await renderTemplate(spec, spec.templates[1], { width: 1080, height: 1080 }, { slots: { body: "> čšž" } });
    expect(png.byteLength).toBeGreaterThan(1000);
  });
});

describe("what Claude is asked", () => {
  const inputs: DesignInputs = {
    brand: { name: "Cherr", website: null, languages: ["sl"] }, cgp: "Ton: jasen.", colors: { accent: "#e0112b" }, imageStyle: "", negativePrompt: "",
    brief: "Temne kartice z rdečim poudarkom", hasLogo: true, brandFont: null, examples: [{ mediaType: "image/jpeg", data: "AAA" }], logo: { mediaType: "image/jpeg", data: "BBB" },
  };

  it("a new design shows the logo and past posts and includes the owner's words", () => {
    const r = createDesignRequest(inputs);
    expect(r.images!.map((i) => i.caption)).toEqual(["The brand logo:", "Past post of this brand 1/1:"]);
    expect(r.user).toContain("Temne kartice z rdečim poudarkom");
    expect(r.user).toContain('past_post_images="1"');
    expect(r.tool.name).toBe("submit_brand_design");
    // A whole design takes minutes to write; the default 90 s timeout cut it off on dev (owner, 2026-10-06).
    expect(r.timeoutMs).toBeGreaterThanOrEqual(5 * 60_000);
    expect(reviseDesignRequest(inputs, card, "x", []).timeoutMs).toBeGreaterThanOrEqual(5 * 60_000);
  });

  it("a revision includes the current design, its previews and the request", () => {
    const r = reviseDesignRequest(inputs, card, "naslov večji", [{ mediaType: "image/jpeg", data: "CCC", caption: 'Current template "cover":' }]);
    expect(r.user).toContain("naslov večji");
    expect(r.user).toContain('"id":"cover"');
    expect(r.images!.at(-1)!.caption).toBe('Current template "cover":');
  });

  it("per post: only the brand's template ids are accepted", () => {
    const s = postVisualSchema(card);
    expect(s.safeParse({ slides: [{ templateId: "cover", slots: { headline: "A" }, illustration: "x" }] }).success).toBe(true);
    expect(s.safeParse({ slides: [{ templateId: "nope", slots: {}, illustration: null }] }).success).toBe(false);
    const r = postVisualRequest(card, { brandName: "Cherr", language: "sl", platform: "instagram", format: "carousel", brief: "b", plan: { slides: ["Ena", "Dva"] }, caption: null });
    expect(r.user).toContain('"id":"points"');
    expect(r.system[0].text).toContain(card.summary);
  });
});
