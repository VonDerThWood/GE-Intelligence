/**
 * GEnius core API — every IPC handler's actual logic, with zero Electron
 * dependencies (no require('electron'), no ipcMain, no app.getPath, no
 * Notification/dialog/BrowserWindow). main.js's ipcMain handlers are thin
 * wrappers that call into this; a future Capacitor/mobile build would call
 * these same functions directly with no IPC layer in between at all, since
 * there's no separate main/renderer process to bridge.
 *
 * Genuinely Electron-only concerns stay OUT of this file on purpose:
 *   - OS notifications (Notification), window/tray lifecycle, dialogs —
 *     these need real platform-native equivalents on mobile anyway, so
 *     there's nothing to "reuse" by moving them here.
 *   - The price-fetch scheduler (setInterval) and notifyRenderer
 *     (webContents.send) — orchestration that's specific to how Electron's
 *     main process talks to its renderer, not business logic.
 *
 * Every function here is async (even ones whose desktop implementation
 * could technically be synchronous) because storage.js's interface is
 * async-everywhere — see its file comment. This file never knows or cares
 * whether it's running against Node's fs (desktop) or Capacitor's
 * Filesystem/Preferences plugins (mobile); main.js/the mobile bridge just
 * await every call here exactly like they already did when these were
 * IPC round-trips.
 *
 * Usage: const api = await createGeniusApi({ dataDir, store }); then call
 * api.getData(), api.getPortfolio(), etc. `store` is a KV interface
 * (storage.createKVStore() on desktop) — injected rather than required
 * directly here, since constructing it needs Electron's app.getPath().
 */

const path = require('path');
const storage = require('./storage.js');
const catalogue = require('./catalogue.js');

const SIGNAL_TREND_DAYS = 7;

