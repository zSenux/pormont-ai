import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { addDaysYmd, berlinParts, todayYmd } from "@/lib/berlin";

// Kalender-Abo (ICS, nur lesen) für iPhone/Outlook/Google. Geheimer Link = HMAC aus AUTH_SECRET;
// neuer AUTH_SECRET = neuer Link (alte Abos laufen ins Leere).

export function icsToken() {
  return createHmac("sha256", process.env.AUTH_SECRET ?? "").update("kalender-abo-v1").digest("base64url").slice(0, 32);
}

export function icsTokenOk(t: string) {
  const a = Buffer.from(t), b = Buffer.from(icsToken());
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function icsUrl() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}/kalender-abo/${icsToken()}/promont.ics`;
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const utc = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const dateOnly = (ymd: string) => ymd.replace(/-/g, "");

/** RFC 5545: Zeilen auf 75 Byte falten */
function fold(line: string) {
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = ch;
    } else cur += ch;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export async function buildIcs() {
  const from = addDaysYmd(todayYmd(), -60);
  const events = await db.event.findMany({ where: { startAt: { gte: new Date(`${from}T00:00:00Z`) } }, orderBy: { startAt: "asc" }, take: 2000, include: { project: { select: { name: true } } } });
  const now = utc(new Date());
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ProMont GmbH//Jarvis//DE", "CALSCALE:GREGORIAN", "X-WR-CALNAME:ProMont", "X-WR-TIMEZONE:Europe/Berlin", "REFRESH-INTERVAL;VALUE=DURATION:PT30M"];
  for (const e of events) {
    lines.push("BEGIN:VEVENT", `UID:${e.id}@promont-jarvis`, `DTSTAMP:${now}`);
    if (e.allDay) {
      const d = berlinParts(e.startAt).ymd;
      lines.push(`DTSTART;VALUE=DATE:${dateOnly(d)}`, `DTEND;VALUE=DATE:${dateOnly(addDaysYmd(d, 1))}`);
    } else lines.push(`DTSTART:${utc(e.startAt)}`, `DTEND:${utc(e.endAt ?? new Date(e.startAt.getTime() + 3600_000))}`);
    lines.push(`SUMMARY:${esc(e.title)}`);
    if (e.location) lines.push(`LOCATION:${esc(e.location)}`);
    const desc = [e.project ? `Projekt: ${e.project.name}` : null, e.notes].filter(Boolean).join("\n");
    if (desc) lines.push(`DESCRIPTION:${esc(desc)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
