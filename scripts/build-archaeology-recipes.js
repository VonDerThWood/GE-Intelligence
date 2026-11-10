/**
 * Rebuilds ARCHAEOLOGY_DATA in src/renderer.js from the RuneScape Wiki (Ben, 2026-11-09):
 * every restored artefact (level, listed chronotes, restoration materials) and every
 * collection (collector, level, set-bonus chronotes, other recurring reward, artefacts).
 *   node scripts/build-archaeology-recipes.js
 */
const fs = require('fs');
const path = require('path');

const UA = { 'User-Agent': 'GEnius archaeology data builder (github.com/VonDerThWood/GE-Intelligence)' };
const api = async q => (await fetch('https://runescape.wiki/api.php?format=json&' + new URLSearchParams(q), { headers: UA })).json();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const num = s => +String(s).replace(/,/g, '');
const field = (w, k) => { const m = w.match(new RegExp(`\\|\\s*${k}\\s*=\\s*([^\\n|]*)`)); return m ? m[1].trim() : null; };
const unlink = s => (s || '').replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').trim();

async function pages(titles) {
  const out = {};
  for (let i = 0; i < titles.length; i += 40) {
    const r = await api({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', redirects: 1, titles: titles.slice(i, i + 40).join('|') });
    for (const p of Object.values(r.query.pages)) if (p.revisions) out[p.title] = p.revisions[0].slots.main['*'];
    await sleep(300);
  }
  return out;
}

(async () => {
  let titles = [], cont = {};
  do {
    const r = await api({ action: 'query', list: 'categorymembers', cmtitle: 'Category:Artefacts', cmlimit: 500, ...cont });
    titles.push(...r.query.categorymembers.filter(m => m.ns === 0).map(m => m.title));
    cont = r.continue || {};
  } while (cont.cmcontinue);
  const artefacts = {};
  const readArtefact = (title, w) => {
    const chrono = field(w, 'chronotes');
    const i = w.indexOf('Infobox Recipe');
    if (!chrono || i < 0 || !Number.isFinite(num(chrono))) return; // quest items have no chronote value
    const rec = w.slice(i, w.indexOf('}}', i));
    const level = num(field(rec, 'skill1lvl'));
    const mats = [];
    for (let n = 1; n < 12; n++) {
      const name = field(rec, `mat${n}`);
      if (!name) break;
      if (/\(damaged\)|^Damaged /.test(name)) continue;
      mats.push([name, num(field(rec, `mat${n}qty`) || 1)]);
    }
    if (!level || !mats.length) { console.log('skipped', title); return; }
    const spot = w.match(/\|\s*excavationhotspot\s*=\s*(.*)/);
    artefacts[title] = { l: level, c: num(chrono), m: mats, h: spot ? unlink(spot[1]) : '' };
  };
  for (const [title, w] of Object.entries(await pages(titles))) readArtefact(title, w);
  console.log('artefacts', Object.keys(artefacts).length);

  const index = (await api({ action: 'parse', page: 'Collections', prop: 'wikitext' })).parse.wikitext['*'];
  const names = [...index.matchAll(/\{\{Collection\|([^}|]+)\}\}/g)].map(m => m[1].trim());
  const texts = await pages(names);
  const collections = [], missingArtefacts = new Set();
  for (const name of names) {
    const w = texts[name];
    if (!w) { console.log('no page', name); continue; }
    const links = (await api({ action: 'parse', page: name, prop: 'text' })).parse.text['*'];
    await sleep(200);
    // The collection's own table comes before any navbox.
    const body = links.split('class="navbox')[0];
    const seen = new Set([...body.matchAll(/title="([^"]+)"/g)].map(m => m[1].replace(/&#0?39;/g, "'").replace(/&amp;/g, '&')));
    const pieces = [...new Set([...seen].filter(t => /\s*\(damaged\)$/.test(t)).map(t => t.replace(/\s*\(damaged\)$/, '')))];
    for (const t of pieces) if (!artefacts[t]) missingArtefacts.add(t);
    const expected = num(field(w, 'artefacts') || 0);
    if (expected !== pieces.length) console.log(`MISMATCH ${name}: page says ${expected}, found ${pieces.length}`);
    const rewards = ['recurring', 'recurring1', 'recurring2'].map(k => unlink(field(w, k))).filter(Boolean).filter(r => !/chronotes/i.test(r) && !/^(no|n\/a)$/i.test(r));
    collections.push({ n: name, e: expected, by: unlink(field(w, 'collector')), l: num(field(w, 'archlevel') || 0), b: num(field(w, 'chronotes') || 0), r: rewards.join(', '), a: pieces });
  }
  for (const [title, w] of Object.entries(await pages([...missingArtefacts]))) readArtefact(title, w);
  for (const c of collections) { const gone = c.a.filter(t => !artefacts[t]); if (gone.length) console.log('NO DATA', c.n, gone.join(', ')); }
  console.log('collections', collections.length, 'artefacts', Object.keys(artefacts).length);

  // What each hotspot drops, from the "Drops" section of its page.
  const hotspots = {};
  for (const spot of [...new Set(Object.values(artefacts).map(a => a.h).filter(Boolean))]) {
    const r = await api({ action: 'parse', page: spot, redirects: 1, prop: 'text' });
    await sleep(200);
    if (!r.parse) { console.log('no hotspot page', spot); continue; }
    const html = r.parse.text['*'];
    const i = html.indexOf('>Materials<');
    const j = html.indexOf('Artefact details', i);
    if (i < 0 || j < 0) { console.log('no drops', spot); continue; }
    hotspots[spot] = [...new Set([...html.slice(i, j).matchAll(/title="([^"]+)"/g)].map(m => m[1].replace(/&#0?39;/g, "'").replace(/&amp;/g, '&')))];
  }
  console.log('hotspots', Object.keys(hotspots).length);

  // Materials: what disassembling one gives (Ben, 2026-11-10). The wiki's
  // Disassembly box lists ancient components as e.g. "Historic components[1]{16/100}",
  // with alwaysgivesaspecialmaterial = yes meaning exactly one of them per material.
  const matNames = [...new Set(Object.values(artefacts).flatMap(a => a.m.map(m => m[0])))];
  const materials = {};
  for (const [name, w] of Object.entries(await pages(matNames))) {
    const i = w.indexOf('{{Disassembly');
    if (i < 0) continue;
    const box = w.slice(i, w.indexOf('}}', i));
    const special = (field(box, 'special') || '');
    const comps = [...special.matchAll(/(Historic|Classic|Timeworn|Vintage) components\[(\d+)\]\{(\d+)\/(\d+)\}/gi)]
      .map(m => [m[1].toLowerCase(), +m[2], +m[3] / +m[4]]);
    if (!comps.length) continue;
    materials[name] = { lvl: num(field(box, 'level') || 0), always: /yes/i.test(field(box, 'alwaysgivesaspecialmaterial') || ''), c: comps };
  }
  // The full breakdown (Ben, 2026-11-10: "show ALL of the materials"): base junk
  // chance, how many normal materials per disassembly, and each one's chance,
  // read from the rendered Disassembly section of the material's page.
  for (const name of Object.keys(materials)) {
    const r = await api({ action: 'parse', page: name, redirects: 1, prop: 'text' });
    await sleep(200);
    const html = r.parse?.text['*'] || '';
    const i = html.indexOf('id="Disassembly"');
    if (i < 0) continue;
    const t = html.slice(i, html.indexOf('<h2', i + 50)).replace(/<img[^>]*>/g, '').replace(/<[^>]+>/g, '|')
      .replace(/&#160;/g, ' ').replace(/\|[\s|]*\|/g, '|').replace(/\s+/g, ' ');
    const junk = t.match(/junk\| chance\|[^|]*\|\s*\|?([\d.]+)\|%/);
    const k = t.indexOf('Material count|');
    if (k < 0) continue;
    const rest = t.slice(k).split('|');
    const parts = [];
    // Most pages give a fraction (35/100); some only say Often / Rarely etc.
    for (let j = 2; j + 1 < rest.length && /^(\d+\/\d+|Always|Often|Sometimes|Rarely|Very rarely)$/i.test(rest[j + 1].trim()); j += 2) {
      const c = rest[j + 1].trim();
      parts.push([rest[j].trim(), /\//.test(c) ? c.split('/').map(Number).reduce((x, y) => x / y) : c]);
    }
    materials[name].n = { junk: junk ? +junk[1] / 100 : null, count: +rest[1] || 1, parts };
  }
  console.log('materials with ancient components', Object.keys(materials).length);
  const file = path.join(__dirname, '..', 'src', 'renderer.js');
  let src = fs.readFileSync(file, 'utf8');
  const begin = '// BEGIN ARCHAEOLOGY_DATA (generated by scripts/build-archaeology-recipes.js)';
  const end = '// END ARCHAEOLOGY_DATA';
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const i = src.indexOf(begin), j = src.indexOf(end);
  if (i < 0 || j < 0) throw new Error('Markers not found in renderer.js');
  src = src.slice(0, i) + begin + eol + `const ARCHAEOLOGY_DATA = ${JSON.stringify({ artefacts, collections, hotspots, materials })};` + eol + end + src.slice(j + end.length);
  fs.writeFileSync(file, src);
  console.log('Updated renderer.js');
})();
