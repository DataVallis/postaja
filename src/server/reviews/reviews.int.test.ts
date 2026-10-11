// Client approval links (TASK-041, ADR-069): only the token's hash is stored; a link shows exactly its brand's posts in
// its range; approvals and change requests move the status and are kept; revoked / expired links stop at once; media
// outside the link is unreachable; other orgs cannot touch links.
import { eq } from "drizzle-orm";
import postgres from "postgres";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeTestAuth } from "../../../tests/auth-helpers";
import { resetAndMigrate } from "../../../tests/db";
import { addChannel, createBrand, getBrandDetail } from "../brands/service";
import { approvalLinks, auditLog, postMedia, posts } from "../db/schema";
import { createS3Storage, s3ConfigFromEnv } from "../files/storage";
import { createOrganization, inviteMember } from "../orgs/service";
import type { OrgContext } from "../tenancy/context";
import { forOrg } from "../tenancy/scoped";
import { clientMediaUrl, clientView, createApprovalLink, latestReviews, linkByToken, listApprovalLinks, postReviewsFor, revokeApprovalLink, submitReview } from "./service";

const url = process.env.TEST_DATABASE_URL!;
const sql = postgres(url, { max: 1, onnotice: () => {} });
const { db, mailer, signIn, session } = makeTestAuth(url, { superadmins: "boss@datavallis.com" });
const storage = createS3Storage(s3ConfigFromEnv());
const NOW = new Date("2026-10-08T10:00:00Z");

let A: OrgContext, B: OrgContext, editorA: OrgContext, brandA: string, brandA2: string, chA: string;
beforeAll(async () => { await resetAndMigrate(url); });
beforeEach(async () => {
  mailer.sent.length = 0;
  await sql`truncate "user", session, account, verification, organization, member, invitation, org_settings, audit_log, brands, brand_profile_versions, channels, posts, post_media, approval_links, post_reviews cascade`;
  const s = (await session((await signIn("boss@datavallis.com"))!))!;
  const actor = { userId: s.user.id, role: "superadmin" as const };
  const d = { mailer, baseURL: "http://localhost:3000" };
  const a = await createOrganization(db, d, actor, { name: "Org A", slug: "org-a", plan: "pro", ownerEmail: "boss@datavallis.com" });
  const b = await createOrganization(db, d, actor, { name: "Org B", slug: "org-b", plan: "pro", ownerEmail: "b@b.si" });
  const bUser = (await session((await signIn("b@b.si"))!))!.user;
  await inviteMember(db, d, actor, a.orgId, { email: "ed@a.si", role: "editor" });
  const ed = (await session((await signIn("ed@a.si"))!))!.user;
  A = { userId: s.user.id, orgId: a.orgId, orgName: "Org A", role: "owner", plan: "pro" };
  B = { userId: bUser.id, orgId: b.orgId, orgName: "Org B", role: "owner", plan: "pro" };
  editorA = { userId: ed.id, orgId: a.orgId, orgName: "Org A", role: "editor", plan: "pro" };
  brandA = (await createBrand(db, A, { name: "Polygon", slug: "polygon", languages: ["sl"] })).id;
  brandA2 = (await createBrand(db, A, { name: "Drugi", slug: "drugi", languages: ["sl"] })).id;
  chA = (await addChannel(db, A, brandA, { platform: "instagram", handle: "@polygon", language: "sl", goal: { postsPerDay: 1, weekdays: [1, 2, 3, 4, 5] }, allowedTypes: ["single_image"] })).id;
});
afterAll(async () => { await sql.end({ timeout: 5 }); });

async function post(brandId: string, day: string, status: string, caption: string | null) {
  const { brand } = await getBrandDetail(db, A, brandId);
  const id = crypto.randomUUID();
  await forOrg(db, A).insert(posts, {
    id, brandId, channelId: brandId === brandA ? chA : null, profileVersionId: brand.currentProfileVersionId!, brief: `Tema ${day}`, status: status as "ready",
    format: "image", scheduledOn: day, plan: { topic: `Tema ${day}` }, content: caption ? { caption, hashtags: [] } : null, createdBy: A.userId,
  });
  return id;
}

