const config = require('./config');

const TEMPLATE_KEYS = {
  passwordReset: 'passwordReset',
  emailVerification: 'emailVerification',
  securityCode: 'securityCode'
};

let lastEmailJsRequest = 0;

function getTemplateId(template) {
  const key = TEMPLATE_KEYS[template];
  if (!key) {
    throw new Error(`Unbekannter EmailJS-Vorlagentyp: ${template}`);
  }
  const templateId = config.emailJsTemplates[key] || (process.env.NODE_ENV === 'test' ? `test-${key}` : '');
  if (!templateId) {
    throw new Error(`EmailJS-Vorlage fehlt: EMAILJS_TEMPLATE_${key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}`);
  }
  return templateId;
}

function assertConfigured() {
  if (!config.emailJsUserId || !config.emailJsPrivateKey || !config.emailJsServiceId) {
    throw new Error('EmailJS ist unvollständig konfiguriert. Prüfe EMAILJS_USER_ID, EMAILJS_PRIVATE_KEY und EMAILJS_SERVICE_ID.');
  }
}

async function waitForRateLimit() {
  const delay = Math.max(0, 1100 - (Date.now() - lastEmailJsRequest));
  if (delay) {
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

async function sendTemplate({ template, email, params }) {
  const templateId = getTemplateId(template);

  if (process.env.NODE_ENV === 'test') {
    console.info(`EMAILJS_TEST ${template} ${email} ${JSON.stringify(params)}`);
    return;
  }

  assertConfigured();
  await waitForRateLimit();
  const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({
      service_id: config.emailJsServiceId,
      template_id: templateId,
      user_id: config.emailJsUserId,
      accessToken: config.emailJsPrivateKey,
      template_params: {
        to_email: email,
        ...params
      }
    })
  });
  lastEmailJsRequest = Date.now();

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`EmailJS Versand fehlgeschlagen (HTTP ${response.status}): ${responseText.slice(0, 300)}`);
  }
}

async function verifyTransport() {
  assertConfigured();
  for (const template of Object.values(TEMPLATE_KEYS)) {
    getTemplateId(template);
  }
  return true;
}

async function sendPasswordReset({ email, username, url }) {
  return sendTemplate({
    template: 'passwordReset',
    email,
    params: {
      to_name: username || 'Nutzer',
      subject: 'Passwort zurücksetzen – mingle',
      reset_url: url,
      expires_in: '1 Stunde'
    }
  });
}

async function sendEmailVerification({ email, username, code }) {
  return sendTemplate({
    template: 'emailVerification',
    email,
    params: {
      to_name: username || 'Nutzer',
      subject: 'E-Mail-Adresse bestätigen – mingle',
      verification_code: code,
      expires_in: '10 Minuten'
    }
  });
}

async function sendSecurityCode({ email, username, code, purpose, message, expiresIn = '10 Minuten' }) {
  return sendTemplate({
    template: 'securityCode',
    email,
    params: {
      to_name: username || 'Nutzer',
      subject: `mingle – ${purpose}`,
      verification_code: code || '',
      expires_in: code ? `Der Code ist ${expiresIn} gültig.` : '',
      purpose,
      message
    }
  });
}

async function sendNewDeviceAlert({ email, username, ip, city, deviceName, time }) {
  return sendSecurityCode({
    email,
    username,
    purpose: 'Neue Anmeldung erkannt',
    message: `Eine Anmeldung auf deinem mingle-Konto wurde erkannt.\nZeit: ${time}\nIP-Adresse: ${ip}\nStandort: ${city}\nGerät: ${deviceName}\nWenn du das nicht warst, ändere bitte dein Passwort.`,
    code: ''
  });
}

async function sendTestEmail({ email }) {
  if (!email) {
    throw new Error('Für den EmailJS-Test muss eine Empfängeradresse angegeben werden.');
  }
  return sendSecurityCode({
    email,
    username: 'Test',
    purpose: 'E-Mail-Konfigurationstest',
    message: 'Der E-Mail-Versand von mingle ist erfolgreich eingerichtet.',
    code: ''
  });
}

module.exports = {
  get isConfigured() {
    return Boolean(config.emailJsUserId && config.emailJsPrivateKey && config.emailJsServiceId);
  },
  sendEmailVerification,
  sendNewDeviceAlert,
  sendPasswordReset,
  sendSecurityCode,
  sendTestEmail,
  verifyTransport
};
