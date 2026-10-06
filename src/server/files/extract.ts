// Verbatim text from a document (TASK-008, ADR-037): PDF (pdf.js via unpdf), DOCX (in-house over the safe unzip),
// TXT/MD. No AI anywhere — the owner's own words are copied, with headings and list items kept as Markdown.
import { sniff } from "./sniff";
import { unzip } from "./zip";

export class ExtractError extends Error {
  constructor(public readonly code: "UNSUPPORTED_TYPE" | "INVALID_FILE" | "NO_TEXT") {
    super(code);
  }
}

/** DOCX parts are small; these limits are far above any real document and far below a bomb. */
const DOCX_ZIP_LIMITS = { maxEntries: 2000, maxEntryBytes: 30 * 1024 * 1024, maxTotalBytes: 120 * 1024 * 1024 };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
    }
    return ENTITIES[e.toLowerCase()];
  });
}

/** Normalises line endings and blank lines; trims trailing spaces. */
export function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t ]+$/u, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Word body → Markdown-ish text: Heading N / Naslov N / Title → "#", numbered or bulleted paragraphs → "- ". */
export function docxToText(bytes: Uint8Array): string {
  let entries;
  try {
    entries = unzip(bytes, DOCX_ZIP_LIMITS);
  } catch {
    throw new ExtractError("INVALID_FILE");
  }
  const doc = entries.find((e) => e.name === "word/document.xml");
  if (!doc || !doc.ok) throw new ExtractError("INVALID_FILE");
  const xml = new TextDecoder().decode(doc.bytes);
  const body = xml.match(/<w:body\b[^>]*>([\s\S]*)<\/w:body>/)?.[1] ?? "";
  const out: string[] = [];
  for (const m of body.matchAll(/<w:p\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:p>)/g)) {
    const p = m[1] ?? "";
    const style = p.match(/<w:pStyle\b[^>]*w:val="([^"]+)"/)?.[1] ?? "";
    const level = /^title$|^naslov$/i.test(style) ? 1 : Number(style.match(/^(?:heading|naslov)\s?(\d)$/i)?.[1] ?? 0);
    const listItem = /<w:numPr\b/.test(p);
    let text = "";
    for (const r of p.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>|<w:cr\b[^>]*\/>/g)) {
      if (r[1] !== undefined) text += decodeXml(r[1]);
      else text += r[0].startsWith("<w:tab") ? "\t" : "\n";
    }
    if (!text.trim()) { out.push(""); continue; }
    out.push(level ? `${"#".repeat(Math.min(level, 6))} ${text.trim()}` : listItem ? `- ${text.trim()}` : text);
  }
  return tidy(out.join("\n"));
}

/** PDF text page by page (pages separated by a blank line). Scanned PDFs have no text → NO_TEXT. */
export async function pdfToText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  let pages: string[];
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes)); // pdf.js takes ownership of the buffer: pass a copy
    pages = (await extractText(pdf, { mergePages: false })).text;
  } catch {
    throw new ExtractError("INVALID_FILE");
  }
  return tidy(pages.join("\n\n"));
}

/** The document's own text, verbatim apart from whitespace tidying. */
export async function documentText(bytes: Uint8Array): Promise<{ kind: "pdf" | "docx" | "text"; text: string }> {
  const type = sniff(bytes);
  let text: string;
  if (type === "pdf") text = await pdfToText(bytes);
  else if (type === "docx") text = docxToText(bytes);
  else if (type === "text") text = tidy(new TextDecoder().decode(bytes).replace(/^﻿/, ""));
  else throw new ExtractError("UNSUPPORTED_TYPE");
  if (!text) throw new ExtractError("NO_TEXT");
  return { kind: type, text };
}
