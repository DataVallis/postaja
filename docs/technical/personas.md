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

## Persona video (TASK-025, ADR-055)
On a post of a brand whose persona has pictures (`src/server/video/persona.ts`, section `#persona-video`):
1. Claude writes the shot (`submit_persona_scene`, `src/server/personas/scene.ts`): first frame + motion, from the
   post, the DNA and the owner's wish; no speech, no text, one action, one camera move.
2. First frame: default `image_ref` (Nano Banana Pro edit), up to 4 passport pictures (primary first), 9:16.
3. Kling 3.0 Standard image-to-video, 5 or 10 s, no audio (reserved at full length, settled on delivery).
4. ffprobe, then fitted to 1080×1920 H.264 + silent AAC. Stored as `post_media` `video` (shot JSON in `prompt`) and
   `keyframe` (poster). Runs on the `post-video` queue with `posts.video_mode = 'persona'`.

## Persona in post images (TASK-027, ADR-057)
- `personas.use_in_posts` is the brand default (owner toggles it on the Persona tab); `posts.images_with_persona` is the
  post's own choice from the images form (TASK-031, ADR-060; null = default). `postPersona(db, ctx, brandId, choice)`
  returns the persona when the choice (or default) is on and it has at least one picture.
- `renderPostImages` then tells Claude (`<persona>` in `plan_post_images`) to describe each illustration as a photo
  scene without the person's looks, and draws it with `personaPicture` (default `image_ref`, Nano Banana Pro edit) from
  up to 4 passport pictures; the prompt is `personaIllustrationPrompt` (identity fields, scene, the DNA's style). Words
  and logo are drawn by Postaja as always.
- `estimateBulk` prices those illustrations with the reference model. Ad creatives keep the brand's style model.

## Videos are kept (TASK-032, ADR-061)
Finished videos are rows in `post_videos` (`src/server/video/media.ts`: `addPostVideo`, `listPostVideos`,
`postVideoUrl` → `/api/post-videos/[id]` with `?poster=1` / `?download=1`, `deletePostVideo`). Nothing replaces or
removes a video except an explicit delete; the post page lists them newest first (`video-list.tsx`).
