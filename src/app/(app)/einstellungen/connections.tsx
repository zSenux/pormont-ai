"use client";

import { useActionState, useState } from "react";
import { Check, KeyRound, Loader2, LogIn } from "lucide-react";
import { saveConnections } from "@/app/actions";

type State = { set: boolean; source: "env" | "app" | null; value: string | null };
export type ConnectionProps = {
  anthropic: State;
  lexware: State;
  places: State;
  mailProvider: State;
  mailUser: State;
  mailPassword: State;
  mailFromName: State;
  imapHost: State;
  imapPort: State;
  smtpHost: State;
  smtpPort: State;
  twilioToken: State;
  twilioNumber: State;
  webhookUrl: string;
  msClientId: State;
  msSecret: State;
  msTenant: State;
  msMailbox: State;
  /** Angemeldetes Microsoft-Konto (null = noch nicht angemeldet) */
  msAccount: string | null;
  msRedirectUri: string;
};

function Msg({ s }: { s?: { ok?: string; error?: string } }) {
  if (s?.error) return <p className="text-sm text-bad" role="alert">{s.error}</p>;
  if (s?.ok) return <p className="flex items-center gap-1 text-sm text-ok"><Check className="size-4" /> {s.ok}</p>;
  return null;
}

/** Entfernen-Knopf: kein Submit-Knopf (sonst würde Enter in einem Feld ihn auslösen) – setzt „clear“ und sendet das Formular */
function ClearButton({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="mt-1 block text-xs font-medium text-bad hover:underline"
      onClick={(e) => {
        const form = e.currentTarget.form;
        if (!form || !confirm("Wirklich entfernen?")) return;
        (form.elements.namedItem("clear") as HTMLInputElement).value = value;
        form.requestSubmit();
        (form.elements.namedItem("clear") as HTMLInputElement).value = "";
      }}
    >
      {children}
    </button>
  );
}

/** Geheimes Feld: zeigt nie den Wert, nur „gespeichert“. Leer lassen = unverändert. */
function SecretField({ name, label, state, help, placeholder }: { name: string; label: string; state: State; help: React.ReactNode; placeholder: string }) {
  const locked = state.source === "env";
  return (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <input
        id={name}
        name={name}
        type="password"
        autoComplete="off"
        spellCheck={false}
        disabled={locked}
        placeholder={locked ? "im Hosting-Panel hinterlegt" : state.set ? "•••••••• gespeichert – leer lassen = unverändert" : placeholder}
        className="input font-mono"
      />
      <p className="mt-1 text-xs text-steel">{help}</p>
      {state.set && !locked && (
        <ClearButton value={name}>Schlüssel entfernen</ClearButton>
      )}
    </div>
  );
}

