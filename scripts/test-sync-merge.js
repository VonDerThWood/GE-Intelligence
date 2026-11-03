// Tests for src/backend-js/sync-merge.js. Run: node scripts/test-sync-merge.js [portfolio.json]
const assert = require('assert');
const fs = require('fs');
const { merge } = require('../src/backend-js/sync-merge.js');

const clone = x => JSON.parse(JSON.stringify(x));
const pos = (id, over = {}) => ({ id, item_name: `item${id}`, status: 'open', quantity: 100, cost_basis: 10, ...over });
const state = () => ({
  portfolio: { positions: [pos('1'), pos('2'), pos('3')], buy_goals: [{ id: 'g', bought: 10, history: [{ t: 1, bought: 10 }] }],
    tax_stats: { lifetime_tax: 1000, today_tax: 100, day_date: 'd1', week_tax: 200, week_date: 'w1', month_tax: 300, month_date: 'm1' } },
  alerts: [{ id: 'a', item_name: 'x', price: 5 }], reminders: [{ id: 'r', text: 'hi' }],
  watchlist: [1, 2, 3], hiddenItems: [], dxpWatchlist: ['9'], itemNotes: { n: 'note' }, userShorthands: { S: 'short' },
  dxpEvents: [['2026-04-23', '2026-05-01', '2026-05-11']],
});
const find = (r, id) => r.merged.portfolio.positions.find(p => p.id === id);
const run = (name, fn) => { fn(); console.log(`ok  ${name}`); };

