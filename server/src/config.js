const path = require('node:path');

const isProduction = process.env.NODE_ENV === 'production';
const accessSecret = process.env.JWT_ACCESS_SECRET;
const refreshSecret = process.env.JWT_REFRESH_SECRET;
const refreshTokenTtl = process.env.REFRESH_TOKEN_TTL || '7d';
const refreshTtlMatch = refreshTokenTtl.match(/^(\d+)(s|m|h|d)$/);
const smtpHost = process.env.SMTP_HOST || '';
const smtpPort = Number.parseInt(process.env.SMTP_PORT || '587', 10);
const smtpUser = process.env.SMTP_USER || '';
const smtpPassword = process.env.SMTP_PASSWORD || '';
const smtpSecureValue = process.env.SMTP_SECURE || 'false';
const databasePath = path.resolve(process.cwd(), process.env.DATABASE_PATH || './data/messenger.sqlite');

if (!refreshTtlMatch || Number(refreshTtlMatch[1]) < 1) {
  throw new Error('REFRESH_TOKEN_TTL must be a positive duration such as 30m or 7d.');
}
if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
  throw new Error('SMTP_PORT must be a valid TCP port between 1 and 65535.');
}
if (!['true', 'false'].includes(smtpSecureValue)) {
  throw new Error('SMTP_SECURE must be either true or false.');
}
if (Boolean(smtpUser) !== Boolean(smtpPassword)) {
  throw new Error('Set both SMTP_USER and SMTP_PASSWORD, or leave both empty for an unauthenticated SMTP relay.');
}

if (isProduction && (!accessSecret || !refreshSecret || accessSecret === refreshSecret)) {
  throw new Error('Set distinct JWT_ACCESS_SECRET and JWT_REFRESH_SECRET values in production.');
}
if (isProduction && (!smtpHost || !process.env.SMTP_FROM)) {
  throw new Error('Set SMTP_HOST and SMTP_FROM in production to deliver account emails.');
}

module.exports = {
  port: Number.parseInt(process.env.PORT || '3000', 10),
  appUrl: (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  clientOrigin: (process.env.CLIENT_ORIGIN || 'http://localhost:5173').replace(/\/+$/, ''),
  databasePath,
  attachmentPath: path.resolve(process.cwd(), process.env.ATTACHMENT_PATH || path.join(path.dirname(databasePath), 'uploads')),
  accessSecret: accessSecret || 'development-access-secret-change-before-production',
  refreshSecret: refreshSecret || 'development-refresh-secret-change-before-production',
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL || '15m',
  refreshTokenTtl,
  refreshTokenTtlMs: Number(refreshTtlMatch[1]) * { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[refreshTtlMatch[2]],
  smtpHost,
  smtpPort,
  smtpSecure: smtpSecureValue === 'true',
  smtpUser,
  smtpPassword,
  smtpTestTo: process.env.SMTP_TEST_TO || smtpUser,
  smtpFrom: process.env.SMTP_FROM || 'Messenger <no-reply@example.com>',
  bcryptRounds: Math.min(Math.max(Number.parseInt(process.env.BCRYPT_ROUNDS || '12', 10), 10), 15),
  isProduction
};
