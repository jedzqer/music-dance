const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  scanFolder: (folderPath) => ipcRenderer.invoke('scan-folder', folderPath),
  getLastFolder: () => ipcRenderer.invoke('get-last-folder'),
  saveLastFolder: (folderPath) => ipcRenderer.invoke('save-last-folder', folderPath),
  getFileUrl: (filePath) => ipcRenderer.invoke('get-file-url', filePath),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowMaximize: () => ipcRenderer.send('window-maximize'),
  windowClose: () => ipcRenderer.send('window-close'),
  windowToggleFullscreen: () => ipcRenderer.send('window-toggle-fullscreen'),
  onFullscreenChange: (callback) => ipcRenderer.on('fullscreen-changed', (_event, value) => callback(value))
});
