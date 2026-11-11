const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

// Папка с данными: ~/.config/zhurnal-repetitora (Linux), %APPDATA%\zhurnal-repetitora (Windows)
app.setPath('userData', path.join(app.getPath('appData'), 'zhurnal-repetitora'));
const dataFile = () => path.join(app.getPath('userData'), 'journal.json');
let win = null;

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const safeName = (n) => String(n).replace(/[\\/:*?"<>|]/g, '').trim() || 'file';

function loadData() {
  const f = dataFile();
  if (!fs.existsSync(f)) return null;
  try {
    return readJson(f);
  } catch (e) {
    // файл повреждён: сохраняем его копию и пробуем предыдущую версию
    try { fs.copyFileSync(f, f + '.corrupt-' + Date.now()); } catch (e2) { /* ignore */ }
    try { return readJson(f + '.bak'); } catch (e3) { return null; }
  }
}

function writeData(text) {
  const f = dataFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  if (fs.existsSync(f)) {
    try { fs.copyFileSync(f, f + '.bak'); } catch (e) { /* ignore */ }
  }
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, f);
}

// ---------- доски: отдельный файл на урок ----------
const boardsDir = () => path.join(app.getPath('userData'), 'boards');
const okId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
const boardFile = (id) => path.join(boardsDir(), id + '.json');
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}
function readAllBoards() {
  const out = {};
  try {
    fs.readdirSync(boardsDir()).forEach((f) => {
      if (!f.endsWith('.json')) return;
      const id = f.slice(0, -5);
      if (!okId(id)) return;
      try { out[id] = readJson(path.join(boardsDir(), f)); } catch (e) { /* пропускаем битый файл */ }
    });
  } catch (e) { /* папки ещё нет */ }
  return out;
}
ipcMain.handle('board:load', (e, id) => {
  if (!okId(id)) return { data: null };
  try { return { data: readJson(boardFile(id)) }; } catch (err) { return { data: null }; }
});
ipcMain.handle('board:save', (e, id, text) => {
  if (!okId(id)) throw new Error('bad id');
  writeAtomic(boardFile(id), String(text));
  return true;
});
ipcMain.on('board:saveSync', (e, id, text) => {
  try { if (okId(id)) writeAtomic(boardFile(id), String(text)); e.returnValue = true; } catch (err) { e.returnValue = false; }
});
ipcMain.handle('board:delete', (e, id) => {
  if (!okId(id)) return false;
  try { fs.unlinkSync(boardFile(id)); } catch (err) { /* нет файла */ }
  return true;
});
ipcMain.handle('file:savePng', async (e, name, dataUrl) => {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('documents'), safeName(name)),
    filters: [{ name: 'Картинка', extensions: ['png'] }],
  });
  if (r.canceled || !r.filePath) return { ok: false };
  fs.writeFileSync(r.filePath, Buffer.from(String(dataUrl).replace(/^data:image\/png;base64,/, ''), 'base64'));
  return { ok: true };
});

ipcMain.handle('data:load', () => ({ path: dataFile(), data: loadData() }));
ipcMain.handle('data:save', (e, text) => { writeData(String(text)); return true; });
ipcMain.on('data:saveSync', (e, text) => {
  try { writeData(String(text)); e.returnValue = true; } catch (err) { e.returnValue = false; }
});
ipcMain.handle('copy', (e, text) => { clipboard.writeText(String(text)); return true; });
ipcMain.handle('dir:show', () => shell.openPath(app.getPath('userData')));

ipcMain.handle('file:saveHtml', async (e, name, html) => {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('documents'), safeName(name)),
    filters: [{ name: 'Веб-страница', extensions: ['html'] }],
  });
  if (r.canceled || !r.filePath) return { ok: false };
  fs.writeFileSync(r.filePath, String(html));
  return { ok: true, path: r.filePath };
});

ipcMain.handle('backup:export', async (e, text) => {
  const day = new Date().toISOString().slice(0, 10);
  try {
    const obj = JSON.parse(String(text));
    obj.boards = readAllBoards();
    text = JSON.stringify(obj);
  } catch (err) { /* оставляем как есть */ }
  const r = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('documents'), `zhurnal-kopiya-${day}.json`),
    filters: [{ name: 'Копия данных', extensions: ['json'] }],
  });
  if (r.canceled || !r.filePath) return { ok: false };
  fs.writeFileSync(r.filePath, String(text));
  return { ok: true };
});

ipcMain.handle('backup:import', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'Копия данных', extensions: ['json'] }],
  });
  if (r.canceled || !r.filePaths.length) return { ok: false };
  try {
    const data = readJson(r.filePaths[0]);
    if (!data || typeof data !== 'object' || (!data.students && !data.lessons)) return { error: 'Это не копия данных журнала.' };
    if (data.boards && typeof data.boards === 'object') {
      Object.keys(data.boards).forEach((id) => {
        if (okId(id)) { try { writeAtomic(boardFile(id), JSON.stringify(data.boards[id])); } catch (e2) { /* ignore */ } }
      });
    }
    delete data.boards;
    return { ok: true, data };
  } catch (err) {
    return { error: 'Не удалось прочитать файл.' };
  }
});

function createWindow() {
  win = new BrowserWindow({
    width: 1100, height: 820, minWidth: 360, minHeight: 520,
    title: 'Журнал репетитора',
    backgroundColor: '#EEF2F8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (ev) => ev.preventDefault());
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
