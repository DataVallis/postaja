import { CreateBucketCommand } from "@aws-sdk/client-s3";
import { createS3Storage, s3ConfigFromEnv } from "../src/server/files/storage";

/** Integration tests need a real Postgres and a real S3 API (MinIO in CI). Missing either fails the run, never skips. */
export default async function setup() {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error("TEST_DATABASE_URL is not set — integration tests need a real Postgres (see docs/HANDOFF.md Bootstrap).");
  }
  const s3 = createS3Storage(s3ConfigFromEnv()); // throws S3_NOT_CONFIGURED:<names> when the S3 stand-in is not configured
  try {
    await s3.client.send(new CreateBucketCommand({ Bucket: s3.bucket }));
  } catch (e) {
    const name = (e as Error).name;
    if (name !== "BucketAlreadyOwnedByYou" && name !== "BucketAlreadyExists") throw e;
  }
}
