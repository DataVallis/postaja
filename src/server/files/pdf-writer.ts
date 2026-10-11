// A PDF of full-page images (TASK-018: LinkedIn document carousels). One page per JPEG, the page the size of the
// image (1 px = 1 pt), the image embedded as-is (DCTDecode) — no re-encoding inside the PDF, no dependency.
export type PdfPage = { jpeg: Uint8Array; width: number; height: number };

const enc = new TextEncoder();

export function pdfFromJpegs(pages: PdfPage[], title = "Postaja"): Uint8Array {
  if (!pages.length) throw new Error("NO_PAGES");
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (b: Uint8Array) => { chunks.push(b); length += b.length; };
  const str = (s: string) => push(enc.encode(s));
  // Object numbers: 1 catalog, 2 pages, 3 info, then per page: page, content, image.
  const obj = (n: number, body: () => void) => { offsets[n] = length; str(`${n} 0 obj\n`); body(); str("\nendobj\n"); };
  const pageNo = (i: number) => 4 + i * 3;

  push(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // %PDF-1.4 + binary marker
  obj(1, () => str("<< /Type /Catalog /Pages 2 0 R >>"));
  obj(2, () => str(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageNo(i)} 0 R`).join(" ")}] >>`));
  // Title as UTF-16BE hex so č š ž survive.
  const hex = [...title].map((c) => c.charCodeAt(0).toString(16).padStart(4, "0")).join("");
  obj(3, () => str(`<< /Title <FEFF${hex}> /Producer (Postaja) >>`));
  pages.forEach((p, i) => {
    if (p.jpeg[0] !== 0xff || p.jpeg[1] !== 0xd8) throw new Error("NOT_JPEG");
    const [page, content, image] = [pageNo(i), pageNo(i) + 1, pageNo(i) + 2];
    const draw = `q ${p.width} 0 0 ${p.height} 0 0 cm /Im0 Do Q`;
    obj(page, () => str(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.width} ${p.height}] /Resources << /XObject << /Im0 ${image} 0 R >> >> /Contents ${content} 0 R >>`));
    obj(content, () => str(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`));
    obj(image, () => {
      str(`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
      push(p.jpeg);
      str("\nendstream");
    });
  });
  const count = 4 + pages.length * 3;
  const xref = length;
  str(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) str(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
  str(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}
