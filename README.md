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

2. `.env.example` nach `.env` kopieren. Ohne SMTP-Einstellungen laufen lokale Tests mit Links in der Serverkonsole. Für echte Bestätigungs- und Passwort-Reset-E-Mails trage die SMTP-Daten deines E-Mail-Postfachs ein; Beispiele stehen im Abschnitt „E-Mail-Versand“. `.env` ist von Git ausgeschlossen und darf nicht veröffentlicht werden.

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
   npx wrangler secret put RESEND_API_KEY --config cloudflare/wrangler.toml
   npx wrangler secret put MAIL_FROM --config cloudflare/wrangler.toml
   ```

   Gib den jeweiligen Wert nur direkt in den Wrangler-Eingabeprompt ein. `MAIL_FROM` muss ein bei Resend verifizierter Absender sein. Für E-Mail-Bestätigungen an beliebige Nutzer braucht Resend in der Regel eine verifizierte eigene Domain und einen API-Key. Das Gmail-App-Passwort aus der lokalen `.env` ist **kein** Cloudflare-Mail-API-Key und darf nicht wiederverwendet werden: Workers können den vorhandenen SMTP-Versand nicht direkt nutzen. Falls Frontend und API später auf unterschiedlichen Domains liegen, setze `CLIENT_ORIGIN` in `cloudflare/wrangler.toml` auf die genaue HTTPS-Origin des Frontends.

6. Baue und veröffentliche Worker und React-Frontend:

   ```powershell
   npm run cf:deploy
   ```

   Wrangler gibt die öffentliche `workers.dev`-Adresse aus. Danach sollte `https://DEINE-ADRESSE/api/health` `{"status":"ok"}` liefern. Registrierung, Verifizierung, Login und Anhänge müssen anschließend mit echten E-Mail-Adressen über diese HTTPS-Adresse getestet werden.

`npm run cf:dev` startet die lokale Cloudflare-Variante auf `http://localhost:8787`. Dafür zuerst `cloudflare/.dev.vars.example` nach `cloudflare/.dev.vars` kopieren, eigene lokale Test-Secrets setzen und `npm run cf:d1:migrate:local` ausführen. `.dev.vars` wird nicht versioniert.

**Wichtig zu bestehenden Daten:** Die Cloudflare-Datenbank startet leer; lokale SQLite-Konten, Chats und Dateien werden nicht automatisch hochgeladen. Das Cloudflare-Backend verwendet PBKDF2-Passworthashes (mit Web Crypto), während der lokale Express-Server bcrypt nutzt. Daher können lokale Passwörter nicht einfach durch Kopieren der SQLite-Datei übernommen werden. Vor einer späteren Datenmigration muss ausdrücklich festgelegt werden, welche Daten übernommen werden dürfen und wie Nutzer ihre Passwörter zurücksetzen.

**Kosten und Limits:** Cloudflare bietet kostenlose Kontingente, aber keine unbegrenzte Gratisgarantie. Workers, D1, Durable Objects und R2 haben harte Tages-/Monats- und Speicherlimits; bei Erreichen können Anfragen oder Schreibvorgänge fehlschlagen. Prüfe aktuelle Kontingente im Cloudflare-Dashboard und richte Nutzungswarnungen ein. Der aktuelle Echtzeit-Hub ist ein einzelnes Durable Object und eignet sich zunächst für kleine bis mittlere Nutzung, nicht für unbegrenzte Skalierung.

## Windows-Desktop-EXE

