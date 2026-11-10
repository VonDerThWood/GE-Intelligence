/**
 * GEnius Python Runner — JS port.
 * Usage:
 *   node run.js --mode=full       # prices + news + alerts
 *   node run.js --mode=prices     # prices + alerts only
 *   node run.js --mode=news       # news only
 *   node run.js --data-dir=PATH   # override data directory
 *   node run.js --webhook=URL     # Discord webhook override
 *
 * Faithful JS port of python/run.py (Python-to-JS backend migration, see
 * TODO.txt / SESSION_LOG.md, 2026-06-26). The main orchestrator — ties
 * together the already-ported catalogue.js, news.js, untradeable.js,
 * market_watch.js. Verify against the Python original on real data
 * before trusting this over it.
 */

const path = require('path');
const { pyRound } = require('./_pyround.js');
const { assignCategories } = require('./catalogue.js');
const storage = require('./storage.js');

const SCRIPT_DIR = __dirname;

function parseArgs(argv) {
  const args = { mode: 'full', dataDir: null, webhook: null };
  for (const arg of argv) {
    if (arg.startsWith('--mode=')) args.mode = arg.slice('--mode='.length);
    else if (arg.startsWith('--data-dir=')) args.dataDir = arg.slice('--data-dir='.length);
    else if (arg.startsWith('--webhook=')) args.webhook = arg.slice('--webhook='.length);
  }
  return args;
}

async function getDataDir(override = null) {
  // path.resolve() needs process.cwd() under the hood (real even via
  // path-browserify's polyfill, which still calls real process.cwd() —
  // doesn't exist in a webview at all) — every real caller already passes
  // an absolute (desktop) or already-correct logical (mobile) path here,
  // so there's nothing to resolve relative to anyway.
  const d = override || path.join(SCRIPT_DIR, '..', '..', 'data');
  await storage.ensureDir(d);
  return d;
}

// ── Prices via WeirdGloop GazBot dump ────────────────────────────────────────

const JUNK_PATTERNS = ['%UPDATE_DETECTED%', '%JAGEX_TIMESTAMP%', '%'];
const _DIGITS_RE = /^\d+$/;

function _toSec(ts) {
  return ts && ts > 1e11 ? ts / 1000 : (ts || 0);
}

