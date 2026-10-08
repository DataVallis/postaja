"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

type Slot = "logo" | "partner" | "font" | "source";
type Result = { name: string; ok: true; slot: Slot } | { name: string; ok: false; error: string; detail?: string };
type Row = { key: string; name: string; state: "waiting" | "uploading" | "done"; results: Result[] };

async function send(brandId: string, file: File, slot?: Slot, name?: string): Promise<Result[]> {
  const body = new FormData();
  body.append("file", file);
  if (name) body.append("name", name);
  try {
    const res = await fetch(`/api/brands/${brandId}/files${slot ? `?slot=${slot}` : ""}`, { method: "POST", body });
    const data = (await res.json().catch(() => ({}))) as { results?: Result[]; error?: string };
    return data.results ?? [{ name: file.name, ok: false, error: data.error ?? "failed" }];
  } catch {
    return [{ name: file.name, ok: false, error: "failed" }];
  }
}

function Icon({ d, className = "size-5" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d={d} />
    </svg>
  );
}
const UP = "M12 16V4m0 0L7 9m5-5 5 5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3";

/** One message per result: where the file went, or why it was refused (in the user's words). */
function ResultLine({ r }: { r: Result }) {
  const t = useTranslations("Brands.files");
  if (r.ok)
    return (
      <span role="status" className="flex items-center gap-2">
        <Icon d="M5 12.5 10 17 19 7" className="size-4 text-signal" />
        <span className="truncate">{r.name}</span>
        <span className="shrink-0 rounded-full bg-raised px-2 py-0.5 text-xs ">{t(`went.${r.slot}`)}</span>
      </span>
    );
  const msg = t.has(`errors.${r.error}`) ? t(`errors.${r.error}`, { detail: r.detail ?? "" }) : t("errors.failed");
  return (
    <span role="alert" className="flex items-start gap-2">
      <Icon d="M6 6l12 12M18 6 6 18" className="mt-0.5 size-4 shrink-0" />
      <span><span className="font-medium">{r.name}</span> — {msg}</span>
    </span>
  );
}

/**
 * The owner drops anything — single files, many files, a ZIP of a whole brand folder. Each file is uploaded in turn and
 * sorted by the server (fonts, logos, sources); the log shows where every file went.
 */
export function Dropzone({ brandId, needsDiacritics }: { brandId: string; needsDiacritics: boolean }) {
  const t = useTranslations("Brands.files");
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const busy = rows.some((r) => r.state !== "done");

  async function upload(files: File[]) {
    if (!files.length) return;
    const fresh: Row[] = files.map((f, i) => ({ key: `${Date.now()}-${i}`, name: f.name, state: "waiting", results: [] }));
    setRows((prev) => [...fresh, ...prev].slice(0, 50));
    for (const [i, file] of files.entries()) {
      const key = fresh[i].key;
      setRows((prev) => prev.map((r) => (r.key === key ? { ...r, state: "uploading" } : r)));
      const results = await send(brandId, file);
      setRows((prev) => prev.map((r) => (r.key === key ? { ...r, state: "done", results } : r)));
    }
    router.refresh();
  }

  return (
    <div className="grid gap-3">
      <div
        data-testid="dropzone"
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void upload([...e.dataTransfer.files]); }}
        onClick={(e) => { if (e.target === e.currentTarget) input.current?.click(); }}
        className={`grid cursor-pointer justify-items-start gap-4 rounded-2xl border-2 border-dashed px-6 py-8 transition-colors sm:px-8 ${
          over ? "border-signal bg-signal/10" : "border-line bg-raised/40 hover:border-muted"
        }`}
      >
        <div className="pointer-events-none flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-full bg-ink text-paper dark:bg-paper dark:text-ink"><Icon d={UP} /></span>
          <p className="text-lg font-semibold">{over ? t("dropNow") : t("dropTitle")}</p>
        </div>
        <p className="pointer-events-none max-w-xl text-sm text-muted">
          {t("dropBody")} {needsDiacritics ? t("dropFontsSl") : null}
        </p>
        <button type="button" onClick={() => input.current?.click()} disabled={busy} className="rounded-lg bg-signal px-4 py-2 font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg disabled:opacity-60">
          {busy ? t("uploading") : t("chooseFiles")}
        </button>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          aria-label={t("chooseFiles")}
          onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; void upload(f); }}
        />
      </div>

      {rows.length ? (
        <ul className="grid gap-2 rounded-xl border border-line p-4 text-sm" aria-live="polite" data-testid="upload-log">
          {rows.flatMap((row) =>
            row.state !== "done"
              ? [<li key={row.key} className="flex items-center gap-2 text-muted"><span className="size-4 animate-spin rounded-full border-2 border-line border-t-signal motion-reduce:animate-none" aria-hidden="true" />{row.name} — {row.state === "uploading" ? t("uploading") : t("waiting")}</li>]
              : row.results.map((r, i) => <li key={`${row.key}-${i}`}><ResultLine r={r} /></li>),
          )}
        </ul>
      ) : null}
    </div>
  );
}

