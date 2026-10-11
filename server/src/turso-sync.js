'use strict';

const turso = require('./turso');

const SYNCED_TABLES = [
  'users',
  'friendships',
  'blocks',
  'conversations',
  'conversation_members',
  'messages',
  'message_reactions',
  'message_reads',
  'message_deletions',
  'message_attachments',
  'servers',
  'channels',
  'server_members',
  'user_devices',
  'sessions',
  'email_verification_tokens',
  'password_reset_tokens',
  'email_auth_challenges'
];

let syncInterval = null;
let isFlushing = false;

function setupQueueAndTriggers(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _turso_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      op TEXT NOT NULL,
      row_id TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_turso_queue_id ON _turso_queue(id);
  `);

  for (const table of SYNCED_TABLES) {
    // Check if table exists in local DB
    const exists = db.prepare(`
      SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
    `).get(table);
    if (!exists) continue;

    const cols = db.pragma(`table_info(${table})`).map((c) => c.name);
    const pkCols = db.pragma(`table_info(${table})`).filter((c) => c.pk > 0).map((c) => c.name);
    const primaryKey = pkCols.length > 0 ? pkCols[0] : cols[0];

    // Create trigger for INSERT
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS _trg_turso_ins_${table}
      AFTER INSERT ON ${table}
      BEGIN
        INSERT INTO _turso_queue (table_name, op, row_id)
        VALUES ('${table}', 'UPSERT', NEW.${primaryKey});
      END;
    `);

    // Create trigger for UPDATE
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS _trg_turso_upd_${table}
      AFTER UPDATE ON ${table}
      BEGIN
        INSERT INTO _turso_queue (table_name, op, row_id)
        VALUES ('${table}', 'UPSERT', NEW.${primaryKey});
      END;
    `);

    // Create trigger for DELETE
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS _trg_turso_del_${table}
      AFTER DELETE ON ${table}
      BEGIN
        INSERT INTO _turso_queue (table_name, op, row_id)
        VALUES ('${table}', 'DELETE', OLD.${primaryKey});
      END;
    `);
  }
}

async function restoreFromTurso(db) {
  if (!turso.isTursoConfigured) return;

  console.info('[Turso Sync] Prüfe Cloud-Datenbank auf gespeicherte Daten...');

  try {
    // Check how many users exist in Turso
    const tursoUsers = await turso.query('SELECT COUNT(*) as count FROM users');
    const cloudUserCount = Number(tursoUsers[0]?.count || 0);

    const localUserCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;

    console.info(`[Turso Sync] Cloud-Nutzer: ${cloudUserCount}, Lokale Nutzer: ${localUserCount}`);

    if (cloudUserCount > 0 && localUserCount === 0) {
      console.info('[Turso Sync] Neuer Container auf Render erkannt. Stelle Daten aus Turso wieder her...');
      db.pragma('foreign_keys = OFF');

      for (const table of SYNCED_TABLES) {
        try {
          const rows = await turso.query(`SELECT * FROM ${table}`);
          if (rows && rows.length > 0) {
            const cols = Object.keys(rows[0]);
            const placeholders = cols.map(() => '?').join(', ');
            const insertSql = `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`;
            const insertStmt = db.prepare(insertSql);

            const tx = db.transaction((items) => {
              for (const row of items) {
                insertStmt.run(...cols.map((c) => row[c]));
              }
            });
            tx(rows);
            console.info(`[Turso Sync] Tabelle '${table}': ${rows.length} Zeilen aus Cloud wiederhergestellt.`);
          }
        } catch (tblErr) {
          console.warn(`[Turso Sync] Wiederherstellung für '${table}':`, tblErr.message);
        }
      }

      db.pragma('foreign_keys = ON');
      console.info('[Turso Sync] Alle Daten wurden erfolgreich aus der Cloud wiederhergestellt!');
    } else if (localUserCount > 0 && cloudUserCount === 0) {
      // Local has data, but Turso is fresh: initial upload to Turso!
      console.info('[Turso Sync] Lade lokale Daten erstmals in die Turso Cloud hoch...');
      await fullBackupToTurso(db);
    }
  } catch (err) {
    console.warn('[Turso Sync] Fehler bei Wiederherstellung:', err.message);
  }
}

