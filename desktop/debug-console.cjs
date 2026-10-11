const { app, BrowserWindow } = require('electron');

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    webPreferences: {
      preload: 'C:\\Users\\alfay\\Desktop\\mini\\desktop\\preload.cjs',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true
    }
  });

  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[BROWSER_CONSOLE level=${level}] ${message} (${sourceId}:${line})`);
  });

  win.webContents.on('did-fail-load', (_event, code, desc, url) => {
    console.log(`[DID_FAIL_LOAD] ${code} ${desc} ${url}`);
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    console.log(`[CRASH]`, details);
  });

  win.loadURL('http://127.0.0.1:3000');

  setTimeout(() => {
    app.exit(0);
  }, 4000);
});