/** Small "add logo" button: forces the logo slot (for files not named "logo…"). */
export function AddLogoButton({ brandId }: { brandId: string }) {
  const t = useTranslations("Brands.files");
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Result[]>([]);
  return (
    <div className="grid gap-2">
      <button type="button" onClick={() => input.current?.click()} disabled={busy} className="justify-self-start rounded-lg border border-fg/25 px-3 py-1.5 text-sm font-medium hover:border-fg/60 disabled:opacity-60">
        {busy ? t("uploading") : t("addLogo")}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        aria-label={t("addLogo")}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setBusy(true);
          const r = await send(brandId, f, "logo");
          setErrors(r.filter((x) => !x.ok));
          setBusy(false);
          router.refresh();
        }}
      />
      {errors.map((r, i) => <p key={i} className="text-sm"><ResultLine r={r} /></p>)}
    </div>
  );
}

/** Renders the sample in the uploaded font itself (loaded from its private URL), so the owner sees č/š/ž really work. */
export function FontSample({ id, sample }: { id: string; sample: string }) {
  const [ready, setReady] = useState(false);
  const name = `brandfont-${id}`;
  useEffect(() => {
    let alive = true;
    const face = new FontFace(name, `url(/api/brand-files/asset/${id})`);
    face.load().then((f) => { if (!alive) return; document.fonts.add(f); setReady(true); }).catch(() => {});
    return () => { alive = false; };
  }, [id, name]);
  return (
    <p className="truncate text-2xl leading-tight" style={{ fontFamily: ready ? `"${name}", var(--font-sans)` : undefined }}>
      {sample}
    </p>
  );
}

/** Partner logos (TASK-046): the partner's name and its logo; chosen later per post or ad, never the brand's own logo. */
export function AddPartnerLogo({ brandId }: { brandId: string }) {
  const t = useTranslations("Brands.files");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Result[]>([]);
  return (
    <form
      className="grid gap-2 rounded-xl border border-line p-3"
      data-testid="add-partner"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const data = new FormData(form);
        const file = data.get("file");
        const name = String(data.get("name") ?? "").trim();
        if (!(file instanceof File) || !file.size || !name) return;
        setBusy(true);
        const r = await send(brandId, file, "partner", name);
        setErrors(r.filter((x) => !x.ok));
        setBusy(false);
        if (r.every((x) => x.ok)) form.reset();
        router.refresh();
      }}
    >
      <label className="grid gap-1 text-sm">
        <span>{t("partnerName")}</span>
        <input name="name" required maxLength={60} placeholder={t("partnerNamePlaceholder")} className="rounded-lg border border-line bg-surface px-3 py-2" />
      </label>
      <label className="grid gap-1 text-sm">
        <span>{t("partnerFile")}</span>
        <input name="file" type="file" required accept="image/png,image/jpeg,image/webp" className="text-sm" />
      </label>
      <button type="submit" disabled={busy} className="justify-self-start rounded-lg border border-fg/25 px-3 py-1.5 text-sm font-medium hover:border-fg/60 disabled:opacity-60">
        {busy ? t("uploading") : t("addPartner")}
      </button>
      {errors.map((r, i) => <p key={i} className="text-sm"><ResultLine r={r} /></p>)}
    </form>
  );
}
