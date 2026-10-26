const crypto = require('node:crypto');
const path = require('node:path');
const { generateSecret, generateURI, verify } = require('otplib');
const QRCode = require('qrcode');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const db = require('./db');
const config = require('./config');
const mailer = require('./mailer');
const { getIpLocation } = require('./geolocation');
const realtime = require('./realtime');
const { createChatRouter } = require('./chat');
const {
  imageUploadMiddleware,
  isValidImage,
  saveImage,
  deleteImageIfUnreferenced
} = require('./image-media');
const {
  bcrypt,
  clearRefreshCookie,
  createAccessToken,
  createOpaqueToken,
  createRefreshToken,
  hashToken,
  setRefreshCookie,
  verifyAccessToken,
  verifyRefreshToken
} = require('./auth');

const app = express();
const authRouter = express.Router();

app.disable('x-powered-by');
if (config.isProduction && !config.isDesktop) app.set('trust proxy', 1);
app.use(helmet({
  hsts: config.useSecureCookies ? { maxAge: 15552000, includeSubDomains: true } : false,
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      mediaSrc: ["'self'", 'blob:'],
      connectSrc: ["'self'", 'ws:', 'wss:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"]
    }
  }
}));
app.use(cors({
  origin(origin, callback) {
    if (!origin || origin === config.clientOrigin || origin === config.appUrl) {
      callback(null, true);
      return;
    }
    // Allow Vercel-hosted landing page
    if (origin && (origin.endsWith('.vercel.app') || origin.endsWith('.vercel.app'))) {
      callback(null, true);
      return;
    }
    callback(new Error('Origin is not allowed by CORS.'));
  },
  credentials: true
}));
app.use(express.json({ limit: '32kb', type: 'application/json' }));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));
app.use(cookieParser());

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === 'test' ? 100 : 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Zu viele Versuche. Bitte warte 15 Minuten und versuche es erneut.' }
});

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isValidEmail(value) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidUsername(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_]{3,20}$/.test(value);
}

function createEmailCode() {
  return crypto.randomInt(100000, 1000000).toString();
}

async function isValidTotpCode(code, secret) {
  const result = await verify({ token: code.replace(/\s/g, ''), secret });
  return result.valid;
}

async function startEmailChallenge({ user, email = user.email, purpose, message, payload = null }) {
  const challengeToken = createOpaqueToken();
  const code = createEmailCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  db.prepare('DELETE FROM email_auth_challenges WHERE user_id = ? AND purpose = ?').run(user.id, purpose);
  db.prepare(`
    INSERT INTO email_auth_challenges (challenge_hash, user_id, purpose, code_hash, payload, email, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    hashToken(challengeToken),
    user.id,
    purpose,
    hashToken(code),
    payload === null ? null : JSON.stringify(payload),
    email,
    expiresAt
  );
  try {
    if (purpose === 'email_verification') {
      await mailer.sendEmailVerification({ email, username: user.username, code });
    } else {
      await mailer.sendSecurityCode({
        email,
        username: user.username,
        code,
        purpose,
        message,
        expiresIn: '10 Minuten'
      });
    }
  } catch (error) {
    db.prepare('DELETE FROM email_auth_challenges WHERE challenge_hash = ?').run(hashToken(challengeToken));
    throw error;
  }
  return challengeToken;
}

function verifyEmailChallenge(challengeToken, code, purpose, userId = null) {
  if (typeof challengeToken !== 'string' || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    return null;
  }
  const challengeHash = hashToken(challengeToken);
  const challenge = db.prepare(`
    SELECT * FROM email_auth_challenges
    WHERE challenge_hash = ? AND purpose = ? AND expires_at > ? AND attempts < 5
      AND (? IS NULL OR user_id = ?)
  `).get(challengeHash, purpose, new Date().toISOString(), userId, userId);
  if (!challenge) {
    return null;
  }
  if (challenge.code_hash !== hashToken(code)) {
    db.prepare(`
      UPDATE email_auth_challenges
      SET attempts = attempts + 1
      WHERE challenge_hash = ?
    `).run(challengeHash);
    return null;
  }
  return challenge;
}

function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    age: row.age,
    role: row.role || 'member',
    status: row.status || 'online',
    customStatus: row.custom_status || '',
    avatarUrl: row.avatar_url,
    bannerUrl: row.banner_url || '',
    about: row.about || '',
    pronouns: row.pronouns || '',
    emailVerified: Boolean(row.email_verified),
    totpEnabled: Boolean(row.totp_enabled),
    isBanned: Boolean(row.is_banned),
    banReason: row.ban_reason || '',
    createdAt: row.created_at
  };
}

function issueSession(user, res) {
  const sessionId = crypto.randomUUID();
  const refreshToken = createRefreshToken(user.id, sessionId);
  const expiresAt = new Date(Date.now() + config.refreshTokenTtlMs).toISOString();
  db.prepare(`
    INSERT INTO sessions (id, user_id, refresh_token_hash, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(sessionId, user.id, hashToken(refreshToken), expiresAt);
  setRefreshCookie(res, refreshToken);
  return {
    accessToken: createAccessToken(user, sessionId),
    tokenType: 'Bearer',
    expiresIn: config.accessTokenTtl,
    user: publicUser(user)
  };
}

function requireAuth(req, res, next) {
  const authorization = req.get('authorization') || '';
  const match = authorization.match(/^Bearer ([^\s]+)$/i);
  if (!match) {
    res.status(401).json({ error: 'Authentifizierung erforderlich.' });
    return;
  }
  try {
    req.auth = verifyAccessToken(match[1]);
    const user = db.prepare('SELECT auth_version, email_verified, role, is_banned, ban_reason FROM users WHERE id = ?').get(req.auth.sub);
    const session = user && db.prepare(`
      SELECT 1 FROM sessions
      WHERE id = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > ?
    `).get(req.auth.sid, req.auth.sub, new Date().toISOString());
    if (!user || !user.email_verified || req.auth.ver !== user.auth_version || !session) {
      res.status(401).json({ error: 'Sitzung abgelaufen oder ungültig.' });
      return;
    }
    if (user.is_banned) {
      res.status(403).json({ error: `Dein Konto wurde gesperrt. Grund: ${user.ban_reason || 'Verstoß gegen die Richtlinien'}` });
      return;
    }
    req.userRole = user.role || 'member';
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError' || error.name === 'JsonWebTokenError') {
      res.status(401).json({ error: 'Sitzung abgelaufen oder ungültig.' });
      return;
    }
    next(error);
  }
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

authRouter.post('/register', authLimiter, asyncRoute(async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = req.body.password;
  const username = typeof req.body.username === 'string' ? req.body.username.trim().toLowerCase() : '';
  const age = Number(req.body.age);

  if (!isValidEmail(email)) {
    res.status(400).json({ error: 'Bitte gib eine gültige E-Mail-Adresse ein.' });
    return;
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    res.status(400).json({ error: 'Das Passwort muss mindestens 8 und höchstens 128 Zeichen lang sein.' });
    return;
  }
  if (!isValidUsername(username)) {
    res.status(400).json({ error: 'Der Benutzername muss 3–20 Zeichen lang sein und darf nur Buchstaben, Zahlen oder _ enthalten.' });
    return;
  }
  if (!Number.isInteger(age) || age < 13 || age > 120) {
    res.status(400).json({ error: 'Du musst mindestens 13 Jahre alt sein.' });
    return;
  }

  const existingUser = db.prepare(`
    SELECT email, username FROM users WHERE LOWER(email) = LOWER(?) OR LOWER(username) = LOWER(?)
  `).get(email, username);
  if (existingUser) {
    if (existingUser.email.toLowerCase() === email.toLowerCase()) {
      res.status(409).json({ error: 'Diese E-Mail-Adresse ist bereits vergeben.' });
      return;
    }
    res.status(409).json({ error: 'Dieser Benutzername ist bereits vergeben.' });
    return;
  }

  const id = crypto.randomUUID();
  const passwordHash = await bcrypt.hash(password, config.bcryptRounds);
  const isOwner = config.ownerEmail && email.toLowerCase() === config.ownerEmail.toLowerCase();
  const initialRole = isOwner ? 'owner' : 'member';

  try {
    db.prepare(`
      INSERT INTO users (id, email, username, password_hash, age, email_verified, role)
      VALUES (?, ?, ?, ?, ?, 0, ?)
    `).run(id, email, username, passwordHash, age, initialRole);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(409).json({ error: 'E-Mail-Adresse oder Benutzername ist bereits vergeben.' });
      return;
    }
    throw error;
  }

  try {
    await startEmailChallenge({
      user: { id, email, username },
      purpose: 'email_verification',
      message: 'Bestätige deine E-Mail-Adresse, um die Registrierung abzuschließen.'
    });
  } catch (error) {
    console.error('[EmailJS] Bestätigungscode konnte nicht versendet werden:', error.message);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    res.status(503).json({ error: 'Die Bestätigungs-E-Mail konnte nicht versendet werden. Prüfe die E-Mail-Konfiguration und versuche es erneut.' });
    return;
  }

  res.status(201).json({
    message: 'Konto erstellt! Gib den Bestätigungscode aus deinem Postfach ein.',
    verificationRequired: true
  });
}));

authRouter.post('/resend-verification', authLimiter, asyncRoute(async (req, res) => {
  const email = normalizeEmail(req.body.email);
  if (!isValidEmail(email)) {
    res.status(400).json({ error: 'Bitte gib eine gültige E-Mail-Adresse ein.' });
    return;
  }
  const user = db.prepare('SELECT id, email, username, email_verified FROM users WHERE email = ?').get(email);
  if (user && !user.email_verified) {
    try {
      await startEmailChallenge({
        user,
        purpose: 'email_verification',
        message: 'Bestätige deine E-Mail-Adresse, um die Registrierung abzuschließen.'
      });
    } catch (error) {
      console.error('[EmailJS] Erneuter Bestätigungscode konnte nicht versendet werden:', error.message);
      res.status(503).json({ error: 'Der Bestätigungscode konnte nicht versendet werden. Bitte versuche es später erneut.' });
      return;
    }
  }
  res.json({ message: 'Falls ein unbestätigtes Konto zu dieser E-Mail-Adresse existiert, wurde ein Bestätigungscode versendet.' });
}));

