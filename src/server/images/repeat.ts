// Words on an image must not repeat the caption under it (TASK-052, owner: "Ne more na postu in na sliki enako pisat").
// Lexical and deterministic: a run of five words in a row taken from the caption, or most of the image's words found in
// it, counts as a repeat. Hooks may share a word or two with the caption.
import { stems } from "../ideas/similar";

const words = (s: string) => s.replace(/\*/g, "").normalize("NFKC").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

export function repeatsCaption(imageText: string, caption: string): boolean {
  const img = words(imageText);
  const cap = words(caption);
  if (img.length < 5 || cap.length < 5) return false;
  const runs = new Set<string>();
  for (let i = 0; i + 5 <= cap.length; i++) runs.add(cap.slice(i, i + 5).join(" "));
  for (let i = 0; i + 5 <= img.length; i++) if (runs.has(img.slice(i, i + 5).join(" "))) return true;
  const capStems = new Set(stems(caption));
  const imgStems = stems(imageText);
  if (imgStems.length < 8) return false;
  return imgStems.filter((s) => capStems.has(s)).length / imgStems.length >= 0.8;
}
