const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell, Notification, globalShortcut, desktopCapturer, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const storage = require('./backend-js/storage.js');
const { createGeniusApi, isValidDiscordWebhook } = require('./backend-js/api.js');

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

// Test mode (Ben, 2026-10-06) — for Claude to drive the app from scripts
// (Chrome DevTools Protocol on --remote-debugging-port) while Ben's own
// GEnius keeps running. Launch: `npm run test-mode`. It runs as a fully
// separate instance with its own userData folder (GEnius-test), refreshed
// from a snapshot of the real data on every launch, so nothing done in a
// test can touch the real portfolio/goals/alerts. Per-item price history
// (1.6 GB) is read straight from the real folder but never written. No
// notifications, Discord, auto-backup, update check or tray icon.
const isTestMode = process.argv.includes('--test-mode');
const REAL_USER_DATA = path.join(app.getPath('appData'), 'GEnius');
if (isTestMode) app.setPath('userData', path.join(app.getPath('appData'), 'GEnius-test'));

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
  // The preload bridge (window.genius) is attached to this window no
  // matter what URL it's showing — so if anything ever navigated it to a
  // remote page, that page would get full access to saveSettings, import,
  // openExternal, etc. Nothing does today (every link goes through
  // openExternal), but these two guards make sure nothing ever can: block
  // in-window navigation away from the app, and refuse to open new windows
  // (external links still work — they go to the real browser).
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (url !== mainWindow.webContents.getURL()) e.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // Test mode opens without stealing focus from whatever Ben is doing.
  mainWindow.once('ready-to-show', () => { isTestMode ? mainWindow.showInactive() : mainWindow.show(); });
  // Safety net — 'ready-to-show' not firing leaves the window permanently
  // invisible while createTray() below still runs unconditionally, which
  // looks exactly like "the app only opens to the tray." Confirmed
  // plausible for real (Ben, 2026-07-14): a fresh install's first launch
  // is the one moment antivirus real-time scanning hits every file for the
  // very first time — we already measured that exact effect costing
  // real seconds elsewhere in this app (history file loading). If the
  // window hasn't shown itself within a generous window, force it rather
  // than leave the app silently invisible.
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) isTestMode ? mainWindow.showInactive() : mainWindow.show();
  }, 8000);
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
    { label: 'Fetch Now', click: () => runPython('prices').catch(() => {}) },
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
// Only one fetch at a time: the scheduler tick, tray Fetch Now, the
// initial fetch and the renderer's Fetch Now could otherwise overlap and
// interleave their writes to the same data files. A request made while a
// fetch is already running just shares that fetch's result.
let fetchInFlight = null;
function runPython(mode = 'prices') {
  if (fetchInFlight) return fetchInFlight;
  fetchInFlight = (async () => {
    const { main: runJs } = require('./backend-js/run.js');
    const webhookUrl = store.get('discordWebhook', '');
    const argv = [`--mode=${mode}`, `--data-dir=${dataDir}`];
    if (webhookUrl) argv.push(`--webhook=${webhookUrl}`);

    console.log('[run.js] Running with args:', argv.join(' '));
    // Fired BEFORE the historyLoadedPromise wait below, not after — that
    // wait is exactly the part that can silently take minutes right after
    // a cold boot (antivirus scanning ~7,300 history files for the first
    // time), and the renderer's "Fetch Now" button had no way to know a
    // fetch was even in progress during it (Ben, 2026-08-13: an auto-
    // launch fetch that was actually still running just looked stuck,
    // since only a manually-clicked Fetch Now ever set the button's own
    // local "fetching" state).
    notifyRenderer('fetch-start', { mode });

    try {
      await api.historyLoadedPromise; // don't compute stats off a still-loading, partial historyPopulatedIds
      const result = await runJs(argv, await api.computeHistoryStats());
      if (result && result.pricesFailed) throw new Error('Price fetch failed — still showing the previous prices');
      if (mode === 'prices' || !mode) await api.updateSnapshots();
      if (mode !== 'news') await api.recordOpportunities();
      await api.archiveNews();
      // Checks run against the data this fetch just wrote, and finish
      // before fetch-complete, so the renderer's alert/reminder re-pull on
      // fetch-complete sees the freshly fired state.
      await runAllChecks();
      notifyRenderer('fetch-complete', { mode, timestamp: Date.now() });
      // Keeps per-item history current in the background (up to 500 of the
      // most out-of-date items per fetch). Deliberately not awaited — it
      // takes a few minutes and must never hold up the fetch itself.
      // Same idea for the daily live price archive (live-history.js).
      if (mode !== 'news') api.syncLiveHistory().catch(() => {});
      if (mode !== 'news') api.refreshStaleHistory(500).then(() => api.maybeBuildSimilarityTable()).then(() => api.maybeRefreshAlmanac()).catch(() => {});
    } catch (error) {
      console.error('[run.js] Error:', error.message);
      notifyRenderer('fetch-error', { error: error.message });
      throw error;
    }
  })().finally(() => { fetchInFlight = null; });
  return fetchInFlight;
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

async function checkPortfolioDigest() {
  const digest = await api.getPortfolioDigest();
  if (digest) {
    new Notification({ title: digest.title, body: digest.body, icon: path.join(resourcesPath, 'assets', 'icon.ico') }).show();
  }
}

async function checkReminders() {
  for (const r of await api.getDueReminders()) {
    new Notification({ title: r.title, body: r.body, icon: path.join(resourcesPath, 'assets', 'icon.ico') }).show();
  }
}

async function checkPriceAlerts() {
  // getTriggeredAlerts still runs regardless (it records fired state and
  // sends Discord); the Settings checkbox only controls the desktop popup.
  const triggered = await api.getTriggeredAlerts();
  if (!store.get('notifications', true)) return;
  for (const a of triggered) {
    new Notification({ title: a.title, body: a.body, icon: path.join(resourcesPath, 'assets', 'icon.ico') }).show();
  }
}

async function checkDxpNews() {
  for (const n of await api.getDxpNewsNotifications()) {
    new Notification({ title: n.title, body: n.body, icon: path.join(resourcesPath, 'assets', 'icon.ico') }).show();
  }
}

async function checkBuyGoals() {
  for (const n of await api.getBuyGoalNotifications()) {
    new Notification({ title: n.title, body: n.body, icon: path.join(resourcesPath, 'assets', 'icon.ico') }).show();
  }
}

// ─── GE offer reader (dev mode) ─────────────────────────────────────────────
// Shift+PrtSc reads the screen once, on this machine only. The image is never
// saved or sent anywhere. Parsing lives in backend-js/ge-reader.js.
const GE_READER_KEY = 'Shift+PrintScreen';
// One worker per side-by-side read. A worker reads one image at a time, so reads
// that share a worker would just queue.
const geOcrWorkers = [];
let geReadBusy = false;
function geWorker(slot) {
  if (!geOcrWorkers[slot]) {
    const { createWorker } = require('tesseract.js');
    const dataDir = path.join(__dirname, 'backend-js', 'data', 'ocr').replace('app.asar', 'app.asar.unpacked');
    geOcrWorkers[slot] = createWorker('eng', 1, { langPath: dataDir, gzip: false, cacheMethod: 'none' });
  }
  return geOcrWorkers[slot];
}
async function geOcr(png, slot) {
  return (await (await geWorker(slot)).recognize(png)).data.text;
}
// Greyscale with stretched contrast. Tested on real GE screens (2026-11-04): this
// read every number at 1.5x and 2x, where color often missed or misread them.
function greyContrast(image) {
  const size = image.getSize();
  const px = Buffer.from(image.toBitmap());
  let lo = 255, hi = 0;
  for (let i = 0; i < px.length; i += 4) {
    const y = Math.round(0.114 * px[i] + 0.587 * px[i + 1] + 0.299 * px[i + 2]);
    px[i] = y;
    if (y < lo) lo = y;
    if (y > hi) hi = y;
  }
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < px.length; i += 4) {
    const y = Math.round((px[i] - lo) * 255 / range);
    px[i] = y; px[i + 1] = y; px[i + 2] = y; px[i + 3] = 255;
  }
  return nativeImage.createFromBitmap(px, size);
}
async function readGeImage(image) {
  const { parseOffer, readOfferPasses } = require('./backend-js/ge-reader.js');
  const names = ((await api.getData()).items || []).map(i => i.name);
  const { width } = image.getSize();
  return readOfferPasses(async scale => {
    const scaled = image.resize({ width: Math.round(width * scale), quality: 'best' });
    return parseOffer(await geOcr(greyContrast(scaled).toPNG(), scale === 2 ? 1 : 0), names);
  }, [1.5, 2, 1]);
}
async function captureGeOffer() {
  if (geReadBusy) return;
  geReadBusy = true;
  try {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const size = { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) };
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
    const source = sources.find(s => String(s.display_id) === String(display.id)) || sources[0];
    if (!source) throw new Error('No screen to read');
    // The screen is captured, so GEnius can come forward and show it's working.
    notifyRenderer('ge-reader-result', { reading: true });
    if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); }
    const offer = await readGeImage(source.thumbnail);
    notifyRenderer('ge-reader-result', offer);
  } catch (e) {
    console.error('[GE reader] failed:', e.message);
    notifyRenderer('ge-reader-result', { error: e.message });
  } finally {
    geReadBusy = false;
  }
}
function updateGeReaderShortcut() {
  if (isTestMode) return;
  const on = !!store.get('devMode', false);
  if (on && !globalShortcut.isRegistered(GE_READER_KEY)) {
    if (!globalShortcut.register(GE_READER_KEY, captureGeOffer)) console.error('[GE reader] shortcut unavailable');
  } else if (!on && globalShortcut.isRegistered(GE_READER_KEY)) {
    globalShortcut.unregister(GE_READER_KEY);
  }
}
// Test mode reads a saved image instead of the screen.
ipcMain.handle('test-ge-reader', async (_, file) => {
  if (!isTestMode) return null;
  notifyRenderer('ge-reader-result', { reading: true });
  const offer = await readGeImage(nativeImage.createFromPath(file));
  notifyRenderer('ge-reader-result', offer);
  return offer;
});

