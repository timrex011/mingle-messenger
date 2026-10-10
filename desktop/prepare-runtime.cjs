const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const dest = path.join(__dirname, 'runtime-bundle');
const releaseConfig = path.join(__dirname, 'release-config.json');
const rootPackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const webUrl = (process.env.MINGLE_WEB_URL || '').trim();
if (webUrl) {
  let parsed;
  try {
    parsed = new URL(webUrl);
  } catch {
    throw new Error('MINGLE_WEB_URL muss eine gültige HTTPS-Adresse sein.');
  }
  if (parsed.protocol !== 'https:') throw new Error('MINGLE_WEB_URL muss mit https:// beginnen.');
  fs.writeFileSync(releaseConfig, `${JSON.stringify({ webUrl: parsed.origin }, null, 2)}\n`);
} else {
  fs.rmSync(releaseConfig, { force: true });
}

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(path.join(dest, 'server'), { recursive: true });
fs.mkdirSync(path.join(dest, 'client'), { recursive: true });

fs.copyFileSync(process.execPath, path.join(dest, 'node.exe'));
fs.cpSync(path.join(root, 'server'), path.join(dest, 'server'), {
  recursive: true,
  filter: (source) => !source.endsWith('.test.js')
});
fs.cpSync(path.join(root, 'client', 'dist'), path.join(dest, 'client', 'dist'), { recursive: true });

fs.writeFileSync(path.join(dest, 'package.json'), `${JSON.stringify({
  name: 'mingle-runtime',
  version: rootPackage.version,
  private: true,
  dependencies: rootPackage.dependencies
}, null, 2)}\n`);

const install = spawnSync('npm', ['install', '--omit=dev', '--no-fund', '--no-audit'], {
  cwd: dest,
  stdio: 'inherit',
  shell: process.platform === 'win32'
});
if (install.error) throw install.error;
if (install.status !== 0) process.exit(install.status || 1);

const sqliteBinding = path.join(dest, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
if (!fs.existsSync(sqliteBinding)) {
  throw new Error('better-sqlite3 native binding missing from the desktop runtime bundle.');
}
