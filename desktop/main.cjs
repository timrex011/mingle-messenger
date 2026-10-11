const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');

let mainWindow;
let currentServiceUrl = null;
const TAMPER_SECRET = 'mingle-tamper-seal-v1';

function verifyAppIntegrity() {
  const integrityPath = path.join(__dirname, 'integrity.json');
  if (!fs.existsSync(integrityPath)) {
    return true;
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(integrityPath, 'utf8'));
    for (const [file, expectedHash] of Object.entries(manifest)) {
      const targetPath = path.join(__dirname, file);
      if (!fs.existsSync(targetPath)) {
        throw new Error(`Fehlende Programmdatei: ${file}`);
      }
      const actualHash = crypto.createHash('sha256').update(fs.readFileSync(targetPath)).digest('hex');
      if (actualHash !== expectedHash) {
        throw new Error(`Integritätsverletzung in Datei: ${file}`);
      }
    }
    return true;
  } catch (err) {
    dialog.showErrorBox(
      'Mingle – Integritätsfehler',
      `Die Anwendungsdateien wurden nachträglich bearbeitet oder manipuliert.\n\nDetails: ${err.message}\n\nMingle kann aus Sicherheitsgründen nicht gestartet werden. Bitte installiere die offizielle App neu.`
    );
    app.exit(1);
    return false;
  }
}

function signData(data) {
  return crypto.createHmac('sha256', TAMPER_SECRET).update(data).digest('hex');
}

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

  const userFile = path.join(app.getPath('userData'), 'server-url.json');
  if (fs.existsSync(userFile)) {
    try {
      const payload = JSON.parse(fs.readFileSync(userFile, 'utf8'));
      if (payload.url && payload.sig && signData(payload.url) === payload.sig) {
        return payload.url;
      }
      // Tampering detected in settings!
      console.warn('Signatur der Konfigurationsdatei ungültig (Manipulation erkannt).');
    } catch {}
  }

  // Fallback to old plain file if present
  const oldUserFile = path.join(app.getPath('userData'), 'server-url.txt');
  if (fs.existsSync(oldUserFile)) {
    try {
      const url = fs.readFileSync(oldUserFile, 'utf8').trim();
      if (url) {
        saveServerUrl(url);
        fs.rmSync(oldUserFile, { force: true });
        return url;
      }
    } catch {}
  }

  return null;
}

function saveServerUrl(url) {
  const userFile = path.join(app.getPath('userData'), 'server-url.json');
  const cleanUrl = url.trim();
  const payload = {
    url: cleanUrl,
    sig: signData(cleanUrl),
    savedAt: new Date().toISOString()
  };
  fs.mkdirSync(path.dirname(userFile), { recursive: true });
  fs.writeFileSync(userFile, JSON.stringify(payload, null, 2));
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
  Menu.setApplicationMenu(null);
}
function createWindow() {
  const iconPath = fs.existsSync(path.join(__dirname, 'icon.png'))
    ? path.join(__dirname, 'icon.png')
    : path.join(__dirname, 'icon.ico');

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 400,
    minHeight: 560,
    title: 'Mingle',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    backgroundColor: '#0b0d13',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true
    }
  });

  mainWindow.setMenuBarVisibility(false);

  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 's') {
      showConnectScreen();
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
  configureUpdaterFeed(cleanUrl);
  await loadServiceUrl(cleanUrl);
  return true;
});

let autoUpdater = null;
try {
  const updaterModule = require('./updater.cjs');
  autoUpdater = updaterModule.autoUpdater;
} catch (e1) {
  try {
    const updaterModule = require('electron-updater');
    autoUpdater = updaterModule.autoUpdater;
  } catch (e2) {}
}

function configureUpdaterFeed(serviceUrl) {
  if (!autoUpdater || !serviceUrl) return;
  try {
    const cleanUrl = serviceUrl.trim().replace(/\/+$/, '');
    const feedUrl = `${cleanUrl}/update/`;
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: feedUrl
    });
    console.info('[Update] Feed-URL gesetzt auf:', feedUrl);
  } catch (err) {
    console.warn('[Update] Feed-URL konnte nicht gesetzt werden:', err.message);
  }
}

function setupAutoUpdater() {
  if (!app.isPackaged || !autoUpdater) return;
  try {
    const savedUrl = getSavedServerUrl();
    if (savedUrl) {
      configureUpdaterFeed(savedUrl);
    }

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => {
      console.info('[Update] Suche nach Mingle Updates...');
    });

    autoUpdater.on('update-available', (info) => {
      console.info('[Update] Neue Version verfügbar (wird geladen):', info.version);
    });

    autoUpdater.on('update-not-available', (info) => {
      console.info('[Update] Mingle ist auf dem neuesten Stand:', info?.version);
    });

    autoUpdater.on('download-progress', (progressObj) => {
      console.info(`[Update] Herunterladen: ${Math.round(progressObj.percent)}%`);
    });

    autoUpdater.on('update-downloaded', (info) => {
      console.info('[Update] Update heruntergeladen:', info.version);
      if (mainWindow && !mainWindow.isDestroyed()) {
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'Mingle – Update bereit',
          message: `Mingle wurde auf Version ${info.version} aktualisiert!`,
          detail: 'Möchtest du Mingle jetzt neu starten, um die neueste Version wie bei Discord direkt anzuwenden?',
          buttons: ['Jetzt neu starten', 'Später beim Beenden'],
          defaultId: 0,
          cancelId: 1
        }).then((choice) => {
          if (choice.response === 0) {
            autoUpdater.quitAndInstall();
          }
        });
      }
    });

    autoUpdater.on('error', (err) => {
      console.warn('[Update] Auto-Update-Status:', err?.message || err);
    });

    // Sofortige Prüfung beim App-Start wie bei Discord
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.warn('[Update] Start-Check:', err.message);
    });

    // Wiederkehrende Prüfung im Hintergrund alle 20 Minuten
    setInterval(() => {
      autoUpdater.checkForUpdatesAndNotify().catch(() => {});
    }, 20 * 60 * 1000);
  } catch (err) {
    console.warn('[Update] Initialisierungsfehler:', err.message);
  }
}

app.whenReady().then(() => {
  if (!verifyAppIntegrity()) return;
  setupMenu();
  createWindow();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

