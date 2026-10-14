# Messenger

E-Mail-basierter Messenger mit React. Für lokale Entwicklung gibt es weiterhin den Node.js-/Express-/SQLite-/Socket.IO-Server; der gemeinsame Cloudflare-Betrieb verwendet Workers, D1, Durable Objects und R2.

## Projektstruktur

```text
.
├── .env.example
├── .gitignore
├── package.json
├── package-lock.json
├── railway.json
├── cloudflare
│   ├── .dev.vars.example
│   ├── build.mjs
│   ├── migrations
│   │   └── 0001_schema.sql
│   ├── src
│   │   ├── auth.mjs
│   │   ├── chat.mjs
│   │   ├── core.mjs
│   │   ├── realtime.mjs
│   │   ├── router.mjs
│   │   ├── worker.mjs
│   │   └── core.test.mjs
│   └── wrangler.toml
├── client
│   ├── index.html
│   ├── package.json
│   ├── package-lock.json
│   ├── src
│   │   ├── api.js
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   ├── worker-realtime.js
│   │   └── styles.css
│   └── vite.config.js (dist/ wird beim Build generiert)
├── desktop
│   ├── build-installer.cjs
│   ├── main.cjs
│   ├── package.json
│   └── package-lock.json
└── server
    ├── db
    │   └── schema.sql
    └── src
        ├── app.js
        ├── auth.js
        ├── auth.test.js
        ├── chat.js
        ├── config.js
        ├── db.js
        ├── index.js
        ├── mailer.js
        └── realtime.js
```

## Voraussetzungen und Start

Benötigt Node.js 20 oder neuer.

1. Abhängigkeiten installieren:

   ```powershell
   npm install
   ```

2. `.env.example` nach `.env` kopieren und die EmailJS-Werte aus dem Abschnitt „E-Mail-Versand mit EmailJS“ eintragen. Der Server startet ohne vollständige EmailJS-Konfiguration nicht. `.env` ist von Git ausgeschlossen und darf nicht veröffentlicht werden.

3. Backend in einem Terminal starten:

   ```powershell
   npm run dev
   ```

   Beim ersten Start wird `data/messenger.sqlite` angelegt und `server/db/schema.sql` automatisch ausgeführt. Der Server ist standardmäßig unter `http://localhost:3000` erreichbar.

4. Frontend in einem zweiten Terminal starten:

   ```powershell
   Push-Location client
   npm install
   npm run dev
   ```

   Die App ist danach unter `http://localhost:5173` erreichbar. Vite leitet `/api` und den Socket.IO-Endpunkt an das Backend auf Port 3000 weiter. Für die konfigurierte CORS-Herkunft `localhost` (nicht `127.0.0.1`) verwenden.

5. Tests und Frontend-Build prüfen:

   ```powershell
   npm test
   npm run build
   ```

## Gemeinsamer Cloudflare-Betrieb

Diese Anleitung beschreibt eine separate Cloudflare-Variante, deren Worker-Konfiguration in dieser Arbeitskopie nicht enthalten ist. Der hier enthaltene Express-Server verwendet EmailJS; die folgenden Cloudflare-Schritte konfigurieren diesen E-Mail-Versand nicht.

Die Cloudflare-Variante ist eine separate, gemeinsam genutzte Bereitstellung: Worker für API und Frontend, D1 für Konten/Chats, Durable Objects für WebSockets/Rate-Limits und R2 für private Anhänge. Eine Cloudflare-Adresse kann danach von allen Nutzern und vom Desktop-Client verwendet werden.

1. Installiere Node.js 20+ und Abhängigkeiten:

   ```powershell
   npm install
   npm install --prefix client
   ```

2. Melde Wrangler beim eigenen Cloudflare-Konto an:

   ```powershell
   npx wrangler login
   ```

3. Erstelle die D1-Datenbank und den R2-Bucket:

   ```powershell
   npm run cf:d1:create
   npm run cf:r2:create
   ```

   Der D1-Befehl trägt die zurückgegebene Datenbank-ID automatisch in `cloudflare/wrangler.toml` ein. Prüfe die Datei, bevor du fortfährst.

4. Lege D1-Tabellen und Indizes an:

   ```powershell
   npm run cf:d1:migrate:remote
   ```

