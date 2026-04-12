const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('fs');
let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch (error) {
  console.warn('electron-updater is unavailable; auto updates are disabled.', error);
}
const path = require('path');
let dotenv = null;
try {
  dotenv = require('dotenv');
} catch (error) {
  console.warn('dotenv is unavailable; .env files will not be loaded.', error);
}

// ----------------------------------------------------------------
// Database & Config
// ----------------------------------------------------------------
let BuchProDB = null;
let AppConfig = null;
try {
  BuchProDB = require('./database.js');
  AppConfig = require('./app-config.js');
} catch (e) {
  console.warn('DB modules unavailable:', e.message);
}

let buchProDB  = null;
let appConfig  = null;

function loadUpdateTokenFromEnvFiles() {
  if (!dotenv) {
    return;
  }

  const candidates = [
    path.join(process.cwd(), '.env'),
    path.join(__dirname, '.env'),
    path.join(process.resourcesPath || '', '.env'),
    path.join(app.getPath('userData'), '.env'),
  ];

  candidates.forEach((envPath) => {
    if (!envPath) {
      return;
    }
    dotenv.config({ path: envPath, override: false });
  });
}

function sendUpdateStatus(event, payload) {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send('update-status', { event, ...payload });
  });
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

function setupAutoUpdates() {
  if (!app.isPackaged || !autoUpdater) {
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    sendUpdateStatus('checking');
  });

  autoUpdater.on('update-available', async (info) => {
    sendUpdateStatus('available', { version: info && info.version ? info.version : '' });

    const result = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Download starten', 'Später'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update verfügbar',
      message: 'Eine neue Version ist verfügbar. Möchten Sie den Download jetzt starten?',
    });

    if (result.response === 0) {
      autoUpdater.downloadUpdate().catch((error) => {
        console.error('Update download failed:', error);
        sendUpdateStatus('error', { message: error.message });
      });
    } else {
      sendUpdateStatus('download-deferred');
    }
  });

  autoUpdater.on('update-not-available', () => {
    sendUpdateStatus('not-available');
  });

  autoUpdater.on('download-progress', (progress) => {
    sendUpdateStatus('download-progress', {
      percent: progress && typeof progress.percent === 'number' ? progress.percent : 0,
    });
  });

  autoUpdater.on('error', (error) => {
    console.error('Auto-update error:', error);
    sendUpdateStatus('error', { message: error.message });
  });

  autoUpdater.on('update-downloaded', async () => {
    sendUpdateStatus('downloaded');
    const result = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update ready',
      message: 'A new version has been downloaded. Restart to install it.',
    });

    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.checkForUpdates().catch((error) => {
    console.error('Auto-update check failed:', error);
    sendUpdateStatus('error', { message: error.message });
  });
}

ipcMain.handle('app-version', async () => {
  return app.getVersion();
});

ipcMain.handle('check-for-updates', async () => {
  if (!app.isPackaged || !autoUpdater) {
    return { ok: false, message: 'Updates sind nur in der installierten App verfügbar.' };
  }
  try {
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error.message };
  }
});

ipcMain.handle('download-update', async () => {
  if (!app.isPackaged || !autoUpdater) {
    return { ok: false, message: 'Updates sind nur in der installierten App verfügbar.' };
  }
  try {
    await autoUpdater.downloadUpdate();
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error.message };
  }
});

ipcMain.handle('read-font', async (event, fontName) => {
  try {
    const fontPath = path.join('C:\\Windows\\Fonts', fontName);
    const data = fs.readFileSync(fontPath);
    return data.toString('base64');
  } catch (e) {
    return null;
  }
});

