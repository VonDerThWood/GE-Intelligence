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

async function fetchPrices(dataDir, webhookUrl = null, existingItems = null, historyDataOverride = null) {
  const HEADERS = { 'User-Agent': 'GEnius/1.0 (github.com/VonDerThWood/GE-Intelligence)' };
  const DUMP_URL = 'https://chisel.weirdgloop.org/gazproj/gazbot/rs_dump.json';

  // Real volume averages AND previous-day prices, used for change_1d and
  // avgVolume below. historyDataOverride is the already-loaded in-memory
  // historyData from main.js (passed in by runPython) — using it directly
  // avoids a second read AND avoids a real bug that was here: this used
  // to always read the OLD monolithic history.json, which the per-item
  // storage migration renamed away earlier tonight. Since that file no
  // longer existed, historyVolAvg/historyPrevPrice were SILENTLY EMPTY on
  // every fetch since — meaning change_1d only ever populated from the
  // live dump's own "last" field (245/7182 items, not the ~thousands
  // expected), and avgVolume fell back to rough EMA estimates for nearly
  // the whole catalogue instead of real history. Confirmed for real via
  // a tester noticing the suspiciously low "with price data" count.
  const historyVolAvg = {};
  const historyPrevPrice = {};
  let history = historyDataOverride;
  if (!history) {
    // No override (e.g. standalone CLI use) — fall back to reading the
    // per-item storage directory directly.
    const historyDir = path.join(dataDir, 'history');
    history = await storage.loadDirBatched(historyDir);
  }
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
      }
      console.log(`[prices] Loaded history for ${Object.keys(historyVolAvg).length} items (vol) / ${Object.keys(historyPrevPrice).length} items (price)`);
    } catch (e) {
      console.log(`[prices] Could not process history data: ${e.message}`);
    }
  }

  // Build previous volume lookups from last fetch (EMA fallback for items without history)
  const EMA_ALPHA = 0.08;
  const prevAvgVolume = {};
  if (existingItems) {
    for (const it of existingItems) {
      const name = it.name || '';
      const avgVol = it.avgVolume;
      if (name && avgVol) prevAvgVolume[name] = avgVol;
    }
  }

  console.log('[prices] Fetching RS3 GE dump from WeirdGloop...');

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

      // Price change — dump's last field first, then history fallback
      const lastPrice = itemData.last;
      if (lastPrice && lastPrice > 0 && price !== lastPrice) {
        changeOneDay = pyRound(((price - lastPrice) / lastPrice) * 100, 2);
      } else if (itemId && String(itemId) in historyPrevPrice) {
        const prev = historyPrevPrice[String(itemId)];
        changeOneDay = (prev && prev > 0) ? pyRound(((price - prev) / prev) * 100, 2) : null;
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

    itemsOut.push({
      id: itemId, name, categories, high, low, alch, limit, volume,
      avgVolume, change_1d: changeOneDay, examine, members,
    });
  }

  console.log(`[prices] Processed ${itemsOut.length} tradeable items`);
  const changed = itemsOut.filter(it => it.change_1d !== null && it.change_1d !== undefined).length;
  console.log(`[prices] Items with price change data: ${changed}/${itemsOut.length}`);

  const signaled = runSignals(itemsOut);

  if (webhookUrl) await checkAlerts(signaled, dataDir, webhookUrl);

  return signaled;
}

// ── Signal thresholds ────────────────────────────────────────────────────────
const SURGE_CHG_MIN = 5.0;
const DUMP_CHG_MAX = -5.0;
const DIR_VOL_RATIO = 1.2;
const FLAT_CHG_MIN = -3.0;
const FLAT_CHG_MAX = 3.0;
const ACCUM_VOL_MIN = 1.3;
const DISTRIB_VOL_MIN = 2.5;
const MIN_VOL_ABS = 5000;
const VOL_FRENZY_MIN = 2.5;
const VOL_HIGH_MIN = 1.5;
const VOL_ACTIVE_MIN = 1.1;
const VOL_QUIET_MAX = 0.9;
const VOL_THIN_MAX = 0.5;

