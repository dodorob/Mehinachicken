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
  },
  saveBackup: (jsonData) => ipcRenderer.invoke('save-backup', jsonData),
  listBackups: () => ipcRenderer.invoke('list-backups'),
  loadBackup: (filePath) => ipcRenderer.invoke('load-backup', filePath),

  // ----------------------------------------------------------------
  // SQLite database API
  // ----------------------------------------------------------------
  db: {
    getInitData:          ()           => ipcRenderer.invoke('db-get-init-data'),
    createNew:            ()           => ipcRenderer.invoke('db-create-new'),
    openExisting:         ()           => ipcRenderer.invoke('db-open-existing'),
    switchDb:             ()           => ipcRenderer.invoke('db-switch'),
    createSwitch:         ()           => ipcRenderer.invoke('db-create-switch'),
    getPath:              ()           => ipcRenderer.invoke('db-get-path'),
    saveAll:              (data)       => ipcRenderer.invoke('db-save-all', data),
    saveSetting:          (key, value) => ipcRenderer.invoke('db-save-setting', key, value),
    saveBeschHist:        (terms)      => ipcRenderer.invoke('db-save-besch-hist', terms),
    saveFixkosten:        (list)       => ipcRenderer.invoke('db-save-fixkosten', list),
    savePosBadges:        (labels)     => ipcRenderer.invoke('db-save-pos-badges', labels),
    migrateFromLocalStorage: (lsData) => ipcRenderer.invoke('db-migrate-localstorage', lsData),
  },
});
