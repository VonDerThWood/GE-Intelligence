const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');

const store = new Store();
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

// dataDir and related paths must be set after app is ready (app.getPath requires it)
let dataDir;
let dataFile;
let alertsFile;
let portfolioFile;

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

// Ported from dxp_intelligence.py to dxp_intelligence.js (see
// SESSION_LOG.md, 2026-06-26) — verified field-for-field identical
// against all 987 real tracked items before cutover. Runs in-process
// instead of spawning Python.
let dxpIntelCache = null;       // { historyMtimeMs, data }
function runDxpIntelligence() {
  return new Promise((resolve, reject) => {
    // Skip recomputation entirely if history.json hasn't changed since the
    // last run — recomputing on every tab open was the main source of the
    // "takes a while" delay, not just the per-item math.
    let historyMtimeMs = 0;
    try { historyMtimeMs = fs.statSync(path.join(dataDir, 'history.json')).mtimeMs; } catch {}
    if (dxpIntelCache && dxpIntelCache.historyMtimeMs === historyMtimeMs) {
      resolve(dxpIntelCache.data);
      return;
    }

    try {
      const { loadEvents, computeDxpData } = require('./backend-js/dxp_intelligence.js');
      const history = JSON.parse(fs.readFileSync(path.join(dataDir, 'history.json'), 'utf8'));
      const itemLimits = {}, itemNames = {};
      const latestFile = path.join(dataDir, 'latest.json');
      if (fs.existsSync(latestFile)) {
        const latest = JSON.parse(fs.readFileSync(latestFile, 'utf8'));
        for (const it of latest.items || []) {
          if (it.id) {
            itemLimits[String(it.id)] = it.limit ?? null;
            itemNames[String(it.id)] = it.name;
          }
        }
      }
      const events = loadEvents(dataDir);
      const out = computeDxpData(history, itemLimits, itemNames, true, events);
      fs.writeFileSync(path.join(dataDir, 'dxp_intelligence.json'), JSON.stringify(out), 'utf8');
      dxpIntelCache = { historyMtimeMs, data: out };
      resolve(out);
    } catch (e) {
      console.error('[DXP Intel] Error:', e.message);
      reject(e);
    }
  });
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
      await runJs(argv);
      notifyRenderer('fetch-complete', { mode, timestamp: Date.now() });
      if (mode === 'prices' || !mode) updateSnapshots();
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

// ─── DXP Almanac notifications ─────────────────────────────────────────────────
// Conservative calendar anchors per season — the earliest a DXP
// announcement's pre_announce phase has EVER historically begun (21 days
// before the earliest announcement on record for that season), computed
// from the full 2017-2026 history in research/dxp_event_history.md. Used
// to fire a once-a-year "window approaching" heads-up BEFORE any real
// event exists in dxp_events.json — a forward-looking nudge based on
// historical clustering, not a confirmed date. May/Nov are tight and
// reliable (n=8, narrow spread); Feb/Aug have wider historical variance,
// so their anchors are less precise — noted in the fired message itself.
const DXP_SEASON_ANCHORS = [
  { label: 'Winter/February', month: 1,  day: 2,  wide: true },
  { label: 'Spring/May',      month: 3,  day: 25, wide: false },
  { label: 'Summer/August',   month: 6,  day: 8,  wide: true },
  { label: 'Autumn/November', month: 9,  day: 27, wide: false },
];

// Proactively alerts the user about pinned DXP-watchlist items when today
// falls on (or near) that item's historical best-buy/best-sell day within an
// active DXP event window, when a new event has just been announced, or
// when the calendar enters a season's historical "could be announced any
// time now" window before any event is even confirmed yet. Cheap to run
// often — just JSON reads + date math, no Python involved — so it's
// checked on the same cadence as the price scheduler. dxpNotifiedLog
// dedupes so each item/type/event/season-year only fires once.
function checkDxpNotifications() {
  const settings = store.get('dxpNotificationSettings', {
    enabled: false, buyAlerts: true, sellAlerts: true, announceAlerts: true, windowApproachingAlerts: true,
  });
  if (!settings.enabled) return;

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const notifiedLog = store.get('dxpNotifiedLog', {});
  let logChanged = false;
  const fire = (key, title, body) => {
    if (notifiedLog[key]) return;
    new Notification({ title, body, icon: path.join(resourcesPath, 'assets', 'icon.ico') }).show();
    notifiedLog[key] = todayStr;
    logChanged = true;
  };

  let events = [];
  try { events = JSON.parse(fs.readFileSync(path.join(dataDir, 'dxp_events.json'), 'utf8')); } catch {}

  if (settings.windowApproachingAlerts) {
    const year = today.getFullYear();
    for (const season of DXP_SEASON_ANCHORS) {
      const anchor = new Date(year, season.month - 1, season.day);
      const fireWindowEnd = new Date(anchor.getTime() + 3 * 86400000);
      if (today < anchor || today > fireWindowEnd) continue;
      // Skip if a real announcement already landed in the last 21 days —
      // the actual "DXP Announced" alert below covers that case, no need
      // to also nudge with the speculative heads-up.
      const alreadyAnnounced = events.some(([announced]) => {
        const days = (today - new Date(announced + 'T00:00:00Z')) / 86400000;
        return days >= 0 && days <= 21;
      });
      if (alreadyAnnounced) continue;
      fire(`window_${season.label}_${year}`, '📅 DXP Window Approaching',
        `Historically, ${season.label} Double XP gets announced around this time of year` +
        (season.wide ? ' (this season\'s timing varies more than others)' : '') +
        '. Nothing confirmed yet — just a heads-up based on past years.');
    }
  }

  const watchlist = store.get('dxpWatchlist', []);
  let dxpData = null;
  if (watchlist.length) {
    try { dxpData = JSON.parse(fs.readFileSync(path.join(dataDir, 'dxp_intelligence.json'), 'utf8')); } catch {}
  }

  const daysBetween = (a, b) => Math.round((b - a) / 86400000);

  for (const [announced, start, end] of events) {
    if (settings.announceAlerts && todayStr === announced) {
      fire(`announce_${announced}`, '📅 DXP Announced',
        `A new Double XP event has been announced (${start} to ${end}). Check your Almanac watchlist for buy timing.`);
      continue;
    }

    const startDt = new Date(start + 'T00:00:00Z');
    const endDt = new Date(end + 'T00:00:00Z');
    const baselineDt = new Date(startDt.getTime() - 21 * 86400000);
    const afterDt = new Date(endDt.getTime() + 21 * 86400000);
    if (today < baselineDt || today > afterDt) continue;
    const dayOffset = daysBetween(startDt, today);

    for (const itemId of (dxpData ? watchlist : [])) {
      const entry = dxpData[itemId];
      const timing = entry?.timing;
      if (!timing) continue;
      const name = entry.name || itemId;

      if (settings.buyAlerts && timing.best_buy_day_offset != null) {
        const std = Math.max(timing.best_buy_day_std || 0, 0.5);
        if (Math.abs(dayOffset - timing.best_buy_day_offset) <= std) {
          fire(`${itemId}_buy_${start}_${todayStr}`, '📅 DXP Buy Window',
            `${name} is at its historical best-buy day (day ${dayOffset} of the event).`);
        }
      }
      if (settings.sellAlerts && timing.best_sell_day_offset != null) {
        const std = Math.max(timing.best_sell_day_std || 0, 0.5);
        if (Math.abs(dayOffset - timing.best_sell_day_offset) <= std) {
          fire(`${itemId}_sell_${start}_${todayStr}`, '📅 DXP Sell Window',
            `${name} is at its historical best-sell day (day ${dayOffset} of the event).`);
        }
      }
    }
  }

  if (logChanged) {
    const cutoff = Date.now() - 60 * 86400000; // prune entries older than ~60 days
    for (const k in notifiedLog) {
      if (new Date(notifiedLog[k]).getTime() < cutoff) delete notifiedLog[k];
    }
    store.set('dxpNotifiedLog', notifiedLog);
  }
}

// ─── Watchlist daily digest ───────────────────────────────────────────────────
// % change from the latest stored point back to whichever point is the
// closest at-or-before `now - days`. Returns null if there isn't enough
// history to compare (item never had its history backfilled, etc).
function pctChangeOverDays(itemId, days) {
  const points = historyData[String(itemId)];
  if (!points || points.length < 2) return null;
  const toMs = ts => (ts && ts < 1e11 ? ts * 1000 : ts);
  const sorted = [...points].sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp));
  const latest = sorted[sorted.length - 1];
  const targetMs = toMs(latest.timestamp) - days * 86400000;
  let ref = sorted[0];
  for (const p of sorted) {
    if (toMs(p.timestamp) <= targetMs) ref = p; else break;
  }
  if (!ref || !ref.price || !latest.price || ref === latest) return null;
  return ((latest.price - ref.price) / ref.price) * 100;
}

