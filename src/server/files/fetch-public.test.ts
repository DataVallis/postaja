import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FetchError, fetchPublicFile, isPublicAddress, publicLookup } from "./fetch-public";

describe("isPublicAddress", () => {
  it("refuses loopback, private, link-local, metadata, CGNAT, reserved, mapped and non-IPs", () => {
    for (const a of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1",
      "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "ff02::1", "2001:db8::1", "localhost", "example.com", ""]) {
      expect(isPublicAddress(a), a).toBe(false);
    }
  });
  it("accepts public unicast addresses", () => {
    for (const a of ["1.1.1.1", "8.8.8.8", "172.32.0.1", "160.79.104.10", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) expect(isPublicAddress(a), a).toBe(true);
  });
});

async function code(p: Promise<unknown>) {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof FetchError ? e.code : String(e);
  }
}

describe("publicLookup (used by the socket, so DNS rebinding cannot reach a private address)", () => {
  it("refuses a name that resolves to loopback", async () => {
    const err = await new Promise<NodeJS.ErrnoException | null>((r) => publicLookup("localhost", {}, (e) => r(e)));
    expect(err?.code).toBe("EBLOCKED");
  });
});

describe("fetchPublicFile", () => {
  let server: http.Server;
  let port: string;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/logo") return res.writeHead(200, { "content-type": "image/png" }).end(Buffer.from("png-bytes"));
      if (req.url === "/named") return res.writeHead(200, { "content-disposition": 'attachment; filename="Cenik 2026.pdf"' }).end("pdf");
      if (req.url === "/hop") return res.writeHead(302, { location: "/logo" }).end();
      if (req.url === "/to-private") return res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" }).end();
      if (req.url === "/loop") return res.writeHead(302, { location: "/loop" }).end();
      if (req.url === "/big") return res.writeHead(200).end(Buffer.alloc(2000));
      if (req.url === "/big-chunked") {
        res.writeHead(200);
        for (let i = 0; i < 4; i++) res.write(Buffer.alloc(600));
        return res.end();
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = String((server.address() as AddressInfo).port);
  });
  afterAll(() => server.close());

  // A stand-in for a public host: "files.test" → the local server. IP literals and their checks are untouched.
  const net = () => ({
    ports: ["", "80", "443", port],
    lookup: ((_h: string, o: { all?: boolean }, cb: (e: null, a: unknown, f?: number) => void) => (o.all ? cb(null, [{ address: "127.0.0.1", family: 4 }]) : cb(null, "127.0.0.1", 4))) as never,
  });
  const get = (path: string, maxBytes = 1000) => fetchPublicFile(`http://files.test:${port}${path}`, { maxBytes, net: net() });

  it("downloads a file, names it from the path or Content-Disposition, follows a same-site redirect", async () => {
    expect(await get("/logo")).toMatchObject({ filename: "logo", contentType: "image/png" });
    expect(Buffer.from((await get("/logo")).bytes).toString()).toBe("png-bytes");
    expect((await get("/named")).filename).toBe("Cenik 2026.pdf");
    expect((await get("/hop")).filename).toBe("logo");
  });

  it("refuses redirects to private addresses, redirect loops, oversize bodies (declared or streamed) and errors", async () => {
    expect(await code(get("/to-private"))).toBe("BLOCKED");
    expect(await code(get("/loop"))).toBe("HTTP");
    expect(await code(get("/big"))).toBe("TOO_LARGE");
    expect(await code(get("/big-chunked"))).toBe("TOO_LARGE");
    expect(await code(get("/missing"))).toBe("HTTP");
  });

  it("with the real guard: no private IPs, no names resolving to them, no odd ports, schemes or credentials", async () => {
    const real = (u: string) => code(fetchPublicFile(u, { maxBytes: 1000, timeoutMs: 5000 }));
    expect(await real(`http://127.0.0.1:${port}/logo`)).toBe("BLOCKED");
    expect(await real("http://127.0.0.1/logo")).toBe("BLOCKED");
    expect(await real("http://[::1]/logo")).toBe("BLOCKED");
    expect(await real("http://169.254.169.254/latest/meta-data")).toBe("BLOCKED");
    expect(await real("http://localhost/logo")).toBe("BLOCKED");
    expect(await real("http://localhost./logo")).toBe("BLOCKED");
    expect(await real("https://example.com:8443/x")).toBe("BLOCKED");
    expect(await real("ftp://example.com/x")).toBe("BAD_URL");
    expect(await real("file:///etc/passwd")).toBe("BAD_URL");
    expect(await real("https://user:pw@example.com/x")).toBe("BAD_URL");
    expect(await real("not a url")).toBe("BAD_URL");
  });
});
