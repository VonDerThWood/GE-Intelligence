const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const Store = require('electron-store');

const store = new Store();
const isDev = process.argv.includes('--dev');

let mainWindow = null;
let tray = null;
let schedulerInterval = null;
let isQuitting = false;

// ─── Paths (defined as lets, set after app ready) ─────────────────────────────
const resourcesPath = isDev
  ? path.join(__dirname, '..')
  : process.resourcesPath;

const pythonDir = isDev
  ? path.join(__dirname, '..', 'python')
  : path.join(process.resourcesPath, 'python');

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

// ─── Python runner ────────────────────────────────────────────────────────────
// Tracks how the last-resolved Python was found, so a failed fetch can tell
// the user WHY (e.g. the embedded runtime is missing — almost always AVG
// quarantining/deleting it during install, see Settings > Troubleshooting)
// instead of just surfacing a raw ENOENT/spawn error.
let lastPythonSource = 'embedded';

function getEmbeddedPythonPath() {
  const base = isDev
    ? path.join(__dirname, '..')
    : process.resourcesPath;
  return path.join(base, 'python-embed', 'python.exe');
}

function getPythonExecutable() {
  const embeddedPython = getEmbeddedPythonPath();
  console.log('[Python] Checking embedded:', embeddedPython);

  if (fs.existsSync(embeddedPython)) {
    console.log('[Python] Using embedded Python');
    lastPythonSource = 'embedded';
    return embeddedPython;
  }

  console.log('[Python] Embedded not found, trying system Python');
  lastPythonSource = 'embedded-missing';

  // Fallback: find system Python, skip Microsoft Store stub
  try {
    const { execSync } = require('child_process');
    const result = execSync('where python', { timeout: 3000 }).toString();
    const paths = result.split('\n').map(p => p.trim()).filter(Boolean);
    for (const p of paths) {
      if (p && !p.includes('WindowsApps') && fs.existsSync(p)) {
        console.log('[Python] Using system Python:', p);
        lastPythonSource = 'system';
        return p;
      }
    }
  } catch {}

  try {
    const { execSync } = require('child_process');
    const result = execSync('where py', { timeout: 3000 }).toString().trim().split('\n')[0].trim();
    if (result && fs.existsSync(result)) {
      console.log('[Python] Using py launcher:', result);
      lastPythonSource = 'system';
      return result;
    }
  } catch {}

  console.log('[Python] Falling back to bare python command');
  lastPythonSource = 'embedded-missing';
  return 'python';
}

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

    const python = getPythonExecutable();
    const scriptPath = path.join(pythonDir, 'dxp_intelligence.py');
    const args = [scriptPath, `--data-dir=${dataDir}`];

    console.log('[DXP Intel] Running:', python, args.join(' '));

    execFile(python, args, { env: process.env }, (error, stdout, stderr) => {
      if (stderr) console.warn('[DXP Intel] stderr:', stderr.slice(0, 500));
      if (error) {
        console.error('[DXP Intel] Error:', error.message);
        reject(error);
        return;
      }
      try {
        const out = JSON.parse(fs.readFileSync(path.join(dataDir, 'dxp_intelligence.json'), 'utf8'));
        dxpIntelCache = { historyMtimeMs, data: out };
        resolve(out);
      } catch (e) {
        reject(e);
      }
    });
  });
}

