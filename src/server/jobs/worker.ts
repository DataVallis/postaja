// Workers (ADR-042). Two posts are written at a time per process: fast enough for a day of posts across brands, gentle
// on the provider's rate limits and on the shared dev server.
import { getDb } from "../db/client";
import { getStorage } from "../files/storage";
import { createAnthropicClient } from "../llm/anthropic";
import { POST_TEXT_QUEUE, runBulkItem, type PostTextJob } from "../bulk/service";
import { getBoss } from "./boss";

export async function startWorkers() {
  const boss = await getBoss();
  const deps = { llm: createAnthropicClient(), storage: getStorage() };
  await boss.work<PostTextJob>(POST_TEXT_QUEUE, { localConcurrency: 2, pollingIntervalSeconds: 2 }, async ([job]) => {
    await runBulkItem(getDb(), deps, job.data);
  });
  console.log("[jobs] workers started");
}