async function createGeniusApi({ dataDir, store }) {
  // ─── Paths ──────────────────────────────────────────────────────────────
  const dataFile      = path.join(dataDir, 'latest.json');
  const alertsFile     = path.join(dataDir, 'alerts.json');
  const portfolioFile  = path.join(dataDir, 'portfolio.json');
  const historyFile    = path.join(dataDir, 'history.json'); // legacy, one-time migration only
  const historyDir     = path.join(dataDir, 'history');
  const athCacheFile   = path.join(dataDir, 'ath_cache.json');
  const snapshotFile   = path.join(dataDir, 'price_snapshots.json');
  const itemStatsFile  = path.join(dataDir, 'item_stats.json');
  // PERSONAL overrides specifically, not the bulk/dev-curated
  // category_overrides.json — the in-app editor should only ever touch
  // Ben's own per-item edits, never the whole catalogue. catalogue.js
  // merges both files at category-assignment time (personal wins per item).
  const overridesFile = path.join(__dirname, 'data', 'personal_overrides.json');

  // ─── In-memory state ────────────────────────────────────────────────────
  let historyData = {};            // { itemId: [{timestamp, price, volume}] }
  let dirtyHistoryIds = new Set(); // ids changed since the last saveHistory()
  let historyVersion = 0;          // bumped on every real history change — lets
                                    // cache checks below work without stat'ing a file
  let historyFetchQueue = [];
  let historyFetchActive = false;
  let historyFetchStop = false;
  let historyInitial300Done = store.get('historyInitial300Done', false);

  let historyLoadDone;
  const historyLoadedPromise = new Promise(res => { historyLoadDone = res; });

  // catalogue.js's bulk overrides are available synchronously the moment it
  // loads, but personal_overrides.json (the user-editable file) is now
  // loaded async — without this, the very first price fetch after launch
  // would categorize everything using only the bulk file, missing any
  // personal in-app edits until the next save-overrides call happened to
  // trigger a reload.
  await catalogue.reloadOverrides();

  let athCache = await storage.readJSON(athCacheFile, {});       // { itemId: { data: [...] } }
  let snapshotData = await storage.readJSON(snapshotFile, {});   // { itemId: [{t,p,v}] }
  const itemHistoryCache = new Map();
  const itemStatsCache = new Map();
  for (const [name, stats] of Object.entries(await storage.readJSON(itemStatsFile, {}))) {
    itemStatsCache.set(name, stats);
  }

  let dxpIntelCache = null;     // { historyVersion, data }
  let dxpIntelInFlight = null;  // shared in-flight Promise — see comment at getDxpIntelligence
  let signalTrendCache = null;     // { historyVersion, result }
  let signalTrendInFlight = null;  // shared in-flight Promise — see comment at getSignalTrend

  async function saveAthCache() {
    try { await storage.writeJSON(athCacheFile, athCache); } catch {}
  }
  async function saveSnapshots() {
    try { await storage.writeJSON(snapshotFile, snapshotData); } catch {}
  }
  async function saveItemStatsCache() {
    try { await storage.writeJSON(itemStatsFile, Object.fromEntries(itemStatsCache)); } catch {}
  }

  // ─── Price history ──────────────────────────────────────────────────────
  // Stored as one small file per item (data/history/<id>.json) instead of a
  // single monolithic history.json. The old single-file approach hit a real
  // wall for real: history.json grew to ~512MB (confirmed: ~10.1M genuine
  // price points across 3,435 items, not corruption) — right at V8's hard
  // string-length ceiling (~536MB), and EVERY save re-serialized the WHOLE
  // file regardless of how many items actually changed. Per-item files have
  // no such ceiling — each is at most a few hundred KB — and a save only
  // ever touches the items that actually changed (dirtyHistoryIds), not the
  // entire dataset.
  async function loadHistory() {
    const loadStart = Date.now();
    await storage.ensureDir(historyDir);
    let existingFiles = await storage.listJSONFiles(historyDir);
    if (existingFiles.length === 0) {
      // One-time migration from the old monolithic history.json, if
      // present — a no-op on a fresh install (mobile always takes this
      // path harmlessly, since it never has a legacy file to find).
      await storage.migrateLegacyHistoryFile(historyFile, historyDir);
    }
    // Batched (see storage.loadDirBatched) so we don't fire thousands of
    // concurrent file handles at once, and so the load doesn't block the
    // single JS thread for its whole duration on desktop (confirmed for
    // real via Windows Event Viewer AppHangTransient events).
    historyData = await storage.loadDirBatched(historyDir, { batchSize: 200 });
    console.log(`[history] Loaded ${Object.keys(historyData).length} items from per-item storage in ${Date.now()-loadStart}ms.`);
    historyLoadDone();
  }

  async function saveHistory() {
    // Only writes items actually touched since the last save — never the
    // whole dataset. Each per-item file is small (at most a few hundred KB
    // even for an item with 6000+ price points), so this can never hit the
    // string-length ceiling that the old single-file approach eventually did.
    if (dirtyHistoryIds.size === 0) return;
    const toSave = [...dirtyHistoryIds];
    dirtyHistoryIds.clear();
    await Promise.all(toSave.map(async id => {
      try {
        await storage.writeDirItem(historyDir, id, historyData[id]);
      } catch (e) {
        console.error(`[history] Save failed for item ${id}:`, e.message);
        dirtyHistoryIds.add(id); // retry on next save
      }
    }));
  }

  // fetch() instead of Node's https.get — works unchanged in a webview
  // with no Node access (e.g. a future Capacitor/mobile build).
  async function fetchHistoryForItemOnce(itemId, timeoutMs) {
    const url = `https://api.weirdgloop.org/exchange/history/rs/all?id=${itemId}`;
    let res;
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': 'GEnius/1.3 (github.com/VonDerThWood/GE-Intelligence)' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      console.warn(`[history] Network error for item ${itemId}:`, e.message);
      return false;
    }
    if (!res.ok) {
      console.warn(`[history] HTTP ${res.status} fetching item ${itemId} (timeout ${timeoutMs}ms)`);
      return false;
    }
    try {
      const json = await res.json();
      const raw = json[String(itemId)] || null;
      if (raw && raw.length) {
        const points = raw.map(p => ({
          timestamp: p.timestamp,
          price: p.price,
          volume: p.volume || 0,
        })).filter(p => p.price);
        historyData[String(itemId)] = points;
        dirtyHistoryIds.add(String(itemId));
        historyVersion++;
        athCache[String(itemId)] = { data: points.map(p => ({timestamp:p.timestamp, high:p.price, low:p.price, volume:p.volume})) };
      }
      return !!raw;
    } catch (e) {
      console.warn(`[history] Parse error for item ${itemId}:`, e.message);
      return false;
    }
  }

  // A slow connection can legitimately take longer than a single short
  // timeout to complete a real, successful fetch — one retry with a
  // longer timeout before actually giving up.
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
      if (done % 20 === 0) await saveHistory();
      await new Promise(r => setTimeout(r, 400)); // ~2.5/sec, well under limit
    }

    await saveHistory();
    historyFetchActive = false;
    console.log(`[history] Queue complete. ${Object.keys(historyData).length} items stored.`);
  }

  async function getHistoryStatus() {
    await historyLoadedPromise;
    return {
      stored: Object.keys(historyData).length,
      queued: historyFetchQueue.length,
      active: historyFetchActive,
      isFirstRun: Object.keys(historyData).length === 0,
      initial300Done: historyInitial300Done,
    };
  }

  async function getHistoryPopulatedIds() {
    return Object.keys(historyData).map(Number);
  }

  async function getItemHistoryLocal(itemId) {
    return historyData[String(itemId)] || null;
  }

  // `onProgress` is the caller's hook for relaying progress to the UI
  // (notifyRenderer on desktop) — kept as a callback parameter rather than
  // an event emitter so this stays dependency-free.
  async function startHistoryPopulation(itemIds, onProgress) {
    await historyLoadedPromise;
    const newIds = itemIds.filter(id => !historyData[String(id)]);
    historyFetchQueue = [...new Set([...historyFetchQueue, ...newIds])];
    console.log(`[history] Queue set: ${historyFetchQueue.length} items to fetch`);

    runHistoryQueue((done, total) => {
      onProgress && onProgress({
        done, total,
        stored: Object.keys(historyData).length,
        queueRemaining: historyFetchQueue.length,
        initial300Done: historyInitial300Done,
      });
    });

    return { queued: historyFetchQueue.length, total: itemIds.length };
  }

  async function stopHistoryPopulation() {
    historyFetchStop = true;
    return { success: true };
  }

  async function getItemHistory(itemId) {
    if (itemHistoryCache.has(itemId)) return itemHistoryCache.get(itemId);

    const existing = historyData[String(itemId)];
    if (existing && existing.length) {
      const sorted = [...existing].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      const latestTs = sorted[0].timestamp || 0;
      const ageMs = Date.now() - latestTs * (latestTs < 1e12 ? 1000 : 1);
      const stale = ageMs > 8 * 24 * 60 * 60 * 1000;
      if (!stale) {
        itemHistoryCache.set(itemId, existing);
        return existing;
      }
      console.log(`[history] Stale data for ${itemId}, refetching from all endpoint`);
    }

    await fetchHistoryForItem(itemId);
    const result = historyData[String(itemId)] || null;
    if (result) {
      itemHistoryCache.set(itemId, result);
      await saveHistory();
    }
    return result;
  }

  async function getItemTimeseries(itemId) {
    const key = String(itemId);
    if (athCache[key]) return athCache[key].data;
    if (historyData[key] && historyData[key].length) {
      const data = historyData[key].map(p => ({timestamp:p.timestamp, high:p.price||p.high, low:p.price||p.low, volume:p.volume||0}));
      athCache[key] = { data };
      return data;
    }
    await fetchHistoryForItem(itemId);
    return athCache[key] ? athCache[key].data : null;
  }

  // Raw event date ranges ([announced, start, end] per event) — small file,
  // no caching needed. Exposed separately from getDxpIntelligence() because
  // that returns per-item aggregated stats, not the underlying event dates
  // the chart overlay needs to know WHERE to draw each DXP window.
  async function getDxpEvents() {
    const { loadEvents } = require('./dxp_intelligence.js');
    return loadEvents(dataDir);
  }

  // ─── DXP Almanac intelligence ───────────────────────────────────────────
  // Ported from dxp_intelligence.py (see SESSION_LOG.md, 2026-06-26) —
  // verified field-for-field identical against all 987 real tracked items
  // before cutover. Runs in-process instead of spawning Python.
  let dxpIntelDiskServed = false; // true once we've served the on-disk file as a same-session placeholder, so we only ever do that once per run
  async function getDxpIntelligence({ forceFresh = false } = {}) {
    // Skip recomputation entirely if history hasn't changed since the last
    // run — historyVersion (bumped on every real history update) stands in
    // for the old "stat history.json's mtime" check, which doesn't work
    // now that history is per-item files.
    if (dxpIntelCache && dxpIntelCache.historyVersion === historyVersion) {
      return dxpIntelCache.data;
    }
    // A stale placeholder (disk-served, or a previous real computation that
    // predates a later history change) is still far better than blocking on
    // a fresh recompute. Confirmed for real this was the actual remaining
    // cause of "the Almanac still takes ~2 minutes": once the background
    // refresh kicked off (below) had started, EVERY subsequent call —
    // including the real one DXPIntelTab makes when the user actually taps
    // the tab — fell through to the dxpIntelInFlight check and got stuck
    // waiting on that same multi-minute recompute, rather than continuing
    // to serve the still-perfectly-fine stale data while it finished in the
    // background. Since that refresh starts automatically ~3s after launch,
    // virtually any real tap on the tab landed inside that window — this
    // wasn't an edge case, it was close to the common case.
    if (!forceFresh && dxpIntelCache) {
      return dxpIntelCache.data;
    }
    // Rapid tab-switching (Almanac, away, back) can call this again before
    // the first run finishes — share the in-flight promise so a second
    // caller waits for the first result instead of paying for a full
    // duplicate full-catalogue computation on the same thread. Only reached
    // now when there's truly nothing cached yet, or the caller explicitly
    // wants forceFresh.
    if (dxpIntelInFlight) return dxpIntelInFlight;

    // Confirmed for real (2026-06-29): the full computation is genuinely
    // expensive — ~6700 items × full multi-year history each, measured at
    // ~17s on a fast dev machine and 45-90s on Ben's actual desktop/mobile
    // hardware — and every cold app launch used to pay that cost
    // unconditionally before showing anything, since dxpIntelCache is
    // purely in-memory and starts empty every run. DXP timing stats are
    // long-horizon seasonal patterns (built from years of history) that
    // don't meaningfully change session to session, so serving last
    // session's already-computed dxp_intelligence.json immediately, then
    // recomputing fresh in the background, is a much better trade than
    // blocking the Almanac tab on a full recompute every single time it's
    // opened. Skipped entirely when the user explicitly hits Refresh
    // (forceFresh) — that's a deliberate "give me real current data now."
    //
    // This disk-read itself MUST go through the same dxpIntelInFlight slot
    // used by the real computation below — confirmed for real this was
    // broken on mobile (Pixel 8 Pro, definitely not weak hardware, still
    // hit the full ~90s every time): bridge.js's startup sequence calls
    // this via syncRunnerState() ~1s after launch, completely independent
    // of when the user actually opens the Almanac tab. A second concurrent
    // call landing in the gap between dxpIntelDiskServed being set (true)
    // and dxpIntelCache actually being populated fell through BOTH guards
    // above and started its own full real computation anyway — the fast
    // path only protected the FIRST caller, not concurrent ones, which is
    // exactly the realistic case here, not an edge case.
    if (!forceFresh && !dxpIntelCache && !dxpIntelDiskServed) {
      dxpIntelDiskServed = true;
      dxpIntelInFlight = storage.readJSON(path.join(dataDir, 'dxp_intelligence.json'), null);
      const onDisk = await dxpIntelInFlight;
      dxpIntelInFlight = null;
      if (onDisk && Object.keys(onDisk).length) {
        // historyVersion:-1 never matches a real version, so the next call
        // (kicked off below, fire-and-forget, on its own separate in-flight
        // cycle) still runs the real computation and replaces this
        // placeholder once it's ready.
        dxpIntelCache = { historyVersion: -1, data: onDisk };
        getDxpIntelligence().catch(() => {});
        return onDisk;
      }
      // Nothing usable on disk (fresh install) — fall through to the real
      // computation below, same as if this block never ran.
    }

    dxpIntelInFlight = (async () => {
      await historyLoadedPromise;
      try {
        const { loadEvents, computeDxpData } = require('./dxp_intelligence.js');
        const itemLimits = {}, itemNames = {};
        const latest = await storage.readJSON(dataFile, { items: [] });
        for (const it of latest.items || []) {
          if (it.id) {
            itemLimits[String(it.id)] = it.limit ?? null;
            itemNames[String(it.id)] = it.name;
          }
        }
        const events = await loadEvents(dataDir);
        // Confirmed for real on a Pixel 8 Pro (2026-06-29): this single call
        // took 146.7s on-device vs 7.8s on a desktop dev machine for the
        // identical computation/dataset — see computeDxpData's BATCH comment
        // in dxp_intelligence.js for the yield-granularity fix that came out
        // of this measurement. The gap is real mobile JS engine cost, not
        // something this disk-serve/background-refresh strategy can hide —
        // it only keeps the Almanac tab itself from blocking on it.
        const out = await computeDxpData(historyData, itemLimits, itemNames, true, events);
        await storage.writeJSON(path.join(dataDir, 'dxp_intelligence.json'), out);
        dxpIntelCache = { historyVersion, data: out };
        return out;
      } catch (e) {
        console.error('[DXP Intel] Error:', e.message);
        throw e;
      }
    })();
    dxpIntelInFlight.finally(() => { dxpIntelInFlight = null; });
    return dxpIntelInFlight;
  }

  // ─── Signal trend (Dashboard heatmap/badges over the last N days) ───────
  // Mirrors the thresholds in run.js's runSignals(). Cached against
  // historyVersion (same pattern as DXP intel above) so repeat calls with
  // unchanged history are instant, and batched async so even a real
  // cache-miss recompute doesn't block the thread for its full duration —
  // confirmed for real this was freezing the Dashboard on every mount once
  // history coverage got large (thousands of items, years of points each).
  async function getSignalTrend(itemLimits) {
    if (signalTrendCache && signalTrendCache.historyVersion === historyVersion) {
      return signalTrendCache.result;
    }
    if (signalTrendInFlight) return signalTrendInFlight;
    signalTrendInFlight = computeSignalTrend(itemLimits).finally(() => { signalTrendInFlight = null; });
    return signalTrendInFlight;
  }

  async function computeSignalTrend(itemLimits) {
    await historyLoadedPromise;

    const limits = itemLimits || {};
    const toSec = ts => (ts && ts > 1e11 ? ts / 1000 : (ts || 0));
    // Cheap integer day bucket — measured directly: new Date(...).toDateString()
    // per point (up to ~6600 points/item x 7184 items) took ~49s in isolation;
    // integer division removed that cost (down to ~16s).
    const dayBucket = sec => Math.floor(sec / 86400);
    const days = [];
    const dayBuckets = [];
    const now = new Date();
    for (let i = SIGNAL_TREND_DAYS - 1; i >= 0; i--) {
      const d = new Date(now); d.setDate(now.getDate() - i);
      days.push(d.toDateString());
      dayBuckets.push(dayBucket(d.getTime() / 1000));
    }
    const counts = {SURGE:[], DUMP:[], ACCUMULATION:[], DISTRIBUTION:[], FRENZY:[], HIGH_VOL:[], MANIPULATED:[]};
    for (const key of Object.keys(counts)) counts[key] = days.map(() => 0);
    const itemDays = {SURGE:{}, DUMP:{}, ACCUMULATION:{}, DISTRIBUTION:{}, FRENZY:{}, HIGH_VOL:{}, MANIPULATED:{}};

    const usedHistoryVersion = historyVersion;
    const allIds = Object.keys(historyData);
    const BATCH = 40;
    for (let b = 0; b < allIds.length; b += BATCH) {
      for (const itemId of allIds.slice(b, b + BATCH)) {
        const points = historyData[itemId];
        if (!points || points.length < 8) continue;
        const byDay = {};
        for (const p of points) {
          const sec = toSec(p.timestamp);
          const dk = dayBucket(sec);
          if (!byDay[dk] || sec > toSec(byDay[dk].timestamp)) byDay[dk] = p;
        }
        const sorted = Object.values(byDay).sort((a,b) => toSec(a.timestamp) - toSec(b.timestamp));
        if (sorted.length < 8) continue;

        const vols = sorted.map(p => p.volume).filter(v => v != null).sort((a,b) => a-b);
        if (!vols.length) continue;
        const mid = Math.floor(vols.length / 2);
        const avgVol = vols.length % 2 ? vols[mid] : (vols[mid-1] + vols[mid]) / 2;
        if (!avgVol) continue;

        // sorted can hold thousands of unique days for items with years of
        // history — a single O(n) pass to build a day -> index map avoids
        // an O(n * days) findIndex scan per item.
        const idxByDay = {};
        for (let i = 0; i < sorted.length; i++) idxByDay[dayBucket(toSec(sorted[i].timestamp))] = i;

        for (let di = 0; di < days.length; di++) {
          const idx = idxByDay[dayBuckets[di]];
          if (idx === undefined || idx < 1) continue; // need a previous day to compute change
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
      // Yield to the event loop between batches so this can't block the
      // main thread (and therefore window paint/input) for the whole run.
      await new Promise(res => setTimeout(res, 0));
    }

    const itemIds = {};
    for (const sig of Object.keys(itemDays)) {
      itemIds[sig] = Object.entries(itemDays[sig]).map(([id, lastDayIdx]) => ({id, lastDayIdx}));
    }

    const result = { days, counts, itemIds };
    signalTrendCache = { historyVersion: usedHistoryVersion, result };
    return result;
  }

  // % change from the latest stored point back to whichever point is the
  // closest at-or-before `now - days`. Returns null if there isn't enough
  // history to compare. Used by the watchlist digest check.
  async function pctChangeOverDays(itemId, days) {
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

  // ─── Price snapshots (local recent history, 1/day/item) ─────────────────
  async function updateSnapshots() {
    try {
      const parsed = await storage.readJSON(dataFile, null);
      if (!parsed) return;
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
      await saveSnapshots();
    } catch (e) { console.error('[snapshots] Error:', e.message); }
  }

  async function getPriceSnapshots(itemId) {
    return (snapshotData[String(itemId)] || []).map(s => ({timestamp: s.t, price: s.p, volume: s.v}));
  }

  // ─── Wiki item stats ─────────────────────────────────────────────────────
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

  // Wiki stats only get fetched lazily, one item at a time as the user
  // looks at it (a few hundred items at most over a session) — persisting
  // this small file is nothing like the per-item history cost, so it's
  // safe to write through on every new entry without affecting launch time.
  async function getItemStats(itemName) {
    if (!itemName) return null;
    if (itemStatsCache.has(itemName)) return itemStatsCache.get(itemName);

    let result = null;
    try {
      const encoded = encodeURIComponent(itemName);
      const url = `https://runescape.wiki/api.php?action=query&titles=${encoded}&prop=revisions&rvprop=content&format=json&formatversion=2`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'GEnius/1.0 (github.com/VonDerThWood/GE-Intelligence)' },
        signal: AbortSignal.timeout(8000),
      });
      const json = await res.json();
      const pages = json.query?.pages;
      if (pages?.length && !pages[0].missing) {
        const content = pages[0].revisions?.[0]?.content || '';
        result = parseItemStats(content);
      }
    } catch { result = null; }

    itemStatsCache.set(itemName, result);
    await saveItemStatsCache();
    return result;
  }

  // ─── Portfolio ───────────────────────────────────────────────────────────
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

  async function readPortfolio() {
    return storage.readJSON(portfolioFile, { positions:[], tax_stats:defaultTaxStats() });
  }

  async function writePortfolio(data) {
    await storage.writeJSON(portfolioFile, data, { pretty: true });
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

  async function getPortfolio() {
    return readPortfolio();
  }

  async function savePosition(position) {
    const p = await readPortfolio();
    const idx = p.positions.findIndex(x => x.id === position.id);
    if (idx >= 0) p.positions[idx] = position; else p.positions.push(position);
    await writePortfolio(p);
    return { success: true };
  }

  async function deletePosition(id) {
    const p = await readPortfolio();
    p.positions = p.positions.filter(x => x.id !== id);
    await writePortfolio(p);
    return { success: true };
  }

  async function sellPosition({ id, sell_price, quantity }) {
    const p = await readPortfolio();
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

    await writePortfolio(p);
    return { success:true, tax, realized_pl };
  }

  // Undoes a sale — puts a closed position back into open positions exactly
  // as it was before selling (status, sold_price/sold_quantity/realized_pl/
  // sold_at cleared). For a partial sell, the sold portion was originally
  // split into its own position entry (see sellPosition above), so this
  // just flips that split-off entry back to open rather than re-merging it
  // into the original position — same net result, simpler to reason about.
  // Only the lifetime tax counter is corrected (the sale's tax is no longer
  // real, so it shouldn't count toward your all-time total); today/week/month
  // are left alone since those are rolling windows that may have already
  // reset by the time you reopen an old position, and partially undoing a
  // stale window's count would be more confusing than leaving it as-is.
  async function reopenPosition(id) {
    const p = await readPortfolio();
    const pos = p.positions.find(x => x.id === id);
    if (!pos || pos.status !== 'sold') return { success: false };

    const tax = Math.round((pos.sold_price || 0) * (pos.sold_quantity || 0) * 0.02);
    p.tax_stats = p.tax_stats || defaultTaxStats();
    p.tax_stats.lifetime_tax = Math.max(0, (p.tax_stats.lifetime_tax || 0) - tax);

    pos.status = 'open';
    delete pos.sold_price; delete pos.sold_quantity; delete pos.realized_pl; delete pos.sold_at;

    await writePortfolio(p);
    return { success: true };
  }

  // ─── Alerts ──────────────────────────────────────────────────────────────
  async function getAlerts() {
    return storage.readJSON(alertsFile, []);
  }

  async function saveAlert(alert) {
    const alerts = await storage.readJSON(alertsFile, []);
    const idx = alerts.findIndex(a => a.id === alert.id);
    if (idx >= 0) alerts[idx] = alert; else alerts.push(alert);
    await storage.writeJSON(alertsFile, alerts, { pretty: true });
    return { success: true };
  }

  async function deleteAlert(id) {
    const alerts = (await storage.readJSON(alertsFile, [])).filter(a => a.id !== id);
    await storage.writeJSON(alertsFile, alerts, { pretty: true });
    return { success: true };
  }

  // ─── Category overrides editor ──────────────────────────────────────────
  async function getOverrides() {
    return storage.readJSON(overridesFile, {});
  }

  async function saveOverrides(overrides) {
    try {
      await storage.writeJSON(overridesFile, overrides, { pretty: true });
      // catalogue.js loads OVERRIDES into memory once at module load and
      // never re-reads the file on its own — without this, a saved edit
      // sits correctly on disk but is invisible to every fetch for the
      // rest of the app's run, looking exactly like "it didn't save."
      await catalogue.reloadOverrides();
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // ─── Misc ────────────────────────────────────────────────────────────────
  async function getData() {
    try {
      const parsed = await storage.readJSON(dataFile, { items: [], timestamp: null });
      console.log(`[get-data] Loaded ${parsed.items?.length ?? 0} items`);
      return parsed;
    } catch (e) {
      console.error('[get-data] Error:', e.message);
      return { items: [], timestamp: null };
    }
  }

  // Export/import bundle building is genuinely portable (a mobile build
  // would still want backup/restore, just via a different file picker) —
  // only the actual save/open dialog is Electron-specific, so that part
  // stays in main.js and calls these two functions.
  async function buildExportBundle() {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      watchlist:    store.get('watchlist', []),
      hiddenItems:  store.get('hiddenItems', []),
      itemNotes:    store.get('itemNotes', {}),
      // DXP Almanac watchlist — deliberately separate from the main
      // watchlist above (per TODO.txt spec), but easy to forget exactly
      // because of that — confirmed missed here for real on a desktop ->
      // mobile transfer. reminders/userShorthands are the same kind of
      // miss: real user data, just not one of the first few fields anyone
      // thinks to check.
      dxpWatchlist: store.get('dxpWatchlist', []),
      reminders:    store.get('reminders', []),
      userShorthands: store.get('userShorthands', {}),
      settings: {
        discordWebhook:     store.get('discordWebhook', ''),
        fetchInterval:      store.get('fetchInterval', 15),
        notifications:      store.get('notifications', true),
        expensiveThreshold: store.get('expensiveThreshold', 500000000),
        navOrder:           store.get('navOrder', []),
        dxpNotificationSettings: store.get('dxpNotificationSettings', {
          enabled: false, buyAlerts: true, sellAlerts: true, announceAlerts: true, windowApproachingAlerts: true,
        }),
        watchlistNotificationSettings: store.get('watchlistNotificationSettings', {
          enabled: false, dailyThresholdPct: 5, trendThresholdPct: 7,
        }),
      },
      alerts:    await storage.readJSON(alertsFile, null),
      portfolio: await storage.readJSON(portfolioFile, null),
      overrides: await storage.readJSON(overridesFile, null),
    };
  }

  async function applyImportBundle(bundle) {
    if (!bundle || bundle.version !== 1) return { error: 'Unrecognised backup format.' };

    if (Array.isArray(bundle.watchlist))     store.set('watchlist',     bundle.watchlist);
    if (Array.isArray(bundle.hiddenItems))   store.set('hiddenItems',   bundle.hiddenItems);
    if (bundle.itemNotes && typeof bundle.itemNotes === 'object') store.set('itemNotes', bundle.itemNotes);
    if (Array.isArray(bundle.dxpWatchlist))  store.set('dxpWatchlist',  bundle.dxpWatchlist);
    if (Array.isArray(bundle.reminders))     store.set('reminders',     bundle.reminders);
    if (bundle.userShorthands && typeof bundle.userShorthands === 'object') store.set('userShorthands', bundle.userShorthands);
    if (bundle.settings && typeof bundle.settings === 'object') {
      const ALLOWED_SETTINGS = ['discordWebhook','fetchInterval','notifications','expensiveThreshold','navOrder','theme','dateFormat','dxpNotificationSettings','watchlistNotificationSettings'];
      ALLOWED_SETTINGS.forEach(k => { if (k in bundle.settings) store.set(k, bundle.settings[k]); });
    }
    if (bundle.alerts    != null) await storage.writeJSON(alertsFile,    bundle.alerts,    { pretty: true });
    if (bundle.portfolio != null) await storage.writeJSON(portfolioFile, bundle.portfolio, { pretty: true });
    if (bundle.overrides != null) await storage.writeJSON(overridesFile, bundle.overrides, { pretty: true });

    return { success: true };
  }

  // ─── Notification checks ───────────────────────────────────────────────
  // What should fire is shared logic (dedup-log bookkeeping included) —
  // only HOW to actually show a native notification differs by platform
  // (Electron's Notification API on desktop, @capacitor/local-notifications
  // on mobile), so that part stays out of here entirely. Each function
  // below returns a plain list of {key, title, body} descriptors for the
  // caller to fire however it needs to; the store-side bookkeeping (marking
  // things as already-notified) happens here so both platforms share one
  // source of truth and can never drift out of sync with each other.

  // Conservative calendar anchors per season — the earliest a DXP
  // announcement's pre_announce phase has EVER historically begun (21 days
  // before the earliest announcement on record for that season), computed
  // from the full 2017-2026 history in research/dxp_event_history.md.
  const DXP_SEASON_ANCHORS = [
    { label: 'Winter/February', month: 1,  day: 2,  wide: true },
    { label: 'Spring/May',      month: 3,  day: 25, wide: false },
    { label: 'Summer/August',   month: 6,  day: 8,  wide: true },
    { label: 'Autumn/November', month: 9,  day: 27, wide: false },
  ];

  async function getDxpNotifications() {
    const settings = store.get('dxpNotificationSettings', {
      enabled: false, buyAlerts: true, sellAlerts: true, announceAlerts: true, windowApproachingAlerts: true,
    });
    if (!settings.enabled) return [];

    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const notifiedLog = store.get('dxpNotifiedLog', {});
    const out = [];
    let logChanged = false;
    const fire = (key, title, body) => {
      if (notifiedLog[key]) return;
      out.push({ key, title, body });
      notifiedLog[key] = todayStr;
      logChanged = true;
    };

    const events = await storage.readJSON(path.join(dataDir, 'dxp_events.json'), []);

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
    const dxpData = watchlist.length ? await storage.readJSON(path.join(dataDir, 'dxp_intelligence.json'), null) : null;

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
    return out;
  }

  // Fires at most once per calendar day, checking each watchlist item for
  // either a same-day move past `dailyThresholdPct` or a 7-day drift past
  // `trendThresholdPct` (kept as a separate, slightly higher bar by default
  // since a sustained week-long move is a different signal than a single-day
  // spike). Returns null if nothing on the watchlist crossed either bar,
  // rather than a digest notification firing daily regardless of whether
  // anything happened.
  async function getWatchlistDigest() {
    const settings = store.get('watchlistNotificationSettings', {
      enabled: false, dailyThresholdPct: 5, trendThresholdPct: 7,
    });
    if (!settings.enabled) return null;

    const watchlist = store.get('watchlist', []);
    if (!watchlist.length) return null;

    const todayStr = new Date().toISOString().slice(0, 10);
    if (store.get('watchlistDigestLastSent', null) === todayStr) return null;

    const itemsById = Object.fromEntries(
      ((await getData()).items || []).map(i => [String(i.id), i])
    );

    const movers = [];
    for (const id of watchlist) {
      const dayPct = await pctChangeOverDays(id, 1);
      const weekPct = await pctChangeOverDays(id, 7);
      const dayHit = dayPct != null && Math.abs(dayPct) >= settings.dailyThresholdPct;
      const weekHit = weekPct != null && Math.abs(weekPct) >= settings.trendThresholdPct;
      if (dayHit || weekHit) {
        const name = itemsById[String(id)]?.name || id;
        movers.push({ id, name, dayPct, weekPct, dayHit, weekHit });
      }
    }
    if (!movers.length) return null;

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

    store.set('watchlistDigestLastSent', todayStr);
    return {
      title: `Watchlist — ${movers.length} item${movers.length === 1 ? '' : 's'} moving`,
      body: lines.join('\n'),
    };
  }

  // Plain date-triggered reminders, no price involved. Fires once the day
  // arrives, then marked fired so it never repeats.
  async function getDueReminders() {
    const reminders = store.get('reminders', []);
    if (!reminders.length) return [];
    const todayStr = new Date().toISOString().slice(0, 10);
    const due = [];
    let changed = false;
    for (const r of reminders) {
      if (r.fired || !r.dueDate || r.dueDate > todayStr) continue;
      due.push({
        key: `reminder_${r.id}`,
        title: r.itemName ? `Reminder: ${r.itemName}` : 'GEnius Reminder',
        body: r.message || 'Reminder due.',
      });
      r.fired = true;
      changed = true;
    }
    if (changed) store.set('reminders', reminders);
    return due;
  }

  return {
    // history
    loadHistory, saveHistory, fetchHistoryForItem,
    getHistoryStatus, getHistoryPopulatedIds, getItemHistoryLocal,
    startHistoryPopulation, stopHistoryPopulation,
    getItemHistory, getItemTimeseries,
    historyLoadedPromise,
    get historyData() { return historyData; },        // read-only view for main.js's runPython/notifications
    get historyVersion() { return historyVersion; },
    // dxp / signals
    getDxpIntelligence, getDxpEvents, getSignalTrend, pctChangeOverDays,
    // snapshots
    updateSnapshots, getPriceSnapshots,
    // wiki stats
    getItemStats,
    // portfolio
    getPortfolio, savePosition, deletePosition, sellPosition, reopenPosition,
    // alerts
    getAlerts, saveAlert, deleteAlert,
    // overrides
    getOverrides, saveOverrides,
    // misc
    getData, buildExportBundle, applyImportBundle,
    // notification checks (see comment above — what to fire is shared,
    // how to actually show it natively is platform-specific glue)
    getDxpNotifications, getWatchlistDigest, getDueReminders,
  };
}

module.exports = { createGeniusApi };
