/**
 * GEnius Almanac — DXP event module.
 *
 * Faithful JS port of python/dxp_intelligence.py (Python-to-JS backend
 * migration, see TODO.txt / SESSION_LOG.md, 2026-06-26). The Almanac's
 * actual core math — verify against the Python original on real history
 * data before trusting this over it. All "datetimes" here are represented
 * as plain milliseconds-since-epoch numbers (UTC) rather than Date
 * objects, since that's all simple arithmetic and is exactly equivalent
 * to Python's naive-UTC datetime arithmetic for this module's purposes.
 */

const path = require('path');
const storage = require('./storage.js');
const { pyRound, pySum } = require('./_pyround.js');

const MS_PER_DAY = 86400000;

// Fallback baseline if dxp_events.json is ever missing — keeps the module
// usable standalone. Real runs should always go through loadEvents(),
// which supersedes this with the bundled + local merge.
const EVENTS = [
  ["2025-11-07", "2025-11-14", "2025-11-24"],
  ["2025-08-06", "2025-08-15", "2025-08-25"],
  ["2025-04-25", "2025-05-16", "2025-05-26"],
  ["2025-01-23", "2025-02-21", "2025-03-03"],
  ["2024-11-04", "2024-11-15", "2024-11-25"],
  ["2024-07-23", "2024-08-02", "2024-08-12"],
  ["2024-04-16", "2024-05-17", "2024-05-27"],
  ["2024-02-01", "2024-02-16", "2024-02-26"],
  ["2023-10-27", "2023-11-10", "2023-11-20"],
  ["2023-06-29", "2023-07-28", "2023-08-07"],
];

// Bundled dev-curated event list — read-only at runtime, only ever edited
// directly in the project. require()'ing a .json file just parses it with
// no fs access at the call site, so this works identically whether bundled
// for desktop (Node) or a future mobile build (a bundler inlines it at
// build time) — same approach as catalogue.js's bulk overrides file.
const BUNDLED_EVENTS = require('./data/dxp_events.json').map(e => [...e]);

// ─── RS Wiki auto-fetch ───────────────────────────────────────────────────────

const WIKI_DXP_URL = 'https://runescape.wiki/api.php?action=parse&page=Double+XP&prop=wikitext&format=json&origin=*';
// Daily, not weekly (Ben, 2026-10-07): a new DXP should reach the Almanac
// within a day of its announcement. One small wiki request.
const WIKI_REFRESH_MS = 24 * 3600000;
const WIKI_CACHE_FILE = 'dxp_events_wiki.json';

const WIKI_MONTHS = {
  january:1, february:2, march:3, april:4, may:5, june:6,
  july:7, august:8, september:9, october:10, november:11, december:12
};

function _parseWikiDate(cell) {
  // Parses "| [[D Month]] [[YYYY]]" or "| [[D Month]] [[YYYY]] (HH:MM)"
  const m = cell.match(/\[\[(\d{1,2})\s+([A-Za-z]+)\]\]\s*\[\[(\d{4})\]\]/);
  if (!m) return null;
  const month = WIKI_MONTHS[m[2].toLowerCase()];
  if (!month) return null;
  const y = m[3], mo = String(month).padStart(2, '0'), d = String(m[1]).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

function _parseWikiDxpTable(wikitext) {
  const lines = wikitext.split('\n');
  const events = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== '|-') continue;
    i++;
    if (i >= lines.length || !lines[i].startsWith('| ')) continue; // year header or end
    // Collect first 3 cells (announced, start, end) — notes cell ignored
    const cells = [];
    for (let j = i; j < lines.length && lines[j].startsWith('| ') && cells.length < 3; j++) {
      cells.push(lines[j]);
    }
    if (cells.length < 3) continue;
    const announced = _parseWikiDate(cells[0]);
    const start     = _parseWikiDate(cells[1]);
    const end       = _parseWikiDate(cells[2]);
    if (announced && start && end) events.push([announced, start, end]);
  }
  return events;
}

// Per-session in-memory cache so repeated loadEvents() calls don't re-fetch.
let _wikiEventsCache = null;
let _wikiEventsCacheAt = 0; // in-memory copy also expires — GEnius often stays open for days