async function fullBackupToTurso(db) {
  if (!turso.isTursoConfigured) return;

  for (const table of SYNCED_TABLES) {
    try {
      const rows = db.prepare(`SELECT * FROM ${table}`).all();
      if (rows && rows.length > 0) {
        const statements = [];
        for (const row of rows) {
          const cols = Object.keys(row);
          const placeholders = cols.map(() => '?').join(', ');
          const sql = `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`;
          const args = cols.map((c) => {
            const v = row[c];
            if (v === null || v === undefined) return { type: 'null' };
            if (typeof v === 'number') return { type: Number.isInteger(v) ? 'integer' : 'float', value: String(v) };
            return { type: 'text', value: String(v) };
          });
          statements.push({ sql, args });
        }
        await turso.executeStatements(statements);
        console.info(`[Turso Backup] Tabelle '${table}': ${rows.length} Zeilen in Cloud gesichert.`);
      }
    } catch (err) {
      console.warn(`[Turso Backup] Fehler bei Tabelle '${table}':`, err.message);
    }
  }
}

async function flushQueue(db) {
  if (!turso.isTursoConfigured || isFlushing) return;

  const items = db.prepare(`
    SELECT id, table_name, op, row_id
    FROM _turso_queue
    ORDER BY id ASC
    LIMIT 200
  `).all();

  if (!items || items.length === 0) return;

  isFlushing = true;
  try {
    const statements = [];
    const processedIds = [];

    for (const item of items) {
      processedIds.push(item.id);
      if (item.op === 'DELETE') {
        statements.push({
          sql: `DELETE FROM ${item.table_name} WHERE id = ?`,
          args: [{ type: 'text', value: item.row_id }]
        });
      } else if (item.op === 'UPSERT') {
        const pkCols = db.pragma(`table_info(${item.table_name})`).filter((c) => c.pk > 0).map((c) => c.name);
        const pk = pkCols[0] || 'id';

        const row = db.prepare(`SELECT * FROM ${item.table_name} WHERE ${pk} = ?`).get(item.row_id);
        if (row) {
          const cols = Object.keys(row);
          const placeholders = cols.map(() => '?').join(', ');
          const sql = `INSERT OR REPLACE INTO ${item.table_name} (${cols.join(', ')}) VALUES (${placeholders})`;
          const args = cols.map((c) => {
            const v = row[c];
            if (v === null || v === undefined) return { type: 'null' };
            if (typeof v === 'number') return { type: Number.isInteger(v) ? 'integer' : 'float', value: String(v) };
            return { type: 'text', value: String(v) };
          });
          statements.push({ sql, args });
        }
      }
    }

    if (statements.length > 0) {
      await turso.executeStatements(statements);
    }

    // Delete processed queue items
    db.prepare(`
      DELETE FROM _turso_queue WHERE id IN (${processedIds.map(() => '?').join(',')})
    `).run(...processedIds);
  } catch (err) {
    console.warn('[Turso Sync] Fehler beim Synchronisieren der Warteschlange:', err.message);
  } finally {
    isFlushing = false;
  }
}

function startSync(db) {
  if (!turso.isTursoConfigured) {
    console.info('[Turso Sync] Turso ist nicht konfiguriert – lokaler SQLite-Modus aktiv.');
    return;
  }

  setupQueueAndTriggers(db);

  // Restore existing Cloud data on boot
  restoreFromTurso(db).catch((err) => {
    console.warn('[Turso Sync] Fehler bei Wiederherstellung auf Boot:', err.message);
  });

  // Start periodic flush every 3 seconds
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = setInterval(() => {
    flushQueue(db).catch(() => {});
  }, 3000);

  // Handle graceful shutdown to flush remaining queue items
  const handleExit = async () => {
    if (syncInterval) clearInterval(syncInterval);
    console.info('[Turso Sync] Server beendet sich. Speichere finale Daten in Turso Cloud...');
    try {
      await flushQueue(db);
    } catch {}
  };

  process.once('SIGTERM', handleExit);
  process.once('SIGINT', handleExit);
}

module.exports = {
  startSync,
  restoreFromTurso,
  fullBackupToTurso,
  flushQueue
};
