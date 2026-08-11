/**
 * GEnius News Scraper — RS3 official news + RS Wiki recent changes
 * Detects GE item name mentions in headlines.
 *
 * Faithful JS port of python/news.py (Python-to-JS backend migration,
 * see TODO.txt / SESSION_LOG.md, 2026-06-26). Verify against the Python
 * original on real data before trusting this over it. Note: fetch_all_news
 * only calls fetch_rs3_news (not fetch_wiki_changes) in the Python
 * original too — ported as-is, not "fixed," since this is a faithful port.
 */

const _HEADERS = { 'User-Agent': 'GEnius-app/1.2 (RS3 GE tracker; contact: letterslive@gmail.com)' };

// ─── Update type → affected categories ──────────────────────────────────────

const UPDATE_RULES = [
  // Each rule: [keywords_any, update_label, affected_categories]
  [['dxp', 'double xp', 'double experience', 'bonus xp'],
    'DXP Weekend',
    ['herblore', 'summoning', 'artisan', 'farming', 'archaeology', 'mining']],

  [['archaeology', 'digsite', 'dig site', 'excavation', 'artifact', 'chronotes', 'mattock',
    'kharid-et', 'everlight', 'stormguard', 'warforge', 'city of senntisten', 'anachronia'],
    'Archaeology Update',
    ['archaeology', 'mining']],

  [['new boss', 'new monster', 'raid', 'dungeon', 'slayer creature', 'combat update', 'combat rework',
    'boss encounter', 'boss fight', 'boss drop'],
    'Combat / Boss Update',
    ['boss', 'melee', 'ranged', 'magic', 'necromancy', 'supplies', 'herblore', 'food']],

  [['necromancy', 'ritual', 'ectoplasm', 'necrosis', 'conjure'],
    'Necromancy Update',
    ['necromancy', 'runes', 'prayer', 'supplies']],

  [['herblore', 'potion', 'overload', 'brew'],
    'Herblore Update',
    ['herblore', 'supplies']],

  [['slayer', 'slayer master', 'slayer task'],
    'Slayer Update',
    ['boss', 'melee', 'ranged', 'magic', 'supplies', 'herblore']],

  [['farming', 'seed', 'harvest', 'farming patch'],
    'Farming Update',
    ['farming', 'mining', 'supplies']],

  [['mining', 'smithing', 'ore', 'smelting', 'metal'],
    'Mining & Smithing Update',
    ['mining', 'artisan']],

  [['prayer', 'bone', 'ashes', 'altar', 'ensoul'],
    'Prayer Update',
    ['prayer']],

  [['summoning', 'familiar', 'pouch', 'charm'],
    'Summoning Update',
    ['summoning', 'supplies']],

  [['invention', 'perk', 'gizmo', 'component', 'disassemble'],
    'Invention Update',
    ['invention', 'supplies']],

  [['construction', 'player owned house', 'poh', 'butler', 'flatpack'],
    'Construction Update',
    ['artisan', 'supplies']],

  [['wilderness', 'pvp', 'player vs player', 'bounty hunter'],
    'Wilderness / PvP Update',
    ['melee', 'ranged', 'magic', 'supplies', 'runes']],

  [['treasure trail', 'clue scroll', 'clue reward'],
    'Treasure Trails Update',
    ['treasure_trails', 'rares']],

  [['grand exchange', 'ge update', 'trade update', 'tax', 'ge tax'],
    'Grand Exchange Update',
    ['rares', 'boss', 'melee', 'ranged', 'magic', 'necromancy']],

  [['quest', 'miniquest', 'storyline', 'lore update'],
    'Quest / Lore Update',
    ['supplies', 'herblore', 'melee', 'ranged', 'magic']],

  [['seasonal', 'holiday', 'christmas', 'halloween', 'easter', 'event'],
    'Seasonal Event',
    ['rares', 'supplies']],

  [['graphical', 'rendering', 'visual update', 'client update', 'interface', 'ui update',
    'quality of life', 'qol update', 'bug fix', 'hotfix', 'patch notes', 'game update'],
    'Game Update',
    []],
];

