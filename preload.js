const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  readFont: (fontName) => ipcRenderer.invoke('read-font', fontName)
});
