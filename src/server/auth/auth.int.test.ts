import postgres from "postgres";
import { getSchema } from "better-auth/db";
import { getTableColumns } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetAndMigrate } from "../../../tests/db";
import { createDb } from "../db/client";
import * as schema from "../db/schema";
import { createCaptureMailer } from "../email/mailer";
import { createAuth } from "./auth";
import { parseEmailList } from "./emails";

const url = process.env.TEST_DATABASE_URL!;
const baseURL = "http://localhost:3000";
const sql = postgres(url, { max: 1, onnotice: () => {} });
const db = createDb(url, { max: 2 });
const mailer = createCaptureMailer();
const make = (ttl?: number) =>
  createAuth({
    db, mailer, baseURL, secret: "test-secret-test-secret-test-secret-123",
    superadminEmails: parseEmailList("Boss@DataVallis.com"), magicLinkTtlSeconds: ttl,
  });
const auth = make();
const headers = () => new Headers({ origin: baseURL, "content-type": "application/json" });

beforeAll(async () => { await resetAndMigrate(url); });
beforeEach(async () => {
  mailer.sent.length = 0;
  await sql`truncate "user", session, account, verification cascade`;
});
afterAll(async () => { await sql.end({ timeout: 5 }); });

function tokenFromLastMail() {
  const link = mailer.sent.at(-1)!.text.match(/https?:\/\/\S+/)![0];
  return new URL(link).searchParams.get("token")!;
}
const verify = (a: typeof auth, token: string) =>
  a.api.magicLinkVerify({ query: { token, callbackURL: "/app" }, headers: headers(), asResponse: true });

describe("schema drift", () => {
  it("every field Better Auth expects exists in our Drizzle tables", () => {
    const expected = getSchema(auth.options);
    const tables = schema as unknown as Record<string, Parameters<typeof getTableColumns>[0]>;
    for (const [model, def] of Object.entries(expected)) {
      const table = tables[model];
      expect(table, `table ${model}`).toBeDefined();
      const cols = Object.keys(getTableColumns(table));
      for (const [field, attr] of Object.entries(def.fields)) {
        expect(cols, `${model}.${(attr as { fieldName?: string }).fieldName ?? field}`).toContain(
          (attr as { fieldName?: string }).fieldName ?? field,
        );
      }
    }
  });
});

describe("magic link sign-in", () => {
  it("superadmin bootstrap: mail sent, link creates user with role superadmin and a session", async () => {
    await auth.api.signInMagicLink({ body: { email: "boss@datavallis.com", callbackURL: "/app" }, headers: headers() });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toBe("boss@datavallis.com");
    const res = await verify(auth, tokenFromLastMail());
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${baseURL}/app`);
    expect(res.headers.get("set-cookie")).toContain("better-auth.session_token");
    const users = await sql`select email, role, email_verified from "user"`;
    expect(users).toEqual([{ email: "boss@datavallis.com", role: "superadmin", email_verified: true }]);
    expect((await sql`select count(*)::int as n from session`)[0].n).toBe(1);
  });

  it("mixed-case superadmin email is matched and stored lower-case", async () => {
    await auth.api.signInMagicLink({ body: { email: "BOSS@datavallis.com", callbackURL: "/app" }, headers: headers() });
    await verify(auth, tokenFromLastMail());
    expect((await sql`select email, role from "user"`)[0]).toEqual({ email: "boss@datavallis.com", role: "superadmin" });
  });

  it("unknown email: same API answer, no mail, no user, no session", async () => {
    const r = await auth.api.signInMagicLink({ body: { email: "stranger@example.com", callbackURL: "/app" }, headers: headers() });
    expect(r).toEqual({ status: true });
    expect(mailer.sent).toHaveLength(0);
    expect((await sql`select count(*)::int as n from "user"`)[0].n).toBe(0);
    expect((await sql`select count(*)::int as n from session`)[0].n).toBe(0);
  });

  it("a link works once (second use creates no second session)", async () => {
    await auth.api.signInMagicLink({ body: { email: "boss@datavallis.com", callbackURL: "/app" }, headers: headers() });
    const token = tokenFromLastMail();
    expect((await verify(auth, token)).status).toBe(302);
    const again = await verify(auth, token);
    expect(again.headers.get("location")).toContain("error=INVALID_TOKEN");
    expect((await sql`select count(*)::int as n from session`)[0].n).toBe(1);
  });

  it("the plain token is never stored in the database", async () => {
    await auth.api.signInMagicLink({ body: { email: "boss@datavallis.com", callbackURL: "/app" }, headers: headers() });
    const token = tokenFromLastMail();
    const rows = await sql`select identifier, value from verification`;
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it("an expired link is rejected", async () => {
    const shortLived = make(1);
    await shortLived.api.signInMagicLink({ body: { email: "boss@datavallis.com", callbackURL: "/app" }, headers: headers() });
    const token = tokenFromLastMail();
    await new Promise((r) => setTimeout(r, 1500));
    const res = await verify(shortLived, token);
    expect(res.headers.get("location")).toContain("error=INVALID_TOKEN");
    expect((await sql`select count(*)::int as n from session`)[0].n).toBe(0);
  });

  it("account creation for a non-allowed email is refused at the DB hook (even with a forged flow)", async () => {
    const ctx = await auth.$context;
    const created = await ctx.internalAdapter.createUser({ email: "intruder@example.com", name: "", emailVerified: true }, { method: "magic-link" } as never);
    expect(created).toBeNull();
    expect((await sql`select count(*)::int as n from "user"`)[0].n).toBe(0);
  });

  it("role cannot be set from the client", async () => {
    await auth.api.signInMagicLink({ body: { email: "boss@datavallis.com", callbackURL: "/app" }, headers: headers() });
    const res = await verify(auth, tokenFromLastMail());
    const cookie = res.headers.get("set-cookie")!.split(";")[0];
    const update = auth.api.updateUser({
      body: { role: "user" } as never,
      headers: new Headers({ cookie, origin: baseURL }),
    });
    await expect(update).rejects.toThrow();
    expect((await sql`select role from "user"`)[0].role).toBe("superadmin");
  });
});