authRouter.post('/verify-email', authLimiter, (req, res) => {
  const email = normalizeEmail(req.body.email);
  const code = typeof req.body.code === 'string' ? req.body.code.trim() : '';
  const challenge = db.prepare(`
    SELECT * FROM email_auth_challenges
    WHERE user_id = (SELECT id FROM users WHERE email = ? COLLATE NOCASE)
      AND purpose = 'email_verification'
      AND expires_at > ?
      AND attempts < 5
  `).get(email, new Date().toISOString());
  if (!challenge || !/^\d{6}$/.test(code) || challenge.code_hash !== hashToken(code)) {
    if (challenge) {
      db.prepare('UPDATE email_auth_challenges SET attempts = attempts + 1 WHERE challenge_hash = ?')
        .run(challenge.challenge_hash);
    }
    res.status(400).json({ error: 'Der Bestätigungscode ist ungültig oder abgelaufen.' });
    return;
  }
  const verify = db.transaction(() => {
    db.prepare(`
      UPDATE users
      SET email_verified = 1,
          role = CASE WHEN LOWER(email) = LOWER(?) THEN 'owner' ELSE role END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(config.ownerEmail, challenge.user_id);
    db.prepare('DELETE FROM email_auth_challenges WHERE challenge_hash = ?').run(challenge.challenge_hash);
    db.prepare('DELETE FROM email_auth_challenges WHERE user_id = ? AND purpose = ?')
      .run(challenge.user_id, 'email_verification');
  });
  verify();
  res.json({ message: 'E-Mail-Adresse erfolgreich bestätigt. Du kannst dich jetzt anmelden.' });
});

authRouter.get('/verify-email', (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  if (!token) {
    res.status(400).json({ error: 'Verifizierungslink ist ungültig.' });
    return;
  }

  const tokenHash = hashToken(token);
  const verify = db.transaction(() => {
    const record = db.prepare(`
      SELECT user_id, expires_at FROM email_verification_tokens WHERE token_hash = ?
    `).get(tokenHash);
    if (!record || Date.parse(record.expires_at) <= Date.now()) {
      if (record) {
        db.prepare('DELETE FROM email_verification_tokens WHERE token_hash = ?').run(tokenHash);
      }
      return false;
    }
    db.prepare(`
      UPDATE users
      SET email_verified = 1,
          role = CASE WHEN LOWER(email) = LOWER(?) THEN 'owner' ELSE role END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(config.ownerEmail, record.user_id);
    db.prepare('DELETE FROM email_verification_tokens WHERE token_hash = ?').run(tokenHash);
    return true;
  });

  if (!verify()) {
    res.status(400).json({ error: 'Verifizierungslink ist ungültig oder abgelaufen.' });
    return;
  }
  res.json({ message: 'E-Mail-Adresse erfolgreich bestätigt. Du kannst dich jetzt anmelden.' });
});

async function handleDeviceLogin(user, req) {
  if (!user || !user.id) return;
  try {
    const rawDeviceId = typeof req.body.deviceId === 'string' && req.body.deviceId.trim()
      ? req.body.deviceId.trim()
      : null;
    const userAgent = req.headers['user-agent'] || 'Unbekanntes Gerät';
    const deviceIdentifier = rawDeviceId || crypto.createHash('sha256').update(userAgent).digest('hex').slice(0, 32);

    const deviceName = typeof req.body.deviceName === 'string' && req.body.deviceName.trim()
      ? req.body.deviceName.trim().slice(0, 100)
      : (userAgent.length > 80 ? userAgent.slice(0, 80) : userAgent);

    const clientIp = (req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : '')
      || req.headers['cf-connecting-ip']
      || req.socket.remoteAddress
      || '127.0.0.1';

    const existingDevice = db.prepare('SELECT id FROM user_devices WHERE user_id = ? AND device_identifier = ?').get(user.id, deviceIdentifier);

    const loc = await getIpLocation(clientIp);

    if (!existingDevice) {
      // New device: save to DB
      db.prepare(`
        INSERT INTO user_devices (id, user_id, device_identifier, device_name, ip_address, city, last_login_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(crypto.randomUUID(), user.id, deviceIdentifier, deviceName, loc.ip, loc.city);

      // Send alert email asynchronously
      await mailer.sendNewDeviceAlert({
        email: user.email,
        username: user.username,
        ip: loc.ip,
        city: loc.city,
        deviceName,
        time: new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })
      });
    } else {
      // Known device: update timestamp & location
      db.prepare(`
        UPDATE user_devices
        SET last_login_at = CURRENT_TIMESTAMP, ip_address = ?, city = ?, device_name = ?
        WHERE id = ?
      `).run(loc.ip, loc.city, deviceName, existingDevice.id);
    }
  } catch (err) {
    console.warn('[DeviceLogin] Warnung bei Geräte-Registrierung:', err.message);
  }
}

authRouter.post('/login', authLimiter, asyncRoute(async (req, res) => {
  const identifier = typeof req.body.identifier === 'string' ? req.body.identifier.trim() : '';
  const password = req.body.password;
  if (!identifier || typeof password !== 'string') {
    res.status(400).json({ error: 'Bitte gib Benutzername/E-Mail und Passwort ein.' });
    return;
  }

  const user = db.prepare(`
    SELECT * FROM users
    WHERE email = ? OR username = ?
  `).get(identifier.toLowerCase(), identifier.toLowerCase());
  const passwordMatches = user
    ? await bcrypt.compare(password, user.password_hash)
    : await bcrypt.compare(password, '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy');

  if (!user || !passwordMatches) {
    res.status(401).json({ error: 'Anmeldedaten sind ungültig.' });
    return;
  }
  if (user.is_banned) {
    res.status(403).json({ error: `Dein Konto wurde gesperrt. Grund: ${user.ban_reason || 'Verstoß gegen die Regeln'}` });
    return;
  }
  if (!user.email_verified) {
    res.status(403).json({ error: 'Bitte bestätige zuerst deine E-Mail-Adresse mit dem Code aus deinem Postfach.' });
    return;
  }

  let challengeToken;
  try {
    challengeToken = await startEmailChallenge({
      user,
      purpose: 'login',
      message: `Jemand versucht, sich bei deinem mingle-Konto anzumelden${user.totp_enabled ? '. Nach diesem Code benötigst du zusätzlich den Code aus deiner Authenticator-App' : ''}.`
    });
  } catch (error) {
    console.error('[EmailJS] Login-Code konnte nicht versendet werden:', error.message);
    res.status(503).json({ error: 'Der Anmeldecode konnte nicht versendet werden. Bitte versuche es später erneut.' });
    return;
  }
  res.json({
    emailCodeRequired: true,
    twoFactorRequired: Boolean(user.totp_enabled),
    challengeToken
  });
}));

authRouter.post('/2fa/verify', authLimiter, asyncRoute(async (req, res) => {
  const emailCode = typeof req.body.emailCode === 'string' ? req.body.emailCode.trim() : '';
  const challenge = verifyEmailChallenge(req.body.challengeToken, emailCode, 'login');
  if (!challenge) {
    res.status(401).json({ error: 'Der E-Mail-Code ist ungültig oder abgelaufen.' });
    return;
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND email_verified = 1').get(challenge.user_id);
  if (!user) {
    db.prepare('DELETE FROM email_auth_challenges WHERE challenge_hash = ?').run(challenge.challenge_hash);
    res.status(401).json({ error: 'Konto nicht gefunden oder nicht bestätigt.' });
    return;
  }
  if (user.totp_enabled) {
    const totpCode = typeof req.body.totpCode === 'string' ? req.body.totpCode.replace(/\s/g, '') : '';
    if (!(await isValidTotpCode(totpCode, user.totp_secret))) {
      res.status(401).json({ error: 'Der Authenticator-Code ist ungültig oder abgelaufen.' });
      return;
    }
  }
  db.prepare('DELETE FROM email_auth_challenges WHERE challenge_hash = ?').run(challenge.challenge_hash);
  db.prepare('UPDATE users SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
  handleDeviceLogin(user, req);
  res.json(issueSession(user, res));
}));

// ── 2FA: setup – generate secret and QR code ────────────────────────────────
authRouter.post('/2fa/setup', requireAuth, asyncRoute(async (req, res) => {
  const user = db.prepare('SELECT id, email, username, totp_enabled FROM users WHERE id = ?').get(req.auth.sub);
  if (user.totp_enabled) {
    res.status(409).json({ error: '2FA ist bereits aktiviert.' });
    return;
  }
  const secret = generateSecret();
  const otpauthUrl = generateURI({ issuer: 'mingle', label: user.username, secret });
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl);
  db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(secret, user.id);
  try {
    const challengeToken = await startEmailChallenge({
      user,
      purpose: 'enable_2fa',
      message: 'Gib den E-Mail-Code ein, um die Aktivierung der Authenticator-2FA zu bestätigen.'
    });
    res.json({ secret, qrDataUrl, challengeToken });
  } catch (error) {
    db.prepare('UPDATE users SET totp_secret = NULL WHERE id = ?').run(user.id);
    console.error('[EmailJS] 2FA-Bestätigungscode konnte nicht versendet werden:', error.message);
    res.status(503).json({ error: 'Der Sicherheitscode konnte nicht versendet werden. Bitte versuche es später erneut.' });
  }
}));

// ── 2FA: enable – verify first code and activate 2FA ────────────────────────
authRouter.post('/2fa/enable', requireAuth, asyncRoute(async (req, res) => {
  const code = typeof req.body.code === 'string' ? req.body.code : '';
  const emailChallenge = verifyEmailChallenge(req.body.challengeToken, req.body.emailCode, 'enable_2fa', req.auth.sub);
  if (!emailChallenge) {
    res.status(401).json({ error: 'Der E-Mail-Sicherheitscode ist ungültig oder abgelaufen.' });
    return;
  }
  const user = db.prepare('SELECT id, totp_secret, totp_enabled FROM users WHERE id = ?').get(req.auth.sub);
  if (user.totp_enabled) {
    res.status(409).json({ error: '2FA ist bereits aktiviert.' });
    return;
  }
  if (!user.totp_secret) {
    res.status(400).json({ error: 'Bitte starte zuerst die 2FA-Einrichtung.' });
    return;
  }
  const isValid = await isValidTotpCode(code, user.totp_secret);
  if (!isValid) {
    res.status(401).json({ error: 'Ungültiger Code. Bitte versuche es erneut.' });
    return;
  }
  db.transaction(() => {
    db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(user.id);
    db.prepare('DELETE FROM email_auth_challenges WHERE challenge_hash = ?').run(emailChallenge.challenge_hash);
  })();
  const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  res.json({ message: '2FA wurde erfolgreich aktiviert.', user: publicUser(updatedUser) });
}));

// ── 2FA: disable – deactivate 2FA with password confirmation ────────────────
authRouter.post('/2fa/disable', requireAuth, asyncRoute(async (req, res) => {
  const { password } = req.body;
  if (typeof password !== 'string') {
    res.status(400).json({ error: 'Passwort erforderlich.' });
    return;
  }
  const user = db.prepare('SELECT id, email, username, password_hash, totp_enabled FROM users WHERE id = ?').get(req.auth.sub);
  if (!user.totp_enabled) {
    res.status(400).json({ error: '2FA ist nicht aktiviert.' });
    return;
  }
  const passwordMatches = await bcrypt.compare(password, user.password_hash);
  if (!passwordMatches) {
    res.status(401).json({ error: 'Falsches Passwort.' });
    return;
  }
  const challengeToken = await startEmailChallenge({
    user,
    purpose: 'disable_2fa',
    message: 'Es wurde angefordert, die Authenticator-2FA für dein Konto zu deaktivieren.'
  });
  res.json({
    message: 'Ein Sicherheitscode wurde per E-Mail gesendet. Bestätige damit die Deaktivierung.',
    challengeToken
  });
}));

authRouter.post('/verify-action', requireAuth, authLimiter, asyncRoute(async (req, res) => {
  const challengeToken = typeof req.body.challengeToken === 'string' ? req.body.challengeToken : '';
  const challengeHash = hashToken(challengeToken);
  const challenge = db.prepare(`
    SELECT * FROM email_auth_challenges
    WHERE challenge_hash = ? AND user_id = ? AND expires_at > ? AND attempts < 5
  `).get(challengeHash, req.auth.sub, new Date().toISOString());
  if (!challenge || !verifyEmailChallenge(challengeToken, req.body.code, challenge.purpose, req.auth.sub)) {
    res.status(400).json({ error: 'Der Sicherheitscode ist ungültig oder abgelaufen.' });
    return;
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.auth.sub);
  const payload = JSON.parse(challenge.payload || '{}');

  if (challenge.purpose === 'change_email_old') {
    const code = createEmailCode();
    db.prepare(`
      UPDATE email_auth_challenges
      SET purpose = 'change_email_new', code_hash = ?, email = ?, attempts = 0
      WHERE challenge_hash = ?
    `).run(hashToken(code), payload.newEmail, challengeHash);
    try {
      await mailer.sendSecurityCode({
        email: payload.newEmail,
        username: user.username,
        code,
        purpose: 'Neue E-Mail-Adresse bestätigen',
        message: 'Gib diesen Code ein, um den Wechsel deiner E-Mail-Adresse abzuschließen.'
      });
    } catch (error) {
      db.prepare('DELETE FROM email_auth_challenges WHERE challenge_hash = ?').run(challengeHash);
      console.error('[EmailJS] Code an die neue E-Mail-Adresse konnte nicht versendet werden:', error.message);
      res.status(503).json({ error: 'Der Code konnte nicht an die neue E-Mail-Adresse versendet werden. Bitte starte den Vorgang erneut.' });
      return;
    }
    res.json({ nextStep: 'new_email', message: 'Der Code für deine neue E-Mail-Adresse wurde gesendet.' });
    return;
  }

  if (challenge.purpose === 'change_email_new') {
    if (db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE AND id <> ?').get(payload.newEmail, user.id)) {
      res.status(409).json({ error: 'Diese E-Mail-Adresse wird bereits verwendet.' });
      return;
    }
    await mailer.sendSecurityCode({
      email: payload.oldEmail,
      username: user.username,
      purpose: 'E-Mail-Adresse geändert',
      message: `Die E-Mail-Adresse deines mingle-Kontos wurde in ${payload.newEmail} geändert.`
    });
    db.transaction(() => {
      db.prepare('UPDATE users SET email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(payload.newEmail, user.id);
      db.prepare('DELETE FROM email_auth_challenges WHERE challenge_hash = ?').run(challengeHash);
    })();
    res.json({
      message: 'E-Mail-Adresse erfolgreich geändert.',
      user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id))
    });
    return;
  }

  if (challenge.purpose === 'password_change') {
    db.transaction(() => {
      db.prepare(`
        UPDATE users
        SET password_hash = ?, auth_version = auth_version + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(payload.passwordHash, user.id);
      db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
        .run(new Date().toISOString(), user.id);
      db.prepare('DELETE FROM email_auth_challenges WHERE challenge_hash = ?').run(challengeHash);
    })();
    realtime.disconnectUser(user.id);
    clearRefreshCookie(res);
    res.json({ message: 'Passwort geändert. Bitte melde dich erneut an.' });
    return;
  }

  if (challenge.purpose === 'disable_2fa') {
    db.transaction(() => {
      db.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?').run(user.id);
      db.prepare('DELETE FROM email_auth_challenges WHERE challenge_hash = ?').run(challengeHash);
    })();
    res.json({
      message: '2FA wurde erfolgreich deaktiviert.',
      user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id))
    });
    return;
  }

  if (challenge.purpose === 'profile_change') {
    try {
      db.prepare(`
        UPDATE users SET username = ?, age = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(payload.username, payload.age, user.id);
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        res.status(409).json({ error: 'Dieser Benutzername ist bereits vergeben.' });
        return;
      }
      throw error;
    }
    db.prepare('DELETE FROM email_auth_challenges WHERE challenge_hash = ?').run(challengeHash);
    res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)) });
    return;
  }

  if (challenge.purpose === 'delete_account') {
    realtime.disconnectUser(user.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    clearRefreshCookie(res);
    res.json({ message: 'Dein Konto wurde gelöscht.' });
    return;
  }

  res.status(400).json({ error: 'Unbekannte Sicherheitsaktion.' });
}));

authRouter.post('/refresh', (req, res) => {
  const token = req.cookies?.refreshToken || req.get('x-refresh-token');
  if (typeof token !== 'string') {
    clearRefreshCookie(res);
    res.status(401).json({ error: 'Sitzung abgelaufen. Bitte melde dich erneut an.' });
    return;
  }

  let claims;
  try {
    claims = verifyRefreshToken(token);
  } catch (error) {
    if (error.name !== 'TokenExpiredError' && error.name !== 'JsonWebTokenError') {
      throw error;
    }
    clearRefreshCookie(res);
    res.status(401).json({ error: 'Sitzung abgelaufen. Bitte melde dich erneut an.' });
    return;
  }

  const session = db.prepare(`
    SELECT id, user_id FROM sessions
    WHERE id = ? AND user_id = ? AND refresh_token_hash = ? AND revoked_at IS NULL AND expires_at > ?
  `).get(claims.sid, claims.sub, hashToken(token), new Date().toISOString());
  if (!session) {
    clearRefreshCookie(res);
    res.status(401).json({ error: 'Sitzung ungültig. Bitte melde dich erneut an.' });
    return;
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ? AND email_verified = 1').get(session.user_id);
  if (!user) {
    db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').run(new Date().toISOString(), session.id);
    clearRefreshCookie(res);
    res.status(401).json({ error: 'Konto ist nicht verfügbar.' });
    return;
  }

  const nextRefreshToken = createRefreshToken(user.id, session.id);
  db.prepare(`
    UPDATE sessions SET refresh_token_hash = ?, expires_at = ? WHERE id = ?
  `).run(
    hashToken(nextRefreshToken),
    new Date(Date.now() + config.refreshTokenTtlMs).toISOString(),
    session.id
  );
  setRefreshCookie(res, nextRefreshToken);
  res.json({
    accessToken: createAccessToken(user, session.id),
    tokenType: 'Bearer',
    expiresIn: config.accessTokenTtl,
    user: publicUser(user)
  });
});

authRouter.post('/logout', (req, res) => {
  const token = req.cookies?.refreshToken || req.get('x-refresh-token');
  if (typeof token === 'string') {
    try {
      const claims = verifyRefreshToken(token);
      db.prepare(`
        UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ?
      `).run(new Date().toISOString(), claims.sid, claims.sub);
      realtime.disconnectSession(claims.sid);
    } catch (error) {
      if (error.name !== 'TokenExpiredError' && error.name !== 'JsonWebTokenError') {
        throw error;
      }
    }
  }
  clearRefreshCookie(res);
  res.status(204).end();
});

authRouter.post('/forgot-password', authLimiter, asyncRoute(async (req, res) => {
  const email = normalizeEmail(req.body.email);
  if (!isValidEmail(email)) {
    res.status(400).json({ error: 'Bitte gib eine gültige E-Mail-Adresse ein.' });
    return;
  }
  const user = db.prepare('SELECT id, email, username FROM users WHERE email = ? COLLATE NOCASE').get(email);
  if (user) {
    const rawToken = createOpaqueToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(user.id);
    db.prepare(`
      INSERT INTO password_reset_tokens (token_hash, user_id, expires_at)
      VALUES (?, ?, ?)
    `).run(hashToken(rawToken), user.id, expiresAt);
    const resetUrl = `${config.clientOrigin}/reset-password?token=${encodeURIComponent(rawToken)}`;
    try {
      await mailer.sendPasswordReset({ email: user.email, username: user.username, url: resetUrl });
    } catch (error) {
      db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(user.id);
      console.error('[E-Mail] Passwort-Reset-Link konnte nicht versendet werden:', error.message);
      res.status(503).json({ error: 'Der Link konnte gerade nicht versendet werden. Bitte versuche es später erneut.' });
      return;
    }
  }
  res.json({ message: 'Falls ein Konto zu dieser E-Mail-Adresse existiert, wurde ein Link zum Zurücksetzen versendet.' });
}));

authRouter.post('/reset-password', authLimiter, asyncRoute(async (req, res) => {
  const token = typeof req.body.token === 'string' ? req.body.token : '';
  const password = req.body.password;
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    res.status(400).json({ error: 'Das Passwort muss mindestens 8 und höchstens 128 Zeichen lang sein.' });
    return;
  }
  const record = db.prepare(`
    SELECT user_id, expires_at FROM password_reset_tokens WHERE token_hash = ?
  `).get(hashToken(token));
  if (!record || Date.parse(record.expires_at) <= Date.now()) {
    if (record) {
      db.prepare('DELETE FROM password_reset_tokens WHERE token_hash = ?').run(hashToken(token));
    }
    res.status(400).json({ error: 'Der Link zum Zurücksetzen ist ungültig oder abgelaufen.' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, config.bcryptRounds);
  const reset = db.transaction(() => {
    db.prepare(`
      UPDATE users
      SET password_hash = ?, auth_version = auth_version + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(passwordHash, record.user_id);
    db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(record.user_id);
    db.prepare(`
      UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL
    `).run(new Date().toISOString(), record.user_id);
  });
  reset();
  realtime.disconnectUser(record.user_id);
  res.json({ message: 'Passwort wurde geändert. Bitte melde dich erneut an.' });
}));