async function _fetchWikiDxpEvents(dataDir) {
  if (_wikiEventsCache !== null && Date.now() - _wikiEventsCacheAt < WIKI_REFRESH_MS) return _wikiEventsCache;
  _wikiEventsCacheAt = Date.now();
  if (!dataDir) return (_wikiEventsCache = []);

  const cachePath = path.join(dataDir, WIKI_CACHE_FILE);
  const disk = await storage.readJSON(cachePath, null);

  // Return disk cache if still fresh — but still kick off a background
  // refresh so the NEXT session gets updated data.
  if (disk?.fetchedAt && Date.now() - disk.fetchedAt < WIKI_REFRESH_MS) {
    _wikiEventsCache = disk.events || [];
    return _wikiEventsCache;
  }

  try {
    const res = await fetch(WIKI_DXP_URL, {
      headers: { 'User-Agent': 'GEnius-app/1.8 (RS3 GE tracker; contact: letterslive@gmail.com)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const wikitext = json?.parse?.wikitext?.['*'] || '';
    const events = _parseWikiDxpTable(wikitext);
    if (events.length >= 10) { // sanity check — the real table has 35+ rows
      await storage.writeJSON(cachePath, { fetchedAt: Date.now(), events }, { pretty: true });
      _wikiEventsCache = events;
    } else {
      _wikiEventsCache = disk?.events || [];
    }
  } catch {
    _wikiEventsCache = disk?.events || [];
  }
  return _wikiEventsCache;
}

// ─── Event loader ─────────────────────────────────────────────────────────────

async function loadEvents(dataDir = null) {
  // Merges three sources: bundled dev-curated list, user's local overrides,
  // and live RS Wiki data (fetched at most once per week, cached on disk).
  // All three are deduped by the exact [announced, start, end] triple so
  // there's no double-counting when the wiki confirms an event we already
  // have bundled.
  const localPath = dataDir ? path.join(dataDir, 'dxp_events.json') : null;
  const [local, wiki] = await Promise.all([
    localPath ? storage.readJSON(localPath, []) : Promise.resolve([]),
    _fetchWikiDxpEvents(dataDir),
  ]);

  const seen = new Map();
  for (const e of [...BUNDLED_EVENTS, ...local, ...wiki]) seen.set(JSON.stringify(e), e);
  let merged = [...seen.values()].sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0));
  if (!merged.length) merged = EVENTS.map(e => [...e]);

  if (localPath) {
    try { await storage.writeJSON(localPath, merged, { pretty: true }); } catch {}
  }
  return merged;
}

const EARLY_EVENT_DAYS = 5; // how many days into the event count as "early" vs "late"
const RISE_THRESH = 3.0;
const DROP_THRESH = -3.0;
const PHASES = ["pre_announce", "anticipation", "early_event", "late_event", "post_event"];

// Minimum bar before a confidence score is reported for an item at all.
const MIN_EVENTS_FOR_CONFIDENCE = 7;

function toDt(ts) {
  return ts > 1e11 ? ts : ts * 1000;
}

function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

// Python's `(a - b).days` on a timedelta is a true floor division of the
// total elapsed time, not truncation toward zero — matters for negative
// offsets (a buy/sell day before the event start).
function daysFloor(msA, msB) {
  return Math.floor((msA - msB) / MS_PER_DAY);
}

function _bisectLeft(arr, x) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) lo = mid + 1; else hi = mid;
  }
  return lo;
}

function _bisectRight(arr, x) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= x) lo = mid + 1; else hi = mid;
  }
  return lo;
}

// Sorted-by-date history for one item, with a parallel list of just the
// datetimes for bisecting — binary-searches to the relevant date range
// instead of an O(n) scan per lookup (same optimization as the Python
// original, see its docstring for why that mattered: 40+ second full runs
// before this).
class Parsed {
  constructor(points) {
    const rows = points
      .map(p => [toDt(p.timestamp), p.price ?? null, p.volume || 0])
      .sort((a, b) => a[0] - b[0]);
    this.rows = rows;
    this.dts = rows.map(r => r[0]);
  }
  slice(startMs, endMs) {
    const lo = _bisectLeft(this.dts, startMs);
    const hi = _bisectRight(this.dts, endMs);
    return this.rows.slice(lo, hi);
  }
}

