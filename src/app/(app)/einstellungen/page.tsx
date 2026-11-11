import { Download, LogOut, MonitorSmartphone } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/user";
import { formatDateTime } from "@/lib/berlin";
import { lexwareConfigured } from "@/lib/lexware/client";
import { profile } from "@/lib/lexware/api";
import { logout, logoutEverywhere } from "@/app/actions";
import { PushToggle } from "@/components/pwa";
import { AddUserForm, DeleteButton, PasswordForm } from "./forms";

export const metadata = { title: "Einstellungen" };
export const dynamic = "force-dynamic";

async function lexwareState() {
  if (!lexwareConfigured()) return { ok: false, text: "Nicht verbunden – LEXWARE_API_KEY fehlt." };
  try {
    const p = await profile();
    return { ok: true, text: `Verbunden mit ${p.companyName}` };
  } catch (e) {
    return { ok: false, text: e instanceof Error ? e.message : "Nicht erreichbar." };
  }
}

export default async function EinstellungenPage() {
  const me = await requireUser();
  const [lex, users, memories, devices] = await Promise.all([
    lexwareState(),
    me.role === "ADMIN" ? db.user.findMany({ orderBy: { createdAt: "asc" } }) : Promise.resolve([]),
    db.memory.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    db.pushSubscription.count({ where: { userId: me.id } }),
  ]);
  const ai = Boolean(process.env.ANTHROPIC_API_KEY);

  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-6 md:py-10">
      <h1 className="page-title">Einstellungen</h1>

      <section className="card space-y-3 p-5">
        <h2 className="font-semibold">Verbindungen</h2>
        <p className="flex items-center gap-2 text-sm"><span className={`size-2.5 rounded-full ${lex.ok ? "bg-ok" : "bg-bad"}`} /> Lexware Office: {lex.text}</p>
        <p className="flex items-center gap-2 text-sm"><span className={`size-2.5 rounded-full ${ai ? "bg-ok" : "bg-bad"}`} /> KI (Claude): {ai ? "bereit" : "ANTHROPIC_API_KEY fehlt"}</p>
      </section>

      <section className="card space-y-3 p-5">
        <h2 className="font-semibold">Benachrichtigungen</h2>
        <p className="text-sm text-steel">Erinnerungen an Aufgaben, überfällige Rechnungen und das Morgen-Briefing (werktags 7:30). Am iPhone erst nach „Zum Home-Bildschirm“. Geräte mit Benachrichtigungen: {devices}</p>
        <PushToggle vapidPublicKey={process.env.VAPID_PUBLIC_KEY ?? null} />
      </section>

      <section className="card space-y-3 p-5">
        <h2 className="flex items-center gap-2 font-semibold"><MonitorSmartphone className="size-4" /> Apps</h2>
        <p className="text-sm text-steel"><b>iPhone/iPad:</b> In Safari öffnen → Teilen → „Zum Home-Bildschirm“. Jarvis startet dann wie eine App im Vollbild.</p>
        <p className="text-sm text-steel"><b>Windows:</b> Installer „Jarvis ProMont Setup.exe“ installieren, Server-Adresse eintragen. <kbd className="chip border-line bg-mist">Strg + Leertaste</kbd> öffnet Jarvis von überall.</p>
        {process.env.WINDOWS_APP_URL && (
          <a href={process.env.WINDOWS_APP_URL} className="btn-secondary w-fit"><Download className="size-4" /> Windows-App herunterladen</a>
        )}
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
                  <b>{u.name}</b> · {u.email}
                  <span className="block text-xs text-steel">{u.role === "ADMIN" ? "Administrator" : "Mitarbeiter"}{u.lastLoginAt ? ` · zuletzt ${formatDateTime(u.lastLoginAt)}` : " · noch nie angemeldet"}</span>
                </span>
                {u.id !== me.id && <DeleteButton kind="user" id={u.id} label={u.name} />}
              </li>
            ))}
          </ul>
          <AddUserForm />
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
