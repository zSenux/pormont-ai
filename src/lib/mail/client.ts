import "server-only";
import { mailAddress, mailConfig } from "./config";
import { withSignature } from "./signature";
import * as graph from "./graph";
import * as imap from "./imap";
import { MailError, type MailFull, type MailSummary, type OutgoingMail } from "./types";

// Einstieg für die ganze App: wählt je nach Einstellung IMAP/SMTP (Strato, GMX, IONOS …) oder Microsoft 365 (Graph).

export { MailError };
export type { MailFull, MailSummary, OutgoingMail };

const backend = () => (mailConfig()?.kind === "graph" ? graph : imap);

export const listMails = (opts: Parameters<typeof imap.listMails>[0] = {}) => backend().listMails(opts);
export const readMail = (uid: string, markRead = false) => backend().readMail(uid, markRead);
export const setFlag = (uid: string, flag: "seen" | "flagged", on: boolean) => backend().setFlag(uid, flag, on);
/** Signatur (Einstellungen → Mail-Signatur) wird hier für alle Wege angehängt */
async function signed(m: OutgoingMail) {
  const c = mailConfig();
  return withSignature(m, c ? mailAddress(c) : "");
}
export const sendMail = async (m: OutgoingMail) => backend().sendMail(await signed(m));
export const saveDraft = async (m: OutgoingMail) => backend().saveDraft(await signed(m));
export const mailAttachment = (uid: string, index: number) => backend().mailAttachment(uid, index);
export const mailsSince = (last: { uid: number | string; validity: string } | null) => backend().mailsSince(last);

/** Verbindungstest für die Einstellungen */
export async function mailStatus(): Promise<{ ok: boolean; text: string }> {
  const c = mailConfig();
  if (!c) {
    if (process.env.MAIL_OFF === "1") return { ok: false, text: "Abgeschaltet (MAIL_OFF=1 im Hosting) – in Klaic Deploy löschen und neu starten." };
    if ((process.env.MAIL_PROVIDER ?? "").toLowerCase() === "microsoft") return { ok: false, text: process.env.MS_CLIENT_ID ? "Microsoft 365: noch nicht angemeldet – „Mit Microsoft anmelden“ klicken." : "Microsoft 365: App-Registrierung (Anwendungs-ID, Clientschlüssel) fehlt." };
    return { ok: false, text: "Nicht verbunden – Postfach unter Verbindungen eintragen." };
  }
  // Die Einstellungen dürfen nie am Postfach hängen bleiben
  let t: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ ok: boolean; text: string }>((r) => (t = setTimeout(() => r({ ok: false, text: "Mailserver antwortet nicht (Zeitüberschreitung) – Zugangsdaten/Anbieter prüfen oder „Postfach trennen“." }), 12_000)));
  return Promise.race([backend().mailStatus().catch((e) => ({ ok: false, text: e instanceof Error ? e.message : "Nicht erreichbar." })), timeout]).finally(() => clearTimeout(t));
}
