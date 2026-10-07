import { describe, expect, it } from "vitest";
import { slugSchema } from "@/server/brands/schemas";
import { slugify } from ".";

describe("slugify", () => {
  it("turns a brand name into a valid short name", () => {
    expect(slugify("Inženirji")).toBe("inzenirji");
    expect(slugify("aibuilders.si")).toBe("aibuilders-si");
    expect(slugify("  CHERR.IO  Polygon ")).toBe("cherr-io-polygon");
    expect(slugify("Čebelarstvo Šentjur & Žalec – Đurđa")).toBe("cebelarstvo-sentjur-zalec-durda");
    expect(slugify("!!!")).toBe("");
    const long = slugify("a".repeat(30) + " " + "b".repeat(30));
    expect(long.length).toBeLessThanOrEqual(48);
    for (const n of ["Inženirji", "aibuilders.si", "Ćevapi d.o.o.", long]) expect(slugSchema.safeParse(slugify(n)).success).toBe(true);
  });
});
