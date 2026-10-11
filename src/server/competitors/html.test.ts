import { describe, expect, it } from "vitest";
import { decodeEntities, htmlToText, PAGE_TEXT_MAX } from "./html";

describe("htmlToText (TASK-050)", () => {
  it("keeps title, description and visible text; drops scripts, styles, navigation and markup", () => {
    const html = `<!doctype html><html><head><title>Koda &amp; Akademija</title>
      <meta name="description" content="Tečaj programiranja &ndash; za vse"><style>.a{color:red}</style>
      <script>window.x = "<p>ne</p>"</script></head>
      <body><nav><a href="/">Domov</a></nav><main><h1>Nauči se&nbsp;kodirati</h1><p>Prvi <b>tečaj</b> v Sloveniji.<br>Od 99 €.</p>
      <!-- komentar --><ul><li>Hitro</li><li>Hitro</li></ul></main><footer>© 2026</footer>
      <form><input value="geslo"></form></body></html>`;
    const { title, text } = htmlToText(html);
    expect(title).toBe("Koda & Akademija");
    expect(text.split("\n")).toEqual(["Tečaj programiranja – za vse", "Nauči se kodirati", "Prvi tečaj v Sloveniji.", "Od 99 €.", "Hitro"]);
    expect(text).not.toMatch(/window|color|Domov|komentar|geslo|2026/);
  });

  it("decodes numeric entities, ignores unknown ones and caps the length", () => {
    expect(decodeEntities("&#269;&#x161;&bogus; &#0;")).toBe("čš&bogus; ");
    expect(htmlToText(`<p>${"a".repeat(PAGE_TEXT_MAX + 50)}</p>`).text).toHaveLength(PAGE_TEXT_MAX);
    expect(htmlToText("<meta property='og:description' content='OG opis'><p>x</p>").text).toBe("OG opis\nx");
  });
});
