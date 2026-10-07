# Personas (TASK-024, ADR-053)

An AI influencer of a brand: the **DNA** (what the person looks like) and the **passport** (pictures of that person).
Every picture and video of the persona starts from these, so the same person appears every time.

## Data
- `personas` — one per brand (`personas_brand_uq`); `dna jsonb` with the 13 fields of the owner's framework
  (`DNA_FIELDS` in `src/server/db/schema/personas.ts`); `passport_status` for the background job.
- `persona_images` — 0–10 per persona; `angle` (front, three_quarter, profile, smile, full_body, other), `source`
  (uploaded/generated), `is_primary` (at most one, `persona_images_primary_uq`), `sha256` (no duplicates).
- Bytes in S3 under `org/<org>/brand/<brand>/persona/<uuid>.<ext>`; shown via `/api/persona-images/[id]` (302 to a
  presigned URL, members of the org only).

## DNA
- By hand: the owner fills the fields (gender, age, ethnicity / skin tone, hair colour required).
- With AI: the owner writes a rough description or pastes/imports a DNA (document text via the CGP import endpoint);
  Claude (`submit_persona_dna`, `src/server/personas/dna.ts`) keeps every given detail, fills the rest, in English.

## Passport generation (`persona-passport` queue)
1. With no pictures: a passport-style portrait from the whole DNA (default `image` model; the DNA's camera angle and
   pose are replaced by the passport framing).
2. The missing angles (3/4, profile, smile, full body) with the default `image_ref` model (Nano Banana edit), the
   existing pictures as references (primary first, up to 4, ≤ 1024 px JPEG data URIs).
3. Each picture is booked like other images (reserve → settle, release on provider errors) and stored as soon as it
   is made; a failed run keeps what it made, and the next run fills only what is missing.

Owner only for every change; members see the persona. Uploads: PNG/JPG/WebP ≤ 15 MB, ≥ 256 px, re-encoded.
