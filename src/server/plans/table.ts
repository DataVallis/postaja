// Content plans as tables (TASK-012): XLSX sheets or CSV → header + rows of text cells, ready for column mapping.
import { xlsxSheets } from "../files/extract";

export type PlanTable = { sheet: string; headerRow: number; header: string[]; rows: { n: number; cells: string[] }[] };

export const MAX_PLAN_ROWS = 2000;

/** RFC 4180 CSV with quoted fields (commas, semicolons, tabs or newlines inside quotes); delimiter detected from line 1. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const first = src.split(/\r?\n/, 1)[0] ?? "";
  const count = (d: string) => first.split(d).length - 1;
  const delim = [";", "\t", ","].reduce((best, d) => (count(d) > count(best) ? d : best), ",");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delim) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.map((r) => r.map((c) => c.replace(/\r\n?/g, "\n").trim()));
}

/** The header is the first row with at least two non-empty cells among the first 20; rows after it with any text. */
export function toTable(sheet: string, grid: string[][]): PlanTable | null {
  const headerRow = grid.slice(0, 20).findIndex((r) => r.filter((c) => c.trim()).length >= 2);
  if (headerRow < 0) return null;
  const header = grid[headerRow].map((c) => c.replace(/\s+/g, " ").trim());
  const rows = grid
    .slice(headerRow + 1)
    .map((cells, i) => ({ n: headerRow + i + 2, cells }))
    .filter((r) => r.cells.some((c) => c.trim()))
    .slice(0, MAX_PLAN_ROWS);
  return rows.length ? { sheet, headerRow: headerRow + 1, header, rows } : null;
}

export function tablesFromXlsx(bytes: Uint8Array): PlanTable[] {
  return xlsxSheets(bytes, MAX_PLAN_ROWS + 20).map((s) => toTable(s.name, s.rows)).filter((t): t is PlanTable => t !== null);
}

export function tablesFromCsv(text: string): PlanTable[] {
  const t = toTable("CSV", parseCsv(text));
  return t ? [t] : [];
}