export function ConnectionsForm(p: ConnectionProps) {
  const [state, action, pending] = useActionState(saveConnections, undefined);
  const [provider, setProvider] = useState(p.mailProvider.value ?? (p.imapHost.value ? "custom" : "strato"));
  const mailLocked = p.mailUser.source === "env";
  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="clear" defaultValue="" />
      <fieldset className="space-y-4">
        <legend className="mb-2 flex items-center gap-2 text-sm font-semibold"><KeyRound className="size-4 text-brand" /> Lexware Office</legend>
        <SecretField
          name="LEXWARE_API_KEY"
          label="API-Schlüssel"
          state={p.lexware}
          placeholder="Schlüssel aus Lexware einfügen"
          help={<>In Lexware Office: <a href="https://app.lexware.de/addons/public-api" target="_blank" rel="noreferrer" className="font-medium text-brand">Erweiterungen → Public API</a> → Schlüssel erzeugen und hier einfügen.</>}
        />
      </fieldset>

      <fieldset className="space-y-4 border-t border-line pt-5">
        <legend className="mb-2 flex items-center gap-2 text-sm font-semibold"><KeyRound className="size-4 text-brand" /> KI (Claude)</legend>
        <SecretField
          name="ANTHROPIC_API_KEY"
          label="Claude-API-Schlüssel"
          state={p.anthropic}
          placeholder="sk-ant-…"
          help={<>Unter <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="font-medium text-brand">console.anthropic.com → API Keys</a> erzeugen. Abgerechnet wird nach Nutzung.</>}
        />
      </fieldset>

      <fieldset className="space-y-4 border-t border-line pt-5">
        <legend className="mb-2 flex items-center gap-2 text-sm font-semibold"><KeyRound className="size-4 text-brand" /> Google (Neukunden-Akquise)</legend>
        <SecretField
          name="GOOGLE_PLACES_API_KEY"
          label="Google-Places-API-Schlüssel"
          state={p.places}
          placeholder="AIza…"
          help={<>In der <a href="https://console.cloud.google.com/apis/library/places.googleapis.com" target="_blank" rel="noreferrer" className="font-medium text-brand">Google Cloud Console</a> „Places API (New)“ aktivieren und einen Schlüssel erzeugen. Eine Suche kostet ca. 3–4 Cent.</>}
        />
      </fieldset>

      <fieldset className="space-y-4 border-t border-line pt-5">
        <legend className="mb-2 flex items-center gap-2 text-sm font-semibold"><KeyRound className="size-4 text-brand" /> Telefon-Jarvis (Twilio)</legend>
        <div>
          <label className="label" htmlFor="TWILIO_NUMBER">Jarvis-Telefonnummer</label>
          <input id="TWILIO_NUMBER" name="TWILIO_NUMBER" disabled={p.twilioNumber.source === "env"} defaultValue={p.twilioNumber.value ?? ""} placeholder="+49 621 …" className="input" />
          <p className="mt-1 text-xs text-steel">Die bei Twilio gekaufte Nummer – wird dem Team angezeigt.</p>
        </div>
        <SecretField
          name="TWILIO_AUTH_TOKEN"
          label="Twilio Auth Token"
          state={p.twilioToken}
          placeholder="Auth Token aus der Twilio Console"
          help={<>In der <a href="https://console.twilio.com" target="_blank" rel="noreferrer" className="font-medium text-brand">Twilio Console</a> unter „Account Info“. Bei der Nummer als Webhook „A call comes in“ eintragen: <code className="break-all">{p.webhookUrl}</code> (POST).</>}
        />
      </fieldset>

      <fieldset className="space-y-4 border-t border-line pt-5" disabled={mailLocked}>
        <legend className="mb-2 flex items-center gap-2 text-sm font-semibold"><KeyRound className="size-4 text-brand" /> E-Mail-Postfach</legend>
        {mailLocked && <p className="text-xs text-steel">Das Postfach ist im Hosting-Panel hinterlegt und kann hier nicht geändert werden.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="MAIL_PROVIDER">Anbieter</label>
            <select id="MAIL_PROVIDER" name="MAIL_PROVIDER" className="input" value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="strato">Strato</option>
              <option value="gmx">GMX</option>
              <option value="ionos">IONOS</option>
              <option value="office365">Microsoft 365 – nur Passwort</option>
              <option value="microsoft">Microsoft 365 – Mit Microsoft anmelden</option>
              <option value="custom">Anderer (eigener Server)</option>
            </select>
          </div>
          {provider !== "microsoft" && (
            <div>
              <label className="label" htmlFor="MAIL_USER">E-Mail-Adresse</label>
              <input id="MAIL_USER" name="MAIL_USER" type="email" autoComplete="off" defaultValue={p.mailUser.value ?? ""} placeholder="info@promont.gmbh" className="input" />
            </div>
          )}
          {provider !== "microsoft" && (
            <div className="sm:col-span-2">
              <SecretField name="MAIL_PASSWORD" label="Passwort des Postfachs" state={p.mailPassword} placeholder="Passwort" help={provider === "gmx" ? "Bei GMX vorher in den GMX-Einstellungen „POP3/IMAP Abruf“ erlauben." : provider === "office365" ? "Das Passwort, mit dem man sich bei Outlook/Microsoft 365 anmeldet. Jarvis prüft nach dem Speichern Lesen und Senden." : "Das gleiche Passwort wie im Mail-Programm."} />
            </div>
          )}
          <div className="sm:col-span-2">
            <label className="label" htmlFor="MAIL_FROM_NAME">Absendername</label>
            <input id="MAIL_FROM_NAME" name="MAIL_FROM_NAME" defaultValue={p.mailFromName.value ?? "ProMont GmbH"} className="input" />
          </div>
          {provider === "custom" && (
            <>
              <input name="MAIL_IMAP_HOST" defaultValue={p.imapHost.value ?? ""} placeholder="IMAP-Server, z. B. imap.example.de" className="input" aria-label="IMAP-Server" />
              <input name="MAIL_IMAP_PORT" defaultValue={p.imapPort.value ?? ""} placeholder="IMAP-Port (993)" inputMode="numeric" className="input" aria-label="IMAP-Port" />
              <input name="MAIL_SMTP_HOST" defaultValue={p.smtpHost.value ?? ""} placeholder="SMTP-Server, z. B. smtp.example.de" className="input" aria-label="SMTP-Server" />
              <input name="MAIL_SMTP_PORT" defaultValue={p.smtpPort.value ?? ""} placeholder="SMTP-Port (465)" inputMode="numeric" className="input" aria-label="SMTP-Port" />
            </>
          )}
        </div>
        {provider === "office365" && (
          <p className="rounded-lg border border-line bg-mist/50 p-3 text-xs text-steel">
            Jarvis verbindet sich wie ein Mail-Programm mit <code>outlook.office365.com</code> (lesen) und <code>smtp.office365.com</code> (senden). Microsoft sperrt diese Anmeldung mit Passwort bei vielen Firmen-Konten.
            Steht oben nach dem Speichern „abgelehnt“ oder „gesperrt“, bitte „Mit Microsoft anmelden“ wählen.
          </p>
        )}
        {provider === "microsoft" && <MicrosoftFields p={p} saved={p.mailProvider.value === "microsoft"} />}
        {p.mailUser.set && !mailLocked && (
          <ClearButton value="MAIL">{provider === "microsoft" && p.msAccount ? "Von Microsoft abmelden" : "Postfach trennen"}</ClearButton>
        )}
      </fieldset>

      <div className="space-y-2 border-t border-line pt-5">
        <Msg s={state} />
        <button className="btn-primary" disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />} Speichern</button>
        <p className="text-xs text-steel">Schlüssel und Passwörter werden verschlüsselt gespeichert und nie wieder angezeigt.</p>
      </div>
    </form>
  );
}

