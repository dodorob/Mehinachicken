const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('fs');
let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch (error) {
  console.warn('electron-updater is unavailable; auto updates are disabled.', error);
}
const path = require('path');

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

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-downloaded', async () => {
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

  autoUpdater.checkForUpdatesAndNotify().catch((error) => {
    console.error('Auto-update check failed:', error);
  });
}

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
  const result = await dialog.showOpenDialog({
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

app.whenReady().then(() => {
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
