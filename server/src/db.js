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
if (!userColumns.some((column) => column.name === 'about')) {
  db.exec("ALTER TABLE users ADD COLUMN about TEXT NOT NULL DEFAULT ''");
}
if (!userColumns.some((column) => column.name === 'pronouns')) {
  db.exec("ALTER TABLE users ADD COLUMN pronouns TEXT NOT NULL DEFAULT ''");
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
  CREATE INDEX IF NOT EXISTS idx_server_roles_server ON server_roles(server_id, position DESC);

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
  CREATE INDEX IF NOT EXISTS idx_server_invites_server ON server_invites(server_id, revoked_at);

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

const conversationColumns = db.pragma('table_info(conversations)');
if (!conversationColumns.some((column) => column.name === 'icon_url')) {
  db.exec('ALTER TABLE conversations ADD COLUMN icon_url TEXT');
}
if (!conversationColumns.some((column) => column.name === 'banner_url')) {
  db.exec('ALTER TABLE conversations ADD COLUMN banner_url TEXT');
}

const serverMemberColumns = db.pragma('table_info(server_members)');
if (!serverMemberColumns.some((column) => column.name === 'role_id')) {
  db.exec('ALTER TABLE server_members ADD COLUMN role_id TEXT REFERENCES server_roles(id) ON DELETE SET NULL');
}

const defaultRolePermissions = {
  owner: JSON.stringify({
    manage_server: true, manage_channels: true, manage_roles: true,
    manage_invites: true, kick_members: true, send_messages: true, read_messages: true
  }),
  admin: JSON.stringify({
    manage_server: true, manage_channels: true, manage_roles: true,
    manage_invites: true, kick_members: true, send_messages: true, read_messages: true
  }),
  member: JSON.stringify({ send_messages: true, read_messages: true })
};
const insertDefaultRole = db.prepare(`
  INSERT OR IGNORE INTO server_roles (id, server_id, name, position, permissions, is_system)
  VALUES (?, ?, ?, ?, ?, 1)
`);
const assignLegacyRoles = db.prepare(`
  UPDATE server_members
  SET role_id = (
    SELECT id FROM server_roles
    WHERE server_id = server_members.server_id AND name = ?
  )
  WHERE server_id = ? AND role_id IS NULL AND LOWER(role) = LOWER(?)
`);
const migrateServerRoles = db.transaction(() => {
  for (const server of db.prepare('SELECT id FROM servers').all()) {
    insertDefaultRole.run(`${server.id}:owner`, server.id, 'Owner', 100, defaultRolePermissions.owner);
    insertDefaultRole.run(`${server.id}:admin`, server.id, 'Admin', 90, defaultRolePermissions.admin);
    insertDefaultRole.run(`${server.id}:member`, server.id, 'Member', 0, defaultRolePermissions.member);
    assignLegacyRoles.run('Owner', server.id, 'Owner');
    assignLegacyRoles.run('Admin', server.id, 'Admin');
    assignLegacyRoles.run('Member', server.id, 'Member');
  }
});
migrateServerRoles();

// Automatische Zuweisung des Owners aus der Konfiguration
if (config.ownerEmail) {
  try {
    db.prepare(`
      UPDATE users
      SET role = 'owner', is_banned = 0
      WHERE LOWER(email) = LOWER(?)
    `).run(config.ownerEmail);
  } catch (err) {
    console.warn('[DB] Owner-Aktualisierung:', err.message);
  }
}

module.exports = db;