describe("client approval links", () => {
  it("only the hash is stored; the link shows its brand's posts in its range, in time order", async () => {
    const ready = await post(brandA, "2026-10-13", "ready", "Prva objava");
    const planned = await post(brandA, "2026-10-14", "planned", null);
    await post(brandA, "2026-10-15", "skipped", "Preskočena");
    await post(brandA, "2026-10-20", "ready", "Naslednji teden");
    await post(brandA2, "2026-10-13", "ready", "Drug brand");
    const { id, token } = await createApprovalLink(db, editorA, brandA, { label: "Polygon – Ana", from: "2026-10-12", to: "2026-10-18" }, NOW);
    const [row] = await db.select().from(approvalLinks).where(eq(approvalLinks.id, id));
    expect(row.tokenHash).not.toContain(token);
    expect(row.tokenHash).toHaveLength(64);
    expect(row.expiresAt.toISOString()).toBe("2026-11-01T23:59:59.000Z");
    expect((await db.select().from(auditLog).where(eq(auditLog.action, "approval_link.create"))).map((a) => a.target)).toEqual([id]);
    const view = await clientView(db, token, NOW);
    expect(view.link).toMatchObject({ brandName: "Polygon", from: "2026-10-12", to: "2026-10-18" });
    expect(view.posts.map((p) => [p.id, p.canReview])).toEqual([[ready, true], [planned, false]]);
    expect(view.posts[0]).toMatchObject({ platform: "instagram", handle: "@polygon", content: { caption: "Prva objava" } });
    expect((await listApprovalLinks(db, A, brandA))[0].lastViewedAt).toEqual(NOW);
    await expect(createApprovalLink(db, A, brandA, { label: "x", from: "2026-10-01", to: "2026-11-15" }, NOW)).rejects.toMatchObject({ code: "INVALID" }); // > 31 days
    await expect(createApprovalLink(db, A, brandA, { label: "x", from: "2026-08-01", to: "2026-08-07" }, NOW)).rejects.toMatchObject({ code: "INVALID" }); // already over
    await expect(createApprovalLink(db, B, brandA, { label: "x", from: "2026-10-12", to: "2026-10-18" }, NOW)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("approve → approved; changes (with a comment) → back to ready; every review is kept; not for posts outside the link", async () => {
    const p = await post(brandA, "2026-10-13", "ready", "Objava");
    const other = await post(brandA2, "2026-10-13", "ready", "Drug brand");
    const later = await post(brandA, "2026-10-25", "ready", "Pozneje");
    const planned = await post(brandA, "2026-10-14", "planned", null);
    const { token } = await createApprovalLink(db, A, brandA, { label: "Ana", from: "2026-10-12", to: "2026-10-18" }, NOW);
    await submitReview(db, token, p, { decision: "approved", reviewer: " Ana " }, NOW);
    expect((await sql`select status from posts where id = ${p}`)[0].status).toBe("approved");
    await expect(submitReview(db, token, p, { decision: "changes", comment: "  " }, NOW)).rejects.toMatchObject({ code: "INVALID" });
    await submitReview(db, token, p, { decision: "changes", comment: "Drugačen naslov, prosim." }, new Date(NOW.getTime() + 1000));
    expect((await sql`select status from posts where id = ${p}`)[0].status).toBe("ready");
    expect((await postReviewsFor(db, editorA, p)).map((r) => [r.decision, r.comment, r.reviewer])).toEqual([["changes", "Drugačen naslov, prosim.", ""], ["approved", "", "Ana"]]);
    expect((await latestReviews(db, A, [p])).get(p)!.decision).toBe("changes");
    expect(await postReviewsFor(db, B, p)).toEqual([]);
    for (const id of [other, later]) await expect(submitReview(db, token, id, { decision: "approved" }, NOW)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(submitReview(db, token, planned, { decision: "approved" }, NOW)).rejects.toMatchObject({ code: "BAD_STATE" });
    expect((await clientView(db, token, NOW)).posts.find((x) => x.id === p)!.review).toMatchObject({ decision: "changes" });
  });

  it("revoked, expired and unknown links stop at once; media only of the link's posts", async () => {
    const p = await post(brandA, "2026-10-13", "ready", "Objava");
    const other = await post(brandA2, "2026-10-13", "ready", "Drug brand");
    const png = new Uint8Array(await sharp({ create: { width: 10, height: 10, channels: 3, background: "#000" } }).png().toBuffer());
    const mk = async (postId: string) => {
      const id = crypto.randomUUID();
      const key = `org/${A.orgId}/posts/${postId}/${id}.png`;
      await storage.put(key, png, "image/png");
      await forOrg(db, A).insert(postMedia, { id, postId, kind: "slide", position: 0, storageKey: key, contentType: "image/png", width: 10, height: 10, sizeBytes: png.byteLength });
      return id;
    };
    const mine = await mk(p);
    const theirs = await mk(other);
    const { id, token } = await createApprovalLink(db, A, brandA, { label: "Ana", from: "2026-10-12", to: "2026-10-18" }, NOW);
    expect(await clientMediaUrl(db, storage, token, mine, NOW)).toMatch(/^http/);
    await expect(clientMediaUrl(db, storage, token, theirs, NOW)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await clientView(db, token, NOW)).posts[0].images.map((m) => m.id)).toEqual([mine]);
    await expect(linkByToken(db, token, new Date("2026-11-02T00:00:00Z"))).rejects.toMatchObject({ code: "GONE" });
    await expect(linkByToken(db, "x".repeat(43), NOW)).rejects.toMatchObject({ code: "GONE" });
    await expect(linkByToken(db, "../../etc", NOW)).rejects.toMatchObject({ code: "GONE" });
    await expect(revokeApprovalLink(db, B, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await revokeApprovalLink(db, editorA, id);
    await expect(clientView(db, token, NOW)).rejects.toMatchObject({ code: "GONE" });
    await expect(submitReview(db, token, p, { decision: "approved" }, NOW)).rejects.toMatchObject({ code: "GONE" });
    await expect(clientMediaUrl(db, storage, token, mine, NOW)).rejects.toMatchObject({ code: "GONE" });
  });
});
