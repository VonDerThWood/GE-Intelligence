const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const Store = require('electron-store');

const store = new Store();
const isDev = process.argv.includes('--dev');

let mainWindow = null;
let tray = null;
let schedulerInterval = null;
let isQuitting = false;

// ─── Paths ────────────────────────────────────────────────────────────────────
const resourcesPath = isDev
  ? path.join(__dirname, '..')
  : process.resourcesPath;

const pythonDir = 'C:\\Users\\lette\\GEnius\\python';
const dataDir = path.join(app.getPath('userData'), 'data');
const dataFile = path.join(dataDir, 'latest.json');
const alertsFile = path.join(dataDir, 'alerts.json');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// ─── Window ───────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#1a1209',
    icon: path.join(resourcesPath, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#1a1209',
      symbolColor: '#c9a84c',
      height: 32
    },
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.once('ready-to-show', () => { mainWindow.show(); });
  mainWindow.on('close', (e) => {
    if (!isQuitting) { e.preventDefault(); mainWindow.hide(); }
  });
}

// ─── Tray ─────────────────────────────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(resourcesPath, 'assets', 'icon.ico');
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty();

  tray = new Tray(icon);
  tray.setToolTip('GEnius — RS3 Market Intelligence');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open GEnius', click: () => { mainWindow.show(); mainWindow.focus(); } },
    { label: 'Fetch Now', click: () => runPython('prices') },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } }
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => { mainWindow.show(); mainWindow.focus(); });
}

// ─── Python runner ────────────────────────────────────────────────────────────
function getPythonExecutable() {
  const embeddedPython = path.join(__dirname, '..', 'python-embed', 'python.exe');
  if (fs.existsSync(embeddedPython)) {
    return embeddedPython;
  }
  return 'C:\\Python314\\python.exe';
}

function runPython(mode = 'prices') {
  return new Promise((resolve, reject) => {
    const python = getPythonExecutable();
    const scriptPath = path.join(pythonDir, 'run.py');
    const webhookUrl = store.get('discordWebhook', '');
    let cmd = `"${python}" "${scriptPath}" --mode=${mode} --data-dir="${dataDir}"`;
    if (webhookUrl) cmd += ` --webhook=${webhookUrl}`;

    console.log('[Python] Running:', cmd);

    exec(cmd, { env: process.env }, (error, stdout, stderr) => {
      if (error) {
        console.error('[Python] Error:', error.message);
        notifyRenderer('fetch-error', { error: error.message });
        reject(error);
      } else {
        console.log('[Python] Done:', stdout.slice(0, 300));
        notifyRenderer('fetch-complete', { mode, timestamp: Date.now() });
        resolve(stdout);
      }
    });
  });
}

function notifyRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

// ─── Scheduler ────────────────────────────────────────────────────────────────
function startScheduler() {
  stopScheduler();
  const intervalMinutes = store.get('fetchInterval', 15);
  const ms = intervalMinutes * 60 * 1000;
  console.log(`[Scheduler] Fetching every ${intervalMinutes} min`);
  schedulerInterval = setInterval(() => runPython('prices'), ms);
}

function stopScheduler() {
  if (schedulerInterval) { clearInterval(schedulerInterval); schedulerInterval = null; }
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────
ipcMain.handle('get-data', async () => {
  try {
    if (!fs.existsSync(dataFile)) return { items: [], timestamp: null };
    const raw = fs.readFileSync(dataFile, 'utf8');
    return JSON.parse(raw);
  } catch { return { items: [], timestamp: null }; }
});

ipcMain.handle('fetch-now', async (_, mode) => {
  try { await runPython(mode || 'prices'); return { success: true }; }
  catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('get-settings', () => ({
  discordWebhook: store.get('discordWebhook', ''),
  fetchInterval: store.get('fetchInterval', 15),
  theme: store.get('theme', 'dark'),
  notifications: store.get('notifications', true)
}));

ipcMain.handle('save-settings', (_, settings) => {
  Object.entries(settings).forEach(([k, v]) => store.set(k, v));
  startScheduler();
  return { success: true };
});

ipcMain.handle('get-watchlist', () => store.get('watchlist', []));
ipcMain.handle('set-watchlist', (_, list) => { store.set('watchlist', list); return { success: true }; });

ipcMain.handle('get-alerts', () => {
  try {
    if (!fs.existsSync(alertsFile)) return [];
    return JSON.parse(fs.readFileSync(alertsFile, 'utf8'));
  } catch { return []; }
});

ipcMain.handle('save-alert', (_, alert) => {
  let alerts = [];
  try {
    if (fs.existsSync(alertsFile)) alerts = JSON.parse(fs.readFileSync(alertsFile, 'utf8'));
  } catch {}
  const idx = alerts.findIndex(a => a.id === alert.id);
  if (idx >= 0) alerts[idx] = alert; else alerts.push(alert);
  fs.writeFileSync(alertsFile, JSON.stringify(alerts, null, 2));
  return { success: true };
});

ipcMain.handle('delete-alert', (_, id) => {
  let alerts = [];
  try {
    if (fs.existsSync(alertsFile)) alerts = JSON.parse(fs.readFileSync(alertsFile, 'utf8'));
  } catch {}
  alerts = alerts.filter(a => a.id !== id);
  fs.writeFileSync(alertsFile, JSON.stringify(alerts, null, 2));
  return { success: true };
});

ipcMain.handle('open-external', (_, url) => shell.openExternal(url));

ipcMain.handle('show-notification', (_, { title, body }) => {
  if (store.get('notifications', true)) {
    new Notification({ title, body, icon: path.join(resourcesPath, 'assets', 'icon.ico') }).show();
  }
});

ipcMain.handle('get-data-dir', () => dataDir);

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  createTray();
  startScheduler();
  setTimeout(() => runPython('prices'), 3000);
});

app.on('window-all-closed', (e) => {
  if (process.platform !== 'darwin') e.preventDefault();
});

app.on('activate', () => {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  else mainWindow.show();
});

app.on('before-quit', () => { isQuitting = true; stopScheduler(); });
