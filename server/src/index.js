require('dotenv').config();
const http = require('node:http');
const app = require('./app');
const config = require('./config');
const mailer = require('./mailer');
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
  if (mailer.isConfigured) {
    await mailer.verifyTransport();
    console.info('SMTP-Verbindung erfolgreich geprüft.');
  } else if (!config.isProduction || config.isDesktop) {
    console.warn('SMTP ist nicht konfiguriert. Bestätigungs- und Reset-Links erscheinen nur in der Serverkonsole.');
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
  console.error('[Startfehler] Serverstart fehlgeschlagen. Prüfe .env und die SMTP-Verbindung:', error);
  server.close(() => {
    process.exitCode = 1;
  });
});
