const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const desktopDir = __dirname;
const filesToProtect = [
  'preload.cjs',
  'connect.html'
];

const hashes = {};
for (const file of filesToProtect) {
  const filePath = path.join(desktopDir, file);
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath);
    hashes[file] = crypto.createHash('sha256').update(content).digest('hex');
  }
}

const manifestPath = path.join(desktopDir, 'integrity.json');
fs.writeFileSync(manifestPath, JSON.stringify(hashes, null, 2) + '\n', 'utf8');
console.log('Integrity manifest generated:', hashes);
