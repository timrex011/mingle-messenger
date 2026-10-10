const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const db = require('./db');
const config = require('./config');
const { sendAccountLink } = require('./mailer');
const realtime = require('./realtime');
const { createChatRouter } = require('./chat');
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

function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    age: row.age,
    emailVerified: Boolean(row.email_verified),
    avatarUrl: row.avatar_url,
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
    const user = db.prepare('SELECT auth_version, email_verified FROM users WHERE id = ?').get(req.auth.sub);
    const session = user && db.prepare(`
      SELECT 1 FROM sessions
      WHERE id = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > ?
    `).get(req.auth.sid, req.auth.sub, new Date().toISOString());
    if (!user || !user.email_verified || req.auth.ver !== user.auth_version || !session) {
      res.status(401).json({ error: 'Sitzung abgelaufen oder ungültig.' });
      return;
    }
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

  const id = crypto.randomUUID();
  const passwordHash = await bcrypt.hash(password, config.bcryptRounds);
  const rawToken = createOpaqueToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const createUser = db.transaction(() => {
    db.prepare(`
      INSERT INTO users (id, email, username, password_hash, age, email_verified)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, email, username, passwordHash, age, (config.isDesktop || config.autoVerifyEmail) ? 1 : 0);
    if (!config.isDesktop && !config.autoVerifyEmail) {
      db.prepare(`
        INSERT INTO email_verification_tokens (token_hash, user_id, expires_at)
        VALUES (?, ?, ?)
      `).run(tokenHash, id, expiresAt);
    }
  });

  try {
    createUser();
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(409).json({ error: 'E-Mail-Adresse oder Benutzername ist bereits vergeben.' });
      return;
    }
    throw error;
  }

  if (!config.isDesktop && !config.autoVerifyEmail) {
    const verificationUrl = `${config.clientOrigin}/verify-email?token=${encodeURIComponent(rawToken)}`;
    try {
      await sendAccountLink({
        email,
        label: 'E-Mail-Adresse bestätigen',
        url: verificationUrl
      });
    } catch (error) {
      db.transaction(() => {
        db.prepare('DELETE FROM email_verification_tokens WHERE user_id = ?').run(id);
        db.prepare('DELETE FROM users WHERE id = ? AND email_verified = 0').run(id);
      })();
      console.error('[E-Mail] Bestätigungslink konnte nicht versendet werden:', error.message);
      res.status(503).json({ error: 'Die Bestätigungs-E-Mail konnte gerade nicht versendet werden. Bitte versuche es später erneut.' });
      return;
    }
  }
  res.status(201).json({
    message: (config.isDesktop || config.autoVerifyEmail)
      ? 'Konto erstellt. Du kannst dich jetzt anmelden.'
      : 'Konto erstellt. Bitte bestätige deine E-Mail-Adresse über den zugesandten Link.'
  });
}));

authRouter.post('/resend-verification', authLimiter, asyncRoute(async (req, res) => {
  const email = normalizeEmail(req.body.email);
  if (!isValidEmail(email)) {
    res.status(400).json({ error: 'Bitte gib eine gültige E-Mail-Adresse ein.' });
    return;
  }
  const user = db.prepare('SELECT id, email, email_verified FROM users WHERE email = ?').get(email);
  if (user && !user.email_verified) {
    const rawToken = createOpaqueToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const replaceToken = db.transaction(() => {
      db.prepare('DELETE FROM email_verification_tokens WHERE user_id = ?').run(user.id);
      db.prepare(`
        INSERT INTO email_verification_tokens (token_hash, user_id, expires_at)
        VALUES (?, ?, ?)
      `).run(tokenHash, user.id, expiresAt);
    });
    replaceToken();
    const verificationUrl = `${config.clientOrigin}/verify-email?token=${encodeURIComponent(rawToken)}`;
    try {
      await sendAccountLink({ email: user.email, label: 'E-Mail-Adresse bestätigen', url: verificationUrl });
    } catch (error) {
      db.prepare('DELETE FROM email_verification_tokens WHERE token_hash = ?').run(tokenHash);
      console.error('[E-Mail] Erneuter Bestätigungslink konnte nicht versendet werden:', error.message);
      res.status(503).json({ error: 'Der Bestätigungslink konnte gerade nicht versendet werden. Bitte versuche es später erneut.' });
      return;
    }
  }
  res.json({ message: 'Falls ein unbestätigtes Konto zu dieser E-Mail-Adresse existiert, wurde ein Bestätigungslink versendet.' });
}));

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
      SET email_verified = 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(record.user_id);
    db.prepare('DELETE FROM email_verification_tokens WHERE token_hash = ?').run(tokenHash);
    return true;
  });

  if (!verify()) {
    res.status(400).json({ error: 'Verifizierungslink ist ungültig oder abgelaufen.' });
    return;
  }
  res.json({ message: 'E-Mail-Adresse erfolgreich bestätigt. Du kannst dich jetzt anmelden.' });
});

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
  if (!user.email_verified) {
    res.status(403).json({ error: 'Bitte bestätige zuerst deine E-Mail-Adresse.' });
    return;
  }

  db.prepare(`
    UPDATE users SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(user.id);
  res.json(issueSession(user, res));
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
  const user = db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').get(email);
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
      await sendAccountLink({ email: user.email, label: 'Passwort zurücksetzen', url: resetUrl });
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
  const user = db.prepare(`
    SELECT id, email, username, age, email_verified, avatar_url, created_at
    FROM users WHERE id = ?
  `).get(req.auth.sub);
  if (!user) {
    res.status(404).json({ error: 'Konto nicht gefunden.' });
    return;
  }
  res.json({ user: publicUser(user) });
});

authRouter.patch('/me', requireAuth, (req, res) => {
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
  try {
    db.prepare(`
      UPDATE users SET username = ?, age = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(username, age, current.id);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(409).json({ error: 'Dieser Benutzername ist bereits vergeben.' });
      return;
    }
    throw error;
  }
  const updated = db.prepare(`
    SELECT id, email, username, age, email_verified, avatar_url, created_at FROM users WHERE id = ?
  `).get(current.id);
  res.json({ user: publicUser(updated) });
});

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
  const user = db.prepare('SELECT id, password_hash FROM users WHERE id = ?').get(req.auth.sub);
  if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) {
    res.status(401).json({ error: 'Das aktuelle Passwort ist nicht korrekt.' });
    return;
  }
  const passwordHash = await bcrypt.hash(newPassword, config.bcryptRounds);
  const revokeSessions = db.transaction(() => {
    db.prepare(`
      UPDATE users
      SET password_hash = ?, auth_version = auth_version + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(passwordHash, user.id);
    db.prepare(`
      UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL
    `).run(new Date().toISOString(), user.id);
  });
  revokeSessions();
  realtime.disconnectUser(user.id);
  clearRefreshCookie(res);
  res.json({ message: 'Passwort geändert. Bitte melde dich erneut an.' });
}));

authRouter.delete('/me', requireAuth, asyncRoute(async (req, res) => {
  if (typeof req.body.password !== 'string') {
    res.status(400).json({ error: 'Bitte bestätige die Kontolöschung mit deinem Passwort.' });
    return;
  }
  const user = db.prepare('SELECT id, password_hash FROM users WHERE id = ?').get(req.auth.sub);
  if (!user || !(await bcrypt.compare(req.body.password, user.password_hash))) {
    res.status(401).json({ error: 'Das Passwort ist nicht korrekt.' });
    return;
  }
  realtime.disconnectUser(user.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  clearRefreshCookie(res);
  res.status(204).end();
}));

app.use('/api/auth', authRouter);
app.use('/api', createChatRouter({ db, requireAuth, realtime }));

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
