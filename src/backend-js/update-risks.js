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
const FORWARD_TITLE = /\b(preview|rebalance|rework|remaster(ed)?|level increase|1[1-9]0|week ahead|design|roadmap|beta|coming|future|upcoming|dev ?blog|sneak|consultation|proposal|plans?)\b/i;
const POST_MAX_AGE_DAYS = 60;
const MIN_NAME_LENGTH = 5;
const MIN_NOTIFY_GP = 1000000;
const SNIPPET_LENGTH = 180;
const NOTIFY_NAMES_PER_GROUP = 3;
const GROUP_ORDER = { held: 0, watched: 1, other: 2 };

// Items tied to a skill, so a post about the skill flags them without naming
// them (Ben, 2026-11-03: a Construction post should have flagged his magic
// frames). A passing mention doesn't count: the skill must be in the post's
// title, or named at least RELATED_MIN_MENTIONS times.
const RELATED_MIN_MENTIONS = 3;
const SKILL_ITEMS = {
  Construction: /\b(frame|plank|nail|limestone brick|marble block|bolt of cloth)s?$/i,
  Smithing: /\b(bar|ore)s?$/i,
  Mining: /\b(ore|stone spirit)s?$/i,
  Woodcutting: /\blogs?$/i,
  Fletching: /\b(bolts?|arrows?|arrowheads?|bolt tips?|dart tips?|headless shaft|arrow shaft|\(unstrung\))( \(e\)| \(unf\))?$/i,
  Crafting: /\b(dragonhide|leather|cut \w+|uncut \w+)$/i,
  Herblore: /\b(potion|flask|herb|vial)s?\b|^(grimy|clean) /i,
  Farming: /\bseeds?$/i,
  Fishing: /^raw /i,
  Cooking: /^raw /i,
  Prayer: /\b(bones|ashes)$/i,
  Summoning: /\b(pouch|charm)e?s?$|^spirit shards?$/i,
  Runecrafting: /\brunes?$|^(pure|rune) essence$/i,
  Divination: /\benergy$/i,
  Necromancy: /\b(ink|necroplasm)$/i,
  Archaeology: /\b(artefact|soil)s?$/i,
};
function skillsDiscussed(post) {
  const title = post.title || '', text = (post.lines || []).join(' ');
  return Object.keys(SKILL_ITEMS).filter(skill => {
    const re = new RegExp('\\b' + skill + '\\b', 'gi');
    return re.test(title) || (text.match(re) || []).length >= RELATED_MIN_MENTIONS;
  });
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nameRegex = name => new RegExp(`\\b${escapeRe(name)}s?\\b`, 'i');
const isForwardPost = post => FORWARD_TITLE.test(post.title || '');

function daysOld(date, now) {
  return (now - Date.parse(date)) / 86400000;
}

// holdings: [{ name, quantity, value }] from open positions. watched: names.
// catalogue: every item name. Names of 2+ words found in a post are listed even
// if you don't hold or watch them; one-word names are too often ordinary words.
function findRisks({ updates = [], posts = [], holdings = [], watched = [], catalogue = [], dismissed = [], now = Date.now() }) {
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
    const watchedItem = watchedNames.has(item.name.toLowerCase());
    risks.push({ key, kind, updateId: source.id, updateTitle: source.title, when: source.when, url: source.url,
      itemName: item.name, quantity: item.quantity, value: item.value, watched: watchedItem,
      group: item.quantity > 0 ? 'held' : watchedItem ? 'watched' : 'other', effect });
  };

  for (const u of updates) {
    if (u.until && new Date(now).toISOString().slice(0, 10) > u.until) continue;
    for (const entry of u.items || []) {
      // Hand-kept entries are exact, so they're listed even for items you
      // don't hold or watch ("Everything else" on the panel).
      const item = tracked.get(entry.name.toLowerCase()) || { name: entry.name, quantity: 0, value: 0 };
      add(u, item, entry.effect, 'known');
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
    const lowerText = lines.join('\n').toLowerCase();
    for (const name of catalogue) {
      if (tracked.has(name.toLowerCase()) || !name.includes(' ') || !lowerText.includes(name.toLowerCase())) continue;
      const re = nameRegex(name);
      const line = lines.find(l => re.test(l));
      if (line) add(source, { name, quantity: 0, value: 0 }, line.trim().slice(0, SNIPPET_LENGTH), 'mention');
    }
    // After exact effects and name mentions, so those always win.
    for (const skill of skillsDiscussed(post)) {
      for (const item of tracked.values()) {
        if (SKILL_ITEMS[skill].test(item.name)) add(source, item, `Related to ${skill}, which this post discusses. The item itself isn't named.`, 'related');
      }
    }
  }
  // Holdings, then watched, then the rest. Within each, items a post actually
  // names come before merely related ones (Ben, 2026-11-03), biggest exposure first.
  const named = r => (r.kind === 'related' ? 1 : 0);
  return risks.sort((a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group] || named(a) - named(b) || b.value - a.value || a.itemName.localeCompare(b.itemName));
}

// One notification per update, listing what's newly exposed. `notified` is the
// list of keys already told about. Holdings of some size always notify; watched
// items (Ben, 2026-11-02: he may be about to trade them) unless switched off.
// A merely related watched item stays quiet: there can be a lot of those.
function buildNotifications(risks, notified, { includeWatched = true } = {}) {
  const fresh = risks.filter(r => (r.value >= MIN_NOTIFY_GP || (includeWatched && r.watched && r.kind !== 'related')) && !notified.includes(r.key));
  const byUpdate = new Map();
  for (const r of fresh) byUpdate.set(r.updateId, [...(byUpdate.get(r.updateId) || []), r]);
  return [...byUpdate.values()].map(list => {
    const names = (label, group) => {
      const items = list.filter(r => r.group === group).map(r => r.itemName);
      if (!items.length) return null;
      const extra = items.length - NOTIFY_NAMES_PER_GROUP;
      return `${label}: ${items.slice(0, NOTIFY_NAMES_PER_GROUP).join(', ')}${extra > 0 ? ` +${extra} more` : ''}`;
    };
    const when = list[0].when ? ` (${list[0].when})` : '';
    return { keys: list.map(r => r.key), title: '⚠️ Upcoming update may affect these items',
      body: [`${list[0].updateTitle}${when}`, names('Portfolio', 'held'), names('Watchlist', 'watched')].filter(Boolean).join('\n') };
  });
}

module.exports = { findRisks, buildNotifications, isForwardPost, skillsDiscussed };