// Fires at most once per calendar day, checking each watchlist item for
// either a same-day move past `dailyThresholdPct` or a 7-day drift past
// `trendThresholdPct` (kept as a separate, slightly higher bar by default
// since a sustained week-long move is a different signal than a single-day
// spike — Ben: "with a little higher of one"). Stays silent entirely if
// nothing on the watchlist crossed either bar, rather than notifying daily
// regardless of whether anything happened.
function checkWatchlistDigest() {
  const settings = store.get('watchlistNotificationSettings', {
    enabled: false, dailyThresholdPct: 5, trendThresholdPct: 7,
  });
  if (!settings.enabled) return;

  const watchlist = store.get('watchlist', []);
  if (!watchlist.length) return;

  const todayStr = new Date().toISOString().slice(0, 10);
  if (store.get('watchlistDigestLastSent', null) === todayStr) return;

  let itemsById = {};
  try {
    itemsById = Object.fromEntries(
      (JSON.parse(fs.readFileSync(dataFile, 'utf8')).items || []).map(i => [String(i.id), i])
    );
  } catch {}

  const movers = [];
  for (const id of watchlist) {
    const dayPct = pctChangeOverDays(id, 1);
    const weekPct = pctChangeOverDays(id, 7);
    const dayHit = dayPct != null && Math.abs(dayPct) >= settings.dailyThresholdPct;
    const weekHit = weekPct != null && Math.abs(weekPct) >= settings.trendThresholdPct;
    if (dayHit || weekHit) {
      const name = itemsById[String(id)]?.name || id;
      movers.push({ id, name, dayPct, weekPct, dayHit, weekHit });
    }
  }
  if (!movers.length) return;

  movers.sort((a, b) =>
    Math.max(Math.abs(b.dayPct || 0), Math.abs(b.weekPct || 0)) -
    Math.max(Math.abs(a.dayPct || 0), Math.abs(a.weekPct || 0))
  );
  const top = movers.slice(0, 5);
  const lines = top.map(m => {
    const parts = [];
    if (m.dayHit) parts.push(`${m.dayPct >= 0 ? '+' : ''}${m.dayPct.toFixed(1)}% today`);
    if (m.weekHit) parts.push(`${m.weekPct >= 0 ? '+' : ''}${m.weekPct.toFixed(1)}% over 7d`);
    return `${m.name}: ${parts.join(', ')}`;
  });
  if (movers.length > top.length) lines.push(`+${movers.length - top.length} more`);

  new Notification({
    title: `Watchlist — ${movers.length} item${movers.length === 1 ? '' : 's'} moving`,
    body: lines.join('\n'),
    icon: path.join(resourcesPath, 'assets', 'icon.ico'),
  }).show();

  store.set('watchlistDigestLastSent', todayStr);
}

