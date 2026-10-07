// Workers (ADR-042, ADR-043, ADR-044). Two posts are written and two posts' images are made at a time per process: fast enough
// for a day of posts across brands, gentle on the providers' rate limits and on the shared dev server.
import { getDb } from "../db/client";
import { getStorage } from "../files/storage";
import { createAnthropicClient } from "../llm/anthropic";
import { POST_TEXT_QUEUE, runBulkItem, type PostTextJob } from "../bulk/service";
import { createFalClient } from "../images/fal";
import { POST_IMAGE_QUEUE, runImageJob, type PostImageJob } from "../images/service";
import { DESIGN_QUEUE, runDesignJob, type DesignJob } from "../design/service";
import { AD_IMAGE_QUEUE, runAdImageJob, type AdImageJob } from "../ads/creatives";
import { POST_VIDEO_QUEUE, runVideoJob, type PostVideoJob } from "../video/service";
import { PERSONA_PASSPORT_QUEUE, runPassportJob, type PassportJob } from "../personas/service";
import { getBoss } from "./boss";

export async function startWorkers() {
  const boss = await getBoss();
  const deps = { llm: createAnthropicClient(), storage: getStorage(), images: createFalClient() };
  await boss.work<PostTextJob>(POST_TEXT_QUEUE, { localConcurrency: 2, pollingIntervalSeconds: 2 }, async ([job]) => {
    await runBulkItem(getDb(), deps, job.data);
  });
  // One queue for images: bulk items ({ itemId }) and single requests from the post page ({ postId, mode }).
  await boss.work<PostTextJob | PostImageJob>(POST_IMAGE_QUEUE, { localConcurrency: 2, pollingIntervalSeconds: 2 }, async ([job]) => {
    if ("itemId" in job.data && !("postId" in job.data)) await runBulkItem(getDb(), deps, job.data);
    else await runImageJob(getDb(), deps, job.data as PostImageJob);
  });
  await boss.work<DesignJob>(DESIGN_QUEUE, { localConcurrency: 1, pollingIntervalSeconds: 2 }, async ([job]) => {
    await runDesignJob(getDb(), deps, job.data);
  });
  await boss.work<AdImageJob>(AD_IMAGE_QUEUE, { localConcurrency: 1, pollingIntervalSeconds: 2 }, async ([job]) => {
    await runAdImageJob(getDb(), deps, job.data);
  });
  await boss.work<PostVideoJob>(POST_VIDEO_QUEUE, { localConcurrency: 1, pollingIntervalSeconds: 2 }, async ([job]) => {
    await runVideoJob(getDb(), deps, job.data);
  });
  await boss.work<PassportJob>(PERSONA_PASSPORT_QUEUE, { localConcurrency: 1, pollingIntervalSeconds: 2 }, async ([job]) => {
    await runPassportJob(getDb(), deps, job.data);
  });
  console.log("[jobs] workers started");
}
