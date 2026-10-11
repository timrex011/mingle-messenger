'use strict';

const https = require('node:https');
const config = require('./config');

const tursoUrl = config.tursoDatabaseUrl || process.env.TURSO_DATABASE_URL || '';
const tursoToken = config.tursoAuthToken || process.env.TURSO_AUTH_TOKEN || '';

let tursoHostname = '';
if (tursoUrl) {
  try {
    tursoHostname = tursoUrl.replace(/^libsql:\/\//, '').replace(/^https?:\/\//, '').split('/')[0];
  } catch {}
}

const isTursoConfigured = Boolean(tursoHostname && tursoToken);

async function executeStatements(statements) {
  if (!isTursoConfigured) return null;
  if (!statements || statements.length === 0) return [];

  const requests = statements.map((stmt) => {
    if (typeof stmt === 'string') {
      return { type: 'execute', stmt: { sql: stmt } };
    }
    return { type: 'execute', stmt };
  });
  requests.push({ type: 'close' });

  const payload = JSON.stringify({ requests });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: tursoHostname,
      path: '/v2/pipeline',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tursoToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 10000
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(`Turso HTTP ${res.statusCode}: ${data}`));
          } else {
            resolve(parsed.results || []);
          }
        } catch (err) {
          reject(new Error(`Turso JSON Parse Error: ${err.message}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Turso Request Timeout'));
    });

    req.write(payload);
    req.end();
  });
}

async function query(sql, args = []) {
  const results = await executeStatements([{ sql, args }]);
  if (!results || results.length === 0) return [];
  const first = results[0];
  if (first.type === 'error') {
    throw new Error(first.message || 'Turso query error');
  }
  const result = first.response?.result;
  if (!result || !result.cols || !result.rows) return [];
  const cols = result.cols.map((c) => c.name);
  return result.rows.map((row) => {
    const obj = {};
    row.forEach((val, idx) => {
      obj[cols[idx]] = val.value !== undefined ? val.value : null;
    });
    return obj;
  });
}

module.exports = {
  isTursoConfigured,
  executeStatements,
  query
};
