const { spawnSync } = require('node:child_process');
const path = require('node:path');

const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['electron-builder', '--win', 'nsis', '--x64'],
  {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env
  }
);

if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status || 1;