5. Lege die Produktions-Secrets in Wrangler an. Erzeuge für die JWT-Werte jeweils einen eigenen Zufallswert; verwende nie die Beispielwerte:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
   npx wrangler secret put JWT_ACCESS_SECRET --config cloudflare/wrangler.toml
   npx wrangler secret put JWT_REFRESH_SECRET --config cloudflare/wrangler.toml
   npx wrangler secret put REALTIME_INTERNAL_SECRET --config cloudflare/wrangler.toml
   ```

   Gib Secret-Werte nur direkt in den Wrangler-Eingabeprompt ein. EmailJS-Secrets sind für diese nicht enthaltene Cloudflare-Variante nicht eingerichtet. Für den in dieser Arbeitskopie enthaltenen Server verwende die EmailJS-Einstellungen im Abschnitt „E-Mail-Versand mit EmailJS“. Falls Frontend und API später auf unterschiedlichen Domains liegen, setze `CLIENT_ORIGIN` in `cloudflare/wrangler.toml` auf die genaue HTTPS-Origin des Frontends.

6. Baue und veröffentliche Worker und React-Frontend:

   ```powershell
   npm run cf:deploy
   ```

   Wrangler gibt die öffentliche `workers.dev`-Adresse aus. Danach sollte `https://DEINE-ADRESSE/api/health` `{"status":"ok"}` liefern. Registrierung, Verifizierung, Login und Anhänge müssen anschließend mit echten E-Mail-Adressen über diese HTTPS-Adresse getestet werden.

`npm run cf:dev` startet die lokale Cloudflare-Variante auf `http://localhost:8787`. Dafür zuerst `cloudflare/.dev.vars.example` nach `cloudflare/.dev.vars` kopieren, eigene lokale Test-Secrets setzen und `npm run cf:d1:migrate:local` ausführen. `.dev.vars` wird nicht versioniert.

**Wichtig zu bestehenden Daten:** Die Cloudflare-Datenbank startet leer; lokale SQLite-Konten, Chats und Dateien werden nicht automatisch hochgeladen. Das Cloudflare-Backend verwendet PBKDF2-Passworthashes (mit Web Crypto), während der lokale Express-Server bcrypt nutzt. Daher können lokale Passwörter nicht einfach durch Kopieren der SQLite-Datei übernommen werden. Vor einer späteren Datenmigration muss ausdrücklich festgelegt werden, welche Daten übernommen werden dürfen und wie Nutzer ihre Passwörter zurücksetzen.

**Kosten und Limits:** Cloudflare bietet kostenlose Kontingente, aber keine unbegrenzte Gratisgarantie. Workers, D1, Durable Objects und R2 haben harte Tages-/Monats- und Speicherlimits; bei Erreichen können Anfragen oder Schreibvorgänge fehlschlagen. Prüfe aktuelle Kontingente im Cloudflare-Dashboard und richte Nutzungswarnungen ein. Der aktuelle Echtzeit-Hub ist ein einzelnes Durable Object und eignet sich zunächst für kleine bis mittlere Nutzung, nicht für unbegrenzte Skalierung.

## Windows-Desktop-EXE

