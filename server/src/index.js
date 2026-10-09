require('dotenv').config();
const http = require('node:http');
const app = require('./app');
const config = require('./config');
const mailer = require('./mailer');
const { initRealtime } = require('./realtime');

const server = http.createServer(app);
initRealtime(server);

async function start() {
  if (mailer.isConfigured) {
    await mailer.verifyTransport();
    console.info('SMTP-Verbindung erfolgreich geprüft.');
  } else if (!config.isProduction) {
    console.warn('SMTP ist nicht konfiguriert. Bestätigungs- und Reset-Links erscheinen nur in der Serverkonsole.');
  }

  server.listen(config.port, () => {
    console.info(`Messenger-API läuft auf ${config.appUrl} (Port ${config.port}).`);
  });
}

start().catch((error) => {
  console.error('[Startfehler] Serverstart fehlgeschlagen. Prüfe .env und die SMTP-Verbindung:', error);
  server.close(() => {
    process.exitCode = 1;
  });
});
