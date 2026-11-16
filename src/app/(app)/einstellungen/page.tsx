import { noLogin } from "@/lib/personal-shared";
import Link from "next/link";
import { areasOf, AREA_LABEL, FUNKTIONEN, FUNKTION_LABEL } from "@/lib/rights-shared";
import { navFor, type NavGroup } from "@/lib/nav-shared";
import { setUserFunktion } from "@/app/actions";
import { headers } from "next/headers";
import { Database, LogOut, MonitorSmartphone, PhoneCall } from "lucide-react";
import { mailStatus } from "@/lib/mail/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { formatDate, formatDateTime } from "@/lib/berlin";
import { lexwareConfigured } from "@/lib/lexware/client";
import { profile } from "@/lib/lexware/api";
import { logout, logoutEverywhere, savePhoneAccess } from "@/app/actions";
import { StateForm } from "@/components/state-form";
import { PushToggle } from "@/components/pwa";
import { WindowsAppDownload } from "@/components/windows-app";
import { latestWindowsRelease } from "@/lib/windows-app";
import { AddUserForm, DeleteButton, PasswordForm } from "./forms";
import { ConnectionsForm } from "./connections";
import { settingState } from "@/lib/settings";
import { license, lockReason } from "@/lib/license";

export const metadata = { title: "Einstellungen" };

/** Handy-„Mehr“: ohne die Punkte der unteren Leiste; Aufgaben wandern zu „Werkzeuge“ (ohne Mail-Recht sind sie selbst ein Tab) */
function mobileGroups(groups: NavGroup[]): NavGroup[] {
  const start = groups.find((g) => g.key === "start")?.items ?? [];
  const tabs = ["/", "/jarvis", "/kalender", "/mail", "/einstellungen", ...(start.some((i) => i.href === "/mail") ? [] : ["/aufgaben"])];
  return groups
    .filter((g) => g.key !== "start")
    .map((g) => ({ ...g, items: (g.key === "system" ? [...start, ...g.items] : g.items).filter((i) => !tabs.includes(i.href)) }))
    .filter((g) => g.items.length > 0);
}
export const dynamic = "force-dynamic";

async function lexwareState() {
  if (!lexwareConfigured()) return { ok: false, text: "Nicht verbunden – API-Schlüssel unten eintragen." };
  try {
    const p = await profile();
    return { ok: true, text: `Verbunden mit ${p.companyName}` };
  } catch (e) {
    return { ok: false, text: e instanceof Error ? e.message : "Nicht erreichbar." };
  }
}

