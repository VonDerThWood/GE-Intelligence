/**
 * drop-sources.js: watches where items DROP from, and warns when a new source
 * appears (2026-11-13). The Ghrazi Blood Knights (released 2026-10-12)
 * drop Elder seed x5 as a common drop, and Elder seed fell ~90% (34k -> ~3k)
 * in four days; Arch-Glacor did the same to Summoning focus in 2021. A new
 * boss with a stacked drop can wipe out an item, so GEnius checks the wiki's
 * "Drop sources" table for items you hold or watch, and tells you the day a
 * new source shows up.
 *
 * Source: the item's RS Wiki page, "Drop sources" section, rendered table.
 * Only the first table counts (current sources); the second lists removed or
 * unavailable content. Stored per item name in data/drop_sources.json:
 *   { items: { "<name>": { checkedAt, sources: { "<source>": { qty, rarity, firstSeen } } } } }
 * The first check of an item is a baseline: nothing is "new" yet.
 */
const WIKI = 'https://runescape.wiki/api.php';
const HEADERS = { 'User-Agent': 'GEnius/1.0 (github.com/VonDerThWood/GE-Intelligence)' };

const decode = s => s.replace(/<[^>]+>/g, '').replace(/&#160;|&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&#91;/g, '[').replace(/&#93;/g, ']').replace(/&#x231b;/g, '').replace(/\[[^\]]*\]/g, '')
  .replace(/\s+/g, ' ').trim();

async function getJson(params) {
  const res = await fetch(WIKI + '?' + new URLSearchParams({ format: 'json', redirects: '1', ...params }), { headers: HEADERS, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Current drop sources of one item: [{source, qty, rarity}], [] when the page
// has no drop sources, null when the page couldn't be read.
async function fetchSources(name) {
  const s = await getJson({ action: 'parse', prop: 'sections', page: name });
  if (s.error) return null;
  const sec = (s.parse?.sections || []).find(x => /^drop sources$/i.test(decode(x.line)));
  if (!sec) return [];
  const t = await getJson({ action: 'parse', prop: 'text', page: name, section: sec.index });
  const html = t.parse?.text?.['*'] || '';
  const firstTable = (html.match(/<table[\s\S]*?<\/table>/) || [''])[0];
  const out = [];
  for (const m of firstTable.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c => decode(c[1]));
    if (cells.length < 4 || !cells[0]) continue; // header rows use <th>
    out.push({ source: cells[0], qty: cells[2], rarity: cells[3] });
  }
  return out;
}

function createDropSources({ storage, path, dataDir }) {
  const file = path.join(dataDir, 'drop_sources.json');
  const DAY = 86400000;

  // Checks up to `max` of `names` not checked in the last day. Returns the new
  // sources found: [{item, source, qty, rarity}].
  async function check(names, max = 15) {
    const doc = await storage.readJSON(file, { items: {} });
    const due = [...new Set(names)].filter(n => !doc.items[n] || Date.now() - (doc.items[n].checkedAt || 0) > DAY)
      .sort((a, b) => (doc.items[a]?.checkedAt || 0) - (doc.items[b]?.checkedAt || 0)).slice(0, max);
    const found = [];
    for (const name of due) {
      let list;
      try { list = await fetchSources(name); } catch (e) { continue; }
      if (list == null) continue;
      const prev = doc.items[name];
      const sources = {};
      for (const s of list) {
        const had = prev?.sources?.[s.source];
        sources[s.source] = { qty: s.qty, rarity: s.rarity, firstSeen: had ? had.firstSeen : (prev ? Date.now() : 0) };
        if (prev && !had) found.push({ item: name, ...s });
      }
      doc.items[name] = { checkedAt: Date.now(), sources };
      await new Promise(r => setTimeout(r, 400));
    }
    if (due.length) await storage.writeJSON(file, doc);
    return found;
  }

  // One item's sources for the item panel, fetched now if never checked.
  async function get(name) {
    const doc = await storage.readJSON(file, { items: {} });
    if (!doc.items[name]) { await check([name], 1); return (await storage.readJSON(file, { items: {} })).items[name] || null; }
    return doc.items[name];
  }

  return { check, get };
}

module.exports = { createDropSources, fetchSources };
