const path = require('node:path');

const isDesktop = process.env.MINGLE_DESKTOP === '1';
const isProduction = process.env.NODE_ENV === 'production';
const useSecureCookies = isProduction && !isDesktop;
const crypto = require('node:crypto');
const accessSecret = process.env.JWT_ACCESS_SECRET || crypto.randomBytes(32).toString('hex');
const refreshSecret = process.env.JWT_REFRESH_SECRET || crypto.randomBytes(32).toString('hex');
const refreshTokenTtl = process.env.REFRESH_TOKEN_TTL || '7d';
const refreshTtlMatch = refreshTokenTtl.match(/^(\d+)(s|m|h|d)$/);
const smtpHost = process.env.SMTP_HOST || '';
const smtpPort = Number.parseInt(process.env.SMTP_PORT || '587', 10);
const smtpUser = process.env.SMTP_USER || '';
const smtpPassword = process.env.SMTP_PASSWORD || '';
const smtpSecureValue = process.env.SMTP_SECURE || 'false';
const parsedPort = Number.parseInt(process.env.PORT || '3000', 10);
const databasePath = path.resolve(process.env.DATABASE_PATH || path.resolve(process.cwd(), './data/messenger.sqlite'));

if (!refreshTtlMatch || Number(refreshTtlMatch[1]) < 1) {
  throw new Error('REFRESH_TOKEN_TTL must be a positive duration such as 30m or 7d.');
}
if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
  throw new Error('SMTP_PORT must be a valid TCP port between 1 and 65535.');
}
if (!Number.isInteger(parsedPort) || parsedPort < 0 || parsedPort > 65535) {
  throw new Error('PORT must be a valid TCP port between 0 and 65535.');
}
if (!['true', 'false'].includes(smtpSecureValue)) {
  throw new Error('SMTP_SECURE must be either true or false.');
}
if (Boolean(smtpUser) !== Boolean(smtpPassword)) {
  throw new Error('Set both SMTP_USER and SMTP_PASSWORD, or leave both empty for an unauthenticated SMTP relay.');
}

// Secrets and SMTP are handled gracefully with secure fallbacks

// SMTP is optional in production - if not available, accounts are verified automatically


module.exports = {
  port: parsedPort,
  host: process.env.HOST || (isDesktop ? '127.0.0.1' : '0.0.0.0'),
  appUrl: (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  clientOrigin: (process.env.CLIENT_ORIGIN || process.env.RENDER_EXTERNAL_URL || (isDesktop ? process.env.APP_URL : 'http://localhost:5173') || 'http://localhost:5173').replace(/\/+$/, ''),
  databasePath,
  attachmentPath: path.resolve(process.env.ATTACHMENT_PATH || path.join(path.dirname(databasePath), 'uploads')),
  accessSecret: accessSecret || 'development-access-secret-change-before-production',
  refreshSecret: refreshSecret || 'development-refresh-secret-change-before-production',
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL || '15m',
  refreshTokenTtl,
  refreshTokenTtlMs: Number(refreshTtlMatch[1]) * { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[refreshTtlMatch[2]],
  resendApiKey: process.env.RESEND_API_KEY || '',
  emailFrom: process.env.EMAIL_FROM || process.env.RESEND_FROM || 'Mingle <onboarding@resend.dev>',
  smtpHost,
  smtpPort,
  smtpSecure: smtpSecureValue === 'true',
  smtpUser,
  smtpPassword,
  smtpTestTo: process.env.SMTP_TEST_TO || smtpUser,
  smtpFrom: process.env.SMTP_FROM || 'Messenger <no-reply@example.com>',
  bcryptRounds: Math.min(Math.max(Number.parseInt(process.env.BCRYPT_ROUNDS || '12', 10), 10), 15),
  serveClient: isProduction || isDesktop || process.env.SERVE_CLIENT === 'true' || require('node:fs').existsSync(path.join(__dirname, '../../client/dist/index.html')),
  useSecureCookies,
  autoVerifyEmail: isDesktop ? true : process.env.AUTO_VERIFY_EMAIL === 'true',
  isDesktop,
  isProduction
};
