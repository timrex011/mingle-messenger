const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const config = require('./config');

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

const db = new Database(config.databasePath);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');
db.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));

const userColumns = db.pragma('table_info(users)');
if (!userColumns.some((column) => column.name === 'auth_version')) {
  db.exec('ALTER TABLE users ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0 CHECK (auth_version >= 0)');
}
if (!userColumns.some((column) => column.name === 'totp_secret')) {
  db.exec('ALTER TABLE users ADD COLUMN totp_secret TEXT');
}
if (!userColumns.some((column) => column.name === 'totp_enabled')) {
  db.exec('ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0 CHECK (totp_enabled IN (0, 1))');
}
if (!userColumns.some((column) => column.name === 'role')) {
  db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member'");
}
if (!userColumns.some((column) => column.name === 'status')) {
  db.exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'online'");
}
if (!userColumns.some((column) => column.name === 'custom_status')) {
  db.exec("ALTER TABLE users ADD COLUMN custom_status TEXT");
}
if (!userColumns.some((column) => column.name === 'banner_url')) {
  db.exec("ALTER TABLE users ADD COLUMN banner_url TEXT");
}
if (!userColumns.some((column) => column.name === 'is_banned')) {
  db.exec("ALTER TABLE users ADD COLUMN is_banned INTEGER NOT NULL DEFAULT 0");
}
if (!userColumns.some((column) => column.name === 'ban_reason')) {
  db.exec("ALTER TABLE users ADD COLUMN ban_reason TEXT");
}
if (!userColumns.some((column) => column.name === 'banned_at')) {
  db.exec("ALTER TABLE users ADD COLUMN banned_at TIMESTAMP");
}

// Discord-like Servers & Channels Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon_url TEXT,
    banner_url TEXT,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_servers_owner ON servers(owner_id);

  CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    topic TEXT,
    type TEXT NOT NULL DEFAULT 'text',
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_channels_server ON channels(server_id);

  CREATE TABLE IF NOT EXISTS server_members (
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member',
    joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (server_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_server_members_user ON server_members(user_id);

  CREATE TABLE IF NOT EXISTS user_devices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_identifier TEXT NOT NULL,
    device_name TEXT,
    ip_address TEXT,
    city TEXT,
    last_login_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, device_identifier)
  );
  CREATE INDEX IF NOT EXISTS idx_user_devices_user ON user_devices(user_id);
`);

// Automatische Zuweisung des Owners aus der Konfiguration
if (config.ownerEmail) {
  try {
    db.prepare(`
      UPDATE users
      SET role = 'owner', is_banned = 0, email_verified = 1
      WHERE LOWER(email) = LOWER(?)
    `).run(config.ownerEmail);
  } catch (err) {
    console.warn('[DB] Owner-Aktualisierung:', err.message);
  }
}

// Wenn AUTO_VERIFY_EMAIL aktiv ist, alle unverifizierten Accounts freischalten
// (betrifft Nutzer, die sich vor dieser Änderung registriert haben)
if (config.autoVerifyEmail) {
  try {
    const result = db.prepare(`
      UPDATE users SET email_verified = 1 WHERE email_verified = 0
    `).run();
    if (result.changes > 0) {
      console.info(`[DB] ${result.changes} ausstehende Konto(s) automatisch freigeschaltet.`);
    }
  } catch (err) {
    console.warn('[DB] Auto-Verifikation:', err.message);
  }
}

module.exports = db;
