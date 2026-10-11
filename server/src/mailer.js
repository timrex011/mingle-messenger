const config = require('./config');

let resendClient = null;
if (config.resendApiKey) {
  try {
    const { Resend } = require('resend');
    resendClient = new Resend(config.resendApiKey);
  } catch (err) {
    console.warn('Resend client initialization error:', err.message);
  }
}

let transporter = null;
if (config.smtpHost) {
  try {
    const nodemailer = require('nodemailer');
    transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      requireTLS: Boolean(config.smtpUser),
      auth: config.smtpUser ? { user: config.smtpUser, pass: config.smtpPassword } : undefined,
      connectionTimeout: 4_000,
      greetingTimeout: 4_000,
      socketTimeout: 8_000
    });
  } catch (err) {
    console.warn('Nodemailer initialization error:', err.message);
  }
}

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
  if (resendClient) {
    return true;
  }
  if (!transporter) {
    throw new Error('Weder RESEND_API_KEY noch SMTP_HOST ist konfiguriert.');
  }
  await transporter.verify();
}

async function sendAccountLink({ email, label, url }) {
  if (!resendClient && !transporter) {
    // Fallback: log to console (dev mode or no external email service configured)
    console.info(`[${label}] ${url}`);
    if (config.isDesktop) {
      console.info(`MINGLE_ACCOUNT_LINK ${url}`);
    }
    return;
  }

  const safeLabel = escapeHtml(label);
  const safeUrl = escapeHtml(url);
  const subject = `${label} – mingle`;
  const text = `${label}\n\nÖffne diesen Link: ${url}\n\nFalls du diese Anfrage nicht gestellt hast, kannst du diese E-Mail ignorieren.`;
  const html = `<!doctype html>
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
</html>`;

  if (resendClient) {
    await resendClient.emails.send({
      from: config.emailFrom || 'Mingle <onboarding@resend.dev>',
      to: email,
      subject,
      text,
      html
    });
    return;
  }

  if (transporter) {
    await transporter.sendMail({
      from: config.smtpFrom,
      to: email,
      subject,
      text,
      html
    });
  }
}

async function sendTestEmail() {
  const recipient = config.smtpTestTo || config.smtpUser || 'test@example.com';
  const subject = 'mingle – E-Mail-Test';
  const text = 'Der E-Mail-Versand von mingle ist erfolgreich eingerichtet.';
  const html = '<p>Der E-Mail-Versand von <strong>mingle</strong> ist erfolgreich eingerichtet.</p>';

  if (resendClient) {
    await resendClient.emails.send({
      from: config.emailFrom || 'Mingle <onboarding@resend.dev>',
      to: recipient,
      subject,
      text,
      html
    });
    return;
  }

  if (!transporter) {
    throw new Error('Weder RESEND_API_KEY noch SMTP_HOST ist konfiguriert.');
  }

  await transporter.sendMail({
    from: config.smtpFrom,
    to: recipient,
    subject,
    text,
    html
  });
}

module.exports = {
  isConfigured: Boolean(resendClient || transporter),
  sendAccountLink,
  sendTestEmail,
  verifyTransport
};
