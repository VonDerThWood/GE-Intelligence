/**
 * Fetches untradeable item prices from two RS Wiki sources:
 *   1. RS:Material_prices  — Invention components
 *   2. Combination_potions — untradeable combination potions
 *
 * Faithful JS port of python/untradeable.py (Python-to-JS backend
 * migration, see TODO.txt / SESSION_LOG.md, 2026-06-26). Verify against
 * the Python original on real data before trusting this over it.
 */

const fs = require('fs');
const path = require('path');

const _DIR = __dirname;
const CACHE_PATH = path.join(_DIR, '..', '..', 'data', 'untradeable.json');
const CACHE_TTL = 86400 * 1000; // 24 hours, in ms

const _HEADERS = { 'User-Agent': 'GEnius-app/1.2 (RS3 GE tracker; contact: letterslive@gmail.com)' };

// ── Components ──────────────────────────────────────────────────────────────

const _COMP_URL = 'https://runescape.wiki/w/RS:Material_prices';

const _COMP_ROW_RE = new RegExp(
  '<tr\\s+id="[^"]+">.*?' +
  '<td[^>]*>.*?' +
  '<a href="/w/[^"]*" title="([^"]+)">[^<]+</a>' +   // name
  '\\s*\\n\\s*</td>\\s*\\n' +
  '<td[^>]*>([^<\\n]+)\\n</td>\\s*\\n' +              // rarity
  '<td[^>]*><span class="coins[^"]*">([0-9,]+)</span></td>', // price
  'gs'
);

function _fetchComponents(html) {
  const results = [];
  const seen = new Set();
  let m;
  _COMP_ROW_RE.lastIndex = 0;
  while ((m = _COMP_ROW_RE.exec(html)) !== null) {
    const name = m[1].trim();
    const rarity = m[2].trim().toLowerCase();
    const price = parseInt(m[3].replace(/,/g, ''), 10);
    if (!seen.has(name)) {
      seen.add(name);
      results.push({ name, price, rarity, categories: ['invention'] });
    }
  }
  return results;
}

// ── Combination potions ──────────────────────────────────────────────────────

const _POTION_URL = 'https://runescape.wiki/w/Combination_potions';

// Each row: plinkt-link name, then last coins span = calculated cost
// X_mark.svg in row = untradeable
const _POTION_ROW_RE = new RegExp(
  '<tr>\\s*\\n<td class="plinkt-image">.*?' +
  '<td class="plinkt-link"><a href="/w/[^"]*" title="([^"]+)">[^<]+</a>',
  's'
);
const _COINS_RE = /<span class="coins[^"]*">([0-9,]+(?:\.[0-9]+)?)<\/span>/g;
const _UNTRADE_RE = /X_mark\.svg/;

const _POTION_EXTRA_CATS = {
  'elder overload potion': ['herblore', 'supplies'],
  'elder overload salve': ['herblore', 'supplies'],
  'aggroverload': ['herblore', 'supplies'],
  'holy aggroverload': ['herblore', 'supplies'],
  'overload salve': ['herblore', 'supplies'],
  'supreme overload potion': ['herblore', 'supplies'],
  'supreme overload salve': ['herblore', 'supplies'],
  'replenishment potion': ['herblore', 'supplies'],
  'enhanced replenishment potion': ['herblore', 'supplies'],
};

function _fetchPotions(html) {
  const results = [];
  const seen = new Set();
  // Split into rows — same zero-width-lookahead split as Python's re.split
  const rows = html.split(/(?=<tr>\s*\n<td class="plinkt-image">)/);
  for (const row of rows) {
    const nameMatch = row.match(_POTION_ROW_RE);
    if (!nameMatch) continue;
    const name = nameMatch[1].trim().replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    if (seen.has(name)) continue;
    // Must have the untradeable X mark
    if (!_UNTRADE_RE.test(row)) continue;
    // Last coins span = calculated production cost
    const coins = [...row.matchAll(_COINS_RE)].map(c => c[1]);
    if (!coins.length) continue;
    const price = parseInt(parseFloat(coins[coins.length - 1].replace(/,/g, '')), 10);
    if (isNaN(price)) continue;
    seen.add(name);
    const cats = _POTION_EXTRA_CATS[name.toLowerCase()] || ['herblore'];
    results.push({ name, price, rarity: null, categories: cats });
  }
  return results;
}

// ── One-off untradeable items ────────────────────────────────────────────────
// Each entry: [name, wiki_slug, categories, cost_label]
// cost_label: 'calcvalue' or 'Total cost' — which infobox row to read

