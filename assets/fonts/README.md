# Built-in image fonts

Used by the image renderer (`src/server/design/render.ts`) when a brand design picks a built-in family (or as the
fallback after a brand font). Each file is the Fontsource Latin + Latin Extended subsets merged with fontTools, so
č š ž ć đ are covered (checked by `src/server/design/design.test.ts`). All OFL-1.1, licences next to the files.

| Family key | Files | Source |
|---|---|---|
| `sans` | `Inter-Regular.woff`, `Inter-Bold.woff` | `@fontsource/inter@5.3.0` |
| `grotesk` | `SpaceGrotesk-Regular.woff`, `SpaceGrotesk-Bold.woff` | `@fontsource/space-grotesk@5.3.0` |
| `serif` | `PlayfairDisplay-Regular.woff`, `PlayfairDisplay-Bold.woff` | `@fontsource/playfair-display@5.3.0` |
| `mono` | `JetBrainsMono-Regular.woff`, `JetBrainsMono-Bold.woff` | `@fontsource/jetbrains-mono@5.3.0` |
| fallback `symbols` | `NotoSansSymbols-Regular.woff` | `@fontsource/noto-sans-symbols-2@5.3.0` + `@fontsource/noto-sans-symbols@5.3.0` (symbols subsets merged): ✓ ✗ → ★ ● ■ ▲ … |
