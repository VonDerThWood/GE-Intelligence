/**
 * update-risks.js: warns when an upcoming game update could affect something
 * Ben holds or watches, while there's still time to act (Ben, 2026-11-02: he
 * almost sold 93k magic frames before the 120 Construction release).
 *
 * Risk information only: says what's changing and how much gp is exposed,
 * never whether to buy or sell. Two sources:
 *   - data/upcoming_updates.json: hand-written entries with exact item effects
 *   - forward-looking news posts (previews, dev blogs...), searched for the
 *     names of items you hold or watch. A mention may mean little, so these
 *     are labelled as mentions.
 */

// Titles that talk about what's coming. Patch notes and weekly posts mostly
// describe things already live, so they'd only add noise.
const FORWARD_TITLE = /\b(preview|rebalance|design|roadmap|beta|coming|future|upcoming|dev ?blog|sneak|consultation|proposal|plans?)\b/i;
const POST_MAX_AGE_DAYS = 60;
const MIN_NAME_LENGTH = 5;
const MIN_NOTIFY_GP = 1000000;
const SNIPPET_LENGTH = 180;

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nameRegex = name => new RegExp(`\\b${escapeRe(name)}s?\\b`, 'i');
const isForwardPost = post => FORWARD_TITLE.test(post.title || '');

function daysOld(date, now) {
  return (now - Date.parse(date)) / 86400000;
}

// holdings: [{ name, quantity, value }] from open positions. watched: names.
function findRisks({ updates = [], posts = [], holdings = [], watched = [], dismissed = [], now = Date.now() }) {
  const risks = [];
  const heldByName = new Map();
  for (const h of holdings) {
    const k = h.name.toLowerCase();
    const old = heldByName.get(k) || { name: h.name, quantity: 0, value: 0 };
    heldByName.set(k, { name: old.name, quantity: old.quantity + h.quantity, value: old.value + h.value });
  }
  const tracked = new Map(heldByName);
  const watchedNames = new Set(watched.map(n => n.toLowerCase()));
  for (const name of watched) if (!tracked.has(name.toLowerCase())) tracked.set(name.toLowerCase(), { name, quantity: 0, value: 0 });

  const seen = new Set();
  const add = (source, item, effect, kind) => {
    const key = `${source.id}|${item.name.toLowerCase()}`;
    if (seen.has(key) || dismissed.includes(key)) return;
    seen.add(key);
    risks.push({ key, kind, updateId: source.id, updateTitle: source.title, when: source.when, url: source.url,
      itemName: item.name, quantity: item.quantity, value: item.value, watched: watchedNames.has(item.name.toLowerCase()), effect });
  };

  for (const u of updates) {
    if (u.until && new Date(now).toISOString().slice(0, 10) > u.until) continue;
    for (const entry of u.items || []) {
      const item = tracked.get(entry.name.toLowerCase());
      if (item) add(u, item, entry.effect, 'known');
    }
  }
  // Known entries come first, so a mention never replaces an exact effect
  // from the same update (their posts share an id via `url`).
  const knownUrls = new Map(updates.filter(u => u.url).map(u => [u.url, u]));
  for (const post of posts) {
    if (!isForwardPost(post) || daysOld(post.date, now) > POST_MAX_AGE_DAYS) continue;
    const source = knownUrls.get(post.url) || { id: post.url, title: post.title, when: null, url: post.url };
    const lines = post.lines || [];
    for (const item of tracked.values()) {
      if (item.name.length < MIN_NAME_LENGTH) continue;
      const re = nameRegex(item.name);
      const line = lines.find(l => re.test(l));
      if (line) add(source, item, line.trim().slice(0, SNIPPET_LENGTH), 'mention');
    }
  }
  // Biggest exposure first; held before merely watched.
  return risks.sort((a, b) => b.value - a.value || a.itemName.localeCompare(b.itemName));
}

// One notification per update, listing what's newly exposed. `notified` is the
// list of keys already told about. Holdings of some size always notify; watched
// items (Ben, 2026-11-02: he may be about to trade them) unless switched off.
function buildNotifications(risks, notified, { includeWatched = true } = {}) {
  const fresh = risks.filter(r => (r.value >= MIN_NOTIFY_GP || (includeWatched && r.watched)) && !notified.includes(r.key));
  const byUpdate = new Map();
  for (const r of fresh) byUpdate.set(r.updateId, [...(byUpdate.get(r.updateId) || []), r]);
  return [...byUpdate.values()].map(list => {
    const top = list.slice(0, 3).map(r => `${r.itemName} (${r.quantity ? 'held' : 'watching'})`).join(', ');
    const more = list.length > 3 ? ` and ${list.length - 3} more` : '';
    const when = list[0].when ? ` (${list[0].when})` : '';
    return { keys: list.map(r => r.key), title: '⚠️ Upcoming update affects your holdings',
      body: `${list[0].updateTitle}${when} may affect ${top}${more}. See Portfolio for details.` };
  });
}

module.exports = { findRisks, buildNotifications, isForwardPost };
