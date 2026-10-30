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
const { registerPlugin } = require('@capacitor/core');
// App-local native plugin (android/.../GeniusMonitorPlugin.java): the
// optional Live monitoring foreground service.
const GeniusMonitor = registerPlugin('GeniusMonitor');

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
      api = await createGeniusApi({ dataDir: DATA_DIR, store, platform: 'mobile' });
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
const QUIET_DEFAULT = { enabled: false, start: '21:00', end: '07:00' };
function quietHoursSetting() {
  return { ...QUIET_DEFAULT, ...(store && store.get('quietHours', {})) };
}
function isQuietNow(q = quietHoursSetting()) {
  if (!q.enabled || !q.start || !q.end) return false;
  const toMin = t => { const [h, m] = String(t).split(':').map(Number); return (h * 60 + (m || 0)) % 1440; };
  const d = new Date(), now = d.getHours() * 60 + d.getMinutes();
  const s = toMin(q.start), e = toMin(q.end);
  if (s === e) return false;
  return s < e ? (now >= s && now < e) : (now >= s || now < e);
}

async function fireNotification(title, body) {
  await ensureNotificationPermission();
  try {
    // Quiet hours (Ben, 2026-10-18): still shown, but on the silent channel
    // (created in MainActivity.java) so the phone doesn't buzz all night.
    const quiet = isQuietNow();
    await LocalNotifications.schedule({
      notifications: [{
        id: Date.now() % 2147483647,
        title, body,
        schedule: { at: new Date(Date.now() + 100) },
        ...(quiet ? { channelId: 'genius_quiet' } : {}),
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
    const [data, dxpData, portfolio] = await Promise.all([
      a.getData().catch(() => ({ items: [] })),
      a.getDxpIntelligence().catch(() => ({})),
      a.getPortfolio().catch(() => ({ positions: [] })),
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

    // Open positions only, and only the fields the background runner's own
    // digest computation actually needs — it has no access to api.js's
    // getPortfolioDigest() (see file comment), so it recomputes a simpler
    // GE-price-only version itself from whatever's synced here. Positions
    // are stored by item NAME, but the runner's own price fetch (the raw
    // gazbot dump) is keyed by item ID — resolve the id here, once, using
    // the same name lookup api.js's own getPortfolioDigest does, so the
    // runner doesn't need the full item list just to find one price.
    const idByName = Object.fromEntries((data.items || []).map(i => [i.name.toLowerCase(), i.id]));
    const openPositions = (portfolio.positions || [])
      .filter(p => p.status === 'open')
      .map(p => ({ id: idByName[(p.item_name || '').toLowerCase()], name: p.item_name, quantity: p.quantity, costBasis: p.cost_basis }))
      .filter(p => p.id != null);

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
        portfolioPositions: openPositions,
        portfolioSettings: store.get('portfolioDigestSettings', { enabled: false, intervalHours: 0.25 }),
        reminders: store.get('reminders', []),
        quietHours: { ...quietHoursSetting(), tzOffsetMin: new Date().getTimezoneOffset() },
        // Price alerts for the background check (item id resolved here,
        // same as positions above; active = already hit, so no re-notify).
        alerts: (await a.getAlerts().catch(() => [])).map(al => ({
          id: al.id, itemId: idByName[(al.item_name || '').toLowerCase()], name: al.item_name,
          condition: al.condition || 'above', price: al.price, pct: al.pct, active: !!al.active,
        })),
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
  // Alerts the background already notified about: mark them, don't repeat.
  try {
    const r = await BackgroundRunner.dispatchEvent({ label: 'com.vonderthwood.genius.background.task', event: 'collectFiredAlerts', details: {} });
    await a.markAlertsFiredInBackground((r && r.fired) || []);
  } catch (e) { console.error('[GEnius] collectFiredAlerts failed:', e.message); }
  for (const n of await a.getDxpNotifications()) await fireNotification(n.title, n.body);
  const digest = await a.getWatchlistDigest();
  if (digest) await fireNotification(digest.title, digest.body);
  const portfolioDigest = await a.getPortfolioDigest();
  if (portfolioDigest) await fireNotification(portfolioDigest.title, portfolioDigest.body);
  for (const r of await a.getDueReminders()) await fireNotification(r.title, r.body);
  for (const g of await a.getBuyGoalNotifications()) await fireNotification(g.title, g.body);
  for (const d of await a.getDxpNewsNotifications()) await fireNotification(d.title, d.body);
  // Alerts are always evaluated (fired state + Discord); the Settings
  // checkbox only controls the popup — same as main.js's checkPriceAlerts.
  const triggered = await a.getTriggeredAlerts();
  if (store.get('notifications', true)) for (const al of triggered) await fireNotification(al.title, al.body);
}

// Mirrors main.js's runPython() — runs run.js's main() in-process and emits
// the same fetch-complete/fetch-error events the desktop build does, so
// renderer.js's existing onFetchComplete/onFetchError handlers work as-is.
// One fetch at a time, same as main.js — overlapping callers share it.
let fetchInFlight = null;
let firstFetchResolve;
const firstFetchDone = new Promise(res => { firstFetchResolve = res; });
function runFetch(mode) {
  if (fetchInFlight) return fetchInFlight;
  fetchInFlight = runFetchOnce(mode).finally(() => { fetchInFlight = null; firstFetchResolve(); });
  return fetchInFlight;
}
async function runFetchOnce(mode) {
  // Same as main.js: tells the header to show its spinner. Was missing on
  // mobile, so a running fetch looked identical to an idle one.
  emit('fetch-start', { mode });
  const a = await ensureApi();
  const { main: runJs } = require('../../src/backend-js/run.js');
  try {
    await a.historyLoadedPromise;
    const argv = [`--mode=${mode || 'prices'}`, `--data-dir=${DATA_DIR}`];
    const result = await runJs(argv, await a.computeHistoryStats());
    if (result && result.pricesFailed) throw new Error('Price fetch failed — still showing the previous prices');
    if (mode === 'prices' || !mode) await a.updateSnapshots();
    if (mode !== 'news') await a.recordOpportunities();
    await a.archiveNews();
    // Checks run against this fetch's fresh data, before fetch-complete.
    await runNotificationChecks().catch(e => console.error('[GEnius] Notification check failed:', e.message));
    lastFetchOkAt = Date.now();
    emit('fetch-complete', { mode, timestamp: Date.now() });
    // Smaller batch than desktop's 500 — mobile data and battery.
    if (mode !== 'news') a.refreshStaleHistory(50).then(() => a.maybeBuildSimilarityTable()).then(() => a.maybeRefreshAlmanac()).catch(() => {});
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
    // Mirrors main.js's fetch-now fix — a manual refresh should re-check
    // alerts/reminders against the fresh data it just pulled, not just
    // whatever the periodic notification check happens to run next.
    fetchNow: (mode) => runFetch(mode).then(() => ({ success: true })).catch(e => ({ success: false, error: e.message })),
    getDataDir: () => DATA_DIR,
    quitApp: () => ({ success: true }), // no desktop-style "quit" concept on mobile; Android handles backgrounding itself
    getAppVersion: () => require('../../package.json').version,
    getDxpIntelligence: (opts) => a.getDxpIntelligence(opts).catch(() => ({})),
    getDxpEvents: () => a.getDxpEvents().catch(() => []),

    // Item stats from RS Wiki
    getItemStats:           (name) => a.getItemStats(name),
    getLiveItemPrice:       (id) => a.getLiveItemPrice(id),
    getItemLiveTimeseries:  (id, lookback) => a.getItemLiveTimeseries(id, lookback),
    getLaunches:            async () => a.getLaunches(),
    getDropSources:         (name) => a.getDropSources(name),
    searchMonsters:         (query) => a.searchMonsters(query),
    // mode wasn't being passed through at all — Hard Mode never worked on
    // mobile's Monster Lookup, it silently always returned Normal mode's
    // drops/info regardless of which button was tapped.
    getMonsterDrops:        (name, mode) => a.getMonsterDrops(name, mode),
    getMonsterInfo:         (name, mode) => a.getMonsterInfo(name, mode),
    getItemProducts:        (name) => a.getItemProducts(name),
    getItemHistory:          (id)  => a.getItemHistory(id),
    getItemHistoryLocal:     (id)  => a.getItemHistoryLocal(id),
    getHistoryStatus:        ()    => a.getHistoryStatus(),
    getHistoryPopulatedIds:  ()    => a.getHistoryPopulatedIds(),
    // Waits for the first price fetch: both scan every history file, and on
    // the phone running them together doubled the wait for fresh prices.
    getSignalTrend:          (limits) => firstFetchDone.then(() => a.getSignalTrend(limits)),
    getRealTimeMovers:       (windowDays) => a.getRealTimeMovers(windowDays),
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
      dateFormat:         store.get('dateFormat', 'MM/DD/YYYY'),
      overpricedThreshold: store.get('overpricedThreshold', 30),
      accentColor:        store.get('accentColor', null),
    }),
    saveSettings: (settings) => {
      Object.entries(settings).forEach(([k, v]) => store.set(k, v));
      startScheduler(); // picks up a changed fetchInterval immediately, same as main.js's save-settings handler
      if (store.get('liveMonitoring', false)) startLiveMonitoring().catch(() => {});
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
    getPortfolioDigestSettings: () => store.get('portfolioDigestSettings', { enabled: false, intervalHours: 0.25 }),
    setPortfolioDigestSettings: (s) => { store.set('portfolioDigestSettings', s); syncRunnerState(); return { success: true }; },

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
    saveAlert: (alert) => a.saveAlert(alert).then(r => { syncRunnerState(); return r; }),
    deleteAlert: (id) => a.deleteAlert(id).then(r => { syncRunnerState(); return r; }),

    // Portfolio — each mutation re-syncs the background runner's own copy
    // of open positions (see syncRunnerState) so a closed-app portfolio
    // digest never fires against stale/deleted/already-sold positions.
    getPortfolio:   () => a.getPortfolio(),
    savePosition:   (pos) => a.savePosition(pos).then(r => { syncRunnerState(); return r; }),
    getBuyGoals:         ()       => a.getBuyGoals(),
    getOpportunityHistory: ()     => a.getOpportunityHistory(),
    getEvents:              ()      => a.getEvents(),
    saveEvent:              (ev)    => a.saveEvent(ev),
    deleteEvent:            (id)    => a.deleteEvent(id),
    getEventSuggestions:    ()      => a.getEventSuggestions(),
    dismissEventSuggestion: (url)   => a.dismissEventSuggestion(url),
    getEventImpact:         (id)    => a.getEventImpact(id),
    getQuestItems:          (name)  => a.getQuestItems(name),
    getNewItemsSummary:     ()      => a.getNewItemsSummary(),
    getContentDrops:        (pages) => a.getContentDrops(pages),
    getSimilarItems:        (id)    => a.getSimilarItems(id),
    getChartAnalysis:       (id)    => a.getChartAnalysis(id),
    askItem:                (id, q) => a.askItem(id, q),
    listAutoBackups:        ()      => a.listAutoBackups(),
    restoreAutoBackup:      (f)     => a.restoreAutoBackup(f),
    getFoodHeal:            (n)     => a.getFoodHeal(n),
    getDxpNews:             ()      => a.getDxpNewsDetections(),
    getNewsCalendar:        (opts)  => a.getNewsCalendar(opts),
    getNewsFeed:            ()      => a.getNewsFeed(),
    getNewsBadgeCount:      ()      => a.getNewsBadgeCount(),
    markNewsRead:           (urls)  => a.markNewsRead(urls),
    getNewsBadgePrefs:      ()      => a.getNewsBadgePrefs(),
    setNewsBadgePrefs:      (p)     => a.setNewsBadgePrefs(p),
    resolveDxpNews:         (url, action, dates) => a.resolveDxpNews(url, action, dates),
    saveBuyGoal:         (goal)   => a.saveBuyGoal(goal),
    deleteBuyGoal:       (id)     => a.deleteBuyGoal(id),
    updateBuyGoalTotals: (totals) => a.updateBuyGoalTotals(totals).then(r => { syncRunnerState(); return r; }),
    deletePosition: (id) => a.deletePosition(id).then(r => { syncRunnerState(); return r; }),
    sellPosition:   (opts) => a.sellPosition(opts).then(r => { syncRunnerState(); return r; }),
    convertPosition:(opts) => a.convertPosition(opts).then(r => { syncRunnerState(); return r; }),
    reopenPosition: (id) => a.reopenPosition(id).then(r => { syncRunnerState(); return r; }),

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
    getMonsterShorthands:  () => store.get('monsterShorthands', {}),
    saveMonsterShorthands: (sh) => { store.set('monsterShorthands', sh); return { success: true }; },

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
    // Was missing: renderer.js registers this first, so the TypeError also
    // skipped the onFetchComplete line below and the screen never updated
    // after a fetch (header stuck on "5703m ago" with fresh data on disk).
    onFetchStart:      (cb) => on('fetch-start', cb),
    // Mobile only (renderer shows the setting when these exist).
    getQuietHours: async () => (await ensureApi(), quietHoursSetting()),
    setQuietHours: async (q) => {
      await ensureApi();
      store.set('quietHours', { ...quietHoursSetting(), ...q });
      syncRunnerState();
      return quietHoursSetting();
    },
    // When the background checker last ran (ms), for the header status.
    // Phone only: desktop has no background checker, so preload.js has none.
    getBackgroundLastRun: async () => {
      try {
        const r = await BackgroundRunner.dispatchEvent({ label: 'com.vonderthwood.genius.background.task', event: 'getStatus', details: {} });
        return (r && r.lastRunAt) || null;
      } catch { return null; }
    },
    getLiveMonitoring: async () => (await ensureApi(), { enabled: store.get('liveMonitoring', false), running: !!(await GeniusMonitor.isRunning().catch(() => ({}))).running }),
    setLiveMonitoring: async (on) => {
      await ensureApi();
      store.set('liveMonitoring', !!on);
      if (on) { await ensureNotificationPermission(); await startLiveMonitoring(); }
      else await GeniusMonitor.stop();
      return { enabled: !!on, running: !!(await GeniusMonitor.isRunning()).running };
    },
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
// The service runs the background runner on this interval (see
// MonitorService.java for why it can't rely on this page's own timers).
function startLiveMonitoring() {
  return GeniusMonitor.start({ intervalMinutes: store.get('fetchInterval', 15) });
}

// The page is frozen while GEnius is off screen, so its 15-minute timer
// doesn't run then. On returning to the app, fetch straight away if the
// last successful fetch is older than the interval.
let lastFetchOkAt = 0;
App.addListener('appStateChange', ({ isActive }) => {
  if (!isActive || !store) return;
  const intervalMs = store.get('fetchInterval', 15) * 60 * 1000;
  if (Date.now() - lastFetchOkAt >= intervalMs) {
    runFetch('prices').catch(e => console.error('[GEnius] Resume fetch failed:', e.message));
  }
});

let schedulerInterval = null;
async function startScheduler() {
  if (schedulerInterval) clearInterval(schedulerInterval);
  const a = await ensureApi();
  const intervalMinutes = store.get('fetchInterval', 15);
  schedulerInterval = setInterval(() => {
    runFetch('prices').catch(e => console.error('[GEnius] Scheduled fetch failed:', e.message));
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
// Ask for notification permission up front (Android 13+). It used to be
// asked only when the app itself first showed a notification, so the
// background runner's alerts were silently dropped on a phone that had
// never been asked (Ben, 2026-10-15: POST_NOTIFICATIONS granted=false).
// Asked 5s in, once the window is up: asking during startup was dropped by
// Android (the dialog never appeared).
setTimeout(() => ensureNotificationPermission(), 5000);
ensureApi().then(() => {
  if (store.get('liveMonitoring', false)) startLiveMonitoring().catch(e => console.error('[GEnius] Live monitoring start failed:', e.message));
});

setTimeout(() => {
  runFetch('prices').catch(e => console.error('[GEnius] Initial fetch failed:', e.message));
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
