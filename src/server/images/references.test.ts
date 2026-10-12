import { describe, expect, it } from "vitest";
import { mentionedReferences, resolveReferences, type ReferenceChoice } from "./references";

const c = (key: string, name: string): ReferenceChoice => ({ key, name, kind: "reference" });
const choices = [c("asset:a", "Certificate (EN)@2x.png"), c("asset:b", "Certificate.png"), c("source:s", "foto 1.jpg")];

describe("reference tags (TASK-057)", () => {
  it("finds @file-name tags, names with spaces and @ included, longest name first, in order of appearance", () => {
    expect(mentionedReferences("v telefonu @Certificate (EN)@2x.png, ozadje @foto 1.jpg", choices)).toEqual(["asset:a", "source:s"]);
    expect(mentionedReferences("@certificate.png in @CERTIFICATE (EN)@2X.PNG", choices)).toEqual(["asset:b", "asset:a"]);
    expect(mentionedReferences("Certificate.png brez afne", choices)).toEqual([]);
  });

  it("picked first, then tagged; unique, only known keys, at most 4", () => {
    const many = Array.from({ length: 6 }, (_, i) => c(`asset:${i}`, `r${i}.png`));
    expect(resolveReferences(["asset:b", "asset:zzz", "x:../y"], "@Certificate.png in @foto 1.jpg", choices)).toEqual(["asset:b", "source:s"]);
    expect(resolveReferences(many.map((m) => m.key), "", many)).toHaveLength(4);
  });
});
