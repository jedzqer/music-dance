const { app, BrowserWindow, ipcMain, dialog, desktopCapturer, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const extractZip = require('extract-zip');
const { pathToFileURL } = require('url');
const os = require('os');

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

let mainWindow;

const settingsPath = path.join(app.getPath('userData'), 'settings.json');
const visualizersDir = path.join(app.getPath('userData'), 'visualizers');

function getBundledPresetsDir() {
  // Packaged builds keep the editable templates outside app.asar.
  return app.isPackaged
    ? path.join(process.resourcesPath, 'presets')
    : path.join(__dirname, 'src', 'presets');
}

function ensureVisualizersDir() {
  if (!fs.existsSync(visualizersDir)) {
    fs.mkdirSync(visualizersDir, { recursive: true });
  }

  // Release templates and their development documentation without replacing
  // files the user may have customized in the visualizers folder.
  const defaultPresetsDir = getBundledPresetsDir();
  if (fs.existsSync(defaultPresetsDir)) {
    try {
      const entries = fs.readdirSync(defaultPresetsDir, { withFileTypes: true });
      for (const entry of entries) {
        const sourcePath = path.join(defaultPresetsDir, entry.name);
        const targetPath = path.join(visualizersDir, entry.name);
        if (fs.existsSync(targetPath)) continue;

        if (entry.isDirectory()) {
          copyFolderRecursiveSync(sourcePath, targetPath);
        } else if (entry.isFile()) {
          fs.copyFileSync(sourcePath, targetPath);
        }
      }
    } catch (e) {
      console.warn('释放预设开发文件失败:', e);
    }
  }
}

function copyFolderRecursiveSync(source, target) {
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }
  const files = fs.readdirSync(source);
  for (const file of files) {
    const curSource = path.join(source, file);
    const curTarget = path.join(target, file);
    if (fs.lstatSync(curSource).isDirectory()) {
      copyFolderRecursiveSync(curSource, curTarget);
    } else {
      fs.copyFileSync(curSource, curTarget);
    }
  }
}

function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    }
  } catch (e) { console.warn('设置文件读取失败:', e.message); }
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
    icon: path.join(__dirname, 'icon.ico'),
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

app.whenReady().then(() => {
  ensureVisualizersDir();
  createWindow();
});

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

ipcMain.handle('read-file', async (event, filePath) => {
  try {
    const buffer = await fs.promises.readFile(filePath);
    return new Uint8Array(buffer);
  } catch (error) {
    console.error('读取文件失败:', error);
    throw error;
  }
});

// 从文件头部提取封面图片（只读前2MB，不加载整个文件）
function readSyncSafeInt(buf, off) {
  return (buf[off] << 21) | (buf[off + 1] << 14) | (buf[off + 2] << 7) | buf[off + 3];
}

function readInt32BE(buf, off) {
  return ((buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]) >>> 0;
}