/** Microsoft 365: App-Registrierung (einmalig) + Anmeldung im Browser – kein Passwort in Jarvis */
function MicrosoftFields({ p, saved }: { p: ConnectionProps; saved: boolean }) {
  const ready = saved && p.msClientId.set && p.msSecret.set;
  return (
    <div className="space-y-4 rounded-lg border border-line bg-mist/50 p-4">
      <p className="text-xs text-steel">
        Einmalig im <a href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noreferrer" className="font-medium text-brand">Microsoft Entra Admin Center → App-Registrierungen</a> eine App „Jarvis ProMont“ anlegen und als Umleitungs-URI (Plattform „Web“) genau diese Adresse eintragen:
      </p>
      <code className="block select-all break-all rounded bg-white px-3 py-2 text-xs">{p.msRedirectUri}</code>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="MS_CLIENT_ID">Anwendungs-ID (Client-ID)</label>
          <input id="MS_CLIENT_ID" name="MS_CLIENT_ID" disabled={p.msClientId.source === "env"} defaultValue={p.msClientId.value ?? ""} placeholder="1234abcd-…" autoComplete="off" spellCheck={false} className="input font-mono" />
        </div>
        <div>
          <label className="label" htmlFor="MS_TENANT">Verzeichnis-ID (Mandant)</label>
          <input id="MS_TENANT" name="MS_TENANT" disabled={p.msTenant.source === "env"} defaultValue={p.msTenant.value ?? ""} placeholder="1234abcd-…" autoComplete="off" spellCheck={false} className="input font-mono" />
          <p className="mt-1 text-xs text-steel">Steht in der Übersicht der App. Nötig, wenn die App „nur dieses Verzeichnis“ erlaubt.</p>
        </div>
        <div className="sm:col-span-2">
          <SecretField name="MS_CLIENT_SECRET" label="Geheimer Clientschlüssel (Wert)" state={p.msSecret} placeholder="Wert des Clientschlüssels" help="Unter „Zertifikate & Geheimnisse“ → Neuer geheimer Clientschlüssel – die Spalte „Wert“ kopieren (nicht die „Geheimnis-ID“). Läuft je nach Wahl nach 6–24 Monaten ab." />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="MS_MAILBOX">Geteiltes Postfach (optional)</label>
          <input id="MS_MAILBOX" name="MS_MAILBOX" type="email" disabled={p.msMailbox.source === "env"} defaultValue={p.msMailbox.value ?? ""} placeholder="z. B. info@promont.gmbh" autoComplete="off" className="input" />
          <p className="mt-1 text-xs text-steel">Nur ausfüllen, wenn Jarvis ein gemeinsames Postfach nutzen soll, in das sich niemand direkt anmeldet. Das angemeldete Konto braucht dafür „Vollzugriff“ und „Senden als“.</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
        {p.msAccount ? (
          <p className="flex items-center gap-1 text-sm text-ok"><Check className="size-4" /> Angemeldet als {p.msAccount}</p>
        ) : (
          <p className="text-sm text-steel">{ready ? "Noch nicht angemeldet." : "Erst Anwendungs-ID und Clientschlüssel speichern, dann anmelden."}</p>
        )}
        {ready ? (
          <a href="/api/mail/microsoft/start" className="btn-secondary"><LogIn className="size-4" /> {p.msAccount ? "Anderes Konto / neu anmelden" : "Mit Microsoft anmelden"}</a>
        ) : (
          <span className="btn-secondary pointer-events-none opacity-50" aria-disabled="true"><LogIn className="size-4" /> Mit Microsoft anmelden</span>
        )}
      </div>
    </div>
  );
}
