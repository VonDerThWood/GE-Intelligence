/**
 * Mobile (Capacitor) implementation of window.genius — matches src/preload.js's
 * exact shape, function-for-function, so renderer.js runs completely unchanged
 * on Android. The difference is entirely in HOW each call is satisfied:
 * preload.js bridges to main.js over Electron IPC; this calls api.js's
 * functions directly in the same JS context (there's no separate main/
 * renderer process on mobile — the whole app, UI included, runs in one
 * webview), using storage-capacitor.js instead of storage.js underneath.
 *
 * Bundled by mobile/build.js (esbuild, aliasing './storage.js' to
 * './storage-capacitor.js' for every file in backend-js/) into
 * mobile/www/bridge.js, loaded by mobile/www/index.html before renderer.js.
 */

const { createGeniusApi } = require('../../src/backend-js/api.js');
const storage = require('../../src/backend-js/storage.js'); // aliased to storage-capacitor.js at bundle time
const { App } = require('@capacitor/app');
const { Filesystem, Directory, Encoding } = require('@capacitor/filesystem');
const { LocalNotifications } = require('@capacitor/local-notifications');
const { BackgroundRunner } = require('@capacitor/background-runner');

// Logical root, not a real OS path — storage-capacitor.js strips this
// exact prefix off every path api.js builds via path.join(dataDir, ...)
// so the remainder addresses files relative to Capacitor's Directory.Data.
const DATA_DIR = 'genius-data';
if (storage.setDataDirPrefix) storage.setDataDirPrefix(DATA_DIR);

let api = null;
let store = null; // kept separately, same as main.js — api.js never re-exposes the store it was given
let apiReady = null;

// Tiny pub-sub standing in for ipcRenderer.on/removeAllListeners — main.js's
// notifyRenderer() pushed events across the IPC boundary; here, whatever
// triggers the event (runFetch, history population) just calls these
// directly in the same process.
const listeners = {};
function emit(channel, data) { (listeners[channel] || []).forEach(cb => cb(data)); }
function on(channel, cb) { (listeners[channel] = listeners[channel] || []).push(cb); }
function removeAllListeners(channel) { delete listeners[channel]; }

async function ensureApi() {
  if (api) return api;
  if (!apiReady) {
    apiReady = (async () => {
      store = await storage.createKVStore(DATA_DIR + '/config.json');
      api = await createGeniusApi({ dataDir: DATA_DIR, store });
      api.loadHistory(); // background, same as desktop — window/UI doesn't wait on it
      return api;
    })();
  }
  return apiReady;
}

// Export writes the backup directly into the device's shared Documents
// folder via Capacitor's Filesystem plugin (real native file I/O, not a
// blob URL) — confirmed for real that the more "web-standard" approach
// (Blob + <a download>) silently does nothing on Android's WebView: full
// Chrome handles download-attribute blob URLs fine, but the WebView
// component apps actually run in has never reliably supported it. Writing
// to Directory.Documents instead produces a real file the user can find
// via any file manager or back up through Google Drive/Files, then move
// to/from a PC however they like (USB, cloud, email — there's no live
// sync between desktop and mobile, just this one-shot transfer).
async function exportToDocuments(filename, data) {
  await Filesystem.writeFile({
    path: filename,
    data: JSON.stringify(data, null, 2),
    directory: Directory.Documents,
    encoding: Encoding.UTF8,
  });
}

function pickJSONFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.style.display = 'none';
    document.body.appendChild(input);
    const cleanup = () => input.remove();
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) { cleanup(); resolve(null); return; }
      const reader = new FileReader();
      reader.onload = () => { cleanup(); resolve(reader.result); };
      reader.onerror = () => { cleanup(); resolve(null); };
      reader.readAsText(file);
    });
    // Chromium (Android's WebView is Chromium-based, confirmed v149 in
    // testing) fires 'cancel' on the input itself when the picker is
    // dismissed without choosing a file — lets Import Backup correctly
    // report {canceled:true} instead of hanging or erroring.
    input.addEventListener('cancel', () => { cleanup(); resolve(null); });
    input.click();
  });
}

let notificationPermissionChecked = false;
async function ensureNotificationPermission() {
  if (notificationPermissionChecked) return;
  notificationPermissionChecked = true;
  try {
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') await LocalNotifications.requestPermissions();
  } catch (e) {
    console.error('[GEnius] Notification permission check failed:', e.message);
  }
}

