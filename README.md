# Jarvis – KI-Assistent der ProMont GmbH

Jarvis ist der persönliche Assistent der ProMont GmbH (Metallbau, Mannheim). Er läuft als Web-App,
als App auf dem iPhone (Safari → „Zum Home-Bildschirm“) und als Windows-App und ist mit **Lexware Office** verbunden.

**Was Jarvis kann**
- Fragen per Text oder Sprache: „Welche Rechnungen sind überfällig?“, „Wie viel Umsatz hatten wir im Oktober?“, „Was hat Firma Müller noch offen?“
- Lexware: Kunden suchen, Rechnungen/Angebote/Auftragsbestätigungen/Gutschriften ansehen, PDFs öffnen, Umsatz auswerten, Artikel nachschlagen
- **Kunden, Rechnungen und Angebote anlegen** – immer erst als Vorschlag mit Karte „Freigeben / Ablehnen“, nie ohne Bestätigung
- **E-Mail** (Strato, GMX oder IONOS): Posteingang lesen, Mails zusammenfassen, Antworten entwerfen, Anhänge laden, Push bei neuen Mails. Gesendet wird nur nach „Freigeben“
- **Kalender**: Termine anlegen/ändern (auch per Sprache), Erinnerung per Push, Abo-Link für iPhone/Outlook (`/kalender-abo/<token>/promont.ics`)
- **Belege per Foto**: Kassenzettel/Rechnung fotografieren → Jarvis liest Händler, Datum, Betrag und USt. aus → nach Freigabe als Beleg in Lexware hochladen
- **Projekte / Baustellen**: Status, Adresse, Notizen, Fotos, Stunden je Mitarbeiter und Auswertung
- **Dokumente durchsuchen**: PDFs, Fotos und Scans hochladen, Volltextsuche (Scans liest Jarvis per KI ab)
- Aufgaben und Erinnerungen (Push), Morgen-Briefing werktags 7:30, Hinweis auf neu überfällige Rechnungen
- Gedächtnis („Merk dir: …“) für feste Regeln des Betriebs
- Team: mehrere Benutzer (Administrator/Mitarbeiter), Abmelden auf allen Geräten

## Einrichtung

```bash
pnpm install
cp .env.example .env      # Werte eintragen (siehe Kommentare)
pnpm db:push
pnpm dev                  # http://127.0.0.1:3000
```

**Ersteinrichtung ohne Hosting-Panel:** Beim ersten Start schreibt Jarvis einen Einrichtungs-Code ins Server-Log (`[Jarvis] Ersteinrichtung offen – Einrichtungs-Code: …`). Mit diesem Code legt der Kunde auf der Login-Seite den ersten Administrator an und trägt danach unter **Einstellungen → Verbindungen** Lexware-Schlüssel, Claude-Schlüssel und Postfach selbst ein. Alternativ legt der erste Login mit `ADMIN_EMAIL` / `ADMIN_PASSWORD` den Administrator an. Weitere Benutzer unter **Einstellungen → Team**
oder per `pnpm user:add <email> "<Name>" <passwort> [ADMIN|MEMBER]` (setzt auch vergessene Passwörter zurück).

### Schlüssel
| Variable | Woher |
|---|---|
| `LEXWARE_API_KEY` | Lexware Office → Erweiterungen → Public API (https://app.lexware.de/addons/public-api) |
| `MAIL_PROVIDER` / `MAIL_USER` / `MAIL_PASSWORD` | Anbieter (`strato`, `gmx`, `ionos`), E-Mail-Adresse und Passwort des Postfachs. Bei GMX vorher „POP3/IMAP Abruf“ in den GMX-Einstellungen erlauben |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com → API Keys |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | `npx web-push generate-vapid-keys` (einmal, nie wechseln) |
| `AUTH_SECRET` | `openssl rand -base64 48` |

Schlüssel gehören nur in die Umgebungsvariablen des Servers, nie ins Repository.

## Hosting
Läuft wie Klaic OS über **Klaic Deploy** (Nixpacks, `nixpacks.toml`, Node 24): Postgres per Klick → `DATABASE_URL`,
Start-Befehl `pnpm start` (`prisma db push && next start`), Domain z. B. `jarvis.promont.gmbh`. Hintergrund-Jobs laufen in Produktion automatisch.

## Windows-App
`windows-app/` (Electron). Der Installer wird bei jedem Push auf GitHub gebaut (Actions → „Windows-App“ → Artifacts),
mit Tag `win-v1.0.0` als Release. Beim ersten Start die Server-Adresse eintragen und anmelden.
**Strg + Leertaste** öffnet ein kleines Jarvis-Fenster von überall, das Symbol im Infobereich das Hauptfenster.

### Jarvis bedient den PC
Jarvis kann den Büro-PC wie ein Mensch bedienen – jedes Programm, auch CAD: Bildschirm ansehen, klicken, tippen,
Tastenkürzel, Programme starten, Dateien suchen/lesen/öffnen und in Jarvis ablegen.
- Am PC im Chat: „Such die Zeichnung Geländer Müller und mach daraus ein Angebot“ → Jarvis fragt einmal per Dialog, ob er Maus und Tastatur benutzen darf.
- Vom Handy: Seite **Computer** (`/pc`) → Auftrag schicken, Freigabe per Knopf (Push), Live-Bild an/aus, Stopp.
  Vorher am PC im Jarvis-Symbol „Fernsteuerung vom Handy erlauben“ anhaken (Standard: aus).
- Oben am Bildschirm zeigt eine rote Leiste, dass Jarvis arbeitet. **Strg + Alt + Esc** oder „Stopp“ beendet sofort.
- Grenzen: keine Passwörter/PINs/Bank- oder Kartendaten tippen, nichts endgültig löschen, nichts senden/bezahlen;
  Lexware-Änderungen und Mails weiterhin nur über Freigabe-Karten im Verlauf.

## iPhone / iPad
In Safari öffnen → Teilen → „Zum Home-Bildschirm“. Danach unter Einstellungen „Benachrichtigungen“ einschalten.
