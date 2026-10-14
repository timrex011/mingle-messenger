'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, session, shell } = require('electron');
const crypto = require('node:crypto');
const fs   = require('node:fs');
const http  = require('node:http');
const https = require('node:https');
const path  = require('node:path');

let splashWindow = null;
let mainWindow   = null;
let currentServiceUrl = null;
let isUpdating   = false;
let launched     = false;          // guard: proceedToLaunch runs exactly once

const TAMPER_SECRET = 'mingle-tamper-seal-v1';
const CLOUD_URL = 'https://mingle-messenger.onrender.com';
const LOCAL_URL = 'http://127.0.0.1:3000';


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
        throw new Error(`Integritätsabweichung in Datei: ${file}`);
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

function verifyHealth(targetUrl, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return reject(new Error('Ungültige URL'));
    }

    const client = parsed.protocol === 'https:' ? https : http;
    const healthUrl = `${parsed.origin}/api/health`;

    const req = client.get(healthUrl, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200 && !body.includes('suspended')) {
          resolve(parsed.origin);
        } else {
          reject(new Error(`Status ${res.statusCode}`));
        }
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error('Timeout'));
    });

    req.on('error', (err) => {
      reject(err);
    });
  });
}

async function resolveServiceUrl() {
  // Immer ausschließlich Render-Cloudserver verwenden
  try {
    await verifyHealth(CLOUD_URL, 12000);
  } catch {}
  return CLOUD_URL;
}



function sendSplashStatus(status, percent = null) {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('updater-status', { status, percent });
  }
}

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

function configureUpdaterFeed() {
  if (!autoUpdater) return;
  try {
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: 'timrex011',
      repo: 'mingle-messenger'
    });
    console.info('[Update] GitHub Releases Updater aktiv (timrex011/mingle-messenger)');
  } catch (err) {
    console.warn('[Update] Feed-Fehler:', err.message);
  }
}

function createSplashWindow() {
  const iconPath = fs.existsSync(path.join(__dirname, 'icon.png'))
    ? path.join(__dirname, 'icon.png')
    : path.join(__dirname, 'icon.ico');

  splashWindow = new BrowserWindow({
    width: 360,
    height: 430,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    center: true,
    show: true,
    title: 'Mingle',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    backgroundColor: '#0b0d13',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
  splashWindow.on('closed', () => { splashWindow = null; });
}

function createMainWindow(serviceUrl) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
    return;
  }

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
    show: false,
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

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
    }
  });

  currentServiceUrl = CLOUD_URL;
  mainWindow.loadURL(CLOUD_URL);

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.warn('[Window] Render lädt noch oder nicht erreichbar:', errorCode, errorDescription);
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL(CLOUD_URL);
      }
    }, 3000);
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

ipcMain.handle('get-last-url', () => {
  return currentServiceUrl || CLOUD_URL;
});

ipcMain.handle('set-server-url', async (_event, targetUrl) => {
  if (targetUrl === 'auto') {
    const resolved = await resolveServiceUrl();
    if (resolved && mainWindow && !mainWindow.isDestroyed()) {
      currentServiceUrl = resolved;
      mainWindow.loadURL(resolved);
      return true;
    }
    throw new Error('Kein Server erreichbar');
  }

  const cleanUrl = targetUrl.trim().replace(/\/+$/, '');
  await verifyHealth(cleanUrl);
  saveServerUrl(cleanUrl);
  if (mainWindow && !mainWindow.isDestroyed()) {
    currentServiceUrl = cleanUrl;
    mainWindow.loadURL(cleanUrl);
  }
  return true;
});

function runStartupSequence() {
  launched = false;   // reset guard for this startup pass
  isUpdating = false;
  createSplashWindow();


  if (!app.isPackaged || !autoUpdater) {
    setTimeout(async () => {
      sendSplashStatus('Starte Mingle...');
      const url = await resolveServiceUrl();
      createMainWindow(url);
    }, 700);
    return;
  }

  configureUpdaterFeed();

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    sendSplashStatus('Suche nach Updates...');
  });

  autoUpdater.on('update-available', (info) => {
    if (info.version === app.getVersion()) {
      sendSplashStatus('App ist aktuell ✓');
      setTimeout(proceedToLaunch, 300);
      return;
    }
    isUpdating = true;
    sendSplashStatus(`Update v${info.version} gefunden...`, 5);
  });


  autoUpdater.on('download-progress', (progressObj) => {
    const pct = Math.round(progressObj.percent || 0);
    sendSplashStatus(`Update wird geladen (${pct}%)...`, pct);
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendSplashStatus(`Update v${info.version} geladen – Neustart...`, 100);
    setTimeout(() => {
      autoUpdater.quitAndInstall(true, true);
    }, 600);
  });

  // Called exactly once to open the main window
  function proceedToLaunch() {
    if (launched || isUpdating) return;
    launched = true;
    sendSplashStatus('Verbindung wird hergestellt...');
    // Show a hint if Render is doing a cold-start (takes up to 8s)
    const hintTimer = setTimeout(() => sendSplashStatus('Server startet... bitte warten...'), 1500);
    resolveServiceUrl().then((url) => {
      clearTimeout(hintTimer);
      sendSplashStatus(url ? 'Mingle startet...' : 'Offline-Modus...');
      setTimeout(() => createMainWindow(url), 300);
    }).catch(() => {
      clearTimeout(hintTimer);
      setTimeout(() => createMainWindow(null), 300);
    });
  }

  autoUpdater.on('update-not-available', () => {
    sendSplashStatus('App ist aktuell ✓');
    setTimeout(proceedToLaunch, 300);
  });

  autoUpdater.on('error', (err) => {
    console.warn('[Updater] Fehler:', err?.message || err);
    proceedToLaunch();
  });

  // Start update check; proceed on promise rejection too
  autoUpdater.checkForUpdates().catch((err) => {
    console.warn('[Updater] Check-Fehler:', err?.message || err);
    proceedToLaunch();
  });

  // Absolute safety-net: must be > cloud timeout (8s) + update-check delay
  setTimeout(() => proceedToLaunch(), 12000);


  // Background re-check every 20 min
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 20 * 60 * 1000);
}


app.whenReady().then(() => {
  if (!verifyAppIntegrity()) return;
  Menu.setApplicationMenu(null);
  const isTrustedMediaRequest = (webContents, requestingUrl, permission, details = {}) => {
    if (webContents !== mainWindow?.webContents || permission !== 'media') return false;
    if (Array.isArray(details.mediaTypes)
      && (!details.mediaTypes.length || details.mediaTypes.some((type) => !['audio', 'video'].includes(type)))) {
      return false;
    }
    try {
      const requestingOrigin = new URL(requestingUrl).origin;
      return requestingOrigin === new URL(currentServiceUrl || CLOUD_URL).origin;
    } catch {
      return false;
    }
  };
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(isTrustedMediaRequest(webContents, details.requestingUrl || webContents.getURL(), permission, details));
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    return isTrustedMediaRequest(webContents, requestingOrigin, permission, details);
  });
  runStartupSequence();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      runStartupSequence();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