ipcMain.handle('select-folder', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    title: 'Ordner auswählen',
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('save-pdf-to-path', async (event, folderPath, filename, base64data) => {
  try {
    const fullPath = path.join(folderPath, filename);
    const buffer = Buffer.from(base64data, 'base64');
    fs.writeFileSync(fullPath, buffer);
    return { success: true, path: fullPath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('open-pdf', async (event, filePath) => {
  try {
    const { shell } = require('electron');
    await shell.openPath(filePath);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('save-backup', async (event, jsonData) => {
  try {
    const backupDir = path.join(app.getPath('userData'), 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    const now = new Date();
    const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `buchpro_backup_${ts}.json`;
    const fullPath = path.join(backupDir, filename);

    fs.writeFileSync(fullPath, jsonData, 'utf8');

    // Keep only the last 30 backups
    const files = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('buchpro_backup_') && f.endsWith('.json'))
      .sort();
    if (files.length > 30) {
      files.slice(0, files.length - 30).forEach(f => {
        try { fs.unlinkSync(path.join(backupDir, f)); } catch (_) {}
      });
    }

    return { success: true, path: fullPath, filename };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('list-backups', async () => {
  try {
    const backupDir = path.join(app.getPath('userData'), 'backups');
    if (!fs.existsSync(backupDir)) return { success: true, files: [] };

    const files = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('buchpro_backup_') && f.endsWith('.json'))
      .sort()
      .reverse()
      .map(f => {
        const fp = path.join(backupDir, f);
        const stat = fs.statSync(fp);
        return { filename: f, path: fp, size: stat.size, mtime: stat.mtime.toISOString() };
      });

    return { success: true, files, dir: backupDir };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('load-backup', async (event, filePath) => {
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return { success: true, data };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ----------------------------------------------------------------
// DB helper: build the full init-data response
// ----------------------------------------------------------------
function buildInitResponse() {
  const data     = buchProDB.loadAll();
  const settings = buchProDB.getAllSettings();
  const beschHist  = buchProDB.getBeschHist();
  const fixkosten  = buchProDB.getFixkosten();
  const posBadges  = buchProDB.getPosBadges();
  return {
    needsSetup: false,
    dbMissing:  false,
    dbPath:     buchProDB.dbPath,
    data,
    settings,
    beschHist,
    fixkosten,
    posBadges,
    isEmpty: buchProDB.isEmpty(),
  };
}

// ----------------------------------------------------------------
// DB IPC handlers
// ----------------------------------------------------------------

ipcMain.handle('db-get-init-data', async (event) => {
  if (!BuchProDB || !AppConfig) {
    return { needsSetup: false, noDb: true };
  }

  const savedPath = appConfig.get('dbPath');

  if (!savedPath) {
    return { needsSetup: true };
  }

  if (!fs.existsSync(savedPath)) {
    return { needsSetup: false, dbMissing: true, dbPath: savedPath };
  }

  try {
    buchProDB.open(savedPath);
    return buildInitResponse();
  } catch (e) {
    return { needsSetup: false, dbMissing: true, dbPath: savedPath, error: e.message };
  }
});

ipcMain.handle('db-create-new', async (event) => {
  if (!buchProDB || !appConfig) {
    return { error: 'Datenbank-Modul nicht verfügbar. Bitte führen Sie "npm install" im Programmordner aus und starten Sie die App neu.' };
  }
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showSaveDialog(win, {
    title: 'Neue Datenbank erstellen',
    defaultPath: path.join(app.getPath('documents'), 'Mehinachicken.sqlite'),
    filters: [{ name: 'SQLite-Datenbank', extensions: ['sqlite', 'db'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };

  try {
    buchProDB.open(result.filePath);
    appConfig.set('dbPath', result.filePath);
    return buildInitResponse();
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('db-open-existing', async (event) => {
  if (!buchProDB || !appConfig) {
    return { error: 'Datenbank-Modul nicht verfügbar. Bitte führen Sie "npm install" im Programmordner aus und starten Sie die App neu.' };
  }
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    title: 'Datenbank öffnen',
    filters: [{ name: 'SQLite-Datenbank', extensions: ['sqlite', 'db'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true };

  const filePath = result.filePaths[0];
  try {
    buchProDB.open(filePath);
    appConfig.set('dbPath', filePath);
    return buildInitResponse();
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('db-switch', async (event) => {
  if (!buchProDB || !appConfig) {
    return { error: 'Datenbank-Modul nicht verfügbar. Bitte führen Sie "npm install" im Programmordner aus und starten Sie die App neu.' };
  }
  // Opens a file picker and switches to that DB
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    title: 'Andere Datenbank öffnen',
    filters: [{ name: 'SQLite-Datenbank', extensions: ['sqlite', 'db'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true };

  const filePath = result.filePaths[0];
  try {
    buchProDB.open(filePath);
    appConfig.set('dbPath', filePath);
    return buildInitResponse();
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('db-create-switch', async (event) => {
  if (!buchProDB || !appConfig) {
    return { error: 'Datenbank-Modul nicht verfügbar. Bitte führen Sie "npm install" im Programmordner aus und starten Sie die App neu.' };
  }
  // Creates a new DB and switches to it
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showSaveDialog(win, {
    title: 'Neue Datenbank erstellen',
    defaultPath: path.join(app.getPath('documents'), 'Mehinachicken.sqlite'),
    filters: [{ name: 'SQLite-Datenbank', extensions: ['sqlite', 'db'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };

  try {
    buchProDB.open(result.filePath);
    appConfig.set('dbPath', result.filePath);
    return buildInitResponse();
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('db-get-path', async () => {
  return buchProDB && buchProDB.dbPath ? buchProDB.dbPath : null;
});

ipcMain.handle('db-save-all', async (event, data) => {
  if (!buchProDB) return { ok: false };
  try {
    buchProDB.saveAll(data);
    return { ok: true };
  } catch (e) {
    console.error('db-save-all error:', e);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('db-save-setting', async (event, key, value) => {
  if (!buchProDB) return { ok: false };
  try {
    buchProDB.setSetting(key, value);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('db-save-besch-hist', async (event, terms) => {
  if (!buchProDB) return { ok: false };
  try {
    buchProDB.saveBeschHist(terms);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('db-save-fixkosten', async (event, list) => {
  if (!buchProDB) return { ok: false };
  try {
    buchProDB.saveFixkosten(list);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('db-save-pos-badges', async (event, labels) => {
  if (!buchProDB) return { ok: false };
  try {
    buchProDB.savePosBadges(labels);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('db-migrate-localstorage', async (event, lsData) => {
  if (!buchProDB) return { ok: false };
  try {
    buchProDB.migrateFromLocalStorage(lsData);
    return { ok: true };
  } catch (e) {
    console.error('db-migrate-localstorage error:', e);
    return { ok: false, error: e.message };
  }
});

// ----------------------------------------------------------------

app.whenReady().then(() => {
  // Init app config and DB module instances
  if (AppConfig) {
    appConfig = new AppConfig(app.getPath('userData'));
  }
  if (BuchProDB) {
    buchProDB = new BuchProDB();
  }

  loadUpdateTokenFromEnvFiles();
  createWindow();
  setupAutoUpdates();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (buchProDB) buchProDB.close();
});
