import { createDb, type Db } from "@/server/db/client";
import { createCaptureMailer } from "@/server/email/mailer";
import { createAuth } from "@/server/auth/auth";
import { parseEmailList } from "@/server/auth/emails";

export const BASE_URL = "http://localhost:3000";

export function makeTestAuth(url: string, opts: { superadmins?: string; ttl?: number; db?: Db } = {}) {
  const db = opts.db ?? createDb(url, { max: 3 });
  const mailer = createCaptureMailer();
  const auth = createAuth({
    db, mailer, baseURL: BASE_URL, secret: "test-secret-test-secret-test-secret-123",
    superadminEmails: parseEmailList(opts.superadmins ?? "boss@datavallis.com"), magicLinkTtlSeconds: opts.ttl,
  });
  const headers = (extra: Record<string, string> = {}) => new Headers({ origin: BASE_URL, "content-type": "application/json", ...extra });

  /** Full magic-link sign-in through the real endpoints. Returns the session cookie, or null if no mail was sent. */
  async function signIn(email: string): Promise<string | null> {
    const before = mailer.sent.length;
    await auth.api.signInMagicLink({ body: { email, callbackURL: "/app" }, headers: headers() });
    const mail = mailer.sent.slice(before).find((m) => m.subject.includes("Prijava"));
    if (!mail) return null;
    const token = new URL(mail.text.match(/https?:\/\/\S+/)![0]).searchParams.get("token")!;
    const res = await auth.api.magicLinkVerify({ query: { token, callbackURL: "/app" }, headers: headers(), asResponse: true });
    const cookie = res.headers.get("set-cookie");
    return cookie ? cookie.split(";")[0] : null;
  }

  async function session(cookie: string) {
    return auth.api.getSession({ headers: headers({ cookie }) });
  }

  return { db, mailer, auth, headers, signIn, session };
}