run('nothing changed: identical result, no conflicts', () => {
  const b = state(), r = merge({ base: b, hub: clone(b), phone: clone(b) });
  assert.deepStrictEqual(r.merged.portfolio.positions, b.portfolio.positions);
  assert.strictEqual(r.conflicts.length, 0);
});
run('change on one side is taken, from either side', () => {
  const b = state(), h = clone(b), p = clone(b);
  h.portfolio.positions[0].cost_basis = 20;
  p.portfolio.positions[1].cost_basis = 30;
  const r = merge({ base: b, hub: h, phone: p });
  assert.strictEqual(find(r, '1').cost_basis, 20);
  assert.strictEqual(find(r, '2').cost_basis, 30);
  assert.strictEqual(r.conflicts.length, 0);
});
run('different fields of one record both survive', () => {
  const b = state(), h = clone(b), p = clone(b);
  h.portfolio.positions[0].target_price = 50;
  p.portfolio.positions[0].stop_loss = 5;
  const r = merge({ base: b, hub: h, phone: p });
  assert.strictEqual(find(r, '1').target_price, 50);
  assert.strictEqual(find(r, '1').stop_loss, 5);
});
run('additions on both sides are kept, deletions stay deleted', () => {
  const b = state(), h = clone(b), p = clone(b);
  h.portfolio.positions.push(pos('h'));
  p.portfolio.positions.push(pos('p'));
  h.portfolio.positions = h.portfolio.positions.filter(x => x.id !== '2');
  p.portfolio.positions = p.portfolio.positions.filter(x => x.id !== '3');
  const r = merge({ base: b, hub: h, phone: p });
  assert.deepStrictEqual(r.merged.portfolio.positions.map(x => x.id).sort(), ['1', 'h', 'p']);
});
run('deleted on one side, edited on the other: kept and flagged', () => {
  const b = state(), h = clone(b), p = clone(b);
  h.portfolio.positions = h.portfolio.positions.filter(x => x.id !== '1');
  p.portfolio.positions[0].cost_basis = 99;
  const r = merge({ base: b, hub: h, phone: p });
  assert.strictEqual(find(r, '1').cost_basis, 99);
  assert.strictEqual(r.conflicts.length, 1);
});
run('partial sale on each device: both reductions and both sale records', () => {
  const b = state(), h = clone(b), p = clone(b);
  h.portfolio.positions[0].quantity = 70;
  h.portfolio.positions.push(pos('sold-h', { status: 'sold', quantity: 30 }));
  p.portfolio.positions[0].quantity = 80;
  p.portfolio.positions.push(pos('sold-p', { status: 'sold', quantity: 20 }));
  const r = merge({ base: b, hub: h, phone: p });
  assert.strictEqual(find(r, '1').quantity, 50);
  assert.ok(find(r, 'sold-h') && find(r, 'sold-p'));
  assert.strictEqual(r.conflicts.length, 0);
});
run('same position fully sold on both at different prices: flagged, not hidden', () => {
  const b = state(), h = clone(b), p = clone(b);
  Object.assign(h.portfolio.positions[0], { status: 'sold', sold_price: 11 });
  Object.assign(p.portfolio.positions[0], { status: 'sold', sold_price: 12 });
  const r = merge({ base: b, hub: h, phone: p });
  assert.strictEqual(find(r, '1').sold_price, 11);
  assert.ok(r.conflicts.some(c => c.field === 'sold_price' && c.other === 12));
});
run('same new id with different content: both kept', () => {
  const b = state(), h = clone(b), p = clone(b);
  h.portfolio.positions.push(pos('x', { item_name: 'A' }));
  p.portfolio.positions.push(pos('x', { item_name: 'B' }));
  const names = merge({ base: b, hub: h, phone: p }).merged.portfolio.positions.map(x => x.item_name);
  assert.ok(names.includes('A') && names.includes('B'));
});
run('tax: both sides add up, across a period rollover', () => {
  const b = state(), h = clone(b), p = clone(b);
  Object.assign(h.portfolio.tax_stats, { lifetime_tax: 1050, today_tax: 150 });
  Object.assign(p.portfolio.tax_stats, { lifetime_tax: 1020, today_tax: 120 });
  let t = merge({ base: b, hub: h, phone: p }).merged.portfolio.tax_stats;
  assert.strictEqual(t.lifetime_tax, 1070);
  assert.strictEqual(t.today_tax, 170);
  Object.assign(h.portfolio.tax_stats, { today_tax: 5, day_date: 'd2' });
  Object.assign(p.portfolio.tax_stats, { today_tax: 7, day_date: 'd2' });
  t = merge({ base: b, hub: h, phone: p }).merged.portfolio.tax_stats;
  assert.strictEqual(t.today_tax, 12);
});
run('goal history from both sides is kept', () => {
  const b = state(), h = clone(b), p = clone(b);
  h.portfolio.buy_goals[0].history.push({ t: 2, bought: 20 });
  p.portfolio.buy_goals[0].history.push({ t: 3, bought: 30 });
  assert.deepStrictEqual(merge({ base: b, hub: h, phone: p }).merged.portfolio.buy_goals[0].history.map(x => x.t), [1, 2, 3]);
});
run('lists: add and remove per item', () => {
  const b = state(), h = clone(b), p = clone(b);
  h.watchlist = [1, 2, 3, 4];
  p.watchlist = [2, 3, 5];
  assert.deepStrictEqual(merge({ base: b, hub: h, phone: p }).merged.watchlist, [2, 3, 4, 5]);
});
run('notes: edits merge, a real clash is flagged', () => {
  const b = state(), h = clone(b), p = clone(b);
  h.itemNotes.n = 'pc'; p.itemNotes.n = 'phone'; p.itemNotes.m = 'new';
  const r = merge({ base: b, hub: h, phone: p });
  assert.strictEqual(r.merged.itemNotes.n, 'pc');
  assert.strictEqual(r.merged.itemNotes.m, 'new');
  assert.strictEqual(r.conflicts[0].other, 'phone');
});
run('alerts: the latest firing wins without a conflict', () => {
  const b = state(), h = clone(b), p = clone(b);
  h.alerts[0].firedAt = 100; p.alerts[0].firedAt = 200;
  const r = merge({ base: b, hub: h, phone: p });
  assert.strictEqual(r.merged.alerts[0].firedAt, 200);
  assert.strictEqual(r.conflicts.length, 0);
});
run('DXP dates reach both sides, one row per event', () => {
  const b = state(), h = clone(b), p = clone(b);
  h.dxpEvents.unshift(['2026-09-24', '2026-11-06', '2026-11-16'], ['2026-11-02', '2026-11-06', '2026-11-16']);
  const e = merge({ base: b, hub: h, phone: p }).merged.dxpEvents;
  assert.deepStrictEqual(e.map(x => x[1]), ['2026-11-06', '2026-05-01']);
});
run('unreadable data throws instead of looking like deletion', () => {
  const b = state();
  assert.throws(() => merge({ base: b, hub: b, phone: { ...b, portfolio: null } }));
  assert.throws(() => merge({ base: b, hub: { ...b, alerts: null }, phone: b }));
});
run('wiped phone with an old base is flagged suspicious', () => {
  const b = state();
  b.portfolio.positions = Array.from({ length: 10 }, (_, i) => pos(String(i)));
  const p = clone(b); p.portfolio.positions = [];
  assert.strictEqual(merge({ base: b, hub: clone(b), phone: p }).suspicious, true);
});

const file = process.argv[2];
if (file) run('real portfolio: first sync and a no-op sync change nothing', () => {
  const real = { ...state(), portfolio: JSON.parse(fs.readFileSync(file, 'utf8')) };
  for (const base of [null, real]) {
    const r = merge({ base, hub: clone(real), phone: clone(real) });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(r.merged.portfolio)), JSON.parse(JSON.stringify(real.portfolio)));
    assert.strictEqual(r.conflicts.length, 0);
  }
  console.log(`    (${real.portfolio.positions.length} positions, ${real.portfolio.buy_goals.length} goals)`);
});
console.log('All sync merge tests passed');
