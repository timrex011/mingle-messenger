const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: {
      offscreen: true
    }
  });

  const svgPath = path.resolve('website/favicon.svg');
  await win.loadFile(svgPath);

  // Wait a moment for rendering
  await new Promise(r => setTimeout(r, 500));

  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  const pngBuffer = image.toPNG();

  fs.writeFileSync('client/public/favicon.png', pngBuffer);
  fs.writeFileSync('website/favicon.png', pngBuffer);
  fs.writeFileSync('desktop/icon.png', pngBuffer);

  console.log('Successfully captured 512x512 PNG from website/favicon.svg!');
  app.quit();
});
