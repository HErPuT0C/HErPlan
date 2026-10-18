const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('herplanElectron', {
  versions: { electron: process.versions.electron, chrome: process.versions.chrome },
  report: (json) => ipcRenderer.invoke('report', json),
  quit: () => ipcRenderer.invoke('quit'),
});
