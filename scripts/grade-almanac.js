/**
 * Grades the Almanac's recommended DXP plans against REAL trades from the
 * hourly archive (Ben, 2026-11-11). Run after a DXP ends (or during it: legs
 * still in the future show as pending).
 *   node scripts/grade-almanac.js [startDate YYYY-MM-DD]
 * Defaults to the latest DXP in dxp_events.json.
 *
 * Plan days count from the DXP's start date at 00:00 UTC (day 0 = that day,
 * 0.5 = its second half). Each leg is priced over the 12 hours from that point:
 * a buy at the typical INSTANT-BUY price, a sell at the typical INSTANT-SELL
 * price (medians of the hourly averages, after dropping values more than 3x
 * from the window's median). That's what you'd realistically have got, not
 * the best tick. 2% tax on the sale (none under 50gp).
 * Writes grades to data/almanac_grades/<start>.json next to the GEnius data.
 */
const fs = require('fs'), path = require('path');
const { createLiveHourly } = require('../src/backend-js/live-hourly.js');

const DATA = path.join(process.env.APPDATA, 'GEnius', 'data');
const HOUR = 3600000, DAY = 86400000, WINDOW_H = 12;
const lh = createLiveHourly({ dataDir: DATA });
const tax = p => (p >= 50 ? p * 0.98 : p);
const median = a => { const s = a.filter(x => x != null && x > 0).sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const robust = a => { const m = median(a); return m == null ? null : median(a.filter(x => x != null && x > 0 && x <= m * 3 && x >= m / 3)); };

const events = JSON.parse(fs.readFileSync(path.join(DATA, 'dxp_events.json')));
const starts = [...new Set((events.events || events).map(e => (Array.isArray(e) ? e[1] : e.start)))].sort();
const start = process.argv[2] || starts[starts.length - 1];
const t0 = Date.parse(start + 'T00:00:00Z');
const intel = JSON.parse(fs.readFileSync(path.join(DATA, 'dxp_intelligence.json')));

const priceAt = (hours, day, side) => {
  const from = t0 + day * DAY, to = from + WINDOW_H * HOUR;
  if (to > Date.now()) return { pending: true };
  const win = hours.filter(h => h.t >= from && h.t < to);
  const p = robust(win.map(h => h[side]));
  return { p, vol: win.reduce((a, h) => a + h.buyVol + h.sellVol, 0) };
};

const rows = [];
for (const [id, v] of Object.entries(intel)) {
  const r = v?.replay;
  if (!r?.passes) continue;
  const hours = lh.getItem(id, Math.ceil((Date.now() - t0) / DAY) + 3).map(h => ({ ...h, t: Date.parse(h.time + ':00:00Z') }));
  const first = r.buyFirst ? ['buy', r.buyDay] : ['sell', r.sellDay];
  const second = r.buyFirst ? ['sell', r.sellDay] : ['buy', r.buyDay];
  const a = priceAt(hours, first[1], first[0]), b = priceAt(hours, second[1], second[0]);
  let ret = null, status = 'graded';
  if (a.pending || b.pending) status = 'pending';
  else if (a.p == null || b.p == null) status = 'no trades';
  else ret = r.buyFirst ? tax(b.p) / a.p - 1 : tax(a.p) / b.p - 1;
  rows.push({ id, name: v.name, plan: r.buyFirst ? `buy d${r.buyDay}, sell d${r.sellDay}` : `sell d${r.sellDay}, buy back d${r.buyDay}`,
    first: Math.round(a.p || 0) || null, second: Math.round(b.p || 0) || null, ret: ret == null ? null : +(ret * 100).toFixed(1),
    typical: r.median, status, vol: (a.vol || 0) + (b.vol || 0) });
}
rows.sort((x, y) => (y.ret ?? -1e9) - (x.ret ?? -1e9));
const graded = rows.filter(r => r.status === 'graded');
const med = median(graded.map(r => r.ret + 1000)); // shift so negatives survive median()'s >0 filter
console.log(`DXP starting ${start}: ${rows.length} recommended plans | graded ${graded.length}, pending ${rows.filter(r => r.status === 'pending').length}, no trades ${rows.filter(r => r.status === 'no trades').length}`);
if (graded.length) console.log(`made money: ${graded.filter(r => r.ret > 0).length}/${graded.length} | typical result ${med == null ? '-' : (med - 1000).toFixed(1) + '%'} (after tax)`);
for (const r of rows) console.log(`${r.ret == null ? r.status.padStart(9) : ((r.ret > 0 ? '+' : '') + r.ret + '%').padStart(9)}  ${r.name}  (${r.plan})  ${r.first ?? '-'} -> ${r.second ?? '-'}  [typical ${r.typical}%]`);
const outDir = path.join(DATA, 'almanac_grades');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, `${start}.json`), JSON.stringify({ start, gradedAt: new Date().toISOString(), method: 'hourly archive, robust 12h medians, instant-buy for buys, instant-sell for sells, 2% tax', rows }, null, 2));
console.log('saved', path.join(outDir, `${start}.json`));