function parsePoints(points) {
  return new Parsed(points);
}

function nearestPrice(parsed, targetMs, maxDays = 5) {
  const window = parsed.slice(targetMs - maxDays * MS_PER_DAY, targetMs + maxDays * MS_PER_DAY);
  let best = null, bestDiff = null;
  for (const [dt, price, vol] of window) {
    if (!price) continue;
    const diff = Math.abs(dt - targetMs);
    if (bestDiff === null || diff < bestDiff) { best = [dt, price, vol]; bestDiff = diff; }
  }
  if (best === null) return null;
  return { timestamp: best[0], price: best[1], volume: best[2] };
}

function avgVolume(parsed, startMs, endMs) {
  const vols = parsed.slice(startMs, endMs).map(r => r[2]);
  return vols.length ? pySum(vols) / vols.length : 0;
}

function windowedExtreme(parsed, winStart, winEnd, find = 'min') {
  const pts = parsed.slice(winStart, winEnd).filter(r => r[1]).map(r => [r[0], r[1]]);
  if (!pts.length) return null;
  // JS Array.sort is stable (spec-guaranteed since ES2019), matching
  // Python's stable sort (including reverse=True for "max", which Python
  // also keeps stable, NOT equivalent to ascending-then-reverse).
  pts.sort((a, b) => find === 'max' ? b[1] - a[1] : a[1] - b[1]);
  return pts[0];
}

// ── statistics.median / statistics.pstdev — no JS built-in equivalent ──────
// (pyRound/pySum live in _pyround.js — shared with run.js, see that file
// for why both the round-half-to-even and Neumaier-summation fixes were
// genuinely necessary, not precautionary.)

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  const mid = Math.floor(n / 2);
  return n % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function pstdev(arr) {
  const n = arr.length;
  const mean = arr.reduce((a, b) => a + b, 0) / n;
  const variance = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return Math.sqrt(variance);
}

function round1(x) { return pyRound(x, 1); }
function round2(x) { return pyRound(x, 2); }

function classifyItem(points, parsed = null, events = null) {
  // Phase-by-phase price/volume tally across all tracked events.
  if (events === null) events = EVENTS;
  const tally = {};
  for (const p of PHASES) tally[p] = { rise: 0, drop: 0, flat: 0, total: 0, pcts: [], vols: [], events: [] };
  if (!points || !points.length) return tally;
  if (parsed === null) parsed = parsePoints(points);

  const allVols = parsed.rows.map(r => r[2]).filter(v => v !== null && v !== undefined).sort((a, b) => a - b);
  const baselineVol = allVols.length ? allVols[Math.floor(allVols.length / 2)] : 0;

  for (const [announced, start, end] of events) {
    const aDt = parseDate(announced);
    const sDt = parseDate(start);
    const eDt = parseDate(end);
    const midDt = sDt + EARLY_EVENT_DAYS * MS_PER_DAY;
    const baselineDt = aDt - 21 * MS_PER_DAY;
    const afterDt = eDt + 21 * MS_PER_DAY;

    const baseline = nearestPrice(parsed, baselineDt);
    const atAnnounce = nearestPrice(parsed, aDt);
    const atStart = nearestPrice(parsed, sDt);
    const atMid = nearestPrice(parsed, midDt);
    const atEnd = nearestPrice(parsed, eDt);
    const after = nearestPrice(parsed, afterDt);

    const pairs = {
      pre_announce: [baseline, atAnnounce, baselineDt, aDt],
      anticipation: [atAnnounce, atStart, aDt, sDt],
      early_event: [atStart, atMid, sDt, midDt],
      late_event: [atMid, atEnd, midDt, eDt],
      post_event: [atEnd, after, eDt, afterDt],
    };
    for (const phase of PHASES) {
      const [a, b, winStart, winEnd] = pairs[phase];
      const vol = avgVolume(parsed, winStart, winEnd);
      if (vol) {
        tally[phase].vols.push(baselineVol ? round2(vol / baselineVol) : null);
      }
      if (!(a && b && a.price)) continue;
      const pct = (b.price - a.price) / a.price * 100;
      tally[phase].total += 1;
      tally[phase].pcts.push(round2(pct));
      const direction = pct > RISE_THRESH ? 'rise' : pct < DROP_THRESH ? 'drop' : 'flat';
      tally[phase][direction] += 1;
      tally[phase].events.push({ event_start: start, pct: round2(pct), direction });
    }
  }

  for (const phase of PHASES) {
    const pcts = tally[phase].pcts;
    tally[phase].avg_pct = pcts.length ? round2(pySum(pcts) / pcts.length) : null;
    tally[phase].median_pct = pcts.length ? round2(median(pcts)) : null;
    const vols = tally[phase].vols.filter(v => v !== null && v !== undefined);
    tally[phase].avg_vol_ratio = vols.length ? round2(pySum(vols) / vols.length) : null;
  }
  return tally;
}

