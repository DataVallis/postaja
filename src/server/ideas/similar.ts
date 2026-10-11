// No-repeat memory v1 (TASK-019, ADR-048): how close a new idea is to the brand's earlier posts. Lexical, deterministic
// and free — TF-IDF cosine over folded word stems (first 5 letters, so "objave"/"objavo" and "korak"/"koraki" meet) —
// until an embedding provider is chosen (ADR-008). Topic summaries are English sentences, plan topics are in the plan's
// language; both are compared as written.
import { terms } from "../posts/retrieve";

export type Doc = { id: string; text: string };
export type Match = { id: string; score: number };

/** At or above: the idea repeats a recent post and is replaced. */
export const REPEAT_BLOCK = 0.6;
/** At or above: shown as "podobno" so the owner decides. */
export const REPEAT_WARN = 0.4;

const STEM = 5;
export const stems = (s: string) => terms(s).map((w) => (/^\d+$/.test(w) ? w : w.slice(0, STEM)));

/** A scorer over a corpus: IDF from the corpus plus the queries, so words every post uses count little. */
export function similarity(corpus: Doc[], queries: string[] = []) {
  const docs = corpus.map((d) => ({ id: d.id, terms: stems(d.text) }));
  const df = new Map<string, number>();
  const all = [...docs.map((d) => d.terms), ...queries.map(stems)];
  for (const ts of all) for (const t of new Set(ts)) df.set(t, (df.get(t) ?? 0) + 1);
  const n = all.length;
  const idf = (t: string) => Math.log((n + 1) / ((df.get(t) ?? 0) + 1)) + 1;
  const vec = (ts: string[]) => {
    const tf = new Map<string, number>();
    for (const t of ts) tf.set(t, (tf.get(t) ?? 0) + 1);
    const v = new Map<string, number>();
    let norm = 0;
    for (const [t, c] of tf) { const w = (1 + Math.log(c)) * idf(t); v.set(t, w); norm += w * w; }
    return { v, norm: Math.sqrt(norm) };
  };
  const vecs = docs.map((d) => ({ id: d.id, ...vec(d.terms) }));
  const cos = (a: ReturnType<typeof vec>, b: ReturnType<typeof vec>) => {
    if (!a.norm || !b.norm) return 0;
    let dot = 0;
    for (const [t, w] of a.v) dot += w * (b.v.get(t) ?? 0);
    return dot / (a.norm * b.norm);
  };
  return {
    /** The closest earlier post, or null when nothing shares a word. */
    closest(text: string): Match | null {
      const q = vec(stems(text));
      let best: Match | null = null;
      for (const d of vecs) {
        const score = cos(q, d);
        if (score > 0 && (!best || score > best.score)) best = { id: d.id, score };
      }
      return best;
    },
    between(a: string, b: string) {
      return cos(vec(stems(a)), vec(stems(b)));
    },
  };
}
