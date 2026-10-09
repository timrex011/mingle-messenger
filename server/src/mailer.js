const nodemailer = require('nodemailer');
const config = require('./config');

const transporter = config.smtpHost
  ? nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      requireTLS: Boolean(config.smtpUser),
      auth: config.smtpUser ? { user: config.smtpUser, pass: config.smtpPassword } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000
    })
  : null;

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

async function verifyTransport() {
  if (!transporter) {
    throw new Error('SMTP is not configured. Set SMTP_HOST and sender settings in .env first.');
  }
  await transporter.verify();
}

async function sendAccountLink({ email, label, url }) {
  if (!transporter) {
    console.info(`[${label}] ${url}`);
    return;
  }

  const safeLabel = escapeHtml(label);
  const safeUrl = escapeHtml(url);
  await transporter.sendMail({
    from: config.smtpFrom,
    to: email,
    subject: `${label} – mingle`,
    text: `${label}\n\nÖffne diesen Link: ${url}\n\nFalls du diese Anfrage nicht gestellt hast, kannst du diese E-Mail ignorieren.`,
    html: `<!doctype html>
<html lang="de">
  <body style="margin:0;padding:32px 16px;background:#f4f6fb;font-family:Arial,sans-serif;color:#202638">
    <table role="presentation" style="width:100%;max-width:560px;margin:0 auto;border:1px solid #e8ebf2;border-radius:16px;background:#fff">
      <tr><td style="padding:30px">
        <p style="margin:0 0 24px;color:#667be9;font-size:22px;font-weight:700">mingle.</p>
        <h1 style="margin:0 0 12px;font-size:22px">${safeLabel}</h1>
        <p style="margin:0 0 24px;color:#687084;line-height:1.6">Nutze die Schaltfläche, um fortzufahren. Falls du diese Anfrage nicht gestellt hast, kannst du diese E-Mail ignorieren.</p>
        <a href="${safeUrl}" style="display:inline-block;padding:13px 20px;border-radius:10px;background:#6379ed;color:#fff;text-decoration:none;font-weight:700">Link öffnen</a>
        <p style="margin:26px 0 0;color:#9299a9;font-size:12px;line-height:1.6">Falls die Schaltfläche nicht funktioniert, kopiere diesen Link in deinen Browser:<br><a href="${safeUrl}" style="color:#6379ed;word-break:break-all">${safeUrl}</a></p>
      </td></tr>
    </table>
  </body>
</html>`
  });
}

async function sendTestEmail() {
  if (!transporter) {
    throw new Error('SMTP is not configured. Set SMTP_HOST and sender settings in .env first.');
  }
  if (!config.smtpTestTo) {
    throw new Error('Set SMTP_TEST_TO or SMTP_USER to the mailbox that should receive the test message.');
  }
  await transporter.sendMail({
    from: config.smtpFrom,
    to: config.smtpTestTo,
    subject: 'mingle – SMTP-Test',
    text: 'Der E-Mail-Versand von mingle ist erfolgreich eingerichtet.',
    html: '<p>Der E-Mail-Versand von <strong>mingle</strong> ist erfolgreich eingerichtet.</p>'
  });
}

module.exports = {
  isConfigured: Boolean(transporter),
  sendAccountLink,
  sendTestEmail,
  verifyTransport
};