function bestBuySellDays(points, parsed = null, events = null) {
  // Pinpoints the precise day (offset from event start) of the best buy
  // and best sell window, with a std-dev confidence indicator.
  if (events === null) events = EVENTS;
  if (parsed === null) parsed = parsePoints(points);
  const preTroughs = [], postTroughs = [], peaks = [], dips = [];
  for (const [announced, start, end] of events) {
    const aDt = parseDate(announced), sDt = parseDate(start), eDt = parseDate(end);
    const baselineDt = aDt - 21 * MS_PER_DAY;
    const afterDt = eDt + 21 * MS_PER_DAY;

    const pre = windowedExtreme(parsed, baselineDt, sDt, 'min');
    const post = windowedExtreme(parsed, eDt, afterDt, 'min');
    const peak = windowedExtreme(parsed, sDt, eDt, 'max');
    const dip = windowedExtreme(parsed, sDt, eDt, 'min');
    const baselinePt = windowedExtreme(parsed, baselineDt, baselineDt + 3 * MS_PER_DAY, 'min');
    if (!(pre && post && peak && dip && baselinePt)) continue;
    const baselinePrice = baselinePt[1];
    preTroughs.push(daysFloor(pre[0], sDt));
    postTroughs.push(daysFloor(post[0], sDt));
    peaks.push([daysFloor(peak[0], sDt), round1((peak[1] - baselinePrice) / baselinePrice * 100)]);
    dips.push([daysFloor(dip[0], sDt), round1((dip[1] - baselinePrice) / baselinePrice * 100)]);
  }

  if (peaks.length < MIN_EVENTS_FOR_CONFIDENCE) return null;

  const peakDays = peaks.map(p => p[0]);
  const dipDays = dips.map(d => d[0]);
  return {
    n_events: peaks.length,
    best_sell_day_offset: median(peakDays),
    best_sell_day_std: round1(pstdev(peakDays)),
    best_sell_pct_median: median(peaks.map(p => p[1])), // no round() in the Python original — kept raw, including its own float artifacts
    best_buy_day_offset: median(dipDays),
    best_buy_day_std: round1(pstdev(dipDays)),
    best_buy_pct_median: median(dips.map(d => d[1])), // no round() in the Python original — kept raw, including its own float artifacts
    pre_trough_offset_median: median(preTroughs),
    post_trough_offset_median: median(postTroughs),
  };
}

