const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');

let mainWindow;
let currentServiceUrl = null;

function getSavedServerUrl() {
  if (process.env.MINGLE_WEB_URL) {
    return process.env.MINGLE_WEB_URL.trim();
  }

  const configPath = path.join(process.resourcesPath, 'release-config.json');
  if (app.isPackaged && fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (config.webUrl) return config.webUrl;
    } catch {}
  }

  const localConfigPath = path.join(__dirname, 'release-config.json');
  if (fs.existsSync(localConfigPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(localConfigPath, 'utf8'));
      if (config.webUrl) return config.webUrl;
    } catch {}
  }

  const userFile = path.join(app.getPath('userData'), 'server-url.txt');
  if (fs.existsSync(userFile)) {
    try {
      const url = fs.readFileSync(userFile, 'utf8').trim();
      if (url) return url;
    } catch {}
  }

  return null;
}

function saveServerUrl(url) {
  const userFile = path.join(app.getPath('userData'), 'server-url.txt');
  fs.mkdirSync(path.dirname(userFile), { recursive: true });
  fs.writeFileSync(userFile, url.trim());
}

function verifyHealth(targetUrl, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return reject(new Error('Ungültige Server-URL.'));
    }

    const client = parsed.protocol === 'https:' ? https : http;
    const healthUrl = `${parsed.origin}/api/health`;

    const req = client.get(healthUrl, (res) => {
      res.resume();
      if (res.statusCode === 200) {
        resolve();
      } else {
        reject(new Error(`Server antwortete mit Status ${res.statusCode}`));
      }
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error('Zeitüberschreitung beim Verbindungsaufbau zum Server.'));
    });

    req.on('error', (err) => {
      reject(new Error(`Server nicht erreichbar: ${err.message}`));
    });
  });
}

function isServiceUrl(value, serviceUrl) {
  if (!serviceUrl) return false;
  try {
    return new URL(value).origin === new URL(serviceUrl).origin;
  } catch {
    return false;
  }
}

function showConnectScreen() {
  currentServiceUrl = null;
  const connectPath = path.join(__dirname, 'connect.html');
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadFile(connectPath);
  }
}

async function loadServiceUrl(url) {
  currentServiceUrl = url.replace(/\/+$/, '');
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(currentServiceUrl);
  }
}

function setupMenu() {
  const template = [
    {
      label: 'Mingle',
      submenu: [
        {
          label: 'Server wechseln...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => showConnectScreen()
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Bearbeiten',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 400,
    minHeight: 560,
    title: 'Mingle',
    backgroundColor: '#0b0d13',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (currentServiceUrl && !isServiceUrl(url, currentServiceUrl)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  const savedUrl = getSavedServerUrl();
  if (savedUrl) {
    loadServiceUrl(savedUrl);
  } else {
    showConnectScreen();
  }
}

ipcMain.handle('get-last-url', () => {
  return getSavedServerUrl() || 'http://localhost:3000';
});

ipcMain.handle('set-server-url', async (_event, targetUrl) => {
  const cleanUrl = targetUrl.trim().replace(/\/+$/, '');
  await verifyHealth(cleanUrl);
  saveServerUrl(cleanUrl);
  await loadServiceUrl(cleanUrl);
  return true;
});

app.whenReady().then(() => {
  setupMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
