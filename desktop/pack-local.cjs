const asar = require('@electron/asar');
const fs = require('node:fs');
const path = require('node:path');

async function pack() {
  const root = path.join(__dirname, '..');
  const staging = path.join(root, 'build', 'asar-staging');
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(path.join(staging, 'desktop'), { recursive: true });

  const desktopFiles = [
    'connect.html',
    'icon.ico',
    'icon.png',
    'integrity.json',
    'main.cjs',
    'preload.cjs',
    'splash.html',
    'updater.cjs'
  ];

  for (const f of desktopFiles) {
    const src = path.join(__dirname, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(staging, 'desktop', f));
    }
  }

  // Copy package.json
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  fs.writeFileSync(path.join(staging, 'package.json'), JSON.stringify({
    name: pkg.name,
    version: pkg.version,
    private: pkg.private,
    description: pkg.description,
    author: pkg.author,
    main: pkg.main,
    dependencies: pkg.dependencies
  }, null, 2));

  const outAsar = path.join(root, 'build', 'app.asar');
  await asar.createPackage(staging, outAsar);
  console.log('Built local app.asar at:', outAsar);

  const targetPath = 'C:/Users/alfay/AppData/Local/Programs/messenger-app/resources/app.asar';
  if (fs.existsSync(path.dirname(targetPath))) {
    fs.copyFileSync(outAsar, targetPath);
    console.log('Successfully updated installed app at:', targetPath);
  }
}

pack().catch(console.error);