// Would this item's plan have made money? (Ben, 2026-11-05) Replays it through each
// finished DXP, choosing the days from earlier DXPs only, after the 2% tax. The app's
// old profit figure combined separate typical highs and lows, so it never came from a
// real trade: Yak-hide showed +58gp but lost 5.7% in a typical replay. Control is the
// same trade 45 days earlier, to catch what's only drift. GUIDE prices: old DXPs have
// no live history, so real fills will be worse. research/dxp_plan_backtest has the study.
const REPLAY_MIN_PRIOR = 5, REPLAY_MIN_TESTS = 8, REPLAY_DAY_WINDOW = 12;
// early = the New Items tab (Ben, 2026-11-05): same tests for items without the 13 DXPs
// a full replay needs (5 to learn the days, 8 to test), learning from as few as 2. It
// reports what it finds but never passes, so these items stay out of Recommendations.
// Bump whenever what's saved in dxp_intelligence.json changes shape, so an updated app
// rebuilds it at once instead of showing the old file (Ben, 2026-11-05: replays and
// New Items stayed empty after updating until a manual Refresh).
const ALMANAC_DATA_VERSION = 3;
const REPLAY_FULL_DXPS =REPLAY_MIN_PRIOR + REPLAY_MIN_TESTS;
function planReplay(points, events, early = false) {
  const pts = (points || []).filter(p => p.price > 0)
    .map(p => [p.timestamp > 1e12 ? p.timestamp : p.timestamp * 1000, p.price, p.volume || 0]).sort((a, b) => a[0] - b[0]);
  if (pts.length < (early ? 20 : 200)) return null;
  const minPrior = early ? 2 : REPLAY_MIN_PRIOR;
  const firstAtOrAfter = ts => { let lo = 0, hi = pts.length; while (lo < hi) { const m = (lo + hi) >> 1; if (pts[m][0] < ts) lo = m + 1; else hi = m; } return lo; };
  const priceAt = ts => { const i = firstAtOrAfter(ts + 1) - 1; return i >= 0 && ts - pts[i][0] <= 3 * MS_PER_DAY ? pts[i][1] : null; };
  const evs = [...events].sort((a, b) => (a[1] < b[1] ? -1 : 1)).map(e => ({ start: parseDate(e[1]), end: parseDate(e[2]) }));
  const extremes = ev => {
    const from = firstAtOrAfter(ev.start), to = firstAtOrAfter(ev.end + 1);
    if (to - from < 3) return null;
    let lo = pts[from], hi = pts[from];
    for (let i = from; i < to; i++) { if (pts[i][1] < lo[1]) lo = pts[i]; if (pts[i][1] > hi[1]) hi = pts[i]; }
    return { buy: Math.floor((lo[0] - ev.start) / MS_PER_DAY), sell: Math.floor((hi[0] - ev.start) / MS_PER_DAY) };
  };
  const daysFrom = seen => { const r = seen.slice(-REPLAY_DAY_WINDOW); return { buy: median(r.map(s => s.buy)), sell: median(r.map(s => s.sell)) }; };
  const seen = [], rets = [], ctls = [];
  evs.forEach((ev, i) => {
    if (seen.length >= minPrior) {
      const d = daysFrom(seen), buyFirst = d.buy <= d.sell, next = evs[i + 1];
      const run = shift => {
        const sellP = priceAt(ev.start + shift + Math.round(d.sell) * MS_PER_DAY);
        const buyP = buyFirst ? priceAt(ev.start + shift + Math.round(d.buy) * MS_PER_DAY)
          : next ? priceAt(next.start + shift + Math.round(d.buy) * MS_PER_DAY) : null;
        return sellP && buyP ? (sellP * 0.98 / buyP - 1) * 100 : null;
      };
      const r = run(0), c = run(-45 * MS_PER_DAY);
      if (r != null) rets.push(r);
      if (c != null) ctls.push(c);
    }
    const x = extremes(ev);
    if (x) seen.push(x);
  });
  if (early) {
    // Old items with spotty history aren't new, and dead or cheap ones aren't worth listing.
    const tail = pts.slice(-90);
    // Quiet items are kept (the tab hides them) so their pop-ups can still say they're fairly new.
    if (seen.length >= REPLAY_FULL_DXPS || tail[tail.length - 1][1] < 100) return null;
    if (!rets.length) return { dxps: seen.length, needed: REPLAY_FULL_DXPS, tests: 0, firstSeen: pts[0][0], volume: median(tail.map(p => p[2])), passes: false };
  } else if (rets.length < REPLAY_MIN_TESTS) return null;
  const d = daysFrom(seen);
  const med = median(rets), ctl = ctls.length ? median(ctls) : 0, wins = rets.filter(r => r > 0).length;
  if (early) {
    const rec = rets.slice(-8), recWins = rec.filter(r => r > 0).length;
    return { dxps: seen.length, needed: REPLAY_FULL_DXPS, firstSeen: pts[0][0], volume: median(pts.slice(-90).map(p => p[2])), tests: rets.length, wins, median: round2(med), control: round2(ctl), recentTests: rec.length, recentWins: recWins, buyDay: d.buy, sellDay: d.sell, buyFirst: d.buy <= d.sell,
      looksGood: med >= 3 && wins / rets.length >= 0.7 && med - ctl >= 2 && recWins / rec.length >= 0.6, passes: false };
  }
  const recent = rets.slice(-8), recentWins = recent.filter(r => r > 0).length;
  const last = pts.slice(-90);
  // Cheap or barely-traded items can't be measured well, and recent DXPs must agree.
  const tradable = last[last.length - 1][1] >= 100 && median(last.map(p => p[2])) >= 100;
  const passes = tradable && med >= 3 && wins / rets.length >= 0.7 && med - ctl >= 2 && recentWins / recent.length >= 0.6;
  return { tests: rets.length, wins, median: round2(med), control: round2(ctl), recentTests: recent.length, recentWins, buyDay: d.buy, sellDay: d.sell, buyFirst: d.buy <= d.sell, passes };
}