// ─── Reminders ────────────────────────────────────────────────────────────────
// Plain date-triggered reminders, no price involved (e.g. "buy Shard of
// Genesis Essence — tail end of Autumn before the Winter boss"). Fires once
// the day arrives, then marked fired so it never repeats.
function checkReminders() {
  const reminders = store.get('reminders', []);
  if (!reminders.length) return;
  const todayStr = new Date().toISOString().slice(0, 10);
  let changed = false;
  for (const r of reminders) {
    if (r.fired || !r.dueDate || r.dueDate > todayStr) continue;
    new Notification({
      title: r.itemName ? `Reminder: ${r.itemName}` : 'GEnius Reminder',
      body: r.message || 'Reminder due.',
      icon: path.join(resourcesPath, 'assets', 'icon.ico'),
    }).show();
    r.fired = true;
    changed = true;
  }
  if (changed) store.set('reminders', reminders);
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

// ─── IPC handlers ─────────────────────────────────────────────────────────────
ipcMain.handle('get-data', async () => {
  try {
    if (!fs.existsSync(dataFile)) return { items: [], timestamp: null };
    const raw = fs.readFileSync(dataFile, { encoding: 'utf8' });
    const parsed = JSON.parse(raw);
    console.log(`[get-data] Loaded ${parsed.items?.length ?? 0} items`);
    return parsed;
  } catch (e) {
    console.error('[get-data] Error:', e.message);
    return { items: [], timestamp: null };
  }
});

ipcMain.handle('quit-app', () => { isQuitting = true; app.quit(); return { success: true }; });
ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('get-dxp-intelligence', async () => {
  try { return await runDxpIntelligence(); }
  catch (e) { console.error('[DXP Intel] get-dxp-intelligence failed:', e.message); return {}; }
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
    const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
    const bundle = {
      version: 1,
      exportedAt: new Date().toISOString(),
      watchlist:   store.get('watchlist', []),
      hiddenItems: store.get('hiddenItems', []),
      itemNotes:   store.get('itemNotes', {}),
      settings: {
        discordWebhook:     store.get('discordWebhook', ''),
        fetchInterval:      store.get('fetchInterval', 15),
        notifications:      store.get('notifications', true),
        expensiveThreshold: store.get('expensiveThreshold', 500000000),
        navOrder:           store.get('navOrder', []),
      },
      alerts:    readJson(alertsFile),
      portfolio: readJson(portfolioFile),
      overrides: readJson(overridesFile),
    };
    fs.writeFileSync(filePath, JSON.stringify(bundle, null, 2), 'utf8');
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
    const bundle = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
    if (bundle.version !== 1) return { error: 'Unrecognised backup format.' };

    if (Array.isArray(bundle.watchlist))   store.set('watchlist',   bundle.watchlist);
    if (Array.isArray(bundle.hiddenItems)) store.set('hiddenItems', bundle.hiddenItems);
    if (bundle.itemNotes && typeof bundle.itemNotes === 'object') store.set('itemNotes', bundle.itemNotes);
    if (bundle.settings && typeof bundle.settings === 'object') {
      const ALLOWED_SETTINGS = ['discordWebhook','fetchInterval','notifications','expensiveThreshold','navOrder','theme','dateFormat'];
      ALLOWED_SETTINGS.forEach(k => { if (k in bundle.settings) store.set(k, bundle.settings[k]); });
    }
    if (bundle.alerts    != null) fs.writeFileSync(alertsFile,    JSON.stringify(bundle.alerts,    null, 2), 'utf8');
    if (bundle.portfolio != null) fs.writeFileSync(portfolioFile, JSON.stringify(bundle.portfolio, null, 2), 'utf8');
    if (bundle.overrides != null) fs.writeFileSync(overridesFile, JSON.stringify(bundle.overrides, null, 2), 'utf8');

    return { success: true };
  } catch (e) {
    return { error: e.message };
  }
});

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