function runSignals(items) {
  // Tag items with market signals based on price change and volume behavior.
  let natureRunePrice = 0;
  for (const item of items) {
    if ((item.name || '').toLowerCase() === 'nature rune') {
      natureRunePrice = item.high || item.low || 0;
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

    const hasAvg = !!(avgVol && vol >= MIN_VOL_ABS);
    const volRatio = hasAvg ? (vol / avgVol) : 0;

    const gePrice0 = high || low;

    // Skip all signals for items under 900gp — not actionable
    if (gePrice0 < 900) {
      item.signals = [];
      item.natureRunePrice = natureRunePrice;
      continue;
    }

    const absChgGp = Math.abs(chg / 100 * gePrice0);
    if (chg >= SURGE_CHG_MIN && absChgGp >= 1000 && (!hasAvg || volRatio >= DIR_VOL_RATIO)) {
      signals.push('SURGE');
    } else if (chg <= DUMP_CHG_MAX && absChgGp >= 1000 && (!hasAvg || volRatio >= DIR_VOL_RATIO)) {
      signals.push('DUMP');
    } else if (hasAvg && chg >= FLAT_CHG_MIN && chg <= FLAT_CHG_MAX) {
      if (volRatio >= DISTRIB_VOL_MIN) signals.push('DISTRIBUTION');
      else if (volRatio >= ACCUM_VOL_MIN) signals.push('ACCUMULATION');
    }

    // MANIPULATED: extreme volume + large price move + tiny buy limit
    const limit = item.limit || 0;
    if (hasAvg && volRatio >= 2.5 && Math.abs(chg) >= 8.0 && limit > 0 && limit <= 100) {
      signals.push('MANIPULATED');
    }

    // Volume tier badge
    if (vol >= MIN_VOL_ABS && avgVol) {
      if (volRatio >= VOL_FRENZY_MIN) signals.push('FRENZY');
      else if (volRatio >= VOL_HIGH_MIN) signals.push('HIGH_VOL');
      else if (volRatio >= VOL_ACTIVE_MIN) signals.push('ACTIVE');
      else if (volRatio <= VOL_THIN_MAX) signals.push('THIN');
      else if (volRatio <= VOL_QUIET_MAX) signals.push('QUIET');
    } else if (vol && !avgVol && vol > 100000) {
      signals.push('HIGH_VOL');
    }

    // ALCH: alch profit beats GE sell (after 2% tax) + nature rune cost
    if (alch && gePrice0) {
      if (alch > (gePrice0 * 0.98 + natureRunePrice)) signals.push('ALCH');
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
      const profit = alch - (gePrice1 * 0.98) - natureRunePrice;
      if (profit > 0) score += Math.min(10, profit / gePrice1 * 100);
    }
    item.score = pyRound(Math.min(100, score), 1);
  }

  const sigNames = ['SURGE', 'DUMP', 'ACCUMULATION', 'DISTRIBUTION', 'FRENZY', 'HIGH_VOL', 'ACTIVE', 'QUIET', 'THIN', 'ALCH'];
  const counts = {};
  for (const s of sigNames) counts[s] = items.filter(it => (it.signals || []).includes(s)).length;
  console.log('[signals]', counts);
  return items;
}

// ── Alert checker ─────────────────────────────────────────────────────────────
async function checkAlerts(items, dataDir, webhookUrl) {
  const alertsFile = path.join(dataDir, 'alerts.json');
  const alerts = await storage.readJSON(alertsFile, null);
  if (!alerts) return;

  const priceMap = {};
  for (const it of items) priceMap[it.name.toLowerCase()] = it;
  const triggered = [];

  for (const alert of alerts) {
    const name = (alert.item_name || '').toLowerCase();
    const item = priceMap[name];
    if (!item) continue;

    const condition = alert.condition || 'above';
    const price = item.high || item.low || 0;
    const changeOneDay = item.change_1d;
    const signals = item.signals || [];
    const threshold = alert.price || 0;
    const pct = alert.pct || 0;
    const sigType = alert.signal_type || '';

    let hit = false;
    if (condition === 'above' && price > threshold) hit = true;
    else if (condition === 'below' && price < threshold) hit = true;
    else if (condition === 'pct_up' && changeOneDay !== null && changeOneDay !== undefined && changeOneDay >= pct) hit = true;
    else if (condition === 'pct_down' && changeOneDay !== null && changeOneDay !== undefined && changeOneDay <= -Math.abs(pct)) hit = true;
    else if (condition === 'signal' && signals.includes(sigType)) hit = true;
    else if (condition === 'alch' && signals.includes('ALCH')) hit = true;

    if (hit) triggered.push([alert, item]);
  }

  if (triggered.length && webhookUrl) await sendDiscord(triggered, webhookUrl);
}

async function sendDiscord(triggered, webhookUrl) {
  const lines = [];
  for (const [alert, item] of triggered) {
    const condition = alert.condition || 'above';
    const name = alert.item_name;
    const price = item.high || item.low || 0;
    const changeOneDay = item.change_1d;
    const signals = item.signals || [];

    let msg;
    if (condition === 'above') {
      msg = `📈 **${name}** rose above **${fmtGp(alert.price)}gp** — now **${fmtGp(price)}gp**`;
    } else if (condition === 'below') {
      msg = `📉 **${name}** fell below **${fmtGp(alert.price)}gp** — now **${fmtGp(price)}gp**`;
    } else if (condition === 'pct_up') {
      msg = `📈 **${name}** up **+${changeOneDay.toFixed(2)}%** today (threshold: +${alert.pct || 0}%)`;
    } else if (condition === 'pct_down') {
      msg = `📉 **${name}** down **${changeOneDay.toFixed(2)}%** today (threshold: -${alert.pct || 0}%)`;
    } else if (condition === 'signal') {
      msg = `⚡ **${name}** triggered signal **${alert.signal_type || ''}** — price: **${fmtGp(price)}gp**`;
    } else if (condition === 'alch') {
      msg = `🔥 **${name}** is now alch-profitable — price: **${fmtGp(price)}gp**`;
    } else {
      msg = `⚠️ **${name}** alert triggered`;
    }
    lines.push(msg);
  }

  const payload = {
    username: 'GEnius Alert',
    content: '⚠️ **GE Price Alert**\n' + lines.join('\n'),
  };
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    console.log(`[alerts] Sent ${triggered.length} alert(s) to Discord`);
  } catch (e) {
    console.log(`[alerts] Discord error: ${e.message}`);
  }
}

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
async function main(argv = (typeof process !== 'undefined' ? process.argv.slice(2) : []), historyDataOverride = null) {
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
    const fetched = await fetchPrices(dataDir, args.webhook, existingItems, historyDataOverride);
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
      const utItems = await loadUntradeable(natureRunePrice);
      for (const it of utItems) it.natureRunePrice = natureRunePrice;
      items = items.concat(utItems);
      console.log(`[untradeable] Appended ${utItems.length} untradeable items`);
    } catch (e) {
      console.log(`[untradeable] Error: ${e.message}`);
    }
  }

  // Fetch market indexes (1h cache)
  let indexes = [];
  if (args.mode === 'full' || args.mode === 'prices') {
    try {
      const { load: loadIndexes } = require('./market_watch.js');
      indexes = await loadIndexes();
    } catch (e) {
      console.log(`[market_watch] Error: ${e.message}`);
    }
  }

  const output = {
    items,
    news,
    indexes,
    timestamp: Date.now(),
    updated_at: new Date().toISOString(),
  };

  await storage.writeJSON(outFile, output, { pretty: true });
  console.log(`[run] Saved ${items.length} items + ${news.length} news -> ${outFile}`);
}

module.exports = {
  parseArgs, getDataDir, fetchPrices, runSignals, checkAlerts, sendDiscord,
  fmtGp, fetchNewsData, updateNewsSnapshots, main,
};

if (require.main === module) {
  main();
}
