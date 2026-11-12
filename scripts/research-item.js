/**
 * One-command item research (Ben, 2026-11-11), for Claude sessions here and
 * in the cloud: "what does X's price look like?"
 *   node scripts/research-item.js "dragon bones"     (or an item id)
 *   node scripts/research-item.js "dragon bones" --months 24
 *
 * Prints: live instant-buy/sell right now (RS Wiki), daily live prices from
 * GEnius's archive, the GE guide-price history (saved history, with any
 * missing recent days fetched from WeirdGloop), ranges and trends, the alch
 * floor, flip margin after tax, how it moved around past Double XP weekends,
 * the Almanac's verdict if present, and Ben's open position if he holds it.
 * Reads %APPDATA%\GEnius\data (in the cloud: APPDATA points at GEnius-private/appdata).
 * Works offline from the saved data alone; live parts say so when unreachable.
 */
const fs = require('fs'), path = require('path');
const { readDirItemSync } = require('../src/backend-js/storage.js');

// Cloud sessions reach the internet through a proxy that Node's fetch ignores
// unless NODE_USE_ENV_PROXY=1 (and the proxy's CA) is set at startup. If a
// proxy is configured and that isn't, re-run this script with them set.
{
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (proxy && !process.env.NODE_USE_ENV_PROXY) {
    const env = { ...process.env, NODE_USE_ENV_PROXY: '1' };
    const ca = '/root/.ccr/ca-bundle.crt';
    if (!env.NODE_EXTRA_CA_CERTS && require('fs').existsSync(ca)) env.NODE_EXTRA_CA_CERTS = ca;
    const r = require('child_process').spawnSync(process.execPath, process.argv.slice(1), { env, stdio: 'inherit' });
    process.exit(r.status == null ? 1 : r.status);
  }
}
process.stdout.on('error', e => { if (e.code === 'EPIPE') process.exit(0); }); // output piped into head etc.
const DATA = path.join(process.env.APPDATA || '', 'GEnius', 'data');
const UA = { 'User-Agent': 'GEnius research (github.com/VonDerThWood/GE-Intelligence)' };
const DAY = 86400000;
const args = process.argv.slice(2);
const monthsArg = args.indexOf('--months');
const MONTHS = monthsArg >= 0 ? Math.max(1, Number(args[monthsArg + 1]) || 12) : 12;
const query = args.filter((a, i) => !a.startsWith('--') && !(monthsArg >= 0 && i === monthsArg + 1)).join(' ').trim();

const readJSON = (f, d = null) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch { return d; } };
const gp = n => n == null || !isFinite(n) ? '-' : Math.abs(n) >= 1e9 ? (n / 1e9).toFixed(2) + 'b' : Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(2) + 'm' : Math.abs(n) >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : Math.round(n).toLocaleString('en-US');
const pct = n => n == null || !isFinite(n) ? '-' : (n > 0 ? '+' : '') + n.toFixed(1) + '%';
const day = ms => new Date(ms).toISOString().slice(0, 10);
const tax = p => (p >= 50 ? p * 0.98 : p);
const median = a => { const s = a.filter(x => x != null && isFinite(x)).sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const get = async url => { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); };

