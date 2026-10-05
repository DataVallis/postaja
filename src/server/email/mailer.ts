import fs from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";

export type Mail = { to: string; subject: string; text: string; html: string };
export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/**
 * Picks the transport from the environment.
 * - default: SMTP (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, EMAIL_FROM) — all required, missing = error.
 * - EMAIL_TRANSPORT=file: writes each mail as JSON to MAIL_DIR (local dev and E2E only; never set on servers).
 */
export function createMailerFromEnv(env: Record<string, string | undefined> = process.env): Mailer {
  if (env.EMAIL_TRANSPORT === "file") return createFileMailer(env.MAIL_DIR ?? ".mail");
  const missing = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "EMAIL_FROM"].filter((k) => !env[k]);
  if (missing.length) throw new Error(`Email is not configured; missing: ${missing.join(", ")}`);
  const port = Number(env.SMTP_PORT);
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
  });
  const from = env.EMAIL_FROM!;
  return {
    async send(mail) {
      await transport.sendMail({ from, ...mail });
    },
  };
}

export function createFileMailer(dir: string): Mailer {
  return {
    async send(mail) {
      await fs.mkdir(dir, { recursive: true });
      const file = path.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
      await fs.writeFile(file, JSON.stringify(mail, null, 2));
    },
  };
}

/** In-memory mailer for tests. */
export function createCaptureMailer(): Mailer & { sent: Mail[] } {
  const sent: Mail[] = [];
  return { sent, async send(mail) { sent.push(mail); } };
}