// ─── Portfolio ────────────────────────────────────────────────────────────────
function getWeekStr(date) {
  const d = new Date(date);
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const w1 = new Date(d.getFullYear(), 0, 4);
  return `${d.getFullYear()}-W${String(1 + Math.round(((d - w1) / 86400000 - 3 + (w1.getDay()+6)%7) / 7)).padStart(2,'0')}`;
}

function defaultTaxStats() {
  const n = new Date();
  return { today_tax:0, week_tax:0, month_tax:0, lifetime_tax:0,
    day_date: n.toISOString().slice(0,10),
    week_date: getWeekStr(n),
    month_date: n.toISOString().slice(0,7) };
}

function readPortfolio() {
  try {
    if (!fs.existsSync(portfolioFile)) return { positions:[], tax_stats:defaultTaxStats() };
    return JSON.parse(fs.readFileSync(portfolioFile, 'utf8'));
  } catch { return { positions:[], tax_stats:defaultTaxStats() }; }
}

function writePortfolio(data) {
  fs.writeFileSync(portfolioFile, JSON.stringify(data, null, 2));
}

function resetTaxIfNeeded(stats) {
  const n = new Date();
  const today = n.toISOString().slice(0,10);
  const week  = getWeekStr(n);
  const month = n.toISOString().slice(0,7);
  if (stats.day_date   !== today) { stats.today_tax  = 0; stats.day_date   = today; }
  if (stats.week_date  !== week)  { stats.week_tax   = 0; stats.week_date  = week;  }
  if (stats.month_date !== month) { stats.month_tax  = 0; stats.month_date = month; }
  return stats;
}

ipcMain.handle('get-portfolio', () => readPortfolio());

ipcMain.handle('save-position', (_, position) => {
  const p = readPortfolio();
  const idx = p.positions.findIndex(x => x.id === position.id);
  if (idx >= 0) p.positions[idx] = position; else p.positions.push(position);
  writePortfolio(p);
  return { success: true };
});

ipcMain.handle('delete-position', (_, id) => {
  const p = readPortfolio();
  p.positions = p.positions.filter(x => x.id !== id);
  writePortfolio(p);
  return { success: true };
});

ipcMain.handle('sell-position', (_, { id, sell_price, quantity }) => {
  const p = readPortfolio();
  const pos = p.positions.find(x => x.id === id);
  if (!pos) return { success: false };

  const tax = Math.round(sell_price * quantity * 0.02);
  const net = Math.round(sell_price * quantity * 0.98);
  const cost = pos.cost_basis * quantity;
  const realized_pl = net - cost;

  p.tax_stats = resetTaxIfNeeded(p.tax_stats || defaultTaxStats());
  p.tax_stats.today_tax    += tax;
  p.tax_stats.week_tax     += tax;
  p.tax_stats.month_tax    += tax;
  p.tax_stats.lifetime_tax += tax;

  const now = new Date().toISOString();
  if (quantity >= pos.quantity) {
    pos.status = 'sold'; pos.sold_price = sell_price;
    pos.sold_quantity = pos.quantity; pos.realized_pl = realized_pl; pos.sold_at = now;
  } else {
    p.positions.push({ ...pos, id: Date.now().toString(), quantity, status:'sold',
      sold_price:sell_price, sold_quantity:quantity, realized_pl, sold_at:now });
    pos.quantity -= quantity;
  }

  writePortfolio(p);
  return { success:true, tax, realized_pl };
});

// Cache for item price history and wiki stats
const itemHistoryCache = new Map();
const itemStatsCache = new Map();


function parseItemStats(wikitext) {
  const get = (key) => {
    const pattern = new RegExp(`\\|\\s*${key}\\s*=\\s*([^|}\n]+)`);
    const m = wikitext.match(pattern);
    return m ? m[1].replace(/<!--.*?-->/g, '').replace(/\[\[([^\]|]*)\|?[^\]]*\]\]/g, '$1').trim() : null;
  };

  const examine  = get('examine') || get('examine1');
  const tier     = get('tier');
  const combatClass = get('class');
  const slot     = get('slot');
  const damage   = get('damage');
  const accuracy = get('accuracy');
  const style    = get('style');
  const speed    = get('speed') || get('attackspeed');
  const range    = get('range');
  const armour   = get('armour');
  const lp       = get('lp') || get('lifepoints');
  const prayer   = get('prayer');
  const type     = get('type');
  const members  = get('members');

  const isGear = !!(tier || damage || accuracy || armour);

  return { examine, tier, combatClass, slot, damage, accuracy, style, speed, range, armour, lp, prayer, type, members, isGear };
}

