"use client";
import { useActionState, useEffect, useRef } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Send } from "lucide-react";
import { buttonClass, Card, textareaClass } from "@/components/ui";
import { chatAction } from "../actions";

export type ChatPanelMessage = {
  id: string;
  role: "user" | "assistant";
  body: string;
  meta: { created?: boolean; text?: boolean; images?: boolean; error?: string };
  createdAt: string;
};

/**
 * The conversation next to the post (TASK-061): the owner writes what they want, Postaja answers and changes the text
 * and/or the images. Images that are still being made show in the preview when they are ready (the page refreshes).
 */
export function ChatPanel({
  postId,
  messages,
  canWrite,
  busy,
}: {
  postId: string;
  messages: ChatPanelMessage[];
  canWrite: boolean;
  busy: boolean;
}) {
  const t = useTranslations("Chat");
  const f = useFormatter();
  const [state, action, pending] = useActionState(chatAction, undefined);
  const form = useRef<HTMLFormElement>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state && !state.error) form.current?.reset();
  }, [state]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length, pending]);

  const note = (m: ChatPanelMessage) => {
    const done = [
      m.meta.created ? t("didCreate") : null,
      m.meta.text ? t("didText") : null,
      m.meta.images ? t("didImages") : null,
    ]
      .filter(Boolean)
      .join(" ");
    const err = m.meta.error
      ? t.has(`errors.${m.meta.error}`)
        ? t(`errors.${m.meta.error}`)
        : t("errors.FAILED")
      : null;
    return [done, err].filter(Boolean).join(" ");
  };

  return (
    <Card className="flex max-h-[80vh] flex-col p-0" data-testid="chat">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-base font-semibold">{t("title")}</h2>
        <p className="text-xs text-muted">{t("hint")}</p>
      </div>
      {/* The thread scrolls on its own, so it takes focus and can be scrolled from the keyboard. */}
      <div
        className="flex-1 overflow-y-auto"
        tabIndex={0}
        role="region"
        aria-label={t("title")}
      >
        <ol
          className="grid content-start gap-3 px-4 py-3"
          aria-live="polite"
          data-testid="chat-messages"
        >
          {messages.length === 0 ? (
            <li className="text-sm text-muted">{t("empty")}</li>
          ) : null}
          {messages.map((m) => {
            const extra = m.role === "assistant" ? note(m) : "";
            return (
              <li
                key={m.id}
                className={
                  m.role === "user"
                    ? "ml-8 justify-self-end"
                    : "mr-8 justify-self-start"
                }
                data-role={m.role}
              >
                <div
                  className={`whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${m.role === "user" ? "bg-signal text-ink" : m.meta.error ? "border border-danger/60 bg-raised" : "bg-raised"}`}
                >
                  {m.body || null}
                  {m.body && extra ? <br /> : null}
                  {extra ? (
                    <span className={m.body ? "text-xs text-muted" : ""}>
                      {extra}
                    </span>
                  ) : null}
                </div>
                <span className="mt-0.5 block px-1 text-[11px] text-muted">
                  {m.role === "user" ? t("you") : "Postaja"} ·{" "}
                  {f.dateTime(new Date(m.createdAt), { timeStyle: "short" })}
                </span>
              </li>
            );
          })}
          {pending ? (
            <li className="mr-8 text-sm text-muted" data-testid="chat-pending">
              {t("working")}
            </li>
          ) : null}
        </ol>
        <div ref={end} />
      </div>
      {canWrite ? (
        <form
          ref={form}
          action={action}
          className="grid gap-2 border-t border-line p-3"
        >
          <input type="hidden" name="postId" value={postId} />
          <label htmlFor="chat-message" className="sr-only">
            {t("label")}
          </label>
          <textarea
            id="chat-message"
            name="message"
            rows={3}
            maxLength={2000}
            required
            disabled={pending || busy}
            placeholder={busy ? t("busyPlaceholder") : t("placeholder")}
            className={textareaClass}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted">{t("costHint")}</p>
            <button
              type="submit"
              disabled={pending || busy}
              className={buttonClass("primary", "sm")}
            >
              <Send aria-hidden className="size-4" />
              {t("send")}
            </button>
          </div>
          {state?.error ? (
            <p role="alert" className="text-sm text-danger">
              {t.has(`errors.${state.error}`)
                ? t(`errors.${state.error}`)
                : t("errors.FAILED")}
            </p>
          ) : null}
        </form>
      ) : (
        <p className="border-t border-line p-3 text-sm text-muted">
          {t("readOnly")}
        </p>
      )}
    </Card>
  );
}