authRouter.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.auth.sub);
  if (!user) {
    res.status(404).json({ error: 'Konto nicht gefunden.' });
    return;
  }
  res.json({ user: publicUser(user) });
});

authRouter.patch('/me', requireAuth, asyncRoute(async (req, res) => {
  const current = db.prepare('SELECT * FROM users WHERE id = ?').get(req.auth.sub);
  if (!current) {
    res.status(404).json({ error: 'Konto nicht gefunden.' });
    return;
  }
  const username = req.body.username === undefined
    ? current.username
    : typeof req.body.username === 'string' ? req.body.username.trim().toLowerCase() : '';
  const age = req.body.age === undefined ? current.age : Number(req.body.age);
  if (!isValidUsername(username)) {
    res.status(400).json({ error: 'Der Benutzername muss 3–20 Zeichen lang sein und darf nur Buchstaben, Zahlen oder _ enthalten.' });
    return;
  }
  if (!Number.isInteger(age) || age < 13 || age > 120) {
    res.status(400).json({ error: 'Du musst mindestens 13 Jahre alt sein.' });
    return;
  }
  if (current.totp_enabled && username !== current.username) {
    const totpCode = typeof req.body.totpCode === 'string' ? req.body.totpCode.replace(/\s+/g, '') : '';
    if (!totpCode || !(await isValidTotpCode(totpCode, current.totp_secret))) {
      res.status(400).json({ error: '2FA-Sicherheitscode ist für eine Namensänderung erforderlich oder ungültig.' });
      return;
    }
  }

  if (username === current.username && age === current.age) {
    res.json({ user: publicUser(current) });
    return;
  }
  try {
    const challengeToken = await startEmailChallenge({
      user: current,
      purpose: 'profile_change',
      payload: { username, age },
      message: 'Es wurde angefordert, die Profildaten deines mingle-Kontos zu ändern.'
    });
    res.json({
      verificationRequired: true,
      challengeToken,
      message: 'Ein Sicherheitscode wurde per E-Mail gesendet. Gib ihn ein, um die Profiländerung abzuschließen.'
    });
  } catch (error) {
    console.error('[EmailJS] Code für Profiländerung konnte nicht versendet werden:', error.message);
    res.status(503).json({ error: 'Der Sicherheitscode konnte nicht versendet werden. Bitte versuche es erneut.' });
  }
}));

