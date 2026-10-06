// Which material text goes into a post prompt (TASK-009, ADR-039). Pure and deterministic.
// All of it when it fits the budget; otherwise the passages that share the most words with the request (BM25 over
// paragraphs-sized chunks, diacritics folded so "cenik" finds "Cenik" and "zalozba" finds "založba"), always keeping
// each chosen passage whole and in the document's own order. No embeddings yet (ADR-008 is open).

export type Material = { name: string; text: string };
export type Chunk = { doc: number; index: number; text: string };

export const CHUNK_CHARS = 1500;

const STOP = new Set(
  ("in ali pa da je so se na za po pri od do iz ki kot tudi ter bo bi ne ni the and for with that this from are was were you your our not but have has can will about into what " +
    "objava objavo objave napisi napisite post write instagram facebook linkedin tiktok youtube").split(" "),
);

/** Lower-case, diacritics folded (č→c, ž→z, đ→d), words of ≥ 3 letters/digits without stop words. */
export function terms(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/đ/g, "d")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

/** Paragraph-aligned chunks of at most CHUNK_CHARS (a longer paragraph is cut on whitespace). Headings stay with what follows. */
export function chunk(text: string, max = CHUNK_CHARS): string[] {
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  const push = () => { if (cur) out.push(cur); cur = ""; };
  for (let p of paras) {
    while (p.length > max) {
      const cut = p.lastIndexOf(" ", max) > max / 2 ? p.lastIndexOf(" ", max) : max;
      push();
      out.push(p.slice(0, cut).trim());
      p = p.slice(cut).trim();
    }
    if (cur && cur.length + 2 + p.length > max) push();
    cur = cur ? `${cur}\n\n${p}` : p;
  }
  push();
  return out;
}

/**
 * Picks material for a prompt within `budget` characters. Materials are given newest first; on equal scores the newer
 * document wins. Returns per document the chosen passages joined with "\n[…]\n" where text was left out.
 */
export function selectMaterials(materials: Material[], query: string, budget: number): Material[] {
  const total = materials.reduce((n, m) => n + m.text.length, 0);
  if (total <= budget) return materials.filter((m) => m.text.trim());

  const chunks: Chunk[] = materials.flatMap((m, doc) => chunk(m.text).map((text, index) => ({ doc, index, text })));
  const q = [...new Set(terms(query))];
  const tfs = chunks.map((c) => {
    const tf = new Map<string, number>();
    for (const t of terms(`${materials[c.doc].name}\n${c.text}`)) tf.set(t, (tf.get(t) ?? 0) + 1);
    return tf;
  });
  const lens = tfs.map((tf) => [...tf.values()].reduce((a, b) => a + b, 0));
  const avg = lens.reduce((a, b) => a + b, 0) / Math.max(1, lens.length);
  const N = chunks.length;
  const idf = new Map(q.map((t) => {
    const df = tfs.filter((tf) => tf.has(t)).length;
    return [t, Math.log(1 + (N - df + 0.5) / (df + 0.5))];
  }));
  const k1 = 1.2, b = 0.75;
  const score = (i: number) =>
    q.reduce((s, t) => {
      const f = tfs[i].get(t) ?? 0;
      return f ? s + idf.get(t)! * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * lens[i]) / (avg || 1)))) : s;
    }, 0);

  const order = chunks
    .map((c, i) => ({ i, s: score(i), c }))
    // best score first; then newer document, then earlier in the document (so with no match the start of the newest wins)
    .sort((x, y) => y.s - x.s || x.c.doc - y.c.doc || x.c.index - y.c.index);
  const picked: Chunk[] = [];
  let left = budget;
  for (const { c } of order) {
    const cost = c.text.length + 8; // + a possible "[…]" separator
    if (cost > left) continue;
    picked.push(c);
    left -= cost;
    if (left < 200) break;
  }
  return materials
    .map((m, doc) => {
      const mine = picked.filter((c) => c.doc === doc).sort((x, y) => x.index - y.index);
      if (!mine.length) return null;
      const parts: string[] = [];
      mine.forEach((c, k) => {
        if (k === 0 ? c.index > 0 : c.index !== mine[k - 1].index + 1) parts.push("[…]");
        parts.push(c.text);
      });
      return { name: m.name, text: parts.join("\n\n") };
    })
    .filter((m): m is Material => m !== null);
}
