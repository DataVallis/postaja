# Animation (animate a post image)

Status: **Built** (TASK-022). Decisions: ADR-051, ADR-021 (text burned in by Postaja), ADR-009. Spec §5.6.

## What the owner does
Post page → **Animacija** (shown when an image's template has a full-bleed illustration): pick the image (carousels),
edit the motion prompt (prefilled from the illustration subject), **Animiraj · ≈ 0.27 €** → in a few minutes a 6 s MP4
at the image's exact size with the words, logo and shapes exactly as on the image; play, download (`…-video-1.mp4`);
the post ZIP and day ZIP include `video.mp4`. New images for the post remove the video (it would be stale).

## How
- `model_registry` kind `video`, `per_second` (migration 0024/0025): default **Hailuo 02 Standard** (768p, $0.045/s,
  6 s ⇒ $0.27) — Kling 2.1 Standard is deprecated on fal.
- `src/server/images/fal.ts`: shared queue runner; `video()` sends the clean illustration as a data URI (≤ 1280 px
  JPEG), the motion prompt + "No text, letters, logos or watermarks", duration 6, prompt optimizer off; downloads
  `video.url` from fal hosts only, ≤ 100 MB, 10 min queue timeout.
- `src/server/video/ffmpeg.ts`: `probeVideo` (ffprobe, file protocol only: exactly one video stream, mp4/mov/webm/mkv,
  ≤ 16 s, ≤ 4096 px) and `composeVideo` (scale to cover + crop to the slide size — never stretched — 25 fps, the
  transparent overlay PNG on top, H.264 yuv420p CRF 20 + silent stereo AAC, faststart, ≤ 6 s); temp dir per call,
  timeouts, killed on overrun. `FFMPEG_PATH` / `FFPROBE_PATH` optional.
- `renderTemplate(..., { overlayOnly: true })`: transparent canvas without picture and background colour; the
  illustration's fade overlay and every element drawn (only for full-bleed illustration templates).
- `src/server/video/service.ts`: `animatablePositions` (current design, full-bleed template, stored illustration),
  `requestAnimation` (any member; one video at a time per post, claim on `posts.video_status`, stale after 15 min;
  motion 3–600 chars), queue `post-video` (no automatic retry: a retry would pay again), `runVideoJob` (acts as the
  requester, re-verified), `animatePost`: reserve the clip price → fal → **settle once delivered** (the provider
  charged even if our checks then refuse the clip) / release on provider error → probe → overlay → compose → S3
  `post_media` kind `video` (position = slide) replacing the old one.
- Docker runner image installs `ffmpeg` (Debian); CI installs it when missing and checks `libx264` in the container.

## Tests
`src/server/video/ffmpeg.test.ts` (probe refusals incl. too long; exact size crop, overlay pixels, audio + video
streams, duration cap), `design/design.int.test.ts` "animation" (clean illustration + prompt to fal, 1080×1350 MP4,
cost settled 0.27 $, ZIP has video.mp4, new images remove it, NOT_ANIMATABLE, invalid motion, other org, provider
failure releases the cost, invalid clip keeps the cost and fails `VIDEO_INVALID`), E2E `images.spec.ts` (animate the
cover, ffprobe of the downloaded MP4: H.264 1080×1350 + AAC). The test Chromium has no H.264 decoder, so playback is
not asserted in the browser.

## Not yet
Ads and carousel inner slides with boxed illustrations; loop mode; persona references; motion prompt by Claude.
