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
const { createLiveHistory } = require('./live-history.js');
const { createSync } = require('./sync.js');
const { findRisks, buildNotifications: buildUpdateRiskNotifications, isForwardPost } = require('./update-risks.js');
const { computeSignals, buildDigest, uniqueEvents } = require('./almanac-signals.js');

const SIGNAL_TREND_DAYS = 7;

// Security audit (2026-10-02): the webhook URL used to be POSTed to as-is,
// and it's importable from a backup file — so a shared or tampered backup
// could silently redirect alert messages to any server, including LAN
// addresses. Only real Discord webhook endpoints are accepted now, checked
// on save, on import, and again right before sending.
// Optional query string allowed: Discord's own ?thread_id=…/?wait=true
// parameters are needed to post into forum/thread channels.
const DISCORD_WEBHOOK_RE = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/\d+\/[\w-]+\/?(?:\?[\w=&-]*)?$/;
// YYYY-MM-DD in the user's own timezone. toISOString() gives the UTC date,
// which rolls over hours early or late (e.g. ~7pm in US Eastern), so
// reminders, "Tax Today" and default dates switched days at the wrong time.
function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isValidDiscordWebhook(url) {
  return typeof url === 'string' && DISCORD_WEBHOOK_RE.test(url.trim());
}

async function createGeniusApi({ dataDir, store, platform = 'desktop', historyDirOverride = null, readOnlyHistory = false }) {
  // ─── Paths ──────────────────────────────────────────────────────────────
  const dataFile      = path.join(dataDir, 'latest.json');
  const alertsFile     = path.join(dataDir, 'alerts.json');
  const portfolioFile  = path.join(dataDir, 'portfolio.json');
  const historyFile    = path.join(dataDir, 'history.json'); // legacy, one-time migration only
  // Test mode reads the real history folder but must never write to it.
  const historyDir     = historyDirOverride || path.join(dataDir, 'history');
  const athCacheFile   = path.join(dataDir, 'ath_cache.json');
  const snapshotFile   = path.join(dataDir, 'price_snapshots.json');
  const oppHistoryFile = path.join(dataDir, 'opportunity_history.json');
  const eventsFile     = path.join(dataDir, 'events.json');
  const newsArchiveFile = path.join(dataDir, 'news_archive.json');
  const similarityFile = path.join(dataDir, 'similarity_returns.json');
  const calendarFile   = path.join(dataDir, 'news_calendar.json');
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
  // historyData is now a LAZY, session-only cache — populated on-demand by
  // getHistoryPoints() below (a real chart open, an active backfill fetch,
  // getSignalTrend's bulk scan), and evicted again once saveHistory()
  // confirms an item is safely on disk. It used to be eagerly fully loaded
  // at startup (loadDirBatched over every per-item file) and NEVER evicted
  // — confirmed for real (Ben, 2026-08-03) that a full real-device dataset
  // is ~1.3GB of raw JSON on disk (7,346 items, ~180KB average, largest
  // ~380KB); once parsed into JS objects and held resident for the WHOLE
  // catalogue simultaneously, that's easily 2.5-5GB+ of live heap — far
  // past any mobile WebView's V8 limit (repeated "Ineffective mark-
  // compacts near heap limit" OOM crashes chasing HISTORY_FETCH_CONCURRENCY
  // down from 12 all the way to 8 never fully fixed it, because
  // concurrency was never the real bottleneck — the eager full-catalogue
  // load and the backfill's own never-evicted accumulation were).
  // historyPopulatedIds is the cheap replacement for "do we have this
  // item's history at all" — built from a directory LISTING (filenames
  // only, no file content read) instead of loading every file's content.
  let historyData = {};            // { itemId: [{timestamp, price, volume}] } — sparse, session cache only
  let historyPopulatedIds = new Set(); // authoritative "has history on disk" — cheap, always fully populated
  let dirtyHistoryIds = new Set(); // ids changed since the last saveHistory()
  let historyVersion = 0;          // bumped on every real history change — lets
                                    // cache checks below work without stat'ing a file
  let historyFetchQueue = [];
  // Latest history point per item (ms), refreshed by every computeHistoryStats
  // pass — what refreshStaleHistory uses to pick the most out-of-date items.
  const historyLatestTs = {};
  // First-ever history point per item (ms) — when it first appeared on the
  // GE. Used to find items that launched WITH a game update.
  const historyFirstTs = {};
  // Last refresh attempt per item (ms) — an item with no new days yet on
  // WeirdGloop (or one that barely trades) isn't retried for 12h.
  const historyRefreshAttempt = {};
  let historyRefreshActive = false;
  let historyFetchActive = false;
  let historyFetchStop = false;
  let historyInitial300Done = store.get('historyInitial300Done', false);
  // Items whose history couldn't be fetched even after the in-session
  // retries (usually brand-new items WeirdGloop has no history for yet).
  // Remembered for 24h so the backfill doesn't retry them on every launch
  // and the "Building history" popup can finish instead of sitting at
  // e.g. 7,348 / 7,360 forever (Ben's phone, 2026-10-11). {id: failedAtMs}
  const HISTORY_UNAVAILABLE_TTL = 24 * 3600000;
  const recentUnavailable = () => {
    const m = store.get('historyUnavailable', {}) || {}, now = Date.now(), out = new Set();
    for (const [id, t] of Object.entries(m)) if (now - t < HISTORY_UNAVAILABLE_TTL && !historyPopulatedIds.has(id)) out.add(id);
    return out;
  };

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
  // Last real Almanac computation (ms), persisted so a relaunch doesn't
  // redo a ~50s (desktop) / 90s+ (mobile) recompute that ran an hour ago.
  let dxpIntelComputedAt = store.get('dxpIntelComputedAt', 0);
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
      existingFiles = await storage.listJSONFiles(historyDir); // migration writes files directly; re-list to pick them up
    }
    // A cheap directory LISTING (filenames only), not loadDirBatched's old
    // full-content read of every file — see the historyData/
    // historyPopulatedIds comment above for why. historyData itself starts
    // empty and fills in lazily via getHistoryPoints() as items actually
    // get used this session.
    historyPopulatedIds = new Set(existingFiles.map(f => f.slice(0, -5)));
    console.log(`[history] Found ${historyPopulatedIds.size} items on disk in ${Date.now()-loadStart}ms (loaded lazily, not held in memory).`);
    historyLoadDone();
  }

  // Central lazy accessor — the ONLY place that should read a single item's
  // history off disk. Checks the in-memory cache first (already-touched
  // this session), then historyPopulatedIds (cheap, always accurate) to
  // decide whether it's even worth a disk read at all, avoiding a wasted
  // read-miss for items that were never fetched.
  // Drop an item's points from the session cache after a scan has read
  // them, unless they're unsaved: evicting a dirty item made saveHistory
  // write undefined, fail, and retry forever (phone, 2026-10-15: "Save
  // failed for item 39: The 'writeFile' input parameters aren't valid").
  function evictHistory(itemId) {
    const key = String(itemId);
    if (!dirtyHistoryIds.has(key) && !dirtyHistoryIds.has(Number(key))) delete historyData[key];
  }

  async function getHistoryPoints(itemId) {
    const key = String(itemId);
    if (historyData[key]) return historyData[key];
    if (!historyPopulatedIds.has(key)) return null;
    const data = await storage.readDirItem(historyDir, key);
    if (data) historyData[key] = data;
    return data;
  }

  // Precomputes the two lightweight per-item summaries run.js's own price
  // fetch cycle actually needs (a volume median, a previous-day price) —
  // one item's full history read+processed+evicted at a time, same
  // pattern as getSignalTrend's bulk scan above. This REPLACES passing
  // the raw historyData object into run.js (main.js/bridge.js used to do
  // `runJs(argv, api.historyData)`, which needed the FULL catalogue
  // resident so run.js's own loop could compute these same summaries
  // itself) — now that historyData is a lazy, mostly-empty session cache,
  // handing it over directly would have silently reintroduced the exact
  // "historyVolAvg/historyPrevPrice went empty" bug this codebase already
  // fixed once (see run.js's fetchPrices comment). Mirrors that function's
  // exact math (single O(n) pass for latest/second-latest + a 90-day
  // volume window) so results are identical, just computed without ever
  // holding more than one item's full array in memory at once.
  // Per-item summary cache for computeHistoryStats (Ben, 2026-10-15): every
  // price fetch used to re-read ALL ~7,400 history files just to recompute
  // these few numbers. Seconds on desktop, but on the phone each read goes
  // through Capacitor's file bridge and the fetch sat behind it for minutes
  // (header stuck on "5697m ago"). A summary only changes when the item's
  // file is rewritten (invalidated in saveHistory) or as its 90-day window
  // slides, so entries also expire after 7-14 days, staggered so they don't
  // all expire on the same fetch.
  const liveHistory = createLiveHistory({ dataDir, platform });
  const historySummaryFile = path.join(dataDir, 'history_summary_cache.json');
  let historySummary = null;
  const median = arr => { const v = arr.filter(x => x !== null && x !== undefined).sort((a, b) => a - b); if (!v.length) return null; const m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : Math.floor((v[m - 1] + v[m]) / 2); };
  async function computeHistoryStats() {
    if (!historySummary) historySummary = await storage.readJSON(historySummaryFile, {}) || {};
    let summaryChanged = false;
    let newSummaries = 0;
    const historyVolAvg = {};
    const historyPrevPrice = {};
    // Ben, 2026-08-09: historyPrevPrice is a CACHED copy of an item's price
    // history — it only refreshes when something actually re-fetches that
    // item (a chart open, a backfill run), not every cycle. For an item
    // nobody's looked at in a while it can be weeks stale (confirmed for
    // real: Saradomin's hum's cache hadn't moved since June 26), in which
    // case it's a worse "yesterday" reference than the live dump's own
    // "last" field, not a better one. Tracking the latest point's own
    // timestamp per item so run.js's change_1d logic can gate on it —
    // only override the dump's field when this cache is actually recent.
    const historyPrevPriceTs = {};
    const toSec = ts => (ts && ts > 1e12 ? ts / 1000 : ts);
    const allIds = [...historyPopulatedIds];
    let _processedSinceYield = 0;
    const YIELD_BATCH = 25;
    const cutoff90dSec = Date.now() / 1000 - 90 * 86400;
    for (const itemId of allIds) {
      const key = String(itemId);
      let sum = historySummary[key];
      if (!sum || sum.exp < Date.now()) {
        const points = await getHistoryPoints(itemId);
        evictHistory(itemId);
        if (++_processedSinceYield >= YIELD_BATCH) {
          _processedSinceYield = 0;
          await new Promise(res => setTimeout(res, 0));
        }
        sum = summarizeHistory(points);
        historySummary[key] = sum;
        summaryChanged = true;
        // Save progress every 500 so a phone that closes GEnius mid-pass
        // doesn't lose the whole first run.
        if (++newSummaries % 500 === 0) { try { await storage.writeJSON(historySummaryFile, historySummary); } catch {} }
      }
      applySummary(key, sum, cutoff90dSec);
    }
    if (summaryChanged) { try { await storage.writeJSON(historySummaryFile, historySummary); } catch {} }
    return { historyVolAvg, historyPrevPrice, historyPrevPriceTs, historyFirstTs: { ...historyFirstTs } };

    function applySummary(key, sum, cutoff90d) {
      if (!sum || !sum.n) return;
      if (sum.earliest) historyFirstTs[key] = sum.earliest;
      if (sum.n < 2) return;
      // Same volume rule as before: last-90-day history if it has 7+ points,
      // else GEnius's own daily snapshots (always current), else all history.
      let vol = sum.recentN >= 7 ? sum.recentMed : null;
      if (vol == null) {
        const snaps = (snapshotData[key] || []).filter(sp => sp.t >= cutoff90d && sp.v != null);
        if (snaps.length >= 7) vol = median(snaps.map(sp => sp.v));
      }
      if (vol == null) vol = sum.allMed;
      if (vol != null) historyVolAvg[key] = vol;
      if (sum.secondPrice) historyPrevPrice[key] = sum.secondPrice;
      if (sum.latestTs) { historyPrevPriceTs[key] = sum.latestTs; historyLatestTs[key] = sum.latestTs; }
    }
  }

  // The per-file part of computeHistoryStats, cached in historySummary.
  function summarizeHistory(points) {
    const exp = Date.now() + (7 + Math.random() * 7) * 86400000;
    if (!points || !points.length) return { exp, n: 0 };
    const toMs = ts => (ts > 1e12 ? ts : ts * 1000);
    const cutoff90d = Date.now() / 1000 - 90 * 86400;
    const toSec = ts => (ts && ts > 1e12 ? ts / 1000 : ts);
    let earliest = Infinity, latest = null, secondLatest = null;
    const recentVols = [];
    for (const p of points) {
      const ts = p.timestamp || 0;
      if (p.timestamp && p.timestamp < earliest) earliest = p.timestamp;
      if (!latest || ts > (latest.timestamp || 0)) { secondLatest = latest; latest = p; }
      else if (!secondLatest || ts > (secondLatest.timestamp || 0)) { secondLatest = p; }
      if (toSec(ts) >= cutoff90d) recentVols.push(p.volume);
    }
    return {
      exp, n: points.length,
      earliest: Number.isFinite(earliest) ? toMs(earliest) : null,
      latestTs: latest && latest.timestamp ? toMs(latest.timestamp) : null,
      secondPrice: secondLatest && secondLatest.price ? secondLatest.price : null,
      recentN: recentVols.length, recentMed: median(recentVols),
      allMed: median(points.map(p => p.volume)),
    };
  }


  async function saveHistory() {
    // Only writes items actually touched since the last save — never the
    // whole dataset. Each per-item file is small (at most a few hundred KB
    // even for an item with 6000+ price points), so this can never hit the
    // string-length ceiling that the old single-file approach eventually did.
    if (dirtyHistoryIds.size === 0) return;
    // These items' history changed, so their computeHistoryStats summaries are stale.
    if (!historySummary) historySummary = await storage.readJSON(historySummaryFile, {}) || {};
    for (const id of dirtyHistoryIds) delete historySummary[String(id)];
    if (!readOnlyHistory) { try { await storage.writeJSON(historySummaryFile, historySummary); } catch {} }
    if (readOnlyHistory) { dirtyHistoryIds.clear(); return; } // test mode: keep in memory only
    const toSave = [...dirtyHistoryIds];
    dirtyHistoryIds.clear();
    await Promise.all(toSave.map(async id => {
      if (!historyData[id]) return; // nothing in memory to write (shouldn't happen now, but never retry-loop on it)
      try {
        await storage.writeDirItem(historyDir, id, historyData[id]);
        historyPopulatedIds.add(String(id));
        // Evict from the live session cache once it's confirmed safely on
        // disk — this is the other half of the lazy-load fix (see
        // historyData's own comment): during a full-catalogue backfill,
        // NOT doing this meant every single fetched item stayed resident
        // forever, so memory grew linearly with how far the backfill got
        // regardless of concurrency. getHistoryPoints() transparently
        // re-reads from disk if something needs this item again later
        // (a chart open, a re-scan) — itemHistoryCache (a separate, much
        // smaller cache) still covers the "just opened this item's chart"
        // fast path independently of this eviction.
        delete historyData[id];
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
        if (res.status === 429) {
          // Real rate limiting from WeirdGloop — confirmed for real (Ben,
          // 2026-08-03) once a full sustained backfill finally ran long
          // enough to actually reach it (every earlier attempt crashed
          // from client-side memory pressure well before this point, so
          // "no 429s ever seen" wasn't actually evidence the API had no
          // limit — it just meant we'd never run long enough to find it).
          // Previously this failed instantly with zero backoff, so
          // fetchHistoryForItem's own immediate retry (and every other
          // concurrent worker's very next 400ms-paced request) just
          // hammered the same already-struggling endpoint again right
          // away. A real pause here is the actual fix — self-throttles
          // the whole run's aggregate request rate under sustained
          // rate-limiting instead of concurrency tuning alone.
          await new Promise(r => setTimeout(r, 4000));
        }
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
          // athCache used to be eagerly built here too — a full duplicate
          // copy of the SAME points array (just remapped field names) held
          // in memory for every single item, whether its ATH/ATL chart is
          // ever actually opened or not. getItemTimeseries() already
          // builds this lazily from historyData on first real access (see
          // its own cold-cache branch below), so during a full ~7000+ item
          // backfill this was roughly DOUBLING peak memory for no benefit
          // — a real contributor to the repeated V8 "heap limit" OOM
          // crashes on Android's WebView (2026-08-02) that simply
          // ratcheting HISTORY_FETCH_CONCURRENCY down kept not fully
          // fixing. Removed; athCache still gets populated same as
          // always, just on-demand instead of speculatively for every
          // item up front.
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

  // Concurrent workers instead of one sequential fetch — each worker still
  // paces itself at the same ~2.5/sec (400ms) the original single-threaded
  // loop used, so per-connection request rate against WeirdGloop is
  // unchanged; running HISTORY_FETCH_CONCURRENCY of them at once just
  // overlaps their network wait time instead of one request blocking the
  // next. Ben asked to speed up the ~20-45 min full-catalogue backfill
  // (2026-08-02, mobile testing) — real wall-clock improvement without
  // touching the actual per-connection pacing, which is the safer lever
  // than just shortening the 400ms delay itself (that number was chosen
  // as "well under limit" without ever pinning down the real ceiling, so
  // multiplying request RATE felt riskier than multiplying request
  // COUNT-in-flight).
  //
  // Ben explicitly asked to push this from an initial 4 up to 12, same
  // session. That produced two genuine V8 "Ineffective mark-compacts near
  // heap limit" OOM crashes on Android's WebView mid-backfill (confirmed
  // via adb logcat both times) — the first coincided with also changing
  // the UI scale setting mid-backfill (which forces a full app re-render;
  // buildCSS() isn't memoized, reruns from scratch every render), but the
  // second happened with no settings change at all, meaning 12 concurrent
  // full multi-year history payloads in flight was genuinely too much for
  // the WebView's V8 heap on its own during a full ~7000+ item backfill
  // at the time. Ratcheted down to 10, then 8 chasing repeat crashes on
  // the `kidsart` emulator AVD — but also found and fixed a real
  // contributor along the way: fetchHistoryForItemOnce was eagerly
  // duplicating every item's full history into athCache on top of
  // historyData (see that function's own comment), roughly doubling peak
  // memory for no reason. Separately, the emulator's own AVD config
  // turned out to be quite constrained (hw.ramSize 2048MB, vm.heapSize
  // 228MB) — bumped to 4096MB/512MB (2026-08-02) since Ben's actual
  // Pixel 8 Pro had never shown this crash at all, strongly suggesting
  // the emulator's low default allocation (not a fundamental app problem)
  // was the real ceiling. Retested at 12 with BOTH real fixes in place
  // (memory dedup + 4096MB/512MB emulator RAM) — crashed again, same V8
  // OOM shape, right after a burst of ~25 items hitting their 17s
  // fetchHistoryForItemOnce backstop almost simultaneously (consistent
  // with the JS main thread stalling hard from GC pressure right as
  // memory peaked). So 12 is genuinely too high for this environment even
  // WITH both fixes — not purely an emulator-RAM artifact after all. Tried
  // 10 as a middle ground next — also crashed, same shape, after running
  // fine for several minutes first each time (this isn't an immediate
  // failure at either number, it's a slow accumulation that finally tips
  // over). Settled on 8 as the confirmed-stable value. Desktop has never
  // shown any of this at any concurrency level tried (Node's heap has far
  // more headroom regardless). Worth watching the console for repeated
  // "[history] HTTP 429" (rate limit) or another V8 OOM if 8 ever crashes
  // too — that would mean the real fix is reducing per-item memory
  // footprint further, not concurrency at all.
  // Ben, 2026-08-09: 8 was settled on chasing MOBILE-specific crashes (see
  // the investigation above) — desktop itself never showed any memory
  // ceiling at any concurrency tested, so it doesn't need to stay this
  // conservative. Bumped desktop to 12; mobile stays at the
  // confirmed-stable 8.
  const HISTORY_FETCH_CONCURRENCY = platform === 'mobile' ? 8 : 12;

  async function runHistoryQueue(onProgress) {
    if (historyFetchActive) return;
    historyFetchActive = true;
    historyFetchStop = false;
    let done = 0;
    const total = historyFetchQueue.length;
    let failedIds = [];

    async function worker() {
      while (historyFetchQueue.length > 0 && !historyFetchStop) {
        const id = historyFetchQueue.shift();
        if (id === undefined) break; // another worker just took the last one
        if (historyPopulatedIds.has(String(id))) {
          // Already have it (loaded from disk on a previous session, most
          // items on an established install) — still report progress so
          // the renderer's populatedHistoryIds stays in sync. Previously
          // this `continue`d silently, so on an install where most items
          // were already fetched, onProgress could go the entire queue
          // without firing even once — leaving the renderer's populated-
          // ids snapshot stuck at whatever it captured right after
          // get-data (often taken before loadHistory()'s disk read had
          // even finished), wrongly showing "price history still loading"
          // for items that had been fully loaded the whole time.
          // Confirmed for real: Gold Bar, which has 2011-2024 history on
          // disk, still showed the message.
          done++;
          if (onProgress) onProgress(done, total);
          continue;
        }
        const ok = await fetchHistoryForItem(id);
        if (!ok) failedIds.push(id);
        done++;
        if (!historyInitial300Done && historyPopulatedIds.size >= 300) {
          historyInitial300Done = true;
          store.set('historyInitial300Done', true);
        }
        if (onProgress) onProgress(done, total);
        if (done % 20 === 0) await saveHistory();
        await new Promise(r => setTimeout(r, 400)); // ~2.5/sec PER WORKER, same pacing as before concurrency was added
      }
    }

    await Promise.all(Array.from({length: HISTORY_FETCH_CONCURRENCY}, worker));

    // In-session retry for items that failed via fetchHistoryForItemOnce's
    // hard backstop — confirmed for real (Ben, 2026-08-03) that these
    // failures land in one tight burst right near the end of a big
    // backfill (a main-thread GC stall causing a pile of already-running
    // timers to all expire together, not a hard per-item failure), and
    // previously just sat unfetched until the NEXT app launch re-ran the
    // whole "trigger history population if needed" check — meaning a full
    // catalogue backfill routinely needed 2-3 manual kill-and-reopen
    // cycles to actually finish (confirmed on a real Motorola Edge 5G UW:
    // pass 1 got 4,427/7,308, pass 2 needed a restart to pick up the
    // rest). Retrying automatically here, once the main queue has fully
    // drained (so total in-memory history has stopped growing and
    // whatever GC pressure caused the stall has had a chance to ease),
    // catches the vast majority in the same sitting.
    //
    // Still calls onProgress on every attempt, even though `done`/`total`
    // themselves don't move any further here (these items were already
    // counted as "done" from the main pass) — confirmed for real (Ben,
    // 2026-08-03) that skipping this made the renderer's "Building
    // history" popup visibly freeze for the whole retry phase, which with
    // real HTTP 429 backoff (4s per hit) plus this being where most of
    // the backstop failures land, could be a genuinely long silent
    // stretch. startHistoryPopulation's wrapper recomputes
    // stored: historyPopulatedIds.size fresh on every call regardless of
    // whether done/total changed, so calling it here still gets real,
    // live progress ticks to the UI as retries actually succeed.
    async function retryWorker() {
      while (historyFetchQueue.length > 0 && !historyFetchStop) {
        const id = historyFetchQueue.shift();
        if (id === undefined) break;
        const ok = await fetchHistoryForItem(id);
        if (!ok) failedIds.push(id);
        if (onProgress) onProgress(done, total);
        await new Promise(r => setTimeout(r, 400));
      }
    }
    for (let attempt = 0; attempt < 2 && failedIds.length && !historyFetchStop; attempt++) {
      historyFetchQueue = failedIds;
      failedIds = [];
      await Promise.all(Array.from({length: HISTORY_FETCH_CONCURRENCY}, retryWorker));
    }

    await saveHistory();
    historyFetchActive = false;
    if (failedIds.length) {
      const m = store.get('historyUnavailable', {}) || {}, now = Date.now();
      for (const id of failedIds) m[String(id)] = now;
      for (const [id, t] of Object.entries(m)) if (now - t >= HISTORY_UNAVAILABLE_TTL) delete m[id];
      store.set('historyUnavailable', m);
    }
    if (onProgress) onProgress(done, total, true);
    console.log(`[history] Queue complete. ${historyPopulatedIds.size} items stored.`
      + (failedIds.length ? ` ${failedIds.length} still unfetched after retries.` : ''));
  }

  async function getHistoryStatus() {
    await historyLoadedPromise;
    return {
      stored: historyPopulatedIds.size,
      queued: historyFetchQueue.length,
      active: historyFetchActive,
      isFirstRun: historyPopulatedIds.size === 0,
      unavailable: recentUnavailable().size,
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
    return [...historyPopulatedIds].map(Number);
  }

  async function getItemHistoryLocal(itemId) {
    return getHistoryPoints(itemId);
  }

  // `onProgress` is the caller's hook for relaying progress to the UI
  // (notifyRenderer on desktop) — kept as a callback parameter rather than
  // an event emitter so this stays dependency-free.
  async function startHistoryPopulation(itemIds, onProgress) {
    await historyLoadedPromise;
    // Queued ids end up as history/<id>.json filenames, so only real GE
    // item ids (positive integers) are accepted — defense-in-depth from the
    // 2026-10-02 audit; a string like "../x" can never reach a file path.
    const validIds = (Array.isArray(itemIds) ? itemIds : [])
      .filter(id => Number.isInteger(Number(id)) && Number(id) > 0);
    const skip = recentUnavailable();
    const newIds = validIds.filter(id => !historyPopulatedIds.has(String(id)) && !skip.has(String(id)));
    historyFetchQueue = [...new Set([...historyFetchQueue, ...newIds])];
    console.log(`[history] Queue set: ${historyFetchQueue.length} items to fetch`);

    // Progress counts only THIS list's items (FIX 2026-10-11): the raw
    // file count includes items no longer on the GE, so on Ben's desktop
    // 7,412 files ≥ 7,360 items read as "complete" while 33 new Havenhythe
    // II items had no history at all and were never fetched.
    const target = validIds.map(String);
    const storedOfTarget = () => { let k = 0; for (const id of target) if (historyPopulatedIds.has(id)) k++; return k; };
    const skipN = target.filter(id => skip.has(id)).length;
    runHistoryQueue((done, total, finished) => {
      onProgress && onProgress({
        done, total, finished: !!finished, unavailable: skipN + (finished ? target.filter(id => !historyPopulatedIds.has(id) && !skip.has(id)).length : 0),
        stored: storedOfTarget(),
        queueRemaining: historyFetchQueue.length,
        initial300Done: historyInitial300Done,
      });
    });

    return { queued: historyFetchQueue.length, total: validIds.length, stored: storedOfTarget(), unavailable: skipN };
  }

  // Rolling background refresh (Ben, 2026-10-06). The regular price fetch
  // never touched per-item history files — only opening a chart (8+ days
  // stale) or the one-time backfill did — so ~7,400 of 7,410 files had
  // been frozen since June. After each price fetch this re-downloads up to
  // `maxItems` of the most out-of-date histories, one at a time at the
  // same ~2.5/sec pace the backfill uses per connection (sequential, never
  // concurrent — concurrency is what hit WeirdGloop's 429s in August).
  // WeirdGloop's history trails by about a day, so only items whose latest
  // point is 2+ days old count as stale — steady state is a small trickle.
  const HISTORY_REFRESH_STALE_MS = 2 * 86400000;
  // Incremental refresh: an item whose saved history is less than ~80 days
  // behind only needs WeirdGloop's last-90-days endpoint (~6 KB) merged onto
  // its file, not the full multi-year history (~200+ KB) re-downloaded.
  // Full downloads are only for items further behind than that window.
  const HISTORY_INCREMENTAL_MAX_MS = 80 * 86400000;
  async function fetchRecentHistory(itemId) {
    const id = String(itemId);
    let res;
    try {
      res = await fetch(`https://api.weirdgloop.org/exchange/history/rs/last90d?id=${id}`, {
        headers: { 'User-Agent': 'GEnius/1.3 (github.com/VonDerThWood/GE-Intelligence)' },
        signal: AbortSignal.timeout(12000),
      });
    } catch { return false; }
    if (!res.ok) {
      if (res.status === 429) await new Promise(r => setTimeout(r, 4000));
      return false;
    }
    let recent;
    try { recent = (await res.json())[id] || []; } catch { return false; }
    const existing = await getHistoryPoints(id);
    if (!existing || !existing.length) return false;
    const lastTs = existing.reduce((m, p) => Math.max(m, p.timestamp || 0), 0);
    const newer = recent.filter(p => p.price && (p.timestamp || 0) > lastTs)
      .map(p => ({ timestamp: p.timestamp, price: p.price, volume: p.volume || 0 }));
    if (newer.length) {
      historyData[id] = [...existing, ...newer];
      dirtyHistoryIds.add(String(id));
      historyVersion++;
    }
    return true;
  }
  async function refreshStaleHistory(maxItems = 500) {
    if (readOnlyHistory) return { refreshed: 0, skipped: 'read-only' };
    if (historyRefreshActive || historyFetchActive) return { refreshed: 0, skipped: 'busy' };
    historyRefreshActive = true;
    let refreshed = 0;
    try {
      await historyLoadedPromise;
      const now = Date.now();
      const stale = [...historyPopulatedIds]
        .filter(id => /^\d+$/.test(id) && (historyLatestTs[id] || 0) < now - HISTORY_REFRESH_STALE_MS
          && (historyRefreshAttempt[id] || 0) < now - 12 * 3600000)
        .sort((a, b) => (historyLatestTs[a] || 0) - (historyLatestTs[b] || 0))
        .slice(0, maxItems);
      for (const id of stale) {
        if (historyFetchActive) break; // a user-started backfill takes priority
        historyRefreshAttempt[id] = Date.now();
        const incremental = (historyLatestTs[id] || 0) > now - HISTORY_INCREMENTAL_MAX_MS;
        if (await (incremental ? fetchRecentHistory(id) : fetchHistoryForItemOnce(id, 12000))) {
          const pts = historyData[id];
          if (pts && pts.length) {
            const last = pts.reduce((m, p) => Math.max(m, p.timestamp || 0), 0);
            historyLatestTs[id] = last > 1e12 ? last : last * 1000;
          }
          itemHistoryCache.delete(Number(id));
          itemHistoryCache.delete(id);
          refreshed++;
        }
        if (refreshed && refreshed % 25 === 0) await saveHistory();
        await new Promise(r => setTimeout(r, 400));
      }
      await saveHistory();
      if (stale.length) console.log(`[history] Background refresh: ${refreshed}/${stale.length} stale items updated`);
    } catch (e) {
      console.error('[history] Background refresh failed:', e.message);
    } finally {
      historyRefreshActive = false;
    }
    return { refreshed };
  }

  async function stopHistoryPopulation() {
    historyFetchStop = true;
    return { success: true };
  }

  async function getItemHistory(itemId) {
    // Untradeable items (Invention components, combo potions — see
    // untradeable.js) never touch the Grand Exchange, so there's no
    // WeirdGloop history to fetch — every attempt would fail after two
    // full backstop timeouts (~32s) for nothing. Their only real chart
    // data is GEnius's own daily price snapshots (getPriceSnapshots),
    // which the renderer already merges in separately.
    if (String(itemId).startsWith('untradeable_')) return null;
    if (itemHistoryCache.has(itemId)) return itemHistoryCache.get(itemId);

    const existing = await getHistoryPoints(itemId);
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
    const result = await getHistoryPoints(itemId);
    if (result) {
      itemHistoryCache.set(itemId, result);
      await saveHistory();
    }
    return result;
  }

  async function getItemTimeseries(itemId) {
    const key = String(itemId);
    // Same reasoning as getItemHistory above — no WeirdGloop all-time
    // series can ever exist for an untradeable item.
    if (key.startsWith('untradeable_')) return null;
    const hist = await getHistoryPoints(itemId);
    if (athCache[key]) {
      // Used to be treated as permanently complete once built, so any
      // daily price point added by the regular fetch cycle AFTER an item
      // was first cached here never made it in — All-Time Low/High could
      // silently go stale indefinitely. Confirmed for real (Ben,
      // 2026-08-02): Dragon bones' cache hadn't been touched since June
      // 16, missing a genuine new all-time low set on July 27 — the app
      // then displayed a LATER, higher price as "new all-time low"
      // simply because it beat that stale (too-high) cached minimum.
      // Merges in anything historyData has gained since, keyed off
      // timestamp so this only ever appends, never rewrites history.
      if (hist && hist.length) {
        const cached = athCache[key].data;
        const lastCachedTs = cached.length ? cached[cached.length - 1].timestamp : 0;
        const newer = hist.filter(p => p.timestamp > lastCachedTs);
        if (newer.length) {
          athCache[key] = { data: [...cached, ...newer.map(p => ({timestamp:p.timestamp, high:p.price||p.high, low:p.price||p.low, volume:p.volume||0}))] };
          try { await storage.writeJSON(athCacheFile, athCache); } catch {}
        }
      }
      return athCache[key].data;
    }
    if (hist && hist.length) {
      const data = hist.map(p => ({timestamp:p.timestamp, high:p.price||p.high, low:p.price||p.low, volume:p.volume||0}));
      athCache[key] = { data };
      return data;
    }
    // First open of an item with no local history: fetch it, then build
    // the series from what the fetch just stored (fetchHistoryForItem
    // fills historyData but never athCache itself).
    await fetchHistoryForItem(itemId);
    const fetched = historyData[key];
    if (fetched && fetched.length) {
      const data = fetched.map(p => ({timestamp:p.timestamp, high:p.price||p.high, low:p.price||p.low, volume:p.volume||0}));
      athCache[key] = { data };
      return data;
    }
    return null;
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
  const ALMANAC_STATS_SINCE = '2023-06-01';
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
        // This used to call getDxpIntelligence() without forceFresh, which
        // just returned the cache set above — the "background recompute"
        // never ran and the Almanac only updated on a manual Refresh (found
        // 2026-10-07: file still dated June 29). Now: recompute if the last
        // real one is over a day old.
        maybeRefreshAlmanac().catch(() => {});
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
        // Price statistics use only DXPs since mid-2023 — the window Ben's
        // Almanac research was verified on (dxp_findings_v2.md: 10, then 11
        // events). The full list back to 2017 exists for predicting WHEN the
        // next DXP lands; the 2017-2022 market behaved too differently to mix
        // into per-item price patterns (Ben, 2026-10-07). New DXPs are
        // included automatically as they happen.
        // Finished DXPs only, once each: the running one has no result yet, and
        // re-announced dates were being counted twice (found 2026-11-04).
        const todayStr = new Date().toISOString().slice(0, 10);
        const events = uniqueEvents((await loadEvents(dataDir)).filter(e => e[1] >= ALMANAC_STATS_SINCE && e[2] < todayStr));
        // Confirmed for real on a Pixel 8 Pro (2026-06-29): this single call
        // took 146.7s on-device vs 7.8s on a desktop dev machine for the
        // identical computation/dataset — see computeDxpData's BATCH comment
        // in dxp_intelligence.js for the yield-granularity fix that came out
        // of this measurement. The gap is real mobile JS engine cost, not
        // something this disk-serve/background-refresh strategy can hide —
        // it only keeps the Almanac tab itself from blocking on it.
        const out = await computeDxpData(
          [...historyPopulatedIds],
          async id => { const p = await getHistoryPoints(id); evictHistory(id); return p; },
          itemLimits, itemNames, true, events
        );
        await storage.writeJSON(path.join(dataDir, 'dxp_intelligence.json'), out);
        dxpIntelCache = { historyVersion, data: out };
        dxpIntelComputedAt = Date.now();
        store.set('dxpIntelComputedAt', dxpIntelComputedAt);
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
    // Every item's history, one at a time via getHistoryPoints — evicted
    // again immediately after reading (this function only needs to LOOK
    // at each item's points once to tally signal counts, not hold all
    // ~7000 of them resident simultaneously, which would recreate the
    // exact memory problem the lazy-load rework above exists to avoid).
    const allIds = [...historyPopulatedIds];
    const BATCH = 40;
    for (let b = 0; b < allIds.length; b += BATCH) {
      for (const itemId of allIds.slice(b, b + BATCH)) {
        const points = await getHistoryPoints(itemId);
        evictHistory(itemId);
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
    const points = await getHistoryPoints(itemId);
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

  // ─── Real-time Top Movers (GEnius's own version of Jagex's GE Top 100
  // Rises/Falls, using live buy/sell as the "now" endpoint instead of
  // Jagex's own slow-updating, percentage-capped official price) ─────────
  const MOVERS_WINDOWS = [7, 30, 90, 180];
  let moversCache = null;     // { historyVersion, startPrices: {7:{id:{price,ts}}, 30:{...}, ...} }
  let moversInFlight = null;  // shared in-flight Promise, same dedup pattern as getSignalTrend

  // One batched pass over every item's history (same evict-as-you-go
  // pattern as computeSignalTrend) finds, for each of the 4 windows, the
  // closest-at-or-before-target-date price — the "start" side of the %
  // change. The "now" side is deliberately NOT read from history here;
  // getRealTimeMovers combines this against each item's live buy/sell at
  // call time instead, so the comparison is always as fresh as the last
  // price fetch, not as stale as the last history point.
  async function computeMoversStartPrices() {
    await historyLoadedPromise;
    const toMs = ts => (ts && ts < 1e11 ? ts * 1000 : ts);
    const now = Date.now();
    const targets = {};
    for (const d of MOVERS_WINDOWS) targets[d] = now - d * 86400000;
    const startPrices = {};
    for (const d of MOVERS_WINDOWS) startPrices[d] = {};

    const allIds = [...historyPopulatedIds];
    const BATCH = 40;
    for (let b = 0; b < allIds.length; b += BATCH) {
      for (const itemId of allIds.slice(b, b + BATCH)) {
        const points = await getHistoryPoints(itemId);
        evictHistory(itemId);
        if (!points || points.length < 2) continue;
        const sorted = [...points].sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp));
        for (const d of MOVERS_WINDOWS) {
          const targetMs = targets[d];
          let ref = null;
          for (const p of sorted) {
            if (toMs(p.timestamp) <= targetMs) ref = p; else break;
          }
          if (ref && ref.price) startPrices[d][itemId] = { price: ref.price, ts: toMs(ref.timestamp) };
        }
      }
      await new Promise(res => setTimeout(res, 0));
    }
    return startPrices;
  }

  // Same liquidity/price floors as Flips (FLIP_MIN_SELL_PRICE/FLIP_MIN_VOLUME
  // in renderer.js) — this is the exact same class of problem (a trivial
  // price move on a barely-traded item dominating a ranked list) that those
  // floors were built to solve, so reusing the already-vetted numbers
  // rather than picking new ones.
  const MOVERS_MIN_PRICE = 100;
  const MOVERS_MIN_VOLUME = 50;
  // Same fluke/isolated-print guards as Flips (FLIP_MAX_BUY_SELL_RATIO,
  // FLIP_SANITY_LOW in renderer.js) — caught for real building this:
  // Fungal spore soup's liveBuy was 62,500gp (a single stale instant-buy
  // fill from months back, still being reported as "live" because nobody's
  // matched it since) against a GE price of 13gp and a liveSell of 1,006gp
  // — a 62x buy/sell spread that isn't a real two-sided market, and would
  // have shown as a fake +480,000% mover without this.
  const MOVERS_MAX_BUY_SELL_RATIO = 5;
  const MOVERS_SANITY_LOW = 0.5;
  // The ratio check alone still let Fish and chips through — liveBuy
  // 15,000gp vs liveSell 3,001gp is a 4.998x ratio (just under the 5x
  // cutoff above) despite BOTH sides being wildly divorced from the
  // item's real 55gp GE price. A live price this far from the item's own
  // established value, in EITHER direction, isn't something to trust
  // regardless of what the other live side says — capped independently.
  const MOVERS_SANITY_HIGH = 5;

  async function getRealTimeMovers(windowDays) {
    const win = MOVERS_WINDOWS.includes(windowDays) ? windowDays : 7;
    const { items } = await getData();
    if (!moversCache || moversCache.historyVersion !== historyVersion) {
      if (!moversInFlight) {
        const usedHistoryVersion = historyVersion;
        moversInFlight = computeMoversStartPrices().then(startPrices => {
          moversCache = { historyVersion: usedHistoryVersion, startPrices };
          moversInFlight = null;
          return startPrices;
        });
      }
      await moversInFlight;
    }
    const startPrices = moversCache.startPrices[win] || {};
    const rows = [];
    for (const it of (items || [])) {
      if (it.untradeable || !it.id) continue;
      const gePrice = it.high || it.low || 0;
      if (it.liveBuy != null && it.liveSell > 0 && (it.liveBuy / it.liveSell) > MOVERS_MAX_BUY_SELL_RATIO) continue;
      if (gePrice > 0 && it.liveSell != null && it.liveSell < gePrice * MOVERS_SANITY_LOW) continue;
      const cur = it.liveBuy ?? it.liveSell ?? gePrice;
      if (gePrice > 0 && (cur < gePrice * MOVERS_SANITY_LOW || cur > gePrice * MOVERS_SANITY_HIGH)) continue;
      if (!cur || cur < MOVERS_MIN_PRICE) continue;
      if ((it.volume || 0) < MOVERS_MIN_VOLUME) continue;
      const ref = startPrices[it.id];
      if (!ref || !ref.price) continue;
      const pct = ((cur - ref.price) / ref.price) * 100;
      if (!isFinite(pct)) continue;
      rows.push({ id: it.id, name: it.name, startPrice: ref.price, currentPrice: cur, pct });
    }
    const rises = [...rows].sort((a, b) => b.pct - a.pct).slice(0, 100);
    const falls = [...rows].sort((a, b) => a.pct - b.pct).slice(0, 100);
    return { rises, falls, windowDays: win };
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

  // ─── Opportunity History ──────────────────────────────────────────────────
  // (Ben, 2026-10-06) Grades the Opportunity Score against what actually
  // happened next. After every price fetch, any item scoring at or above
  // OPP_RECORD_MIN is recorded (at most once per item per 24h, so a score
  // that stays high all day is one flag, not 96). Outcomes are NOT stored —
  // they're computed on read from the daily price snapshots (90-day
  // retention, which covers the 30-day window), so a record never goes
  // stale or needs patching later. The score itself is direction-blind (a
  // crash scores like a spike), so each record also keeps which way the
  // item was moving when flagged.
  const OPP_RECORD_MIN = 40;
  const OPP_REFLAG_MS = 24 * 3600 * 1000;
  const OPP_KEEP_MS = 120 * 24 * 3600 * 1000;

  async function recordOpportunities() {
    try {
      const parsed = await storage.readJSON(dataFile, null);
      const items = parsed?.items || [];
      if (!items.length) return;
      const hist = await storage.readJSON(oppHistoryFile, { records: [] });
      const now = Date.now();
      const lastById = {};
      for (const r of hist.records) lastById[r.id] = Math.max(lastById[r.id] || 0, r.t);
      let added = 0;
      for (const it of items) {
        if (it.untradeable || !it.id || !(it.score >= OPP_RECORD_MIN)) continue;
        const price = it.high || it.low;
        if (!price) continue;
        if (lastById[it.id] && now - lastById[it.id] < OPP_REFLAG_MS) continue;
        hist.records.push({ t: now, id: it.id, n: it.name, s: it.score, p: price,
          c: it.change_1d ?? null, g: (it.signals || []).filter(x => x !== 'ACTIVE' && x !== 'QUIET') });
        added++;
      }
      const before = hist.records.length;
      hist.records = hist.records.filter(r => now - r.t < OPP_KEEP_MS);
      if (!hist.since) hist.since = now;
      if (added || hist.records.length !== before) await storage.writeJSON(oppHistoryFile, hist);
    } catch (e) { console.error('[opportunity history] Error:', e.message); }
  }

  // Price on (or soonest after) a target time, from the daily snapshots.
  // Returns null while the target is still in the future.
  function snapshotPriceAt(itemId, targetMs) {
    if (targetMs > Date.now()) return null;
    const pts = snapshotData[String(itemId)];
    if (!pts || !pts.length) return null;
    const targetS = targetMs / 1000;
    let best = null;
    for (const pt of pts) if (pt.t >= targetS && (!best || pt.t < best.t)) best = pt;
    // A snapshot more than 2 days late isn't really "price after N days".
    return best && best.t - targetS < 2 * 86400 ? best.p : null;
  }

  async function getOpportunityHistory() {
    const hist = await storage.readJSON(oppHistoryFile, { records: [] });
    const DAY = 86400000;
    const records = hist.records.map(r => ({
      ...r,
      d1:  snapshotPriceAt(r.id, r.t + DAY),
      d7:  snapshotPriceAt(r.id, r.t + 7 * DAY),
      d30: snapshotPriceAt(r.id, r.t + 30 * DAY),
    }));
    return { since: hist.since || null, recordMin: OPP_RECORD_MIN, records };
  }

  // ─── Event Impact ─────────────────────────────────────────────────────────
  // (Ben, 2026-10-06) Game updates as timelines of milestones — roadmap
  // mention, dev blog, date announced, release — measured against each
  // affected item's price, Almanac-style: before the first milestone,
  // between each pair of milestones, release day, week after, month after.
  // Each phase is shown next to how the whole market moved over the same
  // window, so a market-wide move isn't credited to the update.
  //
  // News only kept the latest ~15 posts, so every post is now also saved to
  // news_archive.json permanently — future roadmap mentions are never lost.
  const EVENT_MILESTONE_TYPES = ['roadmap', 'devblog', 'date_announced', 'release', 'other'];
  // Event type decides what gets watched automatically (Ben, 2026-10-06):
  // any boss release should flag PVM supplies; skilling updates watch the
  // categories picked for them; quests pull their wiki item lists.
  const EVENT_TYPES = ['boss', 'skilling', 'quest', 'area', 'other'];
  const BOSS_CATEGORIES = ['supplies', 'ammo', 'runes'];

  async function archiveNews() {
    try {
      const parsed = await storage.readJSON(dataFile, null);
      const news = parsed?.news || [];
      if (!news.length) return;
      const arch = await storage.readJSON(newsArchiveFile, { posts: {}, dismissed: [] });
      let added = 0;
      const fresh = [];
      for (const n of news) {
        if (!n.url || arch.posts[n.url]) continue;
        fresh.push(n);
        arch.posts[n.url] = { title: n.title, url: n.url, date: n.date, source: n.source,
          description: (n.description || '').slice(0, 600), mentions: n.mentions || [], saved_at: Date.now() };
        added++;
      }
      if (added) await storage.writeJSON(newsArchiveFile, arch);
      for (const n of fresh) {
        const page = await fetchNewsPage(n.url);
        await detectDxpNews(n, page?.text);
        if (page) await addToCalendar(n, page.lines);
      }
      // One-time re-scan (2026-10-22): the DXP watcher used to read only
      // titles/summaries and missed "DoubleXP", so recent archived posts get
      // one more look with the fixed detector.
      if (!store.get('dxpRescan_2026_10')) {
        const recent = Object.values(arch.posts).filter(p => p.date && Date.now() - new Date(p.date + 'T12:00:00') <= 60 * 86400000);
        for (const p of recent) await detectDxpNews(p).catch(() => {});
        store.set('dxpRescan_2026_10', true);
      }
      await backfillCalendar(arch);
    } catch (e) { console.error('[news archive] Error:', e.message); }
  }

  // ─── DXP news watcher ─────────────────────────────────────────────────────
  // (Ben, 2026-10-07) The Almanac's DXP list comes from the wiki's DXP
  // table, which only gets a row once there's a date — and DXP
  // notifications read that same list, so they could lag the official post
  // by up to a day, right when the anticipation (buy) window opens. This
  // watches every new news post: any recent one mentioning Double XP fires
  // an immediate notification, and if the post states the dates ("starts
  // Friday, August 2nd and lasts until Monday, August 12th") the DXP is
  // added to the Almanac straight away; otherwise the Almanac asks for them.
  // Jagex writes it both ways: "Double XP" and "DoubleXP" (24 Sep 2026 post).
  const DXP_MENTION = /double[ -]?xp|double experience|\bdxp\b/i;
  const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  // Reads a DXP's dates from a post, using only dates ATTACHED to a
  // "Double XP" mention — roadmap posts list many updates with their own
  // dates ("May 12th: Game Health Update * May 16th: Double XP"), so any
  // nearby date isn't good enough. Returns {start, end} (YYYY-MM-DD), or
  // {startOnly} when only the start is given (roadmap style), or null.
  //   "November 15th - 25th: Double XP"            → range before the mention
  //   "May 16th: Double XP"                        → start only
  //   "Double XP starts Friday, August 2nd and lasts until Monday,
  //    August 12th"                                → dates after the mention
  function parseDxpDates(text, postDateStr) {
    const post = new Date(postDateStr + 'T12:00:00');
    if (isNaN(post)) return null;
    const M = '(' + MONTHS.join('|') + ')';
    const D = '(\\d{1,2})(?:st|nd|rd|th)?';
    const mk = (mon, day) => {
      const mi = MONTHS.indexOf(mon);
      if (mi < 0 || !(day >= 1 && day <= 31)) return null;
      let d = new Date(post.getFullYear(), mi, day, 12);
      if (d < post - 30 * 86400000) d = new Date(post.getFullYear() + 1, mi, day, 12);
      return d;
    };
    // Announcements come weeks ahead, never most of a year, and a DXP
    // never starts the day it's announced (the page header shows the
    // post's own date).
    const okStart = d => d && d > post && d - post <= 60 * 86400000;
    const okEnd = (a, b) => b && b - a >= 2 * 86400000 && b - a <= 14 * 86400000;
    const lower = text.toLowerCase().replace(/[–—]/g, '-');
    const mention = /double[ -]?xp|double experience/g;
    let mm, startOnly = null;
    while ((mm = mention.exec(lower))) {
      const pre = lower.slice(Math.max(0, mm.index - 70), mm.index);
      const after = lower.slice(mm.index, mm.index + 320);
      // Range right before: "november 15th - 25th: " / "nov 15th - dec 2nd: "
      let r = pre.match(new RegExp(M + '\\s+' + D + '\\s*(?:-|to|until)\\s*(?:' + M + '\\s+)?' + D + '\\s*[:\\-]?\\s*$'));
      if (r) {
        const a = mk(r[1], +r[2]);
        let b = mk(r[3] || r[1], +r[4]);
        if (a && b && b < a) b = mk(MONTHS[(MONTHS.indexOf(r[1]) + 1) % 12], +r[4]);
        if (okStart(a) && okEnd(a, b)) return { start: localDateStr(a), end: localDateStr(b) };
      }
      // Single date right before: "may 16th: "
      r = pre.match(new RegExp(M + '\\s+' + D + '\\s*[:\\-]?\\s*$'));
      if (r && !startOnly) { const a = mk(r[1], +r[2]); if (okStart(a)) startOnly = localDateStr(a); }
      // Dates after the mention, in order: start = first valid, end = next
      // within 2–14 days. Also "november 15th - 25th" written after it.
      const dates = [];
      const re = new RegExp(M + '\\s+' + D + '(?:\\s*-\\s*' + D + ')?|' + D + '\\s+(?:of\\s+)?' + M, 'g');
      let m;
      while ((m = re.exec(after))) {
        if (m[1]) {
          const a = mk(m[1], +m[2]);
          if (a) dates.push(a);
          if (m[3]) { let b = mk(m[1], +m[3]); if (a && b && b < a) b = mk(MONTHS[(MONTHS.indexOf(m[1]) + 1) % 12], +m[3]); if (b) dates.push(b); }
        } else {
          const a = mk(m[5], +m[4]);
          if (a) dates.push(a);
        }
      }
      const s0 = dates.find(okStart);
      if (s0) {
        const e0 = dates.find(d => okEnd(s0, d));
        if (e0) return { start: localDateStr(s0), end: localDateStr(e0) };
        if (!startOnly) startOnly = localDateStr(s0);
      }
    }
    return startOnly ? { startOnly } : null;
  }

  // A DXP "tease" — "Double XP is coming in November!" — with no dates yet
  // (Ben, 2026-10-07). Returns the expected month as 'YYYY-MM', 'soon' when
  // the post clearly says it's coming but names no month, or null when the
  // post only mentions DXP in passing (a recap, "after DXP ends", a guide).
  function parseDxpTease(text, postDateStr) {
    const post = new Date(postDateStr + 'T12:00:00');
    const lower = text.toLowerCase();
    const mention = new RegExp(DXP_MENTION.source, 'g');
    let mm, soon = false;
    while ((mm = mention.exec(lower))) {
      const win = lower.slice(Math.max(0, mm.index - 160), mm.index + 220);
      const mon = win.match(new RegExp('\\b(' + MONTHS.join('|') + ')\\b'));
      // "will run our next DoubleXP event in November" (MTX post, 24 Sep 2026)
      // was missed: "next" / "will run" now count as coming.
      const coming = /coming|returns?\b|is back|on its way|next month|later this month|this month|get ready|prepare|upcoming|announc|\bnext\b|will run|will be running/.test(win);
      if (mon && coming) {
        const mi = MONTHS.indexOf(mon[1]);
        const year = mi >= post.getMonth() ? post.getFullYear() : post.getFullYear() + 1;
        return `${year}-${String(mi + 1).padStart(2, '0')}`;
      }
      if (coming) soon = true;
    }
    return soon ? 'soon' : null;
  }

  async function detectDxpNews(n, prefetchedText) {
    if (!n.date) return;
    const det = store.get('dxpNewsDetections', []);
    if (det.some(d => d.url === n.url)) return;
    const summary = (n.title || '') + ' ' + (n.description || '');
    // The mention can be buried in the body of a post about something else
    // (Ben, 2026-10-22: the November DXP was announced inside "What's
    // happening with MTX Items"), so check the page text too, not just the
    // title and summary.
    let pageText = prefetchedText || '';
    if (!DXP_MENTION.test(summary)) {
      if (!pageText) pageText = (await fetchNewsPage(n.url).catch(() => null))?.text || '';
      if (!DXP_MENTION.test(pageText.toLowerCase())) return;
    }
    // Fresh posts only (the first archive pass sees weeks-old ones too),
    // except a tease for a DXP that's still ahead: those are announced
    // weeks early, and missing one leaves the Almanac blind until the dates.
    const tooOld = Date.now() - new Date(n.date + 'T12:00:00') > 14 * 86400000;
    let dates = null, startOnly = null;
    try {
      if (!pageText) pageText = (await fetchNewsPage(n.url))?.text || '';
      if (pageText) {
        const pd = parseDxpDates(pageText, n.date);
        if (pd?.start) dates = [pd.start, pd.end];
        else if (pd?.startOnly) startOnly = pd.startOnly;
      }
    } catch {}
    if (tooOld) {
      const expect = !dates && !startOnly && parseDxpTease(pageText || summary, n.date);
      if (!expect || expect === 'soon' || expect < new Date().toISOString().slice(0, 7)) return;
    }
    const entry = { url: n.url, title: n.title, date: n.date, detectedAt: Date.now(), dates, status: 'mention', notified: false };
    if (dates) {
      entry.status = (await addDxpEvent([n.date, dates[0], dates[1]])).added ? 'added' : 'known';
      // Link any earlier tease of this DXP: its date is kept with the dated
      // announcement so the Almanac can later measure a "tease" phase.
      const tease = det.filter(d => d.status === 'teased' && new Date(n.date) - new Date(d.date) <= 75 * 86400000 && new Date(n.date) >= new Date(d.date))
        .sort((a, b) => a.date.localeCompare(b.date))[0];
      if (tease) {
        entry.teasedOn = tease.date;
        tease.status = 'dated';
        const teases = store.get('dxpTeases', {});
        teases[dates[0]] = tease.date;           // DXP start date -> first tease date
        store.set('dxpTeases', teases);
      }
    } else {
      const expect = startOnly || parseDxpTease(pageText || summary, n.date);
      // A DXP GEnius already knows about (e.g. a "DXP is live" post on its
      // first day) isn't news.
      const { loadEvents } = require('./dxp_intelligence.js');
      const known = expect && expect !== 'soon' && (await loadEvents(dataDir)).some(e =>
        // A date inside a known DXP (start-3d … end+3d) is that DXP.
        expect.length === 10 ? new Date(expect) >= new Date(e[1]) - 3 * 86400000 && new Date(expect) <= new Date(e[2]).getTime() + 3 * 86400000
          : e[1].slice(0, 7) === expect || e[2].slice(0, 7) === expect);
      if (known) {
        entry.notified = true; // already in the Almanac — nothing to announce
      } else if (expect) {
        entry.status = 'teased';
        entry.expected = expect;
        // Several posts often tease the same DXP — only notify for the first.
        if (det.some(d => d.status === 'teased' && d.expected === expect)) entry.notified = true;
      } else {
        entry.notified = true; // passing mention — nothing to tell Ben
      }
    }
    store.set('dxpNewsDetections', [...det, entry].slice(-30));
  }

  // ─── News calendar ───────────────────────────────────────────────────────
  // (Ben, 2026-10-07) Every dated line in the official news — roadmaps and
  // month-ahead posts are mostly "November 15 - 25: Double XP · December 9:
  // 110 Woodcutting & Fletching" — logged and categorized, so GEnius has an
  // upcoming calendar and the dates can feed the Almanac / Game Updates.
  // Dates are kept only if on/after the post's own date (the page's related-
  // posts sidebar lists older posts' dates) and within 9 months.
  async function fetchNewsPage(url) {
    if (!/^https:\/\/secure\.runescape\.com\//.test(url || '')) return null;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'GEnius/1.3 (github.com/VonDerThWood/GE-Intelligence)' }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) return null;
      const html = await res.text();
      const decode = t => t.replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"');
      const lines = decode(html.replace(/<\/(li|p|h[1-6]|div|tr)>|<br[^>]*>/gi, '\n').replace(/<[^>]*>/g, ' '))
        .split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
      return { lines, text: lines.join(' ') };
    } catch { return null; }
  }

  const CALENDAR_CATEGORIES = {
    dxp:         /double[ -]?xp|double experience|\bdxp\b/,
    marketplace: /marketplace|bundle|cosmetic|\bbonds?\b|premier|membership|\bsale\b|discount|offer|mtx|store/,
    livestream:  /livestream|stream\b|q ?& ?a|\bqa\b|runefest|twitch|youtube|podcast|panel|showcase/,
    maintenance: /maintenance|server|downtime|hotfix|patch notes|offline/,
    seasonal:    /christmas|halloween|harvest hollow|easter|blooming burrow|summer|beach|leagues|anniversary|birthday|festival|winter|spring|gamejam|game jam|village|celebrat/,
    release:     /launch|release|update|quest|boss|skill|rework|remaster|refresh|rebalance|expansion|dig site|\b1[12]0\b|out now|lands?\b|arriv|beta|part ii/,
  };
  function categorizeDate(label) {
    const l = label.toLowerCase();
    for (const [cat, re] of Object.entries(CALENDAR_CATEGORIES)) if (re.test(l)) return cat;
    return 'other';
  }

  function extractNewsDates(lines, postDateStr) {
    const post = new Date(postDateStr + 'T12:00:00');
    if (isNaN(post)) return [];
    const M = '(' + MONTHS.join('|') + '|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)';
    // A day number must not run into more digits: "November 2024" is not
    // November 20.
    const D = '(\\d{1,2})(?!\\d)(?:st|nd|rd|th)?';
    const monthIdx = m => MONTHS.findIndex(x => x.startsWith(m.slice(0, 3)));
    const mk = (mon, day) => {
      const mi = monthIdx(mon);
      if (mi < 0 || !(day >= 1 && day <= 31)) return null;
      let d = new Date(post.getFullYear(), mi, day, 12);
      if (d < post - 30 * 86400000) d = new Date(post.getFullYear() + 1, mi, day, 12);
      return d;
    };
    const re = new RegExp('\\b' + M + '\\.?\\s+' + D + '(?:\\s*(?:-|till|until|to|through|and)\\s*(?:' + M + '\\.?\\s+)?' + D + ')?(?!\\s*,?\\s*\\d{4})', 'gi');
    const WEAK = /^(begins|starts|ends|start|end|date|time|runs|from|on|until|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
    const out = [];
    let heading = '';
    for (const raw of lines) {
      const line = raw.replace(/[–—]/g, '-');
      if (/^\d{1,2} [a-z]+ \d{4}$/i.test(line.trim())) continue;     // a related post's date stamp
      if (line.length > 400) continue;
      re.lastIndex = 0;
      const hasDate = re.test(line);
      // Remember the latest short heading-like line: it names what the
      // dates under it are about ("Double XP" above "Begins Friday, Aug 2nd").
      // (Social/page chrome like "Tweet" or "Share" is never a heading.)
      if (!hasDate && line.length <= 60 && !/[.!?:,]$/.test(line) && /[a-z]/i.test(line)
          && !/^(tweet|share|like|facebook|twitter|reddit|discord|subscribe|comments?|back to top|read more|related( posts)?|hosted by.*)$/i.test(line)) { heading = line; continue; }
      if (!hasDate) continue;
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(line))) {
        const start = mk(m[1].toLowerCase(), +m[2]);
        if (!start || start < post - 86400000 || start - post > 270 * 86400000) continue;
        let end = null;
        if (m[4]) {
          end = mk((m[3] || m[1]).toLowerCase(), +m[4]);
          if (end && end < start) end = mk(MONTHS[(monthIdx(m[1].toLowerCase()) + 1) % 12], +m[4]);
          if (end && (end - start > 120 * 86400000 || end <= start)) end = null;
        }
        const before = line.slice(0, m.index).replace(/[\s:,*\-(]+$/, '').trim();
        const afterRaw = line.slice(m.index + m[0].length);
        const after = afterRaw.replace(/^[\s:,*\-).!]+/, '').trim();
        let label, kind = 'list';
        if (/^\s*[:\-]/.test(afterRaw) && after) label = after.split(/\s[*•]\s|\.\s/)[0];   // "Date: label"
        else if (before && before.length <= 70 && !/[.!?]/.test(before)) label = before;   // "label - Date"
        else {
          kind = 'prose';
          // Prose: "...Havenhythe Part II, which launches on September 28" →
          // the capitalised name right before the launch-type verb.
          const subj = before.match(/([A-Z0-9][\w:'&.\- ]{2,60}?)(?:,?\s*which)?\s+(?:launches|launch|lands|landing|releases|release|arrives|begins|starts|returns|will take place|will launch|will land|will release|is launching|goes live|drops|dropping|kicks off|comes|coming)\b[^.!?]*$/);
          label = subj ? subj[1].replace(/^(the|our|and|with)\s+/i, '').trim() : line;
        }
        label = label.replace(/\s+/g, ' ').trim();
        if (heading && (label.length < 4 || WEAK.test(label))) label = heading;
        if (label.length > 110) label = label.slice(0, 107).replace(/\s\S*$/, '') + '…';
        if (label.length < 3) continue;
        out.push({ start: localDateStr(start), end: end ? localDateStr(end) : null, label, kind, category: categorizeDate(label + ' ' + line) });
      }
    }
    // Same date + category from a headline and its paragraph: keep the
    // shorter, cleaner label (ranges beat single dates).
    const best = new Map();
    for (const e of out) {
      const k = e.start + '|' + e.category;
      const cur = best.get(k);
      if (!cur || (e.end && !cur.end) || (!!e.end === !!cur.end && e.label.length < cur.label.length)) best.set(k, e);
    }
    const vals = [...best.values()];
    // "...begin on November 15 and run until November 25" can also yield a
    // lone "November 25" entry, and a range's end can reappear on its own —
    // drop single dates that are another entry's end or fall inside one of
    // the same category.
    return vals.filter(e => e.end || !vals.some(o => o !== e && o.end && o.category === e.category && e.start >= o.start && e.start <= o.end));
  }

  // Cancelled content (Ben, 2026-10-18: Reignited was cancelled but its
  // December dates stayed on the calendar). A post saying "we have made the
  // decision to cancel Reignited" / "Reignited has been cancelled" records
  // the name; calendar dates about it from EARLIER posts are then hidden.
  // Dates in the cancellation post itself stay (they're what still happens:
  // the Reignited post kept Dec 2-12 for the Adventure Guide + free trial).
  const CANCEL_STOP = /^(we|it|this|that|the|these|those|our|they|you|plans?|everything)$/i;
  const CANCEL_NAME = "((?:RuneScape\\s+)?[A-Z][\\w'’-]+(?:\\s+[A-Z][\\w'’-]+){0,3})";
  const CANCEL_PATTERNS = [
    new RegExp("\\b(?:decision to|decided to|going to|we will|we'll|we have to|had to)\\s+cancel\\s+" + CANCEL_NAME, 'g'),
    new RegExp(CANCEL_NAME + "\\s+(?:has|have)\\s+been\\s+cancell?ed\\b", 'gi'),
    new RegExp(CANCEL_NAME + "\\s+(?:is|are)\\s+(?:being\\s+)?cancell?ed\\b", 'gi'),
  ];
  function findCancellations(lines) {
    const text = lines.join(' ').replace(/\s+/g, ' ');
    const names = new Set();
    for (const re of CANCEL_PATTERNS) for (const m of text.matchAll(re)) {
      // Drop "RuneScape"/"The"/"This"... and require a real capitalised name
      // ("This event has been cancelled" must not hide every "event").
      const name = m[1].replace(/^(?:(?:RuneScape|The|This|That|These|Those|Our)\s+)+/i, '').trim();
      if (name.length >= 3 && /^[A-Z]/.test(name) && !CANCEL_STOP.test(name)) names.add(name);
    }
    return [...names];
  }
  function recordCancellations(cal, n, lines) {
    cal.cancelled = cal.cancelled || [];
    for (const name of findCancellations(lines)) {
      if (!cal.cancelled.some(c => c.name.toLowerCase() === name.toLowerCase())) {
        cal.cancelled.push({ name, postUrl: n.url, postTitle: n.title, postDate: n.date });
      }
    }
  }

  async function addToCalendar(n, lines) {
    const cal = await storage.readJSON(calendarFile, { entries: [], processed: {} });
    if (cal.processed[n.url]) return;
    recordCancellations(cal, n, lines);
    const found = extractNewsDates(lines, n.date);
    for (const e of found) {
      if (cal.entries.some(x => x.start === e.start && x.category === e.category && x.label.toLowerCase() === e.label.toLowerCase())) continue;
      cal.entries.push({ ...e, postUrl: n.url, postTitle: n.title, postDate: n.date, addedAt: Date.now() });
    }
    cal.processed[n.url] = Date.now();
    // Keep a year of history.
    const cutoff = localDateStr(new Date(Date.now() - 365 * 86400000));
    cal.entries = cal.entries.filter(x => (x.end || x.start) >= cutoff);
    await storage.writeJSON(calendarFile, cal);
  }

  // Posts archived before the calendar existed (or whose page fetch failed)
  // get processed a few at a time, newest first, within the last 60 days.
  async function backfillCalendar(arch) {
    const cal = await storage.readJSON(calendarFile, { entries: [], processed: {} });
    // Posts processed before cancellation detection existed (once).
    if (!cal.cancelScanV1) {
      const since = localDateStr(new Date(Date.now() - 60 * 86400000));
      for (const pst of Object.values(arch.posts).filter(p => p.date >= since && cal.processed[p.url])) {
        const page = await fetchNewsPage(pst.url);
        if (page) recordCancellations(cal, pst, page.lines);
      }
      cal.cancelScanV1 = Date.now();
      await storage.writeJSON(calendarFile, cal);
    }
    const cutoff = localDateStr(new Date(Date.now() - 60 * 86400000));
    const todo = Object.values(arch.posts).filter(pst => pst.date >= cutoff && !cal.processed[pst.url])
      .sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 8);
    for (const pst of todo) {
      const page = await fetchNewsPage(pst.url);
      if (page) await addToCalendar(pst, page.lines);
    }
  }

  // List-style entries ("December 9: 110 Woodcutting & Fletching") keep
  // their own label. Dates pulled out of paragraphs give rough labels ("To
  // celebrate the") and repeat (one post said "December 2nd" four times), so
  // those are merged into one row per post + date, named after the post.
  const CAL_PRIORITY = ['dxp', 'release', 'seasonal', 'marketplace', 'livestream', 'maintenance', 'other'];
  // pastDays (Ben, 2026-10-18): the calendar's month view also shows dates
  // earlier in the month; everything else wants upcoming only (default 0).
  // ─── Almanac buy and sell flags (almanac-signals.js) ──────────────────────
  // dxp_intelligence.json is about 30 MB, so it's read at most hourly and only
  // what the flags need is kept (each phase's per-DXP list is most of the file).
  let almanacIntel = null, almanacIntelAt = 0;
  async function loadAlmanacIntel() {
    if (almanacIntel && Date.now() - almanacIntelAt < 3600000) return almanacIntel;
    const full = await storage.readJSON(path.join(dataDir, 'dxp_intelligence.json'), null);
    if (!full) return null;
    const slim = {};
    for (const [id, e] of Object.entries(full)) {
      if (id === '_meta' || !e || !e.timing) continue;
      const phases = {};
      for (const [name, p] of Object.entries(e.phases || {})) phases[name] = p && { rise: p.rise, drop: p.drop, total: p.total };
      slim[id] = { name: e.name, timing: e.timing, phases };
    }
    almanacIntel = slim;
    almanacIntelAt = Date.now();
    return slim;
  }

  // Callers close together share one result.
  let almanacSignals = null, almanacSignalsAt = 0;
  function getAlmanacSignals() {
    if (!almanacSignals || Date.now() - almanacSignalsAt > 60000) {
      almanacSignalsAt = Date.now();
      almanacSignals = computeAlmanacSignals().catch(e => { almanacSignals = null; throw e; });
    }
    return almanacSignals;
  }

  async function computeAlmanacSignals() {
    const intel = await loadAlmanacIntel();
    if (!intel) return { now: [], soon: [], nextDxp: null, lastDxp: null };
    const latest = await storage.readJSON(path.join(dataDir, 'latest.json'), {});
    const portfolio = await readPortfolio();
    const held = new Map();
    for (const p of portfolio.positions || []) {
      if (p.status !== 'open' || !(p.quantity > 0) || !p.item_name) continue;
      const k = p.item_name.toLowerCase();
      const h = held.get(k) || { name: p.item_name, quantity: 0, spent: 0 };
      h.quantity += p.quantity;
      h.spent += p.quantity * (p.cost_basis || 0);
      held.set(k, h);
    }
    const holdings = [...held.values()].map(h => ({ name: h.name, quantity: h.quantity, cost: h.spent / h.quantity }));
    const events = (await storage.readJSON(path.join(dataDir, 'dxp_events.json'), [])).filter(e => e[1] >= ALMANAC_STATS_SINCE);
    const out = computeSignals({ intel, events, items: latest.items || [], holdings,
      watched: [...store.get('watchlist', []), ...store.get('dxpWatchlist', [])] });
    // Live price check: has it already used up half its usual rise?
    const monthAgo = Date.now() - 30 * 86400000;
    for (const r of [...out.now, ...out.soon]) {
      if (r.action !== 'buy' || !r.peak || !r.liveBuy) continue;
      const points = await getHistoryPoints(r.id);
      evictHistory(r.id);
      const recent = (points || []).filter(p => p.timestamp >= monthAgo && p.price).map(p => p.price).sort((a, b) => a - b);
      if (!recent.length) continue;
      const usual = recent[Math.floor(recent.length / 2)];
      const runUp = (r.liveBuy - usual) / usual * 100;
      if (runUp >= r.peak / 2) { r.priceHigh = true; r.runUpPct = Math.round(runUp); }
    }
    return out;
  }

  // One digest for flags that are new since the last one.
  async function getAlmanacNotifications() {
    const settings = store.get('dxpNotificationSettings', { enabled: false, buyAlerts: true, sellAlerts: true });
    if (!settings.enabled) return [];
    const { now } = await getAlmanacSignals();
    const log = store.get('almanacDigestLog', {});
    const fresh = now.filter(r => !log[r.key] && (r.action === 'sell' ? settings.sellAlerts : settings.buyAlerts));
    if (!fresh.length) return [];
    const stamp = Date.now();
    for (const r of fresh) log[r.key] = stamp;
    for (const k of Object.keys(log)) if (stamp - log[k] > 120 * 86400000) delete log[k];
    store.set('almanacDigestLog', log);
    const digest = buildDigest(fresh);
    return digest ? [digest] : [];
  }

  // ─── Upcoming update risks (update-risks.js) ──────────────────────────────
  // Page text of forward-looking posts, kept so each is only downloaded once.
  const updateRiskPostsFile = path.join(dataDir, 'update_risk_posts.json');
  async function loadUpdateRiskPosts() {
    const saved = await storage.readJSON(updateRiskPostsFile, {});
    const arch = await storage.readJSON(newsArchiveFile, { posts: {} });
    const since = localDateStr(new Date(Date.now() - 60 * 86400000));
    const known = require('./data/upcoming_updates.json').updates.filter(u => u.url)
      .map(u => ({ url: u.url, title: u.title + ' preview', date: localDateStr() }));
    const candidates = [...Object.values(arch.posts).filter(p => p.date >= since && isForwardPost(p)), ...known];
    let changed = false, fetched = 0;
    for (const p of candidates) {
      if (saved[p.url] || fetched >= 5) continue;
      fetched++;
      const page = await fetchNewsPage(p.url);
      if (page) { saved[p.url] = { title: p.title, date: p.date, url: p.url, lines: page.lines }; changed = true; }
    }
    for (const [url, p] of Object.entries(saved)) if (p.date < since) { delete saved[url]; changed = true; }
    if (changed) await storage.writeJSON(updateRiskPostsFile, saved);
    return Object.values(saved);
  }

  async function getUpdateRisks() {
    const latest = await storage.readJSON(path.join(dataDir, 'latest.json'), {});
    const byName = new Map((latest.items || []).map(it => [it.name.toLowerCase(), it]));
    const price = name => {
      const it = byName.get(name.toLowerCase());
      if (!it) return 0;
      return it.liveBuy && it.liveSell ? (it.liveBuy + it.liveSell) / 2 : (it.high || 0);
    };
    const portfolio = await readPortfolio();
    const holdings = portfolio.positions.filter(p => p.status === 'open' && p.quantity > 0)
      .map(p => ({ name: p.item_name, quantity: p.quantity, value: p.quantity * price(p.item_name) }));
    const idToName = new Map((latest.items || []).map(it => [String(it.id), it.name]));
    const watched = [...store.get('watchlist', []), ...store.get('dxpWatchlist', [])].map(id => idToName.get(String(id))).filter(Boolean);
    return findRisks({ updates: require('./data/upcoming_updates.json').updates, posts: await loadUpdateRiskPosts(), holdings, watched,
      catalogue: (latest.items || []).filter(it => !it.untradeable).map(it => it.name), dismissed: store.get('updateRiskDismissed', []) });
  }
  async function dismissUpdateRisk(key) {
    store.set('updateRiskDismissed', [...new Set([...store.get('updateRiskDismissed', []), key])]);
  }
  function getUpdateRiskSettings() {
    return { enabled: true, includeWatched: true, ...store.get('updateRiskSettings', {}) };
  }
  async function setUpdateRiskSettings(s) { store.set('updateRiskSettings', s); }
  async function getUpdateRiskNotifications() {
    const settings = getUpdateRiskSettings();
    if (!settings.enabled) return [];
    const notified = store.get('updateRiskNotified', []);
    const out = buildUpdateRiskNotifications(await getUpdateRisks(), notified, { includeWatched: settings.includeWatched });
    if (out.length) store.set('updateRiskNotified', [...notified, ...out.flatMap(n => n.keys)]);
    return out;
  }

  // A Name Release frees up player names, so it's an event on the calendar, not a
  // game release. Fixed when read, so dates already saved are covered too.
  // Goes by the date's own line, or a post that's only about the Name Release, so
  // a real update sharing a post keeps its release dates.
  const isNameReleaseDate = e => /\bname release\b|\brelease\b.*\bnames\b/i.test(e.label || '')
    || /^name release\b(?!.*(?:\band\b|&))/i.test(e.postTitle || '');
  const fixCalendarCategory = e => (e.category === 'release' && isNameReleaseDate(e) ? { ...e, category: 'seasonal' } : e);

  async function getNewsCalendar(opts = {}) {
    const cal = await storage.readJSON(calendarFile, { entries: [], processed: {} });
    const pastDays = Math.max(0, Math.min(400, Number(opts && opts.pastDays) || 0));
    const today = localDateStr(new Date(Date.now() - pastDays * 86400000));
    const cancelled = cal.cancelled || [];
    const escRe = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const mentions = (name, text) => new RegExp('\\b' + escRe(name) + '\\b', 'i').test(text);
    const isCancelled = e => cancelled.some(c => String(e.postDate) < String(c.postDate) && mentions(c.name, e.label + ' ' + e.postTitle));
    const upcoming = cal.entries.map(fixCalendarCategory).filter(e => (e.end || e.start) >= today && !isCancelled(e));
    // A "list-style" label is only trusted if it reads like a name: not a
    // stray time fragment ("00 game time, as Mod Yuey…"), not a long
    // sentence, not a generic section/category word ("Community").
    const GENERIC = /^(community|future updates|game updates|dev blogs?|behind the scenes|your feedback|events|support|technical|website|shop|news|update|updates)$/i;
    const PAGE_TITLE = /RuneScape\s*-\s*RuneScape|^News\s*-\s/i; // a page title picked up as a label
    const goodLabel = l => l && !PAGE_TITLE.test(l) && l.length <= 70 && !/^[\d:.,]/.test(l) && /^[A-Z"']/.test(l) && !GENERIC.test(l.trim())
      && !/\b(is|are|the|a|an|to|of|and|on|by|in|for|until|from|will|be|at|with)$/i.test(l.trim());   // a cut-off sentence
    const out = upcoming.filter(e => e.kind === 'list' && goodLabel(e.label));
    const groups = new Map();
    for (const e of upcoming.filter(e => !(e.kind === 'list' && goodLabel(e.label)))) {
      const k = e.postUrl + '|' + e.start;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(e);
    }
    for (const g of groups.values()) {
      const cat = CAL_PRIORITY.find(c => g.some(e => e.category === c)) || 'other';
      // A list-style entry for the same date and category already says it.
      if (out.some(o => o.start === g[0].start && o.category === cat)) continue;
      const ends = g.map(e => e.end).filter(Boolean).sort();
      out.push({ ...g[0], label: g[0].postTitle, category: cat, end: ends.length ? ends[ends.length - 1] : null, mentions: g.length, merged: true });
    }
    return out.sort((a, b) => a.start.localeCompare(b.start));
  }

  // ─── News feed (redesigned News tab) ─────────────────────────────────────
  // (Ben, 2026-10-07) Each archived post, tagged with what GEnius found in
  // it: DXP teased/announced, calendar dates (by category), items you hold
  // or watch, a linked Game Update — plus read/unread. The sidebar badge
  // counts only unread posts matching the kinds Ben has ticked (relevant-
  // only, so it means something when it shows).
  const NEWS_BADGE_DEFAULTS = { dxp: true, release: true, seasonal: true, holds: true, watch: true, linked: true,
    marketplace: false, livestream: false, maintenance: false, all: false };
  function getNewsBadgePrefs() { return { ...NEWS_BADGE_DEFAULTS, ...store.get('newsBadgePrefs', {}) }; }
  function setNewsBadgePrefs(p) {
    const clean = {};
    for (const k of Object.keys(NEWS_BADGE_DEFAULTS)) clean[k] = !!(p || {})[k];
    store.set('newsBadgePrefs', clean);
    return clean;
  }

  async function getNewsFeed() {
    const arch = await storage.readJSON(newsArchiveFile, { posts: {}, dismissed: [] });
    const posts = Object.values(arch.posts).sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.saved_at || 0) - (a.saved_at || 0)).slice(0, 60);
    // First run: everything older than 3 days counts as already read, so the
    // badge doesn't open on a backlog of old posts.
    let read = store.get('newsRead', null);
    if (!read) {
      read = {};
      const cutoff = localDateStr(new Date(Date.now() - 3 * 86400000));
      for (const pst of posts) if (pst.date < cutoff) read[pst.url] = Date.now();
      store.set('newsRead', read);
    }
    const cal = await storage.readJSON(calendarFile, { entries: [], processed: {} });
    cal.entries = cal.entries.map(fixCalendarCategory);
    const datesByPost = {};
    for (const e of cal.entries) (datesByPost[e.postUrl] = datesByPost[e.postUrl] || []).push(e);
    const dxpByUrl = Object.fromEntries(store.get('dxpNewsDetections', []).map(d => [d.url, d]));
    const portfolio = await readPortfolio();
    const held = new Set((portfolio.positions || []).filter(p => p.status === 'open').map(p => (p.item_name || '').toLowerCase()));
    const parsed = await storage.readJSON(dataFile, null);
    const nameById = new Map((parsed?.items || []).map(it => [it.id, it.name]));
    const watched = new Set(store.get('watchlist', []).map(id => (nameById.get(Number(id)) || nameById.get(id) || '').toLowerCase()).filter(Boolean));
    const events = await getEvents();
    // Match by URL, or by title: the backtest's milestones link to the wiki's
    // copy of each post, while News has the official site's link.
    const eventByUrl = {}, eventByTitle = {};
    const norm = t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    for (const ev of events) for (const m of ev.milestones) {
      if (m.url) eventByUrl[m.url] = ev.name;
      if (m.title) eventByTitle[norm(m.title)] = ev.name;
    }
    // Release posts ("…Are Here!", "Out now", …) get the GE items that first
    // appeared within -2..+5 days of the post (Ben, 2026-10-12: the Blood
    // Knights post said "Nothing for GEnius" though it added 3 tradeable
    // drops — mentions only check the title + short description, and new
    // items aren't on the item list when the post is first saved).
    const RELEASE_TITLE = /\b(is|are) here\b|out now|now live|is live|\blaunch(es|ed)?\b|\breleased\b|has arrived|available now/i;
    // "Name Release" frees up player names. It isn't a game release (Ben, 2026-11-03).
    const NOT_GAME_RELEASE = /\bname release\b/i;
    let snapStart = Infinity;
    for (const arr of Object.values(snapshotData)) if (arr.length && arr[0].t < snapStart) snapStart = arr[0].t;
    const firstSeenMs = it => {
      if (historyFirstTs[String(it.id)] != null) return historyFirstTs[String(it.id)];
      const arr = snapshotData[String(it.id)];
      return arr && arr.length && arr[0].t > snapStart + 3 * 86400 ? arr[0].t * 1000 : null;
    };
    const newItemsCache = new Map();
    const newItemsNear = dateStr => {
      if (newItemsCache.has(dateStr)) return newItemsCache.get(dateStr);
      const t0 = new Date(dateStr + 'T12:00:00').getTime(), DAY = 86400000, out = [];
      for (const it of parsed?.items || []) {
        if (it.untradeable || !it.id || (it.categories || []).includes('cosmetics') || /token|override|ornament kit/i.test(it.name)) continue;
        const f = firstSeenMs(it);
        if (f != null && f >= t0 - 2 * DAY && f <= t0 + 5 * DAY) out.push(it.name);
      }
      newItemsCache.set(dateStr, out); return out;
    };
    return posts.map(pst => {
      const dates = datesByPost[pst.url] || [];
      const det = dxpByUrl[pst.url];
      const mentions = pst.mentions || [];
      const release = !NOT_GAME_RELEASE.test(pst.title || '') && (RELEASE_TITLE.test(pst.title || '') || dates.some(d => d.category === 'release'));
      return {
        url: pst.url, title: pst.title, date: pst.date, source: pst.source, description: pst.description,
        unread: !read[pst.url],
        dxp: det && ['teased', 'added', 'known', 'dated'].includes(det.status) ? { status: det.status, dates: det.dates, expected: det.expected }
          : dates.some(d => d.category === 'dxp') ? { status: 'dates' } : null,
        dates: dates.map(d => ({ start: d.start, end: d.end, category: d.category, label: d.label })),
        holds: mentions.filter(m => held.has(m.toLowerCase())),
        watch: mentions.filter(m => watched.has(m.toLowerCase()) && !held.has(m.toLowerCase())),
        linked: eventByUrl[pst.url] || eventByTitle[norm(pst.title)] || null,
        release,
        newItems: release && pst.date ? newItemsNear(pst.date) : [],
      };
    });
  }

  function newsPostRelevant(p, prefs) {
    if (prefs.all) return true;
    if (prefs.dxp && p.dxp) return true;
    if (p.dates.some(d => prefs[d.category])) return true;
    if (prefs.holds && p.holds.length) return true;
    if (prefs.watch && p.watch.length) return true;
    if (prefs.linked && p.linked) return true;
    if (prefs.release && p.newItems && p.newItems.length) return true;
    return false;
  }

  async function getNewsBadgeCount() {
    const prefs = getNewsBadgePrefs();
    return (await getNewsFeed()).filter(p => p.unread && newsPostRelevant(p, prefs)).length;
  }

  async function markNewsRead(urls) {
    const read = store.get('newsRead', {}) || {};
    if (urls === 'all') {
      const arch = await storage.readJSON(newsArchiveFile, { posts: {} });
      for (const u of Object.keys(arch.posts)) read[u] = read[u] || Date.now();
    } else {
      for (const u of (Array.isArray(urls) ? urls : [urls])) if (u) read[u] = Date.now();
    }
    store.set('newsRead', read);
    return { success: true };
  }

  // Adds a DXP [announced, start, end] to the local events list, unless one
  // starting within 3 days of it is already known.
  async function addDxpEvent(ev) {
    if (!Array.isArray(ev) || ev.length !== 3 || !ev.every(x => /^\d{4}-\d{2}-\d{2}$/.test(x))) return { added: false, error: 'bad dates' };
    const { loadEvents } = require('./dxp_intelligence.js');
    const events = await loadEvents(dataDir);
    const startMs = new Date(ev[1]).getTime();
    if (events.some(e => Math.abs(new Date(e[1]).getTime() - startMs) <= 3 * 86400000)) return { added: false, known: true };
    const localPath = path.join(dataDir, 'dxp_events.json');
    const local = await storage.readJSON(localPath, []);
    await storage.writeJSON(localPath, [ev, ...local], { pretty: true });
    dxpIntelComputedAt = 0; // fold it into the Almanac on the next check
    return { added: true };
  }

  async function getDxpNewsDetections() {
    return store.get('dxpNewsDetections', []).filter(d => !['dismissed', 'mention', 'dated'].includes(d.status)).slice(-5).reverse();
  }
  async function resolveDxpNews(url, action, dates) {
    const det = store.get('dxpNewsDetections', []);
    const d = det.find(x => x.url === url);
    if (!d) return { success: false };
    if (action === 'dismiss') d.status = 'dismissed';
    if (action === 'add' && Array.isArray(dates)) {
      const r = await addDxpEvent([d.date, dates[0], dates[1]]);
      if (r.error) return { success: false, error: 'Check the dates' };
      d.dates = dates; d.status = r.added ? 'added' : 'known';
    }
    store.set('dxpNewsDetections', det);
    return { success: true };
  }

  // Immediate "DXP announced" notification for each new detection, using
  // the existing DXP notification settings (enabled + announce alerts).
  async function getDxpNewsNotifications() {
    const settings = store.get('dxpNotificationSettings', { enabled: false, announceAlerts: true });
    const det = store.get('dxpNewsDetections', []);
    const out = [];
    let changed = false;
    for (const d of det) {
      if (d.notified) continue;
      d.notified = true; changed = true;
      if (!settings.enabled || settings.announceAlerts === false) continue;
      const fmtD = x => new Date(x + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      const monthName = m => new Date(m + '-15T12:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      if (d.dates) out.push({ title: '📣 Double XP announced',
        body: `${fmtD(d.dates[0])} → ${fmtD(d.dates[1])}, from today's news. The anticipation window is open; it's in the Almanac.` });
      else if (d.status === 'teased') out.push({ title: '📣 Double XP teased',
        body: `${d.expected === 'soon' ? 'Coming soon, no dates yet' : d.expected.length === 10 ? 'Starts ' + fmtD(d.expected) + ', end date not announced yet' : 'Expected ' + monthName(d.expected) + ', no dates yet'} ("${d.title}"). GEnius adds it to the Almanac as soon as the dates are announced.` });
    }
    if (changed) store.set('dxpNewsDetections', det);
    return out;
  }

  // Ready-made past events (backtest seed, built from the wiki's dated
  // copies of official news posts) are added once; ones the user deletes
  // stay deleted.
  const SEED_EVENTS_VERSION = 3;
  async function getEvents() {
    const ev = await storage.readJSON(eventsFile, { events: [] });
    if ((ev.seeded || 0) < SEED_EVENTS_VERSION) {
      // seededIds: every seed ever added, so a deleted one never returns.
      // (v1 didn't track this — everything it added was seed_01..seed_21.)
      const everSeeded = new Set(ev.seededIds || (ev.seeded ? Array.from({ length: 21 }, (_, i) => 'seed_' + String(i + 1).padStart(2, '0')) : []));
      for (const seed of require('./data/seed_events.json')) {
        const existing = ev.events.find(e => e.id === seed.id);
        if (existing) {
          // v2 added type/categories/quest/notes — fill them in without
          // touching anything the user already set.
          for (const k of ['type', 'categories', 'quest', 'contentPages']) if (existing[k] == null && seed[k] != null) existing[k] = seed[k];
          if (!existing.notes && seed.notes) existing.notes = seed.notes;
          // v3 added each boss's / loot table's drops to its seed event's items.
          if ((ev.seeded || 0) < 3) existing.items = [...new Set([...(existing.items || []), ...(seed.items || [])])];
        } else if (!everSeeded.has(seed.id)) {
          ev.events.push(seed);
        }
        everSeeded.add(seed.id);
      }
      ev.seededIds = [...everSeeded];
      ev.seeded = SEED_EVENTS_VERSION;
      await storage.writeJSON(eventsFile, ev);
    }
    return ev.events;
  }

  async function saveEvent(event) {
    const ev = await storage.readJSON(eventsFile, { events: [] });
    const clean = {
      id: String(event.id || Date.now()),
      name: String(event.name || '').slice(0, 120),
      items: (Array.isArray(event.items) ? event.items : []).map(String).slice(0, 100),
      milestones: (Array.isArray(event.milestones) ? event.milestones : [])
        .filter(m => /^\d{4}-\d{2}-\d{2}$/.test(m.date || ''))
        .map(m => ({ type: EVENT_MILESTONE_TYPES.includes(m.type) ? m.type : 'other', date: m.date,
          title: String(m.title || '').slice(0, 200), url: /^https?:\/\//.test(m.url || '') ? m.url : '' }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      source: event.source || 'user',
      notes: String(event.notes || '').slice(0, 1000),
      type: EVENT_TYPES.includes(event.type) ? event.type : 'other',
      categories: (Array.isArray(event.categories) ? event.categories : []).map(String).slice(0, 20),
      quest: String(event.quest || '').slice(0, 120),
      // Wiki pages for what the update added (bosses, loot tables like
      // "Loot (heists)") — their drop tables feed the event's items.
      contentPages: (Array.isArray(event.contentPages) ? event.contentPages : []).map(x => String(x).trim()).filter(Boolean).slice(0, 20),
    };
    const i = ev.events.findIndex(e => e.id === clean.id);
    if (i >= 0) ev.events[i] = clean; else ev.events.push(clean);
    await storage.writeJSON(eventsFile, ev);
    return { success: true, id: clean.id };
  }

  async function deleteEvent(id) {
    const ev = await storage.readJSON(eventsFile, { events: [] });
    ev.events = ev.events.filter(e => e.id !== String(id));
    await storage.writeJSON(eventsFile, ev);
    return { success: true };
  }

  // Archived official posts not yet attached to any event or dismissed,
  // newest first, each with a guessed milestone type from its title.
  async function getEventSuggestions() {
    const arch = await storage.readJSON(newsArchiveFile, { posts: {}, dismissed: [] });
    const events = await getEvents();
    const used = new Set(events.flatMap(e => e.milestones.map(m => m.url)).filter(Boolean));
    const dismissed = new Set(arch.dismissed || []);
    const guessType = t => /roadmap|ahead|reveal|check.?in/i.test(t) ? 'roadmap'
      : /out now|launch|live|released|is here/i.test(t) ? 'release'
      : /dev ?blog|preview|first look|sneak|beyond the|exploring/i.test(t) ? 'devblog' : 'other';
    return Object.values(arch.posts)
      .filter(pst => !used.has(pst.url) && !dismissed.has(pst.url))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .map(pst => ({ ...pst, guessed_type: guessType(pst.title || '') }));
  }

  async function dismissEventSuggestion(url) {
    const arch = await storage.readJSON(newsArchiveFile, { posts: {}, dismissed: [] });
    arch.dismissed = [...new Set([...(arch.dismissed || []), url])];
    await storage.writeJSON(newsArchiveFile, arch);
    return { success: true };
  }

  // Daily price series for one item (history + snapshots), sorted by time.
  async function dailySeries(itemId) {
    const pts = [];
    for (const pt of (await getHistoryPoints(String(itemId))) || []) {
      if (pt.price) pts.push({ t: pt.timestamp > 1e12 ? pt.timestamp : pt.timestamp * 1000, p: pt.price });
    }
    // Don't keep every analysed item resident in memory (unless it has
    // unsaved changes the background refresh still needs to write).
    if (!dirtyHistoryIds.has(String(itemId))) delete historyData[String(itemId)];
    for (const sp of snapshotData[String(itemId)] || []) if (sp.p) pts.push({ t: sp.t * 1000, p: sp.p });
    return pts.sort((a, b) => a.t - b.t);
  }
  // Price on a day: last point at or before it (within 4 days), else null.
  function priceOn(series, ms) {
    let best = null;
    for (const pt of series) { if (pt.t <= ms + 12 * 3600000) best = pt; else break; }
    return best && ms - best.t < 4 * 86400000 ? best.p : null;
  }

  // Market baseline: median % change of a fixed basket of high-turnover
  // items over the same window. Basket chosen once per session; results
  // cached per window.
  let marketBasket = null;
  const marketWindowCache = new Map();
  async function marketChange(fromMs, toMs) {
    const key = fromMs + ':' + toMs;
    if (marketWindowCache.has(key)) return marketWindowCache.get(key);
    if (!marketBasket) {
      const parsed = await storage.readJSON(dataFile, null);
      marketBasket = (parsed?.items || [])
        .filter(it => !it.untradeable && it.id && historyPopulatedIds.has(String(it.id)) && (it.high || it.low) > 1000 && it.volume > 100)
        .sort((a, b) => (b.volume * (b.high || b.low)) - (a.volume * (a.high || a.low)))
        .slice(0, 150).map(it => it.id);
    }
    const changes = [];
    for (const id of marketBasket) {
      const series = await dailySeries(id);
      const a = priceOn(series, fromMs), b = priceOn(series, toMs);
      if (a && b) changes.push((b - a) / a * 100);
    }
    changes.sort((x, y) => x - y);
    const med = changes.length >= 20 ? changes[Math.floor(changes.length / 2)] : null;
    marketWindowCache.set(key, med);
    return med;
  }

  // ─── Chart analysis (phase 1: trend + where today sits) ─────────────────
  // Ben, 2026-10-08: rules-based readings for one item, each shown with its
  // own track record on this item's history, so a reading is never just an
  // assertion. Same rule as the update research: evidence, not assumptions.
  //   reliable = enough independent past cases AND the outcome beat what the
  //              item does anyway (its base rate) by a clear margin
  //   weak     = shown, greyed, with the numbers
  //   hidden   = not enough history / price barely moves (illiquid guide)
  // Past cases are sampled every 30 days so their 30-day outcomes don't
  // overlap (overlapping windows would count one move many times).
  const DAYMS = 86400000;
  let marketIndexCache = null; // {day0, idx, mkt} — session-only
  // Market move between two days = median of the 150-item basket's moves
  // over that window (same as research/update_repeatability/engine.js).
  // FIX 2026-10-09: this used to chain the median DAILY change — but most
  // guide prices don't change on a given day, so that median was exactly 0
  // on 365 of 371 days and the "market" line was flat: every "vs market"
  // number in Chart analysis was really the raw move.
  async function marketIndex() {
    if (marketIndexCache && Date.now() - marketIndexCache.at < 6 * 3600000) return marketIndexCache;
    if (!marketBasket) await marketChange(Date.now() - DAYMS, Date.now());
    const day0 = Math.floor(Date.UTC(2015, 5, 1) / DAYMS), n = Math.floor(Date.now() / DAYMS) - day0 + 1;
    const arrs = [];
    for (const id of marketBasket || []) {
      const a = new Float64Array(n).fill(NaN);
      for (const pt of await dailySeries(id)) { const d = Math.floor(pt.t / DAYMS) - day0; if (d >= 0 && d < n) a[d] = pt.p; }
      let last = NaN, lastD = -99;
      for (let d = 0; d < n; d++) { if (!isNaN(a[d])) { last = a[d]; lastD = d; } else if (d - lastD <= 4) a[d] = last; }
      arrs.push(a);
    }
    const memo = new Map();
    const mkt = (d0, d1) => {
      const key = d0 * 100000 + d1; if (memo.has(key)) return memo.get(key);
      const v = [];
      for (const a of arrs) if (a[d0] > 0 && a[d1] > 0) v.push(a[d1] / a[d0] - 1);
      let m = null;
      if (v.length >= 20) { v.sort((x, y) => x - y); m = v[v.length >> 1] * 100; }
      memo.set(key, m); return m;
    };
    // idx kept only for its length (callers size their arrays from it).
    marketIndexCache = { at: Date.now(), day0, idx: new Float64Array(n), mkt };
    return marketIndexCache;
  }

  async function getChartAnalysis(itemId, opts) {
    const series = await dailySeries(itemId);
    const out = { readings: [], status: 'ok' };
    if (series.length < 120) return { ...out, status: 'not_enough_history' };
    const { day0, idx, mkt } = await marketIndex();
    const n = idx.length;
    const p = new Float64Array(n).fill(NaN);
    for (const pt of series) { const d = Math.floor(pt.t / DAYMS) - day0; if (d >= 0 && d < n) p[d] = pt.p; }
    let last = NaN, lastD = -99, first = -1;
    for (let d = 0; d < n; d++) { if (!isNaN(p[d])) { if (first < 0) first = d; last = p[d]; lastD = d; } else if (d - lastD <= 4) p[d] = last; }
    // Research options (out-of-sample check, 2026-10-09): opts.cutoff
    // pretends "today" is that date (nothing later is seen); opts.from only
    // counts past cases on/after that date; opts.dir forces the trend
    // direction whose track record is measured.
    const dayFromIso = iso => Math.floor(Date.parse(iso + 'T12:00:00Z') / DAYMS) - day0;
    const today = opts?.cutoff ? Math.min(lastD, dayFromIso(opts.cutoff)) : lastD;
    const fromD = opts?.from ? dayFromIso(opts.from) : -Infinity;
    if (today < 0 || (!opts?.cutoff && n - 1 - today > 7)) return { ...out, status: 'stale_history' };
    // Illiquid check: a guide price that doesn't change most days produces
    // meaningless readings.
    let same = 0, cnt = 0;
    // Week-over-week: the guide itself often only updates every 2-3 days.
    for (let d = Math.max(first + 7, today - 182); d <= today; d += 7) if (p[d] > 0 && p[d - 7] > 0) { cnt++; if (p[d] === p[d - 7]) same++; }
    // 6. Alch value line (Ben, 2026-10-08/09): high alch − that day's nature
    //    rune price. Whether it acts as a FLOOR depends on the item (Ben:
    //    things made to be alched — salvages, Dragon hatchets — hold it;
    //    battlestaves/longbows live below it). Measured per item as the
    //    share of days in the last 3 years the guide stayed at/above
    //    floor − 3%. Checked 2026-10-09: 27 of 159 near-floor items held it
    //    95%+ of days (orikalkum/necronium salvages, Dragon platelegs, whip,
    //    onyx...); a "back to floor after a 3% drop" test missed items that
    //    sit pinned on it. 3 years only: before ~2022 guide prices sat
    //    below floors almost every day (Green d'hide: 95-100% of days).
    const alchInfo = async (target) => {
    const parsedLatest = await storage.readJSON(dataFile, null);
    const itemsL = parsedLatest?.items || [];
    const me = itemsL.find(i => String(i.id) === String(itemId));
    const nat = itemsL.find(i => i.name === 'Nature rune');
    if (me?.alch > 0 && nat) {
      const natNow = me.natureRunePrice || nat.high || nat.low || 0;
      const floorNow = me.alch - natNow;
      const cur = p[today];
      if (floorNow > 0) {
        const np = new Float64Array(n).fill(NaN);
        for (const pt of await dailySeries(nat.id)) { const d = Math.floor(pt.t / DAYMS) - day0; if (d >= 0 && d < n) np[d] = pt.p; }
        let lastN = NaN; for (let d = 0; d < n; d++) { if (!isNaN(np[d])) lastN = np[d]; else np[d] = lastN; }
        // held = within 3% of or above (classification only — guide noise
        // and nature-rune swings keep pinned items a hair under); belowDays
        // = strictly below, shown to the user as-is (Ben, 2026-10-09: the
        // old rounded "100% at or above" hid a real dip to 31.0k).
        let held = 0, days = 0, belowDays = 0, lowest = null;
        for (let d = Math.max(first, today - 1095); d <= today; d++) {
          if (!(p[d] > 0) || !(np[d] > 0)) continue;
          const fl = me.alch - np[d]; if (fl <= 0) continue;
          days++; if (p[d] >= fl * 0.97) held++;
          if (p[d] < fl) { belowDays++; const g = p[d] / fl - 1; if (!lowest || g < lowest.gap) lowest = { gap: g, price: p[d], date: new Date((d + day0) * DAYMS).toISOString().slice(0, 10) }; }
        }
        const heldShare = days ? held / days : null;
        // Cutoff (Ben, 2026-10-09): no line for items that never get near
        // their alch value (party hats, crackers, Dragon Rider lance...).
        // Shown only if the price came within 25% of it in the last 3 years.
        let minNear = Infinity;
        for (let d = Math.max(first, today - 1095); d <= today; d++) if (p[d] > 0 && np[d] > 0) minNear = Math.min(minNear, p[d] / (me.alch - np[d]));
        if (!(minNear <= 1.25)) return;
        target.alch = { alch: me.alch, nature: natNow, floor: floorNow, current: cur, gapPct: (cur / floorNow - 1) * 100,
          heldShare, days, belowDays, lowest, kind: heldShare == null || days < 180 ? 'unknown' : heldShare >= 0.95 ? 'floor' : heldShare < 0.5 ? 'below' : 'mixed' };
      }
    }
    };

    // Items pinned to their alch floor barely move, so they read as
    // 'illiquid' — still show the alch line for them (Ben, 2026-10-09).
    if (cnt < 10 || same / cnt > 0.5) { const o = { ...out, status: 'illiquid' }; await alchInfo(o); return o; }
    const rel = (d0, d1) => { if (!(p[d0] > 0 && p[d1] > 0)) return null; const m = mkt(d0, d1); return m == null ? null : (p[d1] / p[d0] - 1) * 100 - m; };
    // Reliable needs a one-sided binomial test vs the item's own base rate
    // at p < 0.01 — share/margin rules alone let ~8% of items through on
    // chance (checked across 700 liquid items, 2026-10-08).
    const binomTail = (k, nn, q) => { let s = 0, c = 1; for (let i = 0; i <= nn; i++) { if (i > 0) c = c * (nn - i + 1) / i; if (i >= k) s += c * Math.pow(q, i) * Math.pow(1 - q, nn - i); } return s; };
    const grade = (k, nCases, base) => {
      const share = nCases ? k / nCases : 0;
      const pval = nCases ? binomTail(k, nCases, Math.min(0.95, Math.max(0.05, base))) : 1;
      const reliable = nCases >= 10 && share >= 0.6 && share - base >= 0.1 && pval < 0.01;
      // Opposite (Ben's Steel arrow test, 2026-10-09): a strong result the
      // OTHER way — e.g. after rises it kept rising 5/19 vs 51% usual — is
      // evidence too ("tends to reverse"), not a "weak" reading.
      const qb = Math.min(0.95, Math.max(0.05, base));
      const pOpp = nCases ? binomTail(nCases - k, nCases, 1 - qb) : 1;
      const opposite = !reliable && nCases >= 10 && base - share >= 0.15 && pOpp < 0.01;
      return { k, n: nCases, share, base, p: pval, pOpp, strength: reliable ? 'reliable' : opposite ? 'opposite' : 'weak' };
    };

    // 1. Trend vs market (30 and 90 days). Track record: after past 30-day
    //    moves in the same direction and of similar size, did the next 30
    //    days continue that direction (vs market)?
    // 1gp steps (Ben's Steel arrow test): on cheap items one coin is a
    // several-% move, so a move only counts if it's at least 2 coins.
    const coins = (d0, d1) => p[d0] > 0 && p[d1] > 0 ? Math.abs(p[d1] - p[d0]) : 0;
    const tickPct = 100 / p[today];
    if (tickPct >= 1) out.tick = { pct: tickPct, price: p[today], was30: p[today - 30] > 0 ? p[today - 30] : null };
    const r30 = rel(today - 30, today), r90 = rel(today - 90, today);
    if (r30 != null) {
      const dir = opts?.dir || (Math.abs(r30) < 2 || coins(today - 30, today) < 2 ? 'flat' : r30 > 0 ? 'up' : 'down');
      const reading = { key: 'trend', dir, rel30: r30, rel90: r90 };
      if (dir !== 'flat') {
        const minSize = Math.max(2, Math.abs(r30) / 2);
        let k = 0, nc = 0, baseK = 0, baseN = 0;
        for (let d = today - 60; d - 30 >= first && d >= fromD; d -= 30) {
          const before = rel(d - 30, d), after = rel(d, d + 30);
          if (after == null || Math.abs(after) < 0.5 || coins(d, d + 30) < 2) continue;
          baseN++; if ((after > 0) === (dir === 'up')) baseK++;
          if (before == null || Math.abs(before) < minSize || coins(d - 30, d) < 2 || (before > 0) !== (dir === 'up')) continue;
          nc++; if ((after > 0) === (dir === 'up')) k++;
        }
        reading.track = grade(k, nc, baseN ? baseK / baseN : 0.5);
      }
      out.readings.push(reading);
    }

    // 2. Where today sits in its own 1-year range. Track record: past times
    //    it sat in the same zone (top/bottom 10%), how often did it move
    //    back toward the middle over the next 30 days (vs market)?
    const yr = [];
    for (let d = Math.max(first, today - 365); d <= today; d++) if (p[d] > 0) yr.push(p[d]);
    if (yr.length >= 120) {
      const lo = Math.min(...yr), hi = Math.max(...yr), cur = p[today];
      const pct = hi > lo ? (cur - lo) / (hi - lo) * 100 : 50;
      const zone = opts?.zone || (pct >= 90 ? 'high' : pct <= 10 ? 'low' : 'middle');
      const reading = { key: 'range', zone, pct, lo, hi, current: cur };
      if (zone !== 'middle') {
        let k = 0, nc = 0, baseK = 0, baseN = 0;
        for (let d = today - 30; d - 365 >= first && d >= fromD; d -= 30) {
          let l = Infinity, h2 = -Infinity;
          for (let j = d - 365; j <= d; j++) if (p[j] > 0) { if (p[j] < l) l = p[j]; if (p[j] > h2) h2 = p[j]; }
          const after = rel(d, d + 30);
          if (after == null || !(h2 > l) || Math.abs(after) < 0.5) continue;
          const back = zone === 'high' ? after < 0 : after > 0;
          baseN++; if (back) baseK++;
          const pp = (p[d] - l) / (h2 - l) * 100;
          if (zone === 'high' ? pp < 90 : pp > 10) continue;
          nc++; if (back) k++;
        }
        reading.track = grade(k, nc, baseN ? baseK / baseN : 0.5);
        // "Tends to keep going" (opposite) failed the out-of-sample check
        // (2026-10-09: held on 5 of 13 items) — shown as Weak instead.
        if (reading.track.strength === 'opposite') reading.track.strength = 'weak';
      }
      out.readings.push(reading);
    }
    // ── Phase 2 (2026-10-08). Method + validation across ~1,100 liquid
    //    items: research/chart_analysis/FINDINGS.md.
    // 3. Typical range: middle 80% of the last year's daily prices.
    //    Descriptive only — no prediction, no track record.
    if (yr.length >= 120) {
      const s = [...yr].sort((x, y) => x - y), q = f => s[Math.floor((s.length - 1) * f)];
      const lo = q(0.1), hi = q(0.9), cur = p[today];
      out.typical = { lo, hi, current: cur, pct: hi > lo ? (cur - lo) / (hi - lo) * 100 : 50 };
    }

    // 4. Turning-point levels. Swing low/high = extreme within ±10 days with
    //    a ≥5% move away; a level = 2+ swings within ±2%, known only from
    //    the day its 2nd swing is confirmed (no look-ahead). Track record:
    //    later touches (within 2%, from the right side, ≥20 days apart) —
    //    did it move 5% away before breaking 5% through? Placebo: the same
    //    test on random price levels in the item's range (20 runs).
    //    Shown only if the item's levels beat the placebo (p < 0.01).
    const SW = 0.05, TOL = 0.02;
    const swings = [];
    for (let d = first + 10; d + 10 <= today; d++) {
      if (!(p[d] > 0)) continue;
      let isLo = true, isHi = true, mx = 0, mn = Infinity;
      for (let j = d - 10; j <= d + 10; j++) { if (!(p[j] > 0)) continue; if (p[j] < p[d]) isLo = false; if (p[j] > p[d]) isHi = false; if (p[j] > mx) mx = p[j]; if (p[j] < mn) mn = p[j]; }
      if (isLo && mx >= p[d] * (1 + SW)) swings.push({ d, p: p[d], kind: 'support' });
      if (isHi && mn <= p[d] * (1 - SW)) swings.push({ d, p: p[d], kind: 'resistance' });
    }
    const lvls = [];
    for (const s of swings) {
      const lv = lvls.find(l => l.kind === s.kind && Math.abs(s.p / l.p - 1) <= TOL);
      if (lv) { lv.count++; lv.lastSwing = s.d; if (lv.count === 2) lv.from = s.d + 10; }
      else lvls.push({ p: s.p, kind: s.kind, count: 1, from: Infinity, lastSwing: s.d });
    }
    const real = lvls.filter(l => l.count >= 2);
    const touchOutcome = (d, L, K) => {
      for (let j = d + 1; j <= Math.min(d + 60, today); j++) {
        if (!(p[j] > 0)) continue;
        const up = p[j] >= L * (1 + SW), down = p[j] <= L * (1 - SW);
        if (K === 'support' ? up : down) return 'held';
        if (K === 'support' ? down : up) return 'broke';
      }
      return null;
    };
    const runTouches = (levels, perLevel) => {
      let held = 0, nT = 0, lastTouch = -999;
      for (let d = Math.max(first + 30, fromD); d <= today - 1; d++) {
        if (!(p[d] > 0) || d - lastTouch < 20) continue;
        for (const lv of levels) {
          if (lv.from > d || Math.abs(p[d] / lv.p - 1) > TOL) continue;
          if (lv.kind === 'support' ? !(p[d - 1] > lv.p) : !(p[d - 1] < lv.p)) continue;
          const o = touchOutcome(d, lv.p, lv.kind); if (!o) continue;
          nT++; if (o === 'held') held++; lastTouch = d;
          if (perLevel) { lv.touches = (lv.touches || 0) + 1; if (o === 'held') lv.held = (lv.held || 0) + 1; }
          break;
        }
      }
      return { held, n: nT };
    };
    if (real.length) {
      const r = runTouches(real, true);
      let st = 7; const rnd = () => (st = (st * 1103515245 + 12345) % 2147483648) / 2147483648;
      let all = []; for (let d = first; d <= today; d++) if (p[d] > 0) all.push(p[d]);
      const pLo = Math.min(...all), pHi = Math.max(...all); all = null;
      let ph = 0, pn = 0;
      for (let rep = 0; rep < 20; rep++) { const t = runTouches(real.map(l => ({ ...l, p: pLo * Math.pow(pHi / pLo, rnd()) })), false); ph += t.held; pn += t.n; }
      const base = pn ? ph / pn : 0.5;
      const pv = r.n ? binomTail(r.held, r.n, Math.min(0.95, Math.max(0.05, base))) : 1;
      const reliable = r.n >= 8 && r.held / r.n > base && pv < 0.01;
      const cur = p[today];
      out.levels = {
        reliable, held: r.held, n: r.n, base, p: pv,
        // Only levels near today's price (±25%) are worth drawing.
        // Each drawn level needs its own record too (2+ touches, held at
        // least half); near-duplicates (within 2%) keep the better one.
        list: reliable ? (() => {
          const picked = [];
          real.filter(l => l.from <= today && Math.abs(l.p / cur - 1) <= 0.25 && (l.touches || 0) >= 2 && (l.held || 0) / l.touches >= 0.5)
            .sort((a, b) => (b.held || 0) - (a.held || 0) || b.touches - a.touches)
            .forEach(l => { if (picked.length < 4 && !picked.some(x => Math.abs(x.p / l.p - 1) <= TOL)) picked.push(l); });
          return picked.map(l => ({ price: l.p, kind: l.p < cur ? 'support' : 'resistance', swings: l.count, touches: l.touches, held: l.held || 0,
            lastSwing: new Date((l.lastSwing + day0) * DAYMS).toISOString().slice(0, 10) }));
        })() : [],
      };
    }

    // ── Event tests (dips, spikes) — method rebuilt 2026-10-09 after three
    //    biased versions (see research/chart_analysis/FINDINGS.md):
    //    compare each event against days on the SAME item that were just
    //    as jumpy (similar 14-day average daily move, ±25-33%), in any
    //    direction. Calm-day bases flagged ~half of all items (jumpy prices
    //    move more either way); after-a-rise bases flagged ~2/3 (GE momentum).
    //    Expected count = sum of each case's matched base rate; one-sided
    //    normal test on (observed − expected). Calibrated by running the
    //    same test on random fake events (opts.placeboSeed).
    const volat = new Float64Array(n);
    for (let d = first + 14; d <= today; d++) {
      let s2 = 0, c2 = 0;
      for (let j2 = d - 13; j2 <= d; j2++) if (p[j2] > 0 && p[j2 - 1] > 0) { s2 += Math.abs(p[j2] / p[j2 - 1] - 1); c2++; }
      volat[d] = c2 >= 8 ? s2 / c2 : NaN;
    }
    const normCdf = z => { const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2); const e = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z / 2); return 0.5 * (1 + (z >= 0 ? e : -e)); };
    let pst = opts?.placeboSeed || 0; const prnd = () => (pst = (pst * 1103515245 + 12345) % 2147483648) / 2147483648;
    const eventTest = (isEvent, outcome, lastDay) => {
      const cases = [], pool = [];
      let nextE = 0;
      for (let d = Math.max(first + 14, fromD); d <= lastDay; d++) {
        if (!(p[d] > 0) || !(volat[d] > 0)) continue;
        const o = outcome(d); if (o == null) continue;
        const ev = opts?.placeboSeed ? prnd() < 0.02 : isEvent(d);
        if (ev && d >= nextE) { cases.push({ d, o, v: volat[d] }); nextE = d + 30; }
        else if (!ev && d % 3 === 0) pool.push({ o, v: volat[d] });
      }
      let k = 0, nC = 0, E = 0, V = 0;
      for (const c of cases) {
        let bs = 0, bn = 0;
        for (const b of pool) if (b.v >= c.v * 0.75 && b.v <= c.v * 1.33) { bn++; if (b.o) bs++; }
        if (bn < 15) continue;
        const r = bs / bn; nC++; if (c.o) k++; E += r; V += r * (1 - r);
      }
      const z = V > 0 ? (k - E) / Math.sqrt(V) : 0;
      return { k, n: nC, base: nC ? E / nC : 0.5, z, pUp: 1 - normCdf(z), pDown: normCdf(z), cases };
    };

    // 5. Dip recovery (Ben's idea): dip = X% below the 14-day high (2+
    //    coins); recovered = climbed back X/(1−X) (the same % it fell)
    //    within 30 days. 3 sizes tried → Bonferroni (p < 0.01/3).
    let bestDip = null; const dipAll = [];
    for (const X of [0.05, 0.10, 0.15]) {
      const t = eventTest(
        d => { let hi = 0; for (let j2 = d - 14; j2 < d; j2++) if (p[j2] > hi) hi = p[j2]; return hi > 0 && p[d] <= hi * (1 - X) && hi - p[d] >= 2; },
        d => { const need = p[d] * (1 + X / (1 - X)); for (let j2 = d + 1; j2 <= d + 30; j2++) if (p[j2] >= need && p[j2] - p[d] >= 2) return 1; return 0; },
        today - 30);
      const days = [];
      for (const c of t.cases) if (c.o) { const need = p[c.d] * (1 + X / (1 - X)); for (let j2 = c.d + 1; j2 <= c.d + 30; j2++) if (p[j2] >= need) { days.push(j2 - c.d); break; } }
      days.sort((a, b) => a - b);
      const share = t.n ? t.k / t.n : 0;
      const res = { size: X * 100, k: t.k, n: t.n, base: t.base, p: t.pUp, pOpp: t.pDown, medianDays: days.length ? days[days.length >> 1] : null,
        reliable: t.n >= 8 && t.pUp < 0.0033 && share - t.base >= 0.1, opposite: t.n >= 8 && t.pDown < 0.0033 && t.base - share >= 0.1 };
      const score = r => r.reliable || r.opposite ? 1 - Math.min(r.p, r.pOpp) : 0;
      dipAll.push(res);
      if (!bestDip || score(res) > score(bestDip)) bestDip = res;
    }
    if (bestDip && bestDip.n) out.dip = bestDip;
    if (opts?.research) out.dipAll = dipAll;

    // ── Phase 3 (2026-10-08): volume + spike fade. Research:
    //    research/chart_analysis/FINDINGS.md (test_volume.js).
    const vol = new Float64Array(n).fill(NaN);
    for (const pt of (await getHistoryPoints(String(itemId))) || []) {
      const t = pt.timestamp > 1e12 ? pt.timestamp : pt.timestamp * 1000;
      const d = Math.floor(t / DAYMS) - day0;
      if (d >= 0 && d < n && pt.volume > 0) vol[d] = pt.volume;
    }
    if (!dirtyHistoryIds.has(String(itemId))) delete historyData[String(itemId)];
    const vAvg = (d0, d1) => { let s = 0, c = 0; for (let d = d0; d <= d1; d++) if (vol[d] > 0) { s += vol[d]; c++; } return c >= (d1 - d0 + 1) * 0.6 ? s / c : null; };
    const pMove = (d0, d1) => p[d0] > 0 && p[d1] > 0 ? (p[d1] / p[d0] - 1) * 100 : null;

    // 7. Volume now vs normal — descriptive. Plus "myth notes": when a
    //    textbook volume pattern is happening now, say what it actually did
    //    across ~1,000 GE items (pooled, market-relative, 30 days after).
    //    Ben: GEnius should be open about rules that don't hold here.
    const vBefore = vAvg(today - 74, today - 15), v7 = vAvg(today - 6, today), v14 = vAvg(today - 13, today);
    if (vBefore && v7) {
      const p7 = pMove(today - 7, today), p14 = pMove(today - 14, today);
      const notes = [];
      if (p14 != null && p14 >= 5 && v14 / vBefore < 0.8) notes.push({ key: 'weakRally',
        text: 'Rising on falling volume. Chart guides call this a weak rally that will fade, but across GE items these rallies faded LESS often than rallies on normal volume (40% vs 46% over the next month).' });
      if (p14 != null && p14 <= -5 && v14 / vBefore > 1.5) notes.push({ key: 'heavyDrop',
        text: 'Falling on heavy volume. Chart guides call this panic selling that bounces back, but across GE items these drops bounced LESS often than drops on normal volume (39% vs 43%).' });
      if (p7 != null && Math.abs(p7) < 3 && v7 / vBefore >= 3) notes.push({ key: 'surge',
        text: 'Volume is 3×+ normal while the price is flat. Across GE items this was followed by a rise slightly more often than usual (56% vs 50%) — a small edge, not a signal.' });
      out.volume = { ratio7: v7 / vBefore, normal: vBefore, week: v7, notes };
    }

    // 8. Spike fade: jump = +10% in 7 days (2+ coins); faded = fell back 5%+
    //    vs market (2+ coins) within 30 days. Same jumpiness-matched test.
    {
      const t = eventTest(
        d => { const p7 = pMove(d - 7, d); return p7 != null && p7 >= 10 && coins(d - 7, d) >= 2; },
        d => { const fwd = rel(d, d + 30); return fwd == null ? null : (fwd <= -5 && coins(d, d + 30) >= 2 ? 1 : 0); },
        today - 30);
      const share = t.n ? t.k / t.n : 0;
      const p7now = pMove(today - 7, today);
      out.spike = { k: t.k, n: t.n, base: t.base, p: t.pUp, pOpp: t.pDown,
        // "fade" (reliable) is computed but NOT shown: it failed the
        // out-of-sample check (research/chart_analysis/FINDINGS.md).
        reliable: t.n >= 8 && t.pUp < 0.01 && share - t.base >= 0.1, opposite: t.n >= 8 && t.pDown < 0.01 && t.base - share >= 0.1,
        activeNow: p7now != null && p7now >= 10 && coins(today - 7, today) >= 2, p7: p7now };
    }

    await alchInfo(out);

    out.since = new Date((first + day0) * DAYMS).toISOString().slice(0, 10);
    return out;
  }

  // ─── Ask about this item (Ben, 2026-10-09) ─────────────────────────────
  // Fill-in-the-blank questions answered from saved daily guide prices (+
  // volume, live prices for the flip check). Answers are exact counts and
  // dates — never rounded claims (same rule as the alch-line fix).
  // q = { type, ...params }; returns { lines: [string], note?: string } or
  // { error }.
  async function askItem(itemId, q) {
    const series = await dailySeries(itemId);
    if (series.length < 30) return { error: 'Not enough price history for this item yet.' };
    const { day0, idx, mkt } = await marketIndex();
    const n = idx.length;
    const p = new Float64Array(n).fill(NaN), raw = new Uint8Array(n);
    for (const pt of series) { const d = Math.floor(pt.t / DAYMS) - day0; if (d >= 0 && d < n) { p[d] = pt.p; raw[d] = 1; } }
    let last = NaN, lastD = -99, first = -1;
    for (let d = 0; d < n; d++) { if (!isNaN(p[d])) { if (first < 0) first = d; last = p[d]; lastD = d; } else if (d - lastD <= 4) p[d] = last; }
    const today = lastD;
    const iso = d => new Date((d + day0) * DAYMS).toISOString().slice(0, 10);
    const dOf = s => Math.floor(Date.parse(s + 'T12:00:00Z') / DAYMS) - day0;
    const gp = v => Math.round(v).toLocaleString() + 'gp';
    const pc = (k, nn) => nn ? `${k.toLocaleString()} of ${nn.toLocaleString()} days` : 'no days';
    const PERIOD = { '90d': 90, '1y': 365, '3y': 1095, all: Infinity };
    const from = Math.max(first, today - (PERIOD[q.period] ?? 365));
    const periodLabel = { '90d': 'the last 90 days', '1y': 'the last year', '3y': 'the last 3 years', all: `all history (since ${iso(first)})` }[q.period || '1y'];
    const days = []; for (let d = from; d <= today; d++) if (p[d] > 0) days.push(d);
    const mv = (d0, d1) => p[d0] > 0 && p[d1] > 0 ? (p[d1] / p[d0] - 1) * 100 : null;
    const runs = test => { // consecutive-day runs where test(d) is true, within the period
      const out = []; let s = null;
      for (const d of days) { if (test(d)) { if (s == null) s = d; } else if (s != null) { out.push([s, d - 1]); s = null; } }
      if (s != null) out.push([s, today]); return out;
    };
    const med = v => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b); return s[s.length >> 1]; };
    const lines = [];

    switch (q.type) {
      case 'level': { // 1. within / above / below X% of Y
        const Y = +q.price, X = +(q.pct || 0) / 100; if (!(Y > 0)) return { error: 'Enter a price.' };
        const hit = d => q.mode === 'above' ? p[d] >= Y * (1 + X) : q.mode === 'below' ? p[d] <= Y * (1 - X) : Math.abs(p[d] / Y - 1) <= X;
        const k = days.filter(hit).length;
        const what = q.mode === 'within' ? `within ${q.pct}% of ${gp(Y)}` : `${q.pct > 0 ? q.pct + '% or more ' : 'at or '}${q.mode} ${gp(Y)}`;
        lines.push(`It was ${what} on ${pc(k, days.length)} in ${periodLabel}${days.length ? ` (${(k / days.length * 100).toFixed(1)}%)` : ''}.`);
        let lastHit = null; for (let d = today; d >= first; d--) if (p[d] > 0 && hit(d)) { lastHit = d; break; }
        lines.push(lastHit == null ? 'It has never been there in the saved history.' : lastHit >= today - 1 ? 'It is there right now.' : `Last time: ${iso(lastHit)} (${gp(p[lastHit])}).`);
        const r = runs(hit); if (r.length) { const L = r.map(([a, b]) => b - a + 1); const li = L.indexOf(Math.max(...L)); lines.push(`Longest stretch: ${L[li]} day${L[li] > 1 ? 's' : ''} in a row (${iso(r[li][0])} to ${iso(r[li][1])}).`); }
        break;
      }
      case 'alch': { // 2. within X% of the alch floor
        const parsed = await storage.readJSON(dataFile, null);
        const items = parsed?.items || [];
        const me = items.find(i => String(i.id) === String(itemId)), nat = items.find(i => i.name === 'Nature rune');
        if (!(me?.alch > 0) || !nat) return { error: 'This item has no high alch value.' };
        const np = new Float64Array(n).fill(NaN);
        for (const pt of await dailySeries(nat.id)) { const d = Math.floor(pt.t / DAYMS) - day0; if (d >= 0 && d < n) np[d] = pt.p; }
        let ln = NaN; for (let d = 0; d < n; d++) { if (!isNaN(np[d])) ln = np[d]; else np[d] = ln; }
        const X = +(q.pct || 0) / 100;
        let k = 0, below = 0, nn = 0;
        for (const d of days) { if (!(np[d] > 0)) continue; const fl = me.alch - np[d]; if (fl <= 0) continue; nn++; if (Math.abs(p[d] / fl - 1) <= X) k++; if (p[d] < fl) below++; }
        if (!nn) return { error: 'The alch value minus a nature rune is not positive for this item, so there is no alch floor.' };
        lines.push(`Alch floor today: ${gp(me.alch - (np[today] || 0))} (high alch ${gp(me.alch)} − nature rune ${gp(np[today] || 0)}).`);
        lines.push(`It was within ${q.pct}% of that day's alch floor on ${pc(k, nn)} in ${periodLabel}, and below it on ${pc(below, nn)}.`);
        break;
      }
      case 'last': { // 3. when was it last above / below Y
        const Y = +q.price; if (!(Y > 0)) return { error: 'Enter a price.' };
        const hit = d => q.mode === 'above' ? p[d] >= Y : p[d] <= Y;
        let lastHit = null; for (let d = today; d >= first; d--) if (p[d] > 0 && hit(d)) { lastHit = d; break; }
        if (lastHit == null) lines.push(`It has never been ${q.mode === 'above' ? 'at or above' : 'at or below'} ${gp(Y)} since ${iso(first)}.`);
        else if (lastHit >= today - 1) lines.push(`It is ${q.mode === 'above' ? 'at or above' : 'at or below'} ${gp(Y)} right now (${gp(p[today])}).`);
        else lines.push(`Last ${q.mode === 'above' ? 'at or above' : 'at or below'} ${gp(Y)} on ${iso(lastHit)} (${gp(p[lastHit])}) — ${today - lastHit} days ago.`);
        break;
      }
      case 'stay': { // 4. once below/above Y, how long did it stay
        const Y = +q.price; if (!(Y > 0)) return { error: 'Enter a price.' };
        const r = runs(d => q.mode === 'above' ? p[d] >= Y : p[d] <= Y);
        if (!r.length) { lines.push(`It wasn't ${q.mode} ${gp(Y)} at all in ${periodLabel}.`); break; }
        const L = r.map(([a, b]) => b - a + 1);
        lines.push(`It went ${q.mode} ${gp(Y)} ${r.length} time${r.length > 1 ? 's' : ''} in ${periodLabel}.`);
        lines.push(`Typical stay: ${med(L)} day${med(L) > 1 ? 's' : ''}. Shortest ${Math.min(...L)}, longest ${Math.max(...L)} (${iso(r[L.indexOf(Math.max(...L))][0])}).`);
        if (r[r.length - 1][1] === today) lines.push(`It is ${q.mode} it right now — ${L[L.length - 1]} days so far.`);
        break;
      }
      case 'recover': { // 5. after dropping below Y, how long until back above
        const Y = +q.price; if (!(Y > 0)) return { error: 'Enter a price.' };
        const r = runs(d => p[d] < Y);
        const done = r.filter(([, b]) => b < today).map(([a, b]) => b - a + 2);
        if (!r.length) { lines.push(`It never dropped below ${gp(Y)} in ${periodLabel}.`); break; }
        lines.push(`It dropped below ${gp(Y)} ${r.length} time${r.length > 1 ? 's' : ''} in ${periodLabel}.`);
        if (done.length) lines.push(`It got back to ${gp(Y)} or higher after a median of ${med(done)} day${med(done) > 1 ? 's' : ''} (fastest ${Math.min(...done)}, slowest ${Math.max(...done)}).`);
        if (r[r.length - 1][1] === today) lines.push(`It's below it right now and hasn't got back yet (${today - r[r.length - 1][0] + 1} days so far).`);
        break;
      }
      case 'moves': { // 6. how often did it move X%+ in a week / month
        const W = q.window === 'month' ? 30 : 7, X = +q.pct; if (!(X > 0)) return { error: 'Enter a %.' };
        let up = 0, down = 0, nn = 0;
        for (let d = from + W; d <= today; d += W) { const m = mv(d - W, d); if (m == null) continue; nn++; if (m >= X) up++; else if (m <= -X) down++; }
        lines.push(`Split ${periodLabel} into ${nn} back-to-back ${q.window === 'month' ? '30-day' : '7-day'} periods: it rose ${X}%+ in ${up} and fell ${X}%+ in ${down}${nn ? ` (${((up + down) / nn * 100).toFixed(1)}% had a move that big)` : ''}.`);
        break;
      }
      case 'extremes': { // 7. biggest drop / rise in a week / month
        const W = q.window === 'month' ? 30 : q.window === 'year' ? 365 : 7;
        let hi = null, lo = null;
        for (let d = from + W; d <= today; d++) { const m = mv(d - W, d); if (m == null) continue; if (!hi || m > hi.m) hi = { m, d }; if (!lo || m < lo.m) lo = { m, d }; }
        if (!hi) return { error: 'Not enough history in that period.' };
        const wl = { week: '7 days', month: '30 days', year: '365 days' }[q.window || 'week'];
        lines.push(`Biggest rise over ${wl}: +${hi.m.toFixed(1)}% (${gp(p[hi.d - W])} → ${gp(p[hi.d])}, ending ${iso(hi.d)}).`);
        lines.push(`Biggest drop over ${wl}: ${lo.m.toFixed(1)}% (${gp(p[lo.d - W])} → ${gp(p[lo.d])}, ending ${iso(lo.d)}).`);
        lines.push(`Searched ${periodLabel}.`);
        break;
      }
      case 'month': { // 8. rise vs fall in a given month, each year
        const M = +q.month; if (!(M >= 1 && M <= 12)) return { error: 'Pick a month.' };
        const y0 = +iso(first).slice(0, 4), y1 = +iso(today).slice(0, 4), res = [];
        for (let y = y0; y <= y1; y++) {
          const a = dOf(`${y}-${String(M).padStart(2, '0')}-01`), b = M === 12 ? dOf(`${y + 1}-01-01`) - 1 : dOf(`${y}-${String(M + 1).padStart(2, '0')}-01`) - 1;
          if (a < first || b > today) continue; const m = mv(a, b); if (m != null) res.push({ y, m });
        }
        const mn = new Date(Date.UTC(2000, M - 1, 1)).toLocaleString('en', { month: 'long', timeZone: 'UTC' });
        if (!res.length) return { error: `No complete ${mn} in the saved history.` };
        const up = res.filter(r => r.m > 0.5).length, dn = res.filter(r => r.m < -0.5).length;
        lines.push(`In ${mn}, it rose in ${up} of ${res.length} years and fell in ${dn} (flat in ${res.length - up - dn}).`);
        lines.push(res.map(r => `${r.y}: ${r.m > 0 ? '+' : ''}${r.m.toFixed(1)}%`).join(' · '));
        break;
      }
      case 'date': { // 9. price on a date
        const D = dOf(q.date); if (isNaN(D)) return { error: 'Pick a date.' };
        if (D < first) return { error: `Saved history starts ${iso(first)}.` };
        let d = Math.min(D, today); while (d > first && !raw[d]) d--;
        lines.push(`${gp(p[d])} on ${iso(d)}${d !== D ? ` (closest saved day to ${q.date})` : ''}.`);
        const ch = (p[today] / p[d] - 1) * 100; lines.push(`Today: ${gp(p[today])} (${ch > 0 ? '+' : ''}${ch.toFixed(1)}% since).`);
        break;
      }
      case 'average': { // 10. average over a period
        if (!days.length) return { error: 'No prices in that period.' };
        const v = days.map(d => p[d]); const avg = v.reduce((a, b) => a + b, 0) / v.length;
        lines.push(`Average over ${periodLabel}: ${gp(avg)} (lowest ${gp(Math.min(...v))}, highest ${gp(Math.max(...v))}).`);
        lines.push(`Today: ${gp(p[today])} — ${((p[today] / avg - 1) * 100).toFixed(1)}% vs that average.`);
        break;
      }
      case 'thisMonth': { // 11. this month vs the same month in past years
        const t = iso(today), M = t.slice(5, 7), y1 = +t.slice(0, 4), dayN = +t.slice(8, 10);
        const avgOf = (a, b) => { const v = []; for (let d = a; d <= b; d++) if (p[d] > 0) v.push(p[d]); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };
        const now = avgOf(dOf(`${y1}-${M}-01`), today);
        const rows = [];
        for (let y = y1 - 1; y >= +iso(first).slice(0, 4) && rows.length < 6; y--) {
          const a = dOf(`${y}-${M}-01`), b = a + dayN - 1; if (a < first) break; const v = avgOf(a, b); if (v) rows.push({ y, v });
        }
        const mn = new Date(Date.UTC(2000, +M - 1, 1)).toLocaleString('en', { month: 'long', timeZone: 'UTC' });
        lines.push(`${mn} ${y1} so far (${dayN} days): average ${gp(now)}.`);
        lines.push(rows.length ? 'Same days in past years: ' + rows.map(r => `${r.y} ${gp(r.v)} (${now > r.v ? '+' : ''}${((now / r.v - 1) * 100).toFixed(0)}%)`).join(' · ') : 'No earlier years to compare.');
        break;
      }
      case 'dxp': { // 12. around Double XP weekends
        const ev = (await storage.readJSON(path.join(dataDir, 'dxp_events.json'), [])).map(([a, s, e]) => ({ a: dOf(a), s: dOf(s), e: dOf(e), label: s }))
          .filter(x => x.a - 30 >= first && x.e + 14 <= today).sort((x, y) => x.s - y.s);
        if (!ev.length) return { error: 'No DXP weekends inside this item\'s saved history.' };
        const rel2 = (d0, d1) => { const m = mv(d0, d1), k = mkt(d0, d1); return m == null || k == null ? null : m - k; };
        const pre = [], dur = [], post = [];
        for (const x of ev) { const a = rel2(x.a - 30, x.s), b = rel2(x.s, x.e), c = rel2(x.e, x.e + 14); if (a != null) pre.push(a); if (b != null) dur.push(b); if (c != null) post.push(c); }
        const sm = (v, lbl) => { const m = med(v), up = v.filter(x => x > 0.5).length, dn = v.filter(x => x < -0.5).length; return `${lbl}: median ${m > 0 ? '+' : ''}${m.toFixed(1)}% vs market — up in ${up}, down in ${dn} of ${v.length}`; };
        lines.push(`Across ${ev.length} DXP weekends (moves compared with the overall market):`);
        if (pre.length) lines.push(sm(pre, '30 days before the start → start'));
        if (dur.length) lines.push(sm(dur, 'During the event'));
        if (post.length) lines.push(sm(post, '2 weeks after it ends'));
        break;
      }
      case 'update': { // 13. after a specific game update
        const evs = await getEvents(); const e = evs.find(x => x.id === q.eventId);
        if (!e) return { error: 'Pick a game update.' };
        const rm = e.milestones.find(m => m.type === 'release'); if (!rm) return { error: 'That update has no release date yet.' };
        const R = dOf(rm.date); if (R < first + 30) return { error: `This item's history starts after that update (${iso(first)}).` };
        const rel2 = (d0, d1) => { if (d1 > today) return null; const m = mv(d0, d1), k = mkt(d0, d1); return m == null || k == null ? null : { m, mk: k }; };
        lines.push(`${e.name} — released ${rm.date}.`);
        for (const [lbl, a, b] of [['30 days before', R - 30, R], ['Week after', R, R + 7], ['Month after', R, R + 30], ['3 months after', R, R + 90]]) {
          const r = rel2(a, b); if (!r) { lines.push(`${lbl}: not happened yet.`); continue; }
          lines.push(`${lbl}: ${r.m > 0 ? '+' : ''}${r.m.toFixed(1)}% (market ${r.mk > 0 ? '+' : ''}${r.mk.toFixed(1)}%).`);
        }
        lines.push('One update on its own is a single case — compare with others before reading a pattern into it.');
        break;
      }
      case 'volume': { // 14. how often daily volume was above X
        const pts = (await getHistoryPoints(String(itemId))) || [];
        if (!dirtyHistoryIds.has(String(itemId))) delete historyData[String(itemId)];
        const V = +q.volume; if (!(V > 0)) return { error: 'Enter a volume.' };
        const vs = pts.map(pt => ({ d: Math.floor((pt.timestamp > 1e12 ? pt.timestamp : pt.timestamp * 1000) / DAYMS) - day0, v: pt.volume })).filter(x => x.v > 0 && x.d >= from);
        const k = vs.filter(x => x.v >= V).length;
        lines.push(`Daily volume was ${V.toLocaleString()} or more on ${pc(k, vs.length)} in ${periodLabel}${vs.length ? ` (${(k / vs.length * 100).toFixed(1)}%)` : ''}.`);
        const top = [...vs].sort((a, b) => b.v - a.v)[0]; if (top) lines.push(`Busiest day: ${top.v.toLocaleString()} on ${iso(top.d)}.`);
        break;
      }
      case 'volumeNow': { // 15. is it more traded than usual
        const pts = (await getHistoryPoints(String(itemId))) || [];
        if (!dirtyHistoryIds.has(String(itemId))) delete historyData[String(itemId)];
        const vd = new Map(); for (const pt of pts) if (pt.volume > 0) vd.set(Math.floor((pt.timestamp > 1e12 ? pt.timestamp : pt.timestamp * 1000) / DAYMS) - day0, pt.volume);
        const wk = d => { let s = 0, c = 0; for (let j = d - 6; j <= d; j++) if (vd.has(j)) { s += vd.get(j); c++; } return c >= 4 ? s / c : null; };
        const now = wk(today); if (now == null) return { error: 'Not enough recent volume data.' };
        const past = []; for (let d = today - 7; d >= Math.max(first, today - 365); d -= 7) { const w = wk(d); if (w != null) past.push(w); }
        const rank = past.filter(w => w < now).length;
        lines.push(`This week: about ${Math.round(now).toLocaleString()} a day.`);
        lines.push(past.length ? `That's higher than ${rank} of the last ${past.length} weeks${rank === past.length ? ' — the busiest week of the year' : rank === 0 ? ' — the quietest week of the year' : ''}. Typical week: ${Math.round(med(past)).toLocaleString()} a day.` : 'No earlier weeks to compare.');
        break;
      }
      case 'flip': { // 16. would a buy at X and sell at Y both have filled in the same week?
        const B = +q.buy, S = +q.sell; if (!(B > 0 && S > 0)) return { error: 'Enter a buy and a sell price.' };
        const ts = await getItemLiveTimeseries(itemId, '1y').catch(() => null);
        const live = (ts || []).filter(x => x.instabuy != null || x.instasell != null);
        if (live.length < 14) return { error: 'This needs live prices, and there are fewer than 14 days of them for this item.' };
        const byWeek = new Map();
        for (const x of live) { const w = Math.floor((x.timestamp / DAYMS - 4) / 7); const r = byWeek.get(w) || { lowSell: Infinity, highBuy: 0 }; if (x.instasell != null) r.lowSell = Math.min(r.lowSell, x.instasell); if (x.instabuy != null) r.highBuy = Math.max(r.highBuy, x.instabuy); byWeek.set(w, r); }
        const weeks = [...byWeek.values()]; const both = weeks.filter(r => r.lowSell <= B && r.highBuy >= S).length;
        const buyOk = weeks.filter(r => r.lowSell <= B).length, sellOk = weeks.filter(r => r.highBuy >= S).length;
        const net = saleNet(S, 1) - B;
        lines.push(`Using live daily averages since ${new Date(live[0].timestamp).toISOString().slice(0, 10)} (${weeks.length} weeks):`);
        lines.push(`A buy at ${gp(B)} could have filled in ${buyOk} weeks, a sell at ${gp(S)} in ${sellOk}, and both in the same week in ${both}.`);
        lines.push(`Profit per item after GE tax: ${net >= 0 ? '' : '−'}${gp(Math.abs(net))}. Daily averages hide the intraday swings, so real fills can be better or worse.`);
        break;
      }
      default: return { error: 'Unknown question.' };
    }
    return { lines, asOf: iso(today) };
  }

  // Phases for an event from its milestone dates. Pre-first-milestone is the
  // 30 days before it; then each consecutive pair; then release day (day
  // before → day after), week after, month after.
  function eventPhases(event) {
    const DAY = 86400000;
    const ms = event.milestones.map(m => ({ ...m, t: new Date(m.date + 'T12:00:00').getTime() }));
    if (!ms.length) return [];
    const phases = [{ key: 'before', label: `30 days before ${ms[0].type === 'release' ? 'release' : 'first news'}`, from: ms[0].t - 30 * DAY, to: ms[0].t }];
    const rel = ms.find(m => m.type === 'release');
    const pre = rel ? ms.filter(m => m.t <= rel.t) : ms;
    for (let i = 0; i + 1 < pre.length; i++) {
      phases.push({ key: 'm' + i, label: `${pre[i].type.replace('_', ' ')} → ${pre[i + 1].type.replace('_', ' ')}`, from: pre[i].t, to: pre[i + 1].t });
    }
    if (rel) {
      phases.push({ key: 'release_day', label: 'Release day', from: rel.t - DAY, to: rel.t + DAY });
      phases.push({ key: 'week', label: 'Week after', from: rel.t, to: rel.t + 7 * DAY });
      phases.push({ key: 'month', label: 'Month after', from: rel.t, to: rel.t + 30 * DAY });
    }
    return phases;
  }

  async function getEventImpact(eventId) {
    const event = (await getEvents()).find(e => e.id === String(eventId));
    if (!event) return null;
    const parsed = await storage.readJSON(dataFile, null);
    const byName = new Map((parsed?.items || []).map(it => [it.name.toLowerCase(), it]));
    const now = Date.now();
    const phases = eventPhases(event).map(ph => ({ ...ph, pending: ph.to > now }));
    for (const ph of phases) ph.market = ph.pending ? null : await marketChange(ph.from, ph.to);
    const rows = [];
    for (const name of event.items) {
      const it = byName.get(name.toLowerCase());
      if (!it) { rows.push({ name, missing: true, phases: {} }); continue; }
      const series = await dailySeries(it.id);
      const out = {};
      for (const ph of phases) {
        if (ph.pending) { out[ph.key] = null; continue; }
        const a = priceOn(series, ph.from), b = priceOn(series, ph.to);
        out[ph.key] = a && b ? (b - a) / a * 100 : null;
      }
      rows.push({ name: it.name, id: it.id, phases: out });
    }
    const cw = await categoryWatch(event, phases, parsed?.items || []);
    const newItems = await newItemsFor(event, parsed?.items || []);
    return { event, phases, rows, categoryWatch: cw, newItems,
      links: await eventLinks(event, [...rows.filter(r => r.id).map(r => r.id), ...(newItems || []).map(r => r.id), ...(cw?.rows || []).map(r => r.id)]) };
  }

  // New links an update created (Ben, 2026-10-06). Only items the SAME
  // update touched are compared (named items, drops, new items, category
  // movers — a few dozen, not 7,400), which is what keeps a short window
  // from filling up with coincidences (a whole-catalogue version matched
  // Maple longbows with Kebabs). A pair counts as a new link when its daily
  // moves in the 90 days after release match closely (≥0.6 over 40+ days)
  // but did NOT match in the 180 days before the update's first news.
  // Daily moves have the pool's own median move removed each day, so a
  // market-wide swing doesn't link everything.
  const eventLinksCache = new Map();
  async function eventLinks(event, ids) {
    const rel = event.milestones.find(m => m.type === 'release');
    if (!rel) return null;
    const DAY = 86400000;
    const relT = new Date(rel.date + 'T12:00:00').getTime();
    if (Date.now() - relT < 30 * DAY) return { pending: true, pairs: [] };
    const firstT = new Date(event.milestones[0].date + 'T12:00:00').getTime();
    // Cosmetics launch alongside updates (holiday items, MTX) without being
    // part of them — they produced links like Santa hats ↔ Black yo-yo.
    const cosmetic = new Set(((await storage.readJSON(dataFile, null))?.items || [])
      .filter(it => (it.categories || []).includes('cosmetics')).map(it => it.id));
    const pool = [...new Set(ids)].filter(id => !cosmetic.has(id)).slice(0, 80);
    const key = event.id + ':' + pool.join(',');
    if (eventLinksCache.has(key)) return eventLinksCache.get(key);
    const after = [relT, Math.min(Date.now(), relT + 90 * DAY)];
    const before = [firstT - 180 * DAY, firstT];
    // Daily moves per item per window, keyed by day index.
    const moves = async (id, [from, to]) => {
      const series = (await dailySeries(id)).filter(pt => pt.t >= from - DAY && pt.t <= to);
      const m = new Map();
      for (let i = 1; i < series.length; i++) {
        const a = series[i - 1].p, b = series[i].p;
        if (a && b) m.set(Math.floor(series[i].t / DAY), (b - a) / a);
      }
      return m;
    };
    const A = {}, B = {};
    for (const id of pool) { A[id] = await moves(id, after); B[id] = await moves(id, before); }
    const demean = M => {
      const byDay = new Map();
      for (const m of Object.values(M)) for (const [d, v] of m) { if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(v); }
      const med = new Map([...byDay].map(([d, v]) => [d, v.sort((x, y) => x - y)[Math.floor(v.length / 2)]]));
      for (const m of Object.values(M)) for (const [d, v] of m) m.set(d, Math.max(-0.15, Math.min(0.15, v - med.get(d))));
    };
    demean(A); demean(B);
    const corr = (x, y, minN) => {
      let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
      for (const [d, a] of x) {
        if (!y.has(d)) continue;
        const b = y.get(d);
        if (a === 0 && b === 0) continue;
        n++; sx += a; sy += b; sxx += a * a; syy += b * b; sxy += a * b;
      }
      if (n < minN) return null;
      const cov = sxy - sx * sy / n, vx = sxx - sx * sx / n, vy = syy - sy * sy / n;
      return vx > 0 && vy > 0 ? { r: cov / Math.sqrt(vx * vy), n } : null;
    };
    const parsed = await storage.readJSON(dataFile, null);
    const nameOf = new Map((parsed?.items || []).map(it => [it.id, it.name]));
    const pairs = [];
    for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) {
      const now = corr(A[pool[i]], A[pool[j]], 40);
      if (!now || now.r < 0.6) continue;
      const was = corr(B[pool[i]], B[pool[j]], 20);
      if (was && was.r >= 0.3) continue;   // already moved together before
      pairs.push({ a: pool[i], b: pool[j], aName: nameOf.get(pool[i]), bName: nameOf.get(pool[j]), corr: now.r, days: now.n, before: was ? was.r : null });
    }
    pairs.sort((x, y) => y.corr - x.corr);
    const result = { scanned: pool.length, pairs: pairs.slice(0, 12) };
    eventLinksCache.set(key, result);
    return result;
  }

  // Items that launched WITH an update (Ben, 2026-10-06): first GE price
  // within -2..+5 days of release. They have no "before" price, so they're
  // tracked from their first price instead — Ben's rule of thumb is they
  // spike on release and mostly fade within a month or two.
  const NEW_ITEM_POINTS = [['d7', 7], ['d30', 30], ['d60', 60]];
  async function newItemsFor(event, allItems) {
    const rel = event.milestones.find(m => m.type === 'release');
    if (!rel) return null;
    const relT = new Date(rel.date + 'T12:00:00').getTime();
    const DAY = 86400000;
    // Fallback for items with no saved history file (released after the
    // one-time backfill): their first daily snapshot — but only if it's
    // clearly after snapshots began, otherwise it's just the retention edge.
    let snapStart = Infinity;
    for (const arr of Object.values(snapshotData)) if (arr.length && arr[0].t < snapStart) snapStart = arr[0].t;
    const firstSeen = it => {
      if (historyFirstTs[String(it.id)] != null) return historyFirstTs[String(it.id)];
      const arr = snapshotData[String(it.id)];
      return arr && arr.length && arr[0].t > snapStart + 3 * 86400 ? arr[0].t * 1000 : null;
    };
    const out = [];
    for (const it of allItems) {
      if (it.untradeable || !it.id) continue;
      const f = firstSeen(it);
      if (f == null || f < relT - 2 * DAY || f > relT + 5 * DAY) continue;
      // Cosmetics/override tokens launch alongside updates (MTX, events)
      // but aren't part of them; skip.
      if ((it.categories || []).includes('cosmetics') || /token|override|ornament kit/i.test(it.name)) continue;
      const series = await dailySeries(it.id);
      if (!series.length) continue;
      const p0 = series[0].p;
      // An item whose price never moved in its first two months never
      // really traded (Jagex's opening price, untouched) — not a signal.
      const early = series.filter(pt => pt.t <= series[0].t + 60 * DAY);
      if (early.every(pt => pt.p === p0)) continue;
      const row = { name: it.name, id: it.id, first: p0, firstDate: series[0].t };
      for (const [k, d] of NEW_ITEM_POINTS) {
        const t = series[0].t + d * DAY;
        if (t > Date.now()) { row[k] = null; continue; }
        const p = priceOn(series, t);
        row[k] = p ? (p - p0) / p0 * 100 : null;
      }
      // Peak in the first week, as % above the first price.
      const wk = series.filter(pt => pt.t <= series[0].t + 7 * DAY);
      row.peak7 = (Math.max(...wk.map(pt => pt.p)) - p0) / p0 * 100;
      out.push(row);
    }
    out.sort((a, b) => b.first - a.first);
    return out;
  }

  // Almanac Launches tab (2026-10-28): every Game Updates release since live
  // prices began, with ALL its new items (newItemsFor), corrected by the
  // curated data/launches.json (see its _about). Item ids/names only; the UI
  // fetches live price curves itself. Cached: newItemsFor reads history.
  const LAUNCHES_FROM = '2026-07-15'; // live instant-trade prices start 2026-07-22
  let launchesCache = null;
  async function getLaunches() {
    if (launchesCache && Date.now() - launchesCache.at < 30 * 60000) return launchesCache.releases;
    const curated = require('./data/launches.json').releases;
    const parsed = await storage.readJSON(dataFile, null);
    const sameRelease = (c, name, date) => c.date === date &&
      (c.name.toLowerCase().startsWith(name.toLowerCase()) || name.toLowerCase().startsWith(c.name.toLowerCase()));
    const out = [], used = new Set();
    for (const ev of await getEvents()) {
      const rel = (ev.milestones || []).find(m => m.type === 'release');
      if (!rel || rel.date < LAUNCHES_FROM) continue;
      const c = curated.find(c => !used.has(c) && sameRelease(c, ev.name, rel.date));
      if (c) used.add(c);
      const auto = (await newItemsFor(ev, parsed?.items || [])) || [];
      out.push({ ...(c || {}), id: ev.id, name: ev.name, date: rel.date, kind: c?.kind || ev.type,
        newItems: [...(c?.newItems || []), ...auto.map(r => ({ id: r.id, name: r.name }))] });
    }
    for (const c of curated) if (!used.has(c)) out.push({ ...c, id: c.id || c.name, newItems: c.newItems || [] });
    // A curated release's own newItems claim those ids from every other card.
    const claimedBy = new Map();
    for (const c of curated) for (const it of c.newItems || []) claimedBy.set(it.id, c);
    for (const r of out) {
      const mine = curated.find(c => sameRelease(c, r.name, r.date));
      const exclude = new Set(mine?.exclude || []);
      const seen = new Set();
      r.newItems = r.newItems.filter(it => {
        if (seen.has(it.id) || exclude.has(it.id)) return false;
        seen.add(it.id);
        const owner = claimedBy.get(it.id);
        return !owner || owner === mine;
      });
    }
    const releases = out.filter(r => r.newItems.length || (r.watch || []).length)
      .sort((a, b) => b.date.localeCompare(a.date));
    launchesCache = { at: Date.now(), releases };
    return releases;
  }

  // Ben's rule across every event: of the new items with a 60-day price,
  // how many ended below their first price, and the median change.
  async function getNewItemsSummary() {
    const parsed = await storage.readJSON(dataFile, null);
    const all = [];
    for (const ev of await getEvents()) {
      const rows = await newItemsFor(ev, parsed?.items || []);
      for (const r of rows || []) all.push({ ...r, event: ev.name });
    }
    const med = arr => { const a = arr.filter(v => v != null).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };
    const with60 = all.filter(r => r.d60 != null);
    return {
      items: all.length, events: new Set(all.map(r => r.event)).size,
      with60: with60.length, belowAt60: with60.filter(r => r.d60 < 0).length,
      median: { d7: med(all.map(r => r.d7)), d30: med(all.map(r => r.d30)), d60: med(all.map(r => r.d60)) },
      exceptions: with60.filter(r => r.d60 > 0).sort((a, b) => b.d60 - a.d60).slice(0, 10)
        .map(r => ({ name: r.name, id: r.id, event: r.event, d60: r.d60 })),
    };
  }

  // Every item in the event's watched categories (boss events: PVM
  // supplies, ammo, runes), ranked by its biggest move relative to the
  // market in any finished phase — so the real movers surface even when
  // no news post named them. Cached per event setup for the session.
  const categoryWatchCache = new Map();
  async function categoryWatch(event, phases, allItems) {
    const cats = event.type === 'boss' ? [...new Set([...BOSS_CATEGORIES, ...(event.categories || [])])] : (event.categories || []);
    if (!cats.length) return null;
    const done = phases.filter(ph => !ph.pending && ph.market != null);
    if (!done.length) return { categories: cats, rows: [] };
    const key = event.id + JSON.stringify([cats, event.milestones, event.items]);
    if (categoryWatchCache.has(key)) return categoryWatchCache.get(key);
    const named = new Set(event.items.map(n => n.toLowerCase()));
    const pool = allItems.filter(it => !it.untradeable && it.id && !named.has(it.name.toLowerCase())
      && (it.categories || []).some(c => cats.includes(c)) && historyPopulatedIds.has(String(it.id)));
    const rows = [];
    let n = 0;
    const DAY = 86400000;
    const firstMs = Math.min(...phases.map(ph => ph.from));
    for (const it of pool) {
      const series = await dailySeries(it.id);
      const out = {};
      const z = {};
      let best = 0;
      for (const ph of phases) {
        if (ph.pending) { out[ph.key] = null; continue; }
        const a = priceOn(series, ph.from), b = priceOn(series, ph.to);
        out[ph.key] = a && b ? (b - a) / a * 100 : null;
        // Only short phases rank items: a year-long roadmap → release gap
        // soaks up unrelated updates in between (Amascut's caught the 110
        // Runecrafting talisman spike), drowning out the event's own effect.
        const len = ph.to - ph.from;
        if (out[ph.key] == null || ph.market == null || len > 60 * DAY) continue;
        // "Unusual for this item" (Ben, 2026-10-06): coincidental movers
        // were topping the list. Compare the move with this item's own
        // moves over same-length windows in the year before the event —
        // a habitually jumpy item moving 20% scores low, a normally flat
        // one moving 15% scores high. z = move / typical move size.
        // Moves under 5% beyond the market aren't worth flagging however
        // calm the item usually is.
        if (Math.abs(out[ph.key] - ph.market) < 5) continue;
        const usual = typicalMove(series, len, firstMs - 365 * DAY, firstMs);
        if (usual == null) continue;
        z[ph.key] = (out[ph.key] - ph.market) / usual;
        best = Math.max(best, Math.abs(z[ph.key]));
      }
      if (best > 0) rows.push({ name: it.name, id: it.id, phases: out, z, score: best });
      if (++n % 25 === 0) await new Promise(r => setTimeout(r, 0));
    }
    rows.sort((a, b) => b.score - a.score);
    const result = { categories: cats, scanned: pool.length, rows: rows.slice(0, 30) };
    categoryWatchCache.set(key, result);
    return result;
  }

  // ─── Similar items ────────────────────────────────────────────────────────
  // (Ben, 2026-10-06) Which items' prices move together. Built once a day in
  // the background: every item's weekly % change over the last two years
  // (from saved history + snapshots), with the whole market's weekly move
  // subtracted first — otherwise everything "correlates" during a market-
  // wide crash or DXP. Queries are then just correlations against that
  // compact table, no history reading.
  const SIM_WEEKS = 104;
  const SIM_MIN_WEEKS = 26;     // weeks with a real move for an item to be included
  const SIM_MATCH_WEEKS = 40;   // shared weeks needed for two items to be compared
  let simTable = null;          // { built, ids: [...], names: {...}, r: {id: [..]} }
  let simBuilding = false;

  async function buildSimilarityTable() {
    if (simBuilding) return;
    simBuilding = true;
    try {
      const parsed = await storage.readJSON(dataFile, null);
      const items = (parsed?.items || []).filter(it => !it.untradeable && it.id && (it.high || it.low) > 0);
      const WEEK = 7 * 86400000;
      const end = Math.floor(Date.now() / WEEK) * WEEK;
      const weekEnds = Array.from({ length: SIM_WEEKS + 1 }, (_, i) => end - (SIM_WEEKS - i) * WEEK);
      const raw = {}, names = {};
      let n = 0;
      for (const it of items) {
        const series = await dailySeries(it.id);
        if (series.length < 30) continue;
        const prices = weekEnds.map(t => priceOn(series, t));
        const rets = [];
        let moving = 0;
        for (let i = 1; i < prices.length; i++) {
          const a = prices[i - 1], b = prices[i];
          const v = a && b ? (b - a) / a : null;
          if (v) moving++;
          rets.push(v == null ? null : Math.round(v * 10000) / 10000);
        }
        if (moving < SIM_MIN_WEEKS) continue;   // barely trades / flat guide price
        raw[it.id] = rets; names[it.id] = it.name;
        if (++n % 50 === 0) await new Promise(r => setTimeout(r, 0));
      }
      // Remove the market: subtract each week's median move across items.
      const ids = Object.keys(raw);
      for (let w = 0; w < SIM_WEEKS; w++) {
        const col = ids.map(id => raw[id][w]).filter(v => v != null).sort((a, b) => a - b);
        const med = col.length ? col[Math.floor(col.length / 2)] : 0;
        for (const id of ids) if (raw[id][w] != null) raw[id][w] = Math.round((raw[id][w] - med) * 10000) / 10000;
      }
      simTable = { built: Date.now(), names, r: raw };
      await storage.writeJSON(similarityFile, simTable);
      console.log(`[similar] Built weekly-move table for ${ids.length} items`);
    } catch (e) {
      console.error('[similar] Build failed:', e.message);
    } finally {
      simBuilding = false;
    }
  }

  // Daily Almanac recompute (Ben, 2026-10-07): GEnius often stays open for
  // days, so a newly announced DXP (picked up by the daily wiki check) and
  // the day's refreshed history get folded in without a manual Refresh.
  async function maybeRefreshAlmanac() {
    if (dxpIntelInFlight || Date.now() - dxpIntelComputedAt < 24 * 3600000) return;
    await getDxpIntelligence({ forceFresh: true });
  }

  // Rebuilds at most once a day; called after the background history refresh.
  async function maybeBuildSimilarityTable() {
    if (!simTable) simTable = await storage.readJSON(similarityFile, null);
    if (simTable && Date.now() - simTable.built < 24 * 3600000) return;
    await buildSimilarityTable();
  }

  async function getSimilarItems(itemId) {
    if (!simTable) simTable = await storage.readJSON(similarityFile, null);
    if (!simTable) { maybeBuildSimilarityTable().catch(() => {}); return { pending: true, together: [], opposite: [] }; }
    const me = simTable.r[String(itemId)];
    if (!me) return { together: [], opposite: [], tooFlat: true };
    const out = [];
    // Each week's move is capped at ±15%: otherwise a single shared spike
    // week (two unrelated items both jumping once) dominates the whole
    // correlation and they "match" despite having nothing in common.
    const cap = v => v == null ? null : Math.max(-0.15, Math.min(0.15, v));
    for (const [id, other] of Object.entries(simTable.r)) {
      if (id === String(itemId)) continue;
      let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
      for (let w = 0; w < me.length; w++) {
        const x = cap(me[w]), y = cap(other[w]);
        if (x == null || y == null || (x === 0 && y === 0)) continue;
        n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
      }
      if (n < SIM_MATCH_WEEKS) continue;
      const cov = sxy - sx * sy / n, vx = sxx - sx * sx / n, vy = syy - sy * sy / n;
      if (vx <= 0 || vy <= 0) continue;
      out.push({ id: Number(id), name: simTable.names[id], corr: cov / Math.sqrt(vx * vy), weeks: n });
    }
    out.sort((a, b) => b.corr - a.corr);
    return {
      built: simTable.built,
      together: out.filter(o => o.corr >= 0.4).slice(0, 10),
      opposite: out.filter(o => o.corr <= -0.3).slice(-5).reverse(),
    };
  }



  // Root-mean-square % change of an item over windows of `len` ms, stepped
  // weekly across [fromMs, toMs]. Floors at 2% so a dead-flat item can't
  // turn a tiny wobble into an enormous score. null if too little data.
  function typicalMove(series, len, fromMs, toMs) {
    const moves = [];
    for (let t = fromMs; t + len <= toMs; t += 7 * 86400000) {
      const a = priceOn(series, t), b = priceOn(series, t + len);
      if (a && b) moves.push((b - a) / a * 100);
    }
    if (moves.length < 8) return null;
    const rms = Math.sqrt(moves.reduce((s2, m) => s2 + m * m, 0) / moves.length);
    return Math.max(2, rms);
  }

  // Tradeable drops from content pages (boss / loot-table wiki pages), via
  // the same drop-table reader Monster Lookup uses.
  async function getContentDrops(pages) {
    const parsed = await storage.readJSON(dataFile, null);
    const byName = new Map((parsed?.items || []).filter(it => !it.untradeable).map(it => [it.name.toLowerCase(), it.name]));
    const out = [], perPage = {};
    for (const pg of (pages || []).slice(0, 20)) {
      const r = await getMonsterDrops(pg).catch(() => null);
      const drops = (r && (r.drops || r.items || (Array.isArray(r) ? r : []))) || [];
      const names = drops.map(d => byName.get(String(d.name || d.item || '').toLowerCase())).filter(Boolean);
      perPage[pg] = names.length;
      out.push(...names);
    }
    return { items: [...new Set(out)], perPage };
  }

  // Required + recommended items from a quest's wiki page (its Quest
  // details infobox), matched to GEnius items. Release-day prices of quest
  // items can get silly (a shop-bought dye going for 10k+), so quest events
  // watch them.
  async function getQuestItems(questName) {
    try {
      const url = 'https://runescape.wiki/api.php?' + new URLSearchParams({ action: 'parse', page: String(questName), prop: 'wikitext', format: 'json', redirects: '1' });
      const res = await fetch(url, { headers: { 'User-Agent': 'GEnius/1.3 (github.com/VonDerThWood/GE-Intelligence)' }, signal: AbortSignal.timeout(15000) });
      const text = (await res.json())?.parse?.wikitext?.['*'];
      if (!text) return { found: false, required: [], recommended: [] };
      const section = name => {
        const m = text.match(new RegExp('\\|\\s*' + name + '\\s*=([\\s\\S]*?)(?=\\n\\s*\\|\\s*[a-zA-Z]+\\s*=|\\n}})'));
        return m ? m[1] : '';
      };
      const parsed = await storage.readJSON(dataFile, null);
      const byName = new Map((parsed?.items || []).filter(it => !it.untradeable).map(it => [it.name.toLowerCase(), it.name]));
      const itemsIn = chunk => [...new Set([...chunk.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)]
        .map(m => byName.get(m[1].trim().toLowerCase())).filter(Boolean))];
      return { found: true, required: itemsIn(section('items')), recommended: itemsIn(section('recommended')) };
    } catch (e) {
      return { found: false, error: e.message, required: [], recommended: [] };
    }
  }

  async function getPriceSnapshots(itemId) {
    return (snapshotData[String(itemId)] || []).map(s => ({timestamp: s.t, price: s.p, volume: s.v}));
  }

  // Untradeable items (Invention components, combo potions) never get a
  // real change_1d — untradeable.js always sets it null, since they never
  // touch the Grand Exchange and have no WeirdGloop history to diff
  // against. But their production cost DOES genuinely move day to day
  // (component/nature-rune prices shift), and GEnius already records that
  // in the same daily snapshotData every tradeable item uses — this just
  // reads back roughly a day-old snapshot and diffs it against the
  // current price, same "1d" semantics as a tradeable item's change_1d.
  function computeUntradeableChange1d(itemId, currentPrice) {
    const points = snapshotData[String(itemId)];
    if (!points || !points.length || !currentPrice) return null;
    const targetTs = Math.floor(Date.now() / 1000) - 20 * 3600; // ~20h ago — comfortably past today's own snapshot, short of a full 24h to tolerate fetch-cycle jitter
    const sorted = [...points].sort((a, b) => a.t - b.t);
    let ref = null;
    for (const p of sorted) {
      if (p.t <= targetTs) ref = p; else break;
    }
    if (!ref || !ref.p) return null;
    return ((currentPrice - ref.p) / ref.p) * 100;
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

  // Live per-item timeseries (Instabuy/Instasell over time + volume) — same
  // real-time API as getLiveItemPrice above, but the /timeseries endpoint
  // instead of /latest. Confirmed for real against the live API: the query
  // param is `lookback`, NOT `timestep` (despite that being the OSRS-era
  // name still floating around in some docs) — the SPA's own bundled JS
  // confirmed this, and only these 6 exact values are accepted (anything
  // else, including a plain day count like "90d", 400s as "lookback must
  // be a valid value"). Intended as a secondary, higher-resolution
  // supplement to the existing daily-granularity chart, not a replacement.
  const LIVE_TIMESERIES_LOOKBACKS = ['6h', '24h', '7d', '30d', '6m', '1y'];
  const LIVE_TIMESERIES_TTL_MS = 5 * 60 * 1000;
  const liveTimeseriesCache = new Map();
  async function getItemLiveTimeseries(itemId, lookback) {
    if (!itemId || !LIVE_TIMESERIES_LOOKBACKS.includes(lookback)) return null;
    const cacheKey = `${itemId}::${lookback}`;
    const cached = liveTimeseriesCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < LIVE_TIMESERIES_TTL_MS) return cached.result;

    let result = null;
    try {
      const url = `https://prices.runescape.wiki/api/v2/rs/timeseries?id=${itemId}&lookback=${lookback}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'GEnius/1.0 (github.com/VonDerThWood/GE-Intelligence)' },
        signal: AbortSignal.timeout(10000),
      });
      const json = await res.json();
      if (Array.isArray(json.data)) {
        result = json.data.map(p => ({
          timestamp: p.timestamp * 1000,
          instabuy: p.avgHighPrice ?? null,
          instasell: p.avgLowPrice ?? null,
          buyVolume: p.highPriceVolume ?? 0,
          sellVolume: p.lowPriceVolume ?? 0,
        }));
      }
    } catch { result = null; }

    liveTimeseriesCache.set(cacheKey, { result, fetchedAt: Date.now() });
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
  // Lower than MONSTER_DROPS_CAP: each product here costs an EXTRA wiki
  // fetch (its own Creation page), not just a regex pass over HTML
  // already in hand, so an item feeding dozens of recipes (Incandescent
  // energy, common bars/bolts/dyes, ...) would otherwise fire a burst of
  // requests just to render a detail panel.
  const ITEM_PRODUCTS_CAP = 15;

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

  function parseMonsterDrops(html, mode = 'normal', liveItemsByName = {}) {
    const hasHardMode = html.indexOf('id="Drops_(hard_mode)"') !== -1;
    const section = _extractModeSection(html, mode);
    if (section === null) {
      return { drops: [], estimatedGpPerKill: 0, estimatedGpPerKillLive: 0, gpPerKillSource: 'none', untradeableDropCount: 0, totalCount: 0, hadAnyTable: false, hasHardMode };
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
      return { drops: [], estimatedGpPerKill: wikiStatedGpPerKill || 0, estimatedGpPerKillLive: wikiStatedGpPerKill || 0, gpPerKillSource: wikiStatedGpPerKill ? 'wiki' : 'none', untradeableDropCount: 0, totalCount: 0, hadAnyTable: false, hasHardMode, unknownRarityCount: 0, unknownRarityValue: 0, unknownRarityValueLive: 0, hasLiveData: false };
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
    let unknownRarityCount = 0, unknownRarityValue = 0, unknownRarityValueLive = 0;

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
        // Cross-reference against GEnius's own live buy/sell catalogue by
        // exact (case-insensitive) item name, same lookup the row's
        // clickable-name link uses — falls back to the wiki's own GE price
        // whenever the item isn't tracked live or has no live price yet, so
        // the total is never missing a row just because live data is thin.
        const liveItem = liveItemsByName[item.toLowerCase()];
        // Drops get sold, so they're worth the live sell price, unless it's obviously broken.
        const liveGe = liveItem ? (liveItem.high ?? liveItem.low ?? null) : null;
        const liveSale = liveItem ? (liveItem.liveSell ?? null) : null;
        const livePricePerUnit = liveSale && (!liveGe || (liveSale <= liveGe * 5 && liveSale >= liveGe / 5)) ? liveSale : null;
        const effectivePricePerUnit = livePricePerUnit != null ? livePricePerUnit : gePricePerUnit;

        if (gePricePerUnit === null) untradeableDropCount++;
        else if (probability == null) {
          unknownRarityCount++;
          unknownRarityValue += gePricePerUnit;
          unknownRarityValueLive += effectivePricePerUnit;
        }

        const contribution = (probability != null && gePricePerUnit != null) ? avgQuantity * gePricePerUnit * probability : 0;
        const liveContribution = (probability != null && effectivePricePerUnit != null) ? avgQuantity * effectivePricePerUnit * probability : 0;
        // gePrice: per-unit price, used for sorting/contribution — comparable
        // across rows regardless of quantity. geValueText: the wiki's own
        // displayed total-value text (a range like "13,530–18,040" whenever
        // quantity is a range, or a single number when it's fixed) — shown
        // as-is in the UI rather than an "average" that loses the range Ben
        // specifically wanted kept visible. livePrice is null whenever
        // GEnius has no live price for this item, in which case the UI falls
        // back to displaying/summing the GE price instead.
        drops.push({ item, quantity, rarity, gePrice: gePricePerUnit, livePrice: livePricePerUnit, geValueText, contribution, liveContribution, probability });
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
    const computedGpPerKillLive = drops.reduce((sum, d) => sum + d.liveContribution, 0);
    const hasLiveData = drops.some(d => d.livePrice != null);
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
      unknownRarityCount, unknownRarityValue, unknownRarityValueLive, hasLiveData,
      estimatedGpPerKill: wikiStatedGpPerKill != null ? wikiStatedGpPerKill : computedGpPerKill,
      // When the wiki states its own gp/kill figure directly, that number
      // isn't built from these per-row prices at all, so there's no separate
      // "live" version of it to compute — both fields report the same wiki
      // total in that case, and the UI's GE/Live toggle has no effect on it.
      estimatedGpPerKillLive: wikiStatedGpPerKill != null ? wikiStatedGpPerKill : computedGpPerKillLive,
      gpPerKillSource: wikiStatedGpPerKill != null ? 'wiki' : 'computed',
      computedGpPerKill, computedGpPerKillLive,
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
      const liveItemsByName = Object.fromEntries(
        ((await getData()).items || []).map(i => [i.name.toLowerCase(), i])
      );
      result = { monsterName, mode, ...parseMonsterDrops(html, mode, liveItemsByName) };
    } catch (e) {
      result = { monsterName, mode, drops: [], estimatedGpPerKill: 0, estimatedGpPerKillLive: 0, untradeableDropCount: 0, totalCount: 0, hadAnyTable: false, hasHardMode: false, error: e.message };
    }

    monsterDropsCache.set(resultKey, result);
    return result;
  }

  // Item detail panel's "Turns into" block — reuses the wiki's own
  // "Products" table (same one shown on e.g. Dark Shard of Leng's page:
  // Augmented/dyed/Third Age variants alongside genuinely separate
  // items). Only surfaces rows whose output is (a) a distinct tradeable
  // item GEnius already tracks and (b) not a purely cosmetic reskin of
  // the same base item — Augmentor and "<Style> dye" materials are the
  // wiki's own signal for that, since every recolor/augment row's only
  // OTHER material besides the source item itself is one of those two.
  // The materials list (name + qty) lives inline in this same table as a
  // nested <table class="products-materials">, so no second page fetch
  // is needed for ingredient data.
  function _extractProductsSection(html) {
    const idx = html.indexOf('id="Products"');
    if (idx === -1) return null;
    const after = html.slice(idx);
    const closeIdx = after.indexOf('</h2>');
    const nextH2Idx = closeIdx === -1 ? -1 : after.indexOf('mw-heading2', closeIdx + 5);
    return nextH2Idx === -1 ? after : after.slice(0, nextH2Idx);
  }

  // Each row of the products-list table has a NESTED <table
  // class="products-materials"> inside its Materials cell, with its own
  // <tr> tags — a naive non-greedy <tr>...</tr> regex over the whole table
  // matches the FIRST </tr> it finds, which is one of THOSE inner rows,
  // silently truncating every outer row before the materials data (or
  // even the closing </table>) is ever reached. Confirmed for real
  // against Grimy marrentill: every row's materials table matched as
  // "not found" even though the raw HTML plainly had one. This walks the
  // table/tr tags with a nesting-depth counter instead, only treating a
  // <tr>/</tr> pair as a row boundary while depth is 0 (i.e. not inside
  // any nested table).
  function _splitTopLevelRows(tbodyHtml) {
    const rows = [];
    const re = /<table\b[^>]*>|<\/table>|<tr\b[^>]*>|<\/tr>/gi;
    let depth = 0, rowStart = -1, m;
    while ((m = re.exec(tbodyHtml)) !== null) {
      const tag = m[0].toLowerCase();
      if (tag.startsWith('<table')) depth++;
      else if (tag.startsWith('</table')) depth--;
      else if (tag.startsWith('<tr') && depth === 0 && rowStart === -1) rowStart = m.index;
      else if (tag === '</tr>' && depth === 0 && rowStart !== -1) {
        rows.push(tbodyHtml.slice(rowStart, re.lastIndex));
        rowStart = -1;
      }
    }
    return rows;
  }

  function parseItemProducts(html, itemName) {
    const section = _extractProductsSection(html);
    if (section === null) return { products: [], hadAnyTable: false };
    const tableMatch = section.match(/<table[^>]*class="[^"]*\bproducts-list\b[^"]*"[^>]*>([\s\S]*?)<\/table>\s*(?=<table|<div class="mw-heading|$)/);
    if (!tableMatch) return { products: [], hadAnyTable: false };

    const rows = _splitTopLevelRows(tableMatch[1]).slice(1); // drop the header row
    const byName = new Map();
    for (const rowHtml of rows) {
      const nameMatch = rowHtml.match(/<td data-sort-value="[^"]*">\s*[\d,]+\s*×\s*<a href="\/w\/[^"]+" title="([^"]+)">/);
      if (!nameMatch) continue;
      const productName = nameMatch[1];

      const matTableMatch = rowHtml.match(/<table class="products-materials"[^>]*>([\s\S]*?)<\/table>/);
      if (!matTableMatch) continue;
      const materials = [];
      for (const mr of matTableMatch[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
        const qtyMatch = mr[1].match(/([\d,]+)\s*×/);
        const matNameMatch = mr[1].match(/<a[^>]*>([^<]+)<\/a>/);
        if (!matNameMatch) continue;
        materials.push({
          name: matNameMatch[1].trim(),
          qty: qtyMatch ? parseFloat(qtyMatch[1].replace(/,/g, '')) : 1,
        });
      }
      if (!materials.length) continue;

      // Cosmetic reskin check: every OTHER material (besides the source
      // item itself) is Augmentor or a "<X> dye" — confirmed for real
      // against Dark Shard of Leng's own Products table, where every
      // dyed/Third Age/augmented row has exactly one such material and
      // nothing else alongside the source item.
      const others = materials.filter(m => m.name.toLowerCase() !== itemName.toLowerCase());
      const isCosmetic = others.length > 0 && others.every(m => m.name === 'Augmentor' || /\bdye$/i.test(m.name));
      if (isCosmetic) continue;

      // Some items have more than one row producing the SAME output (e.g.
      // Grimy marrentill -> Clean marrentill both by cleaning it yourself
      // via Herblore AND by paying an NPC 200gp to do it) — keep whichever
      // variant needs fewer materials, since that's the cheaper/simpler
      // path and there's no reason to show the same destination twice.
      const existing = byName.get(productName);
      if (!existing || materials.length < existing.materials.length) {
        byName.set(productName, { name: productName, materials });
      }
    }
    return { products: [...byName.values()], hadAnyTable: true };
  }

  const itemProductsHtmlCache = new Map();
  async function _fetchItemHtml(name) {
    let html = itemProductsHtmlCache.get(name);
    if (html) return html;
    const url = `https://runescape.wiki/w/${encodeURIComponent(name.replace(/ /g, '_'))}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'GEnius/1.0 (github.com/VonDerThWood/GE-Intelligence)' },
      signal: AbortSignal.timeout(10000),
    });
    html = await res.text();
    itemProductsHtmlCache.set(name, html);
    return html;
  }

  // A product's full ingredient list is only reliably complete on the
  // PRODUCT's own page (its "Creation" section's recipe-table infobox) —
  // confirmed for real (Ben, 2026-08-02): Dark Shard of Leng's own
  // Products-table row (on whichever single fragment item's page you're
  // looking at, e.g. Dark ice shard) only lists that ONE fragment as a
  // material, even though the real recipe needs THREE more (Glacor
  // remnants ×7500, Dark nilas ×10, Frozen core of Leng ×1 alongside it)
  // — those only show up in Dark Shard of Leng's own Creation section.
  // A page can have more than one method (e.g. Clean marrentill via
  // Herblore vs. paying Zahur) — takes the first, same "cheapest/
  // simplest wins" reasoning as the dedupe in parseItemProducts above.
  function _parseCreationMaterials(html) {
    const idx = html.indexOf('id="Creation"');
    if (idx === -1) return null;
    const tableMatch = html.slice(idx).match(/<table[^>]*class="[^"]*\binfobox-recipe\b[^"]*"[^>]*>([\s\S]*?)<\/table>/);
    if (!tableMatch) return null;
    const tbl = tableMatch[1];
    const matStart = tbl.indexOf('Material</th><th>Quantity</th><th>Cost</th>');
    if (matStart === -1) return null;
    const totalIdx = tbl.indexOf('Total cost', matStart);
    const matSection = totalIdx === -1 ? tbl.slice(matStart) : tbl.slice(matStart, totalIdx);
    const materials = [];
    for (const m of matSection.matchAll(/<a href="\/w\/[^"]+" title="([^"]+)">[^<]*<\/a>\s*<\/td>\s*<td class="ref-left"[^>]*>([\d,]+)<\/td>/g)) {
      materials.push({ name: m[1], qty: parseFloat(m[2].replace(/,/g, '')) });
    }
    return materials.length ? materials : null;
  }

  async function getItemProducts(itemName) {
    if (!itemName) return null;
    try {
      const html = await _fetchItemHtml(itemName);
      const { products, hadAnyTable } = parseItemProducts(html, itemName);

      // Prices are cross-referenced against GEnius's own live catalogue
      // fresh on every call rather than cached alongside the parsed
      // product/material structure above — the recipes themselves are
      // stable (worth caching the HTML for), but prices change
      // constantly, so baking them into a cached result would go stale
      // immediately.
      const liveItemsByName = Object.fromEntries(
        ((await getData()).items || []).map(i => [i.name.toLowerCase(), i])
      );
      const priceOf = name => {
        const it = liveItemsByName[name.toLowerCase()];
        if (!it) return null;
        return it.liveBuy ?? it.liveSell ?? it.high ?? it.low ?? null;
      };

      // Only tradeable, GEnius-tracked outputs are shown at all — filtered
      // (cheap: no extra fetch) before the cap below, so items with LOTS
      // of products (e.g. Incandescent energy, a Divination charge used
      // across dozens of recipes) don't get capped down to mostly
      // untradeable junk instead of the real tradeable ones.
      const tradeable = products.filter(p => liveItemsByName[p.name.toLowerCase()]);
      const totalCount = tradeable.length;
      const capped = tradeable.slice(0, ITEM_PRODUCTS_CAP);

      const priced = [];
      for (const p of capped) {
        // Prefer the product's own page's full recipe; fall back to the
        // single-row materials list from the source item's own Products
        // table (still correct for simple 1-material conversions like
        // Grimy -> Clean, just not guaranteed complete for multi-material
        // recipes) if the product's page has no parseable Creation table
        // OR that table's recipe doesn't actually consume the source item
        // at all — confirmed for real (Ben, 2026-08-02) on Compost: its
        // own Creation section documents ONE representative/generic
        // recipe (whatever herb the wiki editor happened to use as the
        // example), since compost bins accept almost any raw ingredient,
        // so grabbing it unconditionally attached a totally unrelated
        // (and much cheaper) cost to every herb's "turns into Compost"
        // row instead of that herb's own actual cost.
        let materialsList = p.materials;
        try {
          const prodHtml = await _fetchItemHtml(p.name);
          const full = _parseCreationMaterials(prodHtml);
          if (full && full.some(m => m.name.toLowerCase() === itemName.toLowerCase())) materialsList = full;
        } catch { /* fall back to p.materials below */ }

        const sellPrice = priceOf(p.name);
        let cost = 0, hasUnknownCost = false;
        const materials = materialsList.map(m => {
          const unitPrice = priceOf(m.name);
          if (unitPrice == null) hasUnknownCost = true;
          else cost += unitPrice * m.qty;
          return { ...m, unitPrice };
        });
        const profit = (sellPrice != null && !hasUnknownCost)
          ? Math.floor(sellPrice < 50 ? sellPrice : sellPrice * 0.98) - cost
          : null;
        priced.push({ name: p.name, materials, sellPrice, cost, hasUnknownCost, profit });
      }

      return { itemName, products: priced, hadAnyTable, totalCount };
    } catch (e) {
      return { itemName, products: [], hadAnyTable: false, totalCount: 0, error: e.message };
    }
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
      day_date: localDateStr(n),
      week_date: getWeekStr(n),
      month_date: localDateStr(n).slice(0,7) };
  }

  async function readPortfolio() {
    return storage.readJSON(portfolioFile, { positions:[], tax_stats:defaultTaxStats() });
  }

  async function writePortfolio(data) {
    await storage.writeJSON(portfolioFile, data, { pretty: true });
  }

  function resetTaxIfNeeded(stats) {
    const n = new Date();
    const today = localDateStr(n);
    const week  = getWeekStr(n);
    const month = today.slice(0,7);
    if (stats.day_date   !== today) { stats.today_tax  = 0; stats.day_date   = today; }
    if (stats.week_date  !== week)  { stats.week_tax   = 0; stats.week_date  = week;  }
    if (stats.month_date !== month) { stats.month_tax  = 0; stats.month_date = month; }
    return stats;
  }

  async function getPortfolio() {
    // resetTaxIfNeeded used to only ever run inside sellPosition, right
    // when a NEW sale happened — so a stretch with zero sales meant the
    // day/week/month buckets just sat frozen at whatever the last real
    // sale was, indefinitely, since nothing else ever re-checked the
    // date (Ben, 2026-09-09: "I haven't sold anything in like a week...
    // Today/Week/Month all showing the same 1.22M"). Running the same
    // check on every plain read fixes that — the buckets now correctly
    // zero out once their window has actually passed, sale or no sale.
    const p = await readPortfolio();
    if (p.tax_stats) {
      const before = JSON.stringify(p.tax_stats);
      p.tax_stats = resetTaxIfNeeded(p.tax_stats);
      if (JSON.stringify(p.tax_stats) !== before) await writePortfolio(p);
    }
    return p;
  }

  async function savePosition(position) {
    const p = await readPortfolio();
    const idx = p.positions.findIndex(x => x.id === position.id);
    if (idx >= 0) p.positions[idx] = position; else p.positions.push(position);
    await writePortfolio(p);
    return { success: true };
  }

  // ─── Buy planner ──────────────────────────────────────────────────────────
  // Goals for slowly accumulating an item under its GE buy limit (Ben,
  // 2026-10-06, from the dragon hatchet grind). Stored inside the portfolio
  // file so backups/imports carry them. The user only ever enters RUNNING
  // TOTALS (total bought + total gp spent, both shown on the GE offer) —
  // individual fill prices aren't visible in-game, and the average is exact
  // from the totals anyway. Each update is kept as a timestamped snapshot,
  // which is what the "your pace" estimate is computed from.
  async function getBuyGoals() {
    const p = await readPortfolio();
    return p.buy_goals || [];
  }

  async function saveBuyGoal(goal) {
    const p = await readPortfolio();
    p.buy_goals = p.buy_goals || [];
    const idx = p.buy_goals.findIndex(g => g.id === goal.id);
    if (idx >= 0) p.buy_goals[idx] = { ...p.buy_goals[idx], ...goal };
    else p.buy_goals.push({ bought: 0, spent: 0, history: [], linked: true, notify: false, market_share: 25,
      created_at: new Date().toISOString(), ...goal });
    await writePortfolio(p);
    return { success: true };
  }

  async function deleteBuyGoal(id) {
    const p = await readPortfolio();
    p.buy_goals = (p.buy_goals || []).filter(g => g.id !== id);
    // The position stays (it's real gp you hold) — it just stops being
    // planner-managed and goes back to normal manual editing.
    for (const pos of p.positions) if (pos.planner_goal_id === id) delete pos.planner_goal_id;
    await writePortfolio(p);
    return { success: true };
  }

  // Linked goals own their position's quantity + cost basis: each update
  // rewrites them from the totals (creating the position on first update).
  function syncGoalPosition(p, goal) {
    if (!goal.linked || !(goal.bought > 0)) return;
    // Units already sold out of this goal's position live on as sold
    // positions; the open one only holds what's left (Ben, 2026-10-31:
    // updating totals after selling 20 whips put all 46 back as held).
    let soldQty = 0, soldCost = 0;
    for (const x of p.positions) {
      if (x.planner_goal_id !== goal.id || x.status === 'open') continue;
      const q = Number(x.sold_quantity ?? x.quantity) || 0;
      soldQty += q; soldCost += q * (Number(x.cost_basis) || 0);
    }
    const heldQty = goal.bought - soldQty;
    let pos = p.positions.find(x => x.planner_goal_id === goal.id && x.status === 'open');
    if (!(heldQty > 0)) {
      if (pos) p.positions = p.positions.filter(x => x !== pos);
      return;
    }
    if (!pos) {
      pos = { id: Date.now().toString(), item_name: goal.item_name, status: 'open',
        created_at: new Date().toISOString(), date_opened: localDateStr(), planner_goal_id: goal.id,
        target_price: '', target_profit_pct: '', stop_loss: '' };
      p.positions.push(pos);
    }
    pos.quantity = heldQty;
    pos.cost_basis = Math.max(0, goal.spent - soldCost) / heldQty;
    // Date Opened follows the goal's earliest recorded update, so a goal
    // with back-dated totals isn't treated as bought "today". A date the
    // user set earlier than that by hand is kept.
    const firstT = (goal.history || []).reduce((m, h) => Math.min(m, h.t), Infinity);
    if (Number.isFinite(firstT)) {
      const firstDate = localDateStr(new Date(firstT));
      if (!pos.date_opened || pos.date_opened > firstDate) pos.date_opened = firstDate;
    }
  }

  // Two ways to call it:
  //   { id, bought, spent }  one offer: the goal's totals directly
  //   { id, offers }         several offers for the same item (Ben,
  //     2026-10-20: one per account, since buy limits are per account).
  //     Each offer is { id, label, bought, spent } with that offer's own
  //     running totals; the goal's totals become their sum.
  async function updateBuyGoalTotals({ id, bought, spent, offers }) {
    if (Array.isArray(offers)) {
      offers = offers.map(o => ({ id: String(o.id), label: String(o.label || '').trim(),
        bought: Number(o.bought) || 0, spent: Math.round(Number(o.spent) || 0) }));
      if (offers.some(o => !Number.isInteger(o.bought) || o.bought < 0 || o.spent < 0)) return { success: false, error: 'Totals must be positive numbers' };
      bought = offers.reduce((s, o) => s + o.bought, 0);
      spent = offers.reduce((s, o) => s + o.spent, 0);
    }
    bought = Number(bought); spent = Number(spent);
    if (!Number.isInteger(bought) || bought < 0 || !Number.isFinite(spent) || spent < 0) return { success: false, error: 'Totals must be positive numbers' };
    const p = await readPortfolio();
    const goal = (p.buy_goals || []).find(g => g.id === id);
    if (!goal) return { success: false, error: 'Goal not found' };
    if (Array.isArray(offers)) goal.offers = offers;
    const now = Date.now();
    if (bought > (goal.bought || 0)) { goal.last_fill_at = now; goal.reset_notified = false; }
    goal.bought = bought; goal.spent = Math.round(spent);
    goal.history = [...(goal.history || []), { t: now, bought, spent: goal.spent }];
    syncGoalPosition(p, goal);
    await writePortfolio(p);
    return { success: true };
  }

  // Optional (off by default — the game itself already tells you about GE
  // offer updates). Approximates the 4h limit window from the last time the
  // total went up, since that's the only timing GEnius actually sees.
  const BUY_LIMIT_WINDOW_MS = 4 * 60 * 60 * 1000;
  async function getBuyGoalNotifications() {
    const p = await readPortfolio();
    const out = [];
    let changed = false;
    for (const g of p.buy_goals || []) {
      if (!g.notify || !g.last_fill_at || g.reset_notified || g.bought >= g.target) continue;
      if (Date.now() < g.last_fill_at + BUY_LIMIT_WINDOW_MS) continue;
      g.reset_notified = true; changed = true;
      out.push({ title: 'Buy limit reset', body: `${g.item_name}: your buy limit should be free again (${g.bought.toLocaleString()} / ${Number(g.target).toLocaleString()} bought)` });
    }
    if (changed) await writePortfolio(p);
    return out;
  }

  async function deletePosition(id) {
    const p = await readPortfolio();
    p.positions = p.positions.filter(x => x.id !== id);
    await writePortfolio(p);
    return { success: true };
  }

  // Net proceeds of a sale after GE tax: 2% on the total, except items
  // selling for under 50gp (1-49gp), which are tax-exempt. Same formula as the
  // renderer's saleNet() so the Sell preview and the recorded sale agree.
  const saleNet = (price, qty) => price >= 50 ? Math.round(price * qty * 0.98) : price * qty;

  // alch: true (Ben, 2026-10-26) = high alched instead of sold. sell_price is
  // then the alch value minus a nature rune, and there's no GE tax.
  async function sellPosition({ id, sell_price, quantity, alch = false }) {
    const p = await readPortfolio();
    const pos = p.positions.find(x => x.id === id);
    if (!pos) return { success: false };

    const net = alch ? sell_price * quantity : saleNet(sell_price, quantity);
    const tax = sell_price * quantity - net;
    const cost = pos.cost_basis * quantity;
    const realized_pl = net - cost;

    p.tax_stats = resetTaxIfNeeded(p.tax_stats || defaultTaxStats());
    p.tax_stats.today_tax    += tax;
    p.tax_stats.week_tax     += tax;
    p.tax_stats.month_tax    += tax;
    p.tax_stats.lifetime_tax += tax;

    const now = new Date().toISOString();
    const via = alch ? { sold_via: 'alch' } : {};
    if (quantity >= pos.quantity) {
      pos.status = 'sold'; pos.sold_price = sell_price;
      pos.sold_quantity = pos.quantity; pos.realized_pl = realized_pl; pos.sold_at = now;
      Object.assign(pos, via);
    } else {
      p.positions.push({ ...pos, id: Date.now().toString(), quantity, status:'sold',
        sold_price:sell_price, sold_quantity:quantity, realized_pl, sold_at:now, ...via });
      pos.quantity -= quantity;
    }

    await writePortfolio(p);
    return { success:true, tax, realized_pl };
  }

  // Item-A-becomes-item-B tracking (Ben, 2026-08-09) — distinct from
  // sellPosition on purpose: no GE tax, no realized P&L, since no cash
  // actually changes hands in a conversion. The converted-away quantity
  // gets its own closed-out entry (status 'converted', same split-on-
  // partial-close pattern sellPosition uses for partial sells) so
  // there's a real record of what happened to it, and a new open
  // position is created for the output item with its cost basis computed
  // as (converted input's cost + any extra conversion cost) / output
  // quantity — the exact division Ben was doing by hand before.
  // extraInputs (Ben, 2026-10-26): more positions used up by the same
  // conversion, e.g. bolt tips + bolts fletched into tipped bolts. Each
  // { id, quantity } is closed out like the main input and its cost goes into
  // the new item's cost basis.
  async function convertPosition({ id, quantity, outputItemName, outputQuantity, extraCost = 0, extraInputs = [] }) {
    const p = await readPortfolio();
    const pos = p.positions.find(x => x.id === id);
    if (!pos) return { success: false, error: 'Position not found' };
    if (!outputItemName || !outputQuantity || outputQuantity <= 0) {
      return { success: false, error: 'Output item and quantity are required' };
    }

    const inputs = [{ pos, quantity }];
    for (const x of extraInputs) {
      const other = p.positions.find(y => y.id === x.id && y.status === 'open');
      if (!other || other === pos) return { success: false, error: 'An extra input position was not found' };
      if (inputs.some(i => i.pos === other)) return { success: false, error: 'The same position was added twice' };
      inputs.push({ pos: other, quantity: x.quantity });
    }
    for (const i of inputs) {
      i.qty = Math.min(Number(i.quantity) || 0, i.pos.quantity);
      if (i.qty <= 0) return { success: false, error: `Invalid quantity for ${i.pos.item_name}` };
    }

    const inputCostUsed = inputs.reduce((s, i) => s + i.pos.cost_basis * i.qty, 0);
    const totalCost = inputCostUsed + (Number(extraCost) || 0);
    const newCostBasis = Math.round(totalCost / outputQuantity);

    const now = new Date().toISOString();
    let n = 0;
    for (const { pos: inp, qty } of inputs) {
      if (qty >= inp.quantity) {
        inp.status = 'converted'; inp.converted_to = outputItemName;
        inp.converted_quantity = inp.quantity; inp.converted_at = now;
      } else {
        p.positions.push({ ...inp, id: (Date.now() + 10 + n++).toString(), quantity: qty, status:'converted',
          converted_to: outputItemName, converted_quantity: qty, converted_at: now });
        inp.quantity -= qty;
      }
    }

    p.positions.push({
      id: (Date.now() + 1).toString(),
      item_name: outputItemName,
      quantity: outputQuantity,
      cost_basis: newCostBasis,
      status: 'open',
      date_opened: now,
      converted_from: inputs.map(i => i.pos.item_name).join(' + '),
    });

    await writePortfolio(p);
    return { success: true, newCostBasis };
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
    if (!pos || (pos.status !== 'sold' && pos.status !== 'converted')) return { success: false };

    if (pos.status === 'sold') {
      const tax = (pos.sold_price || 0) * (pos.sold_quantity || 0) - saleNet(pos.sold_price || 0, pos.sold_quantity || 0);
      p.tax_stats = p.tax_stats || defaultTaxStats();
      p.tax_stats.lifetime_tax = Math.max(0, (p.tax_stats.lifetime_tax || 0) - tax);
      pos.status = 'open';
      delete pos.sold_price; delete pos.sold_quantity; delete pos.realized_pl; delete pos.sold_at;
    } else {
      // Reopening the converted-away side only — doesn't touch the output
      // position convertPosition created, same as it doesn't get deleted
      // by anything else either. No tax to refund; none was charged.
      pos.status = 'open';
      delete pos.converted_to; delete pos.converted_quantity; delete pos.converted_at;
    }

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

  function _fmtGpAlert(n) {
    n = Math.trunc(n || 0);
    if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}b`;
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
  }

  // Mobile: alerts the background runner already notified about while the
  // app was closed. Marked active + fired so getTriggeredAlerts doesn't
  // notify a second time when the app next runs.
  async function markAlertsFiredInBackground(fired) {
    if (!fired || !fired.length) return;
    const alerts = await storage.readJSON(alertsFile, []);
    const at = Object.fromEntries(fired.map(f => [String(f.id), f.at]));
    let changed = false;
    for (const a of alerts) {
      if (at[String(a.id)]) { a.active = true; a.firedAt = at[String(a.id)]; changed = true; }
    }
    if (changed) await storage.writeJSON(alertsFile, alerts, { pretty: true });
  }

  function _alertConditionHit(alert, item) {
    const condition = alert.condition || 'above';
    const price = item.high || item.low || 0;
    const liveRef = item.liveBuy ?? item.liveSell;
    const chg = item.change_1d;
    const signals = item.signals || [];
    const threshold = alert.price || 0;
    const pct = alert.pct || 0;
    if (condition === 'above') return price > threshold;
    // No current price reads as 0 — never treat that as a real crash.
    if (condition === 'below') return price > 0 && price < threshold;
    if (condition === 'live_above') return liveRef != null && liveRef > threshold;
    if (condition === 'live_below') return liveRef != null && liveRef < threshold;
    if (condition === 'pct_up') return chg != null && chg >= pct;
    if (condition === 'pct_down') return chg != null && chg <= -Math.abs(pct);
    if (condition === 'signal') return signals.includes(alert.signal_type || '');
    if (condition === 'alch') return signals.includes('ALCH');
    if (condition === 'score_above') return item.score != null && item.score >= pct;
    return false;
  }

  function _alertMessage(alert, item) {
    const condition = alert.condition || 'above';
    const name = alert.item_name;
    const price = item.high || item.low || 0;
    const liveRef = item.liveBuy ?? item.liveSell;
    const chg = item.change_1d;
    switch (condition) {
      case 'above':      return `${name} rose above ${_fmtGpAlert(alert.price)}gp — now ${_fmtGpAlert(price)}gp`;
      case 'below':      return `${name} fell below ${_fmtGpAlert(alert.price)}gp — now ${_fmtGpAlert(price)}gp`;
      case 'live_above': return `${name} live price rose above ${_fmtGpAlert(alert.price)}gp — now ${_fmtGpAlert(liveRef)}gp`;
      case 'live_below': return `${name} live price fell below ${_fmtGpAlert(alert.price)}gp — now ${_fmtGpAlert(liveRef)}gp`;
      case 'pct_up':     return `${name} up +${(chg||0).toFixed(2)}% today (threshold: +${alert.pct||0}%)`;
      case 'pct_down':   return `${name} down ${(chg||0).toFixed(2)}% today (threshold: -${alert.pct||0}%)`;
      case 'signal':     return `${name} triggered signal ${alert.signal_type||''} — price: ${_fmtGpAlert(price)}gp`;
      case 'alch':       return `${name} is now alch-profitable — price: ${_fmtGpAlert(price)}gp`;
      case 'score_above': return `${name} Opportunity Score rose above ${alert.pct||0} — now ${item.score ?? '—'}`;
      default:           return `${name} alert triggered`;
    }
  }

  // Single unified evaluation path for price/%/signal alerts — previously
  // this ONLY existed in run.js's checkAlerts(), which sent to Discord and
  // nothing else: no desktop notification, no fired-state tracking, and if
  // no webhook was configured (the common case), a triggered alert was
  // silently discarded with zero observable effect. Caught for real (Ben,
  // 2026-08-05): a genuine "Dragon bones below 950gp" alert existed in
  // alerts.json but produced nothing when forced to evaluate, confirming
  // the gap.
  //
  // Edge-triggered, not one-shot (corrected same session — Ben: "the
  // alerts should stay active regardless if they fire or not"). `active`
  // tracks whether the condition was true as of the LAST check — a
  // notification only fires on the false→true transition, not on every
  // check while it stays true (that would spam a notification every 15
  // min for as long as, say, a price stayed below threshold). Once the
  // condition goes false again, `active` resets on its own — no editing,
  // no manual re-arm, it just fires again next time it actually crosses.
  // `firedAt` is kept purely as a "last fired" record for the UI badge,
  // not a gate on whether it can fire again.
  async function getTriggeredAlerts() {
    const alerts = await storage.readJSON(alertsFile, []);
    if (!alerts.length) return [];
    const data = await getData();
    const priceMap = {};
    for (const it of (data.items || [])) priceMap[it.name.toLowerCase()] = it;

    const triggered = [];
    let changed = false;
    for (const a of alerts) {
      const item = priceMap[(a.item_name || '').toLowerCase()];
      if (!item) continue;
      const hit = _alertConditionHit(a, item);
      const wasActive = !!a.active;
      if (hit && !wasActive) {
        triggered.push({ key: `alert_${a.id}_${Date.now()}`, title: `Alert: ${a.item_name}`, body: _alertMessage(a, item) });
        a.firedAt = Date.now();
        changed = true;
      }
      if (hit !== wasActive) {
        a.active = hit;
        changed = true;
      }
    }
    if (changed) await storage.writeJSON(alertsFile, alerts, { pretty: true });

    if (triggered.length) {
      const webhookUrl = store.get('discordWebhook', '');
      if (webhookUrl && !isValidDiscordWebhook(webhookUrl)) {
        console.log('[alerts] Discord webhook ignored — not a discord.com webhook URL');
      } else if (webhookUrl) {
        try {
          await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              username: 'GEnius Alert',
              content: '⚠️ **GE Price Alert**\n' + triggered.map(t => t.body).join('\n'),
            }),
            signal: AbortSignal.timeout(5000),
          });
        } catch (e) { console.log(`[alerts] Discord error: ${e.message}`); }
      }
    }
    return triggered;
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
      if (parsed.items) {
        for (const it of parsed.items) {
          if (it.untradeable && it.change_1d == null) {
            const price = it.high || it.low;
            if (price) it.change_1d = computeUntradeableChange1d(it.id, price);
          }
        }
      }
      console.log(`[get-data] Loaded ${parsed.items?.length ?? 0} items`);
      return parsed;
    } catch (e) {
      console.error('[get-data] Error:', e.message);
      return { items: [], timestamp: null };
    }
  }

  // Silent safety net against the settings-write race (see storage.js's
  // createKVStore comment) and against GEnius getting force-killed with a
  // write still in flight — confirmed for real (Ben, 2026-07-29): the
  // watchlist went from 18 items down to 2 after a force-kill mid-session,
  // with no way to recover except an unrelated manual export from a month
  // earlier. This takes a small snapshot of just watchlist + settings
  // (not portfolio/alerts/overrides — those already have their own atomic
  // writes and are large/change constantly, this is specifically for the
  // small, easy-to-lose, rarely-resaved stuff), one file per CALENDAR DAY
  // (not per launch — Ben's ask, 2026-07-29, was a 15-day rolling window,
  // and multiple launches in one day would just be the same day's snapshot
  // getting overwritten, not extra generations piling up). Anything older
  // than 15 days gets pruned once a new day's backup is written.
  const AUTO_BACKUP_DAYS = 15;
  async function runAutoBackup() {
    const backupDir = path.join(dataDir, 'autobackups');
    await storage.ensureDir(backupDir);
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayPath = path.join(backupDir, `autobackup-${todayStr}.json`);

    const files = await storage.listJSONFiles(backupDir);
    const cutoff = new Date(Date.now() - AUTO_BACKUP_DAYS * 86400000).toISOString().slice(0, 10);
    for (const f of files) {
      const m = f.match(/^autobackup-(\d{4}-\d{2}-\d{2})\.json$/);
      if (m && m[1] < cutoff) await storage.deleteFile(path.join(backupDir, f));
    }

    const snapshot = {
      version: 1,
      backedUpAt: new Date().toISOString(),
      watchlist:      store.get('watchlist', []),
      hiddenItems:    store.get('hiddenItems', []),
      itemNotes:      store.get('itemNotes', {}),
      dxpWatchlist:   store.get('dxpWatchlist', []),
      reminders:      store.get('reminders', []),
      userShorthands: store.get('userShorthands', {}),
      // Added 2026-10-08: portfolio + alerts weren't backed up at all.
      // null (not a default) if the file can't be read, so a bad read is
      // never mistaken for "empty portfolio".
      portfolio:      await storage.readJSON(portfolioFile, null),
      alerts:         await storage.readJSON(alertsFile, null),
      settings: {
        discordWebhook: store.get('discordWebhook', ''),
        fetchInterval:  store.get('fetchInterval', 15),
        theme:          store.get('theme', 'dark'),
        notifications:  store.get('notifications', true),
        expensiveThreshold: store.get('expensiveThreshold', 500000000),
        overpricedThreshold: store.get('overpricedThreshold', 30),
        navOrder:       store.get('navOrder', []),
        uiScale:        store.get('uiScale', 100),
        devMode:        store.get('devMode', false),
        watchlistNotificationSettings: store.get('watchlistNotificationSettings', {}),
        portfolioDigestSettings:       store.get('portfolioDigestSettings', {}),
      },
    };
    await storage.writeJSON(todayPath, snapshot, { pretty: true });
  }

  // ─── Food heal amounts (Ben, 2026-10-13) ────────────────────────────────
  // From the wiki's "Food" page table (LP per use / LP over time / total
  // LP) — item pages only mention heals in prose. Cached a week.
  const foodHealsFile = path.join(dataDir, 'food_heals.json');
  let foodHealsMem = null;
  async function loadFoodHeals() {
    if (foodHealsMem && Date.now() - foodHealsMem.at < 7 * 86400000) return foodHealsMem;
    let cache = await storage.readJSON(foodHealsFile, null);
    if (!cache || Date.now() - cache.at > 7 * 86400000) {
      try {
        const res = await fetch('https://runescape.wiki/api.php?action=parse&page=Food&prop=wikitext&format=json', {
          headers: { 'User-Agent': 'GEnius/1.0 (github.com/VonDerThWood/GE-Intelligence)' }, signal: AbortSignal.timeout(15000) });
        const t = (await res.json())?.parse?.wikitext?.['*'] || '';
        const num = c => { const m = String(c || '').replace(/,/g, '').match(/^\d+(\.\d+)?$/); return m ? Number(m[0]) : null; };
        const foods = {};
        for (const r of t.split(/\n\|-/)) {
          const name = (r.match(/plinkt\|([^}|]+)/) || [])[1];
          if (!name) continue;
          const cells = r.split('\n').filter(l => l.startsWith('|')).map(l => l.replace(/^\|\s*(rowspan=\d+\s*\|)?/, '').trim());
          const use = num(cells[2]), over = num(cells[3]), total = num(cells[4]);
          if (use || total) foods[name.trim().toLowerCase()] = { use, over, total };
        }
        if (Object.keys(foods).length > 10) { cache = { at: Date.now(), foods }; await storage.writeJSON(foodHealsFile, cache); }
      } catch (e) { console.log('[food] heal table fetch failed (non-fatal):', e.message); }
    }
    foodHealsMem = cache || { at: Date.now(), foods: {} };
    return foodHealsMem;
  }
  // Fallback for foods not in the table yet (new Havenhythe II foods, Ben
  // 2026-10-13): the item page's own sentence, e.g. Claret crab "heals
  // 950 + 8% life points" → text "950 + 8%". Cached per item for a week
  // (including "not food", so non-food items don't refetch every open).
  const foodTextCache = {};
  async function getFoodHeal(name) {
    const { foods } = await loadFoodHeals();
    const key = String(name || '').toLowerCase();
    if (foods[key]) return foods[key];
    if (key in foodTextCache && Date.now() - foodTextCache[key].at < 7 * 86400000) return foodTextCache[key].v;
    let v = null;
    try {
      const url = 'https://runescape.wiki/api.php?action=parse&prop=wikitext&format=json&redirects=1&page=' + encodeURIComponent(String(name).replace(/ /g, '_'));
      const res = await fetch(url, { headers: { 'User-Agent': 'GEnius/1.0 (github.com/VonDerThWood/GE-Intelligence)' }, signal: AbortSignal.timeout(10000) });
      const t = (await res.json())?.parse?.wikitext?.['*'] || '';
      // Only trust the lead text, and only "heals … life points".
      const lead = t.replace(/\{\{[^{}]*\}\}/g, '').slice(0, 3000);
      const m = lead.match(/heals\s+(?:up to\s+)?([0-9][0-9,]*(?:\s*(?:\+|plus)\s*[0-9.]+%)?)\s*(?:\[\[)?life points/i);
      if (m) {
        const txt = m[1].replace(/\s*plus\s*/i, ' + ').replace(/\s+/g, ' ').trim();
        const plain = /^[0-9,]+$/.test(txt) ? Number(txt.replace(/,/g, '')) : null;
        v = { use: plain, over: null, total: plain, text: txt };
      }
    } catch (e) { return null; }   // network error: don't cache, try again next time
    foodTextCache[key] = { at: Date.now(), v };
    return v;
  }

  // ─── Restore from a daily auto-backup (Ben, 2026-10-11) ──────────────────
  // Auto-backups share the import bundle format, so restore reuses
  // applyImportBundle. Before restoring, the CURRENT state is saved as a
  // "pre-restore" snapshot in the same folder, so any restore can be undone
  // by restoring that snapshot.
  async function listAutoBackups() {
    const backupDir = path.join(dataDir, 'autobackups');
    await storage.ensureDir(backupDir);
    const files = (await storage.listJSONFiles(backupDir)).filter(f => /^(autobackup|pre-restore)-[\dT-]+\.json$/.test(f));
    const out = [];
    for (const f of files) {
      const b = await storage.readJSON(path.join(backupDir, f), null);
      if (!b || b.version !== 1) continue;
      out.push({ file: f, kind: f.startsWith('pre-restore') ? 'pre-restore' : 'daily', backedUpAt: b.backedUpAt || null,
        counts: { watchlist: (b.watchlist || []).length, positions: b.portfolio ? (b.portfolio.positions || []).length : null,
          alerts: Array.isArray(b.alerts) ? b.alerts.length : null, reminders: (b.reminders || []).length, notes: Object.keys(b.itemNotes || {}).length } });
    }
    return out.sort((a, b) => String(b.backedUpAt).localeCompare(String(a.backedUpAt)));
  }

  async function restoreAutoBackup(file) {
    if (!/^(autobackup|pre-restore)-[\dT-]+\.json$/.test(String(file))) return { error: 'Invalid backup name.' };
    const backupDir = path.join(dataDir, 'autobackups');
    const bundle = await storage.readJSON(path.join(backupDir, file), null);
    if (!bundle || bundle.version !== 1) return { error: 'That backup could not be read.' };
    // Safety snapshot of what's there now.
    const stamp = new Date().toISOString().slice(0, 16).replace(/:/g, '-');
    const now = await buildExportBundle();
    now.backedUpAt = new Date().toISOString();
    await storage.writeJSON(path.join(backupDir, `pre-restore-${stamp}.json`), now, { pretty: true });
    const res = await applyImportBundle(bundle);
    return res.success ? { success: true, safety: `pre-restore-${stamp}.json` } : res;
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
        overpricedThreshold: store.get('overpricedThreshold', 30),
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
      const ALLOWED_SETTINGS = ['discordWebhook','fetchInterval','notifications','expensiveThreshold','overpricedThreshold','navOrder','theme','dateFormat','dxpNotificationSettings','watchlistNotificationSettings'];
      ALLOWED_SETTINGS.forEach(k => {
        if (!(k in bundle.settings)) return;
        // An invalid webhook in a backup is dropped rather than imported.
        if (k === 'discordWebhook' && bundle.settings[k] && !isValidDiscordWebhook(bundle.settings[k])) return;
        store.set(k, bundle.settings[k]);
      });
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

    // Item buy and sell timing moved to the Almanac digest (getAlmanacNotifications).
    for (const [announced, start, end] of events) {
      if (settings.announceAlerts && todayStr === announced) {
        fire(`announce_${announced}`, '📅 DXP Announced',
          `A new Double XP event has been announced (${start} to ${end}). Check Notifications > Almanac for what to buy.`);
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
    if (Date.now() - lastSentAt < intervalMs - 60000) return null; // 1-min grace: checks run on the same interval

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

  // Periodic snapshot of every OPEN position's live buy/sell and GE market
  // price, unlike getWatchlistDigest above which only fires on a threshold
  // crossing — Ben's ask (2026-07-29) was a plain periodic status check
  // (defaulting to 15 minutes, matching the price auto-refresh), not
  // an anomaly alert, so every open position gets a line every time this
  // fires, regardless of whether anything moved.
  // Short gp for notifications: 20,730 -> "20.7K", -54,000,000 -> "-54.0M".
  function shortGp(n) {
    const a = Math.abs(n), s = n < 0 ? '−' : '';
    if (a >= 1e9) return s + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return s + (a / 1e6).toFixed(1) + 'M';
    if (a >= 1e4) return s + (a / 1e3).toFixed(1) + 'K';
    return s + Math.round(a).toLocaleString();
  }

  // Notification text for the portfolio digest. Windows/Android only show
  // the first few lines, so the total goes in the title and positions are
  // listed biggest gain/loss first, one short line each. Ben found the old
  // "GE x | Buy y | Sell z (P/L)" lines jumbled (2026-10-20).
  // Mirrored in mobile/runners/background.js.
  function digestMessage(rows, totalPL, totalValue) {
    rows.sort((a, b) => Math.abs(b.pl) - Math.abs(a.pl));
    const sign = n => (n > 0 ? '+' : '') + shortGp(n);
    return {
      title: `Portfolio ${sign(totalPL)} · ${rows.length} position${rows.length === 1 ? '' : 's'} · worth ${shortGp(totalValue)}`,
      body: rows.map(r => `${r.pl >= 0 ? '▲' : '▼'} ${r.name}  ${sign(r.pl)} (${shortGp(r.price)} ea)`).join('\n'),
    };
  }

  async function getPortfolioDigest() {
    const settings = store.get('portfolioDigestSettings', { enabled: false, intervalHours: 0.25 });
    if (!settings.enabled) return null;

    const portfolio = await readPortfolio();
    const open = (portfolio.positions || []).filter(p => p.status === 'open');
    if (!open.length) return null;

    const intervalMs = (settings.intervalHours || 0.25) * 3600000;
    const lastSentAt = store.get('portfolioDigestLastSentAt', 0);
    if (Date.now() - lastSentAt < intervalMs - 60000) return null; // 1-min grace: checks run on the same interval

    const itemsByName = Object.fromEntries(
      ((await getData()).items || []).map(i => [i.name.toLowerCase(), i])
    );

    let totalValue = 0, totalPL = 0;
    const rows = [];
    for (const pos of open) {
      const it = itemsByName[(pos.item_name || '').toLowerCase()];
      if (!it) continue;
      const gePrice = it.high ?? it.low ?? 0;
      // What selling really gets you, unless that price is obviously broken.
      const curPrice = it.liveSell && gePrice && it.liveSell <= gePrice * 5 && it.liveSell >= gePrice / 5 ? it.liveSell : gePrice;
      const value = curPrice * pos.quantity;
      const pl = value - pos.cost_basis * pos.quantity;
      totalValue += value; totalPL += pl;
      rows.push({ name: pos.item_name, price: curPrice, pl });
    }
    if (!rows.length) return null;

    store.set('portfolioDigestLastSentAt', Date.now());
    return digestMessage(rows, totalPL, totalValue);
  }

  // Plain date-triggered reminders, no price involved. Fires once the day
  // arrives, then marked fired so it never repeats.
  // Inbox (Ben, 2026-11-04): every notification GEnius pushes stays here until
  // the user clears it. kind picks the dot: upcoming, almanac, mine, digest.
  const INBOX_MAX = 300;
  function addToInbox(kind, source, notes, replace) {
    const list = notes.filter(n => n && n.title);
    if (!list.length) return;
    let inbox = store.get('inbox', []);
    // A digest can fire every few minutes, so only its newest copy is kept.
    if (replace) inbox = inbox.filter(e => e.source !== source);
    const now = Date.now();
    const added = list.map((n, i) => ({ id: `${now}_${source}_${i}`, kind, source, title: n.title, body: n.body || '', at: now, read: false }));
    store.set('inbox', [...added, ...inbox].slice(0, INBOX_MAX));
  }
  // Wraps a notification check so whatever it returns is also saved to the Inbox.
  const toInbox = (kind, source, check, replace) => async (...args) => {
    const result = await check(...args);
    try { addToInbox(kind, source, Array.isArray(result) ? result : [result], replace); }
    catch (e) { console.error('[Inbox] save failed:', e.message); }
    return result;
  };
  function getInbox() { return store.get('inbox', []); }
  // Phone: notifications the background runner sent while the app was closed.
  function addBackgroundInbox(entries) {
    const log = store.get('almanacDigestLog', {});
    let inbox = store.get('inbox', []);
    entries.forEach((e, i) => {
      if (e.source === 'watchlist_digest' || e.source === 'portfolio_digest') inbox = inbox.filter(x => x.source !== e.source);
      inbox.unshift({ id: `${e.at}_${e.source}_bg${i}`, kind: e.kind, source: e.source, title: e.title, body: e.body || '', at: e.at, read: false });
      // So the open app doesn't announce the same Almanac flags again.
      for (const key of e.seen || []) log[key] = e.at;
    });
    inbox.sort((a, b) => b.at - a.at);
    store.set('inbox', inbox.slice(0, INBOX_MAX));
    store.set('almanacDigestLog', log);
  }
  // No kind marks everything read (opening the Inbox pill). upTo leaves anything
  // newer than what's on screen unread.
  function markInboxRead(kind, upTo) {
    store.set('inbox', store.get('inbox', []).map(e => ((!kind || e.kind === kind) && (!upTo || e.at <= upTo)) ? { ...e, read: true } : e));
    return { success: true };
  }
  // No id clears everything.
  function clearInbox(id) {
    store.set('inbox', id ? store.get('inbox', []).filter(e => e.id !== id) : []);
    return { success: true };
  }

  async function getDueReminders() {
    const reminders = store.get('reminders', []);
    if (!reminders.length) return [];
    const todayStr = localDateStr();
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
    getItemHistory, getItemTimeseries, computeHistoryStats,
    historyLoadedPromise,
    get historyVersion() { return historyVersion; },
    // dxp / signals
    getDxpIntelligence, getDxpEvents, getSignalTrend, pctChangeOverDays, getRealTimeMovers,
    // snapshots
    updateSnapshots, getPriceSnapshots,
    // wiki stats
    getItemStats,
    getDropSources,
    getLiveItemPrice,
    getItemLiveTimeseries,
    sync: createSync({ dataDir, store, writePortfolio, buildExportBundle }),
    getUpdateRisks, dismissUpdateRisk, getUpdateRiskNotifications: toInbox('upcoming', 'update_risk', getUpdateRiskNotifications), getUpdateRiskSettings, setUpdateRiskSettings,
    syncLiveHistory: () => liveHistory.sync(),
    getItemLiveHistory: (id, days) => liveHistory.getItem(id, days),
    getLaunches,
    // monster lookup
    searchMonsters, getMonsterDrops, getMonsterInfo,
    // item detail panel — "turns into"
    getItemProducts,
    // portfolio
    getPortfolio, savePosition, deletePosition, sellPosition, convertPosition, reopenPosition,
    getBuyGoals, saveBuyGoal, deleteBuyGoal, updateBuyGoalTotals, getBuyGoalNotifications: toInbox('mine', 'buy_goal', getBuyGoalNotifications),
    recordOpportunities, getOpportunityHistory, refreshStaleHistory,
    getDxpNewsDetections, resolveDxpNews, getDxpNewsNotifications: toInbox('almanac', 'dxp_news', getDxpNewsNotifications), parseDxpDates, parseDxpTease,
    getNewsCalendar, extractNewsDates, fetchNewsPage,
    getNewsFeed, getNewsBadgeCount, markNewsRead, getNewsBadgePrefs, setNewsBadgePrefs,
    archiveNews, getEvents, saveEvent, deleteEvent, getEventSuggestions, dismissEventSuggestion, getEventImpact, getQuestItems, getNewItemsSummary, getContentDrops, getSimilarItems, getChartAnalysis, askItem, listAutoBackups, restoreAutoBackup, getFoodHeal, maybeBuildSimilarityTable, maybeRefreshAlmanac,
    // alerts
    getAlerts, saveAlert, deleteAlert, getTriggeredAlerts: toInbox('mine', 'price_alert', getTriggeredAlerts), markAlertsFiredInBackground,
    // overrides
    getOverrides, saveOverrides,
    // misc
    getData, buildExportBundle, applyImportBundle, runAutoBackup,
    // notification checks (see comment above — what to fire is shared,
    // how to actually show it natively is platform-specific glue)
    getDxpNotifications: toInbox('almanac', 'dxp', getDxpNotifications),
    getWatchlistDigest: toInbox('digest', 'watchlist_digest', getWatchlistDigest, true),
    getPortfolioDigest: toInbox('digest', 'portfolio_digest', getPortfolioDigest, true),
    getDueReminders: toInbox('mine', 'reminder', getDueReminders),
    // Notifications tab > Inbox
    getInbox, addBackgroundInbox, markInboxRead, clearInbox,
    getAlmanacSignals,
    getAlmanacNotifications: toInbox('almanac', 'almanac_digest', getAlmanacNotifications),
  };
}

module.exports = { createGeniusApi, isValidDiscordWebhook };
