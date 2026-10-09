# Messenger

E-Mail-basierter Messenger mit Node.js, Express, SQLite, React und Socket.IO. Die App bietet E-Mail-Registrierung, Verifizierung, Direkt- und Gruppenchats, Freundschaftsanfragen, Blocks, Nachrichtenverwaltung, Echtzeit-Reaktionen, private Bild-/Dateianhänge und responsive Desktop-/Mobilansichten.

## Projektstruktur

```text
.
├── .env.example
├── .gitignore
├── package.json
├── package-lock.json
├── railway.json
├── client
│   ├── index.html
│   ├── package.json
│   ├── package-lock.json
│   ├── src
│   │   ├── api.js
│   │   ├── App.jsx
│   │   ├── main.jsx
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

## Öffentliche Bereitstellung auf Railway

Railway hostet **eine gemeinsame Messenger-Instanz**. Alle Nutzer verwenden damit denselben Server, dieselbe SQLite-Datenbank und dieselben Uploads. SQLite und der lokale Presence-/Rate-Limit-Speicher sind für genau eine Server-Instanz ausgelegt.

1. Veröffentliche das Projekt in einem privaten oder öffentlichen GitHub-Repository und erstelle in Railway ein Projekt aus diesem Repository. Lade niemals `.env`, Datenbankdateien oder Zugangsdaten in GitHub hoch.
2. Füge beim Railway-Service ein dauerhaftes Volume mit dem Mount-Pfad `/data` hinzu.
3. Lege im Railway-Service diese Variablen an:

    | Variable | Wert |
    | --- | --- |
    | `NODE_ENV` | `production` |
    | `DATABASE_PATH` | `/data/messenger.sqlite` |
    | `ATTACHMENT_PATH` | `/data/uploads` |
    | `APP_URL` | Deine öffentliche HTTPS-URL, z. B. `https://mingle-production.up.railway.app` |
    | `CLIENT_ORIGIN` | Dieselbe öffentliche HTTPS-URL wie `APP_URL` |
    | `JWT_ACCESS_SECRET` | Langer, zufälliger, geheimer Wert |
    | `JWT_REFRESH_SECRET` | Ein anderer langer, zufälliger, geheimer Wert |
    | `SMTP_HOST` | SMTP-Host deines E-Mail-Anbieters |
    | `SMTP_PORT` | SMTP-Port, meistens `587` |
    | `SMTP_SECURE` | `false` bei Port 587, normalerweise `true` bei Port 465 |
    | `SMTP_USER` | SMTP-Konto |
    | `SMTP_PASSWORD` | SMTP-/App-Passwort als Railway-Secret |
    | `SMTP_FROM` | Zugelassener Absender, z. B. `Mingle <deine-adresse@example.com>` |

    `PORT` wird von Railway automatisch gesetzt. Die JWT-Schlüssel müssen verschieden sein. Erzeuge sie lokal mit `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"` und füge die Ausgaben direkt als Railway-Variablen ein; teile sie nicht im Chat.
4. Railway verwendet `railway.json`, baut das React-Frontend und startet den Express-Server. Füge in Railway eine öffentliche Domain hinzu und warte, bis der Healthcheck unter `/api/health` erfolgreich ist.
5. Teste Registrierung, Bestätigungs-E-Mail, Anmeldung und Datei-Upload über die öffentliche HTTPS-Adresse. SMTP-Passwort und JWT-Schlüssel bleiben ausschließlich in Railway und dürfen nie in Frontend-Variablen eingetragen werden.

Das Volume muss **vor dem ersten produktiven Start** angelegt sein und am Pfad `/data` hängen. Ohne Volume gehen SQLite-Daten und Uploads bei einem Austausch der Railway-Instanz verloren. SQLite-WAL benötigt, dass Datenbank, `-wal` und `-shm` gemeinsam auf diesem Volume liegen. Betreibe zunächst nur eine Railway-Replica; mehrere Replicas benötigen PostgreSQL, einen gemeinsamen Upload-Speicher, einen zentralen Rate-Limit-Store und einen Socket.IO-Adapter.

## Windows-Desktop-EXE

Der Electron-Client ist eine portable Desktop-EXE für genau dieselbe gehostete Web-App; Konten und Chats werden **nicht** lokal gespeichert. Baue die EXE erst, nachdem die Railway-App eine echte öffentliche HTTPS-Adresse hat. Unter Windows mit Node.js 20+ im Projektverzeichnis:

```powershell
Push-Location desktop
npm install
Pop-Location
$env:MINGLE_APP_URL = "https://deine-öffentliche-railway-url"
npm run desktop:dist
```