function readInt32LE(buf, off) {
  return (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0;
}

function extractId3v2Cover(buf) {
  if (buf[0] !== 0x49 || buf[1] !== 0x44 || buf[2] !== 0x33) return null; // "ID3"
  const version = buf[3]; // 3 or 4
  const tagSize = readSyncSafeInt(buf, 6);
  let pos = 10;
  const end = Math.min(buf.length, 10 + tagSize);

  while (pos + 10 <= end) {
    const frameId = String.fromCharCode(buf[pos], buf[pos + 1], buf[pos + 2], buf[pos + 3]);
    if (/^\x00+$/.test(frameId)) break;
    const frameSize = version === 4 ? readSyncSafeInt(buf, pos + 4) : readInt32BE(buf, pos + 4);
    const frameStart = pos + 10;
    const frameEnd = frameStart + frameSize;
    if (frameSize <= 0 || frameEnd > end) break;

    if (frameId === 'APIC') {
      let fp = frameStart;
      const encoding = buf[fp++];
      // Skip MIME type (null-terminated)
      let mimeStart = fp;
      while (fp < frameEnd && buf[fp] !== 0) fp++;
      const mime = buf.slice(mimeStart, fp).toString('latin1');
      fp++; // skip null
      fp++; // skip picture type
      // Skip description (null-terminated, encoding-dependent)
      if (encoding === 1 || encoding === 2) {
        while (fp + 1 < frameEnd && !(buf[fp] === 0 && buf[fp + 1] === 0)) fp += 2;
        fp += 2;
      } else {
        while (fp < frameEnd && buf[fp] !== 0) fp++;
        fp++;
      }
      if (fp < frameEnd) {
        const imgData = buf.slice(fp, frameEnd);
        return { mime: mime || 'image/jpeg', data: imgData };
      }
    }
    pos = frameEnd;
  }
  return null;
}

function extractFlacCover(buf) {
  // Check fLaC signature
  if (buf[0] !== 0x66 || buf[1] !== 0x4c || buf[2] !== 0x61 || buf[3] !== 0x43) return null;
  let offset = 4;
  while (offset + 4 <= buf.length) {
    const isLast = (buf[offset] & 0x80) !== 0;
    const blockType = buf[offset] & 0x7f;
    const blockLength = (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3];
    offset += 4;
    if (offset + blockLength > buf.length) break;

    if (blockType === 6) { // Picture block
      let pos = offset;
      const picType = readInt32BE(buf, pos); pos += 4;
      const mimeLen = readInt32BE(buf, pos); pos += 4;
      if (pos + mimeLen > buf.length) break;
      const mime = buf.slice(pos, pos + mimeLen).toString('utf-8');
      pos += mimeLen;
      const descLen = readInt32BE(buf, pos); pos += 4;
      pos += descLen + 16; // skip description + 4 uint32s (width, height, depth, colors)
      if (pos + 4 > buf.length) break;
      const dataLen = readInt32BE(buf, pos); pos += 4;
      if (pos + dataLen <= buf.length) {
        return { mime: mime || 'image/jpeg', data: buf.slice(pos, pos + dataLen) };
      }
    }

    offset += blockLength;
    if (isLast) break;
  }
  return null;
}

function extractWavCover(buf) {
  if (String.fromCharCode(buf[0], buf[1], buf[2], buf[3]) !== 'RIFF') return null;
  if (String.fromCharCode(buf[8], buf[9], buf[10], buf[11]) !== 'WAVE') return null;
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const chunkId = String.fromCharCode(buf[offset], buf[offset + 1], buf[offset + 2], buf[offset + 3]);
    const chunkSize = readInt32LE(buf, offset + 4);
    const dataOffset = offset + 8;
    if (dataOffset + chunkSize > buf.length) break;
    if (chunkId === 'ID3 ' || chunkId === 'id3 ') {
      const id3Data = buf.slice(dataOffset, dataOffset + chunkSize);
      const cover = extractId3v2Cover(id3Data);
      if (cover) return cover;
    }
    offset = dataOffset + chunkSize + (chunkSize % 2);
  }
  return null;
}

ipcMain.handle('extract-cover', async (event, filePath) => {
  try {
    const READ_SIZE = 2 * 1024 * 1024; // 2MB — metadata + cover art are at the start
    const fh = await fs.promises.open(filePath, 'r');
    try {
      const { buffer } = await fh.read(Buffer.alloc(READ_SIZE), 0, READ_SIZE, 0);
      const ext = path.extname(filePath).toLowerCase();
      let cover = null;
      if (ext === '.flac') {
        cover = extractFlacCover(buffer);
      } else if (ext === '.wav') {
        cover = extractWavCover(buffer) || extractId3v2Cover(buffer);
      } else {
        cover = extractId3v2Cover(buffer);
      }
      if (!cover) return null;
      return `data:${cover.mime};base64,${cover.data.toString('base64')}`;
    } finally {
      await fh.close();
    }
  } catch (_) {
    return null;
  }
});

ipcMain.handle('get-settings', () => loadSettings());

ipcMain.handle('save-settings', (event, settings) => {
  const current = loadSettings();
  Object.assign(current, settings);
  saveSettings(current);
});

