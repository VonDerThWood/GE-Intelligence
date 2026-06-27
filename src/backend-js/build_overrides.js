/**
 * build_overrides.js — Generate category_overrides.json from RS Wiki data.
 *
 * Queries the RS Wiki API in batches to get page categories for every item
 * in latest.json, maps those to GEnius categories, and writes
 * category_overrides.json. Existing hand-written overrides are preserved
 * and take priority over wiki results.
 *
 * Usage:
 *   node build_overrides.js
 *   node build_overrides.js --data-dir="C:/Users/lette/AppData/Roaming/GEnius/data"
 *   node build_overrides.js --dry-run        (print without writing)
 *   node build_overrides.js --limit=100      (test on first 100 items only)
 *
 * Faithful JS port of python/build_overrides.py (Python-to-JS backend
 * migration, see TODO.txt / SESSION_LOG.md, 2026-06-26). This is the
 * seventh and final module — a dev-only maintenance tool, not part of the
 * app's runtime pipeline (run.py/run.js never imports it), so lower
 * priority than the other six, but ported for completeness since there
 * was no reason to leave it unfinished.
 */

const fs = require('fs');
const path = require('path');

const SCRIPT_DIR = __dirname;
const OVERRIDES_FILE = path.join(SCRIPT_DIR, 'data', 'category_overrides.json');
const WIKI_API = 'https://runescape.wiki/api.php';
const HEADERS = { 'User-Agent': 'GEnius/1.0 (github.com/VonDerThWood/GE-Intelligence; category builder)' };
const BATCH_SIZE = 50;
const DELAY = 600; // ms between batches — well within wiki rate limits

// ── Meta-category keywords to discard ────────────────────────────────────────
const SKIP_CAT_KEYWORDS = [
  'stub', 'incomplete', 'disambiguation', 'maintenance',
  'pages ', 'articles ', 'template', 'candidates',
  'redirects', 'deprecated', 'historical', 'obsolete',
  'infobox', 'navbox', 'hatnote', 'dynamicpagelist',
  'wikify', 'cleanup', 'references',
];