function _escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function detectUpdateType(title, description = '') {
  const text = (title + ' ' + description).toLowerCase();
  for (const [keywords, label, cats] of UPDATE_RULES) {
    if (keywords.some(kw => new RegExp('\\b' + _escapeRe(kw) + '\\b').test(text))) {
      return [label, cats];
    }
  }
  return [null, []];
}

function getImpactedItems(cats, allItems, limit = 10) {
  // Return top movers from the given categories, ranked by signal strength then change.
  if (!cats || !cats.length || !allItems || !allItems.length) return [];
  const catSet = new Set(cats);
  const relevant = allItems.filter(it => (it.categories || []).some(c => catSet.has(c)));
  const signalRank = { FRENZY: 0, SURGE: 1, DUMP: 2, MANIPULATED: 3 };
  const sortKey = it => {
    const sigs = it.signals || [];
    const ranks = sigs.filter(s => s in signalRank).map(s => signalRank[s]);
    const top = ranks.length ? Math.min(...ranks) : 99;
    return [top, -Math.abs(it.change_1d || 0)];
  };
  relevant.sort((a, b) => {
    const [aTop, aChg] = sortKey(a), [bTop, bChg] = sortKey(b);
    if (aTop !== bTop) return aTop - bTop;
    return aChg - bChg;
  });
  const movers = relevant.filter(it => (it.signals && it.signals.length) || it.change_1d);
  return movers.slice(0, limit).map(it => ({
    name: it.name,
    change_1d: it.change_1d ?? null,
    signals: (it.signals || []).filter(s => s in signalRank),
  }));
}

// ─── Item name index (built lazily from price cache) ────────────────────────

let _ITEM_INDEX = null;

function _getIndex(items = null) {
  if (_ITEM_INDEX !== null) return _ITEM_INDEX;
  // Real operation always has items by the time mentions get detected
  // (run.js only calls into here after a successful price fetch) — the
  // no-items case is just the bare CLI/test invocation at the bottom of
  // this file, where returning no mentions is a fine degenerate result,
  // not worth a fs fallback (which would've needed a synchronous read
  // with no portable async equivalent in the hot detectMentions() loop).
  if (!items || !items.length) return [];
  const names = items.filter(it => it.name).map(it => it.name);
  _ITEM_INDEX = names.map(n => n.toLowerCase()).sort((a, b) => b.length - a.length);
  return _ITEM_INDEX;
}

