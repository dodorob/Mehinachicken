const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  readFont: (fontName) => ipcRenderer.invoke('read-font', fontName),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  savePdfToPath: (folderPath, filename, base64data) => ipcRenderer.invoke('save-pdf-to-path', folderPath, filename, base64data)
});
