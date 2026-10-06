import { describe, expect, it } from "vitest";
import { makeXlsx } from "../../../tests/fixtures/files";
import {
  platformFromName,
  extractHashtags, guessMapping, mapRows, normalizeFormat, normalizePlatform, normalizeStatus, parseDate, parseOffset, parseTime, splitSlides, splitThread,
} from "./mapping";
import { parseCsv, tablesFromCsv, tablesFromXlsx } from "./table";

// Synthetic plans with the same shape as the owner's real files (headers, value styles), short content.
const cherr = () => makeXlsx([{ name: "Untitled", rows: [
  ["#", "Category", "Audience", "Post text (EN)", "Chars", "CTA / hashtags", "Image type", "AI image prompt (background)", "Overlay text (Text posts)", "Status", "Posted on", "Notes"],
  [1, "Launch / story", "All", "We're rebuilding CHERR.IO.\n\nBuilt in Slovenia. 🍒", 213, "Follow for build updates", "Photo", "Open hand holding a pouch", null, "posted", "2.10.2026", null],
  [3, "How it works", "Donors", "How a donation works:\n\n1️⃣ You give", 243, "cherr.io", "Text", "Dark charcoal background", "You give. It's locked.", "posted", "5.10.2026", null],
  [4, "Tech", "Builders", "Every campaign is a smart contract.", 232, "#Polygon #USDC #BuildInPublic", "Text", "Dark charcoal background", "One campaign. One contract.", "posted", null, null],
  [5, "Milestones", "Donors", "Funds are released in 3 tranches.", 224, "#transparency #charity", "Photo", "Receipts on a table", null, "Draft", null, null],
] }]);

const aib = () => makeXlsx([{ name: "Plan objav", rows: [
  ["Datum", "Dan", "Ura", "Platforma", "Račun", "Format", "Tema", "Besedilo objave", "Prompt za sliko (AI)", "Carousel slide-i (tekst v Canvi)", "Link / CTA", "Status"],
  [46294, "tor", "08:30", "LinkedIn", "David (osebni profil)", "Text + image", "Problem", "AI can write an app in an afternoon.", "A small figure at a wall", "—", "Link v prvi komentar: aibuilders.si", "Za objavo"],
  [46294, "tor", "18:00", "Instagram", "@aibuilders", "Carousel (6)", "Problem", "Vibe coding is easy. Until it isn't. 👇", "Isometric laptop", "1: Vibe coding is easy.\n2: It works on your laptop.\n3: Every fix breaks something else.", "Link v bio (aibuilders.si)", "Objavljeno"],
  [46296, "čet", "13:00", "X", "@davitacer", "Thread (6)", "Tip", "5 signs your app isn't ready 🧵\n\n1/ You've never opened it on your phone.\n\n2/ Your API keys live in the code.\n\nFix those.", "—", "—", "—", "Za objavo"],
] }]);

const inz = () => makeXlsx([{ name: "Untitled", rows: [
  ["Dan", "Datum (od danes)", "Tip", "Tema", "Image Prompt (Flux Pro / MJ v6 — 4:5)", "Caption", "Hashtagi", "Status"],
  [1, "+0", "Single image", "Server room", "Brutalist server room", "WordPress je bil dobra rešitev leta 2010.", "#spletnaStran #wordpress #inzenirjisi", "objavljeno"],
  [5, "+12", "Video (AI influencerka)", "AI video", "[VIDEO — ne potrebuje image prompta.]", "ChatGPT ti napiše spletno stran v 10 minutah.", "#ai #webdev", "pending"],
  [7, "+18", "Carousel — 6 slajdov", "5 znakov", "COVER: Black bg. | SLAJD 1: 01 STRAN SE NALAGA POCASI | CTA SLAJD: KAJ SEDAJ?", "Kdaj si nazadnje pogledal svojo spletno stran?", "#webdesign", "pending"],
] }]);

