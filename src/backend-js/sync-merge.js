/**
 * sync-merge.js: merges two devices' user data for phone <-> PC sync.
 *
 * Three-way: compares each side against `base`, the state both had at their
 * last sync. A change on one side is simply taken, so nothing needs timestamps
 * or delete markers, and existing writes don't have to change. Only a field
 * changed differently on both sides is a real conflict: the hub's (PC's) value
 * stays and the other value is reported in `conflicts`, never silently lost.
 *
 * Pure functions, no storage or network, so it can be tested on its own.
 *
 * merge({ base, hub, phone }) -> { merged, conflicts, suspicious }
 * State: { portfolio: { positions, buy_goals, tax_stats }, alerts, reminders,
 *   watchlist, hiddenItems, dxpWatchlist, itemNotes, userShorthands, dxpEvents }
 */

function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return v === undefined ? 'undefined' : JSON.stringify(v);
}
const same = (a, b) => stable(a) === stable(b);

// Fields where both sides' changes can be combined rather than conflicting.
const FIELD_RULES = {
  // Both devices sold part of a position: both reductions happened.
  quantity(baseV, hubV, phoneV, hubRec, phoneRec) {
    if (typeof baseV !== 'number' || hubRec.status !== 'open' || phoneRec.status !== 'open') return undefined;
    return Math.max(0, baseV + (hubV - baseV) + (phoneV - baseV));
  },
  firedAt: (_, hubV, phoneV) => Math.max(hubV || 0, phoneV || 0) || null,
  // Buy goal update snapshots: keep every one from both sides.
  history(_, hubV, phoneV) {
    if (!Array.isArray(hubV) || !Array.isArray(phoneV)) return undefined;
    const byT = new Map([...hubV, ...phoneV].map(h => [h.t, h]));
    return [...byT.values()].sort((x, y) => x.t - y.t);
  },
};

function mergeRecord(kind, base, hub, phone, conflicts) {
  const out = {};
  for (const key of new Set([...Object.keys(hub), ...Object.keys(phone), ...Object.keys(base)])) {
    const b = base[key], h = hub[key], p = phone[key];
    let v;
    if (same(h, p) || same(p, b)) v = h;
    else if (same(h, b)) v = p;
    else {
      const rule = FIELD_RULES[key] && FIELD_RULES[key](b, h, p, hub, phone);
      if (rule !== undefined) v = rule;
      else {
        v = h;
        conflicts.push({ kind, id: hub.id, name: hub.item_name || null, field: key, kept: h ?? null, other: p ?? null });
      }
    }
    if (v !== undefined) out[key] = v;
  }
  return out;
}

// Lists of records with an id: positions, goals, alerts, reminders.
function mergeRecords(kind, baseList, hubList, phoneList, conflicts) {
  const index = list => new Map((list || []).map(r => [String(r.id), r]));
  const base = index(baseList), hub = index(hubList), phone = index(phoneList);
  const out = [];
  for (const [id, h] of hub) {
    const p = phone.get(id), b = base.get(id);
    if (p && b) out.push(mergeRecord(kind, b, h, p, conflicts));
    else if (p) {
      // New on both sides with one id. Ids are Date.now(), so if they differ
      // these are separate records that collided: keep both.
      out.push(h);
      if (!same(h, p)) out.push({ ...p, id: `${id}_p` });
    } else if (!b) out.push(h); // new on the hub
    else if (!same(h, b)) {
      // Phone deleted it, hub changed it: keep it rather than lose the edit.
      out.push(h);
      conflicts.push({ kind, id, name: h.item_name || null, field: 'deleted on phone', kept: 'kept', other: 'deleted' });
    } // else: hub unchanged, phone deleted it
  }
  for (const [id, p] of phone) {
    if (hub.has(id)) continue;
    const b = base.get(id);
    if (!b) out.push(p); // new on the phone
    else if (!same(p, b)) {
      out.push(p);
      conflicts.push({ kind, id, name: p.item_name || null, field: 'deleted on PC', kept: 'kept', other: 'deleted' });
    } // else: phone unchanged, hub deleted it
  }
  return out;
}

// Plain lists: hub order first, then whatever the phone added.
function mergeSet(baseList, hubList, phoneList) {
  const base = new Set((baseList || []).map(String));
  const hub = hubList || [], phone = phoneList || [];
  const hubKeys = new Set(hub.map(String)), phoneKeys = new Set(phone.map(String));
  const kept = hub.filter(x => phoneKeys.has(String(x)) || !base.has(String(x)));
  const added = phone.filter(x => !hubKeys.has(String(x)) && !base.has(String(x)));
  return [...kept, ...added];
}