authRouter.post('/change-email', requireAuth, asyncRoute(async (req, res) => {
  const newEmail = normalizeEmail(req.body.newEmail);
  const password = req.body.password;
  if (!isValidEmail(newEmail)) {
    res.status(400).json({ error: 'Bitte gib eine gültige neue E-Mail-Adresse ein.' });
    return;
  }
  const user = db.prepare('SELECT id, email, username, password_hash, totp_enabled, totp_secret FROM users WHERE id = ?').get(req.auth.sub);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    res.status(401).json({ error: 'Das Passwort ist nicht korrekt.' });
    return;
  }
  if (user.totp_enabled) {
    const totpCode = typeof req.body.totpCode === 'string' ? req.body.totpCode.replace(/\s+/g, '') : '';
    if (!totpCode || !(await isValidTotpCode(totpCode, user.totp_secret))) {
      res.status(400).json({ error: '2FA-Sicherheitscode ist für eine E-Mail-Änderung erforderlich oder ungültig.' });
      return;
    }
  }
  if (newEmail.toLowerCase() === user.email.toLowerCase()) {
    res.status(400).json({ error: 'Die neue E-Mail-Adresse entspricht bereits deiner aktuellen Adresse.' });
    return;
  }
  if (db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').get(newEmail)) {
    res.status(409).json({ error: 'Diese E-Mail-Adresse wird bereits verwendet.' });
    return;
  }
  try {
    const challengeToken = await startEmailChallenge({
      user,
      purpose: 'change_email_old',
      payload: { oldEmail: user.email, newEmail },
      message: 'Gib diesen Code ein, um zu bestätigen, dass du Zugriff auf deine bisherige E-Mail-Adresse hast.'
    });
    res.json({
      challengeToken,
      step: 'old_email',
      message: 'Ein Bestätigungscode wurde an deine bisherige E-Mail-Adresse gesendet.'
    });
  } catch (error) {
    console.error('[EmailJS] E-Mail-Wechselcode konnte nicht versendet werden:', error.message);
    res.status(503).json({ error: 'Der Bestätigungscode konnte nicht versendet werden. Bitte versuche es später erneut.' });
  }
}));

authRouter.post('/change-password', requireAuth, asyncRoute(async (req, res) => {
  const currentPassword = req.body.currentPassword;
  const newPassword = req.body.newPassword;
  if (typeof currentPassword !== 'string') {
    res.status(400).json({ error: 'Bitte gib dein aktuelles Passwort ein.' });
    return;
  }
  if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 128) {
    res.status(400).json({ error: 'Das neue Passwort muss mindestens 8 und höchstens 128 Zeichen lang sein.' });
    return;
  }
  const user = db.prepare('SELECT id, password_hash, totp_enabled, totp_secret FROM users WHERE id = ?').get(req.auth.sub);
  if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) {
    res.status(401).json({ error: 'Das aktuelle Passwort ist nicht korrekt.' });
    return;
  }
  if (user.totp_enabled) {
    const totpCode = typeof req.body.totpCode === 'string' ? req.body.totpCode.replace(/\s+/g, '') : '';
    if (!totpCode || !(await isValidTotpCode(totpCode, user.totp_secret))) {
      res.status(400).json({ error: '2FA-Sicherheitscode ist für eine Passwortänderung erforderlich oder ungültig.' });
      return;
    }
  }
  const passwordHash = await bcrypt.hash(newPassword, config.bcryptRounds);
  const fullUser = db.prepare('SELECT id, email, username FROM users WHERE id = ?').get(user.id);
  try {
    const challengeToken = await startEmailChallenge({
      user: fullUser,
      purpose: 'password_change',
      payload: { passwordHash },
      message: 'Gib diesen Code ein, um die Passwortänderung abzuschließen.'
    });
    res.json({
      verificationRequired: true,
      challengeToken,
      message: 'Ein Sicherheitscode wurde per E-Mail gesendet. Gib ihn ein, um das neue Passwort zu speichern.'
    });
  } catch (error) {
    console.error('[EmailJS] Code für Passwortänderung konnte nicht versendet werden:', error.message);
    res.status(503).json({ error: 'Der Sicherheitscode konnte nicht versendet werden. Dein Passwort wurde nicht geändert.' });
  }
}));

authRouter.delete('/me', requireAuth, asyncRoute(async (req, res) => {
  if (typeof req.body.password !== 'string') {
    res.status(400).json({ error: 'Bitte bestätige die Kontolöschung mit deinem Passwort.' });
    return;
  }
  const user = db.prepare('SELECT id, email, username, password_hash FROM users WHERE id = ?').get(req.auth.sub);
  if (!user || !(await bcrypt.compare(req.body.password, user.password_hash))) {
    res.status(401).json({ error: 'Das Passwort ist nicht korrekt.' });
    return;
  }
  const challengeToken = await startEmailChallenge({
    user,
    purpose: 'delete_account',
    message: 'Es wurde angefordert, dein mingle-Konto dauerhaft zu löschen. Gib den Code nur ein, wenn du diese Löschung selbst gestartet hast.'
  });
  res.json({
    challengeToken,
    message: 'Ein Sicherheitscode wurde per E-Mail gesendet. Bestätige damit die Kontolöschung.'
  });
}));

app.use('/api/auth', authRouter);

// Discord-Like Status & Profil-Routen
const userRouter = express.Router();
userRouter.patch('/status', requireAuth, asyncRoute(async (req, res) => {
  const allowed = ['online', 'idle', 'dnd', 'offline'];
  const status = req.body.status;
  if (!allowed.includes(status)) {
    res.status(400).json({ error: 'Ungültiger Status. Erlaubt: online, idle, dnd, offline' });
    return;
  }
  const customStatus = typeof req.body.customStatus === 'string' ? req.body.customStatus.slice(0, 100) : null;
  db.prepare('UPDATE users SET status = ?, custom_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(status, customStatus, req.auth.sub);
  realtime.publishPresence(req.auth.sub, status !== 'offline');
  res.json({ status, customStatus });
}));

userRouter.patch('/profile', requireAuth, asyncRoute(async (req, res) => {
  if (req.body.about !== undefined && (typeof req.body.about !== 'string' || req.body.about.trim().length > 500)) {
    res.status(400).json({ error: 'Dein Beschreibungstext darf höchstens 500 Zeichen lang sein.' });
    return;
  }
  if (req.body.pronouns !== undefined && (typeof req.body.pronouns !== 'string' || req.body.pronouns.trim().length > 40)) {
    res.status(400).json({ error: 'Pronomen dürfen höchstens 40 Zeichen lang sein.' });
    return;
  }
  const avatarUrl = typeof req.body.avatarUrl === 'string' ? req.body.avatarUrl.trim().slice(0, 500) : null;
  const bannerUrl = typeof req.body.bannerUrl === 'string' ? req.body.bannerUrl.trim().slice(0, 500) : null;
  const about = typeof req.body.about === 'string' ? req.body.about.trim() : null;
  const pronouns = typeof req.body.pronouns === 'string' ? req.body.pronouns.trim() : null;
  db.prepare(`
    UPDATE users
    SET avatar_url = COALESCE(?, avatar_url),
        banner_url = COALESCE(?, banner_url),
        about = COALESCE(?, about),
        pronouns = COALESCE(?, pronouns),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(avatarUrl, bannerUrl, about, pronouns, req.auth.sub);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.auth.sub);
  res.json({ user: publicUser(user) });
}));
userRouter.post('/profile/media/:kind', requireAuth, (req, res, next) => {
  if (!['avatar', 'banner'].includes(req.params.kind)) {
    res.status(404).json({ error: 'Bildtyp nicht gefunden.' });
    return;
  }
  next();
}, imageUploadMiddleware, asyncRoute(async (req, res) => {
  if (!isValidImage(req.file)) {
    res.status(400).json({ error: 'Der Dateityp oder Dateiinhalt wird nicht unterstützt.' });
    return;
  }
  const current = db.prepare('SELECT avatar_url, banner_url FROM users WHERE id = ?').get(req.auth.sub);
  const image = saveImage(db, req.auth.sub, req.file);
  const column = req.params.kind === 'avatar' ? 'avatar_url' : 'banner_url';
  db.prepare(`UPDATE users SET ${column} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(image.url, req.auth.sub);
  deleteImageIfUnreferenced(db, current[column]);
  res.status(201).json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.auth.sub)) });
}));
app.use('/api/users', userRouter);

