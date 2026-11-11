"use client";

import { useActionState, useState } from "react";
import { Check, KeyRound, Loader2 } from "lucide-react";
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
              <option value="custom">Anderer (eigener Server)</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="MAIL_USER">E-Mail-Adresse</label>
            <input id="MAIL_USER" name="MAIL_USER" type="email" autoComplete="off" defaultValue={p.mailUser.value ?? ""} placeholder="info@promont.gmbh" className="input" />
          </div>
          <div className="sm:col-span-2">
            <SecretField name="MAIL_PASSWORD" label="Passwort des Postfachs" state={p.mailPassword} placeholder="Passwort" help={provider === "gmx" ? "Bei GMX vorher in den GMX-Einstellungen „POP3/IMAP Abruf“ erlauben." : "Das gleiche Passwort wie im Mail-Programm."} />
          </div>
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
        {p.mailUser.set && !mailLocked && (
          <ClearButton value="MAIL">Postfach trennen</ClearButton>
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