async function checkAlmanacDigest() {
  for (const n of await api.getAlmanacNotifications()) {
    new Notification({ title: n.title, body: n.body, icon: path.join(resourcesPath, 'assets', 'icon.ico') }).show();
  }
}

async function checkUpdateRisks() {
  for (const n of await api.getUpdateRiskNotifications()) {
    new Notification({ title: n.title, body: n.body, icon: path.join(resourcesPath, 'assets', 'icon.ico') }).show();
  }
}

async function runAllChecks() {
  if (isTestMode) return; // no notifications or Discord from a test instance
  for (const check of [checkUpdateRisks, checkDxpNotifications, checkAlmanacDigest, checkWatchlistDigest, checkPortfolioDigest, checkReminders, checkPriceAlerts, checkBuyGoals, checkDxpNews]) {
    try { await check(); } catch (e) { console.error(`[Checks] ${check.name} failed:`, e.message); }
  }
}

// ─── Scheduler ────────────────────────────────────────────────────────────────
function startScheduler() {
  stopScheduler();
  const intervalMinutes = store.get('fetchInterval', 15);
  const ms = intervalMinutes * 60 * 1000;
  console.log(`[Scheduler] Fetching every ${intervalMinutes} min`);
  schedulerInterval = setInterval(() => {
    const lastNewsFetch = store.get('lastNewsFetch', 0);
    const newsStale = Date.now() - lastNewsFetch > 60 * 60 * 1000;
    if (newsStale) {
      store.set('lastNewsFetch', Date.now());
      runPython('full').catch(() => {});
    } else {
      runPython('prices').catch(() => {});
    }
    // Alert/digest/reminder checks now run inside runPython, after the
    // fetch finishes, instead of here against the previous fetch's data.
  }, ms);
}