function confidenceScore(tally, phase) {
  // Returns [direction, score, total] for the strongest signal in a phase,
  // or null if there isn't enough data / no clear direction.
  const t = tally[phase];
  if (t.total < MIN_EVENTS_FOR_CONFIDENCE) return null;
  if (t.rise >= t.drop && t.rise / t.total >= 0.5) return ['rise', t.rise, t.total];
  if (t.drop > t.rise && t.drop / t.total >= 0.5) return ['drop', t.drop, t.total];
  return null;
}

// Baked-in research seed — bundled and read-only, same require()-not-fs
// approach as BUNDLED_EVENTS above.
const SEED_DATA = require('./data/dxp_seed.json');

function loadSeed() {
  return SEED_DATA;
}

function mergeEntry(live, seed) {
  // Merges a live-computed entry with the seed entry for the same item,
  // favoring whichever source has more event coverage PER PHASE.
  if (!live) return seed;
  if (!seed) return live;
  const merged = { name: live.name || seed.name, limit: live.limit, phases: {} };
  for (const p of PHASES) {
    const lp = live.phases?.[p], sp = seed.phases?.[p];
    if (!lp) merged.phases[p] = sp;
    else if (!sp) merged.phases[p] = lp;
    else merged.phases[p] = (lp.total || 0) >= (sp.total || 0) ? lp : sp;
  }
  const liveT = live.timing, seedT = seed.timing;
  if (liveT && seedT) {
    merged.timing = (liveT.n_events || 0) >= (seedT.n_events || 0) ? liveT : seedT;
  } else {
    merged.timing = liveT || seedT;
  }
  if (live.replay) merged.replay = live.replay;
  if (live.early) merged.early = live.early;
  return merged;
}