// ── Wiki category → GEnius category ──────────────────────────────────────────
const WIKI_TO_GENIUS = {
  // ── Rares ──
  'discontinued items': 'rares',
  'holiday items': 'rares',
  // ── Treasure Trails ──
  'treasure trails rewards': 'treasure_trails',
  'clue scroll rewards': 'treasure_trails',
  'treasure trails': 'treasure_trails',
  // ── Boss ──
  'boss drops': 'boss',
  'boss drop': 'boss',
  'superior dragon': 'boss',
  // ── Prayer ──
  'bones': 'prayer',
  'ashes': 'prayer',
  'ensouled heads': 'prayer',
  // ── Archaeology ──
  'artefacts': 'archaeology',
  'archaeology materials': 'archaeology',
  'excavation hotspot materials': 'archaeology',
  'chronotes': 'archaeology',
  'tetracompass': 'archaeology',
  // ── Codex ──
  'ability codices': 'codex',
  'ability codex': 'codex',
  'ability books': 'codex',
  // ── Cosmetics (renamed from Overrides/Titles) ──
  'cosmetic overrides': 'cosmetics',
  'title scrolls': 'cosmetics',
  'override tokens': 'cosmetics',
  'loyalty programme rewards': 'cosmetics',
  "solomon's general store": 'cosmetics',
  'dyes': 'cosmetics',
  // ── Runes ──
  'runes': 'runes',
  'combination runes': 'runes',
  'rune essence': 'runes',
  'necrotic runes': 'runes',
  // ── Summoning ──
  'summoning pouches': 'summoning',
  'summoning scrolls': 'summoning',
  'charms': 'summoning',
  'summoning ingredients': 'summoning',
  'familiars': 'summoning',
  // ── Hybrid ──
  'hybrid armour': 'hybrid',
  'hybrid equipment': 'hybrid',
  'hybrid weapons': 'hybrid',
  // ── Necromancy (before melee/magic/ranged) ──
  'necromancy equipment': 'necromancy',
  'necromancy armour': 'necromancy',
  'necromancy weapons': 'necromancy',
  'necromancy off-hand weapons': 'necromancy',
  'death guard': 'necromancy',
  'deathwarden': 'necromancy',
  'deathdealer': 'necromancy',
  // ── Magic ──
  'magic armour': 'magic',
  'magic weapons': 'magic',
  'magic equipment': 'magic',
  'magic off-hand weapons': 'magic',
  'staves': 'magic',
  'wands': 'magic',
  'magical staves': 'magic',
  'magic shields': 'magic',
  'orbs': 'magic',
  'books (magic)': 'magic',
  // ── Melee ──
  'melee armour': 'melee',
  'melee weapons': 'melee',
  'melee equipment': 'melee',
  'melee off-hand weapons': 'melee',
  'melee shields': 'melee',
  'swords': 'melee',
  'longswords': 'melee',
  'scimitars': 'melee',
  'daggers': 'melee',
  'maces': 'melee',
  'battleaxes': 'melee',
  'warhammers': 'melee',
  'halberds': 'melee',
  'spears': 'melee',
  'two-handed swords': 'melee',
  'claws': 'melee',
  'platebodies': 'melee',
  'platelegs': 'melee',
  'plateskirts': 'melee',
  'full helms': 'melee',
  'chainbodies': 'melee',
  'kiteshields': 'melee',
  'square shields': 'melee',
  // ── Ranged ──
  'ranged armour': 'ranged',
  'ranged weapons': 'ranged',
  'ranged equipment': 'ranged',
  'ranged off-hand weapons': 'ranged',
  'ranged shields': 'ranged',
  'bows': 'ranged',
  'crossbows': 'ranged',
  'throwing weapons': 'ranged',
  'throwing knives': 'ranged',
  'death lotus': 'ranged',
  // ── Ammo ──
  'ammunition': 'ammo',
  'arrows': 'ammo',
  'bolts': 'ammo',
  'darts': 'ammo',
  'javelins': 'ammo',
  'chinchompas': 'ammo',
  'cannonballs': 'ammo',
  // ── Pocket ──
  'pocket slot items': 'pocket',
  'scrimshaws': 'pocket',
  'signs of the porter': 'pocket',
  'portents': 'pocket',
  'god books': 'pocket',
  'illuminated god books': 'pocket',
  'brooch': 'pocket',
  // ── Herblore ──
  'potions': 'herblore',
  'herbs': 'herblore',
  'herblore secondary ingredients': 'herblore',
  'herblore ingredients': 'herblore',
  'vials': 'herblore',
  'flasks': 'herblore',
  'powerburst potions': 'herblore',
  // ── Artisan (Smithing + Crafting merged) ──
  'metal ores': 'artisan',
  'metal bars': 'artisan',
  'ores': 'artisan',
  'bars': 'artisan',
  'uncut gems': 'artisan',
  'gems': 'artisan',
  'hides': 'artisan',
  'leathers': 'artisan',
  'jewellery': 'artisan',
  'amulets': 'artisan',
  'rings': 'artisan',
  'necklaces': 'artisan',
  'bracelets': 'artisan',
  'tiaras': 'artisan',
  'fletching': 'artisan',
  'bows (ustrung)': 'artisan',
  'crossbow stocks': 'artisan',
  'crossbow limbs': 'artisan',
  // ── Food ──
  'food': 'food',
  'fish': 'food',
  'raw fish': 'food',
  'pies': 'food',
  'cakes': 'food',
  'pizzas': 'food',
  'jellyfish': 'food',
  // ── Farming ──
  'allotment seeds': 'farming',
  'herb seeds': 'farming',
  'tree seeds': 'farming',
  'fruit tree seeds': 'farming',
  'flower seeds': 'farming',
  'bush seeds': 'farming',
  'seeds': 'farming',
  'saplings': 'farming',
  'compost': 'farming',
  // ── Mining / Woodcutting ──
  'logs': 'mining',
  'woodcutting': 'mining',
  'mining': 'mining',
};