function stopScheduler() {
  if (schedulerInterval) { clearInterval(schedulerInterval); schedulerInterval = null; }
}

// ─── IPC handlers ───────────────────────────────────────────────────────────────
// Every handler below is a thin wrapper around api.js — the actual logic
// lives there (see its file comment for why), with zero Electron
// dependencies, so a future Capacitor/mobile build could call the same
// functions directly with no IPC layer in between at all.
let didInitialFetch = false;
ipcMain.handle('get-data', () => {
  // The post-launch auto-fetch used to fire on a blind 3s setTimeout from
  // app.whenReady — fine on a warm relaunch (renderer mounts well within
  // 3s, same-day testing all confirmed it firing correctly), but a real
  // miss Ben hit (2026-08-13): right after a full Windows restart, cold
  // disk caches and antivirus scanning fresh files can push renderer
  // mount noticeably past 3s. If the fetch (or its failure) fires before
  // the renderer's fetch-complete/fetch-error listeners are registered,
  // Electron's IPC doesn't buffer/replay the event — it's just lost, with
  // no visible error and no retry until the next scheduled 15-min tick.
  // Tying the initial fetch to the renderer's own first get-data call
  // instead guarantees it's already mounted (it just made an IPC call) —
  // the 500ms buffer after that is just to let its useEffect listeners
  // finish registering, not a blind guess at total startup time.
  if (!didInitialFetch) {
    didInitialFetch = true;
    setTimeout(() => runPython('prices').catch(() => {}), 500);
  }
  return api.getData();
});

