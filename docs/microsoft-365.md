# Microsoft 365 / Outlook mit Jarvis verbinden

Jarvis liest und sendet Mails dann direkt über das Microsoft-365-Postfach (Microsoft Graph).
Outlook auf dem Büro-PC läuft ganz normal weiter – beide sehen dieselben Mails, gesendete Mails von Jarvis liegen in „Gesendete Elemente“, Entwürfe in „Entwürfe“.
Ein Passwort wird in Jarvis nicht gespeichert: man meldet sich einmal bei Microsoft an, Jarvis bekommt dafür ein Token (verschlüsselt gespeichert).

Dauer: ca. 10 Minuten. Nötig: ein Konto mit Administratorrechten im Microsoft 365 der ProMont GmbH.

## 1. App bei Microsoft registrieren

1. <https://entra.microsoft.com> öffnen und mit dem Microsoft-365-Administrator anmelden.
2. Links **Identität → Anwendungen → App-Registrierungen** → **Neue Registrierung**.
3. Ausfüllen:
   - **Name:** `Jarvis ProMont`
   - **Unterstützte Kontotypen:** „Nur Konten in diesem Organisationsverzeichnis (einzelner Mandant)“
   - **Umleitungs-URI:** Plattform **Web**, Adresse genau so, wie sie Jarvis unter Einstellungen → Verbindungen → Microsoft 365 anzeigt, z. B.
     `https://pormont-ai.dev.klaic.media/api/mail/microsoft/callback`
4. **Registrieren** klicken.
5. In der **Übersicht** zwei Werte notieren: **Anwendungs-ID (Client)** und **Verzeichnis-ID (Mandant)**.

## 2. Geheimen Clientschlüssel erzeugen

1. **Zertifikate & Geheimnisse → Geheime Clientschlüssel → Neuer geheimer Clientschlüssel**.
2. Beschreibung `Jarvis`, Ablauf **24 Monate** → **Hinzufügen**.
3. Sofort die Spalte **Wert** kopieren (nicht die „Geheimnis-ID“) – der Wert wird nur einmal angezeigt.

## 3. Berechtigungen

1. **API-Berechtigungen → Berechtigung hinzufügen → Microsoft Graph → Delegierte Berechtigungen**.
2. Anhaken: `offline_access`, `User.Read`, `Mail.ReadWrite`, `Mail.Send`, `Mail.ReadWrite.Shared`, `Mail.Send.Shared`.
3. **Administratorzustimmung für ProMont GmbH erteilen** klicken (dann kommt beim Anmelden keine Rückfrage).

## 4. In Jarvis eintragen

1. Jarvis → **Einstellungen → Verbindungen → Schlüssel und Postfach eintragen**.
2. Unter **E-Mail-Postfach** den Anbieter **Microsoft 365 / Outlook** wählen.
3. **Anwendungs-ID**, **Verzeichnis-ID** und den **geheimen Clientschlüssel (Wert)** eintragen → **Speichern**.
4. **Mit Microsoft anmelden** klicken, das Konto wählen, dessen Postfach Jarvis nutzen soll (z. B. `info@promont.gmbh`), und zustimmen.
5. Oben steht dann „E-Mail-Postfach: info@promont.gmbh (Microsoft 365) · n ungelesen“. Fertig.

**Geteiltes Postfach:** Ist `info@promont.gmbh` ein freigegebenes Postfach ohne eigenes Passwort, meldet man sich mit seinem eigenen Konto an und trägt `info@promont.gmbh` unter „Geteiltes Postfach“ ein. Das eigene Konto braucht im Microsoft 365 Admin Center bei diesem Postfach „Vollzugriff“ und „Senden als“.

## Gut zu wissen

- **Schlüssel läuft ab:** Nach 24 Monaten einen neuen geheimen Clientschlüssel erzeugen und in Jarvis eintragen (Termin in den Kalender setzen).
- **Neue Adresse (z. B. jarvis.promont.gmbh):** In der App-Registrierung unter **Authentifizierung** die neue Umleitungs-URI zusätzlich eintragen und in Jarvis neu anmelden.
- **Zugriff entziehen:** In Jarvis „Von Microsoft abmelden“ oder im Entra Admin Center die App löschen.
- Alternativ geht alles auch über Umgebungsvariablen im Hosting: `MAIL_PROVIDER=microsoft`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT`, optional `MS_MAILBOX`. Angemeldet wird trotzdem in Jarvis.
- IMAP/SMTP mit Passwort funktioniert bei Microsoft 365 nicht mehr (von Microsoft abgeschaltet) – darum die Anmeldung über Microsoft.

## Fehlermeldungen

| Meldung | Lösung |
|---|---|
| „Die Weiterleitungs-URI passt nicht“ / AADSTS50011 | Umleitungs-URI in der App exakt wie in Jarvis angezeigt eintragen (https, ohne / am Ende). |
| AADSTS50194 / „not configured as a multi-tenant application“ | Verzeichnis-ID in Jarvis eintragen. |
| „Microsoft lehnt den Clientschlüssel ab“ | Den **Wert** des Schlüssels eintragen, nicht die Geheimnis-ID – oder neuen Schlüssel erzeugen. |
| „Ein Administrator muss der App zustimmen“ | Schritt 3.3 „Administratorzustimmung erteilen“. |
| „Kein Exchange-Online-Postfach“ | Das Konto braucht eine Microsoft-365-Lizenz mit Exchange (z. B. Business Basic/Standard). |