// GEnius category priority — when wiki gives multiple matches, pick highest priority.
const CATEGORY_PRIORITY = [
  'rares', 'treasure_trails', 'boss',
  'prayer', 'archaeology', 'cosmetics', 'codex',
  'runes', 'summoning',
  'necromancy', 'hybrid', 'melee', 'magic', 'ranged', 'ammo', 'pocket',
  'herblore', 'artisan',
  'food', 'farming', 'mining',
  'low_tier', 'materials',
];

const EXCLUSIVE_CATEGORIES = new Set(['rares', 'treasure_trails', 'cosmetics', 'codex']);

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { dataDir: null, dryRun: false, limit: 0 };
  for (const arg of argv) {
    if (arg.startsWith('--data-dir=')) args.dataDir = arg.slice('--data-dir='.length);
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg.startsWith('--limit=')) args.limit = parseInt(arg.slice('--limit='.length), 10) || 0;
  }
  return args;
}

function findLatestJson(dataDirOverride) {
  if (dataDirOverride) {
    const p = path.join(dataDirOverride, 'latest.json');
    if (fs.existsSync(p)) return p;
    throw new Error(`latest.json not found in ${dataDirOverride}`);
  }
  const candidates = [
    path.join(process.env.APPDATA || '', 'GEnius', 'data', 'latest.json'),
    path.join(SCRIPT_DIR, '..', '..', 'data', 'latest.json'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(
    'Could not find latest.json.\n' +
    'Run the app once to populate it, then pass --data-dir pointing to your GEnius data folder.'
  );
}

function wikiNameCandidates(itemName) {
  // Return a list of wiki page name candidates to try for an item.
  const names = [itemName];
  // Strip dose number: "Super attack (4)" -> "Super attack"
  const stripped = itemName.replace(/\s*\(\d+\)\s*$/, '').trim();
  if (stripped && stripped !== itemName) names.push(stripped);
  // Strip single lowercase letter suffix: "Rune sword (g)" -> "Rune sword"
  const stripped2 = itemName.replace(/\s*\([a-z]\)\s*$/, '').trim();
  if (stripped2 && stripped2 !== itemName && !names.includes(stripped2)) names.push(stripped2);
  return names;
}

function isMetaCategory(catName) {
  const catLower = catName.toLowerCase();
  return SKIP_CAT_KEYWORDS.some(kw => catLower.includes(kw));
}

async function fetchCategoriesBatch(titles) {
  // Query RS Wiki for page categories for a list of titles (max 50).
  // Returns: { lowercase_page_title: [category_name, ...] }. Follows redirects automatically.
  const params = new URLSearchParams({
    action: 'query',
    titles: titles.join('|'),
    prop: 'categories',
    cllimit: '100',
    redirects: '1',
    format: 'json',
    formatversion: '2',
  });
  let data;
  try {
    const res = await fetch(`${WIKI_API}?${params.toString()}`, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (e) {
    console.log(`\n  [wiki] Request error: ${e.message}`);
    return {};
  }

  const result = {};
  const pages = data?.query?.pages || [];
  // Build redirect map: original title -> resolved title
  const redirects = {};
  for (const rd of data?.query?.redirects || []) {
    redirects[rd.from.toLowerCase()] = rd.to.toLowerCase();
  }

  for (const page of pages) {
    if (page.missing) continue;
    const pageTitle = (page.title || '').toLowerCase();
    const rawCats = page.categories || [];
    const cats = rawCats
      .map(c => c.title.replace('Category:', '').trim())
      .filter(c => !isMetaCategory(c));
    if (cats.length) {
      result[pageTitle] = cats;
      // Also index under the original (pre-redirect) title if applicable
      for (const [orig, resolved] of Object.entries(redirects)) {
        if (resolved === pageTitle) result[orig] = cats;
      }
    }
  }

  return result;
}

function mapWikiCategories(wikiCats) {
  // Map RS Wiki category names to GEnius categories. Exclusive categories
  // (TT, Rares, Boss, etc.) return alone — no combat tags added.
  const matched = new Set();
  for (const cat of wikiCats) {
    const catLower = cat.toLowerCase();
    for (const [wikiKey, geniusCat] of Object.entries(WIKI_TO_GENIUS)) {
      if (catLower.includes(wikiKey) || catLower === wikiKey) matched.add(geniusCat);
    }
  }
  const ordered = CATEGORY_PRIORITY.filter(c => matched.has(c));
  if (ordered.length && EXCLUSIVE_CATEGORIES.has(ordered[0])) return [ordered[0]];
  return ordered;
}

// ── Main build logic ──────────────────────────────────────────────────────────

// Name prefixes that reliably indicate low-tier (T1-T69) combat gear.
const LOW_TIER_NAME_PREFIXES = [
  'bronze ', 'iron ', 'steel ', 'black ', 'white ',
  'leather ', 'hardleather', 'studded ', 'mithril ', 'batwing ',
  'ghostly ', 'snakeskin ', 'splitbark ', 'mystic ', 'adamant ',
  'lunar ', 'carapace ', "green d'hide", "blue d'hide", 'rune ',
  "red d'hide", 'granite ', 'dragon ', 'corrupt ', 'ricochet ',
  'green dragonhide ', 'blue dragonhide ', 'red dragonhide ',
];

function isLowTierByName(nameLower) {
  return LOW_TIER_NAME_PREFIXES.some(p => nameLower.startsWith(p));
}

const COMBAT_CATS = new Set(['melee', 'magic', 'ranged', 'necromancy', 'ammo', 'pocket']);

function _sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function buildOverrides(items, limit = 0) {
  if (limit) {
    items = items.slice(0, limit);
    console.log(`[build] Limiting to first ${limit} items (test mode)`);
  }

  // Deduplicate names
  const seen = new Set();
  const unique = [];
  for (const it of items) {
    const name = (it.name || '').trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      unique.push(it);
    }
  }

  const total = unique.length;
  console.log(`[build] ${total} unique items to process across ${Math.ceil(total / BATCH_SIZE)} batches\n`);

  const overrides = {};   // name_lower -> [genius_cats]
  const unmatched = [];   // [name, wiki_cats] — on wiki but no category mapping
  const notOnWiki = [];   // name — page not found at all

  const batches = [];
  for (let i = 0; i < total; i += BATCH_SIZE) batches.push(unique.slice(i, i + BATCH_SIZE));

  for (let idx = 0; idx < batches.length; idx++) {
    const batch = batches[idx];
    // Collect all candidate titles for this batch
    const titleToName = {}; // lowercase wiki title -> original item name
    const allTitles = [];
    for (const it of batch) {
      for (const candidate of wikiNameCandidates(it.name)) {
        const lc = candidate.toLowerCase();
        if (!(lc in titleToName)) {
          titleToName[lc] = it.name;
          allTitles.push(candidate);
        }
      }
    }

    const wikiResults = await fetchCategoriesBatch(allTitles.slice(0, 50)); // API max is 50

    let matchedCount = 0;
    for (const it of batch) {
      const name = it.name;
      const candidates = wikiNameCandidates(name).map(c => c.toLowerCase());

      let wikiCats = null;
      for (const candidate of candidates) {
        if (candidate in wikiResults) { wikiCats = wikiResults[candidate]; break; }
      }

      if (wikiCats === null) {
        notOnWiki.push(name);
        continue;
      }

      const geniusCats = mapWikiCategories(wikiCats);
      if (geniusCats.length) {
        overrides[name.toLowerCase()] = geniusCats;
        matchedCount += 1;
      } else {
        unmatched.push([name, wikiCats]);
      }
    }

    const pct = Math.round((idx + 1) / batches.length * 100);
    console.log(`  [${String(pct).padStart(3)}%] Batch ${idx + 1}/${batches.length} — ${matchedCount}/${batch.length} categorized  (total so far: ${Object.keys(overrides).length})`);

    if (idx < batches.length - 1) await _sleep(DELAY);
  }

  // Tag low-tier combat items using name-prefix inference.
  let lowTierCount = 0;
  for (const [nameLower, cats] of Object.entries(overrides)) {
    if (cats.some(c => COMBAT_CATS.has(c)) && !cats.includes('low_tier') && isLowTierByName(nameLower)) {
      overrides[nameLower] = [...cats, 'low_tier'];
      lowTierCount += 1;
    }
  }
  console.log(`[tiers] Tagged ${lowTierCount} items as low_tier (name-prefix inference)`);

  return [overrides, unmatched, notOnWiki];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log('='.repeat(60));
  console.log('  GEnius Category Override Builder');
  console.log('  Querying RS Wiki — this takes ~2-3 minutes');
  console.log('='.repeat(60) + '\n');

  const latestPath = findLatestJson(args.dataDir);
  const data = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
  const items = data.items || [];
  console.log(`[build] ${items.length} items loaded from ${latestPath}`);

  // Load existing hand-written overrides — these take priority
  let existing = {};
  if (fs.existsSync(OVERRIDES_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(OVERRIDES_FILE, 'utf8'));
      existing = Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith('_')));
      console.log(`[build] ${Object.keys(existing).length} existing hand-written overrides loaded (will be preserved)\n`);
    } catch (e) {
      console.log(`[build] Warning: could not load existing overrides: ${e.message}\n`);
    }
  }

  const [wikiOverrides, unmatched, notOnWiki] = await buildOverrides(items, args.limit);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Wiki-categorized:         ${String(Object.keys(wikiOverrides).length).padStart(5)} items`);
  console.log(`  On wiki, no cat match:    ${String(unmatched.length).padStart(5)} items`);
  console.log(`  Not found on wiki:        ${String(notOnWiki.length).padStart(5)} items`);

  // Merge: wiki results first, then existing hand-written overrides overwrite
  const merged = { ...wikiOverrides, ...existing };

  // Apply low_tier tagging to the final merged dict so hand-written entries also get tagged
  let lowTierCount = 0;
  for (const [nameLower, cats] of Object.entries(merged)) {
    if (Array.isArray(cats) && cats.some(c => COMBAT_CATS.has(c)) && !cats.includes('low_tier') && isLowTierByName(nameLower)) {
      merged[nameLower] = [...cats, 'low_tier'];
      lowTierCount += 1;
    }
  }
  console.log(`  Low-tier tagged:          ${String(lowTierCount).padStart(5)} items (name-prefix inference)`);

  merged._note = 'Auto-generated from RS Wiki. Hand-written entries take priority over wiki results.';
  merged._generated_items = Object.keys(wikiOverrides).length;

  console.log(`  Final override count:     ${String(Object.keys(merged).length - 2).padStart(5)} items`);
  console.log('='.repeat(60));

  if (args.dryRun) {
    console.log('\n[dry-run] First 30 wiki-derived entries:');
    for (const [k, v] of Object.entries(wikiOverrides).slice(0, 30)) {
      console.log(`  ${k.padEnd(50)} -> [${v.join(', ')}]`);
    }
    console.log('\n[dry-run] File not written.');
  } else {
    fs.writeFileSync(OVERRIDES_FILE, JSON.stringify(merged, null, 2), 'utf8');
    console.log(`\n[build] Written -> ${OVERRIDES_FILE}`);
    console.log('[build] Rebuild the app (npm run build) to apply changes.');
  }

  // Show unmatched items so we can expand the mapping table over time
  if (unmatched.length) {
    console.log('\n[build] Items on wiki but no GEnius category match (showing first 40):');
    console.log('        These are falling through to Materials — add them to WIKI_TO_GENIUS if needed.\n');
    for (const [name, cats] of unmatched.slice(0, 40)) {
      console.log(`  ${name.padEnd(50)}  wiki: [${cats.slice(0, 4).join(', ')}]`);
    }
    if (unmatched.length > 40) console.log(`  ... and ${unmatched.length - 40} more`);
  }

  console.log('\n[build] Complete.');
}

module.exports = {
  wikiNameCandidates, isMetaCategory, fetchCategoriesBatch, mapWikiCategories,
  isLowTierByName, buildOverrides, main,
};

if (require.main === module) {
  main();
}