function runPython(mode = 'prices') {
  return new Promise((resolve, reject) => {
    const python = getPythonExecutable();
    const scriptPath = path.join(pythonDir, 'run.py');
    const webhookUrl = store.get('discordWebhook', '');
    const args = [scriptPath, `--mode=${mode}`, `--data-dir=${dataDir}`];
    if (webhookUrl) args.push(`--webhook=${webhookUrl}`);

    console.log('[Python] Running:', python, args.join(' '));

    execFile(python, args, { env: process.env }, (error, stdout, stderr) => {
      if (stderr) console.warn('[Python] stderr:', stderr.slice(0, 500));
      if (error) {
        console.error('[Python] Error:', error.message);
        const pythonMissing = lastPythonSource === 'embedded-missing';
        const message = pythonMissing
          ? `Embedded Python runtime not found. This is usually caused by antivirus (AVG especially) quarantining or deleting it during install — see Settings > Troubleshooting. (${error.message})`
          : error.message;
        notifyRenderer('fetch-error', { error: message, pythonMissing });
        reject(error);
      } else {
        console.log('[Python] stdout:', stdout);
        notifyRenderer('fetch-complete', { mode, timestamp: Date.now(), pythonOut: stdout });
        if (mode === 'prices' || !mode) updateSnapshots();
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

// Proactive check for the Settings > Troubleshooting section — lets the user
// see the Python runtime is missing (almost always AVG quarantining it)
// without having to run a fetch and watch it fail first.
ipcMain.handle('get-python-health', () => {
  const embeddedPython = getEmbeddedPythonPath();
  const embeddedFound = fs.existsSync(embeddedPython);
  let itemCount = 0;
  try {
    const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    itemCount = parsed.items?.length || 0;
  } catch {}
  return { embeddedFound, embeddedPath: embeddedPython, itemCount };
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
const overridesFile = path.join(pythonDir, 'category_overrides.json');

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
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ─── Price history ────────────────────────────────────────────────────────────
let historyFile;
let historyData = {};        // { itemId: [{timestamp, price, volume}] }
let historyFetchQueue = [];  // item IDs waiting to be fetched
let historyFetchActive = false;
let historyFetchStop = false;

function loadHistory() {
  try {
    if (fs.existsSync(historyFile)) {
      historyData = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
    }
  } catch { historyData = {}; }
}

function atomicWrite(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, filePath);
}

function saveHistory() {
  try { atomicWrite(historyFile, JSON.stringify(historyData)); }
  catch (e) { console.error('[history] Save failed:', e.message); }
}

async function fetchHistoryForItem(itemId) {
  return new Promise((resolve) => {
    const https = require('https');
    const url = `https://api.weirdgloop.org/exchange/history/rs/all?id=${itemId}`;
    const req = https.get(url, {
      headers: { 'User-Agent': 'GEnius/1.3 (github.com/VonDerThWood/GE-Intelligence)' }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
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
            // Also update ath cache so timeseries fetch is free
            athCache[String(itemId)] = { data: points.map(p => ({timestamp:p.timestamp, high:p.price, low:p.price, volume:p.volume})) };
          }
          resolve(!!raw);
        } catch { resolve(false); }
      });
    });
    req.on('error', () => resolve(false));
    req.setTimeout(10000, () => { req.destroy(); resolve(false); });
  });
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
    if (onProgress) onProgress(done, total);
    if (done % 20 === 0) saveHistory(); // save every 20 items
    await new Promise(r => setTimeout(r, 400)); // ~2.5/sec, well under limit
  }

  saveHistory();
  historyFetchActive = false;
  console.log(`[history] Queue complete. ${Object.keys(historyData).length} items stored.`);
}

ipcMain.handle('get-history-status', () => ({
  stored: Object.keys(historyData).length,
  queued: historyFetchQueue.length,
  active: historyFetchActive,
  isFirstRun: !fs.existsSync(historyFile) || Object.keys(historyData).length === 0,
}));

ipcMain.handle('get-item-history-local', (_, itemId) => {
  return historyData[String(itemId)] || null;
});

ipcMain.handle('start-history-population', (_, itemIds) => {
  // itemIds = sorted by volume descending, top 300 first
  const newIds = itemIds.filter(id => !historyData[String(id)]);
  historyFetchQueue = [...new Set([...historyFetchQueue, ...newIds])];
  console.log(`[history] Queue set: ${historyFetchQueue.length} items to fetch`);

  runHistoryQueue((done, total) => {
    notifyRenderer('history-progress', {
      done,
      total,
      stored: Object.keys(historyData).length,
      queueRemaining: historyFetchQueue.length
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
  athCacheFile  = path.join(dataDir, 'ath_cache.json');
  snapshotFile  = path.join(dataDir, 'price_snapshots.json');
  loadAthCache();
  loadSnapshots();
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  loadHistory();

  createWindow();
  createTray();
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

app.on('activate', () => {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  else mainWindow.show();
});

app.on('before-quit', () => { isQuitting = true; stopScheduler(); });

// Allow installer/Windows shutdown to close the app properly
app.on('will-quit', () => { isQuitting = true; });
process.on('SIGTERM', () => { isQuitting = true; app.quit(); });
process.on('SIGINT',  () => { isQuitting = true; app.quit(); });
