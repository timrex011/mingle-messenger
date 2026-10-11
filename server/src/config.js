const path = require('node:path');

const isDesktop = process.env.MINGLE_DESKTOP === '1';
const isProduction = process.env.NODE_ENV === 'production';
const useSecureCookies = isProduction && !isDesktop;
const crypto = require('node:crypto');
const accessSecret = process.env.JWT_ACCESS_SECRET || crypto.randomBytes(32).toString('hex');
const refreshSecret = process.env.JWT_REFRESH_SECRET || crypto.randomBytes(32).toString('hex');
const refreshTokenTtl = process.env.REFRESH_TOKEN_TTL || '7d';
const refreshTtlMatch = refreshTokenTtl.match(/^(\d+)(s|m|h|d)$/);
const parsedPort = Number.parseInt(process.env.PORT || '3000', 10);
const databasePath = path.resolve(process.env.DATABASE_PATH || path.resolve(process.cwd(), './data/messenger.sqlite'));

if (!refreshTtlMatch || Number(refreshTtlMatch[1]) < 1) {
  throw new Error('REFRESH_TOKEN_TTL must be a positive duration such as 30m or 7d.');
}
if (!Number.isInteger(parsedPort) || parsedPort < 0 || parsedPort > 65535) {
  throw new Error('PORT must be a valid TCP port between 0 and 65535.');
}

module.exports = {
  port: parsedPort,
  host: process.env.HOST || (isDesktop ? '127.0.0.1' : '0.0.0.0'),
  appUrl: (process.env.RENDER_EXTERNAL_URL || process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  clientOrigin: (process.env.RENDER_EXTERNAL_URL || process.env.CLIENT_ORIGIN || (isDesktop ? process.env.APP_URL : 'http://localhost:5173') || 'http://localhost:5173').replace(/\/+$/, ''),
  databasePath,
  attachmentPath: path.resolve(process.env.ATTACHMENT_PATH || path.join(path.dirname(databasePath), 'uploads')),
  accessSecret: accessSecret || 'development-access-secret-change-before-production',
  refreshSecret: refreshSecret || 'development-refresh-secret-change-before-production',
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL || '15m',
  refreshTokenTtl,
  refreshTokenTtlMs: Number(refreshTtlMatch[1]) * { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[refreshTtlMatch[2]],
  emailJsUserId: process.env.EMAILJS_USER_ID || '',
  emailJsPrivateKey: process.env.EMAILJS_PRIVATE_KEY || '',
  emailJsServiceId: process.env.EMAILJS_SERVICE_ID || '',
  emailJsTemplates: {
    passwordReset: process.env.EMAILJS_TEMPLATE_PASSWORD_RESET || '',
    emailVerification: process.env.EMAILJS_TEMPLATE_EMAIL_VERIFY || '',
    securityCode: process.env.EMAILJS_TEMPLATE_SECURITY_CODE || ''
  },
  bcryptRounds: Math.min(Math.max(Number.parseInt(process.env.BCRYPT_ROUNDS || '12', 10), 10), 15),
  serveClient: isProduction || isDesktop || process.env.SERVE_CLIENT === 'true' || require('node:fs').existsSync(path.join(__dirname, '../../client/dist/index.html')),
  useSecureCookies,
  ownerEmail: (process.env.OWNER_EMAIL || 'riftduels4@gmail.com').trim().toLowerCase(),
  tursoDatabaseUrl: process.env.TURSO_DATABASE_URL || '',
  tursoAuthToken: process.env.TURSO_AUTH_TOKEN || '',
  isDesktop,
  isProduction
};
