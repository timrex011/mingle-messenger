const { app, BrowserWindow, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const developmentUrl = 'http://localhost:5173';
const appUrlPath = path.join(__dirname, 'app-url.json');
let serviceUrl = developmentUrl;

if (app.isPackaged && !fs.existsSync(appUrlPath)) {
  throw new Error('The packaged app is missing its hosted service URL.');
}
if (fs.existsSync(appUrlPath)) {
  serviceUrl = require(appUrlPath).url;
}
if (!serviceUrl || !['https:', 'http:'].includes(new URL(serviceUrl).protocol)) {
  throw new Error('The desktop app service URL is invalid.');
}

function isServiceUrl(value) {
  try {
    return new URL(value).origin === new URL(serviceUrl).origin;
  } catch {
    return false;
  }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 360,
    minHeight: 560,
    title: 'Mingle',
    backgroundColor: '#111318',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (!isServiceUrl(url)) {
      event.preventDefault();
      if (url.startsWith('https://')) shell.openExternal(url);
    }
  });

  window.loadURL(serviceUrl);
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