// Async + batched for the same reason get-signal-trend in main.js got the
// same treatment tonight: this loop was cheap while history population
// was stuck at ~20% coverage, and got dramatically more expensive (~6
// real seconds, measured directly) now that it's genuinely complete
// (7184 items, most with deep history). Yielding between batches keeps
// the main process responsive while this runs instead of blocking it
// for the whole computation.
// getHistoryPointsFn: async (itemId) => points | null — a lazy per-item
// accessor rather than a pre-loaded {itemId: points} object. Changed
// 2026-08-03: this used to receive the full historyData object directly,
// which needed EVERY item's full multi-year history resident in memory
// simultaneously just to call this function — a real contributor to the
// mobile WebView OOM crashes chasing HISTORY_FETCH_CONCURRENCY down from
// 12 to 8 never fully fixed (see api.js's historyData comment for the
// full story). The caller now supplies a lazy accessor (api.js's
// getHistoryPoints, evicted again immediately after each item here) so
// this function's own peak memory stays bounded to ~BATCH items in
// flight, not the whole catalogue.
async function computeDxpData(allItemIds, getHistoryPointsFn, itemLimits = null, itemNames = null, useSeed = true, events = null, replayEvents = null) {
  if (events === null) events = EVENTS;
  itemLimits = itemLimits || {};
  itemNames = itemNames || {};
  const live = {};
  // Confirmed for real on a Pixel 8 Pro (2026-06-29): this whole computation
  // took 146.7s on-device vs 7.8s on a desktop dev machine — a ~19x gap, not
  // explained by yielding alone, but the OLD batch size of 250 meant each
  // fully-synchronous chunk between yields took 5+ seconds on that hardware.
  // Even though this runs in the background (not blocking the caller, see
  // api.js's getDxpIntelligence disk-serve-then-refresh), a single JS thread
  // also drives the UI in this hybrid-webview app, so a 5-second unyielded
  // chunk reads as the whole app freezing/janking, not just "a background
  // task is busy." A much smaller batch yields far more often, keeping any
  // single synchronous chunk well under what's perceptible as a freeze,
  // at the cost of more total yields (negligible — setTimeout(0) overhead
  // is microseconds, irrelevant next to a 90-150s total runtime).
  const BATCH = 25;
  for (let b = 0; b < allItemIds.length; b += BATCH) {
    for (const itemId of allItemIds.slice(b, b + BATCH)) {
      const points = await getHistoryPointsFn(itemId);
      if (!points || points.length < 20) continue;
      const parsed = parsePoints(points);
      const tally = classifyItem(points, parsed, events);
      const timing = bestBuySellDays(points, parsed, events);
      const hasSignal = PHASES.some(p => confidenceScore(tally, p));
      const replay = planReplay(points, replayEvents || events);
      const early = replay ? null : planReplay(points, replayEvents || events, true);
      if (!hasSignal && !timing && !early) continue;
      const phases = {};
      for (const p of PHASES) {
        phases[p] = {
          rise: tally[p].rise, drop: tally[p].drop, flat: tally[p].flat,
          total: tally[p].total, avg_pct: tally[p].avg_pct,
          median_pct: tally[p].median_pct, avg_vol_ratio: tally[p].avg_vol_ratio,
          events: tally[p].events,
        };
      }
      live[itemId] = {
        name: itemNames[itemId] ?? itemId,
        limit: itemLimits[itemId] ?? null,
        phases,
        timing,
        replay,
        ...(early ? { early } : {}),
      };
    }
    if (b + BATCH < allItemIds.length) await new Promise(res => setTimeout(res, 0));
  }

  const meta = { event_count: events.length, version: ALMANAC_DATA_VERSION };
  if (!useSeed) {
    live._meta = meta;
    return live;
  }

  const seed = loadSeed();
  const allIds = new Set([...Object.keys(live), ...Object.keys(seed)]);
  allIds.delete('_meta');
  const out = {};
  for (const itemId of allIds) {
    const merged = mergeEntry(live[itemId], seed[itemId]);
    if (itemId in itemLimits) merged.limit = itemLimits[itemId];
    if (itemId in itemNames) merged.name = itemNames[itemId];
    out[itemId] = merged;
  }
  out._meta = meta;
  return out;
}

module.exports = {
  EVENTS, loadEvents, parsePoints, nearestPrice, avgVolume, windowedExtreme,
  classifyItem, bestBuySellDays, planReplay, ALMANAC_DATA_VERSION, confidenceScore, loadSeed, mergeEntry,
  computeDxpData, median, pstdev, PHASES,
};

if (require.main === module) {
  (async () => {
    const dataDir = process.argv[2];
    if (!dataDir) {
      console.error('Usage: node dxp_intelligence.js <data-dir>');
      process.exit(1);
    }
    // History moved from one history.json to per-item files under
    // data/history/<id>.json earlier tonight — read the new format,
    // falling back to the old monolithic file if it's still around
    // (e.g. a data dir that was never actually migrated).
    const historyDir = path.join(dataDir, 'history');
    let history = await storage.loadDirBatched(historyDir);
    if (Object.keys(history).length === 0) {
      const legacyFile = path.join(dataDir, 'history.json');
      history = await storage.readJSON(legacyFile, {});
    }
    const itemLimits = {}, itemNames = {};
    const latestFile = path.join(dataDir, 'latest.json');
    const latest = await storage.readJSON(latestFile, { items: [] });
    for (const it of latest.items || []) {
      if (it.id) {
        itemLimits[String(it.id)] = it.limit ?? null;
        itemNames[String(it.id)] = it.name;
      }
    }
    const events = await loadEvents(dataDir);
    const result = await computeDxpData(Object.keys(history), async id => history[id], itemLimits, itemNames, true, events);
    const outFile = path.join(dataDir, 'dxp_intelligence.json');
    await storage.writeJSON(outFile, result);
    const itemCount = Object.keys(result).length - ('_meta' in result ? 1 : 0);
    console.log(`[dxp_intelligence] ${itemCount} items with a usable signal, tracking ${events.length} DXP events, written to ${outFile}`);
  })();
}
