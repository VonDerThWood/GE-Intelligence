// Tests for src/backend-js/update-risks.js. Run: node scripts/test-update-risks.js
const assert = require('assert');
const { findRisks, buildNotifications } = require('../src/backend-js/update-risks.js');

const now = Date.parse('2026-11-03T12:00:00Z');
const frames = { name: 'Magic frame', quantity: 93354, value: 4e9 };
const whips = { name: 'Abyssal whip', quantity: 26, value: 2e6 };
const known = { id: 'u', title: 'Rebalance', when: 'late Nov', until: '2026-12-15', url: 'https://x/u', items: [{ name: 'Abyssal whip', effect: 'Stat increase.' }] };
const post = (over = {}) => ({ title: 'Big Design Preview', date: '2026-10-20', url: 'https://x/p', lines: ['New frames are coming.', 'Magic frames will change a lot.'], ...over });
const run = (name, fn) => { fn(); console.log(`ok  ${name}`); };

run('known update flags a held item with its exact effect', () => {
  const [r] = findRisks({ updates: [known], holdings: [whips], now });
  assert.strictEqual(r.kind, 'known');
  assert.strictEqual(r.effect, 'Stat increase.');
  assert.strictEqual(r.value, 2e6);
});
run('forward-looking post mentioning a held item is flagged, plural too', () => {
  const [r] = findRisks({ posts: [post()], holdings: [frames], now });
  assert.strictEqual(r.kind, 'mention');
  assert.ok(r.effect.includes('Magic frames'));
});
run('patch notes and old posts are ignored', () => {
  assert.strictEqual(findRisks({ posts: [post({ title: 'Patch Notes: Oct 20' })], holdings: [frames], now }).length, 0);
  assert.strictEqual(findRisks({ posts: [post({ date: '2026-06-01' })], holdings: [frames], now }).length, 0);
});
run('no false match inside another word, or on very short names', () => {
  const lines = ['The magic framework is new.', 'A log fell.'];
  assert.strictEqual(findRisks({ posts: [post({ lines })], holdings: [frames, { name: 'Log', quantity: 1, value: 5 }], now }).length, 0);
});
run('an exact effect beats a mention from the same post', () => {
  const p = post({ url: known.url, lines: ['Abyssal whip gets changed.'] });
  const r = findRisks({ updates: [known], posts: [p], holdings: [whips], now });
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].kind, 'known');
});
run('an update past its date stops flagging', () => {
  assert.strictEqual(findRisks({ updates: [{ ...known, until: '2026-11-01' }], holdings: [whips], now }).length, 0);
});
run('several positions in one item add up', () => {
  const [r] = findRisks({ updates: [known], holdings: [whips, whips], now });
  assert.strictEqual(r.quantity, 52);
});
run('biggest exposure first, watched items included at zero', () => {
  const r = findRisks({ posts: [post({ lines: ['Magic frame and Abyssal whip and Yew frame.'] })], holdings: [whips, frames], watched: ['Yew frame'], now });
  assert.deepStrictEqual(r.map(x => x.itemName), ['Magic frame', 'Abyssal whip', 'Yew frame']);
});
run('dismissed items stay quiet', () => {
  assert.strictEqual(findRisks({ updates: [known], holdings: [whips], dismissed: ['u|abyssal whip'], now }).length, 0);
});
run('notifies once per update, large holdings only', () => {
  const r = findRisks({ updates: [known], posts: [post()], holdings: [whips, frames, { name: 'Dark bow', quantity: 1, value: 5 }], now });
  const n = buildNotifications(r, []);
  assert.strictEqual(n.length, 2);
  assert.ok(n.some(x => x.body.includes('Magic frame')));
  assert.strictEqual(buildNotifications(r, n.flatMap(x => x.keys)).length, 0);
  const small = findRisks({ updates: [known], holdings: [{ ...whips, value: 5 }], now });
  assert.strictEqual(buildNotifications(small, []).length, 0);
});
run('watched items notify and say so, unless switched off', () => {
  const r = findRisks({ updates: [known], holdings: [], watched: ['Abyssal whip'], now });
  const [n] = buildNotifications(r, []);
  assert.ok(n.body.includes('Watchlist: Abyssal whip'));
  assert.strictEqual(buildNotifications(r, [], { includeWatched: false }).length, 0);
  const held = findRisks({ updates: [known], holdings: [whips], watched: ['Abyssal whip'], now });
  assert.ok(buildNotifications(held, [], { includeWatched: false })[0].body.includes('Portfolio: Abyssal whip'));
});
run('known effects list untracked items last, and they never notify', () => {
  const u = { ...known, items: [{ name: 'Draconic visage', effect: 'More common.' }, { name: 'Abyssal whip', effect: 'Stat increase.' }, { name: 'Dark bow', effect: 'Buff.' }] };
  const r = findRisks({ updates: [u], holdings: [whips], watched: ['Dark bow'], now });
  assert.deepStrictEqual(r.map(x => x.group), ['held', 'watched', 'other']);
  const [n] = buildNotifications(r, []);
  assert.ok(n.body.includes('Portfolio: Abyssal whip') && n.body.includes('Watchlist: Dark bow') && !n.body.includes('Draconic'));
  const onlyOther = findRisks({ updates: [u], now });
  assert.strictEqual(buildNotifications(onlyOther, []).length, 0);
});
run('long lists are shortened in the notification', () => {
  const names = ['Aaaaa', 'Bbbbb', 'Ccccc', 'Ddddd', 'Eeeee'];
  const u = { ...known, items: names.map(name => ({ name, effect: 'x' })) };
  const [n] = buildNotifications(findRisks({ updates: [u], watched: names, now }), []);
  assert.ok(n.body.includes('+2 more'));
});
const rework = (over = {}) => post({ title: 'Player-Owned House Rework & 120 Construction', url: 'https://x/c', lines: ['Build a bigger house.'], ...over });
run('a post about a skill flags its materials without naming them', () => {
  const [r] = findRisks({ posts: [rework()], holdings: [frames], now });
  assert.strictEqual(r.kind, 'related');
  assert.ok(r.effect.includes('Construction'));
  assert.strictEqual(buildNotifications([r], []).length, 1);
});
run('a passing mention of a skill is not enough, three are', () => {
  const p = t => post({ title: 'Combat Design Preview', url: 'https://x/d', lines: [t] });
  assert.strictEqual(findRisks({ posts: [p('Also some Construction tweaks.')], holdings: [frames], now }).length, 0);
  assert.strictEqual(findRisks({ posts: [p('Construction. Construction. More Construction.')], holdings: [frames], now }).length, 1);
});
run('a named mention beats a related flag; unrelated items stay out', () => {
  const r = findRisks({ posts: [rework({ lines: ['Magic frames change.'] })], holdings: [frames, { name: 'Soul rune', quantity: 1, value: 1e7 }], now });
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].kind, 'mention');
});
run('related items you only watch are listed but do not notify', () => {
  const r = findRisks({ posts: [rework()], watched: ['Magic frame'], now });
  assert.strictEqual(r.length, 1);
  assert.strictEqual(buildNotifications(r, []).length, 0);
});
run('named items come first, and the catalogue adds ones you do not track', () => {
  const p = post({ title: 'Construction Design Preview', url: 'https://x/n', lines: ['The Memory dowser and Abyssal whip change.', 'A Spring appeared.'] });
  const r = findRisks({ posts: [p], holdings: [frames, whips], catalogue: ['Memory dowser', 'Spring', 'Runic attuner', 'Abyssal whip'], now });
  assert.deepStrictEqual(r.map(x => x.itemName + ':' + x.kind), ['Abyssal whip:mention', 'Magic frame:related', 'Memory dowser:mention']);
  assert.strictEqual(buildNotifications(r.filter(x => x.group === 'other'), []).length, 0);
});
console.log('All update risk tests passed');
