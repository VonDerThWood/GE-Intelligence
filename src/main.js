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
function getPythonExecutable() {
  const base = isDev
    ? path.join(__dirname, '..')
    : process.resourcesPath;

  const embeddedPython = path.join(base, 'python-embed', 'python.exe');
  console.log('[Python] Checking embedded:', embeddedPython);

  if (fs.existsSync(embeddedPython)) {
    console.log('[Python] Using embedded Python');
    return embeddedPython;
  }

  console.log('[Python] Embedded not found, trying system Python');

  // Fallback: find system Python, skip Microsoft Store stub
  try {
    const { execSync } = require('child_process');
    const result = execSync('where python', { timeout: 3000 }).toString();
    const paths = result.split('\n').map(p => p.trim()).filter(Boolean);
    for (const p of paths) {
      if (p && !p.includes('WindowsApps') && fs.existsSync(p)) {
        console.log('[Python] Using system Python:', p);
        return p;
      }
    }
  } catch {}

  try {
    const { execSync } = require('child_process');
    const result = execSync('where py', { timeout: 3000 }).toString().trim().split('\n')[0].trim();
    if (result && fs.existsSync(result)) {
      console.log('[Python] Using py launcher:', result);
      return result;
    }
  } catch {}

  console.log('[Python] Falling back to bare python command');
  return 'python';
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
        notifyRenderer('fetch-error', { error: error.message });
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
    const raw = fs.readFileSync(dataFile, { encoding: 'utf8' });
    const parsed = JSON.parse(raw);
    console.log(`[get-data] Loaded ${parsed.items?.length ?? 0} items`);
    return parsed;
  } catch (e) {
    console.error('[get-data] Error:', e.message);
    return { items: [], timestamp: null };
  }
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
}));

ipcMain.handle('save-settings', (_, settings) => {
  Object.entries(settings).forEach(([k, v]) => store.set(k, v));
  startScheduler();
  return { success: true };
});

ipcMain.handle('get-watchlist', () => store.get('watchlist', []));
ipcMain.handle('set-watchlist', (_, list) => { store.set('watchlist', list); return { success: true }; });

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
    if (latest && latest !== current) {
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
