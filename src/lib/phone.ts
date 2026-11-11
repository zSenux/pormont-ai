import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";

// Telefon-Jarvis über Twilio: Anruf auf die Jarvis-Nummer → Anrufer-Nummer muss einem Benutzer gehören →
// PIN per Tastatur → Gespräch (Twilio erkennt die Sprache, Jarvis antwortet, Twilio liest vor).
// Jede Anfrage von Twilio wird mit der Signatur (X-Twilio-Signature, HMAC-SHA1 mit dem Auth-Token) geprüft.
// Anrufer-Nummern lassen sich fälschen – deshalb zusätzlich die PIN (mind. 6 Ziffern, Sperre nach Fehlversuchen).

export const PIN_MAX_TRIES_PER_CALL = 3;
export const PIN_MAX_FAILS_PER_HOUR = 6;

export const phoneConfigured = () => Boolean(process.env.TWILIO_AUTH_TOKEN);

/** „0171 1234567“ / „+49 171 …“ / „0049…“ → „+491711234567“ (null = ungültig) */
export function normalizePhone(raw: string): string | null {
  let s = raw.replace(/[\s()/.-]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  else if (s.startsWith("0")) s = `+49${s.slice(1)}`;
  return /^\+[1-9]\d{6,14}$/.test(s) ? s : null;
}

/** Öffentliche Adresse, unter der Twilio uns aufruft (für die Signatur) */
export function publicUrl(req: Request) {
  const u = new URL(req.url);
  const base = process.env.PUBLIC_URL?.replace(/\/$/, "");
  if (base) return `${base}${u.pathname}${u.search}`;
  const h = req.headers;
  const proto = h.get("x-forwarded-proto")?.split(",")[0].trim() || u.protocol.replace(":", "");
  const host = h.get("x-forwarded-host")?.split(",")[0].trim() || h.get("host") || u.host;
  return `${proto}://${host}${u.pathname}${u.search}`;
}

/** Twilio-Signatur prüfen: Base64(HMAC-SHA1(AuthToken, URL + sortierte POST-Parameter)) */
export function validTwilioSignature(url: string, params: Record<string, string>, signature: string | null, token = process.env.TWILIO_AUTH_TOKEN) {
  if (!token || !signature) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const expected = createHmac("sha1", token).update(data, "utf8").digest();
  const given = Buffer.from(signature, "base64");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Twilio-Anfrage lesen und prüfen – null = nicht von Twilio */
export async function twilioRequest(req: Request): Promise<Record<string, string> | null> {
  const form = await req.formData().catch(() => null);
  if (!form) return null;
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") params[k] = v;
  if (!validTwilioSignature(publicUrl(req), params, req.headers.get("x-twilio-signature"))) {
    console.warn("[telefon] Ungültige Twilio-Signatur", publicUrl(req));
    return null;
  }
  return params;
}

// ---------- TwiML ----------
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const voice = () => esc(process.env.TWILIO_VOICE || "Polly.Daniel-Neural");

export const say = (text: string) => `<Say voice="${voice()}" language="de-DE">${esc(text.slice(0, 3000))}</Say>`;
export const pause = (s = 1) => `<Pause length="${s}"/>`;
export const redirect = (path: string) => `<Redirect method="POST">${esc(path)}</Redirect>`;
export const hangup = () => "<Hangup/>";
export const gatherPin = (inner: string) => `<Gather input="dtmf" numDigits="8" finishOnKey="#" timeout="10" action="/api/telefon/pin" method="POST">${inner}</Gather>`;
export const gatherSpeech = (inner: string) => `<Gather input="speech" language="de-DE" speechTimeout="auto" speechModel="phone_call" enhanced="true" actionOnEmptyResult="true" action="/api/telefon/frage" method="POST">${inner}</Gather>`;

export function twiml(...parts: string[]) {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${parts.join("")}</Response>`, { headers: { "Content-Type": "text/xml; charset=utf-8", "Cache-Control": "no-store" } });
}
export const forbidden = () => new Response("Forbidden", { status: 403 });

/** Laufender, per PIN bestätigter Anruf */
export async function verifiedCall(callSid: string | undefined) {
  if (!callSid) return null;
  const c = await db.phoneCall.findUnique({ where: { callSid } });
  if (!c?.verified || !c.userId || !c.chatId) return null;
  return c;
}

/** „Tschüss“, „das war’s“, „auflegen“ … */
export const isGoodbye = (s: string) => /^(tschüss|tschau|ciao|auf wieder(hören|sehen)|danke,? das war'?s|das war'?s|ende|auflegen|bye)\b/i.test(s.trim().replace(/[.!]$/, ""));
