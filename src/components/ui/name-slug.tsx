"use client";
import { useState } from "react";
import { slugify } from "@/lib/slug";

/**
 * Name + short name (slug): the slug follows the name as you type until you change it yourself; clearing it makes it
 * follow again.
 */
export function NameAndSlug({ nameLabel, slugLabel, inputClass, Field }: {
  nameLabel: string; slugLabel: string; inputClass: string;
  Field: (p: { id: string; label: string; children: React.ReactNode }) => React.ReactNode;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [touched, setTouched] = useState(false);
  return (
    <>
      <Field id="name" label={nameLabel}>
        <input id="name" name="name" required minLength={2} value={name} className={inputClass}
          onChange={(e) => { setName(e.target.value); if (!touched) setSlug(slugify(e.target.value)); }} />
      </Field>
      <Field id="slug" label={slugLabel}>
        <input id="slug" name="slug" required pattern="[a-z0-9-]+" value={slug} className={inputClass}
          onChange={(e) => { const v = e.target.value.toLowerCase(); setSlug(v); setTouched(v !== ""); if (!v) setSlug(slugify(name)); }} />
      </Field>
    </>
  );
}