// Python's str.title(): capitalizes the first letter of every maximal run of
// alphabetic characters, lowercasing the rest — including the well-known
// quirk that an apostrophe starts a new "word" (e.g. "don't" -> "Don'T").
// Replicated exactly here for fidelity rather than "fixed."
function _pyTitle(s) {
  return s.replace(/[A-Za-z]+/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

const _GENERIC_SHORT_WORDS = new Set(['ore', 'log', 'bar', 'axe', 'bow', 'kit', 'dye', 'tar', 'oil', 'ash', 'wax']);

// Ben, 2026-08-10: caught for real — "Extreme necromancy (1)" got
// detected as a mention on a news article that was actually about the
// API/plugin project, nothing to do with the potion. Same false-positive
// shape as the Gin/begin bug above, just at the phrase level instead of
// mid-word: both "extreme" and "necromancy" are completely ordinary
// words in combat-update prose on their own, so an item name that's
// just "Extreme" + a skill name is basically guaranteed to eventually
// coincide with unrelated text. Denylisted the whole family (all 6
// combat-skill potions, checked against the dose-stripped base name)
// rather than necromancy alone, since attack/strength/defence/magic/
// ranging share the exact same shape and would eventually hit the same
// false positive given a different article.
const _GENERIC_BASE_NAMES = new Set([
  'extreme attack', 'extreme strength', 'extreme defence',
  'extreme magic', 'extreme ranging', 'extreme necromancy',
]);
function _stripDose(name) {
  return name.replace(/\s*\(\d+\)$/, '');
}

// Plain .includes() matched an item name ANYWHERE in the text, including
// mid-word — confirmed for real (Ben, 2026-08-03): the "Gin" item was
// matching inside "begin"/"beginning"/"imagine" on every article
// containing those ordinary English words. _GENERIC_SHORT_WORDS was a
// denylist for exactly this shape of false positive, but it only covers
// words someone happened to notice and add — it can't scale to every
// short (or even long) item name that happens to be a substring of a
// common word. This checks that the character immediately before/after
// the match (if any) isn't itself alphanumeric, so "gin" only matches
// as its own word, not embedded in a longer one.
function _hasWordMatch(text, name) {
  let idx = text.indexOf(name);
  while (idx !== -1) {
    const before = idx > 0 ? text[idx - 1] : '';
    const after = idx + name.length < text.length ? text[idx + name.length] : '';
    if (!/[a-z0-9]/i.test(before) && !/[a-z0-9]/i.test(after)) return true;
    idx = text.indexOf(name, idx + 1);
  }
  return false;
}

function detectMentions(text, items = null) {
  const textLower = text.toLowerCase();
  const found = [];
  const seen = new Set();
  for (const name of _getIndex(items)) {
    if (_hasWordMatch(textLower, name) && !seen.has(name)) {
      // Skip overly generic single words that produce false positives
      if (name.length <= 3 && _GENERIC_SHORT_WORDS.has(name)) continue;
      // Skip generic "Extreme <skill>" potions — see _GENERIC_BASE_NAMES
      if (_GENERIC_BASE_NAMES.has(_stripDose(name))) continue;
      seen.add(name);
      found.push(_pyTitle(name));
      if (found.length >= 15) break;
    }
  }
  return found;
}

// ─── HTTP helper ─────────────────────────────────────────────────────────────

async function _get(url, params = null) {
  if (params) {
    url += '?' + new URLSearchParams(params).toString();
  }
  const res = await fetch(url, { headers: _HEADERS, signal: AbortSignal.timeout(12000) });
  return res.text();
}

// ─── RS3 Official News (RSS) ─────────────────────────────────────────────────

const _MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };

// Mirrors the Python strptime try/except chain: try the numeric-offset RFC822
// form, then the literal "GMT" form, then fall back to extracting YYYY-MM-DD,
// then just the first 10 characters.
function _parseRssDate(dateStr) {
  let m = dateStr.match(/^\w{3}, (\d{2}) (\w{3}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) (?:[+\-]\d{4}|GMT)$/);
  if (m) {
    const [, dd, mon, yyyy] = m;
    const mon_num = _MONTHS[mon];
    if (mon_num) return `${yyyy}-${String(mon_num).padStart(2, '0')}-${dd}`;
  }
  const ymd = dateStr.match(/(\d{4}-\d{2}-\d{2})/);
  if (ymd) return ymd[1];
  return dateStr.slice(0, 10);
}

async function fetchRs3News(limit = 20, allItems = null) {
  const results = [];
  try {
    const html = await _get('https://services.runescape.com/m=news/latest_news.rss');
    const entries = [...html.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => m[1]);
    for (const entry of entries.slice(0, limit)) {
      const titleM = entry.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) ||
                     entry.match(/<title>([\s\S]*?)<\/title>/);
      const linkM = entry.match(/<link>([\s\S]*?)<\/link>/);
      const dateM = entry.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
      const descM = entry.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) ||
                    entry.match(/<description>([\s\S]*?)<\/description>/);
      if (!titleM) continue;
      let title = titleM[1].trim();
      title = title.replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      const link = linkM ? linkM[1].trim() : '';
      let date = dateM ? dateM[1].trim() : '';
      const descRaw = descM ? descM[1] : '';
      // Strip HTML tags from description for text scanning
      const desc = descRaw.replace(/<[^>]+>/g, ' ').trim();
      try {
        date = _parseRssDate(date);
      } catch {
        date = date.slice(0, 10);
      }
      const [updateType, cats] = detectUpdateType(title);
      // Ben, 2026-08-10: caught for real — a "Quest / Lore Update" article
      // about the API/plugin project (nothing to do with any specific
      // skill) showed "Extreme Necromancy (1) -9.2%" as its "Market
      // Reaction," just because that item happened to have a FRENZY
      // signal and sits in one of the update type's broadly-defined
      // affected categories (herblore). These "meta" update types don't
      // map to any coherent set of categories the way Necromancy Update
      // or Farming Update genuinely do — Quest/Lore, the generic Game
      // Update catch-all, Seasonal Event, and Grand Exchange Update all
      // have category lists broad enough to catch nearly any FRENZY item
      // regardless of real relevance, so skip impact items for these
      // entirely rather than surface a coincidental, misleading pairing.
      const _NO_IMPACT_ITEMS_TYPES = new Set([
        'Quest / Lore Update', 'Game Update', 'Seasonal Event', 'Grand Exchange Update',
      ]);
      const skipImpact = _NO_IMPACT_ITEMS_TYPES.has(updateType);
      results.push({
        source: 'RS3 News',
        title,
        url: link,
        date,
        mentions: detectMentions(title + ' ' + desc),
        description: desc ? desc.slice(0, 200) : '',
        update_type: updateType,
        impact_categories: skipImpact ? [] : cats,
        impact_items: (allItems && !skipImpact) ? getImpactedItems(cats, allItems) : [],
      });
    }
  } catch (e) {
    console.log(`[news] RS3 RSS error: ${e.message}`);
  }
  return results;
}