describe("value readers", () => {
  it("dates: Excel serials, ISO, Slovenian d.m.yyyy; impossible dates refused", () => {
    expect(parseDate("46294")).toBe("2026-09-29");
    expect(parseDate("2026-09-29 00:00:00")).toBe("2026-09-29");
    expect(parseDate("2.10.2026")).toBe("2026-10-02");
    expect(parseDate("2. 10. 2026")).toBe("2026-10-02");
    expect(parseDate("31.2.2026")).toBeNull();
    expect(parseDate("+12")).toBeNull();
    expect(parseDate("jutri")).toBeNull();
  });
  it("times, offsets, platforms, formats, statuses", () => {
    expect([parseTime("08:30"), parseTime("8.30"), parseTime("18h"), parseTime("0.5"), parseTime("25:00")]).toEqual(["08:30", "08:30", "18:00", "12:00", null]);
    expect([parseOffset("+12"), parseOffset("12.0"), parseOffset("-3"), parseOffset("tor")]).toEqual([12, 12, -3, null]);
    expect(["LinkedIn", "Instagram", "X", "Twitter", "IG reels", "Facebook", "pismo"].map(normalizePlatform)).toEqual(["linkedin", "instagram", "x", "x", "instagram", "facebook", null]);
    expect(normalizeFormat("Carousel (6)")).toEqual({ format: "carousel", slides: 6 });
    expect(normalizeFormat("Carousel — 5 slajdov")).toEqual({ format: "carousel", slides: 5 });
    expect(normalizeFormat("Thread (9)")).toEqual({ format: "thread", slides: 9 });
    expect(normalizeFormat("Text + image")).toEqual({ format: "image", slides: null });
    expect(normalizeFormat("Single")).toEqual({ format: "text", slides: null });
    expect(normalizeFormat("Video (AI influencerka)")).toEqual({ format: "video", slides: null });
    expect(normalizeFormat("???")).toBeNull();
    expect(["objavljeno", "posted", "Objavljeno", "Za objavo", "pending", "Draft", "preskočeno"].map(normalizeStatus)).toEqual(["published", "published", "published", "planned", "planned", "planned", "skip"]);
  });
  it("slides, thread parts, hashtags", () => {
    expect(splitSlides("1: A\n2: B\n3: C")).toEqual(["A", "B", "C"]);
    expect(splitSlides("COVER: x | SLAJD 1: y | CTA: z")).toEqual(["COVER: x", "SLAJD 1: y", "CTA: z"]);
    expect(splitSlides("—")).toEqual([]);
    expect(splitThread("Hook 🧵\n\n1/ one\n\n2/ two\n\nOutro.")).toEqual(["Hook 🧵", "1/ one", "2/ two\n\nOutro."]);
    expect(splitThread("No thread here.")).toBeNull();
    expect(extractHashtags("#Polygon #USDC #BuildInPublic #Polygon")).toEqual(["#Polygon", "#USDC", "#BuildInPublic"]);
  });
});

describe("platformFromName", () => {
  it("one platform named in the file or sheet name, else null", () => {
    expect(platformFromName("CHERR.IO_X_posts_001.xlsx Untitled")).toBe("x");
    expect(platformFromName("IG_Content_Plan___100_dni_inzenirji.si.xlsx")).toBe("instagram");
    expect(platformFromName("davidtacer.com_-Linkedin_objave.docx")).toBe("linkedin");
    expect(platformFromName("AI-Builders-30-dni-objav.xlsx Plan objav")).toBeNull();
    expect(platformFromName("LinkedIn in Instagram plan.xlsx")).toBeNull(); // two platforms
    expect(platformFromName("xylophone.xlsx")).toBeNull();
  });
});

describe("tables", () => {
  it("CSV: quoted fields with delimiters and line breaks, semicolon detected, BOM removed", () => {
    expect(parseCsv('﻿Datum;Besedilo\n1.10.2026;"Prva; vrstica\nin druga ""citat"""\n')).toEqual([["Datum", "Besedilo"], ["1.10.2026", 'Prva; vrstica\nin druga "citat"']]);
    expect(tablesFromCsv("a,b\n,\n1,2")[0]).toMatchObject({ header: ["a", "b"], rows: [{ n: 3, cells: ["1", "2"] }] });
  });
  it("XLSX: header row found, empty rows skipped, row numbers kept, line breaks inside cells kept", () => {
    const [t] = tablesFromXlsx(aib());
    expect(t.header[7]).toBe("Besedilo objave");
    expect(t.rows.map((r) => r.n)).toEqual([2, 3, 4]);
    expect(t.rows[1].cells[9]).toBe("1: Vibe coding is easy.\n2: It works on your laptop.\n3: Every fix breaks something else.");
  });
});