// Fires a real native Android notification — the mobile equivalent of
// main.js's `new Notification({...}).show()`. LocalNotifications needs an
// integer id; Date.now() truncated to 32 bits is good enough here since
// IDs only need to not collide with each other, not be globally meaningful.
async function fireNotification(title, body) {
  await ensureNotificationPermission();
  try {
    await LocalNotifications.schedule({
      notifications: [{
        id: Date.now() % 2147483647,
        title, body,
        schedule: { at: new Date(Date.now() + 100) },
      }],
    });
  } catch (e) {
    console.error('[GEnius] Failed to fire notification:', e.message);
  }
}

// Pushes the small slice of state the background runner needs (it can't
// reach api.js/storage-capacitor.js itself — see mobile/runners/background.js's
// file comment) into its own CapacitorKV store via dispatchEvent. Cheap
// enough to call on every relevant settings/watchlist/reminder change plus
// once per scheduled fetch, so the WorkManager-driven background checks are
// never working from data older than the last time the app was open.
async function syncRunnerState() {
  try {
    const a = await ensureApi();
    const [data, dxpData] = await Promise.all([
      a.getData().catch(() => ({ items: [] })),
      a.getDxpIntelligence().catch(() => ({})),
    ]);
    const namesById = Object.fromEntries((data.items || []).map(i => [String(i.id), i.name]));
    const withNames = (ids) => ids.map(id => ({ id, name: namesById[String(id)] || String(id) }));

    const dxpWatchlist = store.get('dxpWatchlist', []);
    const dxpTiming = {};
    for (const id of dxpWatchlist) {
      const t = dxpData[id]?.timing;
      if (t) dxpTiming[id] = t;
    }

    const events = await storage.readJSON(DATA_DIR + '/dxp_events.json', []).catch(() => []);

    await BackgroundRunner.dispatchEvent({
      label: 'com.vonderthwood.genius.background.task',
      event: 'syncState',
      details: {
        watchlist: withNames(store.get('watchlist', [])),
        dxpWatchlist: withNames(dxpWatchlist),
        dxpTiming,
        dxpEvents: events,
        dxpSettings: store.get('dxpNotificationSettings', {
          enabled: false, buyAlerts: true, sellAlerts: true, announceAlerts: true, windowApproachingAlerts: true,
        }),
        watchlistSettings: store.get('watchlistNotificationSettings', {
          enabled: false, dailyThresholdPct: 5, trendThresholdPct: 7,
        }),
        reminders: store.get('reminders', []),
        notificationsEnabled: store.get('notifications', true),
      },
    });
  } catch (e) {
    console.error('[GEnius] Background runner sync failed:', e.message);
  }
}

// Mirrors main.js's checkDxpNotifications/checkWatchlistDigest/
// checkReminders — same shared api.js logic, just firing each returned
// descriptor as a real native notification instead of Electron's.
async function runNotificationChecks() {
  const a = await ensureApi();
  for (const n of await a.getDxpNotifications()) await fireNotification(n.title, n.body);
  const digest = await a.getWatchlistDigest();
  if (digest) await fireNotification(digest.title, digest.body);
  for (const r of await a.getDueReminders()) await fireNotification(r.title, r.body);
}

// Mirrors main.js's runPython() — runs run.js's main() in-process and emits
// the same fetch-complete/fetch-error events the desktop build does, so
// renderer.js's existing onFetchComplete/onFetchError handlers work as-is.
async function runFetch(mode) {
  const a = await ensureApi();
  const { main: runJs } = require('../../src/backend-js/run.js');
  try {
    await a.historyLoadedPromise;
    const argv = [`--mode=${mode || 'prices'}`, `--data-dir=${DATA_DIR}`];
    await runJs(argv, a.historyData);
    emit('fetch-complete', { mode, timestamp: Date.now() });
    if (mode === 'prices' || !mode) await a.updateSnapshots();
  } catch (error) {
    emit('fetch-error', { error: error.message });
    throw error;
  }
}

