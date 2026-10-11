"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { authClient } from "@/lib/auth-client";

/** `callbackURL` is /app, or the authorize request when Claude is connecting (validated server-side). */
export function LoginForm({ callbackURL = "/app" }: { callbackURL?: string }) {
  const t = useTranslations("Login");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const { error } = await authClient.signIn.magicLink({
      email,
      callbackURL,
      errorCallbackURL: "/login?error=link",
    });
    setState(error ? "error" : "sent");
  }

  if (state === "sent") {
    return (
      <p role="status" className="rounded-lg bg-paper px-4 py-3 text-ink">
        {t("sent")}
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <label htmlFor="email" className="text-sm font-medium">
        {t("emailLabel")}
      </label>
      <input
        id="email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="rounded-lg border border-muted bg-raised px-3 py-2 text-fg outline-none focus:border-signal"
      />
      <button
        type="submit"
        disabled={state === "sending"}
        className="rounded-lg bg-signal px-4 py-2 font-semibold text-ink disabled:opacity-60"
      >
        {state === "sending" ? t("sending") : t("submit")}
      </button>
      {state === "error" ? (
        <p role="alert" className="text-sm">
          {t("error")}
        </p>
      ) : null}
    </form>
  );
}
