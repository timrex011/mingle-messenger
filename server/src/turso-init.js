'use strict';

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const turso = require('./turso');

async function initTursoSchema() {
  if (!turso.isTursoConfigured) {
    console.warn('[Turso] Keine Konfiguration gefunden.');
    return;
  }

  console.info('[Turso] Initialisiere Schema auf Turso Cloud Database...');

  const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

  const extraSql = `
    ALTER TABLE users ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN totp_secret TEXT;
    ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member';
    ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'online';
    ALTER TABLE users ADD COLUMN custom_status TEXT;
    ALTER TABLE users ADD COLUMN banner_url TEXT;
    ALTER TABLE users ADD COLUMN is_banned INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN ban_reason TEXT;
    ALTER TABLE users ADD COLUMN banned_at TIMESTAMP;

    CREATE TABLE IF NOT EXISTS servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon_url TEXT,
      banner_url TEXT,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      topic TEXT,
      type TEXT NOT NULL DEFAULT 'text',
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS server_members (
      server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      role_id TEXT REFERENCES server_roles(id) ON DELETE SET NULL,
      joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (server_id, user_id)
    );

    ALTER TABLE server_members ADD COLUMN role_id TEXT REFERENCES server_roles(id) ON DELETE SET NULL;

    CREATE TABLE IF NOT EXISTS server_roles (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#818cf8',
      position INTEGER NOT NULL DEFAULT 0,
      permissions TEXT NOT NULL DEFAULT '{}',
      is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (server_id, name)
    );

    CREATE TABLE IF NOT EXISTS server_invites (
      code TEXT PRIMARY KEY,
      server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMP,
      max_uses INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
      use_count INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
      revoked_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

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
  `;

  // Split SQL by semicolons, filtering out comments and whitespace
  const allStatements = [];
  for (const block of [schemaSql, extraSql]) {
    const rawStmts = block
      .replace(/--.*$/gm, '')
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    allStatements.push(...rawStmts);
  }

  for (const sql of allStatements) {
    try {
      await turso.executeStatements([sql]);
    } catch (err) {
      // Ignore errors for existing columns or tables
      if (
        !err.message.includes('duplicate column') &&
        !err.message.includes('already exists')
      ) {
        console.warn(`[Turso Schema Warnung] ${sql.slice(0, 50)}...:`, err.message);
      }
    }
  }

  console.info('[Turso] Schema auf Turso Cloud Database erfolgreich bereitgestellt!');
}

if (require.main === module) {
  initTursoSchema().then(() => process.exit(0)).catch((err) => {
    console.error('[Turso Init Fehler]:', err);
    process.exit(1);
  });
}

module.exports = { initTursoSchema };
