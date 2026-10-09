const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const appUrl = process.env.MINGLE_APP_URL;
let parsedUrl;

try {
  parsedUrl = new URL(appUrl);
} catch {
  throw new Error('Set MINGLE_APP_URL to the deployed HTTPS app URL before building the installer.');
}

if (parsedUrl.protocol !== 'https:' || parsedUrl.pathname !== '/' || parsedUrl.search || parsedUrl.hash) {
  throw new Error('MINGLE_APP_URL must be a public HTTPS origin, for example https://mingle.example.com.');
}

const generatedConfig = path.join(__dirname, 'app-url.json');
fs.writeFileSync(generatedConfig, `${JSON.stringify({ url: parsedUrl.origin })}\n`, { flag: 'w' });

const executable = process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder';
const result = spawnSync(executable, ['--win', 'nsis', '--x64'], {
  cwd: __dirname,
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status || 1;