ipcMain.handle('get-item-stats', async (_, itemName) => {
  if (!itemName) return null;

  // Return cached result if available
  if (itemStatsCache.has(itemName)) return itemStatsCache.get(itemName);

  try {
    const https = require('https');
    const encoded = encodeURIComponent(itemName);
    const url = `https://runescape.wiki/api.php?action=query&titles=${encoded}&prop=revisions&rvprop=content&format=json&formatversion=2`;

    const result = await new Promise((resolve) => {
      const req = https.get(url, {
        headers: { 'User-Agent': 'GEnius/1.0 (github.com/VonDerThWood/GE-Intelligence)' }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const pages = json.query?.pages;
            if (!pages?.length) { resolve(null); return; }
            const page = pages[0];
            if (page.missing) { resolve(null); return; }
            const content = page.revisions?.[0]?.content || '';
            resolve(parseItemStats(content));
          } catch { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.setTimeout(8000, () => { req.destroy(); resolve(null); });
    });

    itemStatsCache.set(itemName, result);
    return result;
  } catch { return null; }
});

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

// ─── Category overrides editor ────────────────────────────────────────────────
// Points at the PERSONAL overrides file specifically, not the bulk/dev-
// curated category_overrides.json — the in-app editor should only ever
// touch Ben's own per-item edits, never the whole catalogue. catalogue.js
// merges both files at category-assignment time (personal wins per item).
const overridesFile = path.join(__dirname, 'backend-js', 'data', 'personal_overrides.json');

ipcMain.handle('get-overrides', () => {
  try {
    return JSON.parse(fs.readFileSync(overridesFile, 'utf8'));
  } catch (e) {
    return {};
  }
});

ipcMain.handle('save-overrides', (_, overrides) => {
  try {
    fs.writeFileSync(overridesFile, JSON.stringify(overrides, null, 2), 'utf8');
    // catalogue.js loads OVERRIDES into memory once at module load and
    // never re-reads the file on its own — without this, a saved edit
    // sits correctly on disk but is invisible to every fetch for the
    // rest of the app's run, looking exactly like "it didn't save."
    require('./backend-js/catalogue.js').reloadOverrides();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ─── Price history ────────────────────────────────────────────────────────────
// Stored as one small file per item (data/history/<id>.json) instead of a
// single monolithic history.json. The old single-file approach hit a real
// wall for real: history.json grew to ~512MB (confirmed: ~10.1M genuine
// price points across 3,435 items, not corruption) — right at V8's hard
// string-length ceiling (~536MB), and EVERY save re-serialized the WHOLE
// file regardless of how many items actually changed, which is also what
// made the app briefly look like it had crashed (a multi-second synchronous
// JSON.stringify attempt on a >500MB object, which then threw "Invalid
// string length" anyway). Per-item files have no such ceiling — each is at
// most a few hundred KB — and a save only ever touches the items that
// actually changed (see dirtyHistoryIds below), not the entire dataset.
let historyFile;     // OLD monolithic file path — kept only for one-time migration
let historyDir;      // NEW per-item storage directory
let historyData = {};        // { itemId: [{timestamp, price, volume}] } — in-memory, same shape as before
let dirtyHistoryIds = new Set(); // ids changed since the last saveHistory() call
let historyFetchQueue = [];  // item IDs waiting to be fetched
let historyFetchActive = false;
let historyFetchStop = false;
// Persisted (not just in-memory) so the UI can tell "first 300 done,
// now just continuing in the background" apart from "still on the
// first 300" across restarts/interruptions, instead of re-deriving it
// from a per-session counter that always restarted at 0 and looked
// like progress had been lost (it hadn't — see SESSION_LOG.md,
// 2026-06-26).
let historyInitial300Done = store.get('historyInitial300Done', false);

// Resolves once historyData is fully populated from disk. Anything that
// needs complete history data (the population-resume check, mainly)
// should await this instead of assuming loadHistory() already finished —
// it no longer runs synchronously before the window even shows.
let historyLoadDone;
const historyLoadedPromise = new Promise(res => { historyLoadDone = res; });

// Genuinely async — reads files in parallel batches via fs.promises
// instead of a tight fs.readFileSync loop. With thousands of per-item
// files (this exact migration is what produced them — see SESSION_LOG.md,
// 2026-06-26), a synchronous loop blocks Node's single JS thread for the
// entire load, which blocks ALL window painting and input the whole
// time — confirmed for real via Windows Event Viewer: two genuine
// AppHangTransient events for electron.exe, seconds apart, lining up
// exactly with a relaunch right after the per-item migration. Async
// reads release the thread during each file's disk wait, so the window
// stays responsive throughout even though the total load time is similar.
async function loadHistory() {
  if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true });

  const existingFiles = fs.readdirSync(historyDir).filter(f => f.endsWith('.json'));
  if (existingFiles.length > 0) {
    // Already migrated — load per-item files directly, in batches so we
    // don't fire thousands of concurrent file handles at once.
    const BATCH = 200;
    for (let i = 0; i < existingFiles.length; i += BATCH) {
      const batch = existingFiles.slice(i, i + BATCH);
      await Promise.all(batch.map(async f => {
        const id = f.slice(0, -5);
        try {
          historyData[id] = JSON.parse(await fs.promises.readFile(path.join(historyDir, f), 'utf8'));
        } catch (e) {
          console.warn(`[history] Skipping unreadable per-item file ${f}:`, e.message);
        }
      }));
    }
    console.log(`[history] Loaded ${Object.keys(historyData).length} items from per-item storage.`);
    historyLoadDone();
    return;
  }

  // One-time migration from the old monolithic history.json, if present.
  // Synchronous reads are fine here — this only ever runs once per
  // install, on the specific run that migrates the old format, not on
  // every single startup like the per-item load path above.
  if (fs.existsSync(historyFile)) {
    console.log('[history] Migrating from old monolithic history.json to per-item storage...');
    try {
      const old = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
      let migrated = 0;
      for (const [id, points] of Object.entries(old)) {
        try {
          atomicWrite(path.join(historyDir, `${id}.json`), JSON.stringify(points));
          historyData[id] = points;
          migrated++;
        } catch (e) {
          console.warn(`[history] Failed to migrate item ${id}:`, e.message);
        }
      }
      // Keep the old file as a backup rather than deleting it outright —
      // costs nothing to keep around and means the migration is reversible
      // if something about the new format turns out to be wrong.
      fs.renameSync(historyFile, historyFile + '.pre-migration-backup');
      console.log(`[history] Migration complete: ${migrated} items moved to per-item storage. Old file kept as history.json.pre-migration-backup.`);
    } catch (e) {
      // Don't just silently vanish into an empty cache — back up whatever's
      // there so a corrupt file is diagnosable later instead of a mystery.
      console.error('[history] Failed to parse old history.json, resetting:', e.message);
      try {
        if (fs.existsSync(historyFile)) fs.copyFileSync(historyFile, historyFile + '.corrupt-' + Date.now());
      } catch {}
    }
  }
  historyLoadDone();
}

function atomicWrite(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, filePath);
}

function saveHistory() {
  // Only writes items actually touched since the last save — never the
  // whole dataset. Each per-item file is small (at most a few hundred KB
  // even for an item with 6000+ price points), so this can never hit the
  // string-length ceiling that the old single-file approach eventually did.
  if (dirtyHistoryIds.size === 0) return;
  const toSave = [...dirtyHistoryIds];
  dirtyHistoryIds.clear();
  for (const id of toSave) {
    try {
      atomicWrite(path.join(historyDir, `${id}.json`), JSON.stringify(historyData[id]));
    } catch (e) {
      console.error(`[history] Save failed for item ${id}:`, e.message);
      dirtyHistoryIds.add(id); // retry on next save
    }
  }
}

function fetchHistoryForItemOnce(itemId, timeoutMs) {
  return new Promise((resolve) => {
    const https = require('https');
    const url = `https://api.weirdgloop.org/exchange/history/rs/all?id=${itemId}`;
    const req = https.get(url, {
      headers: { 'User-Agent': 'GEnius/1.3 (github.com/VonDerThWood/GE-Intelligence)' }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          console.warn(`[history] HTTP ${res.statusCode} fetching item ${itemId} (timeout ${timeoutMs}ms)`);
          resolve(false);
          return;
        }
        try {
          const json = JSON.parse(data);
          const raw = json[String(itemId)] || null;
          if (raw && raw.length) {
            const points = raw.map(p => ({
              timestamp: p.timestamp,
              price: p.price,
              volume: p.volume || 0,
            })).filter(p => p.price);
            historyData[String(itemId)] = points;
            dirtyHistoryIds.add(String(itemId));
            // Also update ath cache so timeseries fetch is free
            athCache[String(itemId)] = { data: points.map(p => ({timestamp:p.timestamp, high:p.price, low:p.price, volume:p.volume})) };
          }
          resolve(!!raw);
        } catch (e) {
          console.warn(`[history] Parse error for item ${itemId}:`, e.message);
          resolve(false);
        }
      });
    });
    req.on('error', (e) => {
      console.warn(`[history] Network error for item ${itemId}:`, e.message);
      resolve(false);
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(false); });
  });
}

