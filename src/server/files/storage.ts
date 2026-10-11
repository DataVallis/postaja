// Object storage (ADR-006, ADR-033): Hetzner Object Storage on servers, an S3 stand-in (MinIO) locally and in CI.
// The bucket is private; browsers only ever get short-lived presigned GET URLs issued after an access check in the DB.
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/** Presigned URLs live at most this long (ADR-006: ≤ 15 min). */
export const MAX_PRESIGN_SECONDS = 15 * 60;
export const DEFAULT_PRESIGN_SECONDS = 5 * 60;

export interface Storage {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** Whole object as bytes (server-side use only, e.g. material text for a prompt). */
  get(key: string): Promise<Uint8Array>;
  presignGet(key: string, opts: { filename: string; contentType: string; inline: boolean; expiresIn?: number }): Promise<string>;
}

export type S3Config = { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean };

/** Reads S3_* env vars. Throws naming the missing variables (never their values). */
export function s3ConfigFromEnv(env: Record<string, string | undefined> = process.env): S3Config {
  const names = ["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const;
  const missing = names.filter((n) => !env[n]);
  if (missing.length) throw new Error(`S3_NOT_CONFIGURED:${missing.join(",")}`);
  return {
    endpoint: env.S3_ENDPOINT!,
    region: env.S3_REGION!,
    bucket: env.S3_BUCKET!,
    accessKeyId: env.S3_ACCESS_KEY_ID!,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
    forcePathStyle: env.S3_FORCE_PATH_STYLE === "1",
  };
}

/** RFC 6266 Content-Disposition with an ASCII fallback and the UTF-8 name (č, š, ž survive). */
export function contentDisposition(filename: string, inline: boolean): string {
  const fallback = filename.normalize("NFKD").replace(/[^\x20-\x7e]/g, "").replace(/["\\]/g, "").trim() || "file";
  return `${inline ? "inline" : "attachment"}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function createS3Storage(cfg: S3Config): Storage & { client: S3Client; bucket: string } {
  const client = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: cfg.forcePathStyle,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    // Hetzner and MinIO don't need the newer default checksum headers on every request.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const Bucket = cfg.bucket;
  return {
    client,
    bucket: Bucket,
    async put(key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType, ContentLength: body.byteLength }));
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
    async exists(key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return true;
      } catch (e) {
        const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status === 404) return false;
        throw e;
      }
    },
    async get(key) {
      const r = await client.send(new GetObjectCommand({ Bucket, Key: key }));
      return new Uint8Array(await r.Body!.transformToByteArray());
    },
    async presignGet(key, { filename, contentType, inline, expiresIn = DEFAULT_PRESIGN_SECONDS }) {
      if (!(expiresIn > 0 && expiresIn <= MAX_PRESIGN_SECONDS)) throw new Error("PRESIGN_TOO_LONG");
      const cmd = new GetObjectCommand({
        Bucket,
        Key: key,
        ResponseContentType: contentType,
        ResponseContentDisposition: contentDisposition(filename, inline),
      });
      return getSignedUrl(client, cmd, { expiresIn });
    },
  };
}

let shared: Storage | undefined;
/** Process-wide storage from env, created on first use (the app starts without S3 configured). */
export function getStorage(): Storage {
  shared ??= createS3Storage(s3ConfigFromEnv());
  return shared;
}
