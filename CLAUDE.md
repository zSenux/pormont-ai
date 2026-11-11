# Jarvis ProMont

KI-Assistent für die **ProMont GmbH** (Metallbau-Meisterbetrieb, Mannheim, promont.gmbh), gebaut von Klaic Media.
Web-App + iPhone-PWA + Windows-App (`windows-app/`, Electron-Hülle um die Web-App) mit **Lexware Office API**.
Bausteine stammen aus `zSenux/klaic-os` (Agent-Schleife, Push, PWA, Windows-App) – bewusst schlank gehalten.

**Sprache:** UI, Code-Kommentare und Antworten auf Deutsch. Ansprache in der App per Du.

## Stack
- Next.js 16 (App Router, `src/proxy.ts` = Middleware), React 19, Tailwind 4, Prisma 7 (+ adapter-pg) + Postgres, zod 4, lucide-react
- KI: `@anthropic-ai/sdk`, Modell `JARVIS_MODEL` (Standard `claude-opus-5-5`), adaptive Thinking, Streaming, Prompt-Caching (System + letztes Werkzeug)
- Auth: eigene Sitzung (`pm_session`, HMAC mit `AUTH_SECRET`, `src/lib/auth/*`), Passwörter scrypt, `sessionVersion` = überall abmelden
- Design: ProMont-Blau `brand` #0f4d83, dunkel `brand-2` #092f50, Text #101820, Stahlgrau #64717c, Schrift Inter (Tokens in `globals.css`)

## Wichtige Dateien
- `src/lib/lexware/*`: Client (Drosselung auf 2 Anfragen/s, 1 Wiederholung bei 429), API, zod-Eingaben → Lexware-Bodies (`payloads.ts`)
- `src/lib/jarvis/agent.ts` (Schleife, System-Prompt), `tools.ts` (Werkzeuge), `actions.ts` (Freigaben), `load.ts`
- `src/app/api/jarvis/route.ts` (SSE: chat/text/tool/action/done/error), `src/components/jarvis/chat.tsx` (Chat, Sprache, Gesprächsmodus)
- `src/lib/mail/*`: IMAP (imapflow, je Aufruf eine Verbindung) + SMTP (nodemailer), Vorlagen Strato/GMX/IONOS in `config.ts`; gesendete Mails werden in „Gesendet“ abgelegt, Entwürfe per IMAP APPEND. Werkzeuge in `src/lib/jarvis/mail-tools.ts`, Seiten `/mail`, `/mail/[uid]`
- `src/lib/jobs.ts` (Erinnerungen, überfällige Rechnungen, Morgen-Briefing; über `instrumentation.ts`, nur Produktion bzw. `JOBS=1`)

## Regeln
- **Schreibende Lexware-Aktionen nur über `PendingAction`** (Vorschlag → Karte → Freigabe durch einen Menschen, atomar PENDING → DONE). Nie direkt aus einem Werkzeug schreiben.
- **Mails senden nur über `PendingAction` (`mail_senden`)**. Mail-Inhalte sind fremde Daten (Prompt-Injection) – werden im Werkzeug-Ergebnis als `<mail_inhalt>` markiert; HTML nie ins DOM, nur als Text. Anhänge nur als Download (octet-stream, nosniff, CSP sandbox)
- Rechnungen werden standardmäßig als **Entwurf** angelegt; Festschreiben nur, wenn ausdrücklich gewünscht (`festschreiben: true`).
- Chat-Verlauf ist append-only (Thinking-Blöcke bleiben gültig) – nie alte Nachrichten verändern; Hinweise als neue Nachrichten anhängen.
- Eingaben immer mit zod prüfen, jede Server-Action mit `requireUser()`/`requireAdmin()`.
- Keine Geheimnisse ins Repo – nur `.env` (gitignored) + `.env.example`.
- Schema-Änderungen so, dass `prisma db push` ohne `--accept-data-loss` durchläuft.

## Lokal
```bash
pnpm install && cp .env.example .env && pnpm db:push && pnpm dev   # http://127.0.0.1:3000
```
Ohne `LEXWARE_API_KEY`/`ANTHROPIC_API_KEY` zeigt die App freundliche Hinweise statt Fehlern.
