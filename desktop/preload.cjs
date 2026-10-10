const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getLastUrl: () => ipcRenderer.invoke('get-last-url'),
  setServerUrl: (url) => ipcRenderer.invoke('set-server-url', url)
});