Die fertige Windows-App ist ein Installer wie bei Discord oder Telegram: Setup legt Startmenü- und Desktop-Verknüpfungen an, startet den Messenger als eigenes Fenster und speichert Konten, Chats, Dateien und Sitzungen in einer lokalen SQLite-Datenbank unter `%APPDATA%\messenger-app\`. Die Desktop-Variante arbeitet lokal und offline; sie versendet keine E-Mails und verwendet nicht die E-Mail-Sicherheitsprüfungen des gemeinsam genutzten Express-Servers.

Unter Windows mit Node.js 20+ im Projektverzeichnis:

```powershell
npm install
npm install --prefix client
npm run desktop:dist
```

Danach liegen die Dateien in `release/`:

- `Mingle-Setup-1.0.0.exe` — Ein-Klick-Installer mit Desktop- und Startmenü-Verknüpfung
- `Mingle-Portable-1.0.0.exe` — portable EXE ohne Installation

Die Setup-Datei kannst du weitergeben und wie Discord/Telegram installieren. Die Datenbank bleibt bei einem Update erhalten; nur eine Deinstallation mit manueller AppData-Löschung entfernt Chats.

Zum Entwickeln mit Vite: in einem Terminal `npm run dev`, in einem zweiten `Push-Location client; npm run dev` und in einem dritten `npm run desktop:dev`.

### E-Mail-Versand mit EmailJS

Der Server versendet alle E-Mails ausschließlich über die EmailJS REST API. Lege in EmailJS einen E-Mail-Service und drei Vorlagen an und hinterlege anschließend diese Werte sowohl lokal in `.env` als auch als Environment Variables in Render:

```dotenv
EMAILJS_USER_ID=
EMAILJS_PRIVATE_KEY=
EMAILJS_SERVICE_ID=
EMAILJS_TEMPLATE_PASSWORD_RESET=
EMAILJS_TEMPLATE_EMAIL_VERIFY=
EMAILJS_TEMPLATE_SECURITY_CODE=
```

Die User ID, der Private Key, die Service ID und Template IDs findest du im EmailJS-Dashboard. Der Private Key bleibt ausschließlich auf dem Server. Niemals EmailJS-Schlüssel in React, `VITE_*`-Variablen, GitHub oder Chat eintragen. Die Server-API wartet mindestens eine Sekunde zwischen EmailJS-Anfragen.

#### Vorlagen in EmailJS

Erstelle drei Vorlagen. Verwende die Variablen exakt wie unten; die Vorlagen dürfen keine feste Empfängeradresse enthalten, denn Empfänger wird serverseitig gesetzt.

**1. Passwort zurücksetzen** (`EMAILJS_TEMPLATE_PASSWORD_RESET`)

- Betreff: `{{subject}}`
- HTML-Inhalt (im EmailJS-Editor in den HTML-Modus wechseln):

```html
<div style="font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.6;color:#333;padding:24px 14px;background-color:#f5f5f5;">
  <div style="max-width:600px;margin:0 auto;background-color:#fff;border-radius:12px;overflow:hidden;">
    <div style="text-align:center;background-color:#252525;padding:18px;">
      <a href="{{reset_url}}" target="_blank" style="font-size:22px;font-weight:700;letter-spacing:1px;color:#fff;text-decoration:none;">MINGLE</a>
    </div>
    <div style="padding:28px 24px;">
      <h1 style="font-size:22px;line-height:1.3;margin:0 0 20px;color:#222;">Passwort zurücksetzen</h1>
      <p>Hallo {{to_name}},</p>
      <p>wir haben eine Anfrage erhalten, das Passwort für dein Mingle-Konto zurückzusetzen. Klicke auf die Schaltfläche, um ein neues Passwort festzulegen:</p>
      <p style="text-align:center;margin:28px 0;">
        <a href="{{reset_url}}" target="_blank" style="display:inline-block;padding:12px 22px;background-color:#6750e8;border-radius:8px;color:#fff;font-weight:600;text-decoration:none;">Neues Passwort festlegen</a>
      </p>
      <p>Der Link ist {{expires_in}} gültig. Wenn du diese Anfrage nicht gestellt hast, ignoriere diese E-Mail. Dein Konto bleibt sicher.</p>
      <p style="margin-top:28px;">Viele Grüße,<br />Dein Mingle-Team</p>
    </div>
  </div>
  <div style="max-width:600px;margin:12px auto 0;padding:0 8px;">
    <p style="font-size:12px;color:#888;">Diese E-Mail wurde an {{to_email}} gesendet, weil für dieses Konto ein Passwort-Reset angefordert wurde.</p>
  </div>
</div>
```

**2. E-Mail-Adresse bestätigen** (`EMAILJS_TEMPLATE_EMAIL_VERIFY`)

- Betreff: `{{subject}}`
- Inhalt:

```text
Hallo {{to_name}},

Dein Bestätigungscode für mingle lautet:
{{verification_code}}

Der Code ist {{expires_in}} gültig. Gib ihn auf der Bestätigungsseite ein.
Wenn du das Konto nicht erstellt hast, ignoriere diese E-Mail.
```

**3. Sicherheitscode und Sicherheitsmeldungen** (`EMAILJS_TEMPLATE_SECURITY_CODE`)

- Betreff: `{{subject}}`
- Inhalt:

```text
Hallo {{to_name}},

{{message}}

Dein Code lautet: {{verification_code}}
{{expires_in}}