ipcMain.handle('quit-app', () => { isQuitting = true; app.quit(); return { success: true }; });
ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('is-test-mode', () => isTestMode);

ipcMain.handle('get-dxp-intelligence', async (_, opts) => {
  try { return await api.getDxpIntelligence(opts); }
  catch (e) { console.error('[DXP Intel] get-dxp-intelligence failed:', e.message); return {}; }
});

ipcMain.handle('get-dxp-events', async () => {
  try { return await api.getDxpEvents(); }
  catch (e) { console.error('[DXP Intel] get-dxp-events failed:', e.message); return []; }
});

ipcMain.handle('fetch-now', async (_, mode) => {
  try {
    await runPython(mode || 'prices');
    if (!mode || mode === 'full') store.set('lastNewsFetch', Date.now());
    // Ben, 2026-08-09: a manual Fetch Now never re-checked alerts/reminders/
    // digests against the fresh data it just pulled — only the scheduler's
    // own interval tick and the 8s post-launch timer did. Confirmed for
    // real: a score-based alert whose condition was already true sat
    // unfired across two manual Fetch Now clicks, only firing once the
    // exact same check was run directly outside the app. Running the same
    // checks the scheduler runs here too, so a manual refresh behaves the
    // same way as waiting for the next automatic one. (Those checks now
    // run inside runPython itself, before fetch-complete is sent.)
    return { success: true };
  }
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
  fullNumbers:        store.get('fullNumbers', false),
  devMode:            store.get('devMode', false),
  // These three were saved but never returned here, so a changed value
  // silently reset on every restart (found during the 2026-10-02 audit).
  dateFormat:         store.get('dateFormat', 'MM/DD/YYYY'),
  overpricedThreshold:store.get('overpricedThreshold', 30),
  accentColor:        store.get('accentColor', null),
}));