const _MISC_ITEMS = [
  ['Blessed flask', 'Blessed_flask', ['supplies'], 'calcvalue'],
  ['Extreme prayer potion (3)', 'Extreme_prayer_potion', ['herblore', 'supplies'], 'Total cost'],
];

const _CALCVALUE_RE = /data-attr-param="calcvalue"[^>]*>([0-9,]+)/;
const _TOTALCOST_RE = /Total cost.*?>([0-9,]+(?:\.[0-9]+)?)<\/td>/s;
const _COINS_SPAN_RE = /<span class="coins[^"]*">([0-9,]+)<\/span>/;

async function _fetchMiscItems() {
  const results = [];
  for (const [name, slug, cats, label] of _MISC_ITEMS) {
    try {
      const html = await _fetch(`https://runescape.wiki/w/${slug}`);
      let raw = null;
      if (label === 'calcvalue') {
        const m = html.match(_CALCVALUE_RE);
        if (m) raw = m[1];
      } else {
        const m = html.match(_TOTALCOST_RE);
        if (m) {
          const block = m[0];
          const cs = block.match(_COINS_SPAN_RE);
          raw = cs ? cs[1] : m[1];
        }
      }
      if (raw) {
        const price = parseInt(parseFloat(raw.replace(/,/g, '')), 10);
        results.push({ name, price, rarity: null, categories: cats });
        console.log(`[untradeable] ${name}: ${price.toLocaleString()}gp`);
      } else {
        console.log(`[untradeable] ${name}: cost not found`);
      }
    } catch (e) {
      console.log(`[untradeable] ${name} fetch failed: ${e.message}`);
    }
  }
  return results;
}

// ── Shared ────────────────────────────────────────────────────────────────────

async function _fetch(url) {
  const res = await fetch(url, { headers: _HEADERS, signal: AbortSignal.timeout(15000) });
  return res.text();
}

function _toItem(entry, natureRunePrice = 0) {
  const item = {
    id: `untradeable_${entry.name.toLowerCase().replace(/ /g, '_')}`,
    name: entry.name,
    categories: entry.categories,
    high: entry.price,
    low: entry.price,
    alch: null,
    limit: null,
    volume: null,
    avgVolume: null,
    change_1d: null,
    members: true,
    untradeable: true,
    natureRunePrice: natureRunePrice,
    signals: [],
  };
  if (entry.rarity) item.rarity = entry.rarity;
  return item;
}

function _readCache() {
  return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
}

async function load(natureRunePrice = 0, force = false) {
  const cacheFile = path.resolve(CACHE_PATH);
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });

  if (!force && fs.existsSync(cacheFile)) {
    const ageMs = Date.now() - fs.statSync(cacheFile).mtimeMs;
    if (ageMs < CACHE_TTL) {
      try { return _readCache(); } catch {}
    }
  }

  let allEntries = [];
  try {
    const comps = _fetchComponents(await _fetch(_COMP_URL));
    allEntries = allEntries.concat(comps);
    console.log(`[untradeable] ${allEntries.length} components fetched`);
  } catch (e) {
    console.log(`[untradeable] Components fetch failed: ${e.message}`);
  }

  try {
    const potions = _fetchPotions(await _fetch(_POTION_URL));
    console.log(`[untradeable] ${potions.length} untradeable potions fetched`);
    allEntries = allEntries.concat(potions);
  } catch (e) {
    console.log(`[untradeable] Potions fetch failed: ${e.message}`);
  }

  allEntries = allEntries.concat(await _fetchMiscItems());

  if (!allEntries.length) {
    if (fs.existsSync(cacheFile)) return _readCache();
    return [];
  }

  const items = allEntries.map(e => _toItem(e, natureRunePrice));
  fs.writeFileSync(cacheFile, JSON.stringify(items, null, 2), 'utf8');
  return items;
}

module.exports = { load };

if (require.main === module) {
  load(0, true).then(items => {
    const comps = items.filter(i => i.categories.includes('invention'));
    const potions = items.filter(i => i.categories.includes('herblore'));
    console.log(`\n${comps.length} components, ${potions.length} potions — ${items.length} total\n`);
    console.log('── Potions ──');
    for (const it of potions) {
      console.log(`  ${it.name.padEnd(45)}  ${it.high.toLocaleString().padStart(12)}gp`);
    }
    console.log('\n── Components (first 10) ──');
    for (const it of comps.slice(0, 10)) {
      console.log(`  ${(it.rarity || '').padEnd(10)}  ${it.name.padEnd(40)}  ${it.high.toLocaleString().padStart(12)}gp`);
    }
  });
}