app.get('/api/media/:id', (req, res, next) => {
  const asset = db.prepare(`
    SELECT a.storage_name, a.mime_type
    FROM image_assets a
    WHERE a.id = ? AND (
      EXISTS (SELECT 1 FROM users u WHERE u.avatar_url = '/api/media/' || a.id OR u.banner_url = '/api/media/' || a.id)
      OR EXISTS (SELECT 1 FROM conversations c WHERE c.icon_url = '/api/media/' || a.id OR c.banner_url = '/api/media/' || a.id)
      OR EXISTS (SELECT 1 FROM servers s WHERE s.icon_url = '/api/media/' || a.id OR s.banner_url = '/api/media/' || a.id)
    )
  `).get(req.params.id);
  if (!asset) {
    res.status(404).json({ error: 'Bild nicht gefunden.' });
    return;
  }
  res.set({
    'Content-Type': asset.mime_type,
    'Content-Disposition': 'inline',
    'Cache-Control': 'public, max-age=3600, immutable',
    'X-Content-Type-Options': 'nosniff'
  }).sendFile(asset.storage_name, { root: path.join(config.attachmentPath, 'profile-media') }, (error) => {
    if (error && !res.headersSent) {
      if (error.code === 'ENOENT') res.status(404).end();
      else next(error);
    }
  });
});

// Admin & Moderation (Owner, Admin, Moderator)
const adminRouter = express.Router();
adminRouter.get('/users', requireAuth, asyncRoute(async (req, res) => {
  const current = db.prepare('SELECT role FROM users WHERE id = ?').get(req.auth.sub);
  if (!current || !['owner', 'admin'].includes(current.role)) {
    res.status(403).json({ error: 'Nur für Owner und Admins zugänglich.' });
    return;
  }
  const users = db.prepare(`
    SELECT id, email, username, role, status, custom_status, avatar_url, banner_url, is_banned, ban_reason, banned_at, created_at, last_seen_at
    FROM users
    ORDER BY CASE role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 WHEN 'moderator' THEN 3 WHEN 'staff' THEN 4 ELSE 5 END, username ASC
  `).all();
  res.json({ users });
}));

adminRouter.post('/users/:id/role', requireAuth, asyncRoute(async (req, res) => {
  const current = db.prepare('SELECT email, role FROM users WHERE id = ?').get(req.auth.sub);
  if (!current || !['owner', 'admin'].includes(current.role)) {
    res.status(403).json({ error: 'Keine Berechtigung zur Rollenverwaltung.' });
    return;
  }
  const target = db.prepare('SELECT email, role FROM users WHERE id = ?').get(req.params.id);
  if (!target) {
    res.status(404).json({ error: 'Benutzer nicht gefunden.' });
    return;
  }
  if (target.role === 'owner' || (config.ownerEmail && target.email.toLowerCase() === config.ownerEmail.toLowerCase())) {
    res.status(403).json({ error: 'Die Rolle des Owners kann nicht verändert werden!' });
    return;
  }
  const newRole = req.body.role;
  const allowed = current.role === 'owner' ? ['admin', 'moderator', 'staff', 'member'] : ['moderator', 'staff', 'member'];
  if (!allowed.includes(newRole)) {
    res.status(400).json({ error: `Ungültige Rolle. Erlaubt: ${allowed.join(', ')}` });
    return;
  }
  db.prepare('UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newRole, req.params.id);
  res.json({ message: `Rolle erfolgreich auf ${newRole} geändert.` });
}));

adminRouter.post('/users/:id/ban', requireAuth, asyncRoute(async (req, res) => {
  const current = db.prepare('SELECT email, role FROM users WHERE id = ?').get(req.auth.sub);
  if (!current || !['owner', 'admin', 'moderator'].includes(current.role)) {
    res.status(403).json({ error: 'Keine Berechtigung zum Bannen.' });
    return;
  }
  const target = db.prepare('SELECT email, role FROM users WHERE id = ?').get(req.params.id);
  if (!target) {
    res.status(404).json({ error: 'Benutzer nicht gefunden.' });
    return;
  }
  if (target.role === 'owner' || (config.ownerEmail && target.email.toLowerCase() === config.ownerEmail.toLowerCase())) {
    res.status(403).json({ error: 'Der Owner kann nicht gebannt werden!' });
    return;
  }
  const reason = req.body.reason || 'Verstoß gegen die Serverregeln';
  db.prepare('UPDATE users SET is_banned = 1, ban_reason = ?, banned_at = CURRENT_TIMESTAMP WHERE id = ?').run(reason, req.params.id);
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(new Date().toISOString(), req.params.id);
  realtime.disconnectUser(req.params.id);
  res.json({ message: 'Benutzer erfolgreich gebannt.' });
}));

adminRouter.post('/users/:id/unban', requireAuth, asyncRoute(async (req, res) => {
  const current = db.prepare('SELECT role FROM users WHERE id = ?').get(req.auth.sub);
  if (!current || !['owner', 'admin'].includes(current.role)) {
    res.status(403).json({ error: 'Keine Berechtigung zum Entbannen.' });
    return;
  }
  db.prepare('UPDATE users SET is_banned = 0, ban_reason = NULL, banned_at = NULL WHERE id = ?').run(req.params.id);
  res.json({ message: 'Benutzer erfolgreich entbannt.' });
}));
app.use('/api/admin', adminRouter);

// Discord Server & Channel Management
const serverRouter = express.Router();
const serverPermissionNames = new Set([
  'manage_server', 'manage_channels', 'manage_roles',
  'manage_invites', 'kick_members', 'send_messages', 'read_messages'
]);
const baseRolePermissions = {
  Owner: {
    manage_server: true, manage_channels: true, manage_roles: true,
    manage_invites: true, kick_members: true, send_messages: true, read_messages: true
  },
  Admin: {
    manage_server: true, manage_channels: true, manage_roles: true,
    manage_invites: true, kick_members: true, send_messages: true, read_messages: true
  },
  Member: { send_messages: true, read_messages: true }
};

function getServerMembership(serverId, userId) {
  return db.prepare(`
    SELECT sm.role, sr.id AS role_id, sr.name AS role_name, sr.permissions,
      s.owner_id
    FROM server_members sm
    JOIN servers s ON s.id = sm.server_id
    LEFT JOIN server_roles sr ON sr.id = sm.role_id
    WHERE sm.server_id = ? AND sm.user_id = ?
  `).get(serverId, userId);
}

function hasServerPermission(serverId, userId, permission) {
  const membership = getServerMembership(serverId, userId);
  if (!membership) return false;
  if (membership.owner_id === userId) return true;
  if (!membership.permissions) return false;
  const permissions = JSON.parse(membership.permissions);
  return permissions[permission] === true;
}

function createServerDefaultRoles(serverId) {
  const insertRole = db.prepare(`
    INSERT INTO server_roles (id, server_id, name, position, permissions, is_system)
    VALUES (?, ?, ?, ?, ?, 1)
  `);
  insertRole.run(`${serverId}:owner`, serverId, 'Owner', 100, JSON.stringify(baseRolePermissions.Owner));
  insertRole.run(`${serverId}:admin`, serverId, 'Admin', 90, JSON.stringify(baseRolePermissions.Admin));
  insertRole.run(`${serverId}:member`, serverId, 'Member', 0, JSON.stringify(baseRolePermissions.Member));
}

function requireServerPermission(req, res, serverId, permission) {
  if (hasServerPermission(serverId, req.auth.sub, permission)) return true;
  res.status(403).json({ error: 'Du hast keine Berechtigung für diese Server-Aktion.' });
  return false;
}

function updateServerChannelSocketAccess(serverId, userId, canReadMessages) {
  const channels = db.prepare('SELECT id FROM channels WHERE server_id = ?').all(serverId);
  for (const channel of channels) {
    if (canReadMessages) realtime.joinConversation(channel.id, [userId]);
    else realtime.removeFromConversation(channel.id, [userId]);
  }
}

serverRouter.get('/', requireAuth, asyncRoute(async (req, res) => {
  const servers = db.prepare(`
    SELECT s.id, s.name, s.icon_url, s.banner_url, s.owner_id, sm.role as my_role,
      sr.name AS my_role_name,
      (SELECT COUNT(*) FROM server_members members WHERE members.server_id = s.id) AS member_count
    FROM servers s
    JOIN server_members sm ON sm.server_id = s.id AND sm.user_id = ?
    LEFT JOIN server_roles sr ON sr.id = sm.role_id
    ORDER BY s.created_at ASC
  `).all(req.auth.sub);
  res.json({ servers });
}));

serverRouter.get('/invites/:code', asyncRoute(async (req, res) => {
  const invite = db.prepare(`
    SELECT i.code, i.expires_at, i.max_uses, i.use_count,
      s.id AS server_id, s.name, s.icon_url,
      (SELECT COUNT(*) FROM server_members sm WHERE sm.server_id = s.id) AS member_count
    FROM server_invites i
    JOIN servers s ON s.id = i.server_id
    WHERE i.code = ? AND i.revoked_at IS NULL
      AND (i.expires_at IS NULL OR i.expires_at > ?)
      AND (i.max_uses IS NULL OR i.use_count < i.max_uses)
  `).get(req.params.code, new Date().toISOString());
  if (!invite) {
    res.status(404).json({ error: 'Dieser Einladungslink ist ungültig oder abgelaufen.' });
    return;
  }
  res.json({
    invite: {
      code: invite.code,
      expiresAt: invite.expires_at,
      maxUses: invite.max_uses
    },
    server: {
      id: invite.server_id,
      name: invite.name,
      iconUrl: invite.icon_url,
      memberCount: invite.member_count
    }
  });
}));

serverRouter.post('/invites/:code/join', requireAuth, asyncRoute(async (req, res) => {
  const now = new Date().toISOString();
  const joinServer = db.transaction(() => {
    const existingInvite = db.prepare(`
      SELECT server_id FROM server_invites WHERE code = ?
    `).get(req.params.code);
    if (!existingInvite) return { error: 'Dieser Einladungslink ist ungültig oder abgelaufen.' };
    const alreadyMember = db.prepare(`
      SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?
    `).get(existingInvite.server_id, req.auth.sub);
    if (alreadyMember) return { serverId: existingInvite.server_id, alreadyMember: true, channels: [] };

    const invite = db.prepare(`
      SELECT server_id FROM server_invites
      WHERE code = ? AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)
        AND (max_uses IS NULL OR use_count < max_uses)
    `).get(req.params.code, now);
    if (!invite) return { error: 'Dieser Einladungslink ist ungültig oder abgelaufen.' };

    const memberRole = db.prepare(`
      SELECT id FROM server_roles WHERE server_id = ? AND name = 'Member'
    `).get(invite.server_id);
    if (!memberRole) throw new Error('Die Standardrolle dieses Servers fehlt.');
    const updateInvite = db.prepare(`
      UPDATE server_invites SET use_count = use_count + 1
      WHERE code = ? AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)
        AND (max_uses IS NULL OR use_count < max_uses)
    `).run(req.params.code, now);
    if (updateInvite.changes !== 1) return { error: 'Dieser Einladungslink ist ungültig oder abgelaufen.' };
    db.prepare(`
      INSERT INTO server_members (server_id, user_id, role, role_id)
      VALUES (?, ?, 'member', ?)
    `).run(invite.server_id, req.auth.sub, memberRole.id);
    const channels = db.prepare('SELECT id FROM channels WHERE server_id = ?').all(invite.server_id);
    const addToChannel = db.prepare(`
      INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role)
      VALUES (?, ?, 'member')
    `);
    for (const channel of channels) addToChannel.run(channel.id, req.auth.sub);
    return { serverId: invite.server_id, alreadyMember: false, channels };
  });
  const result = joinServer();
  if (result.error) {
    res.status(404).json({ error: result.error });
    return;
  }
  if (!result.alreadyMember) {
    for (const channel of result.channels) realtime.joinConversation(channel.id, [req.auth.sub]);
    realtime.notifyUser(req.auth.sub, 'server:joined', { serverId: result.serverId });
  }
  res.status(result.alreadyMember ? 200 : 201).json({
    serverId: result.serverId,
    alreadyMember: result.alreadyMember
  });
}));

serverRouter.post('/', requireAuth, asyncRoute(async (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!name || name.length < 2 || name.length > 50) {
    res.status(400).json({ error: 'Servername muss 2–50 Zeichen lang sein.' });
    return;
  }
  const iconUrl = typeof req.body.iconUrl === 'string' ? req.body.iconUrl.trim() : null;
  const serverId = crypto.randomUUID();
  const channelId = crypto.randomUUID();
  const inviteCode = crypto.randomBytes(12).toString('base64url');
  db.transaction(() => {
    db.prepare('INSERT INTO servers (id, name, icon_url, owner_id) VALUES (?, ?, ?, ?)').run(serverId, name, iconUrl, req.auth.sub);
    createServerDefaultRoles(serverId);
    db.prepare("INSERT INTO server_members (server_id, user_id, role, role_id) VALUES (?, ?, 'owner', ?)").run(serverId, req.auth.sub, `${serverId}:owner`);
    db.prepare(`
      INSERT INTO server_invites (code, server_id, created_by) VALUES (?, ?, ?)
    `).run(inviteCode, serverId, req.auth.sub);
    db.prepare("INSERT INTO channels (id, server_id, name, type) VALUES (?, ?, 'allgemein', 'text')").run(channelId, serverId);
    db.prepare("INSERT INTO conversations (id, type, name, created_by) VALUES (?, 'group', ?, ?)").run(channelId, `#allgemein`, req.auth.sub);
    db.prepare("INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, 'admin')").run(channelId, req.auth.sub);
  })();
  res.status(201).json({
    id: serverId,
    name,
    iconUrl,
    defaultChannelId: channelId,
    inviteUrl: `${config.appUrl}/invite/${inviteCode}`
  });
}));