function mergeMap(kind, base = {}, hub = {}, phone = {}, conflicts) {
  const out = {};
  for (const key of new Set([...Object.keys(hub), ...Object.keys(phone)])) {
    const b = base[key], h = hub[key], p = phone[key];
    let v;
    if (same(h, p) || same(p, b)) v = h;
    else if (same(h, b)) v = p;
    else { v = h; conflicts.push({ kind, id: key, name: key, field: 'value', kept: h ?? null, other: p ?? null }); }
    if (v !== undefined) out[key] = v;
  }
  return out;
}

// Running totals: add what each side added since the last sync. Copying
// either side's total would lose the other's sales.
function mergeTax(base, hub, phone) {
  if (!hub) return phone || null;
  if (!phone) return hub;
  if (same(hub, phone)) return hub; // with no base, adding these would double them
  const b = base || {};
  const out = { ...hub, lifetime_tax: Math.max(0, (b.lifetime_tax || 0) + ((hub.lifetime_tax || 0) - (b.lifetime_tax || 0)) + ((phone.lifetime_tax || 0) - (b.lifetime_tax || 0))) };
  for (const [total, date] of [['today_tax', 'day_date'], ['week_tax', 'week_date'], ['month_tax', 'month_date']]) {
    if (hub[date] !== phone[date]) {
      // One side hasn't rolled into the new period yet: the newer one is right.
      const newer = (hub[date] || '') > (phone[date] || '') ? hub : phone;
      out[total] = newer[total] || 0; out[date] = newer[date];
    } else {
      const start = b[date] === hub[date] ? (b[total] || 0) : 0;
      out[total] = Math.max(0, start + ((hub[total] || 0) - start) + ((phone[total] || 0) - start));
      out[date] = hub[date];
    }
  }
  return out;
}

// DXP dates only get added. One row per event start date; a confirmed date
// found on either device reaches both.
function mergeEvents(hub, phone) {
  const byStart = new Map();
  for (const row of [...(hub || []), ...(phone || [])]) if (!byStart.has(row[1])) byStart.set(row[1], row);
  return [...byStart.values()].sort((x, y) => (x[1] < y[1] ? 1 : -1));
}

function merge({ base, hub, phone }) {
  // A failed read must never look like "the user deleted everything".
  for (const [name, s] of [['hub', hub], ['phone', phone]]) {
    if (!s || !s.portfolio || !Array.isArray(s.portfolio.positions) || !Array.isArray(s.alerts)) throw new Error(`Sync: ${name} data is missing or unreadable`);
  }
  const b = base || {};
  const conflicts = [];
  const bp = b.portfolio || {}, hp = hub.portfolio, pp = phone.portfolio;
  const merged = {
    portfolio: {
      ...hp,
      positions: mergeRecords('position', bp.positions, hp.positions, pp.positions, conflicts),
      buy_goals: mergeRecords('goal', bp.buy_goals, hp.buy_goals, pp.buy_goals, conflicts),
      tax_stats: mergeTax(bp.tax_stats, hp.tax_stats, pp.tax_stats),
    },
    alerts: mergeRecords('alert', b.alerts, hub.alerts, phone.alerts, conflicts),
    reminders: mergeRecords('reminder', b.reminders, hub.reminders, phone.reminders, conflicts),
    watchlist: mergeSet(b.watchlist, hub.watchlist, phone.watchlist),
    hiddenItems: mergeSet(b.hiddenItems, hub.hiddenItems, phone.hiddenItems),
    dxpWatchlist: mergeSet(b.dxpWatchlist, hub.dxpWatchlist, phone.dxpWatchlist),
    itemNotes: mergeMap('note', b.itemNotes, hub.itemNotes, phone.itemNotes, conflicts),
    userShorthands: mergeMap('shorthand', b.userShorthands, hub.userShorthands, phone.userShorthands, conflicts),
    dxpEvents: mergeEvents(hub.dxpEvents, phone.dxpEvents),
  };
  // Losing much of a portfolio in one sync is far more likely a bug or a wiped
  // device than a real choice: the caller stops and asks instead of saving.
  const before = Math.max(hp.positions.length, pp.positions.length);
  const suspicious = before >= 5 && merged.portfolio.positions.length < before / 2;
  return { merged, conflicts, suspicious };
}

module.exports = { merge };
