const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  readFont: (fontName) => ipcRenderer.invoke('read-font', fontName),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  savePdfToPath: (folderPath, filename, base64data) => ipcRenderer.invoke('save-pdf-to-path', folderPath, filename, base64data),
  openPdfFile: (filePath) => ipcRenderer.invoke('open-pdf', filePath),
  getAppVersion: () => ipcRenderer.invoke('app-version'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  onUpdateStatus: (callback) => {
    const handler = (_, payload) => callback(payload);
    ipcRenderer.on('update-status', handler);
    return () => ipcRenderer.removeListener('update-status', handler);
  }
});
