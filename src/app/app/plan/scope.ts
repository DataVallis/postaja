// The bulk scope from a form or a URL (TASK-014): the same fields drive the cost preview and the start.
import { addDays, todayIn } from "@/lib/dates";
import type { BulkScope, BulkStep } from "@/server/db/schema";

export type ScopeFields = { kind?: string; date?: string; brandId?: string; days?: string; importId?: string; steps?: string };

export function scopeFrom(f: ScopeFields): BulkScope {
  const brandId = f.brandId || null;
  if (f.kind === "import") return { kind: "import", importId: f.importId ?? "", brandId };
  if (f.kind === "brand") {
    const from = todayIn();
    const days = f.days ?? "7";
    return { kind: "brand", brandId: brandId ?? "", from, to: days === "all" ? null : addDays(from, Math.min(Math.max(Number(days) || 7, 1), 366) - 1) };
  }
  return { kind: "day", date: f.date ?? "", brandId };
}

export function stepsFrom(raw: string | undefined): BulkStep[] {
  const s = (raw ?? "text").split(",").filter((x): x is BulkStep => x === "text" || x === "image");
  return s.length ? [...new Set(s)] : ["text"];
}

/** The fields again, for links and hidden inputs. */
export function scopeQuery(f: ScopeFields, over: Partial<ScopeFields> = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...over })) if (v) p.set(k, v);
  return p.toString();
}
