# 2026-10-10 — Brand designs fail for a brand with Google Fonts

**Impact:** dev, brand petprep.si. Two design versions (v1 19:44, v2 19:54) ended "ni uspela" with
"Claude ni vrnil veljavne podobe. Poskusi znova ali dopolni opis." No customer data affected.

**Cause:** the owner uploaded Instrument Sans and Bricolage Grotesque from Google Fonts. Both are **variable fonts**
(`fvar`/`gvar`). Satori 0.35 (opentype.js) cannot parse them: `Cannot read properties of undefined (reading '256')`.
The upload checks (cmap, diacritics) passed. Claude chose the brand font (it was offered), the design job's test render
threw, the retry did the same, and the version failed with `INVALID_OUTPUT` — the real reason was not stored anywhere.

**Workaround (owner, same evening):** deleted the variable fonts and uploaded static instances (made with
`fonttools varLib.instancer`); the design then succeeded.

**Fix (ADR-077):**
- Upload: variable fonts are stored as their default instance (variation tables dropped, in-house); every font is
  test-rendered with Satori and refused with `FONT_UNSUPPORTED` if it still fails.
- Render: fonts stored before the fix are reduced the same way; a font that still fails is skipped (built-in family,
  and Claude is not offered it), so a bad font can no longer fail designs, images, ads or videos.
- Diagnosis: a failed design stores `INVALID_OUTPUT:schema` or `INVALID_OUTPUT:render <message>` and logs it.

**Proof:** reproduced with the real Google Fonts files (both fail raw, both render after `staticInstance`); unit and
integration tests with a self-made variable fixture `tests/fixtures/fonts/TinySansVar.ttf`.