// A slow connection can legitimately take longer than a single short
// timeout to complete a REAL, successful fetch — a tester's chart looked
// permanently "unavailable" on the first try but worked once given more
// time on a manual retry, for items that genuinely have real data. The
// original single 10s attempt with no retry made "slow" indistinguishable
// from "doesn't exist." One retry with a longer timeout before actually
// giving up.
async function fetchHistoryForItem(itemId) {
  if (await fetchHistoryForItemOnce(itemId, 12000)) return true;
  return fetchHistoryForItemOnce(itemId, 20000);
}

async function runHistoryQueue(onProgress) {
  if (historyFetchActive) return;
  historyFetchActive = true;
  historyFetchStop = false;
  let done = 0;
  const total = historyFetchQueue.length;

  while (historyFetchQueue.length > 0 && !historyFetchStop) {
    const id = historyFetchQueue.shift();
    if (historyData[String(id)]) { done++; continue; } // already have it
    await fetchHistoryForItem(id);
    done++;
    if (!historyInitial300Done && Object.keys(historyData).length >= 300) {
      historyInitial300Done = true;
      store.set('historyInitial300Done', true);
    }
    if (onProgress) onProgress(done, total);
    if (done % 20 === 0) saveHistory(); // save every 20 items
    await new Promise(r => setTimeout(r, 400)); // ~2.5/sec, well under limit
  }

  saveHistory();
  historyFetchActive = false;
  console.log(`[history] Queue complete. ${Object.keys(historyData).length} items stored.`);
}

ipcMain.handle('get-history-status', async () => {
  // historyData loads in the background now (see loadHistory) — without
  // this, a status check made right at launch could catch it still
  // mid-load and wrongly report 0 stored items / isFirstRun:true.
  await historyLoadedPromise;
  return {
    stored: Object.keys(historyData).length,
    queued: historyFetchQueue.length,
    active: historyFetchActive,
    isFirstRun: Object.keys(historyData).length === 0,
    initial300Done: historyInitial300Done,
  };
});

