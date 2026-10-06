// Brand image templates (TASK-015, ADR-009/043). Text and logos are laid out by Postaja, never drawn by the image model:
// exact letters (č š ž), the brand's own font and logo, and text edits cost nothing. This file is pure: it turns a
// template + texts + sizes into a Satori element tree. Three layouts after the owner's examples:
//   card   — CHERR.IO: background, label chip, headline (last line in accent), accent rule + logo footer
//   center — inzenirji.si: dark field, centred (mono) headline, one line in accent
//   photo  — the background image only (optional small logo)

export type Layout = "card" | "center" | "photo";
export type BrandTemplate = {
  layout: Layout;
  /** Text-card label: the plan's category ("THE PROBLEM"), or none. */
  label: "category" | "none";
  /** Which headline line is in the accent colour. */
  accentLine: "last" | "first" | "none";
  uppercase: boolean;
  /** 0..1: how much the background is darkened under the text. */
  overlay: number;
  /** Text next to the logo in the footer (e.g. "Polygon"), card layout only. */
  footerText: string;
  logoId: string | null;
  fontId: string | null;
  /** Built-in typeface when the brand has no font of its own (mono for code-style cards like inzenirji.si). */
  typeface: "sans" | "mono";
  /** "ai": a generated background behind the cover; "plain": the brand's background colour only (no image cost). */
  background: "ai" | "plain";
};

export const DEFAULT_TEMPLATE: BrandTemplate = { layout: "card", label: "category", accentLine: "last", uppercase: false, overlay: 0.65, footerText: "", logoId: null, fontId: null, typeface: "sans", background: "ai" };
export type Colors = { background: string; text: string; accent: string };
export const DEFAULT_COLORS: Colors = { background: "#12172b", text: "#f4efe6", accent: "#ff5a1f" };

export type Slide = {
  width: number;
  height: number;
  /** data: URI of the background, or null for a plain field. */
  background: string | null;
  label: string | null;
  headline: string | null;
  logo: { src: string; width: number; height: number } | null;
};

type Node = { type: string; props: Record<string, unknown> & { children?: unknown } };
const h = (type: string, style: Record<string, unknown>, children?: unknown, extra: Record<string, unknown> = {}): Node => ({ type, props: { style, children, ...extra } });

/** "You give. It's locked. It's paid out in steps." → three lines; explicit line breaks win. */
export function headlineLines(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  if (t.includes("\n")) return t.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const parts = t.split(/(?<=[.!?…])\s+(?=\S)/u).map((l) => l.trim()).filter(Boolean);
  return parts.length > 1 ? parts : [t];
}

/** Font size so the longest line fits the width (average glyph ≈ 0.56 em; mono 0.62), within sensible bounds. */
export function fitSize(lines: string[], innerWidth: number, scale: number, mono: boolean, max = 104): number {
  const longest = Math.max(1, ...lines.map((l) => [...l].length));
  const byWidth = innerWidth / (longest * (mono ? 0.62 : 0.56));
  const byCount = lines.length > 4 ? (max * 4) / lines.length : max;
  return Math.round(Math.max(40 * scale, Math.min(max * scale, byWidth, byCount * scale)));
}