serverRouter.patch('/:id', requireAuth, asyncRoute(async (req, res) => {
  if (!requireServerPermission(req, res, req.params.id, 'manage_server')) return;
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (name.length < 2 || name.length > 50) {
    res.status(400).json({ error: 'Servername muss 2–50 Zeichen lang sein.' });
    return;
  }
  db.prepare('UPDATE servers SET name = ? WHERE id = ?').run(name, req.params.id);
  const server = db.prepare('SELECT id, name, icon_url, banner_url, owner_id FROM servers WHERE id = ?').get(req.params.id);
  res.json({ server });
}));

serverRouter.post('/:id/media/:kind', requireAuth, (req, res, next) => {
  if (!['icon', 'banner'].includes(req.params.kind)) {
    res.status(404).json({ error: 'Bildtyp nicht gefunden.' });
    return;
  }
  if (!requireServerPermission(req, res, req.params.id, 'manage_server')) return;
  next();
}, imageUploadMiddleware, asyncRoute(async (req, res) => {
  if (!isValidImage(req.file)) {
    res.status(400).json({ error: 'Der Dateityp oder Dateiinhalt wird nicht unterstützt.' });
    return;
  }
  const server = db.prepare('SELECT icon_url, banner_url FROM servers WHERE id = ?').get(req.params.id);
  if (!server) {
    res.status(404).json({ error: 'Server nicht gefunden.' });
    return;
  }
  const image = saveImage(db, req.auth.sub, req.file);
  const column = req.params.kind === 'icon' ? 'icon_url' : 'banner_url';
  db.prepare(`UPDATE servers SET ${column} = ? WHERE id = ?`).run(image.url, req.params.id);
  deleteImageIfUnreferenced(db, server[column]);
  res.status(201).json({
    server: db.prepare('SELECT id, name, icon_url, banner_url, owner_id FROM servers WHERE id = ?').get(req.params.id)
  });
}));

serverRouter.get('/notifications/unread', requireAuth, asyncRoute(async (req, res) => {
  const channels = db.prepare(`
    SELECT c.id, c.server_id, c.name, s.name AS server_name,
      (SELECT COUNT(*) FROM messages m
        WHERE m.conversation_id = c.id AND m.sender_id <> ? AND m.deleted_at IS NULL
          AND (mine.last_read_at IS NULL OR m.created_at > mine.last_read_at)
          AND NOT EXISTS (
            SELECT 1 FROM message_deletions md
            WHERE md.message_id = m.id AND md.user_id = ?
          )) AS unread_count,
      (SELECT CASE WHEN m.body <> '' THEN m.body
        ELSE COALESCE((SELECT '📎 ' || a.original_name
          FROM message_attachments a WHERE a.message_id = m.id), '')
        END FROM messages m
        WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM message_deletions md
            WHERE md.message_id = m.id AND md.user_id = ?
          )
        ORDER BY m.created_at DESC LIMIT 1) AS last_message,
      (SELECT m.created_at FROM messages m
        WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM message_deletions md
            WHERE md.message_id = m.id AND md.user_id = ?
          )
        ORDER BY m.created_at DESC LIMIT 1) AS last_message_at
    FROM channels c
    JOIN servers s ON s.id = c.server_id
    JOIN server_members sm ON sm.server_id = s.id AND sm.user_id = ?
    LEFT JOIN server_roles sr ON sr.id = sm.role_id
    JOIN conversation_members mine ON mine.conversation_id = c.id AND mine.user_id = ?
    WHERE (s.owner_id = ? OR COALESCE(json_extract(sr.permissions, '$.read_messages'), 0) = 1)
      AND EXISTS (
        SELECT 1 FROM messages m
        WHERE m.conversation_id = c.id AND m.sender_id <> ? AND m.deleted_at IS NULL
          AND (mine.last_read_at IS NULL OR m.created_at > mine.last_read_at)
          AND NOT EXISTS (
            SELECT 1 FROM message_deletions md
            WHERE md.message_id = m.id AND md.user_id = ?
          )
      )
    ORDER BY COALESCE(last_message_at, c.created_at) DESC
  `).all(
    req.auth.sub, req.auth.sub, req.auth.sub, req.auth.sub,
    req.auth.sub, req.auth.sub, req.auth.sub, req.auth.sub, req.auth.sub
  );
  res.json({
    channels: channels.map((channel) => ({
      id: channel.id,
      serverId: channel.server_id,
      serverName: channel.server_name,
      name: channel.name,
      unreadCount: channel.unread_count,
      lastMessage: channel.last_message,
      lastMessageAt: channel.last_message_at
    }))
  });
}));

serverRouter.get('/:id', requireAuth, asyncRoute(async (req, res) => {
  const membership = getServerMembership(req.params.id, req.auth.sub);
  if (!membership) {
    res.status(404).json({ error: 'Server nicht gefunden oder du bist kein Mitglied.' });
    return;
  }
  const server = db.prepare(`
    SELECT s.id, s.name, s.icon_url, s.banner_url, s.owner_id,
      (SELECT COUNT(*) FROM server_members sm WHERE sm.server_id = s.id) AS member_count
    FROM servers s WHERE s.id = ?
  `).get(req.params.id);
  const channels = db.prepare(`
    SELECT c.id, c.name, c.topic, c.type, c.position,
      (SELECT COUNT(*) FROM messages m
        WHERE m.conversation_id = c.id AND m.sender_id <> ? AND m.deleted_at IS NULL
          AND (mine.last_read_at IS NULL OR m.created_at > mine.last_read_at)
          AND NOT EXISTS (
            SELECT 1 FROM message_deletions md
            WHERE md.message_id = m.id AND md.user_id = ?
          )) AS unread_count
    FROM channels c
    JOIN conversation_members mine ON mine.conversation_id = c.id AND mine.user_id = ?
    WHERE c.server_id = ? ORDER BY c.position ASC, c.created_at ASC
  `).all(req.auth.sub, req.auth.sub, req.auth.sub, req.params.id);
  const readableChannels = hasServerPermission(req.params.id, req.auth.sub, 'read_messages')
    ? channels.map((channel) => ({
      id: channel.id,
      name: channel.name,
      topic: channel.topic,
      type: channel.type,
      position: channel.position,
      unreadCount: channel.unread_count
    }))
    : [];
  res.json({
    server: {
      ...server,
      memberCount: server.member_count,
      myRoleId: membership.role_id,
      myRole: membership.role_name || membership.role,
      myPermissions: membership.permissions ? JSON.parse(membership.permissions) : {}
    },
    channels: readableChannels
  });
}));

