# Animation (animate a post image)

Status: **Built** (TASK-023, replaces TASK-022's image-to-video for posts). Decisions: ADR-052 (supersedes ADR-051 for
posts), ADR-009/021 (Postaja draws every letter). Spec §5.6.

Owner (2026-10-07): post animations are made by Claude; **Kling 3.0 is only for AI-influencer videos**, which need a
persona (DNA + passport images, created or imported) so the same person can be generated again in new videos (phase 2).

## What the owner does
Post page → **Animacija** (every post with images): pick the image (carousels: every slide, text-only ones too),
optional instructions ("naslov besedo za besedo, logotip na koncu, 5 sekund"), **Animiraj · največ X €** → within a
minute an MP4 at the image's exact size: the elements of the brand template enter one after another, the illustration
drifts, everything ends on the finished still. Play, download (`…-video-1.mp4`); post and day ZIPs include
`video.mp4`. New images for the post remove the video (stale).

## How
- `src/server/video/motion.ts` — the motion spec (zod, data not code): `durationS` 3–10, background motion (`zoom_in`,
  `zoom_out`, `pan_*`, amount ≤ 0.25), per element index an entrance (`fade`, `rise`, `drop`, `slide_*`, `pop`,
  `grow_x`/`grow_y` for rules, `words` word by word) with `at`/`duration`/`ease`, and an optional loop (`pulse`,
  `float`, `breathe`) after it. `elementState` / `backgroundState` give each element's opacity, offset, scale and shown
  words at time t; `specIssues` checks indexes and that everything is in place 0.5 s before the end.
- `src/server/video/ai.ts` — Claude (tool `submit_motion`) gets the brand's common thread, the template's elements
  (kind, slot, words, box) and the owner's wish; reveal order like a reader, subtle loops, never changes words, colours,
  positions or sizes. One retry with the validation problems; `INVALID_OUTPUT` after that.
- `renderTemplate(..., { motion: { spec, t }, cache })` — the still's own renderer with per-element opacity/transform
  (Satori), hidden-but-placed words for `words`, the illustration scaled/translated; fitted pictures cached across frames.
- `encodeFrames` (`src/server/video/ffmpeg.ts`) — frames rendered one at a time and piped as PNG into ffmpeg
  (image2pipe, 25 fps) → H.264 yuv420p CRF 20 + silent AAC, faststart; never all frames in memory; 5 min timeout.
  ~0.2 s per 1080×1350 frame ⇒ ~30 s for a 6 s animation.
- `src/server/video/service.ts` — `requestAnimation` (any member, one per post at a time, instructions ≤ 600 chars),
  queue `post-video` (1 retry), worker acts as the requester; the design version that made the images is used; the
  spec is stored with the video (`post_media.prompt`, model `postaja-motion`). Cost = one Claude call under the spend
  cap (shown as "največ" on the button). No fal call.
- Kept for phase 2 persona video: fal `video()` (Kling 3.0 Standard default, Hailuo 02 alternative, `model_registry`
  kind `video`), `probeVideo`, `composeVideo` (clip + burned-in overlay), `renderTemplate(overlayOnly)`.

## Tests
`video/motion.test.ts` (entrances, words, rules, loops, background drift, spec issues), `video/ffmpeg.test.ts` (probe,
compose, frame encoder size/length/audio, a failing frame stops it), `design/design.int.test.ts` "animation by Claude"
(prompt inputs and wish, MP4 at the image size and length, spec stored, no video model paid, ZIP, stale removal, every
carousel slide animatable, retry on a bad spec, failure after two, other org), E2E `images.spec.ts` (animate the cover
with instructions, no fal call, ffprobe of the downloaded MP4; carousel offers all 4 images).