Wenn du diese Aktion nicht angefordert hast, ändere dein Passwort und kontaktiere
den Support.
```

Der Sicherheitscode wird für **jeden Login** verlangt – zusätzlich zum Authenticator-Code, falls App-2FA aktiv ist. Passwortänderungen und 2FA-Änderungen werden erst nach Eingabe des E-Mail-Codes abgeschlossen. Ein E-Mail-Wechsel verlangt erst einen Code an die bisherige, danach einen Code an die neue Adresse. Registrierung und erneutes Senden verwenden einen Bestätigungscode; Passwort-Reset verwendet einen zeitlich begrenzten Link.

Teste die Konfiguration mit einer echten Registrierung oder Anmeldung. Ein unvollständiges EmailJS-Setup führt absichtlich zu einem Fehler statt dazu, Konten ohne E-Mail-Bestätigung freizuschalten.

## Authentifizierungs-API

Alle Routen liegen unter `/api/auth`:

| Methode | Pfad | Zweck |
| --- | --- | --- |
| POST | `/register` | Konto mit `email`, `password`, `username`, `age` anlegen |
| POST | `/resend-verification` | E-Mail-Bestätigungscode erneut anfordern |
| POST | `/verify-email` | E-Mail mit `email` und sechsstelligen `code` bestätigen |
| GET | `/verify-email?token=...` | Veraltete Bestätigungslinks aus bestehenden Installationen akzeptieren |
| POST | `/login` | Anmeldung mit `identifier` und `password`; sendet immer einen zusätzlichen E-Mail-Code |
| POST | `/2fa/verify` | E-Mail-Code und optional Authenticator-Code prüfen und Sitzung ausstellen |
| POST | `/verify-action` | E-Mail-Code für eine geschützte Kontenänderung prüfen |
| POST | `/refresh` | Access Token erneuern; Refresh Token liegt im HttpOnly-Cookie |
| POST | `/logout` | Refresh-Sitzung widerrufen |
| POST | `/forgot-password` | Link zum Passwort-Reset anfordern |
| POST | `/reset-password` | Passwort mit `token` und neuem `password` ändern |
| GET | `/me` | Eigenes Profil abrufen; Authorization-Header mit Bearer-Token |
| PATCH | `/me` | Benutzername und Alter nach E-Mail-Code aktualisieren |
| POST | `/change-password` | Passwortänderung anfordern; Abschluss nach E-Mail-Code |
| DELETE | `/me` | Kontolöschung mit Passwort- und E-Mail-Code bestätigen |

Das Refresh-Cookie ist `HttpOnly`, in Produktion `Secure` und stets `SameSite=Strict`. Das Frontend muss für Auth-Requests `credentials: 'include'` verwenden. Die CORS-Freigabe wird über `CLIENT_ORIGIN` eingeschränkt.

## Freundschaften, Chats und Echtzeit

Chat-Routen verwenden den Header `Authorization: Bearer <access-token>`:

| Methode | Pfad | Zweck |
| --- | --- | --- |
| GET | `/api/users/search?q=...` | Bestätigte Nutzer anhand ihres Benutzernamens suchen |
| GET/POST | `/api/friendships` | Anfragen, Kontakte und ausgehende Anfragen abrufen oder anlegen |
| POST | `/api/friendships/:id/accept` | Anfrage annehmen |
| DELETE | `/api/friendships/:id` | Anfrage zurückziehen/ablehnen oder Kontakt entfernen |
| GET/POST | `/api/blocks` | Eigene Blocks abrufen oder Nutzer blockieren |
| DELETE | `/api/blocks/:userId` | Nutzer entblocken |
| GET | `/api/conversations` | Chats mit letzter Nachricht und ungelesener Anzahl abrufen |
| POST | `/api/conversations/direct` | Direktchat mit einem bestätigten Kontakt öffnen |
| GET/POST | `/api/conversations/:id/messages` | Nachrichtenverlauf abrufen oder Nachricht senden |
| POST | `/api/conversations/:id/attachments` | Bild, Video oder Datei bis 10 MB sicher in einer Unterhaltung teilen |
| GET | `/api/attachments/:id` | Anhang nur für aktuelle Gruppenmitglieder oder Chatteilnehmer laden |
| POST | `/api/conversations/:id/read` | Nachrichten als gelesen markieren |
| PATCH/DELETE | `/api/messages/:id` | Eigene Nachricht bearbeiten oder für mich/für alle löschen |
| POST | `/api/messages/:id/reactions` | Eine der unterstützten Emoji-Reaktionen an/abwählen (`👍`, `❤️`, `😂`, `😮`, `😢`, `🎉`) |
| POST | `/api/groups` | Gruppe mit mindestens zwei bestätigten Kontakten erstellen; Ersteller ist Admin |
| GET/PATCH | `/api/groups/:id` | Gruppenmitglieder ansehen oder (als Admin) den Namen ändern |
| POST/PATCH/DELETE | `/api/groups/:id/members...` | Gruppenmitglieder hinzufügen, Admin-Rolle ändern, entfernen oder selbst verlassen |

Anhänge können Bilder (JPEG, PNG, GIF, WebP), Videos (MP4, WebM, MOV), PDF- und Textdateien bis 10 MB enthalten.

Server sind von privaten Unterhaltungen getrennt. `GET/POST /api/servers` listet oder erstellt Server; beim Erstellen entstehen ein Owner, ein Standard-Serverkanal und ein permanenter Einladungslink. `GET /api/servers/:id` liefert Server und Kanäle. Kanäle werden mit `GET/POST /api/servers/:id/channels` verwaltet. Servermitglieder können `POST /api/servers/:id/leave` verwenden; Owner können ihren Server mit `DELETE /api/servers/:id` löschen.

`GET /api/servers/invites/:code` zeigt eine öffentliche Einladungsvorschau; `POST /api/servers/invites/:code/join` tritt nach Anmeldung bei. Owner und entsprechend berechtigte Rollen können den aktiven Link mit `GET/POST/DELETE /api/servers/:id/invite` ansehen, erstellen/zurücksetzen oder widerrufen. Beim Erstellen sind optional Ablaufzeiten von 1, 24, 168 oder 720 Stunden und ein Nutzungslimit möglich.

Serverrollen unter `GET/POST /api/servers/:id/roles` und `PATCH/DELETE /api/servers/:id/roles/:roleId` sind ausschließlich Serverrollen. Mitgliederrollen lassen sich mit `PATCH /api/servers/:id/members/:userId/role` zuweisen; Mitgliederlisten und Moderationsaktionen liegen unter `/api/servers/:id/members`. Eingebaute Rollen sind Owner, Admin und Member; eigene Rollen steuern Server-, Kanal-, Einladungs-, Mitglieder- sowie Lese-/Schreibberechtigungen. Private Gruppen behalten unabhängig davon nur Admin und Member.

Der lokale Express-Server verwendet Socket.IO. Die Cloudflare-Variante verwendet authentifizierte native WebSockets über Durable Objects und transportiert dieselben UI-Ereignisse: `message:new`, `message:updated`, `message:deleted`, `message:reaction`, `conversation:read`, `typing:update`, `presence:update`, `friendship:update` und `conversation:created`. Nachrichteninhalte und Reaktionen werden über die REST-API gespeichert und anschließend in Echtzeit verteilt.

## Datenbank

Das lokale Express-Schema liegt in [`server/db/schema.sql`](server/db/schema.sql); `server/src/db.js` ergänzt additive Bestandsmigrationen und die Server-/Kanal-/Gerätetabellen. Turso-Synchronisierung und Initialisierung liegen in `server/src/turso-sync.js` und `server/src/turso-init.js`. Serverrollen und Einladungslinks werden separat von privaten Gruppenmitgliedschaften gespeichert. Lokal liegen Upload-Dateien in `data/uploads`.

## Sicherheits- und Betriebsgrenzen

- SQL-Abfragen verwenden gebundene Parameter. Lokal werden Passwörter mit bcrypt, im Worker asynchron über Web Crypto mit PBKDF2-SHA-256 gehasht.
- Login, Registrierung, Verifizierungsversand und Passwort-Reset sind pro Prozess/IP auf 10 Anfragen je 15 Minuten begrenzt.
- Helmet setzt Sicherheitsheader; Nutzernamen erlauben nur Buchstaben, Zahlen und Unterstriche. Nachrichten werden in React als Text und nicht als HTML gerendert.
- Uploads sind auf 10 MB pro Datei begrenzt. Akzeptiert werden JPEG, PNG, GIF, WebP, PDF und Textdateien; MIME-Angabe und Dateisignatur werden geprüft. SVG und ausführbare Inhalte werden nicht akzeptiert. Downloads prüfen den angemeldeten Nutzer und seine aktuelle Chatmitgliedschaft.
- Der lokale Server begrenzt Anfragen im Prozessspeicher; der Worker verwendet dafür Durable Objects. Ein einzelner globaler Realtime-Hub begrenzt die Skalierung der aktuellen Cloudflare-Version.
- Im Cloudflare-Betrieb liegen Nachrichten serverseitig als Klartext in D1. Es gibt keine Ende-zu-Ende-Verschlüsselung; verwende nur HTTPS/WSS und sichere Secrets im Cloudflare-Dashboard.
- Änderung der E-Mail-Adresse, Ende-zu-Ende-Verschlüsselung und vollständiger Gruppenlösch-/Transfer-Workflow sind noch nicht enthalten. Die grundlegende Verwaltung von Mitgliedern, Rollen und Gruppennamen ist in der Oberfläche verfügbar.
- Free-Tier-Grenzen gelten für Worker-Aufrufe, CPU, D1, Durable Objects und R2. Bei übermäßiger Nutzung oder erreichten Quoten kann der Cloudflare-Dienst Anfragen ablehnen. E-Mail-Zustellung erfordert einen externen E-Mail-API-Anbieter.
