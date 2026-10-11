const path = require('node:path');
const fs = require('node:fs');

async function bundle() {
  const root = path.join(__dirname, '..');
  let esbuild;
  try {
    esbuild = require(path.join(root, 'client/node_modules/esbuild'));
  } catch {
    esbuild = require('esbuild');
  }

  const entry = path.join(root, 'node_modules/electron-updater/out/main.js');
  const outfile = path.join(__dirname, 'updater.cjs');

  console.log('[Updater Bundler] Erstelle Standalone-Bundle für electron-updater...');
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    target: 'node20',
    outfile,
    external: ['electron']
  });

  const stat = fs.statSync(outfile);
  console.log(`[Updater Bundler] Fertig: ${outfile} (${(stat.size / 1024).toFixed(1)} KB)`);
}

bundle().catch((err) => {
  console.error('[Updater Bundler] Fehler:', err);
  process.exit(1);
});
