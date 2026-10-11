require('dotenv').config();
const http = require('node:http');
const app = require('./app');
const config = require('./config');
const mailer = require('./mailer');
const db = require('./db');
const tursoSync = require('./turso-sync');
const { initRealtime } = require('./realtime');

const server = http.createServer(app);
initRealtime(server);

function publicUrl(addressInfo) {
  const hostname = !addressInfo.address || addressInfo.address === '::' || addressInfo.address === '0.0.0.0'
    ? '127.0.0.1'
    : addressInfo.address;
  return `http://${hostname}:${addressInfo.port}`;
}

async function start() {
  tursoSync.startSync(db);

  if (mailer.isConfigured) {
    try {
      await mailer.verifyTransport();
      console.info('EmailJS-Konfiguration erfolgreich geprüft.');
    } catch (emailError) {
      console.error('EmailJS-Konfiguration ist ungültig:', emailError.message);
      throw emailError;
    }
  } else {
    console.error('EmailJS ist nicht vollständig konfiguriert. Der Server kann ohne E-Mail-Versand nicht gestartet werden.');
    throw new Error('EmailJS-Konfiguration unvollständig.');
  }

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const url = publicUrl(server.address());
  if (config.isDesktop) {
    console.info(`MINGLE_READY ${url}`);
  }
  console.info(`Messenger-API läuft auf ${url} (Port ${server.address().port}).`);
}

start().catch((error) => {
  console.error('[Startfehler] Serverstart fehlgeschlagen. Prüfe .env und die EmailJS-Konfiguration:', error);
  server.close(() => {
    process.exitCode = 1;
  });
});
