const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getLastUrl: () => ipcRenderer.invoke('get-last-url'),
  setServerUrl: (url) => ipcRenderer.invoke('set-server-url', url),
  onUpdaterStatus: (cb) => ipcRenderer.on('updater-status', (_event, data) => cb(data))
});