(async () => {
  if (!query) { console.log('usage: node scripts/research-item.js "<item name or id>" [--months N]'); process.exit(1); }
  const latest = readJSON('latest.json');
  if (!latest) { console.log(`No GEnius data at ${DATA} (set APPDATA?)`); process.exit(1); }
  const items = latest.items || [];

  // ── Find the item ──
  let item = /^\d+$/.test(query) ? items.find(i => String(i.id) === query) : null;
  if (!item) {
    const q = query.toLowerCase();
    const exact = items.filter(i => i.name && i.name.toLowerCase() === q);
    const partial = items.filter(i => i.name && i.name.toLowerCase().includes(q));
    if (exact.length) item = exact[0];
    else if (partial.length === 1) item = partial[0];
    else if (partial.length) { console.log(`"${query}" matches ${partial.length} items, be more exact:\n` + partial.slice(0, 15).map(i => `  ${i.name} (id ${i.id})`).join('\n')); process.exit(1); }
    else { console.log(`No item called "${query}".`); process.exit(1); }
  }
  const id = String(item.id);
  console.log(`\n=== ${item.name}  (id ${id}${item.members ? ', members' : ''}${item.limit ? `, buy limit ${gp(item.limit)}/4h` : ''}) ===`);
  if (item.examine) console.log(item.examine);
  console.log(`GEnius data as of ${latest.updated_at || day(latest.timestamp)}`);

  // ── Live right now ──
  console.log('\n--- LIVE (RS Wiki, instant prices) ---');
  let liveBuy = item.liveBuy, liveSell = item.liveSell, liveNote = '(saved in GEnius; live fetch failed)';
  try {
    const d = (await get(`https://prices.runescape.wiki/api/v2/rs/latest?id=${id}`)).data[id];
    if (d) { liveBuy = d.high; liveSell = d.low; liveNote = `(now; last trades ${d.highTime ? new Date(d.highTime * 1000).toISOString().slice(11, 16) : '-'} / ${d.lowTime ? new Date(d.lowTime * 1000).toISOString().slice(11, 16) : '-'} UTC)`; }
  } catch (e) { liveNote += ': ' + e.message; }
  console.log(`instant-buy ${gp(liveBuy)}  instant-sell ${gp(liveSell)}  ${liveNote}`);
  if (liveBuy && liveSell) {
    const margin = tax(liveBuy) - liveSell;
    console.log(`flip margin after 2% tax: ${gp(margin)} each (${pct(margin / liveSell * 100)})` + (item.limit ? `, ${gp(margin * item.limit)} per full buy limit` : ''));
  }
  if (item.liveUnits) console.log(`traded last 24h: ${gp(item.liveUnits)} units, ${gp(item.liveTurnover)} gp`);

  // ── Live daily archive ──
  const liveDays = [];
  for (const f of fs.existsSync(path.join(DATA, 'live_history')) ? fs.readdirSync(path.join(DATA, 'live_history')).filter(f => /^\d{4}-\d{2}\.json$/.test(f)).sort() : []) {
    const doc = readJSON(path.join('live_history', f), { days: {} });
    for (const date of Object.keys(doc.days || {}).sort()) { const r = doc.days[date][id]; if (r) liveDays.push({ date, buy: r[0], buyVol: r[1], sell: r[2], sellVol: r[3] }); }
  }
  if (liveDays.length) {
    console.log(`\n--- LIVE DAILY (GEnius archive, ${liveDays[0].date} to ${liveDays[liveDays.length - 1].date}) ---`);
    console.log('date        avg buy    avg sell   units');
    for (const r of liveDays.slice(-14)) console.log(`${r.date}  ${gp(r.buy).padStart(9)}  ${gp(r.sell).padStart(9)}  ${gp((r.buyVol || 0) + (r.sellVol || 0)).padStart(8)}`);
    for (const n of [30, 90]) {
      const w = liveDays.slice(-n);
      if (w.length >= n * 0.6) console.log(`last ${n} days: buy median ${gp(median(w.map(r => r.buy)))}, sell median ${gp(median(w.map(r => r.sell)))}, range ${gp(Math.min(...w.map(r => r.sell).filter(Boolean)))} - ${gp(Math.max(...w.map(r => r.buy).filter(Boolean)))}`);
    }
  }

  // ── Guide history ──
  let pts = (readDirItemSync(path.join(DATA, 'history'), id) || []).map(p => ({ t: p.timestamp > 1e12 ? p.timestamp : p.timestamp * 1000, price: p.price, volume: p.volume || 0 }));
  let topped = 0;
  const lastT = pts.length ? Math.max(...pts.map(p => p.t)) : 0;
  if (Date.now() - lastT > 2 * DAY) {
    try {
      const url = pts.length && Date.now() - lastT < 85 * DAY ? `https://api.weirdgloop.org/exchange/history/rs/last90d?id=${id}` : `https://api.weirdgloop.org/exchange/history/rs/all?id=${id}`;
      const fresh = ((await get(url))[id] || []).filter(p => p.price && p.timestamp > lastT);
      pts.push(...fresh.map(p => ({ t: p.timestamp, price: p.price, volume: p.volume || 0 })));
      topped = fresh.length;
    } catch (e) { console.log(`\n(couldn't fetch recent guide history: ${e.message}; using saved data only)`); }
  }
  pts = pts.filter(p => p.price > 0).sort((a, b) => a.t - b.t);
  if (!pts.length) { console.log('\nNo guide-price history.'); }
  else {
    const now = pts[pts.length - 1];
    const at = ms => { let best = null; for (const p of pts) { if (p.t <= ms) best = p; else break; } return best; };
    console.log(`\n--- GE GUIDE PRICE (daily, ${day(pts[0].t)} to ${day(now.t)}${topped ? `, ${topped} recent days fetched just now` : ''}) ---`);
    console.log(`now ${gp(now.price)} (${day(now.t)})`);
    console.log([[1, '1d'], [7, '7d'], [30, '30d'], [90, '90d'], [365, '1y'], [365 * 3, '3y']].map(([d, l]) => { const p = at(now.t - d * DAY); return `${l} ${p ? pct((now.price / p.price - 1) * 100) : '-'}`; }).join('   '));
    const span = (days, label) => {
      const w = pts.filter(p => p.t >= now.t - days * DAY);
      if (w.length < 2) return;
      const hi = w.reduce((a, b) => (b.price > a.price ? b : a)), lo = w.reduce((a, b) => (b.price < a.price ? b : a));
      const where = hi.price > lo.price ? ((now.price - lo.price) / (hi.price - lo.price) * 100).toFixed(0) + '% of the way up' : '-';
      console.log(`${label}: high ${gp(hi.price)} (${day(hi.t)}), low ${gp(lo.price)} (${day(lo.t)}), now ${where}`);
    };
    span(90, '90 days'); span(365, '1 year'); span(1e6, 'all time');
    const v30 = median(pts.filter(p => p.t >= now.t - 30 * DAY).map(p => p.volume));
    if (v30) console.log(`typical daily volume (30d median): ${gp(v30)}`);
    console.log(`\nmonthly average, last ${MONTHS} months:`);
    const byMonth = {};
    for (const p of pts.filter(p => p.t >= now.t - MONTHS * 31 * DAY)) (byMonth[day(p.t).slice(0, 7)] ||= []).push(p.price);
    let prev = null;
    for (const [m, a] of Object.entries(byMonth).sort().slice(-MONTHS)) {
      const avg = a.reduce((x, y) => x + y, 0) / a.length;
      console.log(`  ${m}  ${gp(avg).padStart(9)}  ${prev ? pct((avg / prev - 1) * 100).padStart(7) : ''}`);
      prev = avg;
    }

    // ── Double XP pattern ──
    const ev = readJSON('dxp_events.json');
    const events = ev ? [...new Map((ev.events || ev).map(e => Array.isArray(e) ? [e[1], { start: Date.parse(e[1]), end: Date.parse(e[2]) }] : [e.start, { start: Date.parse(e.start), end: Date.parse(e.end) }])).values()] : [];
    const done = events.filter(e => e.end + 14 * DAY < now.t && e.start - 14 * DAY > pts[0].t).sort((a, b) => b.start - a.start);
    if (done.length >= 3) {
      const rows = done.map(e => {
        const b = at(e.start - 14 * DAY), s = at(e.start), en = at(e.end), a = at(e.end + 14 * DAY);
        return b && s && en && a ? { run: (s.price / b.price - 1) * 100, during: (en.price / s.price - 1) * 100, after: (a.price / en.price - 1) * 100 } : null;
      }).filter(Boolean);
      if (rows.length >= 3) {
        const up = k => rows.filter(r => r[k] > 0).length;
        console.log(`\n--- AROUND DOUBLE XP (${rows.length} past events, guide prices) ---`);
        console.log(`2 weeks before -> start: typical ${pct(median(rows.map(r => r.run)))} (rose ${up('run')}/${rows.length})`);
        console.log(`start -> end:            typical ${pct(median(rows.map(r => r.during)))} (rose ${up('during')}/${rows.length})`);
        console.log(`end -> 2 weeks after:    typical ${pct(median(rows.map(r => r.after)))} (rose ${up('after')}/${rows.length})`);
        const next = events.filter(e => e.end > Date.now()).sort((a, b) => a.start - b.start)[0];
        if (next) console.log(`current/next DXP: ${day(next.start)} to ${day(next.end)}`);
      }
    }
  }

  // ── Almanac (only if dxp_intelligence.json is present; it isn't in the cloud copy) ──
  const intel = readJSON('dxp_intelligence.json');
  const r = intel && intel[id] && intel[id].replay;
  if (r) console.log(`\nAlmanac plan: ${r.buyFirst ? `buy day ${r.buyDay}, sell day ${r.sellDay}` : `sell day ${r.sellDay}, buy back day ${r.buyDay}`} (days from DXP start), typical ${pct(r.median)}, ${r.passes ? 'PASSES its replay tests' : 'does not pass its replay tests'}`);

  // ── Alch floor ──
  if (item.alch > 1 && item.natureRunePrice) {
    const floor = item.alch - item.natureRunePrice;
    console.log(`\nHigh Alch ${gp(item.alch)} - nature rune ${gp(item.natureRunePrice)} = alch floor ${gp(floor)}` + (liveSell ? ` (live sell is ${pct((liveSell / floor - 1) * 100)} vs the floor)` : ''));
  }
  if (item.signals && item.signals.length) console.log('GEnius signals: ' + item.signals.map(s => s.type || s.label || JSON.stringify(s)).join(', '));

  // ── Ben's position ──
  const pf = readJSON('portfolio.json');
  const mine = (pf && pf.positions || []).filter(p => p.status === 'open' && (p.item_name || '').toLowerCase() === item.name.toLowerCase());
  if (mine.length) {
    console.log('\n--- YOUR OPEN POSITION ---');
    for (const p of mine) {
      const value = liveSell ? tax(liveSell) * p.quantity : null, cost = p.cost_basis * p.quantity;
      console.log(`${gp(p.quantity)} bought at ${gp(p.cost_basis)} (opened ${p.date_opened || '-'}): worth ${gp(value)} at live sell after tax, P/L ${gp(value - cost)} (${pct((value / cost - 1) * 100)})`);
    }
  }
  console.log('');
})().catch(e => { console.error(e); process.exit(1); });