serverRouter.get('/:id/members', requireAuth, asyncRoute(async (req, res) => {
  if (!getServerMembership(req.params.id, req.auth.sub)) {
    res.status(404).json({ error: 'Server nicht gefunden oder du bist kein Mitglied.' });
    return;
  }
  const members = db.prepare(`
    SELECT u.id, u.username, u.avatar_url, sm.joined_at,
      sr.id AS role_id, sr.name AS role_name, sr.color, sr.position
    FROM server_members sm
    JOIN users u ON u.id = sm.user_id
    LEFT JOIN server_roles sr ON sr.id = sm.role_id
    WHERE sm.server_id = ?
    ORDER BY COALESCE(sr.position, 0) DESC, u.username COLLATE NOCASE
  `).all(req.params.id).map((member) => ({
    ...member,
    online: realtime.isOnline(member.id)
  }));
  res.json({ members });
}));

serverRouter.get('/:id/roles', requireAuth, asyncRoute(async (req, res) => {
  if (!getServerMembership(req.params.id, req.auth.sub)) {
    res.status(404).json({ error: 'Server nicht gefunden oder du bist kein Mitglied.' });
    return;
  }
  const roles = db.prepare(`
    SELECT id, name, color, position, permissions, is_system
    FROM server_roles WHERE server_id = ? ORDER BY position DESC, name COLLATE NOCASE
  `).all(req.params.id).map((role) => ({
    ...role,
    permissions: JSON.parse(role.permissions),
    isSystem: Boolean(role.is_system)
  }));
  res.json({ roles });
}));

serverRouter.post('/:id/roles', requireAuth, asyncRoute(async (req, res) => {
  if (!requireServerPermission(req, res, req.params.id, 'manage_roles')) return;
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const color = typeof req.body.color === 'string' && /^#[\da-fA-F]{6}$/.test(req.body.color)
    ? req.body.color
    : '#818cf8';
  const permissions = req.body.permissions;
  if (name.length < 2 || name.length > 32) {
    res.status(400).json({ error: 'Der Rollenname muss 2 bis 32 Zeichen lang sein.' });
    return;
  }
  if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)
    || Object.keys(permissions).some((key) => !serverPermissionNames.has(key))
    || Object.values(permissions).some((value) => typeof value !== 'boolean')) {
    res.status(400).json({ error: 'Die Rollenberechtigungen sind ungültig.' });
    return;
  }
  const id = crypto.randomUUID();
  const position = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS next FROM server_roles WHERE server_id = ?')
    .get(req.params.id).next;
  try {
    db.prepare(`
      INSERT INTO server_roles (id, server_id, name, color, position, permissions)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, req.params.id, name, color, position, JSON.stringify(permissions));
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(409).json({ error: 'Eine Rolle mit diesem Namen existiert bereits.' });
      return;
    }
    throw error;
  }
  res.status(201).json({ role: { id, name, color, position, permissions, isSystem: false } });
}));

serverRouter.patch('/:id/roles/:roleId', requireAuth, asyncRoute(async (req, res) => {
  if (!requireServerPermission(req, res, req.params.id, 'manage_roles')) return;
  const role = db.prepare(`
    SELECT id, name, color, position, permissions, is_system
    FROM server_roles WHERE id = ? AND server_id = ?
  `).get(req.params.roleId, req.params.id);
  if (!role) {
    res.status(404).json({ error: 'Serverrolle nicht gefunden.' });
    return;
  }
  if (role.is_system) {
    res.status(403).json({ error: 'Die integrierten Serverrollen können nicht bearbeitet werden.' });
    return;
  }
  const name = req.body.name === undefined ? role.name : (typeof req.body.name === 'string' ? req.body.name.trim() : '');
  const color = req.body.color === undefined ? role.color : req.body.color;
  const permissions = req.body.permissions === undefined ? JSON.parse(role.permissions) : req.body.permissions;
  if (name.length < 2 || name.length > 32 || typeof color !== 'string' || !/^#[\da-fA-F]{6}$/.test(color)) {
    res.status(400).json({ error: 'Rollenname oder Rollenfarbe ist ungültig.' });
    return;
  }
  if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)
    || Object.keys(permissions).some((key) => !serverPermissionNames.has(key))
    || Object.values(permissions).some((value) => typeof value !== 'boolean')) {
    res.status(400).json({ error: 'Die Rollenberechtigungen sind ungültig.' });
    return;
  }
  const affectedMembers = db.prepare(`
    SELECT user_id FROM server_members WHERE server_id = ? AND role_id = ?
  `).all(req.params.id, role.id).map((member) => member.user_id);
  try {
    db.prepare(`
      UPDATE server_roles SET name = ?, color = ?, permissions = ?
      WHERE id = ? AND server_id = ?
    `).run(name, color, JSON.stringify(permissions), role.id, req.params.id);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(409).json({ error: 'Eine Rolle mit diesem Namen existiert bereits.' });
      return;
    }
    throw error;
  }
  for (const userId of affectedMembers) {
    updateServerChannelSocketAccess(req.params.id, userId, permissions.read_messages === true);
    realtime.notifyUser(userId, 'server:role-updated', { serverId: req.params.id });
  }
  res.json({ role: { ...role, name, color, permissions, isSystem: false } });
}));

serverRouter.delete('/:id/roles/:roleId', requireAuth, asyncRoute(async (req, res) => {
  if (!requireServerPermission(req, res, req.params.id, 'manage_roles')) return;
  const role = db.prepare(`
    SELECT id, is_system FROM server_roles WHERE id = ? AND server_id = ?
  `).get(req.params.roleId, req.params.id);
  if (!role) {
    res.status(404).json({ error: 'Serverrolle nicht gefunden.' });
    return;
  }
  if (role.is_system) {
    res.status(403).json({ error: 'Integrierte Rollen können nicht gelöscht werden.' });
    return;
  }
  const deleteRole = db.transaction(() => {
    const userIds = db.prepare(`
      SELECT user_id FROM server_members WHERE server_id = ? AND role_id = ?
    `).all(req.params.id, role.id).map((member) => member.user_id);
    db.prepare(`
      UPDATE server_members
      SET role = 'member', role_id = ?
      WHERE server_id = ? AND role_id = ?
    `).run(`${req.params.id}:member`, req.params.id, role.id);
    db.prepare('DELETE FROM server_roles WHERE id = ?').run(role.id);
    return userIds;
  });
  const userIds = deleteRole();
  for (const userId of userIds) {
    updateServerChannelSocketAccess(req.params.id, userId, true);
    realtime.notifyUser(userId, 'server:role-updated', { serverId: req.params.id });
  }
  res.status(204).end();
}));

serverRouter.patch('/:id/members/:userId/role', requireAuth, asyncRoute(async (req, res) => {
  if (!requireServerPermission(req, res, req.params.id, 'manage_roles')) return;
  const member = db.prepare(`
    SELECT role FROM server_members WHERE server_id = ? AND user_id = ?
  `).get(req.params.id, req.params.userId);
  if (!member) {
    res.status(404).json({ error: 'Servermitglied nicht gefunden.' });
    return;
  }
  if (member.role === 'owner' || req.params.userId === req.auth.sub && member.role === 'owner') {
    res.status(403).json({ error: 'Die Owner-Rolle kann nicht geändert werden.' });
    return;
  }
  const role = db.prepare(`
    SELECT id, name FROM server_roles WHERE id = ? AND server_id = ?
  `).get(req.body.roleId, req.params.id);
  if (!role) {
    res.status(400).json({ error: 'Wähle eine Rolle aus diesem Server aus.' });
    return;
  }
  if (role.name === 'Owner') {
    res.status(403).json({ error: 'Die Owner-Rolle kann nicht zugewiesen werden.' });
    return;
  }
  db.prepare(`
    UPDATE server_members SET role = ?, role_id = ?
    WHERE server_id = ? AND user_id = ?
  `).run(role.name.toLowerCase(), role.id, req.params.id, req.params.userId);
  updateServerChannelSocketAccess(
    req.params.id,
    req.params.userId,
    JSON.parse(db.prepare('SELECT permissions FROM server_roles WHERE id = ?').get(role.id).permissions).read_messages === true
  );
  realtime.notifyUser(req.params.userId, 'server:role-updated', { serverId: req.params.id });
  res.json({ userId: req.params.userId, role });
}));

serverRouter.delete('/:id/members/:userId', requireAuth, asyncRoute(async (req, res) => {
  if (!requireServerPermission(req, res, req.params.id, 'kick_members')) return;
  const member = db.prepare(`
    SELECT role FROM server_members WHERE server_id = ? AND user_id = ?
  `).get(req.params.id, req.params.userId);
  if (!member) {
    res.status(404).json({ error: 'Servermitglied nicht gefunden.' });
    return;
  }
  if (member.role === 'owner' || req.params.userId === req.auth.sub) {
    res.status(403).json({ error: 'Der Owner kann sich nicht selbst entfernen.' });
    return;
  }
  const removeMember = db.transaction(() => {
    const channels = db.prepare('SELECT id FROM channels WHERE server_id = ?').all(req.params.id);
    db.prepare('DELETE FROM server_members WHERE server_id = ? AND user_id = ?').run(req.params.id, req.params.userId);
    db.prepare(`
      DELETE FROM conversation_members
      WHERE user_id = ? AND conversation_id IN (SELECT id FROM channels WHERE server_id = ?)
    `).run(req.params.userId, req.params.id);
    return channels;
  });
  const channels = removeMember();
  for (const channel of channels) realtime.removeFromConversation(channel.id, [req.params.userId]);
  realtime.notifyUser(req.params.userId, 'server:removed', { serverId: req.params.id });
  res.status(204).end();
}));

serverRouter.post('/:id/leave', requireAuth, asyncRoute(async (req, res) => {
  const member = db.prepare(`
    SELECT role FROM server_members WHERE server_id = ? AND user_id = ?
  `).get(req.params.id, req.auth.sub);
  if (!member) {
    res.status(404).json({ error: 'Servermitgliedschaft nicht gefunden.' });
    return;
  }
  if (member.role === 'owner') {
    res.status(409).json({ error: 'Der Owner kann den Server nicht verlassen. Lösche den Server oder übertrage zuerst den Besitz.' });
    return;
  }
  const leaveServer = db.transaction(() => {
    const channels = db.prepare('SELECT id FROM channels WHERE server_id = ?').all(req.params.id);
    db.prepare('DELETE FROM server_members WHERE server_id = ? AND user_id = ?').run(req.params.id, req.auth.sub);
    db.prepare(`
      DELETE FROM conversation_members
      WHERE user_id = ? AND conversation_id IN (SELECT id FROM channels WHERE server_id = ?)
    `).run(req.auth.sub, req.params.id);
    return channels;
  });
  const channels = leaveServer();
  for (const channel of channels) realtime.removeFromConversation(channel.id, [req.auth.sub]);
  res.status(204).end();
}));

serverRouter.delete('/:id', requireAuth, asyncRoute(async (req, res) => {
  const server = db.prepare('SELECT owner_id FROM servers WHERE id = ?').get(req.params.id);
  if (!server) {
    res.status(404).json({ error: 'Server nicht gefunden.' });
    return;
  }
  if (server.owner_id !== req.auth.sub) {
    res.status(403).json({ error: 'Nur der Server-Owner kann den Server löschen.' });
    return;
  }
  const deleteServer = db.transaction(() => {
    db.prepare(`
      DELETE FROM conversations
      WHERE id IN (SELECT id FROM channels WHERE server_id = ?)
    `).run(req.params.id);
    db.prepare('DELETE FROM servers WHERE id = ?').run(req.params.id);
  });
  deleteServer();
  res.status(204).end();
}));

serverRouter.get('/:id/invite', requireAuth, asyncRoute(async (req, res) => {
  if (!requireServerPermission(req, res, req.params.id, 'manage_invites')) return;
  const invite = db.prepare(`
    SELECT code, expires_at, max_uses, use_count
    FROM server_invites WHERE server_id = ? AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > ?)
      AND (max_uses IS NULL OR use_count < max_uses)
    ORDER BY created_at DESC LIMIT 1
  `).get(req.params.id, new Date().toISOString());
  res.json({
    invite: invite
      ? {
          code: invite.code,
          url: `${config.appUrl}/invite/${invite.code}`,
          expiresAt: invite.expires_at,
          maxUses: invite.max_uses,
          useCount: invite.use_count
        }
      : null
  });
}));

serverRouter.post('/:id/invite', requireAuth, asyncRoute(async (req, res) => {
  if (!requireServerPermission(req, res, req.params.id, 'manage_invites')) return;
  const expirationHours = req.body.expiresInHours === undefined ? null : req.body.expiresInHours;
  const maxUses = req.body.maxUses === undefined ? null : req.body.maxUses;
  if (expirationHours !== null && ![1, 24, 168, 720].includes(expirationHours)) {
    res.status(400).json({ error: 'Die Ablaufzeit muss 1, 24, 168 oder 720 Stunden betragen.' });
    return;
  }
  if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 10000)) {
    res.status(400).json({ error: 'Das Nutzungslimit muss zwischen 1 und 10000 liegen.' });
    return;
  }
  const code = crypto.randomBytes(12).toString('base64url');
  const expiresAt = expirationHours === null
    ? null
    : new Date(Date.now() + expirationHours * 60 * 60 * 1000).toISOString();
  db.transaction(() => {
    db.prepare(`
      UPDATE server_invites SET revoked_at = ? WHERE server_id = ? AND revoked_at IS NULL
    `).run(new Date().toISOString(), req.params.id);
    db.prepare(`
      INSERT INTO server_invites (code, server_id, created_by, expires_at, max_uses)
      VALUES (?, ?, ?, ?, ?)
    `).run(code, req.params.id, req.auth.sub, expiresAt, maxUses);
  })();
  res.status(201).json({
    invite: { code, url: `${config.appUrl}/invite/${code}`, expiresAt, maxUses, useCount: 0 }
  });
}));

serverRouter.delete('/:id/invite', requireAuth, asyncRoute(async (req, res) => {
  if (!requireServerPermission(req, res, req.params.id, 'manage_invites')) return;
  db.prepare(`
    UPDATE server_invites SET revoked_at = ?
    WHERE server_id = ? AND revoked_at IS NULL
  `).run(new Date().toISOString(), req.params.id);
  res.status(204).end();
}));

serverRouter.get('/:id/channels', requireAuth, asyncRoute(async (req, res) => {
  const isMember = db.prepare('SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?').get(req.params.id, req.auth.sub);
  if (!isMember) {
    res.status(403).json({ error: 'Kein Mitglied dieses Servers.' });
    return;
  }
  const channels = db.prepare('SELECT * FROM channels WHERE server_id = ? ORDER BY position ASC, created_at ASC').all(req.params.id)
    .filter(() => hasServerPermission(req.params.id, req.auth.sub, 'read_messages'));
  res.json({ channels });
}));

serverRouter.post('/:id/channels', requireAuth, asyncRoute(async (req, res) => {
  if (!requireServerPermission(req, res, req.params.id, 'manage_channels')) return;
  const name = typeof req.body.name === 'string' ? req.body.name.trim().toLowerCase().replace(/\s+/g, '-') : '';
  if (!name || name.length < 2 || name.length > 40) {
    res.status(400).json({ error: 'Kanalname muss 2–40 Zeichen lang sein.' });
    return;
  }
  const channelId = crypto.randomUUID();
  db.transaction(() => {
    db.prepare('INSERT INTO channels (id, server_id, name, topic) VALUES (?, ?, ?, ?)').run(channelId, req.params.id, name, req.body.topic || null);
    db.prepare("INSERT INTO conversations (id, type, name, created_by) VALUES (?, 'group', ?, ?)").run(channelId, `#${name}`, req.auth.sub);
    const members = db.prepare('SELECT user_id, role FROM server_members WHERE server_id = ?').all(req.params.id);
    const insertMember = db.prepare("INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, ?)");
    for (const m of members) {
      insertMember.run(channelId, m.user_id, m.role === 'owner' ? 'admin' : 'member');
    }
  })();
  res.status(201).json({ id: channelId, name, serverId: req.params.id });
}));
app.use('/api/servers', serverRouter);
app.use('/api', createChatRouter({ db, requireAuth, realtime }));

