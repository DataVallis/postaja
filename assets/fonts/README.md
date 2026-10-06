# Built-in image fonts

Used by the image renderer (`src/server/images/render.ts`) when a brand has no font of its own.

- `Inter-Bold.woff` — Inter 700, from `@fontsource/inter@5.3.0` (latin + latin-ext subsets merged with fontTools). OFL-1.1, see `LICENSE-Inter.txt`.
- `JetBrainsMono-Bold.woff` — JetBrains Mono 700, from `@fontsource/jetbrains-mono@5.3.0` (latin + latin-ext merged). OFL-1.1, see `LICENSE-JetBrainsMono.txt`.

Both cover č š ž ć đ (checked by `src/server/images/render.test.ts`).
