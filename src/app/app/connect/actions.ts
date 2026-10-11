"use server";
import { revalidatePath } from "next/cache";
import { getRequestContext } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { revokeConnection } from "@/server/mcp/connections";

/** Disconnects one Claude app for the signed-in person only (userId from the session, ADR-038). */
export async function revokeConnectionAction(f: FormData): Promise<void> {
  const ctx = await getRequestContext();
  if (!ctx) return;
  await revokeConnection(getDb(), ctx.user.id, String(f.get("clientId") ?? ""));
  revalidatePath("/app/connect");
}
