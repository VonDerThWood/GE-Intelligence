/**
 * Resolves real item icon URLs via the RuneScape Wiki's own MediaWiki API,
 * replacing the old approach (renderer.js building a GUESSED URL by
 * title-casing just an item's first word, e.g. "Kal'gerion demon scroll" ->
 * "Kal'gerion_demon_scroll.png") — that guess only worked when an item's
 * exact display name happened to match the wiki's real image filename
 * character-for-character, which silently broke for apostrophes,
 * parenthetical variants ("(no rune)"), and any item whose wiki page
 * capitalizes more than just the first word. Ben, 2026-08-13: "If the API
 * would pull the pictures then that's 100% what we should have done from
 * the start."
 *
 * Two DIFFERENT images per item are resolved and cached separately (Ben,
 * 2026-08-13, caught via a screenshot): the wiki's "page image"
 * (prop=pageimages) is the big DETAIL render used for a page's zoomed-in
 * store display — it can look wildly different from what the item
 * actually looks like in-game inventory (drop shadows, different angle,
 * bigger scale). The small inventory-sprite icon is a SEPARATE file,
 * conventionally at File:<canonical title>.png with no "_detail" suffix,
 * once the canonical title is known. So: `icon` is the small sprite (used
 * everywhere inline — table rows, the detail panel's small icon), `detail`
 * is the big render (used only for the "click to enlarge" modal).
 *
 * Results are cached forever (icon urls essentially never change) in
 * icon_cache.json — {name_lower: {icon, detail, resolvedAt}} — with a
 * long retry window on misses (a null result gets retried after 30 days,
 * in case it was a transient API hiccup rather than a genuinely
 * image-less page). Resolution is capped per call (RESOLVE_PER_RUN) so a
 * fresh install backfills its ~7,400 items over several 15-min fetch
 * cycles instead of one multi-minute blocking call on the first run.
 */

const path = require('path');
const storage = require('./storage.js');

const _DIR = __dirname;
const _DEV_FALLBACK_CACHE_PATH = path.join(_DIR, '..', '..', 'data', 'icon_cache.json');
const RETRY_MISS_AFTER = 30 * 24 * 3600 * 1000; // 30 days
const BATCH_SIZE = 50; // MediaWiki's own per-request title cap for anonymous callers
const BATCH_DELAY_MS = 350; // polite pacing between requests
const RESOLVE_PER_RUN = 500; // ~10 batches/run — backfills 7,400 items over ~15 fetch cycles, non-blocking
const FALLBACK_PER_RUN = 60; // search fallback is 1 request/name (no batching) — capped separately, much slower per-item

const _HEADERS = { 'User-Agent': 'GEnius-app/2.6 (RS3 GE tracker; contact: letterslive@gmail.com)' };
const _API = 'https://runescape.wiki/api.php';

