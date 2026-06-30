const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const storage = require('./backend-js/storage.js');
const { createGeniusApi } = require('./backend-js/api.js');

// Was electron-store — replaced with storage.createKVStore (see its
// comment) so this isn't tied to Electron's app.getPath() at all, which
// matters for ever reusing this on a non-Electron (e.g. Capacitor) build.
// `api` wraps almost everything that used to be inline in this file's IPC
// handlers — see backend-js/api.js. It has zero Electron dependencies, so
// a future mobile build could call its functions directly with no IPC
// layer in between at all. What's LEFT in this file is genuinely
// Electron-specific: window/tray/notification lifecycle, the scheduler,
// dialogs, and the thin ipcMain.handle wrappers themselves.
// Both created inside app.whenReady below, once app.getPath() is actually
// available — every real call site is inside an IPC handler or a
// scheduler callback, all of which only run after that.
let store;
let api;
const isDev = process.argv.includes('--dev');

// Persistent white-flash-on-launch fix: this is a GPU compositor swap-chain
// issue (a literal white frame gets presented before the actual painted
// frame, at the driver/hardware level) — happens independent of
// backgroundColor/show:false/ready-to-show timing, and is more common with
// custom title bar overlays like this app uses. Forcing software rendering
// trades a little GPU-accelerated smoothness (negligible for a data-table
// app like this) for eliminating the white frame at its source. Must be
// called before app is ready.
app.disableHardwareAcceleration();
// Separate Windows-specific quirk, same symptom family: Chromium's "Native
// Window Occlusion Tracking" (Windows 10 1903+) can miscalculate a
// window's visibility state right at creation and produce a blank/
// transparent/white frame independent of the GPU setting above. This is
// the standard fix — disabling occlusion tracking outright. Trying this
// alongside the hardware-acceleration fix rather than instead of it,
// since that one already fixed the original (worse) white flashbang.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

let mainWindow = null;
let tray = null;
let schedulerInterval = null;
let isQuitting = false;

// GEnius never enforced single-instance — nothing stopped two full app
// processes from running at once, each with its own independent
// in-memory history-download queue, both racing to write the same
// history.json on disk (confirmed for real: two windows open at once
// showed wildly different download progress, e.g. one stuck on "top
// 300" while the other was past 1800, because each was tracking its
// OWN queue against a file the other was also writing to). This claims
// the lock at launch; if a second instance starts, it quits immediately
// and tells the first instance to focus its existing window instead.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

// ─── Paths (defined as lets, set after app ready) ─────────────────────────────
const resourcesPath = isDev
  ? path.join(__dirname, '..')
  : process.resourcesPath;

// dataDir must be set after app is ready (app.getPath requires it)
let dataDir;