export default async function EinstellungenPage({ searchParams }: { searchParams: Promise<{ willkommen?: string }> }) {
  const { willkommen } = await searchParams;
  const me = await requireUser();
  const winApp = await latestWindowsRelease();
  const [lex, mail, users, memories, devices] = await Promise.all([
    lexwareState(),
    mailStatus(),
    me.role === "ADMIN" ? db.user.findMany({ orderBy: { createdAt: "asc" } }) : Promise.resolve([]),
    db.memory.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    db.pushSubscription.count({ where: { userId: me.id } }),
  ]);
  const lic = await license();
  const myPhone = await db.user.findUniqueOrThrow({ where: { id: me.id }, select: { phone: true, phonePinHash: true } });
  const ai = Boolean(process.env.ANTHROPIC_API_KEY);
  const h = await headers();
  const origin = process.env.PUBLIC_URL?.replace(/\/$/, "") || `${h.get("x-forwarded-proto")?.split(",")[0] || "https"}://${h.get("x-forwarded-host") || h.get("host")}`;

  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-6 md:py-10">
      <h1 className="page-title"><span className="md:hidden">Mehr</span><span className="hidden md:inline">Einstellungen</span></h1>
      {/* Handy: alle Bereiche gruppiert wie die Seitenleiste am PC */}
      <div className="space-y-5 md:hidden">
        {mobileGroups(navFor(areasOf(me), me.role === "ADMIN")).map((g) => (
          <nav key={g.key} aria-label={g.title}>
            <h2 className="mb-2 text-xs font-semibold tracking-wider text-steel uppercase">{g.title}</h2>
            <div className="grid grid-cols-3 gap-2">
              {g.items.map((t) => (
                <Link key={t.href} href={t.href} className="card flex min-h-20 flex-col items-center justify-center gap-1.5 p-2 text-center text-xs leading-tight font-medium">
                  <t.icon className="size-5 text-brand" /> {t.label}
                </Link>
              ))}
            </div>
          </nav>
        ))}
      </div>
      <h2 className="pt-2 text-lg font-semibold md:hidden">Einstellungen</h2>

      {willkommen && me.role === "ADMIN" && (
        <section className="card border-brand/30 bg-brand-soft p-5 text-sm">
          <h2 className="font-semibold text-brand-2">Willkommen bei Jarvis!</h2>
          <p className="mt-1 text-ink">Trag jetzt unten den Lexware-Schlüssel, den Claude-Schlüssel und das E-Mail-Postfach ein. Danach kann Jarvis alles nutzen. Weitere Mitarbeiter legst du weiter unten unter „Team“ an.</p>
        </section>
      )}

      <section id="verbindungen" className="card scroll-mt-20 space-y-3 p-5">
        <h2 className="font-semibold">Verbindungen</h2>
        <p className="flex items-center gap-2 text-sm"><span className={`size-2.5 rounded-full ${lex.ok ? "bg-ok" : "bg-bad"}`} /> Lexware Office: {lex.text}</p>
        <p className="flex items-center gap-2 text-sm"><span className={`size-2.5 rounded-full ${mail.ok ? "bg-ok" : "bg-bad"}`} /> E-Mail-Postfach: {mail.text}</p>
        <p className="flex items-center gap-2 text-sm"><span className={`size-2.5 rounded-full ${ai ? "bg-ok" : "bg-bad"}`} /> KI (Claude): {ai ? "bereit" : "Schlüssel fehlt"}</p>
        <p className="flex items-center gap-2 text-sm"><span className={`size-2.5 rounded-full ${process.env.TWILIO_AUTH_TOKEN ? "bg-ok" : "bg-line"}`} /> Telefon-Jarvis: {process.env.TWILIO_AUTH_TOKEN ? `bereit${process.env.TWILIO_NUMBER ? ` (${process.env.TWILIO_NUMBER})` : ""}` : "nicht eingerichtet (optional)"}</p>
        {me.role === "ADMIN" ? (
          <details className="border-t border-line pt-4" open={Boolean(willkommen) || !lex.ok || !mail.ok || !ai}>
            <summary className="cursor-pointer text-sm font-medium text-brand">Schlüssel und Postfach eintragen</summary>
            <div className="mt-4">
              <ConnectionsForm
                anthropic={settingState("ANTHROPIC_API_KEY")}
                lexware={settingState("LEXWARE_API_KEY")}
                places={settingState("GOOGLE_PLACES_API_KEY")}
                mailProvider={settingState("MAIL_PROVIDER")}
                mailUser={settingState("MAIL_USER")}
                mailPassword={settingState("MAIL_PASSWORD")}
                mailFromName={settingState("MAIL_FROM_NAME")}
                imapHost={settingState("MAIL_IMAP_HOST")}
                imapPort={settingState("MAIL_IMAP_PORT")}
                smtpHost={settingState("MAIL_SMTP_HOST")}
                smtpPort={settingState("MAIL_SMTP_PORT")}
                twilioToken={settingState("TWILIO_AUTH_TOKEN")}
                twilioNumber={settingState("TWILIO_NUMBER")}
                webhookUrl={`${origin}/api/telefon/anruf`}
              />
            </div>
          </details>
        ) : (
          (!lex.ok || !mail.ok || !ai) && <p className="text-xs text-steel">Fehlende Verbindungen trägt ein Administrator hier ein.</p>
        )}
      </section>

      {me.role === "ADMIN" && (
        <section className="card flex flex-wrap items-center gap-3 p-5">
          <Database className="size-5 shrink-0 text-brand" />
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">Datenübernahme aus dem alten Programm</h2>
            <p className="text-sm text-steel">Export (Excel, CSV, JSON) aus dem alten ERP/Rechnungsprogramm hochladen: Kunden und Artikel nach Lexware, Projekte nach Jarvis, alte Rechnungen als Archiv.</p>
          </div>
          <Link href="/datenuebernahme" className="btn-secondary">Öffnen</Link>
        </section>
      )}

      <section id="telefon" className="card scroll-mt-20 space-y-3 p-5">
        <h2 className="flex items-center gap-2 font-semibold"><PhoneCall className="size-4 text-brand" /> Jarvis am Telefon</h2>
        {process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_NUMBER ? (
          <p className="text-sm">Ruf an: <a href={`tel:${process.env.TWILIO_NUMBER.replace(/[^\d+]/g, "")}`} className="font-semibold text-brand">{process.env.TWILIO_NUMBER}</a> – Jarvis erkennt deine Handynummer, fragt nach der PIN und dann sprichst du ganz normal mit ihm. Freigaben (Mails, Lexware) bestätigst du danach in der App.</p>
        ) : (
          <p className="text-sm text-steel">Noch keine Jarvis-Telefonnummer eingerichtet{me.role === "ADMIN" ? " – oben unter Verbindungen „Telefon-Jarvis (Twilio)“ eintragen" : " – das macht ein Administrator"}. Ohne Nummer geht der Gesprächsmodus in der App (Mikrofon im Jarvis-Chat).</p>
        )}
        <StateForm action={savePhoneAccess} submit="Speichern" reset>
          <div className="grid gap-2 sm:grid-cols-2">
            <input name="phone" defaultValue={myPhone.phone ?? ""} required placeholder="Deine Handynummer, z. B. 0171 1234567" inputMode="tel" className="input" aria-label="Handynummer" />
            <input name="pin" type="password" inputMode="numeric" autoComplete="new-password" pattern="\d{6,8}" placeholder={myPhone.phonePinHash ? "PIN gespeichert – leer = unverändert" : "Telefon-PIN (6–8 Ziffern)"} className="input" aria-label="Telefon-PIN" />
          </div>
        </StateForm>
        {myPhone.phone && (
          <form action={async () => { "use server"; const f = new FormData(); f.set("remove", "1"); await savePhoneAccess(undefined, f); }}>
            <button className="text-xs font-medium text-bad hover:underline">Telefonzugang entfernen</button>
          </form>
        )}
      </section>

      <section className="card space-y-3 p-5">
        <h2 className="font-semibold">Benachrichtigungen</h2>
        <p className="text-sm text-steel">Erinnerungen an Aufgaben, überfällige Rechnungen und das Morgen-Briefing (werktags 7:30). Am iPhone erst nach „Zum Home-Bildschirm“. Geräte mit Benachrichtigungen: {devices}</p>
        <PushToggle vapidPublicKey={process.env.VAPID_PUBLIC_KEY ?? null} />
      </section>

      <section id="apps" className="card scroll-mt-20 space-y-3 p-5">
        <h2 className="flex items-center gap-2 font-semibold"><MonitorSmartphone className="size-4" /> Apps</h2>
        <p className="text-sm text-steel"><b>iPhone/iPad:</b> In Safari öffnen → Teilen → „Zum Home-Bildschirm“. Jarvis startet dann wie eine App im Vollbild.</p>
        <p className="text-sm text-steel"><b>Windows:</b> Installer herunterladen und öffnen, Server-Adresse eintragen. <kbd className="chip border-line bg-mist">Strg + Leertaste</kbd> öffnet Jarvis von überall. Falls Windows „Der Computer wurde geschützt“ meldet: „Weitere Informationen“ → „Trotzdem ausführen“.</p>
        <WindowsAppDownload version={winApp?.version ?? null} size={winApp?.size ?? null} />
      </section>

      <section className="card space-y-3 p-5">
        <h2 className="font-semibold">Jarvis merkt sich</h2>
        {memories.length === 0 ? (
          <p className="text-sm text-steel">Noch nichts. Sag z. B. „Merk dir: Rechnungen an Firma X immer mit 14 Tagen Zahlungsziel“.</p>
        ) : (
          <ul className="divide-y divide-line">
            {memories.map((m) => (
              <li key={m.id} className="flex items-start gap-2 py-2 text-sm">
                <span className="flex-1">{m.text}<span className="block text-xs text-steel">{formatDateTime(m.createdAt)}{m.createdBy ? ` · ${m.createdBy}` : ""}</span></span>
                <DeleteButton kind="memory" id={m.id} label="Eintrag" />
              </li>
            ))}
          </ul>
        )}
      </section>

      {me.role === "ADMIN" && (
        <section className="card space-y-4 p-5">
          <h2 className="font-semibold">Team</h2>
          <ul className="divide-y divide-line">
            {users.map((u) => (
              <li key={u.id} className="flex items-center gap-2 py-2 text-sm">
                <span className="flex-1">
                  <b>{u.name}</b> · {noLogin(u) ? <span className="text-steel">ohne App-Zugang (nur Personalakte)</span> : u.email}
                  <span className="block text-xs text-steel">{u.role === "ADMIN" ? "Administrator" : "Mitarbeiter"}{u.lastLoginAt ? ` · zuletzt ${formatDateTime(u.lastLoginAt)}` : " · noch nie angemeldet"}</span>
                  {u.role !== "ADMIN" && (
                    <form action={setUserFunktion.bind(null, u.id)} className="mt-1 flex items-center gap-2">
                      <select name="funktion" defaultValue={u.funktion ?? ""} className="input py-1 text-xs" aria-label={`Funktion von ${u.name}`}>
                        <option value="">alle Bereiche</option>
                        {FUNKTIONEN.map((f) => <option key={f} value={f}>{FUNKTION_LABEL[f]}</option>)}
                      </select>
                      <button className="btn-secondary px-3 py-1 text-xs">Setzen</button>
                    </form>
                  )}
                  <span className="mt-0.5 block text-[11px] text-steel">Sieht: {u.role === "ADMIN" || !u.funktion ? "alles" : areasOf(u).map((a) => AREA_LABEL[a].split(" (")[0]).join(", ")}</span>
                </span>
                {u.id !== me.id && <DeleteButton kind="user" id={u.id} label={u.name} />}
              </li>
            ))}
          </ul>
          <AddUserForm />
        </section>
      )}

      {me.role === "ADMIN" && (
        <section className="card p-5 text-sm">
          <h2 className="font-semibold">Freischaltung</h2>
          <p className="mt-1 text-steel">
            {lic.status === "entwicklung"
              ? "Entwicklungsmodus – keine Freischaltung nötig."
              : lic.ok
                ? `Freigeschaltet durch Klaic Media${lic.bis ? ` bis ${formatDate(lic.bis)}` : " (unbefristet)"}.`
                : lockReason(lic)}
          </p>
        </section>
      )}

      <section className="card space-y-4 p-5">
        <h2 className="font-semibold">Konto</h2>
        <p className="text-sm text-steel">{me.name} · {me.email}</p>
        <PasswordForm />
        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          <form action={logout}><button className="btn-secondary"><LogOut className="size-4" /> Abmelden</button></form>
          <form action={logoutEverywhere}><button className="btn-secondary">Auf allen Geräten abmelden</button></form>
        </div>
      </section>
    </main>
  );
}
