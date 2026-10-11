const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');

let splashWindow = null;
let mainWindow = null;
let currentServiceUrl = null;
let isUpdating = false;

const TAMPER_SECRET = 'mingle-tamper-seal-v1';
const CLOUD_URL = 'https://mingle-messenger-q6zt.onrender.com';
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

function tryStartLocalServer() {
  const possiblePaths = [
    'c:\\Users\\alfay\\Desktop\\mini\\server\\src\\index.js',
    path.join(app.getPath('home'), 'Desktop', 'mini', 'server', 'src', 'index.js')
  ];
  for (const serverScript of possiblePaths) {
    if (fs.existsSync(serverScript)) {
      try {
        const { spawn } = require('node:child_process');
        const child = spawn('node', [serverScript], {
          cwd: path.dirname(path.dirname(serverScript)),
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        });
        child.unref();
        console.info('[Server] Lokaler Server im Hintergrund gestartet.');
        return true;
      } catch (err) {
        console.warn('[Server] Konnte lokalen Server nicht starten:', err.message);
      }
    }
  }
  return false;
}

async function resolveServiceUrl() {
  const saved = getSavedServerUrl();
  if (saved) {
    try {
      await verifyHealth(saved, 1800);
      return saved;
    } catch {}
  }

  // 1. Prüfe Cloud-Server
  try {
    await verifyHealth(CLOUD_URL, 1800);
    return CLOUD_URL;
  } catch {}

  // 2. Prüfe lokalen Server
  try {
    await verifyHealth(LOCAL_URL, 800);
    return LOCAL_URL;
  } catch {}

  // 3. Wenn kein Server antwortet, versuche lokalen Server automatisch zu starten
  if (tryStartLocalServer()) {
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 600));
      try {
        await verifyHealth(LOCAL_URL, 600);
        return LOCAL_URL;
      } catch {}
    }
  }

  return null;
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

  if (serviceUrl) {
    currentServiceUrl = serviceUrl;
    mainWindow.loadURL(serviceUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, 'connect.html'));
  }

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

  let updateFound = false;

  autoUpdater.on('checking-for-update', () => {
    sendSplashStatus('Suche nach Updates...');
  });

  autoUpdater.on('update-available', (info) => {
    updateFound = true;
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

  function proceedToLaunch() {
    if (isUpdating) return;
    sendSplashStatus('Mingle wird gestartet...');
    resolveServiceUrl().then((url) => {
      createMainWindow(url);
    }).catch(() => {
      createMainWindow(null);
    });
  }

  autoUpdater.on('update-not-available', () => {
    sendSplashStatus('Mingle ist aktuell');
    setTimeout(proceedToLaunch, 400);
  });

  autoUpdater.on('error', (err) => {
    console.warn('[Updater] Fehler:', err?.message || err);
    sendSplashStatus('Starte Mingle...');
    setTimeout(proceedToLaunch, 400);
  });

  // Start-Check mit Fallback-Timeout (nach max 3.5s startet die App immer)
  autoUpdater.checkForUpdates().catch((err) => {
    console.warn('[Updater] Check-Fehler:', err?.message || err);
    proceedToLaunch();
  });

  setTimeout(() => {
    if (!updateFound && !isUpdating) {
      proceedToLaunch();
    }
  }, 3500);

  // Wiederholungsprüfung im Hintergrund alle 20 Minuten
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 20 * 60 * 1000);
}

app.whenReady().then(() => {
  if (!verifyAppIntegrity()) return;
  Menu.setApplicationMenu(null);
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
