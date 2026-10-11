"use server";
import { headers } from "next/headers";
import { getAuth } from "@/server/auth/auth";
import { getDb } from "@/server/db/client";
import { hashIp, publicSignupEnabled, requestSignup, SignupError } from "@/server/signup/service";

export type SignupState = { sent?: boolean; error?: string } | undefined;

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** /signup (TASK-037): store the request, then send the usual magic link that lands on /app/start. */
export async function signupAction(_prev: SignupState, f: FormData): Promise<SignupState> {
  if (!publicSignupEnabled()) return { error: "DISABLED" };
  if (str(f, "website")) return { sent: true }; // a bot filled the hidden field: answer as if sent, do nothing
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "";
  const auth = getAuth();
  try {
    const { email } = await requestSignup(getDb(), { email: str(f, "email"), orgName: str(f, "orgName"), ipHash: hashIp(ip, (await auth.$context).secret) });
    await auth.api.signInMagicLink({ body: { email, callbackURL: "/app/start" }, headers: h });
  } catch (e) {
    if (e instanceof SignupError) return { error: e.code };
    console.error("signup failed", e instanceof Error ? e.message.slice(0, 200) : "error");
    return { error: "FAILED" };
  }
  return { sent: true };
}
