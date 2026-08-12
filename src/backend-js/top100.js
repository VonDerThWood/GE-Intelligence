/**
 * Fetches Jagex's own official GE Top 100 Price Rises / Price Falls lists:
 *   https://secure.runescape.com/m=itemdb_rs/top100?list=2  (rises)
 *   https://secure.runescape.com/m=itemdb_rs/top100?list=3  (falls)
 *
 * Distinct from every other signal GEnius computes — this is Jagex's own
 * official ranking, not something derived from the WeirdGloop dump or the
 * wiki's live-price API. Ben's ask (2026-08-10): a RS3 YouTuber covers
 * these two pages weekly, and Ben wants them surfaced in the app both
 * because they're genuinely useful and as a way to put GEnius in front of
 * that audience.
 *
 * Each row links to https://secure.runescape.com/.../viewitem?obj=<id> —
 * that id is the same item id GEnius already uses everywhere else, so
 * rows are matched against the local catalogue by id, not by fuzzy name
 * matching (name text is unreliable — e.g. "Resonant anima of Ful"
 * appears truncated with a trailing "..." on Jagex's own page for long
 * names in some layouts).
 */

const path = require('path');
const storage = require('./storage.js');

const _DIR = __dirname;
// Dev-only fallback — lands in the repo's data/ folder when top100.js is run
// standalone/tested directly. The packaged app's "files" list only ships
// src/**, assets/**, and node_modules/** (see package.json's build.files) —
// the repo-root data/ folder isn't included in app.asar at all, and asar is
// read-only at runtime regardless. The real path, always used once run.js
// passes a real dataDir through, is the same per-install writable directory
// everything else (history, snapshots, untradeable cache) already uses —
// same pattern as untradeable.js's load().
const _DEV_FALLBACK_CACHE_PATH = path.join(_DIR, '..', '..', 'data', 'top100.json');
const CACHE_TTL = 3600 * 1000; // 1 hour — this list itself only moves slowly, no need to hit it every 15-min fetch cycle

const _HEADERS = { 'User-Agent': 'GEnius-app/2.5 (RS3 GE tracker; contact: letterslive@gmail.com)' };
const _URL = (list, scale) => `https://secure.runescape.com/m=itemdb_rs/top100?list=${list}&scale=${scale}`;
// Jagex's own "Time Period" selector on this page — 0:7 days, 1:1 month,
// 2:3 months, 3:6 months. Confirmed by reading the actual dropdown link
// hrefs (top100?list=2&scale=N), not documented anywhere. Same 4 windows
// GEnius's own real-time equivalent (api.js's getRealTimeMovers) uses, so
// both sides of the Dashboard's Top Movers view share one period picker.
const SCALES = { 7: 0, 30: 1, 90: 2, 180: 3 };

function _parseRows(html) {
  const rows = [];
  const trBlocks = html.match(/<tr>[\s\S]*?<\/tr>/g) || [];
  for (const block of trBlocks) {
    const objMatch = block.match(/obj=(\d+)/);
    const nameMatch = block.match(/alt="([^"]+)"/);
    const pctMatch = block.match(/class='change (positive|negative)'>\s*<a[^>]*>([+\-]?[\d.]+)%<\/a>/);
    if (!objMatch || !nameMatch || !pctMatch) continue;
    const numMatches = [...block.matchAll(/<td[^>]*>\s*<a[^>]*>([\d.,]+[kmb]?)<\/a>\s*<\/td>/gi)];
    rows.push({
      id: Number(objMatch[1]),
      name: nameMatch[1],
      startPrice: numMatches[0] ? numMatches[0][1] : null,
      endPrice: numMatches[1] ? numMatches[1][1] : null,
      gpChange: numMatches[2] ? numMatches[2][1] : null, // Jagex's own "Total Rise"/"Total Fall" column
      // pctMatch[2] already carries its own sign from the page's own text
      // ("-50%", "+66%") — pctMatch[1] (the positive/negative CSS class)
      // is just a redundant confirmation of the same sign, not something
      // to multiply in on top of it. Doing both was a double-negative:
      // "-50" (already negative) times -1 (from the "negative" class)
      // produced +50, silently flipping every Falls row positive.
      pct: parseFloat(pctMatch[2]),
    });
  }
  return rows;
}

async function _fetchList(listNum, scale) {
  const res = await fetch(_URL(listNum, scale), { headers: _HEADERS, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  return _parseRows(html);
}

async function load(force = false, dataDir = null) {
  const cachePath = dataDir ? path.join(dataDir, 'top100.json') : _DEV_FALLBACK_CACHE_PATH;
  const cached = await storage.readJSON(cachePath, null);
  if (!force && cached && (Date.now() - (cached.fetchedAt || 0)) < CACHE_TTL) {
    return { byWindow: cached.byWindow };
  }

  const byWindow = {};
  try {
    for (const windowDays of Object.keys(SCALES)) {
      const scale = SCALES[windowDays];
      const [rises, falls] = await Promise.all([_fetchList(2, scale), _fetchList(3, scale)]);
      byWindow[windowDays] = { rises, falls };
    }
  } catch (e) {
    console.log(`[top100] Fetch failed: ${e.message}`);
    if (cached) return { byWindow: cached.byWindow };
    return { byWindow: {} };
  }

  const total = Object.values(byWindow).reduce((n, w) => n + w.rises.length + w.falls.length, 0);
  console.log(`[top100] ${total} rows fetched across ${Object.keys(byWindow).length} windows`);
  if (!total) {
    if (cached) return { byWindow: cached.byWindow };
    return { byWindow: {} };
  }

  // Cache-write failure (shouldn't happen now that this is a real writable
  // dataDir, but was exactly the bug when this pointed at the read-only
  // asar path) must NOT discard data that was already successfully
  // fetched — caught separately from the fetch itself, not left to bubble
  // up and make run.js's caller think the whole fetch failed.
  try {
    await storage.writeJSON(cachePath, { fetchedAt: Date.now(), byWindow }, { pretty: true });
  } catch (e) {
    console.log(`[top100] Cache write failed (data still returned this run): ${e.message}`);
  }
  return { byWindow };
}

module.exports = { load, SCALES };

if (require.main === module) {
  load(true).then(data => {
    for (const [win, {rises, falls}] of Object.entries(data.byWindow)) {
      console.log(`\n${win}d: ${rises.length} rises / ${falls.length} falls — top rise: ${rises[0]?.name} +${rises[0]?.pct}%`);
    }
  });
}