// Allowlisted rather than "write whatever key the renderer sends" — the
// same approach backup import already uses. Every key the Settings tab
// actually saves is listed; anything else is ignored.
const SAVEABLE_SETTINGS = new Set([
  'discordWebhook', 'fetchInterval', 'theme', 'notifications', 'expensiveThreshold',
  'navOrder', 'uiScale', 'detailPanelWidth', 'columnWidths', 'showThumbnails', 'fullNumbers',
  'devMode', 'dateFormat', 'overpricedThreshold', 'accentColor',
]);
ipcMain.handle('save-settings', async (_, settings) => {
  Object.entries(settings || {}).forEach(([k, v]) => {
    if (!SAVEABLE_SETTINGS.has(k)) return;
    if (k === 'discordWebhook' && v && !isValidDiscordWebhook(v)) return;
    store.set(k, v);
  });
  updateGeReaderShortcut();
  await store.flush();
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

ipcMain.handle('get-portfolio-digest-settings', () => store.get('portfolioDigestSettings', {
  enabled: false, intervalHours: 0.25,
}));
ipcMain.handle('set-portfolio-digest-settings', (_, settings) => {
  store.set('portfolioDigestSettings', settings);
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
ipcMain.handle('get-monster-shorthands',  () => store.get('monsterShorthands', {}));
ipcMain.handle('save-monster-shorthands', (_, sh) => { store.set('monsterShorthands', sh); return { success: true }; });

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
ipcMain.handle('get-buy-goals', () => api.getBuyGoals());
ipcMain.handle('get-opportunity-history', () => api.getOpportunityHistory());
ipcMain.handle('get-events', () => api.getEvents());
ipcMain.handle('save-event', (_, ev) => api.saveEvent(ev));
ipcMain.handle('delete-event', (_, id) => api.deleteEvent(id));
ipcMain.handle('get-event-suggestions', () => api.getEventSuggestions());
ipcMain.handle('dismiss-event-suggestion', (_, url) => api.dismissEventSuggestion(url));
ipcMain.handle('get-event-impact', (_, id) => api.getEventImpact(id));
ipcMain.handle('get-quest-items', (_, name) => api.getQuestItems(name));
ipcMain.handle('get-new-items-summary', () => api.getNewItemsSummary());
ipcMain.handle('get-content-drops', (_, pages) => api.getContentDrops(pages));
ipcMain.handle('get-similar-items', (_, id) => api.getSimilarItems(id));
ipcMain.handle('get-chart-analysis', (_, id) => api.getChartAnalysis(id));
ipcMain.handle('ask-item', (_, id, q) => api.askItem(id, q));
ipcMain.handle('list-auto-backups', () => api.listAutoBackups());
ipcMain.handle('restore-auto-backup', (_, f) => api.restoreAutoBackup(f));
ipcMain.handle('get-food-heal', (_, n) => api.getFoodHeal(n));
ipcMain.handle('get-dxp-news', () => api.getDxpNewsDetections());
ipcMain.handle('get-news-calendar', (_, opts) => api.getNewsCalendar(opts));
ipcMain.handle('get-news-feed', () => api.getNewsFeed());
ipcMain.handle('get-news-badge-count', () => api.getNewsBadgeCount());
ipcMain.handle('mark-news-read', (_, urls) => api.markNewsRead(urls));
ipcMain.handle('get-news-badge-prefs', () => api.getNewsBadgePrefs());
ipcMain.handle('set-news-badge-prefs', (_, p) => api.setNewsBadgePrefs(p));
ipcMain.handle('resolve-dxp-news', (_, url, action, dates) => api.resolveDxpNews(url, action, dates));
ipcMain.handle('save-buy-goal', (_, goal) => api.saveBuyGoal(goal));
ipcMain.handle('delete-buy-goal', (_, id) => api.deleteBuyGoal(id));
ipcMain.handle('update-buy-goal-totals', (_, totals) => api.updateBuyGoalTotals(totals));
ipcMain.handle('delete-position', (_, id) => api.deletePosition(id));
ipcMain.handle('sell-position', (_, payload) => api.sellPosition(payload));
ipcMain.handle('convert-position', (_, payload) => api.convertPosition(payload));
ipcMain.handle('reopen-position', (_, id) => api.reopenPosition(id));

ipcMain.handle('get-item-stats', async (_, itemName) => api.getItemStats(itemName));
ipcMain.handle('get-live-item-price', async (_, itemId) => api.getLiveItemPrice(itemId));
// ─── Phone sync: LAN listener (protocol in backend-js/sync.js) ───────────────
const SYNC_PORT = 48917;
const SYNC_MAX_BODY = 20 * 1024 * 1024;
let syncServer = null;
function startSyncServer() {
  if (syncServer) return;
  syncServer = require('http').createServer((req, res) => {
    const reply = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.method !== 'POST') return reply(405, { error: 'post_only' });
    const chunks = [];
    let size = 0;
    req.on('data', d => {
      size += d.length;
      if (size > SYNC_MAX_BODY) { reply(413, { error: 'too_big' }); req.destroy(); return; }
      chunks.push(d);
    });
    req.on('end', async () => {
      try {
        const out = await api.sync.handleRequest(req.url, JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'),
          () => notifyRenderer('fetch-complete', { mode: 'sync', timestamp: Date.now() }));
        reply(out.status, out.body);
      } catch { reply(400, { error: 'bad_request' }); }
    });
  });
  syncServer.on('error', e => { console.error('[sync] Listener failed:', e.message); syncServer = null; });
  syncServer.listen(SYNC_PORT, '0.0.0.0');
}
// Private (home network) IPv4 addresses, best guess first. Adapters from VMs
// and VPNs tend to use 10.x or 172.x, so 192.168.x comes first.
function localAddresses() {
  const out = [];
  for (const list of Object.values(require('os').networkInterfaces())) {
    for (const a of list) if (a.family === 'IPv4' && !a.internal && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) out.push(a.address);
  }
  return out.sort((a, b) => b.startsWith('192.168.') - a.startsWith('192.168.'));
}
ipcMain.handle('sync-start-pairing', async () => {
  startSyncServer();
  const { code, expires } = api.sync.startPairing();
  const addresses = localAddresses();
  if (!addresses.length) return { error: 'This PC does not seem to be on a home network.' };
  const qr = await require('qrcode').toDataURL('genius-sync:' + addresses[0] + ':' + SYNC_PORT + ':' + code, { margin: 2, width: 260 });
  return { code, expires, host: addresses[0], otherHosts: addresses.slice(1), port: SYNC_PORT, qr };
});
ipcMain.handle('sync-cancel-pairing', () => api.sync.cancelPairing());
ipcMain.handle('sync-list-devices', () => api.sync.listDevices());
ipcMain.handle('sync-unpair-device', (_, id) => api.sync.unpairDevice(id));
ipcMain.handle('sync-get-conflicts', () => api.sync.getConflicts());
ipcMain.handle('sync-clear-conflicts', () => api.sync.clearConflicts());

ipcMain.handle('get-update-risk-settings', () => api.getUpdateRiskSettings());
ipcMain.handle('set-update-risk-settings', (_, s) => api.setUpdateRiskSettings(s));
ipcMain.handle('get-update-risks', () => api.getUpdateRisks());
ipcMain.handle('dismiss-update-risk', (_, key) => api.dismissUpdateRisk(key));
ipcMain.handle('get-almanac-signals', () => api.getAlmanacSignals());
ipcMain.handle('get-inbox', () => api.getInbox());
// Test mode skips the checks that fill the Inbox, so tests seed it directly.
ipcMain.handle('test-seed-inbox', (_, list) => { if (isTestMode) store.set('inbox', list); });
ipcMain.handle('mark-inbox-read', (_, kind, upTo) => api.markInboxRead(kind, upTo));
ipcMain.handle('clear-inbox', (_, id) => api.clearInbox(id));
ipcMain.handle('get-item-live-history', async (_, itemId, days) => api.getItemLiveHistory(itemId, days));
ipcMain.handle('get-item-live-timeseries', async (_, itemId, lookback) => api.getItemLiveTimeseries(itemId, lookback));
ipcMain.handle('get-launches', async () => api.getLaunches());
ipcMain.handle('get-drop-sources', async (_, itemName) => api.getDropSources(itemName));
ipcMain.handle('search-monsters', async (_, query) => api.searchMonsters(query));
ipcMain.handle('get-monster-drops', async (_, monsterName, mode) => api.getMonsterDrops(monsterName, mode));
ipcMain.handle('get-monster-info', async (_, monsterName, mode) => api.getMonsterInfo(monsterName, mode));
ipcMain.handle('get-item-products', async (_, itemName) => api.getItemProducts(itemName));

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

ipcMain.handle('get-real-time-movers', async (_, windowDays) => api.getRealTimeMovers(windowDays));

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
      // Windows notification once per new version — the check now repeats
      // every 6h, and the in-app banner is enough after the first ping.
      if (store.get('updateNotifiedVersion', '') !== latest) {
        store.set('updateNotifiedVersion', latest);
        new Notification({
          title: 'GEnius Update Available',
          body: `v${latest} is out — you're on v${current}. Open GEnius to download.`,
        }).show();
      }
    }
  } catch {}
}