describe("the owner's three plan shapes, mapped by headers", () => {
  it("CHERR.IO X: CTA/hashtags split, image type → image, overlay text, posted on → published", () => {
    const [t] = tablesFromXlsx(cherr());
    const m = guessMapping(t.header, t.rows.map((r) => r.cells));
    expect(m.columns).toEqual(["row_number", "category", "audience", "text", "char_count", "cta_hashtags", "image_type", "image_prompt", "overlay_text", "status", "published_on", "notes"]);
    const items = mapRows(t, { ...m, defaultPlatform: "x" });
    expect(items[0]).toMatchObject({ ref: "Untitled!2", platform: "x", format: "image", category: "Launch / story", text: "We're rebuilding CHERR.IO.\n\nBuilt in Slovenia. 🍒", cta: "Follow for build updates", hashtags: [], status: "published", publishedOn: "2026-10-02" });
    expect(items[2]).toMatchObject({ hashtags: ["#Polygon", "#USDC", "#BuildInPublic"], cta: null, overlayText: "One campaign. One contract.", status: "published", publishedOn: null });
    expect(items[3]).toMatchObject({ status: "planned", warnings: [] });
  });

  it("AI Builders 30 days: Excel dates, times, platform + account per row, carousel slides, X thread parts, weekday column ignored", () => {
    const [t] = tablesFromXlsx(aib());
    const m = guessMapping(t.header, t.rows.map((r) => r.cells));
    expect(m.columns).toEqual(["date", "ignore", "time", "platform", "account", "format", "topic", "text", "image_prompt", "slides", "cta", "status"]);
    const [li, ig, x] = mapRows(t, m);
    expect(li).toMatchObject({ date: "2026-09-29", time: "08:30", platform: "linkedin", account: "David (osebni profil)", format: "image", cta: "Link v prvi komentar: aibuilders.si", status: "planned", slides: [] });
    expect(ig).toMatchObject({ platform: "instagram", account: "@aibuilders", format: "carousel", slideCount: 6, slides: ["Vibe coding is easy.", "It works on your laptop.", "Every fix breaks something else."], status: "published" });
    expect(x).toMatchObject({ date: "2026-10-01", time: "13:00", platform: "x", format: "thread", imagePrompt: null, parts: ["5 signs your app isn't ready 🧵", "1/ You've never opened it on your phone.", "2/ Your API keys live in the code.\n\nFix those."] });
    expect([li, ig, x].flatMap((i) => i.warnings)).toEqual([]);
  });

  it("inzenirji.si 100 days: relative days, hashtags column, carousel prompt slides, video", () => {
    const [t] = tablesFromXlsx(inz());
    const m = guessMapping(t.header, t.rows.map((r) => r.cells));
    expect(m.columns).toEqual(["day_number", "day_offset", "format", "topic", "image_prompt", "text", "hashtags", "status"]);
    const items = mapRows(t, { ...m, defaultPlatform: "instagram" });
    expect(items.map((i) => [i.dayOffset, i.format, i.status])).toEqual([[0, "image", "published"], [12, "video", "planned"], [18, "carousel", "planned"]]);
    expect(items[0]).toMatchObject({ date: null, platform: "instagram", hashtags: ["#spletnaStran", "#wordpress", "#inzenirjisi"] });
    expect(items[2].slideCount).toBe(6);
  });

  it("unknown values become warnings, never guesses; a missing text is flagged", () => {
    const [t] = tablesFromCsv("Datum;Platforma;Format;Besedilo\njutri;Pismo;???;\n");
    const [i] = mapRows(t, guessMapping(t.header));
    expect(i.warnings).toEqual(["DATE:jutri", "PLATFORM:Pismo", "FORMAT:???", "NO_TEXT"]);
    expect([i.date, i.platform, i.format, i.text]).toEqual([null, null, "text", null]);
  });
});
