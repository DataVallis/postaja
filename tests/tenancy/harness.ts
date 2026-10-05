import { expect, it } from "vitest";
import type { Scoped } from "@/server/tenancy/scoped";

/**
 * Reusable cross-tenant suite (DEVELOPMENT-RULES §6.6, ADR-005). Every tenant resource calls it:
 * org B's scoped access must not read, change or delete org A's row — and the row is verified afterwards.
 */
export type CrossTenantResource<Row> = {
  name: string;
  /** Scoped clients for org A and org B (built with forOrg). */
  scopes: () => { a: Scoped; b: Scoped };
  /** Creates a row in org A, returns its id. */
  seedInA: (a: Scoped) => Promise<string>;
  read: (s: Scoped, id: string) => Promise<Row[]>;
  update: (s: Scoped, id: string) => Promise<Row[]>;
  remove: (s: Scoped, id: string) => Promise<Row[]>;
  /** Reads the row directly (unscoped) to verify it is unchanged. */
  raw: (id: string) => Promise<Row | undefined>;
};

export function crossTenantSuite<Row>(r: CrossTenantResource<Row>) {
  it(`${r.name}: org B cannot read org A's row`, async () => {
    const { a, b } = r.scopes();
    const id = await r.seedInA(a);
    expect(await r.read(b, id)).toEqual([]);
    expect(await r.read(a, id)).toHaveLength(1);
  });

  it(`${r.name}: org B cannot update org A's row (0 rows, data unchanged)`, async () => {
    const { a, b } = r.scopes();
    const id = await r.seedInA(a);
    const before = await r.raw(id);
    expect(await r.update(b, id)).toEqual([]);
    expect(await r.raw(id)).toEqual(before);
  });

  it(`${r.name}: org B cannot delete org A's row (row still exists)`, async () => {
    const { a, b } = r.scopes();
    const id = await r.seedInA(a);
    expect(await r.remove(b, id)).toEqual([]);
    expect(await r.raw(id)).toBeDefined();
  });
}
