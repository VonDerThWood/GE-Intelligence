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
  //
  // Lives in dataDir now (a real, always-writable per-user location — same
  // as alertsFile/portfolioFile above), NOT bundled inside src/backend-js/
  // data/ like it used to be. That old location required asarUnpack +
  // resolveWritable gymnastics to be writable at all in a packaged install,
  // and was the direct cause of the category editor's Save silently no-op'ing
  // (2026-07-10). Shipping Ben's corrections to every user's fresh install
  // is now sync-overrides.js's job at build time (it merges this file's
  // content into category_overrides.json, the actual bundled/read-only
  // bulk file, instead of reshipping this file itself) — see that script.
  const overridesFile = path.join(dataDir, 'personal_overrides.json');

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

  // One-time migration for anyone upgrading from a build where this file
  // still lived at the old asarUnpack location — copies it over exactly
  // once (if the new dataDir copy doesn't exist yet, but an old one with
  // real content does). Safe to run unconditionally: a no-op for anyone
  // who never had the old file, or who's already migrated.
  if (!(await storage.pathExists(overridesFile))) {
    const legacyPath = storage.resolveWritable(path.join(__dirname, 'data', 'personal_overrides.json'));
    const legacy = await storage.readJSON(legacyPath, null);
    if (legacy && Object.keys(legacy).length) {
      await storage.writeJSON(overridesFile, legacy, { pretty: true });
      console.log(`[catalogue] Migrated ${Object.keys(legacy).length} personal overrides to ${overridesFile}`);
    }
  }

  // catalogue.js's bulk overrides are available synchronously the moment it
  // loads, but personal_overrides.json (the user-editable file) is now
  // loaded async — without this, the very first price fetch after launch
  // would categorize everything using only the bulk file, missing any
  // personal in-app edits until the next save-overrides call happened to
  // trigger a reload.
  await catalogue.reloadOverrides(overridesFile);

  let athCache = await storage.readJSON(athCacheFile, {});       // { itemId: { data: [...] } }
  let snapshotData = await storage.readJSON(snapshotFile, {});   // { itemId: [{t,p,v}] }
  const itemHistoryCache = new Map();
  const itemStatsCache = new Map();
  // Session-only, never written to disk (unlike itemStatsCache) — Ben:
  // drop sources are a "quickly check where this comes from" lookup, not
  // something worth persisting across restarts. Still worth caching in
  // memory so re-opening the same item this session doesn't re-fetch.
  const dropSourcesCache = new Map();
  // Same session-only philosophy as dropSourcesCache, for the inverse
  // lookup (monster -> its drops) used by Monster Lookup.
  const monsterSearchCache = new Map();
  const monsterDropsCache = new Map();
  const monsterInfoCache = new Map();
  // Live GE prices move minute-to-minute, so this is a short TTL cache
  // (holds {result, fetchedAt}) rather than the session-forever caches
  // above — just enough to survive a component re-render without
  // re-hitting the wiki's live-prices API every time.
  const livePriceCache = new Map();
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
    // AbortSignal.timeout bounds fetch() itself, but a response whose
    // headers arrive fine and then stalls mid-body (server hang, a proxy/
    // AV product interfering) can leave res.json() below hanging past that
    // same nominal deadline — the abort's coverage of an in-progress body
    // read isn't a rock-solid guarantee across every fetch implementation.
    // Confirmed for real (Ben, 2026-07-14): history population sat stuck
    // at 99% (7184/7261) for "several minutes" with zero new history files
    // written — a single item wedged the whole queue indefinitely, well
    // past what its 12s/20s timeouts should have allowed. Wrapping the
    // whole attempt in a hard Promise.race backstop (timeout + grace)
    // guarantees this function always settles, so one bad item can never
    // block the rest of the queue again, regardless of the exact cause.
    const attempt = async () => {
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
    };

    const backstop = new Promise(resolve => {
      setTimeout(() => {
        console.warn(`[history] Hard backstop hit for item ${itemId} (attempt exceeded ${timeoutMs + 5000}ms wall-clock) — giving up on this attempt`);
        resolve(false);
      }, timeoutMs + 5000);
    });
    return Promise.race([attempt(), backstop]);
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
      if (historyData[String(id)]) {
        // Already have it (loaded from disk on a previous session, most
        // items on an established install) — still report progress so the
        // renderer's populatedHistoryIds stays in sync. Previously this
        // `continue`d silently, so on an install where most items were
        // already fetched, onProgress could go the entire queue without
        // firing even once — leaving the renderer's populated-ids snapshot
        // stuck at whatever it captured right after get-data (often taken
        // before loadHistory()'s disk read had even finished), wrongly
        // showing "price history still loading" for items that had been
        // fully loaded the whole time. Confirmed for real: Gold Bar, which
        // has 2011-2024 history on disk, still showed the message.
        done++;
        if (onProgress) onProgress(done, total);
        continue;
      }
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
    // Without this, the renderer's very first refresh (fired right after
    // get-data resolves) could race loadHistory()'s disk read of the
    // per-item history files — capturing a near-empty snapshot and
    // wrongly flagging already-fully-loaded items as "still loading" for
    // the rest of the session (see runHistoryQueue's onProgress fix above
    // for the other half of this bug).
    await historyLoadedPromise;
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

  // Live GE prices — runescape.wiki's real-time prices API (launched 2026-07,
  // same shape as the long-standing OSRS one), giving true instant-buy/
  // instant-sell prices WITH timestamps, unlike the 15-min gazbot dump that
  // powers item.high/item.low everywhere else in the app. Deliberately
  // scoped to just the Detail Panel's single open item for now rather than
  // replacing the app-wide price pipeline — see TODO.txt for the planned
  // follow-up to swap the whole pipeline over once this proves out.
  const LIVE_PRICE_TTL_MS = 60 * 1000;
  async function getLiveItemPrice(itemId) {
    if (!itemId) return null;
    const cached = livePriceCache.get(itemId);
    if (cached && Date.now() - cached.fetchedAt < LIVE_PRICE_TTL_MS) return cached.result;

    let result = null;
    try {
      const url = `https://prices.runescape.wiki/api/v2/rs/latest?id=${itemId}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'GEnius/1.0 (github.com/VonDerThWood/GE-Intelligence)' },
        signal: AbortSignal.timeout(8000),
      });
      const json = await res.json();
      const raw = json.data?.[String(itemId)];
      if (raw) {
        result = {
          high: raw.high ?? null,
          highTime: raw.highTime ? raw.highTime * 1000 : null,
          low: raw.low ?? null,
          lowTime: raw.lowTime ? raw.lowTime * 1000 : null,
        };
      }
    } catch { result = null; }

    livePriceCache.set(itemId, { result, fetchedAt: Date.now() });
    return result;
  }

  // ─── Drop sources ────────────────────────────────────────────────────────
  // "Where does this come from" lookup for the detail panel — click-to-fetch
  // only (never auto-loaded like getItemStats above), and never persisted to
  // disk (dropSourcesCache is session-only). Ben: this is for spot-checking
  // unusual items, not something that needs to survive a restart.
  //
  // The wiki's drop table is server-rendered from a Cargo query (not
  // present in raw wikitext — unlike getItemStats' infobox parsing above),
  // so this fetches and parses the rendered HTML page instead, the same
  // approach untradeable.js uses for its wiki tables. Items with no
  // monster-drop source (bought from a shop, made via Crafting, etc.)
  // simply have no item-drops table on their wiki page — that's a normal,
  // expected outcome, not a fetch failure.
  //
  // Originally anchored on the section heading text ("Drop sources") to
  // find the right table — wrong assumption, confirmed for real on Air
  // rune: that item's section is titled "Item sources" instead (common/
  // currency-tier items seem to get the broader heading; gear/boss drops
  // get "Drop sources"), so the heading-text search silently found nothing
  // and reported "no drop sources" for an item with 128 real ones. Anchor
  // on the table's class instead (`item-drops`) — stable across every page
  // checked regardless of what the section is titled. When a page has more
  // than one such table (Air rune has two), only the FIRST is the current/
  // active source list; later ones are historical "no longer dropped"
  // tables (confirmed via their drop-removed row class) — using only the
  // first table, plus filtering drop-removed rows defensively, keeps
  // discontinued sources out of the result.
  function _stripHtmlTags(html) {
    // Numeric entities decoded generically (&#91; -> '[', &#39; -> "'", etc.)
    // rather than a hardcoded whitelist — confirmed for real that the
    // whitelist missed &#91;/&#93; ([/]), which showed up literally as
    // "COMMON &#91; D I &#93;" in a General Graardor drop-table rarity
    // cell instead of decoding to whatever bracketed qualifier the wiki
    // actually wrote. &amp;/&nbsp; are named entities so still handled
    // explicitly.
    return html.replace(/<[^>]+>/g, ' ')
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
      .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  // Common, well-liked items (runes, ores, basic supplies) can have 100+
  // monster sources — a small detail panel can't usefully show all of
  // them, and the wiki's own default sort (ascending rarity — see
  // autosort=4 on the table) already puts the most common/easiest sources
  // first, so a cap keeps the useful ones without truncating arbitrarily.
  const DROP_SOURCES_CAP = 25;

  function parseDropSources(html) {
    const tableMatch = html.match(/<table[^>]*class="[^"]*\bitem-drops\b[^"]*"[^>]*>([\s\S]*?)<\/table>/);
    if (!tableMatch) return { sources: [], totalCount: 0 };

    const rows = [];
    const rowRe = /<tr([^>]*)>([\s\S]*?)<\/tr>/g;
    let rm, isHeaderRow = true;
    while ((rm = rowRe.exec(tableMatch[1])) !== null) {
      if (isHeaderRow) { isHeaderRow = false; continue; } // header row uses <th>, never matched by the <td> loop below anyway — skipped for clarity
      if (/drop-removed/.test(rm[1])) continue; // no longer an active source

      const cells = [];
      const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
      let cm;
      while ((cm = cellRe.exec(rm[2])) !== null) cells.push(cm[1]);
      if (cells.length < 4) continue;

      const source = _stripHtmlTags(cells[0]);
      const level = (_stripHtmlTags(cells[1]).match(/^[\d,]+/) || [''])[0];
      const quantity = _stripHtmlTags(cells[2]);
      // Prefer the machine-readable data-drop-fraction attribute over the
      // cell's visible text — the text often carries footnote markers like
      // "[f 1]" that read as noise once stripped of their link context.
      const fractions = [...new Set([...cells[3].matchAll(/data-drop-fraction="([^"]+)"/g)].map(m => m[1]))];
      const rarity = fractions.length ? fractions.join(' / ') : _stripHtmlTags(cells[3]);

      if (source) rows.push({ source, level, quantity, rarity });
    }
    const totalCount = rows.length;
    if (rows.length > DROP_SOURCES_CAP) rows.length = DROP_SOURCES_CAP;
    return { sources: rows, totalCount };
  }

  async function getDropSources(itemName) {
    if (!itemName) return null;
    if (dropSourcesCache.has(itemName)) return dropSourcesCache.get(itemName);

    let result = null;
    try {
      const url = `https://runescape.wiki/w/${encodeURIComponent(itemName.replace(/ /g, '_'))}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'GEnius/1.0 (github.com/VonDerThWood/GE-Intelligence)' },
        signal: AbortSignal.timeout(10000),
      });
      const html = await res.text();
      result = parseDropSources(html);
    } catch (e) { result = { sources: [], error: e.message }; }

    dropSourcesCache.set(itemName, result);
    return result;
  }

  // ─── Monster Lookup ────────────────────────────────────────────────────────
  // The inverse of Drop sources above: given a monster, show what it drops
  // and an estimated gp/kill. There is no single wiki field for gp/kill that
  // works across all monsters — only some boss pages have a prose sentence
  // ("The average kill... is worth X"), ordinary monsters have nothing, and
  // it's not consistently machine-parseable either way. Instead, GEnius
  // computes its own estimate straight from the same item-drops table data
  // parseDropSources already relies on (confirmed directly against the live
  // wiki: monster pages use the identical `item-drops` table class, just
  // listing what's dropped rather than where an item comes from).
  //
  // Unlike an item page (where multiple item-drops tables are historical —
  // current vs. no-longer-dropped), a monster page's multiple item-drops
  // tables are concurrent categories (e.g. Cow has "100% drops", "Tertiary
  // drops", and "Charms" as three separate tables) — all of them are
  // aggregated together here, not just the first.
  const MONSTER_DROPS_CAP = 40;

  function _parseAvgQuantity(text) {
    // Strip a trailing annotation like "(noted)" or "(m)" before matching a
    // range — confirmed for real on General Graardor: "15–20 (noted)" was
    // falling through to a bare parseFloat (which stops at the first
    // non-digit) and silently using 15 instead of the 17.5 average.
    const bare = text.replace(/\s*\([^)]*\)\s*$/, '').trim();
    const range = bare.match(/^(\d[\d,]*)\s*[-–]\s*(\d[\d,]*)$/);
    if (range) return (parseFloat(range[1].replace(/,/g, '')) + parseFloat(range[2].replace(/,/g, ''))) / 2;
    const n = parseFloat(bare.replace(/,/g, ''));
    return Number.isFinite(n) ? n : 1; // unparseable quantity text — assume 1 rather than silently zeroing the estimate
  }

  function _parseDropProbability(cellHtml) {
    const pct = cellHtml.match(/data-drop-percent="([\d.]+)"/);
    if (pct) return parseFloat(pct[1]) / 100;
    if (/^Always$/i.test(_stripHtmlTags(cellHtml))) return 1;
    const frac = cellHtml.match(/data-drop-fraction="(\d+)\/([\d,]+)"/);
    if (frac) return parseFloat(frac[1]) / parseFloat(frac[2].replace(/,/g, ''));
    return null; // row still shown, just excluded from the gp/kill sum
  }

  // Some boss pages state their own computed average directly in prose
  // ("The average General Graardor kill in normal mode, including its
  // unique drops, is worth <span class="nocoins coins-pos">32,953</span>.")
  // — confirmed this is a real Jagex-sourced figure, not a loose estimate,
  // per the TODO's original caution to check before trusting it. When
  // present, prefer it over our own computed sum below (see why in
  // parseMonsterDrops's Rare/Gem drop table comment).
  //
  // Two bugs found for real on Vindicta & Gorvek (Ben, 2026-07-2x):
  // (1) the span's content is "191,878 coins" — number AND the word
  // "coins" both inside the span — not the bare number the old regex
  // required immediately before the closing tag, so it silently matched
  // nothing at all and fell through to the (also broken, see below)
  // computed path. Fixed by tolerating trailing text before </span>.
  // (2) that stated figure was explicitly labeled "(0% drop increase)" —
  // the OLD, un-boosted reputation rate. Reputation was removed from the
  // game as of this same date, so a "0% drop increase" figure is now
  // stale and reads as too low relative to what current drop rates
  // actually are. Deliberately skip any wiki-stated average whose nearby
  // text mentions reputation/drop-increase — safer to fall through to
  // GEnius's own computed estimate (now deduped to keep only each item's
  // best-available rate, see parseMonsterDrops) than present a
  // confidently-labeled but rate-stale number as authoritative.
  function _parseWikiStatedGpPerKill(html) {
    const m = html.match(/average[\s\S]{0,120}?kill[\s\S]{0,120}?is worth <span class="nocoins coins-pos">([\d,]+)[^<]*<\/span>/i);
    if (!m) return null;
    const context = html.slice(Math.max(0, m.index - 200), m.index + m[0].length);
    if (/reputation|drop increase/i.test(context)) return null;
    const n = parseFloat(m[1].replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }

  // Confirmed for real on Vindicta & Gorvek (Ben, 2026-07-2x): a page with
  // separate "Drops (normal mode)" and "Drops (hard mode)" headings (same
  // pattern as General Graardor, K'ril Tsutsaroth, etc.) was having BOTH
  // sections' item-drops tables scanned indiscriminately across the whole
  // page and merged into one list — unlike the reputation-table duplication
  // fixed just before this, normal/hard mode are genuinely separate
  // encounters a player chooses between, not two states of the same thing,
  // so they must never be combined. Scopes parsing to just one mode's own
  // section of the page; a page with no hard-mode heading at all has no
  // mode split to worry about, so 'normal' just returns the whole page and
  // 'hard' correctly returns nothing (this monster has no hard mode).
  function _extractModeSection(html, mode) {
    const normalIdx = html.indexOf('id="Drops_(normal_mode)"');
    const hardIdx = html.indexOf('id="Drops_(hard_mode)"');
    if (hardIdx === -1) return mode === 'hard' ? null : html; // no mode split on this page
    if (mode === 'hard') {
      const after = html.slice(hardIdx);
      const closeIdx = after.indexOf('</h2>');
      const nextH2Idx = closeIdx === -1 ? -1 : after.indexOf('mw-heading2', closeIdx + 5);
      return nextH2Idx === -1 ? after : after.slice(0, nextH2Idx);
    }
    if (normalIdx === -1) return null; // hard-mode heading exists but normal-mode one doesn't — unexpected page shape, bail rather than guess
    return html.slice(normalIdx, hardIdx);
  }

  function parseMonsterDrops(html, mode = 'normal') {
    const hasHardMode = html.indexOf('id="Drops_(hard_mode)"') !== -1;
    const section = _extractModeSection(html, mode);
    if (section === null) {
      return { drops: [], estimatedGpPerKill: 0, gpPerKillSource: 'none', untradeableDropCount: 0, totalCount: 0, hadAnyTable: false, hasHardMode };
    }
    const wikiStatedGpPerKill = _parseWikiStatedGpPerKill(section);
    const allTables = [...section.matchAll(/<table[^>]*class="[^"]*\bitem-drops\b[^"]*"[^>]*>([\s\S]*?)<\/table>/g)];
    // Shared tables like the Rare drop table / Gem drop table are only
    // rolled with some probability stated ONLY in prose right above them
    // ("There is a 6/128 chance of rolling the gem drop table. There is
    // also a 1/100 chance of rolling the rare drop table.") and are
    // rendered inside a `mw-collapsible` wrapper — their own rows' rarity
    // fractions are relative to THAT roll, not the monster's absolute
    // per-kill odds. Confirmed for real on General Graardor: summing that
    // table's rows as if they were absolute odds alone accounted for most
    // of a 500-million-gp/kill estimate on a boss that really averages
    // ~33-48k. There's no reliable machine-readable "chance to access this
    // table" anywhere, so these tables are excluded from the estimate
    // entirely rather than guessed at.
    const tables = allTables.filter(t => !section.slice(Math.max(0, t.index - 600), t.index).includes('mw-collapsible'));
    if (tables.length === 0) {
      return { drops: [], estimatedGpPerKill: wikiStatedGpPerKill || 0, gpPerKillSource: wikiStatedGpPerKill ? 'wiki' : 'none', untradeableDropCount: 0, totalCount: 0, hadAnyTable: false, hasHardMode, unknownRarityCount: 0, unknownRarityValue: 0 };
    }

    const drops = [];
    let untradeableDropCount = 0;
    // Some drops are real, tradeable, priced items whose drop RATE the wiki
    // itself lists as "Unknown" rather than a fraction/percent — confirmed
    // for real on Vindicta & Gorvek: two Furniture plans worth 5.7M/4.4M
    // each are marked this way and were silently contributing zero to the
    // estimate (no probability to weight them by), making the total read
    // as a real number when it was actually missing several million gp of
    // undocumented-rate value. Tracked separately from untradeableDropCount
    // (which is "no GE price at all") so the UI can be honest that this
    // specific estimate is a floor, not a complete figure — inventing a
    // guessed rate would be worse than flagging the gap outright.
    let unknownRarityCount = 0, unknownRarityValue = 0;

    for (const table of tables) {
      const rowRe = /<tr([^>]*)>([\s\S]*?)<\/tr>/g;
      let rm, isHeaderRow = true;
      while ((rm = rowRe.exec(table[1])) !== null) {
        if (isHeaderRow) { isHeaderRow = false; continue; } // header row uses <th>, never matched by the <td> loop below

        // Capture each <td>'s own attributes (group 1) alongside its inner
        // content (group 2) — the per-unit price below lives in the GE-price
        // cell's title="X coins each" ATTRIBUTE, not its content, and the
        // original single-group version had no way to ever see it.
        const cells = [], cellAttrs = [];
        const cellRe = /<td([^>]*)>([\s\S]*?)<\/td>/g;
        let cm;
        while ((cm = cellRe.exec(rm[2])) !== null) { cellAttrs.push(cm[1]); cells.push(cm[2]); }
        if (cells.length < 5) continue; // image, item, quantity, rarity, GE price (alch, cells[5], unused)

        const item = _stripHtmlTags(cells[1]);
        if (!item) continue;
        const quantity = _stripHtmlTags(cells[2]);
        const avgQuantity = _parseAvgQuantity(quantity);
        const probability = _parseDropProbability(cells[3]);
        const fraction = cells[3].match(/data-drop-fraction="([^"]+)"/);
        // Wiki footnote markers (<sup>...[d 1]...</sup>, a citation link to a
        // note elsewhere on the page explaining some drop-mechanic quirk) are
        // meaningless on their own without the note text, which GEnius never
        // fetches — confirmed for real on General Graardor's Femur bone row
        // showing a bare "[d 1]" with no context. Strip the whole <sup> before
        // extracting rarity text rather than decode-and-show a marker that
        // points nowhere.
        const rarityCell = cells[3].replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/g, '');
        const rarity = fraction ? fraction[1] : (_stripHtmlTags(rarityCell) || '—');
        // Cell TEXT is the wiki's own precomputed TOTAL value across the
        // quantity range (e.g. Magic logs at 902gp each, qty 15–20, shows
        // "13,530–18,040" — 902×15 to 902×20), not a per-unit price. Its
        // title attribute, when present, IS the true per-unit price
        // ("902 coins each") — confirmed for real on General Graardor.
        // Originally only handled this for Coins specifically (detected by
        // price text === quantity text, since 1 coin is always worth 1gp),
        // which avoided squaring the value for that one row — but the exact
        // same bug existed for every OTHER row with a quantity range too,
        // just silently: contribution below multiplies by avgQuantity, so
        // feeding it this already-quantity-multiplied total instead of the
        // true per-unit price inflated every such row's contribution by
        // roughly (avgQuantity)x. Reading the title attribute fixes the
        // general case; the structural Coins check stays as the fallback
        // for rows with no title (Coins' own cell has none, since 1gp/coin
        // needs no "each" annotation).
        const geValueText = _stripHtmlTags(cells[4]);
        const perUnitMatch = cellAttrs[4].match(/title="([\d,]+(?:\.\d+)?)\s*coins each"/i);
        const gePricePerUnit = perUnitMatch
          ? parseFloat(perUnitMatch[1].replace(/,/g, ''))
          : (geValueText === quantity ? 1 : (Number.isFinite(parseFloat(geValueText.replace(/,/g, ''))) ? parseFloat(geValueText.replace(/,/g, '')) : null));
        if (gePricePerUnit === null) untradeableDropCount++;
        else if (probability == null) { unknownRarityCount++; unknownRarityValue += gePricePerUnit; }

        const contribution = (probability != null && gePricePerUnit != null) ? avgQuantity * gePricePerUnit * probability : 0;
        // gePrice: per-unit price, used for sorting/contribution — comparable
        // across rows regardless of quantity. geValueText: the wiki's own
        // displayed total-value text (a range like "13,530–18,040" whenever
        // quantity is a range, or a single number when it's fixed) — shown
        // as-is in the UI rather than an "average" that loses the range Ben
        // specifically wanted kept visible.
        drops.push({ item, quantity, rarity, gePrice: gePricePerUnit, geValueText, contribution, probability });
      }
    }

    // Dedupe by item name WITHIN this one mode's section, keeping only the
    // row with the HIGHEST drop probability. Confirmed for real on Vindicta
    // & Gorvek (Ben, 2026-07-2x): every item was listed twice within the
    // SAME normal-mode section, once from a "0% reputation" table and once
    // from a "100% reputation" table (reputation boosted drop rates) — e.g.
    // Dragon Rider lance at both 1/460 and 1/255. Summing both into the
    // gp/kill estimate roughly doubled it, and the UI showed the same item
    // twice. Reputation was removed from the game as of this same date, so
    // there's no longer a real choice between rates to preserve — the
    // better (higher-probability) one is simply what applies now. This is
    // deliberately scoped to run AFTER _extractModeSection above already
    // isolated normal-mode-only or hard-mode-only tables — normal/hard mode
    // are genuinely separate encounters, never deduped against each other.
    const bestByItem = new Map();
    for (const d of drops) {
      const existing = bestByItem.get(d.item);
      const dProb = d.probability ?? -1;
      const existingProb = existing ? (existing.probability ?? -1) : -Infinity;
      if (!existing || dProb > existingProb) bestByItem.set(d.item, d);
    }
    const deduped = [...bestByItem.values()];
    drops.length = 0;
    drops.push(...deduped);

    const computedGpPerKill = drops.reduce((sum, d) => sum + d.contribution, 0);
    // Default order is by per-unit GE price, highest first — NOT by gp
    // contribution. Contribution factors in rarity/quantity too, so a common
    // cheap item can outrank a genuinely expensive rare one; since the list
    // is capped below, sorting by contribution risked silently dropping the
    // actual highest-value drops off the visible list. Nulls (untradeable
    // drops) always sort last regardless.
    drops.sort((a, b) => {
      if (a.gePrice == null && b.gePrice == null) return 0;
      if (a.gePrice == null) return 1;
      if (b.gePrice == null) return -1;
      return b.gePrice - a.gePrice;
    });
    const totalCount = drops.length;
    if (drops.length > MONSTER_DROPS_CAP) drops.length = MONSTER_DROPS_CAP;

    return {
      drops, untradeableDropCount, totalCount, hadAnyTable: true, hasHardMode,
      unknownRarityCount, unknownRarityValue,
      estimatedGpPerKill: wikiStatedGpPerKill != null ? wikiStatedGpPerKill : computedGpPerKill,
      gpPerKillSource: wikiStatedGpPerKill != null ? 'wiki' : 'computed',
      computedGpPerKill,
    };
  }

  async function searchMonsters(query) {
    if (!query || !query.trim()) return [];
    const key = query.trim().toLowerCase();
    if (monsterSearchCache.has(key)) return monsterSearchCache.get(key);

    // No live type-ahead here — this is an explicit-search feature (Enter/
    // button), same "quick lookup on click" philosophy as Drop sources
    // above, not a per-keystroke network feature like nothing else in
    // GEnius does. Caching is still worth it in case the same query is
    // re-submitted this session.
    let result = [];
    try {
      const url = `https://runescape.wiki/api.php?action=opensearch&search=${encodeURIComponent(query.trim())}&limit=8&format=json`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'GEnius/1.0 (github.com/VonDerThWood/GE-Intelligence)' },
        signal: AbortSignal.timeout(10000),
      });
      const [, titles, descriptions] = await res.json();
      // Opensearch returns any matching wiki page (achievements, subpages,
      // player pages), not just monsters — deliberately not pre-filtered by
      // title heuristics. A selection with no item-drops table on its page
      // just gets an empty "no drop table found" result from getMonsterDrops
      // below, same as how Drop sources handles a shop-bought item.
      result = titles.map((title, i) => ({ title, description: descriptions[i] || '' }));
    } catch (e) { result = []; }

    monsterSearchCache.set(key, result);
    return result;
  }

  // Raw page HTML is cached per monster name (monsterDropsCache reused for
  // this, values are HTML strings not results — same Map, different
  // purpose per key would be confusing, so this uses its own cache below),
  // so switching between Normal/Hard mode for the same monster re-parses
  // instead of re-fetching. Parsed results are cached per monster+mode
  // since normal and hard mode are genuinely different result sets now
  // (see _extractModeSection).
  const monsterHtmlCache = new Map();
  async function getMonsterDrops(monsterName, mode = 'normal') {
    if (!monsterName) return null;
    const resultKey = `${monsterName}::${mode}`;
    if (monsterDropsCache.has(resultKey)) return monsterDropsCache.get(resultKey);

    let result;
    try {
      let html = monsterHtmlCache.get(monsterName);
      if (!html) {
        const url = `https://runescape.wiki/w/${encodeURIComponent(monsterName.replace(/ /g, '_'))}`;
        const res = await fetch(url, {
          headers: { 'User-Agent': 'GEnius/1.0 (github.com/VonDerThWood/GE-Intelligence)' },
          signal: AbortSignal.timeout(10000),
        });
        html = await res.text();
        monsterHtmlCache.set(monsterName, html);
      }
      result = { monsterName, mode, ...parseMonsterDrops(html, mode) };
    } catch (e) {
      result = { monsterName, mode, drops: [], estimatedGpPerKill: 0, untradeableDropCount: 0, totalCount: 0, hadAnyTable: false, hasHardMode: false, error: e.message };
    }

    monsterDropsCache.set(resultKey, result);
    return result;
  }

  // Combat stats (combat level, HP, weakness, poison/stun/deflect/drain
  // susceptibility) come from the {{Infobox Monster}} template's raw
  // wikitext parameters, the same "fetch raw wikitext" approach getItemStats
  // above already uses for item infoboxes — confirmed directly against the
  // live wiki (Abyssal demon, Chicken, TzHaar-Ket, General Graardor) that
  // these fields are consistently named: level/lifepoints/weakness/
  // aggressive/poisonous/immune_to_poison/immune_to_stun/immune_to_deflect/
  // immune_to_drain. Multi-version monsters (e.g. General Graardor's Normal/
  // Hard mode/quest-cutscene versions) suffix numbered fields (level1,
  // lifepoints1, ...) instead of a bare one — this just reads the first
  // version's numbers as the headline figure rather than trying to show
  // every version.
  // Multi-version monsters (Normal/Hard mode, quest cutscene versions, ...)
  // suffix their infobox fields with a version number (level1/level2,
  // lifepoints1/lifepoints2, ...) rather than using a bare field. `suffix`
  // picks which version to read; fields that aren't version-specific
  // (weakness, immunities, etc.) are usually bare in the wikitext even on
  // multi-version pages, so this always falls back to the bare field name
  // when the suffixed one isn't present.
  function _infoboxField(wikitext, key, suffix) {
    const candidates = suffix ? [`${key}${suffix}`, key, `${key}1`] : [`${key}1`, key];
    for (const name of candidates) {
      const m = wikitext.match(new RegExp(`\\|\\s*${name}\\s*=\\s*([^\\n|]*)`, 'i'));
      if (m && m[1].trim()) {
        // Strip wiki-link markup ([[Fire]] / [[Fire spells|Fire]]) down to
        // display text, same idea as _stripHtmlTags but for wikitext, not HTML.
        return m[1].replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').trim() || null;
      }
    }
    return null;
  }

  function parseMonsterInfo(wikitext, mode) {
    if (!/\{\{\s*Infobox Monster\b/i.test(wikitext)) return null;

    // version1 = Normal mode, version2 = Hard mode is the wiki's convention
    // for bosses with a mode toggle (confirmed on Vindicta, General
    // Graardor, etc.) — read the matching suffix so the panel actually
    // changes when the user flips Normal/Hard, instead of always showing
    // version1's numbers regardless of the selected mode.
    const suffix = mode === 'hard' ? '2' : '1';
    const level = _infoboxField(wikitext, 'level', suffix);
    let hp = _infoboxField(wikitext, 'lifepoints', suffix);
    const weakness = _infoboxField(wikitext, 'weakness', suffix);
    const yesNo = v => v == null ? null : /^y/i.test(v);

    // Some hard-mode phases (e.g. Gorvek's enrage after Vindicta falls in
    // the Vindicta & Gorvek encounter) aren't given their own versioned
    // infobox field at all — the extra HP is only stated in prose ("carries
    // an additional 300,000 life points"). Pick that up as a fallback only
    // when hard mode is selected and no versioned field already answered it.
    if (mode === 'hard') {
      const prose = wikitext.match(/additional\s+([\d,]+)\s+life\s*points/i);
      if (prose) hp = prose[1];
    }

    return {
      combatLevel: level ? parseInt(level.replace(/,/g, ''), 10) : null,
      hitpoints: hp ? parseInt(hp.replace(/,/g, ''), 10) : null,
      weakness: weakness || null,
      aggressive: yesNo(_infoboxField(wikitext, 'aggressive', suffix)),
      poisonous: yesNo(_infoboxField(wikitext, 'poisonous', suffix)),
      poisonImmune: yesNo(_infoboxField(wikitext, 'immune_to_poison', suffix)),
      stunImmune: yesNo(_infoboxField(wikitext, 'immune_to_stun', suffix)),
      deflectImmune: yesNo(_infoboxField(wikitext, 'immune_to_deflect', suffix)),
      drainImmune: yesNo(_infoboxField(wikitext, 'immune_to_drain', suffix)),
    };
  }

  async function _fetchMonsterWikitext(monsterName) {
    // redirects=1 matters here: opensearch (searchMonsters) can surface a
    // redirect stub as its own title (e.g. "Graardor" -> #REDIRECT
    // [[General Graardor]]) — the drops HTML fetch below follows redirects
    // transparently since it's a normal page load, but this wikitext API
    // call doesn't unless told to, so without this it silently returns the
    // one-line redirect stub (no infobox) instead of the real page.
    const url = `https://runescape.wiki/api.php?action=query&titles=${encodeURIComponent(monsterName)}&prop=revisions&rvprop=content&format=json&formatversion=2&redirects=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'GEnius/1.0 (github.com/VonDerThWood/GE-Intelligence)' },
      signal: AbortSignal.timeout(8000),
    });
    const json = await res.json();
    const pages = json.query?.pages;
    if (pages?.length && !pages[0].missing) {
      return pages[0].revisions?.[0]?.content || '';
    }
    return null;
  }

  async function getMonsterInfo(monsterName, mode) {
    if (!monsterName) return null;
    mode = mode === 'hard' ? 'hard' : 'normal';
    const cacheKey = `${monsterName}::${mode}`;
    if (monsterInfoCache.has(cacheKey)) return monsterInfoCache.get(cacheKey);

    let result = null;
    try {
      const content = await _fetchMonsterWikitext(monsterName);
      if (content != null) result = parseMonsterInfo(content, mode);

      // Duo/trio encounter pages (e.g. "Vindicta & Gorvek") have no infobox
      // of their own — the wiki keeps combat stats on each individual
      // monster's own page instead. Split the title on "&"/"and" and fetch
      // each half separately rather than showing nothing.
      if (!result && /\s(?:&|and)\s/i.test(monsterName)) {
        const names = monsterName.split(/\s(?:&|and)\s/i).map(s => s.trim()).filter(Boolean);
        if (names.length > 1) {
          const parts = [];
          for (const name of names) {
            try {
              const partContent = await _fetchMonsterWikitext(name);
              const partInfo = partContent != null ? parseMonsterInfo(partContent, mode) : null;
              if (partInfo) parts.push({ name, ...partInfo });
            } catch { /* skip this half, still try the other */ }
          }
          if (parts.length) result = { multi: true, parts };
        }
      }
    } catch { result = null; }

    monsterInfoCache.set(cacheKey, result);
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
      await catalogue.reloadOverrides(overridesFile);
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

  // Fires at most once per `intervalHours` (defaults to 24 — once a day,
  // the original behavior), checking each watchlist item for either a
  // same-day move past `dailyThresholdPct` or a 7-day drift past
  // `trendThresholdPct` (kept as a separate, slightly higher bar by default
  // since a sustained week-long move is a different signal than a single-day
  // spike). Returns null if nothing on the watchlist crossed either bar,
  // rather than a digest notification firing every interval regardless of
  // whether anything happened.
  async function getWatchlistDigest() {
    const settings = store.get('watchlistNotificationSettings', {
      enabled: false, dailyThresholdPct: 5, trendThresholdPct: 7, intervalHours: 24,
    });
    if (!settings.enabled) return null;

    const watchlist = store.get('watchlist', []);
    if (!watchlist.length) return null;

    const intervalMs = (settings.intervalHours || 24) * 3600000;
    const lastSentAt = store.get('watchlistDigestLastSentAt', 0);
    if (Date.now() - lastSentAt < intervalMs) return null;

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

    store.set('watchlistDigestLastSentAt', Date.now());
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
    getDropSources,
    getLiveItemPrice,
    // monster lookup
    searchMonsters, getMonsterDrops, getMonsterInfo,
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
