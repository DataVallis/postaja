// Background jobs (ADR-007, ADR-042): pg-boss on the app's own Postgres (schema "pgboss"). The web process only sends;
// workers run where RUN_WORKER=1 — on dev that is the web container itself, later a separate Kamal role.
import { PgBoss } from "pg-boss";
import { POST_TEXT_QUEUE, type JobQueue } from "../bulk/service";
import { POST_IMAGE_QUEUE } from "../images/service";
import { DESIGN_QUEUE } from "../design/service";

let started: Promise<PgBoss> | undefined;

/** One started pg-boss per process (it creates/updates its own schema on first start). */
export function getBoss(url = process.env.DATABASE_URL): Promise<PgBoss> {
  if (!url) throw new Error("DATABASE_URL is not set");
  started ??= (async () => {
    const boss = new PgBoss({ connectionString: url, schema: "pgboss", max: 4 });
    boss.on("error", (e) => console.error("[jobs]", e instanceof Error ? e.message : "error"));
    await boss.start();
    // Text: one retry after an unexpected error; a generation never runs longer than 5 minutes.
    await boss.createQueue(POST_TEXT_QUEUE, { retryLimit: 1, retryDelay: 30, expireInSeconds: 300 }).catch(() => undefined);
    // Images (TASK-015): the provider can queue for a while; one retry, at most 10 minutes per post.
    await boss.createQueue(POST_IMAGE_QUEUE, { retryLimit: 1, retryDelay: 30, expireInSeconds: 600 }).catch(() => undefined);
    // Brand designs (TASK-017): one Claude call with pictures, a few renders; no automatic retry (the owner sees why).
    await boss.createQueue(DESIGN_QUEUE, { retryLimit: 0, expireInSeconds: 600 }).catch(() => undefined);
    return boss;
  })();
  return started;
}

/** The app's queue: singleton per post and step, so the same post is never queued twice at once. */
export function bossQueue(boss: PgBoss): JobQueue {
  return {
    async send(name, data, key) {
      await boss.send(name, data, { singletonKey: key });
    },
  };
}

export async function stopBoss() {
  if (!started) return;
  const b = await started;
  started = undefined;
  await b.stop({ graceful: true, timeout: 20_000 }).catch(() => undefined);
}