/** Readable text on a colour: ink on light accents, white on dark ones (WCAG relative luminance). */
export function onColor(hex: string): string {
  const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return "#ffffff";
  const lin = (c: string) => { const v = parseInt(c, 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin(m[1]) + 0.7152 * lin(m[2]) + 0.0722 * lin(m[3]);
  return L > 0.4 ? "#12172b" : "#ffffff";
}

const rgba = (hex: string, a: number) => {
  const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})` : `rgba(0,0,0,${a})`;
};

/** The element tree Satori renders. Font families: "Heading" (brand or Inter). */
export function slideTree(tpl: BrandTemplate, colors: Colors, s: Slide, mono = false): Node {
  const k = s.width / 1080;
  const pad = Math.round(80 * k);
  const lines = headlineLines(tpl.uppercase && s.headline ? s.headline.toUpperCase() : s.headline ?? "");
  const accentAt = tpl.accentLine === "none" || lines.length < 2 ? -1 : tpl.accentLine === "first" ? 0 : lines.length - 1;
  const size = fitSize(lines, s.width - pad * 2, k, mono, tpl.layout === "center" ? 92 : 104);
  const bg = s.background
    ? [
        h("img", { position: "absolute", left: 0, top: 0, width: s.width, height: s.height, objectFit: "cover" }, undefined, { src: s.background, width: s.width, height: s.height }),
        tpl.layout === "photo"
          ? null
          : h("div", {
              position: "absolute", left: 0, top: 0, width: s.width, height: s.height,
              backgroundImage: tpl.layout === "center"
                ? `linear-gradient(180deg, ${rgba(colors.background, tpl.overlay)} 0%, ${rgba(colors.background, tpl.overlay)} 100%)`
                : `linear-gradient(180deg, ${rgba(colors.background, tpl.overlay * 0.35)} 0%, ${rgba(colors.background, tpl.overlay)} 55%, ${rgba(colors.background, Math.min(1, tpl.overlay + 0.25))} 100%)`,
            }),
      ].filter(Boolean)
    : [];
  const headline = lines.map((l, i) =>
    h("div", { display: "flex", color: i === accentAt ? colors.accent : colors.text, fontSize: size, lineHeight: 1.12, letterSpacing: mono ? 0 : -0.02 * size, fontWeight: 700 }, l),
  );

  if (tpl.layout === "photo") {
    return h("div", { display: "flex", position: "relative", width: s.width, height: s.height, backgroundColor: colors.background }, [
      ...bg,
      s.logo ? h("img", { position: "absolute", right: pad, bottom: pad, width: s.logo.width, height: s.logo.height }, undefined, { src: s.logo.src, width: s.logo.width, height: s.logo.height }) : null,
    ].filter(Boolean));
  }

  if (tpl.layout === "center") {
    return h("div", { display: "flex", position: "relative", width: s.width, height: s.height, backgroundColor: colors.background, fontFamily: "Heading" }, [
      ...bg,
      h("div", { position: "absolute", left: pad, right: pad, top: 0, bottom: 0, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", textAlign: "center" },
        headline.map((n) => ({ ...n, props: { ...n.props, style: { ...(n.props.style as object), justifyContent: "center" } } }))),
      s.logo ? h("img", { position: "absolute", left: (s.width - s.logo.width) / 2, bottom: pad, width: s.logo.width, height: s.logo.height }, undefined, { src: s.logo.src, width: s.logo.width, height: s.logo.height }) : null,
    ].filter(Boolean));
  }

  // card
  const footerH = Math.round(200 * k);
  const footer = s.logo || tpl.footerText
    ? h("div", { position: "absolute", left: 0, right: 0, bottom: 0, height: footerH, display: "flex", alignItems: "center", paddingLeft: pad, paddingRight: pad, borderTop: `${Math.max(2, Math.round(3 * k))}px solid ${colors.accent}` }, [
        s.logo ? h("img", { width: s.logo.width, height: s.logo.height }, undefined, { src: s.logo.src, width: s.logo.width, height: s.logo.height }) : null,
        s.logo && tpl.footerText ? h("div", { width: Math.max(1, Math.round(2 * k)), height: Math.round(64 * k), backgroundColor: rgba(colors.text, 0.35), marginLeft: Math.round(40 * k), marginRight: Math.round(40 * k) }) : null,
        tpl.footerText ? h("div", { display: "flex", color: colors.text, fontSize: Math.round(44 * k), fontWeight: 700 }, tpl.footerText) : null,
      ].filter(Boolean))
    : null;
  const label = s.label
    ? h("div", { display: "flex", alignSelf: "flex-start", backgroundColor: colors.accent, color: onColor(colors.accent), fontSize: Math.round(26 * k), fontWeight: 700, letterSpacing: 0.18 * 26 * k, padding: `${Math.round(10 * k)}px ${Math.round(18 * k)}px`, marginBottom: Math.round(32 * k) }, s.label.toUpperCase())
    : null;
  return h("div", { display: "flex", position: "relative", width: s.width, height: s.height, backgroundColor: colors.background, fontFamily: "Heading" }, [
    ...bg,
    h("div", { position: "absolute", left: pad, right: pad, top: 0, bottom: footer ? footerH : 0, display: "flex", flexDirection: "column", justifyContent: "center" }, [label, ...headline].filter(Boolean)),
    footer,
  ].filter(Boolean));
}