// ─── RS Wiki Recent Changes (item pages only) ────────────────────────────────

async function fetchWikiChanges(limit = 10) {
  const results = [];
  try {
    const params = {
      action: 'query', list: 'recentchanges',
      rclimit: 60, rcnamespace: '0',
      rcprop: 'title|timestamp', format: 'json',
    };
    const data = JSON.parse(await _get('https://runescape.wiki/api.php', params));
    const changes = data?.query?.recentchanges || [];
    const seen = new Set();
    for (const ch of changes) {
      const title = ch.title || '';
      if (seen.has(title)) continue;
      seen.add(title);
      const mentions = detectMentions(title);
      if (!mentions.length) continue;
      const ts = ch.timestamp || '';
      let date;
      try {
        date = new Date(ts).toISOString().slice(0, 16).replace('T', ' ');
      } catch {
        date = ts.slice(0, 16);
      }
      results.push({
        source: 'RS Wiki',
        title: `Wiki updated: ${title}`,
        url: `https://runescape.wiki/w/${title.replace(/ /g, '_')}`,
        date,
        mentions,
      });
      if (results.length >= limit) break;
    }
  } catch (e) {
    console.log(`[news] Wiki changes error: ${e.message}`);
  }
  return results;
}

// ─── Public API ──────────────────────────────────────────────────────────────

async function fetchAllNews(items = null) {
  // Seed index with live items if provided by run.py
  if (items) _getIndex(items);

  console.log('[news] Fetching RS3 official news…');
  const rsNews = await fetchRs3News(20, items);
  console.log(`[news] ${rsNews.length} articles`);

  rsNews.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return rsNews;
}

module.exports = { detectUpdateType, getImpactedItems, detectMentions, fetchRs3News, fetchWikiChanges, fetchAllNews };

if (require.main === module) {
  fetchAllNews().then(news => {
    console.log(`\nTotal: ${news.length} articles`);
    for (const n of news) {
      console.log(`  [${n.source}] ${n.date}  ${n.title.slice(0, 70)}`);
      if (n.mentions.length) console.log(`    → ${n.mentions.join(', ')}`);
    }
  });
}