ipcMain.handle('read-lrc-file', async (event, filePath) => {
  try {
    return await fs.promises.readFile(filePath, 'utf-8');
  } catch (_) {
    return null;
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

ipcMain.handle('get-desktop-sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
  return sources.map(s => ({ id: s.id, name: s.name, display_id: s.display_id }));
});

// ─── Visualizer Management IPC ───
ipcMain.handle('list-visualizers', async () => {
  ensureVisualizersDir();
  const list = [];

  try {
    const entries = await fs.promises.readdir(visualizersDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const dirPath = path.join(visualizersDir, entry.name);
        const indexPath = path.join(dirPath, 'index.html');
        if (fs.existsSync(indexPath)) {
          let manifest = {
            id: entry.name,
            name: entry.name,
            author: 'Custom',
            description: '',
            icon: '✨'
          };
          const manifestPath = path.join(dirPath, 'manifest.json');
          if (fs.existsSync(manifestPath)) {
            try {
              const manifestContent = JSON.parse(await fs.promises.readFile(manifestPath, 'utf-8'));
              manifest = { ...manifest, ...manifestContent, id: entry.name };
            } catch (_) {}
          }
          list.push({
            ...manifest,
            path: dirPath,
            entryUrl: pathToFileURL(indexPath).href,
            isBuiltIn: false
          });
        }
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
        const filePath = path.join(visualizersDir, entry.name);
        const nameWithoutExt = path.basename(entry.name, path.extname(entry.name));
        list.push({
          id: nameWithoutExt,
          name: nameWithoutExt,
          author: 'Custom',
          description: '单 HTML 可视化模板',
          icon: '📄',
          path: filePath,
          entryUrl: pathToFileURL(filePath).href,
          isBuiltIn: false
        });
      }
    }
  } catch (err) {
    console.error('获取可视化列表失败:', err);
  }

  return list;
});

ipcMain.handle('open-visualizers-folder', async () => {
  ensureVisualizersDir();
  await shell.openPath(visualizersDir);
});

ipcMain.handle('import-visualizer-dialog', async () => {
  ensureVisualizersDir();
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '导入自定义可视化文件',
    filters: [
      { name: '可视化包与网页', extensions: ['zip', 'html', 'htm'] }
    ],
    properties: ['openFile']
  });

  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  const ext = path.extname(filePath).toLowerCase();
  const baseName = path.basename(filePath, ext);

  if (ext === '.zip') {
    const targetDir = path.join(visualizersDir, baseName);
    if (fs.existsSync(targetDir)) {
      throw new Error('同名可视化已存在，请先删除旧版本或更换文件名');
    }
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'musicdance-viz-'));
    try {
      await extractZip(filePath, { dir: tempDir });
      const topEntries = await fs.promises.readdir(tempDir, { withFileTypes: true });
      const packageRoot = topEntries.length === 1 && topEntries[0].isDirectory()
        ? path.join(tempDir, topEntries[0].name)
        : tempDir;
      const indexPath = path.join(packageRoot, 'index.html');
      if (!fs.existsSync(indexPath)) {
        throw new Error('可视化包缺少根目录 index.html');
      }
      await fs.promises.rename(packageRoot, targetDir);
    } finally {
      if (fs.existsSync(tempDir)) {
        await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    }
    return { success: true, id: baseName };
  } else if (ext === '.html' || ext === '.htm') {
    const targetFile = path.join(visualizersDir, path.basename(filePath));
    if (fs.existsSync(targetFile)) {
      throw new Error('同名可视化已存在，请先删除旧版本或更换文件名');
    }
    await fs.promises.copyFile(filePath, targetFile);
    return { success: true, id: baseName };
  }
  return null;
});

ipcMain.handle('delete-visualizer', async (event, vizId) => {
  ensureVisualizersDir();
  const targetDir = path.join(visualizersDir, vizId);
  const targetHtml = path.join(visualizersDir, `${vizId}.html`);

  try {
    if (fs.existsSync(targetDir)) {
      await fs.promises.rm(targetDir, { recursive: true, force: true });
      return true;
    }
    if (fs.existsSync(targetHtml)) {
      await fs.promises.unlink(targetHtml);
      return true;
    }
  } catch (err) {
    console.error('删除可视化失败:', err);
  }
  return false;
});