function getLatestReleaseInfo() {
  const fs = require('node:fs');
  const releaseDir = path.join(__dirname, '../../release');
  let version = '1.0.0';
  let fileName = 'Mingle-Setup-1.0.0.exe';
  let filePath = path.join(releaseDir, fileName);
  let fileSizeMb = 112;
  let releaseDate = new Date().toISOString();

  if (fs.existsSync(releaseDir)) {
    const latestYmlPath = path.join(releaseDir, 'latest.yml');
    if (fs.existsSync(latestYmlPath)) {
      try {
        const ymlContent = fs.readFileSync(latestYmlPath, 'utf8');
        const vMatch = ymlContent.match(/^version:\s*['"]?([0-9.]+)/m);
        const pMatch = ymlContent.match(/^path:\s*['"]?([^'"\r\n]+)/m);
        const dMatch = ymlContent.match(/^releaseDate:\s*['"]?([^'"\r\n]+)/m);
        if (vMatch) version = vMatch[1];
        if (pMatch) fileName = pMatch[1];
        if (dMatch) releaseDate = dMatch[1];
        const candidate = path.join(releaseDir, fileName);
        if (fs.existsSync(candidate)) {
          filePath = candidate;
          fileSizeMb = +(fs.statSync(candidate).size / (1024 * 1024)).toFixed(1);
          return { exists: true, version, fileName, filePath, fileSizeMb, releaseDate };
        }
      } catch {}
    }

    try {
      const files = fs.readdirSync(releaseDir)
        .filter((f) => f.startsWith('Mingle-Setup-') && f.endsWith('.exe'))
        .map((f) => ({
          name: f,
          path: path.join(releaseDir, f),
          stat: fs.statSync(path.join(releaseDir, f))
        }))
        .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

      if (files.length > 0) {
        const newest = files[0];
        const vMatch = newest.name.match(/Mingle-Setup-([0-9.]+)\.exe/i);
        if (vMatch) version = vMatch[1];
        return {
          exists: true,
          version,
          fileName: newest.name,
          filePath: newest.path,
          fileSizeMb: +(newest.stat.size / (1024 * 1024)).toFixed(1),
          releaseDate: newest.stat.mtime.toISOString()
        };
      }
    } catch {}
  }

  return { exists: false, version, fileName, filePath, fileSizeMb, releaseDate };
}

// Auto-Update Endpunkt für die Desktop-App (electron-updater)
app.use('/update', express.static(path.join(__dirname, '../../release')));

// API-Endpunkt für Release-Metadaten (Version, Setup-Dateiname, Größe)
app.get('/api/release/info', (req, res) => {
  const info = getLatestReleaseInfo();
  res.json({
    version: info.version,
    fileName: info.fileName,
    fileSizeMb: info.fileSizeMb,
    releaseDate: info.releaseDate,
    downloadUrl: '/download',
    ready: info.exists
  });
});

// Download-Endpunkt für Windows: Liefert immer automatisch die neueste Setup.exe aus
app.get(['/download', '/download/windows', '/api/download/windows'], (req, res) => {
  const info = getLatestReleaseInfo();
  if (info.exists) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return res.download(info.filePath, info.fileName);
  }
  res.redirect('https://github.com/timrex011/mingle-messenger/releases');
});

if (config.serveClient) {
  app.use(express.static(path.join(__dirname, '../../client/dist'), {
    index: false,
    maxAge: '1y',
    immutable: true
  }));
}

app.use((req, res) => {
  const isApiRequest = req.path === '/api' || req.path.startsWith('/api/') || req.path.startsWith('/socket.io');
  if (config.serveClient && req.method === 'GET' && !isApiRequest) {
    res.sendFile(path.join(__dirname, '../../client/dist/index.html'));
    return;
  }
  res.status(404).json({ error: 'Endpunkt nicht gefunden.' });
});

app.use((error, req, res, next) => {
  console.error('[HTTP-Fehler]', error);
  if (res.headersSent) {
    next(error);
    return;
  }
  if (error.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Ungültiges JSON im Request-Body.' });
    return;
  }
  if (error.message === 'Origin is not allowed by CORS.') {
    res.status(403).json({ error: 'Diese Herkunft ist nicht zugelassen.' });
    return;
  }
  res.status(500).json({ error: 'Interner Serverfehler.' });
});

module.exports = app;