// One bulk request for every tracked item's live instant-buy/instant-sell
// price + per-price timestamp, from the wiki's real-time prices API
// (same item-ID space as the gazbot dump above — both ultimately trace
// back to RS3's own item IDs, confirmed via itemData.id in the loop
// below). Returns { [itemId]: {high, highTime, low, lowTime} } with
// timestamps normalized to ms, or null on any failure — best-effort,
// never allowed to block or fail the main price fetch.
async function fetchLivePrices() {
  try {
    const res = await fetch('https://prices.runescape.wiki/api/v2/rs/latest', {
      headers: { 'User-Agent': 'GEnius/1.0 (github.com/VonDerThWood/GE-Intelligence)' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const out = {};
    for (const [id, v] of Object.entries(json.data || {})) {
      out[id] = {
        high: v.high ?? null, highTime: v.highTime ? v.highTime * 1000 : null,
        low: v.low ?? null, lowTime: v.lowTime ? v.lowTime * 1000 : null,
      };
    }

    // 24h trade volume/turnover, used only to judge whether a live price
    // is backed by enough real trading to trust (see liveUnits/liveTurnover
    // below and isLiveTrusted) — best-effort on top of best-effort, a
    // failure here just means every live price gets treated as untrusted
    // by the liquidity gate, never blocks the /latest data above.
    try {
      const res24h = await fetch('https://prices.runescape.wiki/api/v2/rs/24h', {
        headers: { 'User-Agent': 'GEnius/1.0 (github.com/VonDerThWood/GE-Intelligence)' },
        signal: AbortSignal.timeout(15000),
      });
      if (res24h.ok) {
        const json24h = await res24h.json();
        for (const [id, v] of Object.entries(json24h.data || {})) {
          if (!out[id]) continue;
          const hv = v.highPriceVolume || 0, lv = v.lowPriceVolume || 0;
          const hp = v.avgHighPrice || 0, lp = v.avgLowPrice || 0;
          out[id].units = hv + lv;
          out[id].turnover = hv * hp + lv * lp;
          out[id].dayHigh = v.avgHighPrice ?? null; out[id].dayLow = v.avgLowPrice ?? null;
          out[id].dayHighUnits = hv; out[id].dayLowUnits = lv;
        }
      }
    } catch (e) {
      console.log(`[prices] 24h volume fetch failed (non-fatal): ${e.message}`);
    }

    // Yesterday's full-day average (UTC day), one request (Ben, 2026-10-13):
    // the live daily change used to need GEnius's OWN snapshot from ~24h
    // earlier, which rarely existed when the laptop hibernates during the
    // day ("Live daily Δ: Building…" on 0 of 7,479 items). The wiki's 24h
    // endpoint only accepts UTC-midnight starts, so "yesterday" = the
    // previous complete UTC day. Volume-weighted mid of buys and sells.
    try {
      const dayStart = Math.floor(Date.now() / 86400000) * 86400 - 86400;
      const resY = await fetch(`https://prices.runescape.wiki/api/v2/rs/24h?timestamp=${dayStart}`, {
        headers: { 'User-Agent': 'GEnius/1.0 (github.com/VonDerThWood/GE-Intelligence)' },
        signal: AbortSignal.timeout(15000),
      });
      if (resY.ok) {
        const jy = await resY.json();
        for (const [id, v] of Object.entries(jy.data || {})) {
          if (!out[id]) continue;
          // Plain mid of the day's average buy and sell (volume-weighting
          // tilted toward whichever side happened to trade more).
          if (v.avgHighPrice && v.avgLowPrice) { out[id].prevDayAvg = (v.avgHighPrice + v.avgLowPrice) / 2; out[id].prevDayHigh = v.avgHighPrice; out[id].prevDayLow = v.avgLowPrice; out[id].prevDayUnits = (v.highPriceVolume || 0) + (v.lowPriceVolume || 0); }
        }
      }
      // "Now" = the last hour's average buy/sell mid, both sides traded —
      // a single latest trade was far too noisy (first try: Antipoison (1)
      // "+1,617%", 600+ items flagged vs 34 SURGEs).
      const res1h = await fetch('https://prices.runescape.wiki/api/v2/rs/1h', {
        headers: { 'User-Agent': 'GEnius/1.0 (github.com/VonDerThWood/GE-Intelligence)' },
        signal: AbortSignal.timeout(15000),
      });
      if (res1h.ok) {
        const j1 = await res1h.json();
        for (const [id, v] of Object.entries(j1.data || {})) {
          if (!out[id]) continue;
          out[id].lastHourHigh = v.avgHighPrice ?? null; out[id].lastHourLow = v.avgLowPrice ?? null;
          out[id].lastHourHighUnits = v.highPriceVolume || 0; out[id].lastHourLowUnits = v.lowPriceVolume || 0;
          if (!v.avgHighPrice || !v.avgLowPrice) continue;
          out[id].lastHourMid = (v.avgHighPrice + v.avgLowPrice) / 2;
          out[id].lastHourUnits = (v.highPriceVolume || 0) + (v.lowPriceVolume || 0);
        }
      }
    } catch (e) {
      console.log(`[prices] Yesterday's live average fetch failed (non-fatal): ${e.message}`);
    }

    console.log(`[prices] Got live buy/sell for ${Object.keys(out).length} items`);
    return out;
  } catch (e) {
    console.log(`[prices] Live price fetch failed (non-fatal): ${e.message}`);
    return null;
  }
}

// The price one side of the market is really trading at. /latest is only the
// single most recent trade (Ben, 2026-11-03: Soul rune's was 200gp while 205k
// traded around 1,045 that same hour; 46% of liquid items were 20%+ off their
// daily average this way). So: the last hour's average if that hour saw real
// trading, else the last 24 hours', and the lone latest trade only for items
// too thin to have either.
// Both sides come from the same window, or a spread could look upside down.
const LIVE_MIN_HOUR_UNITS = 20, LIVE_MIN_HOUR_SHARE = 0.01, LIVE_MIN_DAY_UNITS = 3;
// GE prices are whole gp; averages aren't. Never rounds a real price down to 0.
const wholeGp = gp => Math.max(1, Math.round(gp));
function representativeLivePrices(live) {
  const hourOk = (avg, units, dayUnits) => avg && units >= LIVE_MIN_HOUR_UNITS && units >= (dayUnits || 0) * LIVE_MIN_HOUR_SHARE;
  if (hourOk(live.lastHourHigh, live.lastHourHighUnits, live.dayHighUnits) && hourOk(live.lastHourLow, live.lastHourLowUnits, live.dayLowUnits)) {
    return { buy: wholeGp(live.lastHourHigh), sell: wholeGp(live.lastHourLow) };
  }
  const dayOk = (avg, units) => avg && units >= LIVE_MIN_DAY_UNITS;
  if (dayOk(live.dayHigh, live.dayHighUnits) && dayOk(live.dayLow, live.dayLowUnits)) {
    return { buy: wholeGp(live.dayHigh), sell: wholeGp(live.dayLow) };
  }
  // One-sided or very thin market: each side's own best evidence.
  return {
    buy: dayOk(live.dayHigh, live.dayHighUnits) ? wholeGp(live.dayHigh) : (live.high ?? null),
    sell: dayOk(live.dayLow, live.dayLowUnits) ? wholeGp(live.dayLow) : (live.low ?? null),
  };
}

async function fetchPrices(dataDir, webhookUrl = null, existingItems = null, historyStatsOverride = null) {
  const HEADERS = { 'User-Agent': 'GEnius/1.0 (github.com/VonDerThWood/GE-Intelligence)' };
  const DUMP_URL = 'https://chisel.weirdgloop.org/gazproj/gazbot/rs_dump.json';

  // Real volume averages AND previous-day prices, used for change_1d and
  // avgVolume below. historyStatsOverride is api.js's computeHistoryStats()
  // result — precomputed {historyVolAvg, historyPrevPrice}, one item's
  // full history read+processed+evicted at a time — passed in by main.js/
  // bridge.js's runFetch so this doesn't need a second read of its own.
  // This USED to receive the raw, fully-loaded historyData object instead
  // (computing these same two maps itself, inline, below) — changed
  // 2026-08-03 when historyData stopped being eagerly held in memory for
  // the whole catalogue (see api.js's own comment on that). Passing the
  // old raw-object shape through unchanged after that switch would have
  // silently reintroduced the exact "historyVolAvg/historyPrevPrice went
  // empty" bug this function's history already includes one real instance
  // of (see below) — receiving pre-summarized data sidesteps that
  // entirely rather than relying on every caller remembering to keep
  // historyData fully populated just for this.
  let historyVolAvg = {};
  let historyPrevPrice = {};
  let historyPrevPriceTs = {};
  let historyFirstTs = {};
  if (historyStatsOverride) {
    ({ historyVolAvg, historyPrevPrice, historyPrevPriceTs = {}, historyFirstTs = {} } = historyStatsOverride);
  } else {
  // No override (e.g. standalone CLI use, no api.js instance available) —
  // fall back to reading the per-item storage directory directly and
  // computing the same summaries inline. This used to always read the OLD
  // monolithic history.json, which the per-item storage migration renamed
  // away — since that file no longer existed, historyVolAvg/
  // historyPrevPrice were SILENTLY EMPTY on every fetch, meaning change_1d
  // only ever populated from the live dump's own "last" field (245/7182
  // items, not the ~thousands expected), and avgVolume fell back to rough
  // EMA estimates for nearly the whole catalogue instead of real history.
  // Confirmed for real via a tester noticing the suspiciously low "with
  // price data" count.
  const historyDir = path.join(dataDir, 'history');
  const history = await storage.loadDirBatched(historyDir);
  if (history && Object.keys(history).length) {
    try {
      // Measured directly: this loop alone took ~2.5s uninterrupted
      // against the real, fully-populated dataset (7184 items) — a
      // second blocking loop in this same function that got missed
      // when the per-item-processing loop further down was batched
      // earlier tonight. Per-item sort + median-of-volumes work adds
      // up the same way assignCategories did. Same fix: yield every
      // 500 items so this can't freeze the window either.
      const historyIds = Object.keys(history);
      let _processedSinceYield = 0;
      // Confirmed for real on a Pixel 8 Pro (2026-06-29, same investigation
      // as the DXP Almanac slowdown): a 250-item batch between yields can be
      // 5+ seconds of fully synchronous work on real hardware, not the
      // brief blip it looked like on a desktop dev machine — and that's
      // long enough to read as the whole app freezing during startup,
      // since this runs on the same single thread that drives the UI.
      // Smaller batch, same total work, much less perceptible per-chunk.
      const YIELD_BATCH = 25;
      for (const itemId of historyIds) {
        const points = history[itemId];
        if (++_processedSinceYield >= YIELD_BATCH) {
          _processedSinceYield = 0;
          await new Promise(res => setTimeout(res, 0));
        }
        if (!points || points.length < 2) continue;
        // Items can carry years of all-time history (avg ~3600 points,
        // up to 6600+) — sorting the full array twice per item (as this
        // loop used to) is what actually caused the multi-second freezes:
        // confirmed via [TIMING] brackets showing this loop alone took
        // ~58s across 7184 items. Single O(n) pass finds the two most
        // recent points (for prevPrice) and the last-90-days subset (for
        // the volume median) without ever sorting the full array — only
        // the much smaller recent subset gets sorted.
        let latest = null, secondLatest = null;
        const cutoff90d = Date.now() / 1000 - 90 * 86400;
        const recentPts = [];
        for (const p of points) {
          const ts = p.timestamp || 0;
          if (!latest || ts > (latest.timestamp || 0)) { secondLatest = latest; latest = p; }
          else if (!secondLatest || ts > (secondLatest.timestamp || 0)) { secondLatest = p; }
          if (_toSec(ts) >= cutoff90d) recentPts.push(p);
        }
        const ptsForVol = recentPts.length >= 7 ? recentPts : points;
        const vols = ptsForVol.map(p => p.volume).filter(v => v !== null && v !== undefined).sort((a, b) => a - b);
        if (vols.length) {
          const mid = Math.floor(vols.length / 2);
          const medianVol = vols.length % 2 ? vols[mid] : Math.floor((vols[mid - 1] + vols[mid]) / 2);
          historyVolAvg[String(itemId)] = medianVol;
        }
        if (secondLatest && secondLatest.price) historyPrevPrice[String(itemId)] = secondLatest.price;
        if (latest && latest.timestamp) {
          historyPrevPriceTs[String(itemId)] = latest.timestamp > 1e12 ? latest.timestamp : latest.timestamp * 1000;
        }
      }
      console.log(`[prices] Loaded history for ${Object.keys(historyVolAvg).length} items (vol) / ${Object.keys(historyPrevPrice).length} items (price)`);
    } catch (e) {
      console.log(`[prices] Could not process history data: ${e.message}`);
    }
  }
  } // end historyStatsOverride fallback branch

  // Build previous volume lookups from last fetch (EMA fallback for items without history)
  const EMA_ALPHA = 0.08;
  const prevAvgVolume = {};
  // When GEnius first saw each item (Ben, 2026-10-13: Malachi's tooth/claw
  // showed FRENZY on day one — a brand-new item's "average" volume is just
  // its first day or two of trading, so any normal day looks like a spike).
  const prevFirstSeen = {};
  if (existingItems) {
    for (const it of existingItems) {
      const name = it.name || '';
      const avgVol = it.avgVolume;
      if (name && avgVol) prevAvgVolume[name] = avgVol;
      if (name) prevFirstSeen[name] = it.firstSeen || 1;   // 1 = "already known before firstSeen existed" (not new)
    }
  }

  console.log('[prices] Fetching RS3 GE dump from WeirdGloop...');

  // Live instant-buy/instant-sell + per-price timestamps from the wiki's
  // real-time prices API (launched 2026-07) — one bulk request for every
  // tracked item (~470KB, well under a second), fetched alongside the
  // main dump rather than blocking on it. Best-effort: a failure here
  // just means no B:/S: line this refresh, never blocks the main price
  // fetch that everything else depends on.
  const livePricesPromise = fetchLivePrices();

  let raw;
  try {
    const res = await fetch(DUMP_URL, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    raw = await res.json();
  } catch (e) {
    console.log(`[prices] Error fetching dump: ${e.message}`);
    return [];
  }

  // A real, healthy dump has 7000+ entries. A suspiciously small but
  // technically-valid response (partial/truncated JSON, an API hiccup
  // that returns something small instead of erroring outright) used to
  // sail through here and, downstream in main(), silently overwrite a
  // perfectly good latest.json with almost nothing — confirmed for
  // real once already (see SESSION_LOG.md, 2026-06-26: a real network
  // failure this exact way wiped 7288 items down to 106). Treating it
  // the same as an outright fetch failure here protects against both.
  if (Object.keys(raw).length < 1000) {
    console.log(`[prices] Dump only had ${Object.keys(raw).length} entries — treating as a failed fetch, not overwriting existing data.`);
    return [];
  }

  console.log(`[prices] Got ${Object.keys(raw).length} items from dump`);

  const livePrices = await livePricesPromise;

  const itemsOut = [];
  let itemCounter = 1;
  let _processedSinceYield = 0;
  // Confirmed for real on a Pixel 8 Pro (2026-06-29): 250 items between
  // yields can mean 5+ seconds of fully synchronous work on real hardware —
  // see the matching comment in dxp_intelligence.js's computeDxpData, found
  // via the same investigation. A much smaller batch keeps any single
  // unyielded chunk well under what reads as "the app just froze."
  const YIELD_BATCH = 25;

  for (const [key, itemData] of Object.entries(raw)) {
    // This whole pipeline now runs in-process inside Electron's main
    // process instead of as a separate Python child process (tonight's
    // full backend rewrite) — so unlike before, synchronous work here
    // blocks window focus/repaint/input for as long as it takes.
    // assignCategories alone measured ~2s across the real catalogue;
    // yielding periodically keeps the app responsive during every
    // price fetch (startup AND every scheduled refresh), not just
    // this one once-per-launch call. Confirmed for real: a tester
    // reported the window taking 2-3s to respond to alt-tab/focus
    // specifically during the startup auto-fetch, every time since 1.8.
    if (++_processedSinceYield >= YIELD_BATCH) {
      _processedSinceYield = 0;
      await new Promise(res => setTimeout(res, 0));
    }
    if (!itemData) continue;
    if (JUNK_PATTERNS.some(p => key.includes(p))) continue;

    let price, high, low, name, itemId, volume, alch, limit, changeOneDay, examine, members;

    if (typeof itemData === 'number') {
      // Handle flat format: {"Item Name": price} — legacy/fallback
      price = Math.trunc(itemData);
      high = price; low = price;
      if (_DIGITS_RE.test(key)) {
        name = `Item ${key}`;
        itemId = parseInt(key, 10);
      } else {
        name = key;
        itemId = itemCounter;
        itemCounter += 1;
      }
      volume = null; alch = null; limit = null; changeOneDay = null; examine = null; members = null;
    } else if (typeof itemData === 'object') {
      price = itemData.price;
      if (!price) continue;
      name = itemData.name || key;
      if (JUNK_PATTERNS.some(p => name.includes(p))) continue;
      itemId = itemData.id || (_DIGITS_RE.test(key) ? parseInt(key, 10) : itemCounter);
      if (!_DIGITS_RE.test(key) && !itemData.id) itemCounter += 1;
      // RS3 has a handful of unused dev-placeholder item IDs that still
      // show up in the GE dump (e.g. "Summer Warrior (Skeleton Warrior)
      // token (59317)" — note the item's own ID literally appended to
      // its own display name) — a duplicate of a real, legitimately-
      // priced item that exists elsewhere under its normal name. Their
      // examine text ("Do not translate - never seen.") isn't a safe
      // filter on its own since some genuinely new, real items
      // temporarily share that exact placeholder text before Jagex
      // writes the real one. The name-ends-with-own-id pattern is the
      // actual reliable signal — confirmed against the live dump to
      // catch only these 2 junk dupes, not any real item.
      if (new RegExp(`\\(${itemId}\\)$`).test(name)) continue;
      high = price; low = price;
      volume = itemData.volume ?? null;
      alch = itemData.highalch ?? null;
      limit = itemData.limit ?? null;
      examine = itemData.examine ?? '';
      members = itemData.members ?? false;

      // Price change — dump's last field first, then history fallback.
      // Ben, 2026-08-09: caught for real on Water rune — dump's "last" said
      // 52gp (implying -50% change_1d) while both our own tracked history
      // AND the live-price feed agreed the real recent price never left
      // 25-28gp. The dump's "last" field can go stale on cheap,
      // low-movement items in a way that isn't a real single-day move.
      //
      // BUT our own historyPrevPrice is itself just a CACHE of an item's
      // price history — it only refreshes when something actually
      // re-fetches that item (a chart open, a backfill run), not every
      // cycle. Caught for real on Saradomin's hum: its cache hadn't moved
      // since June 26 (6+ weeks), so blindly preferring it over the dump's
      // "last" field would have swapped one bad number for a worse one.
      // Only trust the cached history as an override when its own latest
      // point is itself recent (<=2 days old) — otherwise it's not a
      // trustworthy "yesterday" reference either, and the dump's field
      // (even if occasionally wrong) is the more current source available.
      const CHANGE_SANITY_RATIO = 1.3;
      const HISTORY_FRESH_MS = 2 * 24 * 60 * 60 * 1000;
      const lastPrice = itemData.last;
      const ownPrevTs = (itemId && String(itemId) in historyPrevPriceTs) ? historyPrevPriceTs[String(itemId)] : null;
      const ownPrevFresh = ownPrevTs && (Date.now() - ownPrevTs) <= HISTORY_FRESH_MS;
      const ownPrev = ownPrevFresh && itemId && String(itemId) in historyPrevPrice ? historyPrevPrice[String(itemId)] : null;
      if (lastPrice && lastPrice > 0 && price !== lastPrice) {
        const disagreesWithHistory = ownPrev && ownPrev > 0 &&
          Math.max(lastPrice, ownPrev) / Math.min(lastPrice, ownPrev) > CHANGE_SANITY_RATIO;
        const trustedPrev = disagreesWithHistory ? ownPrev : lastPrice;
        changeOneDay = pyRound(((price - trustedPrev) / trustedPrev) * 100, 2);
      } else if (ownPrev) {
        changeOneDay = ownPrev > 0 ? pyRound(((price - ownPrev) / ownPrev) * 100, 2) : null;
      } else {
        changeOneDay = null;
      }
    } else {
      continue;
    }

    const categories = assignCategories(name);

    // Compute avgVolume — prefer real history average, fall back to EMA
    let avgVolume;
    if (itemId && String(itemId) in historyVolAvg) {
      avgVolume = historyVolAvg[String(itemId)];
    } else {
      const prevAvg = prevAvgVolume[name];
      if (volume && prevAvg) {
        avgVolume = pyRound(EMA_ALPHA * volume + (1 - EMA_ALPHA) * prevAvg);
      } else if (volume) {
        avgVolume = volume;
      } else {
        avgVolume = prevAvg ?? null;
      }
    }

    const live = livePrices && livePrices[String(itemId)];
    // Earliest of: saved history's first point, what a previous fetch
    // recorded, or now — but only items absent from the previous fetch
    // count as new (older items get 1 = "known before this field existed").
    const histFirst = itemId ? historyFirstTs[String(itemId)] : null;
    // Order: real history start wins; else a date a previous fetch stored;
    // else 1 if it was already in the previous fetch (pre-dates this field);
    // else now (genuinely new).
    const stored = prevFirstSeen[name];
    const firstSeen = histFirst ? Math.min(histFirst, stored > 1 ? stored : Infinity)
      : stored > 1 ? stored : stored === 1 ? 1 : Date.now();
    itemsOut.push({
      id: itemId, name, categories, high, low, alch, limit, volume,
      avgVolume, firstSeen, change_1d: changeOneDay, examine, members,
      liveBuy: live ? representativeLivePrices(live).buy : null, liveBuyTime: live?.highTime ?? null,
      liveSell: live ? representativeLivePrices(live).sell : null, liveSellTime: live?.lowTime ?? null,
      liveUnits: live?.units ?? 0, liveTurnover: live?.turnover ?? 0, livePrevDayAvg: live?.prevDayAvg ?? null, liveLastHourMid: live?.lastHourMid ?? null,
      liveSides: live?.prevDayHigh && live?.lastHourHigh && live?.lastHourLow ? { pH: live.prevDayHigh, pL: live.prevDayLow, nH: live.lastHourHigh, nL: live.lastHourLow, uH: live.lastHourHighUnits || 0, uL: live.lastHourLowUnits || 0 } : null,
    });
  }

  console.log(`[prices] Processed ${itemsOut.length} tradeable items`);
  const changed = itemsOut.filter(it => it.change_1d !== null && it.change_1d !== undefined).length;
  console.log(`[prices] Items with price change data: ${changed}/${itemsOut.length}`);

  const signaled = runSignals(itemsOut);

  // Real intraday change — see updateIntradaySnapshots/computeLiveChange1d
  // below. Additive only: change_1d (the existing gazbot-"last"-based
  // figure everything else already depends on — SURGE/DUMP thresholds,
  // Dashboard risers/fallers, Opportunity Score) is left completely
  // untouched. change_1d_live sits alongside it, null until ~20h of
  // snapshots have accumulated (nothing to show on a fresh install or
  // right after this feature first ships).
  try {
    const snapshots = await updateIntradaySnapshots(dataDir, signaled);
    for (const it of signaled) {
      const price = it.liveBuy ?? it.high ?? it.low;
      // Prefer "last hour vs yesterday" (average buy/sell mids from the
      // wiki); fall back to GEnius's own ~24h-old snapshot.
      const nowMid = it.liveLastHourMid;
      it.change_1d_live = it.livePrevDayAvg && nowMid
        ? pyRound(((nowMid - it.livePrevDayAvg) / it.livePrevDayAvg) * 100, 2)
        : computeLiveChange1d(snapshots, it.id, price);
      // SPIKE / SLUMP (Ben, 2026-10-13): the live-price twins of SURGE/DUMP
      // (which use the GE guide's daily change). Kept separate so the
      // guide-based track record isn't mixed with a different definition,
      // and so the two can be compared (live history back to July 2026).
      // Same ±5% / 1,000gp thresholds; only for items with real trading
      // today (20+ units, turnover ≥ MIN_TURNOVER_GP), a trusted live
      // price, and 14+ days on the GE.
      const lc = it.change_1d_live;
      const young = it.firstSeen && (Date.now() - it.firstSeen) < 14 * 86400000;
      const ge0 = it.high || it.low || 0;
      if (lc != null && !young && (it.liveUnits || 0) >= 20 && (it.liveTurnover || 0) >= MIN_TURNOVER_GP && isLiveTrusted(it, ge0)) {
        const absGp = Math.abs(lc / 100 * (price || 0));
        // Both sides must agree: buy vs yesterday's buy AND sell vs
        // yesterday's sell each move 5%+ the same way. A lopsided hour
        // (only buyers, e.g. alchers) shifts the mid without a real move
        // (2nd try flagged Raw salmon +294%, Green dye −63%).
        const sd = it.liveSides;
        const bH = sd ? (sd.nH - sd.pH) / sd.pH * 100 : null, bL = sd ? (sd.nL - sd.pL) / sd.pL * 100 : null;
        // Each side needs 10+ trades in the last hour (one 2,713gp buy made
        // Raw salmon "+294%"), and the move counted is the SMALLER of the
        // two sides, so one extreme side can't inflate it.
        if (bH != null && sd.uH >= 10 && sd.uL >= 10) {
          const up = Math.min(bH, bL), down = Math.max(bH, bL);
          if (up >= SURGE_CHG_MIN && Math.abs(up / 100 * (price || 0)) >= 1000) { it.signals = [...(it.signals || []), 'SPIKE']; it.change_live_move = pyRound(up, 2); }
          else if (down <= DUMP_CHG_MAX && Math.abs(down / 100 * (price || 0)) >= 1000) { it.signals = [...(it.signals || []), 'SLUMP']; it.change_live_move = pyRound(down, 2); }
        }
      }
    }
  } catch (e) {
    console.log(`[intraday] Error: ${e.message}`);
  }

  return signaled;
}

// ── Real intraday change ─────────────────────────────────────────────────────
// The regular change_1d relies on the gazbot dump's own "last" field (or a
// history-based fallback) — both are snapshots of unknown/coarse freshness.
// This instead builds a rolling record of the live price itself (the same
// field the live B:/S: line and Flips tab use) and compares against
// whatever snapshot sits closest to 24h ago. One entry per item per ~50
// minutes (not every 15-min fetch) keeps the file small — a 24h window
// only ever needs ~30 points, not ~96.
const INTRADAY_MIN_GAP_MS = 50 * 60 * 1000;
const INTRADAY_RETENTION_MS = 30 * 60 * 60 * 1000; // keep a bit past 24h for lookback slack
const INTRADAY_MIN_AGE_MS = 20 * 60 * 60 * 1000;   // don't compare against anything younger than this — too close to "today" to call it a daily change
const INTRADAY_TARGET_AGE_MS = 24 * 60 * 60 * 1000;

async function updateIntradaySnapshots(dataDir, items) {
  const file = path.join(dataDir, 'intraday_snapshots.json');
  const store = await storage.readJSON(file, {});
  const now = Date.now();

  for (const it of items) {
    if (it.untradeable) continue;
    const price = it.liveBuy ?? it.high ?? it.low;
    if (!price) continue;
    const id = String(it.id);
    const arr = store[id] || [];
    const last = arr[arr.length - 1];
    if (!last || now - last.t >= INTRADAY_MIN_GAP_MS) arr.push({ t: now, p: price });
    const trimmed = arr.filter(pt => now - pt.t <= INTRADAY_RETENTION_MS);
    if (trimmed.length) store[id] = trimmed; else delete store[id];
  }

  await storage.writeJSON(file, store);
  return store;
}

function computeLiveChange1d(snapshots, itemId, currentPrice) {
  if (!currentPrice) return null;
  const arr = snapshots[String(itemId)];
  if (!arr || !arr.length) return null;

  let best = null, bestDiff = Infinity;
  for (const pt of arr) {
    const age = Date.now() - pt.t;
    if (age < INTRADAY_MIN_AGE_MS) continue;
    const diff = Math.abs(age - INTRADAY_TARGET_AGE_MS);
    if (diff < bestDiff) { bestDiff = diff; best = pt; }
  }
  if (!best || !best.p) return null;
  return pyRound(((currentPrice - best.p) / best.p) * 100, 2);
}

// ── Signal thresholds ────────────────────────────────────────────────────────
const SURGE_CHG_MIN = 5.0;
const DUMP_CHG_MAX = -5.0;
const DIR_VOL_RATIO = 1.2;
const FLAT_CHG_MIN = -3.0;
const FLAT_CHG_MAX = 3.0;
const ACCUM_VOL_MIN = 1.3;
const DISTRIB_VOL_MIN = 2.5;
// Gp-turnover floor (price * volume), not a raw unit-count floor — see
// removed-2026-08-05 comment below for why. A flat unit-count floor
// (formerly MIN_VOL_ABS = 5000) systematically excluded every high-value
// item from volume-based signals/scoring regardless of real trading
// activity: confirmed for real (Ben, 2026-08-05) that Fractured Staff of
// Armadyl, Noxious scythe, Ascension crossbow, Seismic wand, and Staff of
// Sliske all NEVER cleared 5000 units/day despite each moving hundreds of
// millions to tens of billions of gp/day (Fractured Staff of Armadyl:
// just 28 units, but 30.8 BILLION gp turnover). 100,000gp was picked from
// the real turnover distribution across the catalogue (not guessed) —
// sits between the 10th (21,137gp) and 25th (279,672gp) percentile of
// real per-item turnover, excludes roughly the bottom ~18% (genuinely
// thin markets — checked directly: the highest-priced items below this
// line all sell only 1 unit/day, and the highest-volume items below it
// are 1-2gp bulk items like Waterskin/Plant pot where even tens of
// thousands of units still doesn't add up to real money), while
// including both extremes: cheap-but-liquid items (Law rune, ~300-400gp
// but millions of units/day) and expensive-but-rare items (the BiS gear
// above) that a single-metric floor (either price alone or volume alone)
// would have excluded.
const MIN_TURNOVER_GP = 100000;
const VOL_FRENZY_MIN = 2.5;
const VOL_HIGH_MIN = 1.5;
const VOL_ACTIVE_MIN = 1.1;
const VOL_QUIET_MAX = 0.9;
const VOL_THIN_MAX = 0.5;
// MANIPULATED-specific floor, separate from the general hasAvg/turnover
// gate — a volume RATIO computed from a tiny baseline is just noise, not
// evidence of manipulation. Confirmed for real (Ben, 2026-08-06): of 43
// items flagged MANIPULATED, ~27 had avgVolume under 20 — e.g. "Dragon
// ring token" (avgVol 1, vol 8, ratio 8.0x) — going from 1 trade/day to
// 8 isn't manipulation, it's just what a 1-unit average looks like on a
// slightly busier day. Items at avgVol 20+ (Heart of the Seer, Steel
// longsword, Beer glass, etc.) look like genuinely meaningful flags by
// comparison. Picked directly from that real distribution, not guessed.
const MANIPULATED_MIN_AVG_VOL = 20;
// Ben, 2026-07-27: 20% swing between the listed GE price and real live
// buy/sell (the wiki's real-time prices API — see fetchLivePrices above),
// gated on a minimum absolute gp gap so it doesn't fire on cheap items
// where 20% is a trivial few gp. Same gp-floor pattern as SURGE/DUMP's
// absChgGp >= 1000 check above.
const DISCREPANCY_PCT_MIN = 20;
const DISCREPANCY_MIN_GP = 1000;
// Ben, 2026-08-06: OVERPRICED/UNDERPRICED was firing on ~40% of the
// catalogue. Root cause confirmed directly from real data — a single
// isolated trade (an impatient buyer throwing a wildly over/under offer
// on something nobody really trades, Ben's own real example: a bronze
// longsword instabought for 1m by someone who didn't want to wait) can
// itself make the live price look "backed" by real gp turnover, so
// turnover alone doesn't catch it. Requires BOTH real trade count and
// real turnover in the last 24h before trusting a live price for this
// comparison — thresholds picked from the actual distribution, not
// guessed: 25,000gp is the 10th percentile of live turnover among items
// with any live activity at all, and 3 units is enough to rule out a
// single-fluke-trade while still passing genuinely rare-but-real gear
// that trades in real (if infrequent) chunks — confirmed Fractured Staff
// of Armadyl (28 units/24h), Noxious scythe (47), Staff of Sliske (13)
// all clear it easily.
const LIVE_LIQUID_MIN_UNITS = 3;
const LIVE_LIQUID_MIN_TURNOVER_GP = 25000;
// For items that don't clear the liquidity floor above, still trust the
// live price if it's within a sane multiple of the GE price — a thin
// market can be genuinely quiet without being fake. 5x is the 75th
// percentile of live-vs-GE ratio among illiquid items (checked directly):
// the bulk of real thin-market noise sits under that, then the
// distribution explodes into obvious nonsense (90th pct 54x, 99th pct
// 7576x) — matches the same elbow as Ben's bronze longsword example.
const LIVE_SANITY_BAND = 5;
// Ben, 2026-08-06: exempted from both checks above — extremely rare,
// high-value gear (his examples: Infinity robes, Demonic title scrolls)
// legitimately trades at prices wildly divergent from GE with 0-2 units
// in 24h, because almost nobody does the content that drops them. A
// liquidity/sanity-band filter can't tell that apart from a fluke by
// price pattern alone, so items already worth 1m+ GE are trusted as-is.
const LIVE_PRICE_EXEMPT_GP = 1000000;

function isLiveTrusted(item, gePrice0) {
  if (gePrice0 >= LIVE_PRICE_EXEMPT_GP) return true;
  const liveRef = (item.liveBuy != null && item.liveSell != null)
    ? (item.liveBuy + item.liveSell) / 2
    : (item.liveBuy ?? item.liveSell);
  if (!liveRef || liveRef <= 0) return false;
  if ((item.liveUnits || 0) >= LIVE_LIQUID_MIN_UNITS && (item.liveTurnover || 0) >= LIVE_LIQUID_MIN_TURNOVER_GP) return true;
  const ratio = Math.max(gePrice0, liveRef) / Math.min(gePrice0, liveRef);
  return ratio <= LIVE_SANITY_BAND;
}

// What buying an item really costs right now: live unless that price is more
// than 5x off the guide price, which means a broken or one-off trade.
function liveBuyPrice(item) {
  const ge = item.high || item.low || 0;
  const live = item.liveBuy;
  return live && (!ge || (live <= ge * 5 && live >= ge / 5)) ? live : ge;
}

function runSignals(items) {
  // Tag items with market signals based on price change and volume behavior.
  let natureRunePrice = 0;
  for (const item of items) {
    if ((item.name || '').toLowerCase() === 'nature rune') {
      natureRunePrice = liveBuyPrice(item);
      break;
    }
  }
  if (natureRunePrice) console.log(`[signals] Nature rune price: ${natureRunePrice} gp`);
  else console.log('[signals] Nature rune price not found, defaulting to 0');

  for (const item of items) {
    const signals = [];
    const high = item.high || 0;
    const low = item.low || 0;
    const alch = item.alch || 0;
    const chg = item.change_1d || 0;
    const vol = item.volume || 0;
    const avgVol = item.avgVolume || 0;

    const gePrice0 = high || low;
    // No volume-ratio signals (FRENZY/HIGH_VOL/THIN/SURGE/...) until an item
    // has 14+ days on the GE — before that there's no real "normal" volume.
    const youngItem = item.firstSeen && (Date.now() - item.firstSeen) < 14 * 86400000;
    const hasAvg = !youngItem && !!(avgVol && (gePrice0 * vol) >= MIN_TURNOVER_GP);
    const volRatio = hasAvg ? (vol / avgVol) : 0;

    // No price floor here anymore — removed 2026-08-05 after confirming
    // for real (Law rune, mid-July 2026: volume spiked ~38x normal
    // overnight — 976K to 37.5M — with price running 310gp to 466gp over
    // the following week, tied to 120 Construction's release) that cheap
    // items can have genuinely huge, actionable relative volume/price
    // moves that a flat gp price cutoff excluded wholesale regardless of
    // how liquid the item actually was. Liquidity (not price) is the
    // real thing that should gate "is this actionable" — MIN_TURNOVER_GP
    // above already does that properly (gp turnover, not raw price or
    // raw volume alone), and SURGE/DUMP's own absChgGp >= 1000 floor
    // already protects against trivial-in-absolute-terms swings
    // independently.

    const absChgGp = Math.abs(chg / 100 * gePrice0);
    // Young items (<14 days on the GE): the guide is still catching up from
    // Jagex's placeholder price (e.g. 115m → real ~1.5b), so a daily jump
    // isn't a real SURGE/DUMP.
    if (!youngItem && chg >= SURGE_CHG_MIN && absChgGp >= 1000 && (!hasAvg || volRatio >= DIR_VOL_RATIO)) {
      signals.push('SURGE');
    } else if (!youngItem && chg <= DUMP_CHG_MAX && absChgGp >= 1000 && (!hasAvg || volRatio >= DIR_VOL_RATIO)) {
      signals.push('DUMP');
    } else if (hasAvg && chg >= FLAT_CHG_MIN && chg <= FLAT_CHG_MAX) {
      if (volRatio >= DISTRIB_VOL_MIN) signals.push('DISTRIBUTION');
      else if (volRatio >= ACCUM_VOL_MIN) signals.push('ACCUMULATION');
    }

    // MANIPULATED: extreme volume + large price move + tiny buy limit
    const limit = item.limit || 0;
    if (hasAvg && avgVol >= MANIPULATED_MIN_AVG_VOL && volRatio >= 2.5 && Math.abs(chg) >= 8.0 && limit > 0 && limit <= 100) {
      signals.push('MANIPULATED');
    }

    // OVERPRICED / UNDERPRICED: the listed GE price vs. real live buy/sell
    // have diverged by 20%+ — independent of SURGE/DUMP above (those
    // compare today's price to yesterday's; this compares the listed
    // price to what people are ACTUALLY paying/getting right now).
    // Ben's real example that prompted this: some rare-drop "Furniture
    // plans" items are listed at a stale ~3-5M gp GE default while real
    // live trades show them worth a fraction of that.
    if ((item.liveBuy != null || item.liveSell != null) && gePrice0 > 0 && isLiveTrusted(item, gePrice0)) {
      const liveRef = (item.liveBuy != null && item.liveSell != null)
        ? (item.liveBuy + item.liveSell) / 2
        : (item.liveBuy ?? item.liveSell);
      if (liveRef > 0) {
        const gapGp = Math.abs(gePrice0 - liveRef);
        const gapPct = ((gePrice0 - liveRef) / liveRef) * 100;
        if (gapGp >= DISCREPANCY_MIN_GP) {
          if (gapPct >= DISCREPANCY_PCT_MIN) signals.push('OVERPRICED');
          else if (gapPct <= -DISCREPANCY_PCT_MIN) signals.push('UNDERPRICED');
        }
      }
    }

    // WIDE_SPREAD: live instabuy/instasell gap is unusually wide relative
    // to the price — a thin, two-sided market where the "margin" you'd
    // see on a flip is really just illiquidity, not a real opportunity.
    // Threshold picked from the actual distribution (checked directly,
    // not guessed): among decent-volume items with sane live prices,
    // median spread is ~4.5%, 90th percentile is ~41% — 40% catches
    // roughly that top decile without flagging ordinary items. Reuses
    // the same volume floor and GE-price sanity band as the Flips tab's
    // filters, since a wide "spread" is just as often one fluke print
    // as it is a real thin market (confirmed for real: without the
    // sanity band, near-1gp instasell dumps on high-value items produced
    // spread percentages in the millions).
    const SPREAD_PCT_MIN = 40;
    const SPREAD_MIN_GP = 500;
    const SPREAD_MIN_VOL = 50;
    if (item.liveBuy != null && item.liveSell != null && item.liveSell > 0 && gePrice0 > 0
      && vol >= SPREAD_MIN_VOL
      && item.liveSell >= gePrice0 * 0.5 && item.liveBuy <= gePrice0 * 2) {
      const spreadGp = item.liveBuy - item.liveSell;
      const spreadPct = (spreadGp / item.liveSell) * 100;
      if (spreadGp >= SPREAD_MIN_GP && spreadPct >= SPREAD_PCT_MIN) signals.push('WIDE_SPREAD');
    }

    // Volume tier badge
    if (hasAvg) {
      if (volRatio >= VOL_FRENZY_MIN) signals.push('FRENZY');
      else if (volRatio >= VOL_HIGH_MIN) signals.push('HIGH_VOL');
      else if (volRatio >= VOL_ACTIVE_MIN) signals.push('ACTIVE');
      else if (volRatio <= VOL_THIN_MAX) signals.push('THIN');
      else if (volRatio <= VOL_QUIET_MAX) signals.push('QUIET');
    } else if (!youngItem && vol && !avgVol && vol > 100000) {
      signals.push('HIGH_VOL');
    }

    // ALCH: alching beats buying the item at its live price + a nature rune
    if (alch && gePrice0) {
      if (alch > liveBuyPrice(item) + natureRunePrice) signals.push('ALCH');
    }

    item.natureRunePrice = natureRunePrice;
    item.signals = signals;

    // Opportunity Score (0-100)
    let score = 0;
    if (item.change_1d !== null && item.change_1d !== undefined) {
      const gePriceNow = high || low;
      const absChg = Math.abs(item.change_1d);
      const pctFactor = Math.min(1.0, absChg / 20);
      const gpFactor = Math.min(1.0, (absChg / 100 * gePriceNow) / 100000);
      score += 40 * Math.sqrt(pctFactor * gpFactor);
    }
    if (hasAvg && volRatio > 0) {
      score += Math.min(30, (volRatio - 1) / 2 * 30);
    }
    if (signals.includes('SURGE') || signals.includes('DUMP')) score += 20;
    if (signals.includes('ACCUMULATION') || signals.includes('DISTRIBUTION')) score += 10;
    if (signals.includes('FRENZY')) score += 10;
    const gePrice1 = high || low;
    if (alch && gePrice1 && natureRunePrice) {
      const buy = liveBuyPrice(item);
      const profit = alch - buy - natureRunePrice;
      if (profit > 0) score += Math.min(10, profit / buy * 100);
    }
    // Ben, 2026-08-09: an OVERPRICED item (GE price diverged significantly
    // above the real live price) could still hit 100/100 here — the
    // momentum/DUMP points above are measured off change_1d, which is
    // itself derived from that same untrustworthy GE price, so a "great
    // opportunity" score built on a possibly-fake price isn't trustworthy
    // either. Capped at 50 rather than zeroed out, since the item might
    // still be worth a look — just not a top-of-list one. UNDERPRICED is
    // deliberately NOT capped the same way: it means the real price is
    // HIGHER than GE shows, which is a genuine opportunity rather than a
    // red flag, so no reason to undersell it the same way.
    const scoreCap = signals.includes('OVERPRICED') ? 50 : 100;
    item.score = pyRound(Math.min(scoreCap, score), 1);
  }

  const sigNames = ['SURGE', 'DUMP', 'ACCUMULATION', 'DISTRIBUTION', 'FRENZY', 'HIGH_VOL', 'ACTIVE', 'QUIET', 'THIN', 'ALCH'];
  const counts = {};
  for (const s of sigNames) counts[s] = items.filter(it => (it.signals || []).includes(s)).length;
  console.log('[signals]', counts);
  return items;
}

// checkAlerts/sendDiscord removed 2026-08-05 — this was the ONLY thing
// that ever evaluated price/%/signal alerts, and its only action was a
// Discord webhook call with no fallback: no webhook configured (the
// common case) meant a triggered alert was silently discarded, no
// desktop notification, no record that it ever fired. Replaced by
// api.js's getTriggeredAlerts() — a single unified path with real
// one-shot fired-state tracking, a desktop notification, AND still
// sends to Discord if a webhook is configured. Called from main.js's
// notification-check cycle alongside DXP/Watchlist/Portfolio/Reminders,
// not from here — this file no longer touches alerts at all.

function fmtGp(n) {
  n = Math.trunc(n || 0);
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}b`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// ── News ──────────────────────────────────────────────────────────────────────
async function fetchNewsData(items = null) {
  try {
    const { fetchAllNews } = require('./news.js');
    return await fetchAllNews(items);
  } catch (e) {
    console.log(`[news] Error: ${e.message}`);
    return [];
  }
}

async function updateNewsSnapshots(news, items, dataDir) {
  // Snapshot prices for article items on first fetch; annotate price_since on subsequent fetches.
  const snapFile = path.join(dataDir, 'news_snapshots.json');
  const snapshots = await storage.readJSON(snapFile, {});

  const priceMap = {};
  for (const it of items) {
    if (it.name) priceMap[it.name.toLowerCase()] = it.high || it.low;
  }
  const now = Math.trunc(Date.now() / 1000);
  const minAge = 0; // show delta immediately on second fetch

  for (const article of news) {
    const url = article.url || article.title || '';
    if (!url) continue;

    // Collect relevant item names for this article
    const relevantSet = new Set([
      ...(article.mentions || []).map(m => m.toLowerCase()),
      ...(article.impact_items || []).map(m => m.name.toLowerCase()),
    ]);
    const relevant = [...relevantSet];

    if (!(url in snapshots)) {
      // First time seeing this article — save price snapshot
      const snap = { ts: now, prices: {} };
      for (const name of relevant) {
        if (priceMap[name]) snap.prices[name] = priceMap[name];
      }
      if (Object.keys(snap.prices).length) snapshots[url] = snap;
    } else {
      const snap = snapshots[url];
      const age = now - (snap.ts ?? now);
      if (age >= minAge) {
        const deltas = [];
        for (const name of relevant) {
          const old = snap.prices[name];
          const cur = priceMap[name];
          if (old && cur && old > 0) {
            const pct = pyRound((cur - old) / old * 100, 1);
            deltas.push({ name: _pyTitle(name), pct, old, cur });
          }
        }
        deltas.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
        if (deltas.length) {
          article.price_since = deltas;
          article.price_since_days = pyRound(age / 86400);
        }
      }
    }
  }

  try {
    await storage.writeJSON(snapFile, snapshots, { pretty: true });
  } catch (e) {
    console.log(`[news] Snapshot save error: ${e.message}`);
  }
}

// Same Python str.title() quirk as news.js's _pyTitle (apostrophes start a
// new "word") — duplicated locally rather than importing news.js's
// internal helper, since it's one line and not part of news.js's exports.
function _pyTitle(s) {
  return s.replace(/[A-Za-z]+/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

// ── Main ──────────────────────────────────────────────────────────────────────
// `process` doesn't exist in a browser/webview at all — the CLI-only
// default (process.argv.slice(2)) is meaningless there anyway, since the
// mobile bridge always passes argv explicitly. require.main === module
// below also only matters for the desktop CLI invocation; esbuild's
// require() shim resolves require.main to undefined for a bundled module,
// so that block already safely never runs on mobile.
async function main(argv = (typeof process !== 'undefined' ? process.argv.slice(2) : []), historyStatsOverride = null) {
  const args = parseArgs(argv);
  const dataDir = await getDataDir(args.dataDir);
  const outFile = path.join(dataDir, 'latest.json');

  console.log(`[run] Mode: ${args.mode} | Data dir: ${dataDir}`);

  const existing = await storage.readJSON(outFile, {});

  let items = existing.items || [];
  let news = existing.news || [];
  let usedFallbackItems = false;

  if (args.mode === 'full' || args.mode === 'prices') {
    const existingItems = existing.items || [];
    const fetched = await fetchPrices(dataDir, args.webhook, existingItems, historyStatsOverride);
    if (fetched.length === 0 && existingItems.length > 0) {
      console.log(`[run] fetchPrices returned 0 items but ${existingItems.length} existing items are on disk — keeping the existing data instead of overwriting it with an empty result.`);
      items = existingItems;
      usedFallbackItems = true;
    } else {
      items = fetched;
    }
  }

  if (args.mode === 'full' || args.mode === 'news') {
    news = await fetchNewsData(items.length ? items : null);
    if (items.length) await updateNewsSnapshots(news, items, dataDir);
  }

  // Append untradeable items (Invention components + combo potions).
  // Skipped on a fallback — `items` is already the PREVIOUS full saved
  // output in that case, which already has untradeable items merged in
  // from the last successful run; appending again here would duplicate
  // every one of them.
  if ((args.mode === 'full' || args.mode === 'prices') && !usedFallbackItems) {
    try {
      const { load: loadUntradeable } = require('./untradeable.js');
      const natureRuneItem = items.find(it => (it.name || '').toLowerCase() === 'nature rune');
      const natureRunePrice = natureRuneItem ? natureRuneItem.high : 0;
      const utItems = await loadUntradeable(natureRunePrice, false, dataDir);
      for (const it of utItems) it.natureRunePrice = natureRunePrice;
      items = items.concat(utItems);
      console.log(`[untradeable] Appended ${utItems.length} untradeable items`);
    } catch (e) {
      console.log(`[untradeable] Error: ${e.message}`);
    }
  } else if (usedFallbackItems && !items.some(it => it.untradeable)) {
    // Sanity check — the fallback path assumes `items` (the previous full
    // file) already has untradeable items merged in, so re-appending here
    // would duplicate them. If that assumption is ever false (e.g. the
    // previous file predates the untradeable feature, or was reset), the
    // Almanac's Components pill silently vanishes with no error anywhere —
    // this makes that state visible in logs instead of silent.
    console.log('[untradeable] WARNING: fallback items contain none — Components pill will be empty until the next successful full/prices fetch.');
  }

  // Fetch market indexes (1h cache)
  let indexes = [];
  if (args.mode === 'full' || args.mode === 'prices') {
    try {
      const { load: loadIndexes } = require('./market_watch.js');
      indexes = await loadIndexes(false, dataDir);
    } catch (e) {
      console.log(`[market_watch] Error: ${e.message}`);
    }
  }

  // Jagex's own official GE Top 100 Rises/Falls (1h cache internally, see
  // top100.js) — a distinct data source from everything else here, shown
  // alongside GEnius's own real-time equivalent on the Dashboard.
  let officialTop100 = { byWindow: {} };
  if (args.mode === 'full' || args.mode === 'prices') {
    try {
      const { load: loadTop100 } = require('./top100.js');
      officialTop100 = await loadTop100(false, dataDir);
    } catch (e) {
      console.log(`[top100] Error: ${e.message}`);
    }
  }

  // Real item icon URLs via the wiki's own API (icons.js), replacing the
  // old renderer.js filename-guessing approach — resolved incrementally
  // (RESOLVE_PER_RUN in icons.js) so a fresh install's ~7,400 items
  // backfill over several fetch cycles instead of one blocking call.
  if ((args.mode === 'full' || args.mode === 'prices') && items.length) {
    try {
      const { resolveIcons } = require('./icons.js');
      const iconCache = await resolveIcons(items.map(it => it.name), dataDir);
      for (const it of items) {
        const entry = iconCache[(it.name || '').toLowerCase()];
        // `icon` (small inventory sprite) is what's shown inline
        // everywhere; `detail` (the wiki's big zoomed-in render) is only
        // used for the "click to enlarge" view — they can look
        // meaningfully different (different angle/scale/shadow), so
        // showing detail inline was mistaken for a rendering glitch.
        if (entry?.icon) it.iconUrl = entry.icon;
        if (entry?.detail) it.iconDetailUrl = entry.detail;
      }
    } catch (e) {
      console.log(`[icons] Error: ${e.message}`);
    }
  }

  // Items removed from the GE (Ben, 2026-10-28: Jagex is removing Silverhawk
  // feathers, springs, the portables... next month). The item list is
  // rebuilt from the dump every fetch, so a removed item would silently
  // vanish: gone from the watchlist, and worth 0 (-100%) in the portfolio.
  // Instead, a tradeable item missing from the dump is held in missingItems
  // (with its last data) and, once it has been missing for a full day (one
  // short dump is not a removal), moves to removedItems for good. Removed
  // items are NOT in `items`, so market scans skip them; the watchlist,
  // portfolio and alerts look them up and show "Removed from GE".
  let missingItems = existing.missingItems || {};
  let removedItems = existing.removedItems || [];
  const prevTradeable = (existing.items || []).filter(it => !it.untradeable && it.id);
  if ((args.mode === 'full' || args.mode === 'prices') && !usedFallbackItems &&
      items.filter(it => !it.untradeable).length >= prevTradeable.length * 0.9) {
    const now = Date.now();
    const present = new Set(items.map(it => it.id));
    const nextMissing = {};
    for (const [id, m] of Object.entries(missingItems)) if (!present.has(Number(id))) nextMissing[id] = m;
    for (const it of prevTradeable) {
      if (!present.has(it.id) && !nextMissing[it.id]) nextMissing[it.id] = { since: now, item: it };
    }
    removedItems = removedItems.filter(r => !present.has(r.id)); // came back: not removed after all
    for (const [id, m] of Object.entries(nextMissing)) {
      if (now - m.since < 24 * 3600000) continue;
      if (!removedItems.some(r => r.id === Number(id))) {
        removedItems.push({ ...m.item, removedFromGe: true, removedAt: m.since });
        console.log(`[run] ${m.item.name} has been missing from the GE data for a day: marked removed from the GE`);
      }
      delete nextMissing[id];
    }
    missingItems = nextMissing;
  }

  const output = {
    items,
    missingItems,
    removedItems,
    news,
    indexes,
    officialTop100,
    // A failed price fetch keeps the previous items — and their previous
    // timestamp, so stale prices never get labelled as a fresh update.
    timestamp: usedFallbackItems && existing.timestamp ? existing.timestamp : Date.now(),
    updated_at: usedFallbackItems && existing.updated_at ? existing.updated_at : new Date().toISOString(),
  };

  await storage.writeJSON(outFile, output, { pretty: true });
  console.log(`[run] Saved ${items.length} items + ${news.length} news -> ${outFile}`);
  return { pricesFailed: usedFallbackItems };
}

module.exports = {
  parseArgs, getDataDir, fetchPrices, runSignals,
  fmtGp, fetchNewsData, updateNewsSnapshots, main,
};

if (require.main === module) {
  main();
}