// Test mode: copy the real config + data (minus the history folder and big
// one-off backups) into the test userData folder, fresh every launch.
async function prepareTestModeData() {
  const fsp = require('fs').promises;
  const testUser = app.getPath('userData');
  await fsp.rm(path.join(testUser, 'data'), { recursive: true, force: true });
  await fsp.mkdir(path.join(testUser, 'data'), { recursive: true });
  const SKIP = new Set(['history', 'autobackups', 'history.json.pre-migration-backup']);
  for (const name of await fsp.readdir(path.join(REAL_USER_DATA, 'data'))) {
    if (SKIP.has(name)) continue;
    await fsp.cp(path.join(REAL_USER_DATA, 'data', name), path.join(testUser, 'data', name), { recursive: true });
  }
  const cfg = JSON.parse(await fsp.readFile(path.join(REAL_USER_DATA, 'config.json'), 'utf8').catch(() => '{}'));
  cfg.discordWebhook = '';     // never ping the real Discord from a test
  cfg.notifications = false;
  await fsp.writeFile(path.join(testUser, 'config.json'), JSON.stringify(cfg));
}

app.whenReady().then(async () => {
  setTimeout(() => { if (api?.sync.listDevices().length) startSyncServer(); }, 3000);
  // app.quit() above is asynchronous — without this, a second instance
  // still went on to create a window, load data and run the scheduler
  // (writing the same files) before it exited. Seen 2026-10-08: data
  // briefly showed, then vanished.
  if (!gotSingleInstanceLock) return;
  if (isTestMode) await prepareTestModeData();
  // Initialize data paths here — app.getPath() requires app to be ready.
  // Same filename electron-store used by default, so upgrading from an
  // older build doesn't lose anyone's existing settings/watchlist/etc.
  store   = await storage.createKVStore(path.join(app.getPath('userData'), 'config.json'));
  dataDir = path.join(app.getPath('userData'), 'data');
  await storage.ensureDir(dataDir);
  api = await createGeniusApi({ dataDir, store, platform: 'desktop',
    ...(isTestMode ? { historyDirOverride: path.join(REAL_USER_DATA, 'data', 'history'), readOnlyHistory: true } : {}) });

  createWindow();
  updateGeReaderShortcut();
  if (isTestMode) {
    mainWindow.setTitle('GEnius [TEST MODE]');
    api.loadHistory();
    startScheduler();
    return;
  }
  createTray();
  // Window shows immediately; history loads in the background rather
  // than blocking startup. Even with the async-batched reads in api.js,
  // there's no reason to make window creation wait on it.
  api.loadHistory();
  api.runAutoBackup().catch(e => console.error('[autobackup] failed:', e.message));
  startScheduler();
  // Initial post-launch price fetch now triggers off the renderer's own
  // first get-data IPC call (see that handler's comment) instead of a
  // blind timer here.
  setTimeout(() => checkDxpNotifications(), 5000);
  setTimeout(() => checkWatchlistDigest(), 6000);
  setTimeout(() => checkReminders(), 7000);
  setTimeout(() => checkPriceAlerts(), 8000);
  setTimeout(() => checkForUpdate(), 8000);
  // GEnius lives in the tray and can run for weeks without a restart, so a
  // launch-only check missed releases (v2.7.0: 0 installer downloads).
  setInterval(() => checkForUpdate(), 6 * 3600 * 1000);
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

// Delays actual quit until any in-flight settings write has landed on disk —
// without this, a quit (or an external taskkill) racing a just-toggled
// setting can lose that write entirely (see the flush() comment in
// storage.js's createKVStore). preventDefault + a guard flag makes this
// re-entrant: the real app.quit() call below re-fires before-quit, but by
// then store.flush() has already resolved so it falls through immediately.
let quitFlushed = false;
app.on('before-quit', (event) => {
  isQuitting = true;
  stopScheduler();
  if (quitFlushed || !store) return;
  event.preventDefault();
  store.flush().finally(() => { quitFlushed = true; app.quit(); });
});

// Allow installer/Windows shutdown to close the app properly
app.on('will-quit', () => { isQuitting = true; globalShortcut.unregisterAll(); });
process.on('SIGTERM', () => { isQuitting = true; app.quit(); });
process.on('SIGINT',  () => { isQuitting = true; app.quit(); });