async function buildGenius() {
  const a = await ensureApi();

  // get-settings/save-settings and the various simple store-backed
  // get/set pairs below are deliberately identical to main.js's
  // equivalents — same defaults, same keys, same shape — since they're
  // reading/writing the exact same kind of flat KV store underneath.
  return {
    // Data
    getData: () => a.getData(),
    fetchNow: (mode) => runFetch(mode).then(() => ({ success: true })).catch(e => ({ success: false, error: e.message })),
    getDataDir: () => DATA_DIR,
    quitApp: () => ({ success: true }), // no desktop-style "quit" concept on mobile; Android handles backgrounding itself
    getAppVersion: () => require('../../package.json').version,
    getDxpIntelligence: (opts) => a.getDxpIntelligence(opts).catch(() => ({})),
    getDxpEvents: () => a.getDxpEvents().catch(() => []),

    // Item stats from RS Wiki
    getItemStats:           (name) => a.getItemStats(name),
    getItemHistory:          (id)  => a.getItemHistory(id),
    getItemHistoryLocal:     (id)  => a.getItemHistoryLocal(id),
    getHistoryStatus:        ()    => a.getHistoryStatus(),
    getHistoryPopulatedIds:  ()    => a.getHistoryPopulatedIds(),
    getSignalTrend:          (limits) => a.getSignalTrend(limits),
    startHistoryPopulation:  (ids) => a.startHistoryPopulation(ids, (progress) => emit('history-progress', progress)),
    stopHistoryPopulation:   ()    => a.stopHistoryPopulation(),
    onHistoryProgress:       (cb)  => on('history-progress', cb),

    // Settings
    getSettings: () => ({
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
    }),
    saveSettings: (settings) => {
      Object.entries(settings).forEach(([k, v]) => store.set(k, v));
      startScheduler(); // picks up a changed fetchInterval immediately, same as main.js's save-settings handler
      syncRunnerState();
      return { success: true };
    },

    // Watchlist
    getWatchlist: () => store.get('watchlist', []),
    setWatchlist: (list) => { store.set('watchlist', list); syncRunnerState(); return { success: true }; },

    getHidden: () => store.get('hiddenItems', []),
    setHidden: (list) => { store.set('hiddenItems', list); return { success: true }; },

    // DXP Almanac watchlist + notifications
    getDxpWatchlist: () => store.get('dxpWatchlist', []),
    setDxpWatchlist: (list) => { store.set('dxpWatchlist', list); syncRunnerState(); return { success: true }; },
    getDxpNotificationSettings: () => store.get('dxpNotificationSettings', {
      enabled: false, buyAlerts: true, sellAlerts: true, announceAlerts: true, windowApproachingAlerts: true,
    }),
    setDxpNotificationSettings: (s) => { store.set('dxpNotificationSettings', s); syncRunnerState(); return { success: true }; },

    // Main watchlist daily digest notification
    getWatchlistNotificationSettings: () => store.get('watchlistNotificationSettings', {
      enabled: false, dailyThresholdPct: 5, trendThresholdPct: 7,
    }),
    setWatchlistNotificationSettings: (s) => { store.set('watchlistNotificationSettings', s); syncRunnerState(); return { success: true }; },

    // Date-based reminders
    getReminders: () => store.get('reminders', []),
    saveReminder: (r) => {
      const reminders = store.get('reminders', []);
      const i = reminders.findIndex(x => x.id === r.id);
      if (i >= 0) reminders[i] = r; else reminders.push(r);
      store.set('reminders', reminders);
      syncRunnerState();
      return { success: true };
    },
    deleteReminder: (id) => {
      store.set('reminders', store.get('reminders', []).filter(r => r.id !== id));
      syncRunnerState();
      return { success: true };
    },

    // Alerts
    getAlerts: () => a.getAlerts(),
    saveAlert: (alert) => a.saveAlert(alert),
    deleteAlert: (id) => a.deleteAlert(id),

    // Portfolio
    getPortfolio:   () => a.getPortfolio(),
    savePosition:   (pos) => a.savePosition(pos),
    deletePosition: (id) => a.deletePosition(id),
    sellPosition:   (opts) => a.sellPosition(opts),
    reopenPosition: (id) => a.reopenPosition(id),

    // Full timeseries (ATH/ATL + date lookup)
    getItemTimeseries: (id) => a.getItemTimeseries(id),

    // Local price snapshots
    getPriceSnapshots: (id) => a.getPriceSnapshots(id),

    // Item notes
    getNotes: () => store.get('itemNotes', {}),
    saveNote: (id, text) => {
      const notes = store.get('itemNotes', {});
      if (text) notes[id] = text; else delete notes[id];
      store.set('itemNotes', notes);
      return { success: true };
    },

    // Search shorthands
    getShorthands:  () => store.get('userShorthands', {}),
    saveShorthands: (sh) => { store.set('userShorthands', sh); return { success: true }; },

    // Category overrides editor
    getOverrides:  () => a.getOverrides(),
    saveOverrides: (ov) => a.saveOverrides(ov),

    // Data portability — see downloadJSON/pickJSONFile above for how this
    // actually moves a file on/off the device without any native plugin.
    exportData: async () => {
      try {
        const bundle = await a.buildExportBundle();
        const filename = `genius-backup-${new Date().toISOString().slice(0,10)}.json`;
        await exportToDocuments(filename, bundle);
        return { success: true, savedTo: `Documents/${filename}` };
      } catch (e) {
        return { error: e.message };
      }
    },
    importData: async () => {
      try {
        const text = await pickJSONFile();
        if (text == null) return { canceled: true };
        let bundle;
        try { bundle = JSON.parse(text); } catch { return { error: 'Unrecognised backup format.' }; }
        return await a.applyImportBundle(bundle);
      } catch (e) {
        return { error: e.message };
      }
    },

    // Utility
    openExternal: (url) => { if (/^https?:\/\//.test(url)) window.open(url, '_blank'); },
    showNotification: ({ title, body }) => { if (store.get('notifications', true)) fireNotification(title, body); },
    testNotification: async ({ title, body }) => {
      try { await fireNotification(title, body); return { success: true }; }
      catch (e) { return { success: false, error: e.message }; }
    },

    // Events
    onFetchComplete:   (cb) => on('fetch-complete', cb),
    onFetchError:      (cb) => on('fetch-error', cb),
    onUpdateAvailable: (cb) => on('update-available', cb),
    removeAllListeners: (ch) => removeAllListeners(ch),
  };
}

// Exposed the same way contextBridge does on desktop — a single global
// object, available before renderer.js runs (index.html loads this
// script first). buildGenius() is async (constructing the api takes a
// few real Filesystem/Preferences calls), so window.genius starts as a
// Promise-of-the-real-thing; renderer.js never touches window.genius
// directly without going through this await, since every call already
// expects a Promise back regardless.
window.geniusReady = buildGenius();
window.genius = new Proxy({}, {
  get(_, prop) {
    return (...args) => window.geniusReady.then(g => g[prop](...args));
  },
});

// Mirrors main.js's app.whenReady() startup sequence + startScheduler() —
// fetch once shortly after launch, then keep re-fetching and re-checking
// notifications on the user's configured interval for as long as the app
// stays open/foregrounded. Android can still suspend a backgrounded
// webview's JS timers at the OS's discretion, so this alone only covers
// "while GEnius is actually open" — true background notification checks
// (app fully closed) are handled separately by mobile/runners/background.js
// via @capacitor/background-runner's WorkManager-backed scheduling, kept
// in sync with whatever's set here through syncRunnerState().
let schedulerInterval = null;
async function startScheduler() {
  if (schedulerInterval) clearInterval(schedulerInterval);
  const a = await ensureApi();
  const intervalMinutes = store.get('fetchInterval', 15);
  schedulerInterval = setInterval(() => {
    runFetch('prices').catch(e => console.error('[GEnius] Scheduled fetch failed:', e.message));
    runNotificationChecks().catch(e => console.error('[GEnius] Notification check failed:', e.message));
    syncRunnerState();
  }, intervalMinutes * 60 * 1000);
}

// 3s delay, not 1s — matches main.js's desktop startup stagger
// (setTimeout(() => runPython('prices'), 3000)). Confirmed for real this
// mattered on mobile too: the initial fetch is real synchronous work
// competing with the page's own initial render/hydration for the same
// single JS thread, and giving the UI a moment to settle first measurably
// reduces the "app feels frozen right after opening" complaint, on top of
// the separate yield-batch-size fix in run.js/dxp_intelligence.js.
setTimeout(() => {
  runFetch('prices').catch(e => console.error('[GEnius] Initial fetch failed:', e.message));
  runNotificationChecks().catch(e => console.error('[GEnius] Notification check failed:', e.message));
  syncRunnerState();
  startScheduler();
}, 3000);

// Android's hardware/gesture back button — by default Capacitor just exits
// the app on every press, which is exactly wrong here: backing out of an
// open item panel, drill-down view, sidebar drawer, or modal should close
// THAT first, the same way desktop's Backspace key already does (or
// Escape, for modals — see renderer.js's various window keydown listeners).
// Reusing those exact handlers instead of writing separate back-stack logic
// means the two can never drift out of sync — anything that responds to
// Backspace/Escape on desktop automatically gets real Android back-button
// support for free. dispatchEvent() returns false if any listener called
// preventDefault() on a cancelable event, which is how this tells whether
// something actually consumed the back press before deciding to exit.
App.addListener('backButton', () => {
  const backHandled = !window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true, bubbles: true }));
  const escHandled = !window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true }));
  if (!backHandled && !escHandled) {
    App.exitApp();
  }
});
