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
 * Also graded "with offers" (Ben, 2026-11-13): buy at the instant-SELL price
 * and sell at the instant-BUY price, i.e. patient offers instead of paying the
 * spread. Elder seed's instant-buys swung 4.3k-32k in one day while sells sat
 * near 5k, so "instant" alone made the plan look far worse than it was.
 * A leg is flagged "wild" when its hourly prices on that side range more than
 * 3x low-to-high within the window.
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
  const other = side === 'buy' ? 'sell' : 'buy';
  const vals = win.map(h => h[side]).filter(x => x > 0);
  const wild = vals.length > 1 && Math.max(...vals) / Math.min(...vals) > 3;
  return { p: robust(vals), patient: robust(win.map(h => h[other])), wild, vol: win.reduce((a, h) => a + h.buyVol + h.sellVol, 0) };
};

const rows = [];
for (const [id, v] of Object.entries(intel)) {
  const r = v?.replay;
  if (!r?.passes) continue;
  const hours = lh.getItem(id, Math.ceil((Date.now() - t0) / DAY) + 3).map(h => ({ ...h, t: Date.parse(h.time + ':00:00Z') }));
  const first = r.buyFirst ? ['buy', r.buyDay] : ['sell', r.sellDay];
  const second = r.buyFirst ? ['sell', r.sellDay] : ['buy', r.buyDay];
  const a = priceAt(hours, first[1], first[0]), b = priceAt(hours, second[1], second[0]);
  let ret = null, patientRet = null, status = 'graded';
  if (a.pending || b.pending) status = 'pending';
  else if (a.p == null || b.p == null) status = 'no trades';
  else {
    ret = r.buyFirst ? tax(b.p) / a.p - 1 : tax(a.p) / b.p - 1;
    if (a.patient && b.patient) patientRet = r.buyFirst ? tax(b.patient) / a.patient - 1 : tax(a.patient) / b.patient - 1;
  }
  rows.push({ id, name: v.name, plan: r.buyFirst ? `buy d${r.buyDay}, sell d${r.sellDay}` : `sell d${r.sellDay}, buy back d${r.buyDay}`,
    first: Math.round(a.p || 0) || null, second: Math.round(b.p || 0) || null, ret: ret == null ? null : +(ret * 100).toFixed(1),
    withOffers: patientRet == null ? null : +(patientRet * 100).toFixed(1), wild: !!(a.wild || b.wild),
    typical: r.median, status, vol: (a.vol || 0) + (b.vol || 0) });
}
rows.sort((x, y) => (y.ret ?? -1e9) - (x.ret ?? -1e9));
const graded = rows.filter(r => r.status === 'graded');
const med = median(graded.map(r => r.ret + 1000)); // shift so negatives survive median()'s >0 filter
console.log(`DXP starting ${start}: ${rows.length} recommended plans | graded ${graded.length}, pending ${rows.filter(r => r.status === 'pending').length}, no trades ${rows.filter(r => r.status === 'no trades').length}`);
const medO = median(graded.filter(r => r.withOffers != null).map(r => r.withOffers + 1000));
if (graded.length) console.log(`made money: instant ${graded.filter(r => r.ret > 0).length}/${graded.length}, with offers ${graded.filter(r => r.withOffers > 0).length}/${graded.length} | typical result: instant ${med == null ? '-' : (med - 1000).toFixed(1) + '%'}, with offers ${medO == null ? '-' : (medO - 1000).toFixed(1) + '%'} (after tax) | wild markets: ${graded.filter(r => r.wild).length}`);
const pc = x => x == null ? '-' : (x > 0 ? '+' : '') + x + '%';
for (const r of rows) console.log(`${r.ret == null ? r.status.padStart(9) : pc(r.ret).padStart(9)} ${r.ret == null ? '' : ('(offers ' + pc(r.withOffers) + ')').padEnd(17)}${r.wild ? 'WILD ' : ''} ${r.name}  (${r.plan})  ${r.first ?? '-'} -> ${r.second ?? '-'}  [typical ${r.typical}%]`);
const outDir = path.join(DATA, 'almanac_grades');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, `${start}.json`), JSON.stringify({ start, gradedAt: new Date().toISOString(), method: 'hourly archive, robust 12h medians; ret = instant (buy at instant-buy, sell at instant-sell), withOffers = buy at instant-sell, sell at instant-buy; wild = a leg side ranged >3x in its window; 2% tax', rows }, null, 2));
console.log('saved', path.join(outDir, `${start}.json`));
