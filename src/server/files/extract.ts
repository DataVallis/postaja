// Verbatim text from a document (TASK-008, ADR-037): PDF (pdf.js via unpdf), DOCX (in-house over the safe unzip),
// TXT/MD. No AI anywhere — the owner's own words are copied, with headings and list items kept as Markdown.
// TASK-009: also XLSX (sheets → rows "a | b | c") and PPTX (slides in order) for material text used by generation.
import { sniff } from "./sniff";
import { unzip } from "./zip";

export class ExtractError extends Error {
  constructor(public readonly code: "UNSUPPORTED_TYPE" | "INVALID_FILE" | "NO_TEXT") {
    super(code);
  }
}

/** DOCX parts are small; these limits are far above any real document and far below a bomb. */
const DOCX_ZIP_LIMITS = { maxEntries: 5000, maxEntryBytes: 30 * 1024 * 1024, maxTotalBytes: 120 * 1024 * 1024 };

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

function officeEntries(bytes: Uint8Array): Map<string, Uint8Array> {
  let entries;
  try {
    entries = unzip(bytes, DOCX_ZIP_LIMITS);
  } catch {
    throw new ExtractError("INVALID_FILE");
  }
  const m = new Map<string, Uint8Array>();
  for (const e of entries) if (e.ok) m.set(e.name, e.bytes);
  return m;
}
const xmlOf = (m: Map<string, Uint8Array>, name: string) => {
  const b = m.get(name);
  return b ? new TextDecoder().decode(b) : undefined;
};
/** Relationship id → part path (resolved against `base`, e.g. "xl/"). */
function rels(xml: string | undefined, base: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of (xml ?? "").matchAll(/<Relationship\b[^>]*>/g)) {
    const id = r[0].match(/\bId="([^"]+)"/)?.[1];
    const target = r[0].match(/\bTarget="([^"]+)"/)?.[1];
    if (!id || !target) continue;
    out.set(id, target.startsWith("/") ? target.slice(1) : normalizePath(base + target));
  }
  return out;
}
function normalizePath(p: string) {
  const parts: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}
const textRuns = (xml: string, tag: "t" | "a:t") => [...xml.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => decodeXml(m[1])).join("");

/** Rows per sheet and characters in total; spreadsheets can be huge, material text is for a prompt. */
export const XLSX_MAX_ROWS = 5000;
export const MATERIAL_TEXT_MAX = 300_000;

/** Excel workbook → "## Sheet" + one line per non-empty row, cells joined by " | " (shared and inline strings, numbers as stored). */
export function xlsxToText(bytes: Uint8Array): string {
  const m = officeEntries(bytes);
  const workbook = xmlOf(m, "xl/workbook.xml");
  if (!workbook) throw new ExtractError("INVALID_FILE");
  const shared = [...(xmlOf(m, "xl/sharedStrings.xml") ?? "").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((x) => textRuns(x[1], "t"));
  const map = rels(xmlOf(m, "xl/_rels/workbook.xml.rels"), "xl/");
  const out: string[] = [];
  for (const sh of workbook.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = decodeXml(sh[0].match(/\bname="([^"]*)"/)?.[1] ?? "");
    const rid = sh[0].match(/\br:id="([^"]+)"/)?.[1];
    const xml = rid ? xmlOf(m, map.get(rid) ?? "") : undefined;
    if (!xml) continue;
    const rows: string[] = [];
    for (const row of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      if (rows.length >= XLSX_MAX_ROWS) break;
      const cells: string[] = [];
      for (const c of (row[1] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const t = c[1].match(/\bt="([^"]+)"/)?.[1];
        const body = c[2] ?? "";
        const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let val = "";
        if (t === "s") val = shared[Number(v)] ?? "";
        else if (t === "inlineStr") val = textRuns(body, "t");
        else if (t === "b") val = v === "1" ? "TRUE" : v === "0" ? "FALSE" : "";
        else if (v !== undefined) val = decodeXml(v);
        cells.push(val.replace(/\s+/g, " ").trim());
      }
      while (cells.length && !cells[cells.length - 1]) cells.pop();
      if (cells.some(Boolean)) rows.push(cells.join(" | "));
    }
    if (rows.length) out.push(`## ${name}`, ...rows, "");
  }
  return tidy(out.join("\n")).slice(0, MATERIAL_TEXT_MAX);
}

/** PowerPoint → "## Prosojnica N" + the text of each paragraph, slides in presentation order (speaker notes left out). */
export function pptxToText(bytes: Uint8Array): string {
  const m = officeEntries(bytes);
  const pres = xmlOf(m, "ppt/presentation.xml");
  if (!pres) throw new ExtractError("INVALID_FILE");
  const map = rels(xmlOf(m, "ppt/_rels/presentation.xml.rels"), "ppt/");
  let slides = [...pres.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)].map((x) => map.get(x[1])).filter((x): x is string => !!x && m.has(x));
  if (!slides.length) slides = [...m.keys()].filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  const out: string[] = [];
  slides.forEach((path, i) => {
    const xml = xmlOf(m, path)!;
    const lines = [...xml.matchAll(/<a:p\b[^>]*?(?:\/>|>([\s\S]*?)<\/a:p>)/g)].map((p) => textRuns(p[1] ?? "", "a:t").trim()).filter(Boolean);
    if (lines.length) out.push(`## Prosojnica ${i + 1}`, ...lines, "");
  });
  return tidy(out.join("\n")).slice(0, MATERIAL_TEXT_MAX);
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

/** Text of a stored brand source by its kind (TASK-009). Images have none. Capped at MATERIAL_TEXT_MAX characters. */
export async function materialText(bytes: Uint8Array, kind: string): Promise<string> {
  let text: string;
  if (kind === "pdf") text = await pdfToText(bytes);
  else if (kind === "docx") text = docxToText(bytes);
  else if (kind === "xlsx") text = xlsxToText(bytes);
  else if (kind === "pptx") text = pptxToText(bytes);
  else if (kind === "text" || kind === "csv") text = tidy(new TextDecoder().decode(bytes).replace(/^\uFEFF/, ""));
  else throw new ExtractError("UNSUPPORTED_TYPE");
  if (!text) throw new ExtractError("NO_TEXT");
  return text.slice(0, MATERIAL_TEXT_MAX);
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