// Resolves the canonical page title + big detail render for a batch of
// requested names, via the exact-title lookup (fast, handles most items).
async function _fetchDetailBatch(names) {
  const url = `${_API}?action=query&format=json&prop=pageimages&piprop=thumbnail&pithumbsize=300&redirects=1&titles=${encodeURIComponent(names.join('|'))}`;
  const res = await fetch(url, { headers: _HEADERS, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  // MediaWiki reports normalization/redirect chains separately from the
  // actual page data — a name we sent might not equal the "title" the
  // returned page is keyed under (case differences, redirects). Both maps
  // chain back to the ORIGINAL requested string so results can be matched
  // back to the item names we started with.
  const canonicalOf = {}; // requested name (lower) -> final page title
  for (const n of names) canonicalOf[n.toLowerCase()] = n;
  for (const norm of (data.query?.normalized || [])) {
    const from = norm.from.toLowerCase();
    if (canonicalOf[from]) canonicalOf[from] = norm.to;
  }
  for (const redir of (data.query?.redirects || [])) {
    for (const [k, v] of Object.entries(canonicalOf)) {
      if (v === redir.from) canonicalOf[k] = redir.to;
    }
  }

  const pageByTitle = {};
  for (const page of Object.values(data.query?.pages || {})) {
    pageByTitle[page.title] = page;
  }

  const results = {};
  for (const n of names) {
    const canonical = canonicalOf[n.toLowerCase()] || n;
    const page = pageByTitle[canonical];
    // A nonexistent page still comes back as a real object — {title, missing:""}
    // — so page.missing === undefined is the actual "does this page exist" check.
    const found = page && page.missing === undefined;
    results[n.toLowerCase()] = { canonicalTitle: found ? canonical : null, detail: found ? (page.thumbnail?.source || null) : null };
  }
  return results;
}

// Fallback for names the exact-title batch lookup missed — usually a
// capitalization mismatch (GEnius's "Kal'gerion demon scroll" vs. the
// wiki's real "Kal'gerion Demon scroll" article), not a genuinely missing
// page. generator=search resolves the best-matching page by full-text
// search instead of requiring an exact title, at the cost of one request
// per name (no batching multiple titles into a single search query).
async function _searchOneDetail(name) {
  const url = `${_API}?action=query&format=json&generator=search&gsrsearch=${encodeURIComponent(name)}&gsrlimit=1&gsrnamespace=0&prop=pageimages&piprop=thumbnail&pithumbsize=300`;
  const res = await fetch(url, { headers: _HEADERS, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const page = Object.values(data.query?.pages || {})[0];
  return page ? { canonicalTitle: page.title, detail: page.thumbnail?.source || null } : { canonicalTitle: null, detail: null };
}

// Given known canonical page titles, resolves the small inventory-icon
// file at File:<title>.png — the conventional filename once the title
// itself is no longer a guess. Batched the same way as the detail lookup.
async function _fetchIconBatch(canonicalTitles) {
  const fileTitles = canonicalTitles.map(t => `File:${t}.png`);
  const url = `${_API}?action=query&format=json&prop=imageinfo&iiprop=url&titles=${encodeURIComponent(fileTitles.join('|'))}`;
  const res = await fetch(url, { headers: _HEADERS, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const urlByFileTitle = {};
  for (const page of Object.values(data.query?.pages || {})) {
    if (page.imageinfo?.[0]?.url) urlByFileTitle[page.title] = page.imageinfo[0].url;
  }
  const results = {};
  for (const t of canonicalTitles) results[t] = urlByFileTitle[`File:${t}.png`] || null;
  return results;
}

async function resolveIcons(itemNames, dataDir) {
  const cachePath = dataDir ? path.join(dataDir, 'icon_cache.json') : _DEV_FALLBACK_CACHE_PATH;
  const cache = await storage.readJSON(cachePath, {});
  const now = Date.now();

  const uniqueNames = [...new Set(itemNames.filter(Boolean))];
  const needsResolve = uniqueNames.filter(n => {
    const entry = cache[n.toLowerCase()];
    if (!entry) return true;
    return entry.icon == null && entry.detail == null && (now - (entry.resolvedAt || 0)) > RETRY_MISS_AFTER;
  }).slice(0, RESOLVE_PER_RUN);

  if (needsResolve.length) {
    const canonicalByName = {}; // nameLower -> canonicalTitle, for the icon-batch pass below
    let resolvedCount = 0;
    for (let i = 0; i < needsResolve.length; i += BATCH_SIZE) {
      const batch = needsResolve.slice(i, i + BATCH_SIZE);
      try {
        const results = await _fetchDetailBatch(batch);
        for (const [nameLower, r] of Object.entries(results)) {
          cache[nameLower] = { icon: null, detail: r.detail, resolvedAt: now };
          if (r.canonicalTitle) canonicalByName[nameLower] = r.canonicalTitle;
        }
        resolvedCount += batch.length;
      } catch (e) {
        console.log(`[icons] Detail batch failed (${batch.length} names): ${e.message}`);
      }
      if (i + BATCH_SIZE < needsResolve.length) {
        await new Promise(res => setTimeout(res, BATCH_DELAY_MS));
      }
    }

    // Second pass: exact-title misses are usually a capitalization
    // mismatch, not a genuinely image-less page — retry a capped number
    // of them through the slower single-request search API before
    // accepting the miss as real.
    const stillMissing = needsResolve.filter(n => !canonicalByName[n.toLowerCase()]).slice(0, FALLBACK_PER_RUN);
    let fallbackFound = 0;
    for (const n of stillMissing) {
      try {
        const r = await _searchOneDetail(n);
        if (r.canonicalTitle) {
          cache[n.toLowerCase()] = { icon: null, detail: r.detail, resolvedAt: now };
          canonicalByName[n.toLowerCase()] = r.canonicalTitle;
          fallbackFound++;
        }
      } catch (e) {
        console.log(`[icons] Search fallback failed for "${n}": ${e.message}`);
      }
      await new Promise(res => setTimeout(res, BATCH_DELAY_MS));
    }

    // Third pass: with every canonical title now known, batch-resolve the
    // small inventory-icon file for each — this is what actually shows up
    // inline everywhere; `detail` is only used for the enlarge-on-click view.
    const canonicalTitles = [...new Set(Object.values(canonicalByName))];
    const titleToNames = {};
    for (const [nameLower, title] of Object.entries(canonicalByName)) {
      (titleToNames[title] = titleToNames[title] || []).push(nameLower);
    }
    let iconsFound = 0;
    for (let i = 0; i < canonicalTitles.length; i += BATCH_SIZE) {
      const batch = canonicalTitles.slice(i, i + BATCH_SIZE);
      try {
        const iconByTitle = await _fetchIconBatch(batch);
        for (const [title, iconUrl] of Object.entries(iconByTitle)) {
          for (const nameLower of (titleToNames[title] || [])) {
            cache[nameLower].icon = iconUrl;
            if (iconUrl) iconsFound++;
          }
        }
      } catch (e) {
        console.log(`[icons] Icon batch failed (${batch.length} titles): ${e.message}`);
      }
      if (i + BATCH_SIZE < canonicalTitles.length) {
        await new Promise(res => setTimeout(res, BATCH_DELAY_MS));
      }
    }

    console.log(`[icons] Resolved ${resolvedCount}/${needsResolve.length} detail lookups (${uniqueNames.length - needsResolve.length} already cached), ${fallbackFound}/${stillMissing.length} recovered via search, ${iconsFound}/${canonicalTitles.length} small icons found`);
    try {
      await storage.writeJSON(cachePath, cache, { pretty: false });
    } catch (e) {
      console.log(`[icons] Cache write failed (results still returned this run): ${e.message}`);
    }
  }

  return cache;
}

module.exports = { resolveIcons };

if (require.main === module) {
  resolveIcons(['Kal\'gerion demon scroll (Crit-i-Kal)', 'Exquisite mining urn (no rune)', 'Rune scimitar', 'Greater flaming skull', 'Not a real item'], null)
    .then(cache => {
      for (const n of ['kal\'gerion demon scroll (crit-i-kal)', 'exquisite mining urn (no rune)', 'rune scimitar', 'greater flaming skull', 'not a real item']) {
        const e = cache[n];
        console.log(n, '\n  icon:', e?.icon || '(none)', '\n  detail:', e?.detail || '(none)');
      }
    });
}
