require('dotenv').config();

const mailer = require('./mailer');

async function testEmailConfiguration() {
  await mailer.verifyTransport();
  await mailer.sendTestEmail({ email: process.env.EMAILJS_TEST_TO });
  console.info('EmailJS-Konfiguration geprüft. Die Test-E-Mail wurde erfolgreich versendet.');
}

testEmailConfiguration().catch((error) => {
  console.error('EmailJS-Test fehlgeschlagen:', error.message);
  process.exitCode = 1;
});
