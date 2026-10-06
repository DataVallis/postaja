// "Claude" page: which Claude apps a person connected, and disconnecting them (TASK-010, ADR-038). A connection is
// the consent row (user × OAuth client). Disconnecting deletes the consent and revokes the refresh tokens; the MCP
// endpoint also requires a live consent on every request, so an already issued access token stops working at once.
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { oauthClient, oauthConsent, oauthRefreshToken } from "../db/schema";

export async function listConnections(db: Db, userId: string) {
  return db
    .select({ clientId: oauthConsent.clientId, name: oauthClient.name, redirectUris: oauthClient.redirectUris, since: oauthConsent.createdAt, scopes: oauthConsent.scopes })
    .from(oauthConsent)
    .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
    .where(eq(oauthConsent.userId, userId))
    .orderBy(desc(oauthConsent.createdAt));
}

export async function hasConnection(db: Db, userId: string, clientId: string): Promise<boolean> {
  const [row] = await db.select({ id: oauthConsent.id }).from(oauthConsent).where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, clientId))).limit(1);
  return !!row;
}

/** Only the person's own consent and tokens are touched (userId comes from the session, never from the form). */
export async function revokeConnection(db: Db, userId: string, clientId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const gone = await tx.delete(oauthConsent).where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, clientId))).returning({ id: oauthConsent.id });
    await tx
      .update(oauthRefreshToken)
      .set({ revoked: new Date() })
      .where(and(eq(oauthRefreshToken.userId, userId), eq(oauthRefreshToken.clientId, clientId), isNull(oauthRefreshToken.revoked)));
    return gone.length > 0;
  });
}
