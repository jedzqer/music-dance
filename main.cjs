const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

let mainWindow;

const settingsPath = path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    }
  } catch {}
  return {};
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
  } catch (err) {
    console.error('保存设置失败:', err);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs')
    },
    icon: path.join(__dirname, 'dist/favicon.ico'),
    title: '音乐可视化',
    backgroundColor: '#050510'
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('enter-full-screen', () => {
    mainWindow?.webContents.send('fullscreen-changed', true);
  });

  mainWindow.on('leave-full-screen', () => {
    mainWindow?.webContents.send('fullscreen-changed', false);
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.wma', '.webm', '.opus'
]);

function isAudioFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  return AUDIO_EXTENSIONS.has(ext);
}

async function scanDirectory(dirPath) {
  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  const audioFiles = [];

  for (const entry of entries) {
    if (entry.isFile() && isAudioFile(entry.name)) {
      const filePath = path.join(dirPath, entry.name);
      const stats = await fs.promises.stat(filePath);
      audioFiles.push({
        name: entry.name,
        path: filePath,
        size: stats.size,
        modified: stats.mtime.toISOString()
      });
    }
  }

  return audioFiles.sort((a, b) => a.name.localeCompare(b.name));
}

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '选择音乐文件夹'
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
});

ipcMain.handle('scan-folder', async (event, folderPath) => {
  try {
    return await scanDirectory(folderPath);
  } catch (error) {
    console.error('扫描文件夹失败:', error);
    throw error;
  }
});

ipcMain.handle('get-last-folder', () => {
  const settings = loadSettings();
  const folderPath = settings.lastFolder;
  if (folderPath && fs.existsSync(folderPath)) {
    return folderPath;
  }
  return null;
});

ipcMain.handle('save-last-folder', (event, folderPath) => {
  const settings = loadSettings();
  settings.lastFolder = folderPath;
  saveSettings(settings);
});

ipcMain.handle('get-volume', () => {
  const settings = loadSettings();
  return typeof settings.volume === 'number' ? settings.volume : 80;
});

ipcMain.handle('save-volume', (event, volume) => {
  const settings = loadSettings();
  settings.volume = volume;
  saveSettings(settings);
});

ipcMain.handle('get-file-url', (event, filePath) => {
  return `file://${filePath}`;
});

ipcMain.handle('read-file', async (event, filePath) => {
  try {
    const buffer = await fs.promises.readFile(filePath);
    return new Uint8Array(buffer);
  } catch (error) {
    console.error('读取文件失败:', error);
    throw error;
  }
});

ipcMain.on('window-minimize', () => {
  mainWindow?.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.on('window-close', () => {
  mainWindow?.close();
});

ipcMain.on('window-toggle-fullscreen', () => {
  if (mainWindow) {
    const willBeFullscreen = !mainWindow.isFullScreen();
    mainWindow.setFullScreen(willBeFullscreen);
    mainWindow.webContents.send('fullscreen-changed', willBeFullscreen);
  }
});
