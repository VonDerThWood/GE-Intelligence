/**
 * Almanac buy and sell flags (Ben, 2026-11-04): turns the stored DXP patterns in
 * dxp_intelligence.json into "start selling now" / "start buying now" rows.
 *
 * Three patterns, each measured in days from a DXP's first day:
 *   sell       the item usually peaks around this day of DXP
 *   buy_pre    it usually bottoms this long before DXP, then rises into it
 *   buy_dip    it usually falls during DXP and bottoms around this day
 *   buy_post   it usually bottoms this long after DXP starts, once DXP has ended
 *
 * A row tells someone to act, so every item has to earn it. Holdings and watchlist
 * items get a slightly lower bar and rank first. Everything else has to pass the
 * full gates, since thousands of items are tested and some match by luck.
 * Pure: no fs or store, so it runs in Node tests and on the phone.
 */

const DAY = 86400000;
const TAX = 0.02;
const MIN_EVENTS = 7;      // same bar as the Almanac's own confidence scores
const MIN_RATE = 0.6;      // pattern held in at least this share of DXPs
const MIN_RATE_MINE = 0.5; // same, for items you hold or watch
const MIN_PEAK_PCT = 5;    // has to clear tax with room to spare
const MIN_DAILY_GP = 5e6;  // live gp traded per day, so a position can be built
const NOW_WINDOW = 2;      // days either side of the usual day
const ESTIMATE_WINDOW = 7; // wider when the DXP date is only an estimate
const SOON_DAYS = 30;
const OTHER_NOW_CAP = 15;  // "everything else" rows, strongest first
const OTHER_SOON_CAP = 15;

