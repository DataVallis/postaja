"use client";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { NameAndSlug } from "@/components/ui/name-slug";
import { createOrgAction, inviteMemberAction, updateSettingsAction, type ActionState } from "./actions";

const PLANS = ["trial", "starter", "pro", "comped"] as const;
const input = "rounded-lg border border-muted bg-raised px-3 py-2 text-fg outline-none focus:border-signal";
const button = "rounded-lg bg-signal px-4 py-2 font-semibold text-ink disabled:opacity-60";

function Feedback({ state }: { state: ActionState }) {
  const t = useTranslations("Admin");
  if (state?.error) return <p role="alert" className="text-sm">{t(`errors.${state.error}`)}</p>;
  if (state?.ok) return <p role="status" className="text-sm">{t(`ok.${state.ok}`)}</p>;
  return null;
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}

export function CreateOrgForm() {
  const t = useTranslations("Admin");
  const [state, action, pending] = useActionState(createOrgAction, undefined);
  return (
    <form action={action} className="grid max-w-md gap-4">
      <NameAndSlug nameLabel={t("name")} slugLabel={t("slug")} inputClass={input} Field={Field} />
      <Field id="ownerEmail" label={t("ownerEmail")}><input id="ownerEmail" name="ownerEmail" type="email" required className={input} /></Field>
      <Field id="plan" label={t("plan")}>
        <select id="plan" name="plan" defaultValue="trial" className={input}>
          {PLANS.map((p) => <option key={p} value={p}>{t(`plans.${p}`)}</option>)}
        </select>
      </Field>
      <Field id="spendCapUsd" label={t("capUsd")}><input id="spendCapUsd" name="spendCapUsd" inputMode="decimal" placeholder="50" className={input} /></Field>
      <button type="submit" disabled={pending} className={button}>{t("create")}</button>
      <Feedback state={state} />
    </form>
  );
}

export function SettingsForm(props: { orgId: string; plan: string; status: string; capUsd: string }) {
  const t = useTranslations("Admin");
  const [state, action, pending] = useActionState(updateSettingsAction, undefined);
  return (
    <form action={action} className="grid max-w-md gap-4">
      <input type="hidden" name="orgId" value={props.orgId} />
      <Field id="plan" label={t("plan")}>
        <select id="plan" name="plan" defaultValue={props.plan} className={input}>
          {PLANS.map((p) => <option key={p} value={p}>{t(`plans.${p}`)}</option>)}
        </select>
      </Field>
      <Field id="status" label={t("status")}>
        <select id="status" name="status" defaultValue={props.status} className={input}>
          <option value="active">{t("statuses.active")}</option>
          <option value="suspended">{t("statuses.suspended")}</option>
        </select>
      </Field>
      <Field id="spendCapUsd" label={t("capUsd")}><input id="spendCapUsd" name="spendCapUsd" required inputMode="decimal" defaultValue={props.capUsd} className={input} /></Field>
      <button type="submit" disabled={pending} className={button}>{t("save")}</button>
      <Feedback state={state} />
    </form>
  );
}

export function InviteForm({ orgId }: { orgId: string }) {
  const t = useTranslations("Admin");
  const [state, action, pending] = useActionState(inviteMemberAction, undefined);
  return (
    <form action={action} className="grid max-w-md gap-4">
      <input type="hidden" name="orgId" value={orgId} />
      <Field id="inviteEmail" label={t("email")}><input id="inviteEmail" name="email" type="email" required className={input} /></Field>
      <Field id="role" label={t("role")}>
        <select id="role" name="role" defaultValue="editor" className={input}>
          <option value="owner">{t("roles.owner")}</option>
          <option value="editor">{t("roles.editor")}</option>
        </select>
      </Field>
      <button type="submit" disabled={pending} className={button}>{t("invite")}</button>
      <Feedback state={state} />
    </form>
  );
}