// Cheap full id list (a few thousand numbers) so the UI can show a
// "history still loading" note for any specific item not yet covered,
// without a per-item round trip.
ipcMain.handle('get-history-populated-ids', () => Object.keys(historyData).map(Number));

ipcMain.handle('get-item-history-local', (_, itemId) => {
  return historyData[String(itemId)] || null;
});

ipcMain.handle('start-history-population', async (_, itemIds) => {
  // Without this, calling this right at launch (before the background
  // load finishes) could re-queue items that are actually already on
  // disk, just not loaded into memory yet — wasted re-fetches, not
  // dangerous, but worth avoiding.
  await historyLoadedPromise;
  // itemIds = sorted by volume descending, top 300 first
  const newIds = itemIds.filter(id => !historyData[String(id)]);
  historyFetchQueue = [...new Set([...historyFetchQueue, ...newIds])];
  console.log(`[history] Queue set: ${historyFetchQueue.length} items to fetch`);

  runHistoryQueue((done, total) => {
    notifyRenderer('history-progress', {
      done,
      total,
      stored: Object.keys(historyData).length,
      queueRemaining: historyFetchQueue.length,
      initial300Done: historyInitial300Done,
    });
  });

  return { queued: historyFetchQueue.length, total: itemIds.length };
});

ipcMain.handle('stop-history-population', () => {
  historyFetchStop = true;
  return { success: true };
});

// ─── Signal trend — recompute historical signals from history.json ──────────
// Mirrors the thresholds in python/run.py compute_signals()
const SIGNAL_TREND_DAYS = 7;
ipcMain.handle('get-signal-trend', (_, itemLimits) => {
  const limits = itemLimits || {};
  const toSec = ts => (ts && ts > 1e11 ? ts / 1000 : (ts || 0));
  const dayKey = sec => new Date(sec * 1000).toDateString();
  const days = [];
  const now = new Date();
  for (let i = SIGNAL_TREND_DAYS - 1; i >= 0; i--) {
    const d = new Date(now); d.setDate(now.getDate() - i);
    days.push(d.toDateString());
  }
  const counts = {SURGE:[], DUMP:[], ACCUMULATION:[], DISTRIBUTION:[], FRENZY:[], HIGH_VOL:[], MANIPULATED:[]};
  for (const key of Object.keys(counts)) counts[key] = days.map(() => 0);
  const itemDays = {SURGE:{}, DUMP:{}, ACCUMULATION:{}, DISTRIBUTION:{}, FRENZY:{}, HIGH_VOL:{}, MANIPULATED:{}};

  for (const itemId in historyData) {
    const points = historyData[itemId];
    if (!points || points.length < 8) continue;
    // One point per day — keep latest per day, sorted ascending
    const byDay = {};
    for (const p of points) {
      const sec = toSec(p.timestamp);
      const dk = dayKey(sec);
      if (!byDay[dk] || sec > toSec(byDay[dk].timestamp)) byDay[dk] = p;
    }
    const sorted = Object.values(byDay).sort((a,b) => toSec(a.timestamp) - toSec(b.timestamp));
    if (sorted.length < 8) continue;

    const vols = sorted.map(p => p.volume).filter(v => v != null).sort((a,b) => a-b);
    if (!vols.length) continue;
    const mid = Math.floor(vols.length / 2);
    const avgVol = vols.length % 2 ? vols[mid] : (vols[mid-1] + vols[mid]) / 2;
    if (!avgVol) continue;

    for (let di = 0; di < days.length; di++) {
      const dayStr = days[di];
      const idx = sorted.findIndex(p => dayKey(toSec(p.timestamp)) === dayStr);
      if (idx < 1) continue; // need a previous day to compute change
      const cur = sorted[idx], prev = sorted[idx-1];
      if (!cur.price || !prev.price) continue;
      const chg = ((cur.price - prev.price) / prev.price) * 100;
      const vol = cur.volume || 0;
      const volRatio = avgVol ? vol / avgVol : 0;
      const absChgGp = Math.abs(chg / 100 * cur.price);

      const mark = (sig) => {
        counts[sig][di]++;
        if (!itemDays[sig][itemId] || itemDays[sig][itemId] < di) itemDays[sig][itemId] = di;
      };

      if (chg >= 5 && absChgGp >= 1000 && volRatio >= 1.2) mark('SURGE');
      else if (chg <= -5 && absChgGp >= 1000 && volRatio >= 1.2) mark('DUMP');
      else if (chg >= -3 && chg <= 3) {
        if (volRatio >= 2.5) mark('DISTRIBUTION');
        else if (volRatio >= 1.3) mark('ACCUMULATION');
      }
      if (vol >= 5000 && avgVol) {
        if (volRatio >= 2.5) mark('FRENZY');
        else if (volRatio >= 1.5) mark('HIGH_VOL');
      }
      const limit = limits[itemId] || 0;
      if (volRatio >= 2.5 && Math.abs(chg) >= 8.0 && limit > 0 && limit <= 100) mark('MANIPULATED');
    }
  }

  const itemIds = {};
  for (const sig of Object.keys(itemDays)) {
    itemIds[sig] = Object.entries(itemDays[sig]).map(([id, lastDayIdx]) => ({id, lastDayIdx}));
  }

  return { days, counts, itemIds };
});

