"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSuperadmin } from "@/server/admin/guard";
import { BACKUP_QUEUE, backupConfigFromEnv } from "@/server/backup/service";
import { getDb } from "@/server/db/client";
import { auditLog } from "@/server/db/schema";
import { getBoss } from "@/server/jobs/boss";

/** "Naredi kopijo zdaj" (TASK-030): queues a backup now; only where backups are configured (production). */
export async function runBackupNowAction() {
  const actor = await requireSuperadmin();
  if (!backupConfigFromEnv()) redirect("/admin/backups?error=OFF");
  const boss = await getBoss();
  await boss.createQueue(BACKUP_QUEUE, { retryLimit: 2, retryDelay: 600, expireInSeconds: 3600 }).catch(() => undefined);
  await boss.send(BACKUP_QUEUE, {}, { singletonKey: "manual" });
  await getDb().insert(auditLog).values({ id: crypto.randomUUID(), actorUserId: actor.userId, orgId: null, action: "backup.run", target: null, meta: {} });
  revalidatePath("/admin/backups");
  redirect("/admin/backups?queued=1");
}
