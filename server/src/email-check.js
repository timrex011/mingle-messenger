require('dotenv').config();

const mailer = require('./mailer');

async function testEmailConfiguration() {
  await mailer.verifyTransport();
  await mailer.sendTestEmail();
  console.info('SMTP-Verbindung geprüft. Die Test-E-Mail wurde erfolgreich versendet.');
}

testEmailConfiguration().catch((error) => {
  console.error('SMTP-Test fehlgeschlagen:', error.message);
  process.exitCode = 1;
});