Die portable EXE liegt danach in `release/` und kann direkt gestartet werden; sie installiert keine Startmenü- oder Desktop-Verknüpfungen. Die URL wird für den Build in `desktop/app-url.json` geschrieben und von Git ignoriert. Für eine andere Serveradresse muss die EXE mit der neuen `MINGLE_APP_URL` neu gebaut werden. Zum Entwickeln mit einem lokalen Vite-Server: in einem Terminal `Push-Location client; npm run dev` und in einem zweiten Terminal `Push-Location desktop; npm install; Pop-Location; npm run desktop:dev` ausführen.

### E-Mail-Versand

In der Entwicklung werden Links nur dann in der Serverkonsole ausgegeben, wenn SMTP nicht konfiguriert ist. Sobald `SMTP_HOST` gesetzt ist, prüft der Server die SMTP-Verbindung vor dem Start und bricht mit einer klaren Meldung ab, falls Host, TLS oder Zugangsdaten nicht funktionieren. `SMTP_USER` und `SMTP_PASSWORD` müssen gemeinsam gesetzt werden. Der Absender in `SMTP_FROM` muss zum SMTP-Konto passen und vom Anbieter zugelassen sein.

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

Die Testnachricht geht an `SMTP_TEST_TO` (oder, falls leer, an `SMTP_USER`). Für produktive Bereitstellung muss `CLIENT_ORIGIN` auf die öffentlich erreichbare HTTPS-Adresse der Web-App zeigen, damit Bestätigungs- und Reset-Links von Empfängern geöffnet werden können. `SMTP_FROM` allein ist keine E-Mail-Adresseinrichtung; ein SMTP-Postfach und dessen Zugangsdaten sind erforderlich.

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

Socket.IO authentifiziert sich beim Verbindungsaufbau mit `auth: { token: accessToken }`. Der Server sendet `message:new`, `message:updated`, `message:deleted`, `message:reaction`, `conversation:read`, `typing:update`, `presence:update`, `friendship:update` und `conversation:created`. Der Client sendet `typing:set`; Nachrichteninhalte und Reaktionen werden über die REST-API gespeichert und anschließend in Echtzeit verteilt.

## Datenbank

Das vollständige Schema liegt in [`server/db/schema.sql`](server/db/schema.sql). Es enthält Nutzer, Freundschaften, Blocks, Direkt- und Gruppenkonversationen, Mitgliedschaften, Nachrichten, private Dateianhänge, Emoji-Reaktionen, persönliche Nachrichtenlöschungen, Sessions, Verifizierungs- und Passwort-Reset-Tokens samt Fremdschlüsseln und Indizes. Upload-Dateien werden standardmäßig in `data/uploads` gespeichert; der Pfad lässt sich mit `ATTACHMENT_PATH` anpassen.

## Sicherheits- und Betriebsgrenzen

- SQLite-Abfragen verwenden gebundene Parameter; Passwörter werden mit bcrypt gehasht.
- Login, Registrierung, Verifizierungsversand und Passwort-Reset sind pro Prozess/IP auf 10 Anfragen je 15 Minuten begrenzt.
- Helmet setzt Sicherheitsheader; Nutzernamen erlauben nur Buchstaben, Zahlen und Unterstriche. Nachrichten werden in React als Text und nicht als HTML gerendert.
- Uploads sind auf 10 MB pro Datei begrenzt. Akzeptiert werden JPEG, PNG, GIF, WebP, PDF und Textdateien; MIME-Angabe und Dateisignatur werden geprüft. SVG und ausführbare Inhalte werden nicht akzeptiert. Downloads prüfen den angemeldeten Nutzer und seine aktuelle Chatmitgliedschaft.
- Die In-Memory-Rate-Limitierung eignet sich nur für lokale Einzelinstanzen. Für mehrere Produktionsinstanzen ist ein gemeinsamer Store (z. B. Redis) nötig.
- Die Railway-Konfiguration nutzt bewusst eine einzelne Instanz mit SQLite auf persistentem Volume. Für größere Last muss vor horizontaler Skalierung auf PostgreSQL und gemeinsame Echtzeit-/Dateispeicher umgestellt werden.
- Es gibt keine Ende-zu-Ende-Verschlüsselung: Nachrichten liegen serverseitig als Klartext in SQLite. In Produktion müssen HTTPS/WSS am Reverse Proxy aktiviert und Datenbankzugriffe geschützt werden.
- Änderung der E-Mail-Adresse, Ende-zu-Ende-Verschlüsselung und vollständiger Gruppenlösch-/Transfer-Workflow sind noch nicht enthalten. Die grundlegende Verwaltung von Mitgliedern, Rollen und Gruppennamen ist in der Oberfläche verfügbar.
- Presence-Status und Rate-Limits liegen im Prozessspeicher; horizontale Skalierung benötigt Socket.IO-Adapter und einen gemeinsamen Rate-Limit-Store.