ipcMain.handle('get-item-history', async (_, itemId) => {
  if (itemHistoryCache.has(itemId)) return itemHistoryCache.get(itemId);

  const existing = historyData[String(itemId)];
  if (existing && existing.length) {
    // Check if data is stale (most recent point older than 8 days = old last90d cache)
    const sorted = [...existing].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    const latestTs = sorted[0].timestamp || 0;
    const ageMs = Date.now() - latestTs * (latestTs < 1e12 ? 1000 : 1);
    const stale = ageMs > 8 * 24 * 60 * 60 * 1000;
    if (!stale) {
      itemHistoryCache.set(itemId, existing);
      return existing;
    }
    // Stale — fall through to refetch
    console.log(`[history] Stale data for ${itemId}, refetching from all endpoint`);
  }

  // Fetch live and store
  await fetchHistoryForItem(itemId);
  const result = historyData[String(itemId)] || null;
  if (result) {
    itemHistoryCache.set(itemId, result);
    saveHistory();
  }
  return result;
});

// ─── Full timeseries (ATH/ATL + date lookup) ─────────────────────────────────
let athCache = {};     // { itemId: { fetchedAt, data: [{timestamp, high, low}] } }
let athCacheFile;

// ─── Price snapshots (local recent history, 1 per day per item) ───────────────
let snapshotData = {};  // { itemId: [{t, p, v}] }
let snapshotFile;

function loadSnapshots() {
  try {
    if (fs.existsSync(snapshotFile)) snapshotData = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
  } catch { snapshotData = {}; }
}

function saveSnapshots() {
  try { atomicWrite(snapshotFile, JSON.stringify(snapshotData)); } catch {}
}

function updateSnapshots() {
  try {
    if (!fs.existsSync(dataFile)) return;
    const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    const items = parsed?.items || [];
    if (!items.length) return;
    const nowTs = Math.floor(Date.now() / 1000);
    const cutoff = nowTs - 90 * 24 * 3600;
    const todayStr = new Date().toDateString();
    items.forEach(item => {
      if (!item.id) return;
      const price = item.high || item.low;
      if (!price) return;
      const key = String(item.id);
      const arr = (snapshotData[key] || []).filter(s => s.t >= cutoff);
      const last = arr[arr.length - 1];
      const lastDay = last ? new Date(last.t * 1000).toDateString() : null;
      if (lastDay === todayStr) {
        arr[arr.length - 1] = {t: nowTs, p: price, v: item.volume || 0};
      } else {
        arr.push({t: nowTs, p: price, v: item.volume || 0});
      }
      snapshotData[key] = arr;
    });
    saveSnapshots();
  } catch (e) { console.error('[snapshots] Error:', e.message); }
}

ipcMain.handle('get-price-snapshots', (_, itemId) => {
  return (snapshotData[String(itemId)] || []).map(s => ({timestamp: s.t, price: s.p, volume: s.v}));
});

function loadAthCache() {
  try {
    if (fs.existsSync(athCacheFile)) athCache = JSON.parse(fs.readFileSync(athCacheFile, 'utf8'));
  } catch { athCache = {}; }
}

function saveAthCache() {
  try { atomicWrite(athCacheFile, JSON.stringify(athCache)); } catch {}
}

ipcMain.handle('get-item-timeseries', async (_, itemId) => {
  const key = String(itemId);
  // Reuse ath cache if available
  if (athCache[key]) return athCache[key].data;
  // Reuse history data if available (already fetched via all endpoint)
  if (historyData[key] && historyData[key].length) {
    const data = historyData[key].map(p => ({timestamp:p.timestamp, high:p.price||p.high, low:p.price||p.low, volume:p.volume||0}));
    athCache[key] = { data };
    return data;
  }
  // Fetch fresh — fetchHistoryForItem now uses the all endpoint and populates both caches
  await fetchHistoryForItem(itemId);
  return athCache[key] ? athCache[key].data : null;
});

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
    const https = require('https');
    const current = app.getVersion();
    const data = await new Promise((resolve, reject) => {
      const req = https.get(
        'https://api.github.com/repos/VonDerThWood/GE-Intelligence/releases/latest',
        { headers: { 'User-Agent': 'GEnius-App' } },
        res => {
          let body = '';
          res.on('data', d => body += d);
          res.on('end', () => resolve(JSON.parse(body)));
        }
      );
      req.on('error', reject);
      req.setTimeout(8000, () => req.destroy());
    });
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

app.whenReady().then(() => {
  // Initialize data paths here — app.getPath() requires app to be ready
  dataDir       = path.join(app.getPath('userData'), 'data');
  dataFile      = path.join(dataDir, 'latest.json');
  alertsFile    = path.join(dataDir, 'alerts.json');
  portfolioFile = path.join(dataDir, 'portfolio.json');
  historyFile   = path.join(dataDir, 'history.json');
  historyDir    = path.join(dataDir, 'history');
  athCacheFile  = path.join(dataDir, 'ath_cache.json');
  snapshotFile  = path.join(dataDir, 'price_snapshots.json');
  loadAthCache();
  loadSnapshots();
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  createWindow();
  createTray();
  // Window shows immediately; history loads in the background rather
  // than blocking startup. Even with the async-batched reads above,
  // there's no reason to make window creation wait on it.
  loadHistory();
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
