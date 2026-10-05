import { and, eq, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { Db } from "../db/client";

/** A tenant table: has an `orgId` column (Postaja tables) or `organizationId` (Better Auth tables). */
type TenantTable = PgTable & ({ orgId: PgColumn } | { organizationId: PgColumn });

function tenantColumn(table: TenantTable): PgColumn {
  return "orgId" in table ? table.orgId : table.organizationId;
}

/**
 * The only way feature code touches tenant data (ADR-005). Every read, update and delete is filtered by
 * the context's org id; every insert gets it forced. The org id is never taken from input.
 */
export function forOrg(db: Db, ctx: { orgId: string }) {
  const scope = (table: TenantTable, where?: SQL) =>
    where ? and(eq(tenantColumn(table), ctx.orgId), where)! : eq(tenantColumn(table), ctx.orgId);

  return {
    orgId: ctx.orgId,
    select<T extends TenantTable>(table: T, where?: SQL) {
      return db.select().from(table as PgTable).where(scope(table, where));
    },
    async insert<T extends TenantTable>(table: T, values: Record<string, unknown>) {
      const col = "orgId" in table ? "orgId" : "organizationId";
      return db.insert(table as PgTable).values({ ...values, [col]: ctx.orgId } as never).returning();
    },
    async update<T extends TenantTable>(table: T, set: Record<string, unknown>, where?: SQL) {
      // The tenant column can never be changed through the scoped API.
      const safe = Object.fromEntries(Object.entries(set).filter(([k]) => k !== "orgId" && k !== "organizationId"));
      return db.update(table as PgTable).set(safe as never).where(scope(table, where)).returning();
    },
    async delete<T extends TenantTable>(table: T, where?: SQL) {
      return db.delete(table as PgTable).where(scope(table, where)).returning();
    },
  };
}

export type Scoped = ReturnType<typeof forOrg>;
