import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { saveSettings } from "@/lib/settings";
import { msAppConfig } from "./config";
import { MailError } from "./types";

// Anmeldung bei Microsoft 365 (Entra ID, OAuth 2.0 Autorisierungscode + PKCE).
// Der Administrator meldet sich einmal unter Einstellungen → Verbindungen mit „Mit Microsoft anmelden“ an.
// Gespeichert wird nur das Aktualisierungs-Token (MS_REFRESH_TOKEN, verschlüsselt); Zugriffs-Tokens leben im Speicher.
// Rechte (delegiert, ohne Admin-Zustimmung möglich): Mails lesen/ändern/senden, auch für ein geteiltes Postfach.

export const MS_SCOPES = ["openid", "email", "offline_access", "User.Read", "Mail.ReadWrite", "Mail.Send", "Mail.ReadWrite.Shared", "Mail.Send.Shared"];

// MS_LOGIN_URL/MS_GRAPH_URL nur für lokale Tests mit einem Nachbau (nie in Produktion setzen)
const authority = (tenant: string) => `${process.env.MS_LOGIN_URL || "https://login.microsoftonline.com"}/${tenant}/oauth2/v2.0`;

export const msCallbackPath = "/api/mail/microsoft/callback";

/** Start der Anmeldung: Adresse bei Microsoft + Werte für das Cookie (state, PKCE) */
export function msAuthorizeUrl(redirectUri: string) {
  const app = msAppConfig();
  if (!app) throw new MailError("Erst Anwendungs-ID und geheimen Clientschlüssel speichern.");
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const url = new URL(`${authority(app.tenant)}/authorize`);
  url.search = new URLSearchParams({
    client_id: app.clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: MS_SCOPES.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return { url: url.toString(), state, verifier };
}

type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number; error?: string; error_description?: string };

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const app = msAppConfig();
  if (!app) throw new MailError("Microsoft-App ist nicht eingetragen (Anwendungs-ID/Clientschlüssel).");
  const res = await fetch(`${authority(app.tenant)}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: app.clientId, client_secret: app.secret, scope: MS_SCOPES.join(" "), ...body }),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => {
    throw new MailError("Microsoft-Anmeldung nicht erreichbar.");
  });
  const j = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !j.access_token) {
    const d = j.error_description ?? "";
    if (/AADSTS7000215|AADSTS7000222|invalid_client/i.test(d + j.error)) throw new MailError("Microsoft lehnt den Clientschlüssel ab – geheimen Clientschlüssel (Wert, nicht die ID) prüfen oder neu erzeugen.");
    if (j.error === "invalid_grant") throw new MailError("Die Microsoft-Anmeldung ist abgelaufen oder wurde widerrufen – unter Einstellungen → Verbindungen „Mit Microsoft anmelden“ erneut klicken.");
    throw new MailError(`Microsoft-Anmeldung fehlgeschlagen: ${(d || j.error || res.status).toString().split("\r\n")[0].slice(0, 200)}`);
  }
  return j;
}

type G = { __pmMsToken?: { token: string; until: number; for: string }; __pmMsRefreshing?: Promise<string> };
const g = globalThis as G;

/** Neues Aktualisierungs-Token speichern (Microsoft tauscht es bei jeder Erneuerung aus) */
async function keep(refresh: string | undefined) {
  if (refresh && refresh !== process.env.MS_REFRESH_TOKEN) await saveSettings({ MS_REFRESH_TOKEN: refresh });
}

/** Code aus der Rückleitung gegen Tokens tauschen und das Konto merken */
export async function msFinishLogin(code: string, verifier: string, redirectUri: string) {
  const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: verifier });
  if (!t.refresh_token) throw new MailError("Microsoft hat kein Aktualisierungs-Token geliefert (Recht „offline_access“ fehlt?).");
  const me = await fetch(`${process.env.MS_GRAPH_URL || "https://graph.microsoft.com/v1.0"}/me?$select=mail,userPrincipalName,displayName`, { headers: { Authorization: `Bearer ${t.access_token}` }, signal: AbortSignal.timeout(20_000) }).then((r) => r.json() as Promise<{ mail?: string | null; userPrincipalName?: string; displayName?: string }>);
  const address = (me.mail || me.userPrincipalName || "").trim().toLowerCase();
  if (!address.includes("@")) throw new MailError("Konnte die E-Mail-Adresse des Microsoft-Kontos nicht lesen.");
  await saveSettings({ MAIL_PROVIDER: "microsoft", MAIL_USER: address, MS_REFRESH_TOKEN: t.refresh_token });
  g.__pmMsToken = { token: t.access_token, until: Date.now() + (t.expires_in - 120) * 1000, for: t.refresh_token };
  return { address, name: me.displayName ?? address };
}

/** Gültiges Zugriffs-Token (aus dem Speicher oder per Aktualisierungs-Token erneuert) */
export async function msAccessToken(force = false): Promise<string> {
  const refresh = process.env.MS_REFRESH_TOKEN;
  if (!refresh) throw new MailError("Nicht bei Microsoft angemeldet – unter Einstellungen → Verbindungen „Mit Microsoft anmelden“.");
  const c = g.__pmMsToken;
  if (!force && c && c.until > Date.now() && c.for === refresh) return c.token;
  // Nur eine Erneuerung gleichzeitig (sonst würde Microsoft das gerade getauschte Token ablehnen)
  g.__pmMsRefreshing ??= (async () => {
    try {
      const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: refresh });
      await keep(t.refresh_token);
      g.__pmMsToken = { token: t.access_token, until: Date.now() + (t.expires_in - 120) * 1000, for: process.env.MS_REFRESH_TOKEN ?? refresh };
      return t.access_token;
    } finally {
      g.__pmMsRefreshing = undefined;
    }
  })();
  return g.__pmMsRefreshing;
}

/** Abmelden: Token vergessen (Microsoft-seitig widerruft man die App unter myaccount.microsoft.com) */
export async function msLogout() {
  g.__pmMsToken = undefined;
  await saveSettings({ MS_REFRESH_TOKEN: null, MAIL_USER: null });
}
