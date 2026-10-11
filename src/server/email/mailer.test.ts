import { describe, expect, it } from "vitest";
import { createMailerFromEnv } from "./mailer";
import { magicLinkMail } from "./templates/magic-link";

describe("createMailerFromEnv", () => {
  it("throws naming every missing SMTP variable (never silently skips)", () => {
    expect(() => createMailerFromEnv({ SMTP_HOST: "h" })).toThrow(
      "missing: SMTP_PORT, SMTP_USER, SMTP_PASSWORD, EMAIL_FROM",
    );
  });
  it("builds an SMTP mailer when all variables are present", () => {
    const m = createMailerFromEnv({
      SMTP_HOST: "mail.example.test", SMTP_PORT: "465", SMTP_USER: "u", SMTP_PASSWORD: "p", EMAIL_FROM: "X <x@example.test>",
    });
    expect(typeof m.send).toBe("function");
  });
  it("file transport needs no SMTP variables", () => {
    expect(() => createMailerFromEnv({ EMAIL_TRANSPORT: "file", MAIL_DIR: "/tmp/x" })).not.toThrow();
  });
});

describe("magicLinkMail", () => {
  const url = "https://dev-postaja.inzenirji.si/api/auth/magic-link/verify?token=abc&callbackURL=%2Fapp";
  it("contains the exact link in text and html (html-escaped) and Slovenian copy", () => {
    const m = magicLinkMail("a@b.si", url, "sl");
    expect(m.subject).toBe("Prijava v Postajo");
    expect(m.text).toContain(url);
    expect(m.html).toContain(url.replace(/&/g, "&amp;"));
    expect(m.html).not.toContain("<script");
  });
  it("escapes a hostile url", () => {
    const m = magicLinkMail("a@b.si", 'https://x/"><script>alert(1)</script>', "en");
    expect(m.html).not.toContain("<script>");
    expect(m.subject).toBe("Sign in to Postaja");
  });
});
