// Tests for src/backend-js/update-risks.js. Run: node scripts/test-update-risks.js
const assert = require('assert');
const { findRisks, buildNotifications } = require('../src/backend-js/update-risks.js');

const now = Date.parse('2026-11-03T12:00:00Z');
const frames = { name: 'Magic frame', quantity: 93354, value: 4e9 };
const whips = { name: 'Abyssal whip', quantity: 26, value: 2e6 };
const known = { id: 'u', title: 'Rebalance', when: 'late Nov', until: '2026-12-15', url: 'https://x/u', items: [{ name: 'Abyssal whip', effect: 'Stat increase.' }] };
const post = (over = {}) => ({ title: 'Construction Design Preview', date: '2026-10-20', url: 'https://x/p', lines: ['New frames are coming.', 'Magic frames will change a lot.'], ...over });
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
console.log('All update risk tests passed');
