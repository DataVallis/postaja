# Personas (TASK-024, ADR-053)

An AI influencer of a brand: the **DNA** (what the person looks like) and the **passport** (pictures of that person).
Every picture and video of the persona starts from these, so the same person appears every time.

## Data
- `personas` — one per brand (`personas_brand_uq`); `dna jsonb` with the 13 fields of the owner's framework
  (`DNA_FIELDS` in `src/server/db/schema/personas.ts`); `passport_status` for the background job.
- `persona_images` — 0–10 per persona; `angle` (front = the generated passport; uploads may be labelled three_quarter, profile, smile, full_body or other), `source`
  (uploaded/generated), `is_primary` (at most one, `persona_images_primary_uq`), `sha256` (no duplicates).
- Bytes in S3 under `org/<org>/brand/<brand>/persona/<uuid>.<ext>`; shown via `/api/persona-images/[id]` (302 to a
  presigned URL, members of the org only).

## DNA
- By hand: the owner fills the fields (gender, age, ethnicity / skin tone, hair colour required).
- With AI: the owner writes a rough description or pastes/imports a DNA (document text via the CGP import endpoint);
  Claude (`submit_persona_dna`, `src/server/personas/dna.ts`) keeps every given detail, fills the rest, in English.

## Passport picture (`persona-passport` queue, ADR-054)
- One picture: a passport-style close-up whose prompt includes the whole DNA (all 13 fields) and real-photograph cues,
  made by the default `image_persona` model (**Nano Banana Pro**, 2K, $0.15).
- A new passport picture replaces the previous generated one and keeps primary if it had it; uploads stay.
- Booked like other images (reserve → settle, release on provider errors). A refusal keeps fal's reason
  (`IMAGE_BLOCKED:<reason>`), shown under the error.
- `passportReferences` / `personaPicture` with references (default `image_ref`, Nano Banana Pro edit) are for keyframes
  of persona videos (TASK-025).

Owner only for every change; members see the persona. Uploads: PNG/JPG/WebP ≤ 15 MB, ≥ 256 px, re-encoded.