Die fertige Windows-App ist ein Installer wie bei Discord oder Telegram: Setup legt Startmenü- und Desktop-Verknüpfungen an, startet den Messenger als eigenes Fenster und speichert Konten, Chats, Dateien und Sitzungen in einer lokalen SQLite-Datenbank unter `%APPDATA%\messenger-app\`. Alle bestehenden Funktionen (Registrierung, Freunde, Direkt- und Gruppenchats, Anhänge, Reaktionen, Blockieren, Einstellungen) laufen in der EXE. In der Desktop-Variante sind Konten nach der Registrierung sofort nutzbar; ein SMTP-Server ist dafür nicht nötig.

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

### E-Mail-Versand

Für den lokalen Express-Server werden Bestätigungs- und Reset-Links ohne SMTP in der Serverkonsole ausgegeben. Ist `SMTP_HOST` gesetzt, prüft der Server die SMTP-Verbindung vor dem Start. `SMTP_USER` und `SMTP_PASSWORD` müssen gemeinsam gesetzt werden. Der Absender in `SMTP_FROM` muss zum SMTP-Konto passen und vom Anbieter zugelassen sein.

Beispiel für Gmail in `.env`:

```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=deine-adresse@gmail.com
SMTP_PASSWORD=DEIN_GOOGLE_APP_PASSWORT
SMTP_FROM="mingle <deine-adresse@gmail.com>"
SMTP_TEST_TO=deine-adresse@gmail.com
```

Für Gmail wird ein **Google-App-Passwort** benötigt (2‑Faktor-Authentifizierung aktivieren und ein App-Passwort erstellen); das normale Google-Passwort funktioniert nicht. `SMTP_PASSWORD` niemals in den Chat, Quellcode oder Git einfügen. Für andere Anbieter Host, Port und TLS-Wert aus deren SMTP-Einstellungen einsetzen. Port 587 verwendet üblicherweise `SMTP_SECURE=false` (STARTTLS), Port 465 üblicherweise `SMTP_SECURE=true`.

Nach dem Eintragen kannst du Verbindung und tatsächlichen Versand testen:

```powershell
npm run email:test
```

Die Testnachricht geht an `SMTP_TEST_TO` (oder, falls leer, an `SMTP_USER`). Diese SMTP-Konfiguration gehört **nur zum lokalen Express-Server**. Die Cloudflare-Variante verwendet den HTTPS-Mail-API-Endpunkt von Resend; dafür werden `RESEND_API_KEY` und `MAIL_FROM` als Wrangler-Secrets benötigt. Ein Resend-Absender muss beim Anbieter zugelassen sein. Cloudflare-Mail-Secrets bleiben im Worker und dürfen nie als `VITE_*`-Variablen oder im Client gespeichert werden.

## Authentifizierungs-API

Alle Routen liegen unter `/api/auth`:

| Methode | Pfad | Zweck |
| --- | --- | --- |
| POST | `/register` | Konto mit `email`, `password`, `username`, `age` anlegen |
| POST | `/resend-verification` | Bestätigungslink erneut anfordern |
| GET | `/verify-email?token=...` | E-Mail-Adresse bestätigen |
| POST | `/login` | Anmeldung mit `identifier` (E-Mail oder Benutzername) und `password` |
| POST | `/refresh` | Access Token erneuern; Refresh Token liegt im HttpOnly-Cookie |
| POST | `/logout` | Refresh-Sitzung widerrufen |
| POST | `/forgot-password` | Link zum Passwort-Reset anfordern |
| POST | `/reset-password` | Passwort mit `token` und neuem `password` ändern |
| GET | `/me` | Eigenes Profil abrufen; Authorization-Header mit Bearer-Token |
| PATCH | `/me` | Benutzername und Alter aktualisieren |
| POST | `/change-password` | Passwort mit aktuellem Passwort absichern und ändern |
| DELETE | `/me` | Konto mit Passwortbestätigung dauerhaft löschen |

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
| POST | `/api/conversations/:id/attachments` | Bild oder Datei bis 10 MB sicher in einer Unterhaltung teilen |
| GET | `/api/attachments/:id` | Anhang nur für aktuelle Gruppenmitglieder oder Chatteilnehmer laden |
| POST | `/api/conversations/:id/read` | Nachrichten als gelesen markieren |
| PATCH/DELETE | `/api/messages/:id` | Eigene Nachricht bearbeiten oder für mich/für alle löschen |
| POST | `/api/messages/:id/reactions` | Eine der unterstützten Emoji-Reaktionen an/abwählen (`👍`, `❤️`, `😂`, `😮`, `😢`, `🎉`) |
| POST | `/api/groups` | Gruppe mit mindestens zwei bestätigten Kontakten erstellen; Ersteller ist Admin |
| GET/PATCH | `/api/groups/:id` | Gruppenmitglieder ansehen oder (als Admin) den Namen ändern |
| POST/PATCH/DELETE | `/api/groups/:id/members...` | Gruppenmitglieder hinzufügen, Admin-Rolle ändern, entfernen oder selbst verlassen |

Der lokale Express-Server verwendet Socket.IO. Die Cloudflare-Variante verwendet authentifizierte native WebSockets über Durable Objects und transportiert dieselben UI-Ereignisse: `message:new`, `message:updated`, `message:deleted`, `message:reaction`, `conversation:read`, `typing:update`, `presence:update`, `friendship:update` und `conversation:created`. Nachrichteninhalte und Reaktionen werden über die REST-API gespeichert und anschließend in Echtzeit verteilt.

## Datenbank

Das lokale Express-Schema liegt in [`server/db/schema.sql`](server/db/schema.sql); die D1-Migration liegt unter `cloudflare/migrations/0001_schema.sql`. Beide enthalten Nutzer, Freundschaften, Blocks, Direkt- und Gruppenkonversationen, Mitgliedschaften, Nachrichten, private Dateianhänge, Emoji-Reaktionen, persönliche Nachrichtenlöschungen, Sessions sowie Verifizierungs- und Passwort-Reset-Tokens samt Fremdschlüsseln und Indizes. Lokal liegen Upload-Dateien in `data/uploads`; in Cloudflare liegen sie privat in R2.

## Sicherheits- und Betriebsgrenzen

- SQL-Abfragen verwenden gebundene Parameter. Lokal werden Passwörter mit bcrypt, im Worker asynchron über Web Crypto mit PBKDF2-SHA-256 gehasht.
- Login, Registrierung, Verifizierungsversand und Passwort-Reset sind pro Prozess/IP auf 10 Anfragen je 15 Minuten begrenzt.
- Helmet setzt Sicherheitsheader; Nutzernamen erlauben nur Buchstaben, Zahlen und Unterstriche. Nachrichten werden in React als Text und nicht als HTML gerendert.
- Uploads sind auf 10 MB pro Datei begrenzt. Akzeptiert werden JPEG, PNG, GIF, WebP, PDF und Textdateien; MIME-Angabe und Dateisignatur werden geprüft. SVG und ausführbare Inhalte werden nicht akzeptiert. Downloads prüfen den angemeldeten Nutzer und seine aktuelle Chatmitgliedschaft.
- Der lokale Server begrenzt Anfragen im Prozessspeicher; der Worker verwendet dafür Durable Objects. Ein einzelner globaler Realtime-Hub begrenzt die Skalierung der aktuellen Cloudflare-Version.
- Im Cloudflare-Betrieb liegen Nachrichten serverseitig als Klartext in D1. Es gibt keine Ende-zu-Ende-Verschlüsselung; verwende nur HTTPS/WSS und sichere Secrets im Cloudflare-Dashboard.
- Änderung der E-Mail-Adresse, Ende-zu-Ende-Verschlüsselung und vollständiger Gruppenlösch-/Transfer-Workflow sind noch nicht enthalten. Die grundlegende Verwaltung von Mitgliedern, Rollen und Gruppennamen ist in der Oberfläche verfügbar.
- Free-Tier-Grenzen gelten für Worker-Aufrufe, CPU, D1, Durable Objects und R2. Bei übermäßiger Nutzung oder erreichten Quoten kann der Cloudflare-Dienst Anfragen ablehnen. E-Mail-Zustellung erfordert einen externen E-Mail-API-Anbieter.
