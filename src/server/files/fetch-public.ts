// Fetching a file from a public URL on someone's behalf (TASK-010b: Claude names a logo or past-post image by URL).
// Server-side fetches are an SSRF risk, so: http(s) only, default ports only, every resolved address must be public
// (checked at connect time via `lookup`, so DNS rebinding cannot swap in a private address), redirects followed by hand
// (each hop re-checked, at most 3), a size cap counted on the wire, and one overall timeout. No cookies, no auth.
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

export class FetchError extends Error {
  constructor(public code: "BAD_URL" | "BLOCKED" | "TOO_LARGE" | "HTTP" | "TIMEOUT" | "NETWORK", message: string) {
    super(message);
  }
}

// Two lists: Node matches IPv4 queries against IPv6 rules too (::ffff:0:0/96 would swallow every IPv4 address).
const blocked4 = new BlockList();
const blocked6 = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked4.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [
  ["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b::", 96], ["100::", 64], ["2001::", 23], ["2001:db8::", 32],
  ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) blocked6.addSubnet(net, bits, "ipv6");

/** True only for globally routable unicast addresses (no loopback, private, link-local, metadata, mapped or reserved). */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked4.check(address, "ipv4");
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return isPublicAddress(mapped[1]);
    return !blocked6.check(address, "ipv6");
  }
  return false;
}

/** DNS lookup that refuses names resolving to any non-public address (used by the socket itself). */
export const publicLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    const list = addresses as LookupAddress[];
    if (!list.length || list.some((a) => !isPublicAddress(a.address))) {
      return callback(Object.assign(new Error("blocked address"), { code: "EBLOCKED" }), "", 0);
    }
    if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

export type FetchedFile = { bytes: Uint8Array; filename: string; contentType: string | null };

type Net = { lookup: LookupFunction; ports: string[] };
const PUBLIC_NET: Net = { lookup: publicLookup, ports: ["", "80", "443"] };

function checkUrl(raw: string, net: Net): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new FetchError("BAD_URL", "Not a valid URL.");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new FetchError("BAD_URL", "Only http(s) URLs.");
  if (u.username || u.password) throw new FetchError("BAD_URL", "URLs with credentials are not accepted.");
  if (!net.ports.includes(u.port)) throw new FetchError("BLOCKED", "Only default ports.");
  const host = u.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (isIP(host) && !isPublicAddress(host)) throw new FetchError("BLOCKED", "The address is not public.");
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) throw new FetchError("BLOCKED", "The address is not public.");
  return u;
}

function nameFrom(u: URL, disposition: string | undefined): string {
  const m = disposition && /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  let name = m ? m[1] : u.pathname.split("/").filter(Boolean).pop() ?? "";
  try {
    name = decodeURIComponent(name);
  } catch {
    /* keep as is */
  }
  return name.replace(/[\\/\0]/g, "_").slice(0, 200) || "file";
}

function once(u: URL, maxBytes: number, signal: AbortSignal, net: Net): Promise<{ status: number; location?: string; file?: FetchedFile }> {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.get(u, { lookup: net.lookup, signal, headers: { "user-agent": "Postaja/1.0 (+https://postaja.inzenirji.si)", accept: "*/*" }, agent: false }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        return resolve({ status, location: res.headers.location });
      }
      if (status !== 200) {
        res.resume();
        return reject(new FetchError("HTTP", `The server answered ${status}.`));
      }
      if (Number(res.headers["content-length"] ?? 0) > maxBytes) {
        res.destroy();
        return reject(new FetchError("TOO_LARGE", "The file is too large."));
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > maxBytes) {
          res.destroy();
          reject(new FetchError("TOO_LARGE", "The file is too large."));
          return;
        }
        chunks.push(c);
      });
      res.on("end", () => resolve({ status, file: { bytes: new Uint8Array(Buffer.concat(chunks)), filename: nameFrom(u, res.headers["content-disposition"]), contentType: res.headers["content-type"] ?? null } }));
      res.on("error", (e) => reject(e));
    });
    req.on("error", (e: NodeJS.ErrnoException) => {
      if (e instanceof FetchError) return reject(e);
      if (e.code === "EBLOCKED") return reject(new FetchError("BLOCKED", "The address is not public."));
      if (e.name === "AbortError") return reject(new FetchError("TIMEOUT", "The server took too long."));
      reject(new FetchError("NETWORK", `Could not reach the server (${e.code ?? e.message}).`));
    });
  });
}

/**
 * Downloads one public file (≤ maxBytes, ≤ 3 redirects, overall timeout). `net` is for tests only: a name→address
 * lookup and extra ports, so a local test server can stand in for a public one; IP literals stay checked regardless.
 */
export async function fetchPublicFile(raw: string, { maxBytes, timeoutMs = 20_000, net = PUBLIC_NET }: { maxBytes: number; timeoutMs?: number; net?: Net }): Promise<FetchedFile> {
  const signal = AbortSignal.timeout(timeoutMs);
  let u = checkUrl(raw, net);
  for (let hop = 0; hop <= 3; hop++) {
    const r = await once(u, maxBytes, signal, net);
    if (r.file) return r.file;
    u = checkUrl(new URL(r.location!, u).toString(), net);
  }
  throw new FetchError("HTTP", "Too many redirects.");
}

export type FetchFile = typeof fetchPublicFile;
