/**
 * Fetches the 6 RS Wiki Grand Exchange market indexes:
 *   Common Trade Index, Rune Index, Log Index, Food Index, Metal Index, Herb Index
 * Source: https://runescape.wiki/w/RuneScape:Grand_Exchange_Market_Watch
 *
 * Faithful JS port of python/market_watch.py — part of the Python-to-JS
 * backend migration (see TODO.txt / SESSION_LOG.md, 2026-06-26). This is
 * the first module ported, picked specifically because it has no
 * dependencies on the other Python modules, to prove out the port-and-verify
 * methodology before tackling anything bigger/more central. Verify against
 * the Python original on real data before trusting this over it.
 */

const path = require('path');
const storage = require('./storage.js');

const _DIR = __dirname;
// Dev-only fallback — this repo-root data/ folder isn't part of the
// packaged app's "files" list at all (see package.json's build.files:
// only src/**, assets/**, node_modules/**), and app.asar is read-only at
// runtime regardless. Found for real (2026-08-11) while building top100.js
// against the same pattern: this meant load()'s writeJSON call below has
// been silently throwing in every packaged build, and since that call sat
// OUTSIDE the fetch's own try/catch, the whole function threw AFTER
// already successfully fetching real index data — discarding it and
// leaving `indexes` permanently empty in the shipped app. Real dataDir
// (same per-install writable directory everything else uses) now gets
// passed in from run.js; this const is only ever hit by direct/standalone
// testing.
const _DEV_FALLBACK_CACHE_PATH = path.join(_DIR, '..', '..', 'data', 'market_watch.json');
const CACHE_TTL = 3600 * 1000; // 1 hour, in ms (Python version uses seconds)

const _URL = 'https://runescape.wiki/w/RuneScape:Grand_Exchange_Market_Watch';
const _HEADERS = { 'User-Agent': 'GEnius-app/1.2 (RS3 GE tracker; contact: letterslive@gmail.com)' };

const _INDEX_NAMES = [
  'Common Trade Index',
  'Rune Index',
  'Log Index',
  'Food Index',
  'Metal Index',
  'Herb Index',
];

// Python's re.DOTALL -> JS 's' flag. re.IGNORECASE -> 'i' flag.
const _ROW_RE = /<tr[^>]*>(.*?)<\/tr>/gs;
const _NAME_RE = new RegExp('>(' + _INDEX_NAMES.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')</a>');
const _VALUE_RE = /<td>\s*([\d,]+\.[\d]+)\s*<\/td>/;
const _DIR_RE = /(Up|Down|Neutral)\.svg/i;
// Change: optional +/- prefix, allow +-0.00 style (treat +- as 0)
const _CHANGE_RE = /&#160;([+\-]?[+\-]?[\d,]+\.[\d]+)/;

function _parse(html) {
  const results = [];
  const seen = new Set();
  let rowMatch;
  // Reset lastIndex since _ROW_RE is a shared global-flag regex
  _ROW_RE.lastIndex = 0;
  while ((rowMatch = _ROW_RE.exec(html)) !== null) {
    const row = rowMatch[1];
    const nameMatch = row.match(_NAME_RE);
    if (!nameMatch) continue;
    const name = nameMatch[1];
    if (seen.has(name)) continue;
    seen.add(name);

    const valueMatch = row.match(_VALUE_RE);
    const dirMatch = row.match(_DIR_RE);
    const changeMatch = row.match(_CHANGE_RE);

    if (!valueMatch) continue;

    const value = parseFloat(valueMatch[1].replace(/,/g, ''));
    let direction = dirMatch ? dirMatch[1].toLowerCase() : 'neutral';

    let rawChange = changeMatch ? changeMatch[1] : '0';
    // Handle +-X.XX (wiki quirk for near-zero) — treat as 0
    if (rawChange.startsWith('+-') || rawChange.startsWith('-+')) {
      rawChange = rawChange.replace(/^[+\-]+/, '');
    }
    let change;
    const parsed = parseFloat(rawChange.replace(/,/g, ''));
    if (isNaN(parsed)) {
      change = 0.0;
    } else {
      change = parsed;
      if (changeMatch && changeMatch[1].startsWith('-') && !rawChange.startsWith('-')) {
        change = -change;
      }
    }

    // Re-derive direction from change if SVG wasn't found
    if (!dirMatch) {
      direction = change > 0 ? 'up' : change < 0 ? 'down' : 'neutral';
    }

    results.push({ name, value, change, direction });
  }

  const order = {};
  _INDEX_NAMES.forEach((n, i) => { order[n] = i; });
  results.sort((a, b) => (order[a.name] ?? 99) - (order[b.name] ?? 99));
  return results;
}

async function load(force = false, dataDir = null) {
  const cachePath = dataDir ? path.join(dataDir, 'market_watch.json') : _DEV_FALLBACK_CACHE_PATH;
  // Cache age is tracked via an embedded fetchedAt timestamp inside the
  // JSON itself rather than the file's OS-level mtime — Capacitor's
  // Filesystem plugin (the mobile storage backend) doesn't expose mtime
  // the same way Node's fs does, so this keeps the TTL check identical on
  // both platforms instead of needing a stat() primitive in storage.js
  // just for this one cache.
  const cached = await storage.readJSON(cachePath, null);
  if (!force && cached && (Date.now() - (cached.fetchedAt || 0)) < CACHE_TTL) {
    return cached.indexes;
  }

  let html;
  try {
    const res = await fetch(_URL, { headers: _HEADERS, signal: AbortSignal.timeout(15000) });
    html = await res.text();
  } catch (e) {
    console.log(`[market_watch] Fetch failed: ${e.message}`);
    if (cached) return cached.indexes;
    return [];
  }

  const indexes = _parse(html);
  console.log(`[market_watch] ${indexes.length} indexes fetched`);

  if (!indexes.length) {
    if (cached) return cached.indexes;
    return [];
  }

  // Cache-write failure must not discard data already successfully
  // fetched — this used to sit unguarded and throw the whole function on
  // the read-only asar path, silently keeping `indexes` empty forever in
  // every packaged build (see _DEV_FALLBACK_CACHE_PATH's comment above).
  try {
    await storage.writeJSON(cachePath, { fetchedAt: Date.now(), indexes }, { pretty: true });
  } catch (e) {
    console.log(`[market_watch] Cache write failed (data still returned this run): ${e.message}`);
  }
  return indexes;
}

module.exports = { load };

if (require.main === module) {
  load(true).then(data => {
    console.log(`\n${data.length} indexes:\n`);
    for (const idx of data) {
      const arrow = idx.direction === 'up' ? '^' : idx.direction === 'down' ? 'v' : '=';
      const sign = idx.change >= 0 ? '+' : '';
      console.log(`  ${idx.name.padEnd(25)}  ${idx.value.toFixed(2).padStart(10)}  ${arrow} ${sign}${idx.change.toFixed(2)}`);
    }
  });
}