// ─── Window ───────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#1a1209',
    // Explicit, not just relying on the default — with hardware
    // acceleration disabled (see app.disableHardwareAcceleration() below,
    // the actual white-flash fix), the native window surface can render
    // as transparent/see-through for a moment until the software-rendered
    // frame actually paints, instead of immediately showing
    // backgroundColor. transparent:false plus re-asserting the color
    // below right after creation closes that gap.
    transparent: false,
    // Windows draws the titleBarOverlay strip via DWM, not Chromium — without
    // this it can default to a light/white theme for the first frame or two
    // before titleBarOverlay.color below actually takes effect, causing an
    // inconsistent white flash independent of page-load timing.
    darkTheme: true,
    icon: path.join(resourcesPath, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#1a1209',
      symbolColor: '#c9a84c',
      height: 32
    },
    show: false
  });
  // Re-assert immediately after creation, not just in the constructor —
  // closes the gap where the window surface can briefly render as
  // transparent before the page's first paint, with hardware acceleration off.
  mainWindow.setBackgroundColor('#1a1209');

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.once('ready-to-show', () => { mainWindow.show(); });
  mainWindow.on('close', (e) => {
    if (!isQuitting) { e.preventDefault(); mainWindow.hide(); }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
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

// Fetches prices/news/etc by running run.js's main() in-process. Kept the
// historical name (was a Python child-process spawn before the JS port,
// see SESSION_LOG.md 2026-06-26) since renaming would touch several call
// sites for no functional benefit.
function runPython(mode = 'prices') {
  return (async () => {
    const { main: runJs } = require('./backend-js/run.js');
    const webhookUrl = store.get('discordWebhook', '');
    const argv = [`--mode=${mode}`, `--data-dir=${dataDir}`];
    if (webhookUrl) argv.push(`--webhook=${webhookUrl}`);

    console.log('[run.js] Running with args:', argv.join(' '));

    try {
      await api.historyLoadedPromise; // don't pass a still-loading, partial historyData
      await runJs(argv, api.historyData);
      notifyRenderer('fetch-complete', { mode, timestamp: Date.now() });
      if (mode === 'prices' || !mode) await api.updateSnapshots();
    } catch (error) {
      console.error('[run.js] Error:', error.message);
      notifyRenderer('fetch-error', { error: error.message });
      throw error;
    }
  })();
}

function notifyRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

// ─── Notifications ──────────────────────────────────────────────────────────
// The actual "what should fire" logic (including all the dedup-log
// bookkeeping) lives in api.js now, shared with the mobile bridge — these
// are just thin wrappers that fire each returned descriptor as a real
// desktop Notification. See api.js's "Notification checks" section for why.
async function checkDxpNotifications() {
  for (const n of await api.getDxpNotifications()) {
    new Notification({ title: n.title, body: n.body, icon: path.join(resourcesPath, 'assets', 'icon.ico') }).show();
  }
}

async function checkWatchlistDigest() {
  const digest = await api.getWatchlistDigest();
  if (digest) {
    new Notification({ title: digest.title, body: digest.body, icon: path.join(resourcesPath, 'assets', 'icon.ico') }).show();
  }
}

async function checkReminders() {
  for (const r of await api.getDueReminders()) {
    new Notification({ title: r.title, body: r.body, icon: path.join(resourcesPath, 'assets', 'icon.ico') }).show();
  }
}

// ─── Scheduler ────────────────────────────────────────────────────────────────
function startScheduler() {
  stopScheduler();
  const intervalMinutes = store.get('fetchInterval', 15);
  const ms = intervalMinutes * 60 * 1000;
  console.log(`[Scheduler] Fetching every ${intervalMinutes} min`);
  schedulerInterval = setInterval(() => { runPython('prices'); checkDxpNotifications(); checkWatchlistDigest(); checkReminders(); }, ms);
}

function stopScheduler() {
  if (schedulerInterval) { clearInterval(schedulerInterval); schedulerInterval = null; }
}

// ─── IPC handlers ───────────────────────────────────────────────────────────────
// Every handler below is a thin wrapper around api.js — the actual logic
// lives there (see its file comment for why), with zero Electron
// dependencies, so a future Capacitor/mobile build could call the same
// functions directly with no IPC layer in between at all.
ipcMain.handle('get-data', () => api.getData());

ipcMain.handle('quit-app', () => { isQuitting = true; app.quit(); return { success: true }; });
ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('get-dxp-intelligence', async (_, opts) => {
  try { return await api.getDxpIntelligence(opts); }
  catch (e) { console.error('[DXP Intel] get-dxp-intelligence failed:', e.message); return {}; }
});

ipcMain.handle('get-dxp-events', async () => {
  try { return await api.getDxpEvents(); }
  catch (e) { console.error('[DXP Intel] get-dxp-events failed:', e.message); return []; }
});

ipcMain.handle('fetch-now', async (_, mode) => {
  try { await runPython(mode || 'prices'); return { success: true }; }
  catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('get-settings', () => ({
  discordWebhook:     store.get('discordWebhook', ''),
  fetchInterval:      store.get('fetchInterval', 15),
  theme:              store.get('theme', 'dark'),
  notifications:      store.get('notifications', true),
  expensiveThreshold: store.get('expensiveThreshold', 500000000),
  navOrder:           store.get('navOrder', []),
  uiScale:            store.get('uiScale', 100),
  detailPanelWidth:   store.get('detailPanelWidth', 296),
  columnWidths:       store.get('columnWidths', {}),
  showThumbnails:     store.get('showThumbnails', true),
  devMode:            store.get('devMode', false),
}));

ipcMain.handle('save-settings', (_, settings) => {
  Object.entries(settings).forEach(([k, v]) => store.set(k, v));
  startScheduler();
  return { success: true };
});

ipcMain.handle('get-watchlist', () => store.get('watchlist', []));
ipcMain.handle('set-watchlist', (_, list) => { store.set('watchlist', list); return { success: true }; });

// DXP Almanac watchlist — deliberately separate from the main watchlist
// above (per TODO.txt spec). Item ids are stored as strings to match how
// dxp_intelligence.json keys its per-item entries.
ipcMain.handle('get-dxp-watchlist', () => store.get('dxpWatchlist', []));
ipcMain.handle('set-dxp-watchlist', (_, list) => { store.set('dxpWatchlist', list); return { success: true }; });

ipcMain.handle('get-dxp-notification-settings', () => store.get('dxpNotificationSettings', {
  enabled: false, buyAlerts: true, sellAlerts: true, announceAlerts: true, windowApproachingAlerts: true,
}));
ipcMain.handle('set-dxp-notification-settings', (_, settings) => {
  store.set('dxpNotificationSettings', settings);
  return { success: true };
});

// dailyThresholdPct gates a 1-day move, trendThresholdPct gates a 7-day
// move — kept separate (trend defaults a bit higher) since a sustained
// week-long drift is a different signal than a single-day spike.
ipcMain.handle('get-watchlist-notification-settings', () => store.get('watchlistNotificationSettings', {
  enabled: false, dailyThresholdPct: 5, trendThresholdPct: 7,
}));
ipcMain.handle('set-watchlist-notification-settings', (_, settings) => {
  store.set('watchlistNotificationSettings', settings);
  return { success: true };
});

// Date-based reminders (Alerts tab, second section) — one-shot, not tied
// to price at all. {id, itemName, dueDate ('YYYY-MM-DD'), message, fired}.
ipcMain.handle('get-reminders', () => store.get('reminders', []));
ipcMain.handle('save-reminder', (_, reminder) => {
  const reminders = store.get('reminders', []);
  const i = reminders.findIndex(r => r.id === reminder.id);
  if (i >= 0) reminders[i] = reminder; else reminders.push(reminder);
  store.set('reminders', reminders);
  return { success: true };
});
ipcMain.handle('delete-reminder', (_, id) => {
  store.set('reminders', store.get('reminders', []).filter(r => r.id !== id));
  return { success: true };
});

ipcMain.handle('get-hidden',    () => store.get('hiddenItems', []));
ipcMain.handle('set-hidden',    (_, list) => { store.set('hiddenItems', list); return { success: true }; });

ipcMain.handle('get-notes',  () => store.get('itemNotes', {}));
ipcMain.handle('save-note',  (_, { id, text }) => { const notes = store.get('itemNotes', {}); if (text) notes[id] = text; else delete notes[id]; store.set('itemNotes', notes); return { success: true }; });

ipcMain.handle('get-shorthands',  () => store.get('userShorthands', {}));
ipcMain.handle('save-shorthands', (_, sh) => { store.set('userShorthands', sh); return { success: true }; });

ipcMain.handle('open-external', (_, url) => {
  if (/^https?:\/\//.test(url)) shell.openExternal(url);
});

ipcMain.handle('export-data', async () => {
  const { dialog } = require('electron');
  const { filePath, canceled } = await dialog.showSaveDialog({
    title: 'Export GEnius Data',
    defaultPath: `genius-backup-${new Date().toISOString().slice(0,10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { canceled: true };
  try {
    await storage.writeJSON(filePath, await api.buildExportBundle(), { pretty: true });
    return { success: true };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('import-data', async () => {
  const { dialog } = require('electron');
  const { filePaths, canceled } = await dialog.showOpenDialog({
    title: 'Import GEnius Data',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths.length) return { canceled: true };
  try {
    const bundle = await storage.readJSON(filePaths[0], null);
    return await api.applyImportBundle(bundle);
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('get-alerts', () => api.getAlerts());
ipcMain.handle('save-alert', (_, alert) => api.saveAlert(alert));
ipcMain.handle('delete-alert', (_, id) => api.deleteAlert(id));

ipcMain.handle('get-portfolio', () => api.getPortfolio());
ipcMain.handle('save-position', (_, position) => api.savePosition(position));
ipcMain.handle('delete-position', (_, id) => api.deletePosition(id));
ipcMain.handle('sell-position', (_, payload) => api.sellPosition(payload));
ipcMain.handle('reopen-position', (_, id) => api.reopenPosition(id));

ipcMain.handle('get-item-stats', async (_, itemName) => api.getItemStats(itemName));

ipcMain.handle('show-notification', (_, { title, body }) => {
  if (store.get('notifications', true)) {
    new Notification({ title, body, icon: path.join(resourcesPath, 'assets', 'icon.ico') }).show();
  }
});

ipcMain.handle('test-notification', (_, { title, body }) => {
  try {
    new Notification({ title, body, icon: path.join(resourcesPath, 'assets', 'icon.ico') }).show();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('get-data-dir', () => dataDir);

ipcMain.handle('get-overrides', () => api.getOverrides());
ipcMain.handle('save-overrides', (_, overrides) => api.saveOverrides(overrides));

ipcMain.handle('get-history-status', () => api.getHistoryStatus());

// Cheap full id list (a few thousand numbers) so the UI can show a
// "history still loading" note for any specific item not yet covered,
// without a per-item round trip.
ipcMain.handle('get-history-populated-ids', () => api.getHistoryPopulatedIds());

ipcMain.handle('get-item-history-local', (_, itemId) => api.getItemHistoryLocal(itemId));

ipcMain.handle('start-history-population', async (_, itemIds) => {
  return api.startHistoryPopulation(itemIds, (progress) => notifyRenderer('history-progress', progress));
});

ipcMain.handle('stop-history-population', () => api.stopHistoryPopulation());

ipcMain.handle('get-signal-trend', async (_, itemLimits) => api.getSignalTrend(itemLimits));

ipcMain.handle('get-item-history', async (_, itemId) => api.getItemHistory(itemId));

ipcMain.handle('get-price-snapshots', (_, itemId) => api.getPriceSnapshots(itemId));

ipcMain.handle('get-item-timeseries', async (_, itemId) => api.getItemTimeseries(itemId));

// Proper semver "is a newer than b" check — was previously just `latest !==
// current`, which fires an "update available" notification any time the
// two differ AT ALL, including when the local build is actually AHEAD of
// the last published GitHub release (e.g. a version bump that hasn't been
// tagged/pushed yet). Caught by Ben seeing a "v1.6.0 is available" prompt
// while already running the newer v1.7.0.
function isNewerVersion(latest, current) {
  const a = latest.split('.').map(Number);
  const b = current.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const ai = a[i] || 0, bi = b[i] || 0;
    if (ai > bi) return true;
    if (ai < bi) return false;
  }
  return false;
}

// ─── App lifecycle ────────────────────────────────────────────────────────────
async function checkForUpdate() {
  try {
    const current = app.getVersion();
    const res = await fetch(
      'https://api.github.com/repos/VonDerThWood/GE-Intelligence/releases/latest',
      { headers: { 'User-Agent': 'GEnius-App' }, signal: AbortSignal.timeout(8000) }
    );
    const data = await res.json();
    const latest = (data.tag_name || '').replace(/^v/, '');
    if (latest && isNewerVersion(latest, current)) {
      mainWindow?.webContents.send('update-available', { current, latest, url: data.html_url });
      new Notification({
        title: 'GEnius Update Available',
        body: `v${latest} is out — you're on v${current}. Open GEnius to download.`,
      }).show();
    }
  } catch {}
}

app.whenReady().then(async () => {
  // Initialize data paths here — app.getPath() requires app to be ready.
  // Same filename electron-store used by default, so upgrading from an
  // older build doesn't lose anyone's existing settings/watchlist/etc.
  store   = await storage.createKVStore(path.join(app.getPath('userData'), 'config.json'));
  dataDir = path.join(app.getPath('userData'), 'data');
  await storage.ensureDir(dataDir);
  api = await createGeniusApi({ dataDir, store });

  createWindow();
  createTray();
  // Window shows immediately; history loads in the background rather
  // than blocking startup. Even with the async-batched reads in api.js,
  // there's no reason to make window creation wait on it.
  api.loadHistory();
  startScheduler();
  setTimeout(() => runPython('prices'), 3000);
  setTimeout(() => checkDxpNotifications(), 5000);
  setTimeout(() => checkWatchlistDigest(), 6000);
  setTimeout(() => checkReminders(), 7000);
  setTimeout(() => checkForUpdate(), 8000);
});

app.on('window-all-closed', (e) => {
  if (process.platform !== 'darwin') e.preventDefault();
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('activate', () => {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  else mainWindow.show();
});

app.on('before-quit', () => { isQuitting = true; stopScheduler(); });

// Allow installer/Windows shutdown to close the app properly
app.on('will-quit', () => { isQuitting = true; });
process.on('SIGTERM', () => { isQuitting = true; app.quit(); });
process.on('SIGINT',  () => { isQuitting = true; app.quit(); });
