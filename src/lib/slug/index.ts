// Short names (slugs) from a display name: "Inženirji d.o.o." → "inzenirji-d-o-o". Same rules as slugSchema
// (lowercase a–z, 0–9 and dashes, no dash at either end, at most 48 characters).
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/g, "d").replace(/Đ/g, "d").replace(/ß/g, "ss").replace(/æ/gi, "ae").replace(/ø/gi, "o").replace(/ł/gi, "l")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}