const toMs = s => Date.parse(s + 'T00:00:00Z');
const toDate = ms => new Date(ms).toISOString().slice(0, 10);
const median = arr => {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// One row per DXP start: a later announcement of the same DXP replaces the earlier.
function uniqueEvents(events) {
  const byStart = new Map();
  for (const e of events) {
    const had = byStart.get(e[1]);
    if (!had || e[0] > had[0]) byStart.set(e[1], e);
  }
  return [...byStart.values()].sort((a, b) => (a[1] < b[1] ? -1 : 1));
}

// Next DXP from the usual gap between recent ones. Only used until dates are announced.
function estimateNextStart(events, today) {
  const starts = events.map(e => toMs(e[1])).slice(-9);
  const gaps = starts.slice(1).map((s, i) => s - starts[i]);
  if (!gaps.length) return null;
  const gap = median(gaps);
  let next = starts[starts.length - 1] + gap;
  // Data that's behind (a phone missing a DXP) mustn't give a date in the past.
  while (next <= today) next += gap;
  return next;
}

// One flag per item, so nothing says sell and buy on the same day. Holdings lean
// toward selling. Rows must already be sorted with the preferred order for ties.
function onePerItem(rows) {
  const best = new Map();
  for (const r of rows) {
    const had = best.get(r.id);
    if (!had) { best.set(r.id, r); continue; }
    const score = x => (x.group === 'held' && x.action === 'sell' ? Infinity : x.strength);
    if (score(r) > score(had)) best.set(r.id, r);
  }
  return rows.filter(r => best.get(r.id) === r);
}

function rate(phases, names, side) {
  let hit = 0, total = 0;
  for (const n of names) {
    const p = phases && phases[n];
    if (!p) continue;
    hit += p[side] || 0;
    total += p.total || 0;
  }
  return { hit, total, rate: total ? hit / total : 0 };
}

const fmtPct = n => Math.round(n * 10) / 10;
const dxpDayText = offset => (offset >= 0 ? `day ${Math.round(offset) + 1} of DXP` : `${Math.abs(Math.round(offset))} days before DXP`);

// The patterns an item shows, whether or not their day has come.
function patternsFor(entry) {
  const t = entry.timing;
  if (!t || (t.n_events || 0) < MIN_EVENTS) return [];
  const out = [];
  const rises = rate(entry.phases, ['anticipation'], 'rise');
  const falls = rate(entry.phases, ['early_event', 'late_event'], 'drop');
  const after = rate(entry.phases, ['post_event'], 'drop');
  const peak = t.best_sell_pct_median;
  const riser = rises.rate >= MIN_RATE && peak >= MIN_PEAK_PCT;
  const riserMine = rises.rate >= MIN_RATE_MINE && peak >= MIN_PEAK_PCT;
  if (t.best_sell_day_offset != null) out.push({
    type: 'sell', action: 'sell', offset: t.best_sell_day_offset, strong: riser, mineOk: riserMine, strength: rises.rate * peak,
    evidence: `Usually peaks around ${dxpDayText(t.best_sell_day_offset)}, typically ${fmtPct(peak)}% up. Based on ${t.n_events} DXPs.`,
    peak,
  });
  if (t.pre_trough_offset_median != null && t.pre_trough_offset_median < 0) out.push({
    type: 'buy_pre', action: 'buy', offset: t.pre_trough_offset_median, strong: riser, mineOk: riserMine, strength: rises.rate * peak,
    evidence: `Usually bottoms ${Math.abs(Math.round(t.pre_trough_offset_median))} days before DXP. Rose into DXP in ${rises.hit} of ${rises.total}, typically peaking ${fmtPct(peak)}% up.`,
    peak,
  });
  if (t.best_buy_day_offset != null) {
    const deepDip = t.best_buy_pct_median <= -MIN_PEAK_PCT;
    out.push({
      type: 'buy_dip', action: 'buy', offset: t.best_buy_day_offset, strong: deepDip && falls.rate >= MIN_RATE, mineOk: deepDip && falls.rate >= MIN_RATE_MINE, strength: falls.rate * Math.abs(t.best_buy_pct_median),
      evidence: `Usually bottoms around ${dxpDayText(t.best_buy_day_offset)}, typically ${fmtPct(Math.abs(t.best_buy_pct_median))}% down. Fell during ${falls.hit} of ${falls.total} DXP stretches.`,
    });
  }
  if (t.post_trough_offset_median != null) out.push({
    type: 'buy_post', action: 'buy', offset: t.post_trough_offset_median, strong: riser && after.rate >= 0.5, mineOk: riserMine && after.rate >= 0.5, strength: after.rate * peak,
    evidence: `Usually bottoms after DXP ends. Fell afterward in ${after.hit} of ${after.total}, and typically peaks ${fmtPct(peak)}% up next time.`,
    peak,
  });
  return out;
}

/**
 * intel: dxp_intelligence.json  events: [announced, start, end]
 * items: latest.json items  holdings: [{name, quantity, cost}]  watched: ids
 * Returns { now: rows, soon: rows, nextDxp: {start, end, estimated} }
 */
function computeSignals({ intel, events, items, holdings = [], watched = [], today = Date.now() }) {
  const dayMs = Math.floor(today / DAY) * DAY;
  const list = uniqueEvents(events);
  const upcoming = list.filter(e => toMs(e[1]) > dayMs);
  const started = list.filter(e => toMs(e[1]) <= dayMs);
  const est = upcoming.length ? null : estimateNextStart(list, dayMs);
  const next = upcoming.length ? upcoming[0] : null;
  const nextStart = next ? toMs(next[1]) : est;
  const nextEstimated = !next;
  const last = started[started.length - 1] || null;

  const byId = new Map((items || []).map(i => [String(i.id), i]));
  const heldByName = new Map(holdings.map(h => [h.name.toLowerCase(), h]));
  const watchSet = new Set(watched.map(String));
  const now = [], soon = [];

  for (const [id, entry] of Object.entries(intel || {})) {
    if (id === '_meta' || !entry || !entry.name) continue;
    const item = byId.get(String(id));
    if (!item || item.untradeable) continue;
    const held = heldByName.get(String(entry.name).toLowerCase());
    const star = watchSet.has(String(id));
    const mine = !!held || star;
    const dailyGp = (item.liveUnits || 0) * (item.liveBuy || item.high || 0);

    for (const p of patternsFor(entry)) {
      if (!p.strong && !(mine && p.mineOk)) continue;
      if (!mine && dailyGp < MIN_DAILY_GP) continue;
      // Selling needs a known DXP. Buying ahead can use the estimate.
      const anchors = [];
      if (p.type === 'buy_pre') { if (nextStart) anchors.push({ start: nextStart, estimated: nextEstimated }); }
      else {
        if (last) anchors.push({ start: toMs(last[1]), end: toMs(last[2]), estimated: false });
        if (next) anchors.push({ start: toMs(next[1]), end: toMs(next[2]), estimated: false });
      }
      for (const a of anchors) {
        const day = a.start + p.offset * DAY;
        if (p.type === 'buy_post' && a.end && dayMs < a.end) continue; // only once DXP is over
        const reach = a.estimated ? ESTIMATE_WINDOW : NOW_WINDOW;
        const diff = Math.round((day - dayMs) / DAY);
        if (diff < -reach || diff > SOON_DAYS) continue;
        const row = {
          key: `${id}_${p.type}_${toDate(a.start)}`, id, name: entry.name, action: p.action, type: p.type,
          group: held ? 'held' : star ? 'watched' : 'other', star, strength: p.strength,
          evidence: p.evidence, day: toDate(day), inDays: diff, estimated: a.estimated, peak: p.peak || 0,
          liveBuy: item.liveBuy || null, liveSell: item.liveSell || null, guide: item.high || null,
        };
        if (held) {
          row.quantity = held.quantity;
          row.breakEven = held.cost ? Math.ceil(held.cost / (1 - TAX)) : null;
          if (p.action === 'sell' && row.breakEven && row.liveSell && row.liveSell < row.breakEven) row.belowBreakEven = true;
        }
        (diff <= reach ? now : soon).push(row);
        break;
      }
    }
  }

  const rank = { held: 0, watched: 1, other: 2 };
  const order = (a, b) => (a.action === b.action ? 0 : a.action === 'sell' ? -1 : 1) || rank[a.group] - rank[b.group] || b.strength - a.strength;
  const capOthers = (rows, cap) => {
    let others = 0;
    return rows.filter(r => r.group !== 'other' || ++others <= cap);
  };
  const nowRows = onePerItem(now.sort(order));
  const flaggedNow = new Set(nowRows.map(r => r.id));
  // Coming up: each item's next step only, and nothing already flagged above.
  const soonRows = [];
  const soonSeen = new Set();
  for (const r of soon.sort((a, b) => rank[a.group] - rank[b.group] || a.inDays - b.inDays || b.strength - a.strength)) {
    if (flaggedNow.has(r.id) || soonSeen.has(r.id)) continue;
    soonSeen.add(r.id);
    soonRows.push(r);
  }
  return {
    now: capOthers(nowRows, OTHER_NOW_CAP),
    soon: capOthers(soonRows, OTHER_SOON_CAP),
    nextDxp: nextStart ? { start: toDate(nextStart), end: next ? next[2] : null, estimated: nextEstimated } : null,
    lastDxp: last ? { start: last[1], end: last[2] } : null,
  };
}

// New "act now" rows become one digest notification, your own items named first.
function buildDigest(rows) {
  if (!rows.length) return null;
  const sells = rows.filter(r => r.action === 'sell');
  const buys = rows.filter(r => r.action === 'buy');
  const names = list => {
    const shown = list.slice(0, 3).map(r => r.name);
    return shown.join(', ') + (list.length > 3 ? `, and ${list.length - 3} more` : '');
  };
  const title = 'Almanac: ' + [sells.length && `${sells.length} to sell now`, buys.length && `${buys.length} to buy now`].filter(Boolean).join(', ');
  const body = [sells.length && `Sell now: ${names(sells)}`, buys.length && `Buy now: ${names(buys)}`].filter(Boolean).join('\n');
  return { title, body };
}

module.exports = { computeSignals, buildDigest, uniqueEvents, estimateNextStart };
