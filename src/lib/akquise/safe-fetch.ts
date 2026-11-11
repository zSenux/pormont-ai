import "server-only";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { isIP } from "node:net";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { Agent, fetch as undiciFetch } from "undici";

// Abruf fremder Websites mit SSRF-Schutz:
// - nur http/https auf Port 80/443
// - jede aufgelöste IP wird geprüft (auch nach Weiterleitungen und bei DNS-Rebinding),
//   private/interne Adressen sind gesperrt → kein Zugriff auf Projekt-DB, Traefik oder andere Container
// - Weiterleitungen werden einzeln verfolgt (max. 5), Antwort auf 2 MB begrenzt

export class BlockedUrlError extends Error {}

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const USER_AGENT = "Mozilla/5.0 (compatible; ProMontJarvis/1.0; +https://promont.gmbh)";

function ipv4ToInt(ip: string) {
  return ip.split(".").reduce((n, p) => (n << 8) + Number(p), 0) >>> 0;
}

const BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

export function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const n = ipv4ToInt(ip);
    return BLOCKED_V4.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (ipv4ToInt(base) & mask);
    });
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::" || v6 === "::1") return true;
  if (v6.startsWith("::ffff:")) return isPrivateIp(v6.slice(7)); // IPv4-mapped
  if (/^f[cd]/.test(v6)) return true; // fc00::/7 (Unique Local)
  if (/^fe[89ab]/.test(v6)) return true; // fe80::/10 (Link-Local)
  if (v6.startsWith("ff")) return true; // Multicast
  return false;
}

// DNS-Auflösung mit Prüfung – greift bei jeder Verbindung, die undici aufbaut
function guardedLookup(
  hostname: string,
  options: object,
  callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
) {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, []);
    const list = addresses as LookupAddress[];
    const bad = list.find((a) => isPrivateIp(a.address));
    if (bad || list.length === 0) {
      return callback(Object.assign(new BlockedUrlError(`Interne Adresse gesperrt (${hostname})`), { code: "EBLOCKED" }), []);
    }
    if ((options as { all?: boolean }).all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

const agent = new Agent({
  connect: { lookup: guardedLookup as never, timeout: 10_000 },
  headersTimeout: 15_000,
  bodyTimeout: 15_000,
});

export function assertPublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError("Ungültige Adresse");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new BlockedUrlError("Nur http/https erlaubt");
  if (url.username || url.password) throw new BlockedUrlError("Zugangsdaten in der URL sind nicht erlaubt");
  if (url.port && url.port !== "80" && url.port !== "443") throw new BlockedUrlError("Nur Port 80/443 erlaubt");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && isPrivateIp(host)) throw new BlockedUrlError("Interne Adresse gesperrt");
  if (!host.includes(".") || /\.(local|internal|localhost)$/i.test(host) || host === "localhost") {
    throw new BlockedUrlError("Interne Adresse gesperrt");
  }
  return url;
}

export type SafeResponse = {
  url: string;
  status: number;
  headers: Headers;
  body: string;
  redirects: string[];
};

/** GET mit Weiterleitungen, SSRF-Schutz und Größenlimit. Wirft bei Netzwerkfehlern. */
export async function safeFetch(raw: string, timeoutMs = 20_000): Promise<SafeResponse> {
  const signal = AbortSignal.timeout(timeoutMs);
  const redirects: string[] = [];
  let url = assertPublicUrl(raw);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await undiciFetch(url, {
      dispatcher: agent,
      redirect: "manual",
      signal,
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", "Accept-Language": "de-DE,de;q=0.9" },
    });

    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      redirects.push(url.toString());
      url = assertPublicUrl(new URL(location, url).toString());
      continue;
    }

    return {
      url: url.toString(),
      status: res.status,
      headers: res.headers as unknown as Headers,
      body: await readLimited(res.body),
      redirects,
    };
  }
  throw new Error("Zu viele Weiterleitungen");
}

async function readLimited(body: NodeReadableStream<Uint8Array> | null): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks).subarray(0, MAX_BYTES));
}

/** Binärdaten (z. B. Bilder) mit gleichem SSRF-Schutz laden – max. `maxBytes`, sonst Fehler */
export async function safeFetchBytes(raw: string, maxBytes = 8 * 1024 * 1024, timeoutMs = 20_000): Promise<{ url: string; status: number; type: string; bytes: Buffer }> {
  const signal = AbortSignal.timeout(timeoutMs);
  let url = assertPublicUrl(raw);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await undiciFetch(url, { dispatcher: agent, redirect: "manual", signal, headers: { "User-Agent": USER_AGENT, Accept: "image/*,*/*;q=0.5" } });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      url = assertPublicUrl(new URL(location, url).toString());
      continue;
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) { await reader.cancel().catch(() => {}); throw new Error("Datei zu groß"); }
        chunks.push(value);
      }
    }
    return { url: url.toString(), status: res.status, type: res.headers.get("content-type") ?? "", bytes: Buffer.concat(chunks) };
  }
  throw new Error("Zu viele Weiterleitungen");
}

/** POST mit SSRF-Schutz (gleicher DNS-Check), ohne Weiterleitungen – z. B. für Webhook-Aktionen der Automationen */
export async function safePost(raw: string, body: string, headers: Record<string, string> = {}, timeoutMs = 10_000): Promise<{ status: number; text: string }> {
  const url = assertPublicUrl(raw);
  if (url.protocol !== "https:") throw new BlockedUrlError("Webhooks nur über https://");
  const res = await undiciFetch(url, { method: "POST", dispatcher: agent, redirect: "manual", signal: AbortSignal.timeout(timeoutMs), body, headers: { "User-Agent": USER_AGENT, "Content-Type": "application/json", ...headers } });
  const text = (await res.text()).slice(0, 2000);
  return { status: res.status, text };
}
