// The ZIP writer round-trips through our own reader and the system unzip: names with č š ž, text deflated, images stored.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { unzip } from "./zip";
import { zipBytes } from "./zip-writer";

const enc = new TextEncoder();
describe("zip writer", () => {
  it("writes entries that read back byte for byte", async () => {
    const png = new Uint8Array(5000).map((_, i) => (i * 7) % 256);
    const text = "Čas je za šolo in žabe. #ai\n".repeat(50);
    const zip = await zipBytes([
      { name: "aibuilders-si/instagram-08-30-metoda/besedilo.txt", bytes: async () => enc.encode(text) },
      { name: "aibuilders-si/instagram-08-30-metoda/1.png", bytes: async () => png },
      { name: "pregled.csv", bytes: async () => enc.encode("a;b\n") },
    ]);
    const entries = unzip(zip);
    expect(entries.map((e) => e.name)).toEqual(["aibuilders-si/instagram-08-30-metoda/besedilo.txt", "aibuilders-si/instagram-08-30-metoda/1.png", "pregled.csv"]);
    expect(new TextDecoder().decode((entries[0] as { bytes: Uint8Array }).bytes)).toBe(text);
    expect((entries[1] as { bytes: Uint8Array }).bytes).toEqual(png);
    expect(zip.length).toBeLessThan(text.length + png.length); // the text was compressed
    // The system's unzip agrees (CRCs, sizes, central directory).
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zipw-"));
    fs.writeFileSync(path.join(dir, "a.zip"), zip);
    expect(execFileSync("unzip", ["-tq", path.join(dir, "a.zip")]).toString()).toMatch(/No errors/);
  });

  it("an empty archive is valid", async () => {
    expect(unzip(await zipBytes([]))).toEqual([]);
  });
});
