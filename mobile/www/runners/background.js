/**
 * @capacitor/background-runner script — executes via Android WorkManager
 * (and iOS BGTaskScheduler) on a periodic schedule even when GEnius isn't
 * open, without a foreground service or persistent notification (the
 * battery-drain tradeoff the user explicitly ruled out). This runs in a
 * separate, restricted JS context: no require(), no DOM, no Filesystem
 * plugin — only fetch, CapacitorKV (its own small string KV store,
 * unrelated to the main app's Preferences-backed store), CapacitorNotifications,
 * setTimeout/setInterval, and a couple of device APIs.
 *
 * Because of that, it can't call into api.js/storage-capacitor.js directly.
 * Instead: the main app (bridge.js) pushes the small slice of state this
 * needs — watchlist/dxpWatchlist item id+name pairs, precomputed DXP timing
 * stats, notification settings, reminders, dxp_events.json — into this
 * runner's CapacitorKV via a 'syncState' event every time that state
 * changes. This runner then fetches LIVE prices itself on every tick (the
 * same WeirdGloop dump run.js uses) so notifications never go stale just
 * because the app hasn't been opened — and maintains its own rolling
 * per-item price log in CapacitorKV (since it has no access to the app's
 * real price history files) to support the watchlist's 1-day/7-day %
 * change digest.
 */

const DUMP_URL = 'https://chisel.weirdgloop.org/gazproj/gazbot/rs_dump.json';
const PRICE_LOG_MAX_AGE_MS = 8 * 86400000;

const DXP_SEASON_ANCHORS = [
  { label: 'Winter/February', month: 1, day: 2, wide: true },
  { label: 'Spring/May', month: 3, day: 25, wide: false },
  { label: 'Summer/August', month: 6, day: 8, wide: true },
  { label: 'Autumn/November', month: 9, day: 27, wide: false },
];

// CapacitorKV.get returns null (not {value: null}) for a key that was never
// set, so reading .value straight off it crashed the whole check on its
// first run (Ben's phone, 2026-10-15: "TypeError: cannot read property
// 'value' of null" from rb_portfolioDigestLastSent).
function kvGet(key) {
  const r = CapacitorKV.get(key);
  return r && r.value != null ? r.value : null;
}

// Quiet hours window {enabled, start:'HH:MM', end:'HH:MM', tzOffsetMin}.
// Local time comes from the offset the app synced (this engine's own time
// zone handling isn't trusted), from Date.now() which is always UTC-based.
// A window that crosses midnight (21:00-07:00) is handled.
function inQuietHours(q) {
  if (!q || !q.enabled || !q.start || !q.end) return false;
  const toMin = t => { const [h, m] = String(t).split(':').map(Number); return (h * 60 + (m || 0)) % 1440; };
  const utcMin = Math.floor(Date.now() / 60000) % 1440;
  const now = (utcMin - (q.tzOffsetMin || 0) + 1440 * 2) % 1440;
  const s = toMin(q.start), e = toMin(q.end);
  if (s === e) return false;
  return s < e ? (now >= s && now < e) : (now >= s || now < e);
}

function getJSON(key, fallback) {
  const r = CapacitorKV.get(key);
  if (!r || r.value == null) return fallback;
  try { return JSON.parse(r.value); } catch { return fallback; }
}
function setJSON(key, value) {
  CapacitorKV.set(key, JSON.stringify(value));
}

addEventListener('syncState', (resolve, reject, args) => {
  try {
    const d = args || {};
    if (d.watchlist) setJSON('rb_watchlist', d.watchlist);
    if (d.dxpEvents) setJSON('rb_dxpEvents', d.dxpEvents);
    if (d.dxpSettings) setJSON('rb_dxpSettings', d.dxpSettings);
    if (d.watchlistSettings) setJSON('rb_watchlistSettings', d.watchlistSettings);
    if (d.portfolioPositions) setJSON('rb_portfolioPositions', d.portfolioPositions);
    if (d.portfolioSettings) setJSON('rb_portfolioSettings', d.portfolioSettings);
    if (d.reminders) setJSON('rb_reminders', d.reminders);
    if (d.quietHours) setJSON('rb_quietHours', d.quietHours);
    if (d.almanacRows) setJSON('rb_almanacRows', d.almanacRows);
    // Merged, so a flag sent here but not yet collected by the app isn't sent again.
    if (d.almanacSeen) setJSON('rb_almanacSeen', { ...getJSON('rb_almanacSeen', {}), ...d.almanacSeen });
    if (d.alerts) {
      setJSON('rb_alerts', d.alerts);
      // The app is the authority on which alerts are already hit (it may
      // have notified while open), so its state replaces this runner's.
      const active = {};
      for (const a of d.alerts) if (a.id != null) active[String(a.id)] = !!a.active;
      setJSON('rb_alertActive', active);
    }
    if (typeof d.notificationsEnabled === 'boolean') CapacitorKV.set('rb_notifEnabled', String(d.notificationsEnabled));
    resolve();
  } catch (err) {
    reject(err);
  }
});

// The app collects (and clears) alerts the background already notified
// about, so it marks them fired instead of notifying a second time.
addEventListener('getStatus', (resolve, reject) => {
  try { resolve({ lastRunAt: parseInt(kvGet('rb_lastRunAt') || '0', 10) || null }); }
  catch (err) { reject(err); }
});

addEventListener('collectFiredAlerts', (resolve, reject) => {
  try {
    const fired = getJSON('rb_alertFired', []);
    setJSON('rb_alertFired', []);
    resolve({ fired });
  } catch (err) {
    reject(err);
  }
});

// Everything notified here, handed to the app's Inbox the next time it asks.
addEventListener('collectInbox', (resolve, reject) => {
  try {
    const entries = getJSON('rb_inboxPending', []);
    setJSON('rb_inboxPending', []);
    resolve({ entries });
  } catch (err) {
    reject(err);
  }
});

// Mirrors representativeLivePrices in src/backend-js/run.js: last hour's average
// if both sides traded enough, else the day's, else the latest trade.
const LIVE_MIN_HOUR_UNITS = 20;
const LIVE_MIN_HOUR_SHARE = 0.01;
const LIVE_MIN_DAY_UNITS = 3;
function livePrices(latest, hour, day) {
  const h = hour || {}, d = day || {}, l = latest || {};
  const whole = n => Math.max(1, Math.round(n));
  const hourOk = (avg, units, dayUnits) => avg && units >= LIVE_MIN_HOUR_UNITS && units >= (dayUnits || 0) * LIVE_MIN_HOUR_SHARE;
  if (hourOk(h.avgHighPrice, h.highPriceVolume, d.highPriceVolume) && hourOk(h.avgLowPrice, h.lowPriceVolume, d.lowPriceVolume)) {
    return { buy: whole(h.avgHighPrice), sell: whole(h.avgLowPrice) };
  }
  const dayOk = (avg, units) => avg && units >= LIVE_MIN_DAY_UNITS;
  return {
    buy: dayOk(d.avgHighPrice, d.highPriceVolume) ? whole(d.avgHighPrice) : (l.high != null ? l.high : null),
    sell: dayOk(d.avgLowPrice, d.lowPriceVolume) ? whole(d.avgLowPrice) : (l.low != null ? l.low : null),
  };
}

addEventListener('checkNotifications', async (resolve, reject) => {
  try {
    const notifEnabled = kvGet('rb_notifEnabled') !== 'false';
    if (!notifEnabled) { resolve(); return; }
    // While GEnius is open on screen it runs these same checks itself;
    // running them here too would double up digests.
    try {
      const raw = CapacitorApp.getState(); // native side returns a JSON string
      const st = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (st && st.isActive) { resolve(); return; }
    } catch (e) { /* no app state available: carry on */ }
    // When the background last checked, shown in the app's header (Ben,
    // 2026-10-26: "8341 minutes since last fetch" while his notifications
    // were actually current).
    CapacitorKV.set('rb_lastRunAt', String(Date.now()));

    const watchlist = getJSON('rb_watchlist', []);
    const dxpEvents = getJSON('rb_dxpEvents', []);
    const dxpSettings = getJSON('rb_dxpSettings', { enabled: false });
    const watchlistSettings = getJSON('rb_watchlistSettings', { enabled: false });
    const portfolioPositions = getJSON('rb_portfolioPositions', []);
    const portfolioSettings = getJSON('rb_portfolioSettings', { enabled: false, intervalHours: 0.25 });
    const reminders = getJSON('rb_reminders', []);
    // Price alerts the background can check on its own (Ben, 2026-10-15:
    // "it doesn't do stuff in the background at all"). Signal/alch/score
    // alerts need the full app's analysis, so they still wait for it.
    const BG_CONDITIONS = ['above', 'below', 'live_above', 'live_below', 'pct_up', 'pct_down'];
    const alerts = getJSON('rb_alerts', []).filter(a => a.id != null && a.itemId != null && BG_CONDITIONS.includes(a.condition));

    const needsPrices = alerts.some(a => !a.condition.startsWith('live_')) ||
      (watchlistSettings.enabled && watchlist.length) ||
      (portfolioSettings.enabled && portfolioPositions.length);

    let dump = null;
    if (needsPrices) {
      try {
        const res = await fetch(DUMP_URL, { method: 'GET' });
        dump = await res.json();
      } catch (e) {
        console.error('[GEnius bg] price fetch failed: ' + e.message);
      }
    }

    let live = null, liveHour = null, liveDay = null;
    if (alerts.some(a => a.condition.startsWith('live_')) || (portfolioSettings.enabled && portfolioPositions.length)) {
      try {
        const wiki = async path => {
          const res = await fetch('https://prices.runescape.wiki/api/v2/rs/' + path, { method: 'GET', headers: { 'User-Agent': 'GEnius/1.0 (github.com/VonDerThWood/GE-Intelligence)' } });
          return (await res.json()).data || null;
        };
        live = await wiki('latest');
        liveHour = await wiki('1h');
        liveDay = await wiki('24h');
      } catch (e) {
        console.error('[GEnius bg] live price fetch failed: ' + e.message);
      }
    }

    const notifications = [];
    let nextId = Math.floor(Date.now() / 1000) % 2000000000;
    // Quiet hours: same notifications, sent to the silent channel.
    const quiet = inQuietHours(getJSON('rb_quietHours', null));
    const inboxPending = [];
    // kind and source match api.js's toInbox calls. Seen: Almanac flag keys.
    const queue = (title, body, kind, source, seen) => {
      const n = { id: nextId++, title, body, schedule: { at: new Date(Date.now() + 100) } };
      if (quiet) n.channelId = 'genius_quiet';
      notifications.push(n);
      inboxPending.push({ title, body, kind, source, at: Date.now(), seen });
    };
    const liveOf = id => livePrices(live && live[String(id)], liveHour && liveHour[String(id)], liveDay && liveDay[String(id)]);

    // --- Reminders (pure date checks, no price data needed) ---
    let remindersChanged = false;
    for (const r of reminders) {
      const todayStr = new Date().toISOString().slice(0, 10);
      if (r.fired || !r.dueDate || r.dueDate > todayStr) continue;
      queue(r.itemName ? `Reminder: ${r.itemName}` : 'GEnius Reminder', r.message || 'Reminder due.', 'mine', 'reminder');
      r.fired = true;
      remindersChanged = true;
    }
    if (remindersChanged) setJSON('rb_reminders', reminders);

    // --- DXP notifications ---
    if (dxpSettings.enabled) {
      const today = new Date();
      const todayStr = today.toISOString().slice(0, 10);
      const notifiedLog = getJSON('rb_dxpNotifiedLog', {});
      let logChanged = false;
      const fire = (key, title, body) => {
        if (notifiedLog[key]) return;
        queue(title, body, 'almanac', 'dxp');
        notifiedLog[key] = todayStr;
        logChanged = true;
      };

      if (dxpSettings.windowApproachingAlerts) {
        const year = today.getFullYear();
        for (const season of DXP_SEASON_ANCHORS) {
          const anchor = new Date(year, season.month - 1, season.day);
          const fireWindowEnd = new Date(anchor.getTime() + 3 * 86400000);
          if (today < anchor || today > fireWindowEnd) continue;
          const alreadyAnnounced = dxpEvents.some(([announced]) => {
            const days = (today - new Date(announced + 'T00:00:00Z')) / 86400000;
            return days >= 0 && days <= 21;
          });
          if (alreadyAnnounced) continue;
          fire(`window_${season.label}_${year}`, '📅 DXP Window Approaching',
            `Historically, ${season.label} Double XP gets announced around this time of year` +
            (season.wide ? ' (this season\'s timing varies more than others)' : '') +
            '. Nothing confirmed yet — just a heads-up based on past years.');
        }
      }

      for (const [announced, start, end] of dxpEvents) {
        if (dxpSettings.announceAlerts && todayStr === announced) {
          fire(`announce_${announced}`, '📅 DXP Announced',
            `A new Double XP event has been announced (${start} to ${end}). Check Notifications > Almanac for what to buy.`);
        }
      }

      // Almanac digest: the app works out each flag and its day (almanac-signals.js)
      // and syncs them here, so flags come due while the app stays closed. Same text
      // as buildDigest in almanac-signals.js.
      const seen = getJSON('rb_almanacSeen', {});
      const dayNow = Date.parse(todayStr + 'T00:00:00Z');
      const due = getJSON('rb_almanacRows', []).filter(r => {
        if (seen[r.key] || !(r.action === 'sell' ? dxpSettings.sellAlerts : dxpSettings.buyAlerts)) return false;
        const diff = Math.round((Date.parse(r.day + 'T00:00:00Z') - dayNow) / 86400000);
        const reach = r.estimated ? 7 : 2;
        return diff >= -reach && diff <= reach;
      });
      if (due.length) {
        const sells = due.filter(r => r.action === 'sell'), buys = due.filter(r => r.action === 'buy');
        const names = list => list.slice(0, 3).map(r => r.name).join(', ') + (list.length > 3 ? `, and ${list.length - 3} more` : '');
        const title = 'Almanac: ' + [sells.length && `${sells.length} to sell now`, buys.length && `${buys.length} to buy now`].filter(Boolean).join(', ');
        const body = [sells.length && `Sell now: ${names(sells)}`, buys.length && `Buy now: ${names(buys)}`].filter(Boolean).join('\n');
        queue(title, body, 'almanac', 'almanac_digest', due.map(r => r.key));
        for (const r of due) seen[r.key] = Date.now();
        setJSON('rb_almanacSeen', seen);
      }
      if (logChanged) {
        const cutoff = Date.now() - 60 * 86400000;
        for (const k in notifiedLog) {
          if (new Date(notifiedLog[k]).getTime() < cutoff) delete notifiedLog[k];
        }
        setJSON('rb_dxpNotifiedLog', notifiedLog);
      }
    }

    // --- Price alerts ---
    // Same edge rule as api.js's getTriggeredAlerts: notify when an alert
    // goes from not-hit to hit, not on every run while it stays hit.
    // rb_alertActive carries that state between runs; rb_alertFired lists
    // what fired here so the app can mark them and not notify twice.
    if (alerts.length) {
      const active = getJSON('rb_alertActive', {});
      const fired = getJSON('rb_alertFired', []);
      const gp = n => Math.round(n).toLocaleString();
      for (const a of alerts) {
        const entry = dump && dump[String(a.itemId)];
        const price = entry && typeof entry === 'object' ? entry.price : null;
        const last = entry && typeof entry === 'object' ? entry.last : null;
        const lv = live && live[String(a.itemId)];
        // An hour or day average, not one trade that could be anything.
        const lp = lv ? liveOf(a.itemId) : null;
        const liveRef = lp ? (lp.buy != null ? lp.buy : lp.sell) : null;
        const chg = price && last ? ((price - last) / last) * 100 : null;
        const t = a.price || 0, pct = a.pct || 0;
        let hit = null, msg = '';
        switch (a.condition) {
          case 'above':      if (price) { hit = price > t; msg = a.name + ' rose above ' + gp(t) + 'gp, now ' + gp(price) + 'gp'; } break;
          case 'below':      if (price) { hit = price < t; msg = a.name + ' fell below ' + gp(t) + 'gp, now ' + gp(price) + 'gp'; } break;
          case 'live_above': if (liveRef != null) { hit = liveRef > t; msg = a.name + ' live price rose above ' + gp(t) + 'gp, now ' + gp(liveRef) + 'gp'; } break;
          case 'live_below': if (liveRef != null) { hit = liveRef < t; msg = a.name + ' live price fell below ' + gp(t) + 'gp, now ' + gp(liveRef) + 'gp'; } break;
          case 'pct_up':     if (chg != null) { hit = chg >= pct; msg = a.name + ' up +' + chg.toFixed(2) + '% today (threshold +' + pct + '%)'; } break;
          case 'pct_down':   if (chg != null) { hit = chg <= -Math.abs(pct); msg = a.name + ' down ' + chg.toFixed(2) + '% today (threshold -' + Math.abs(pct) + '%)'; } break;
        }
        if (hit == null) continue; // no price this run: leave state alone
        const key = String(a.id);
        const was = key in active ? active[key] : !!a.active;
        if (hit && !was) { queue('Alert: ' + a.name, msg, 'mine', 'price_alert'); fired.push({ id: a.id, at: Date.now() }); }
        active[key] = hit;
      }
      setJSON('rb_alertActive', active);
      setJSON('rb_alertFired', fired.slice(-200));
    }

    // --- Watchlist digest (uses the rolling price log this runner builds itself) ---
    if (watchlistSettings.enabled && watchlist.length && dump) {
      const intervalMs = (watchlistSettings.intervalHours || 24) * 3600000;
      const lastSentMs = parseInt(kvGet('rb_watchlistDigestLastSent') || '0', 10);
      const priceLog = getJSON('rb_priceLog', {});
      const now = Date.now();

      for (const w of watchlist) {
        const entry = dump[String(w.id)];
        const price = entry && typeof entry === 'object' ? entry.price : (typeof entry === 'number' ? entry : null);
        if (price == null) continue;
        const log = priceLog[w.id] || [];
        log.push({ t: now, p: price });
        priceLog[w.id] = log.filter(e => now - e.t <= PRICE_LOG_MAX_AGE_MS);
      }
      setJSON('rb_priceLog', priceLog);

      if (now - lastSentMs >= intervalMs - 60000) { // 1-min grace, as in api.js
        const pctChange = (id, days) => {
          const log = priceLog[id] || [];
          if (log.length < 2) return null;
          const target = now - days * 86400000;
          let closest = log[0];
          for (const e of log) {
            if (Math.abs(e.t - target) < Math.abs(closest.t - target)) closest = e;
          }
          const latest = log[log.length - 1];
          if (!closest.p) return null;
          return ((latest.p - closest.p) / closest.p) * 100;
        };

        const movers = [];
        for (const w of watchlist) {
          const dayPct = pctChange(w.id, 1);
          const weekPct = pctChange(w.id, 7);
          const dayHit = dayPct != null && Math.abs(dayPct) >= watchlistSettings.dailyThresholdPct;
          const weekHit = weekPct != null && Math.abs(weekPct) >= watchlistSettings.trendThresholdPct;
          if (dayHit || weekHit) movers.push({ name: w.name, dayPct, weekPct, dayHit, weekHit });
        }

        if (movers.length) {
          movers.sort((a, b) =>
            Math.max(Math.abs(b.dayPct || 0), Math.abs(b.weekPct || 0)) -
            Math.max(Math.abs(a.dayPct || 0), Math.abs(a.weekPct || 0)));
          const top = movers.slice(0, 5);
          const lines = top.map(m => {
            const parts = [];
            if (m.dayHit) parts.push(`${m.dayPct >= 0 ? '+' : ''}${m.dayPct.toFixed(1)}% today`);
            if (m.weekHit) parts.push(`${m.weekPct >= 0 ? '+' : ''}${m.weekPct.toFixed(1)}% over 7d`);
            return `${m.name}: ${parts.join(', ')}`;
          });
          if (movers.length > top.length) lines.push(`+${movers.length - top.length} more`);
          queue(`Watchlist — ${movers.length} item${movers.length === 1 ? '' : 's'} moving`, lines.join('\n'), 'digest', 'watchlist_digest');
          CapacitorKV.set('rb_watchlistDigestLastSent', String(now));
        }
      }
    }

    // --- Portfolio digest: what selling really gets you, like api.js, unless
    // that price is obviously broken or missing (then the guide price) ---
    if (portfolioSettings.enabled && portfolioPositions.length && dump) {
      const intervalMs = (portfolioSettings.intervalHours || 0.25) * 3600000;
      const lastSentMs = parseInt(kvGet('rb_portfolioDigestLastSent') || '0', 10);
      if (Date.now() - lastSentMs >= intervalMs - 60000) { // 1-min grace, as in api.js
        let totalValue = 0, totalPL = 0;
        const rows = [];
        for (const pos of portfolioPositions) {
          const entry = dump[String(pos.id)];
          const guide = entry && typeof entry === 'object' ? entry.price : (typeof entry === 'number' ? entry : null);
          if (guide == null) continue;
          const sell = liveOf(pos.id).sell;
          const price = sell && sell <= guide * 5 && sell >= guide / 5 ? sell : guide;
          const value = price * pos.quantity;
          const pl = value - pos.costBasis * pos.quantity;
          totalValue += value; totalPL += pl;
          rows.push({ name: pos.name, price, pl });
        }
        if (rows.length) {
          // Same layout as digestMessage() in src/backend-js/api.js: total in
          // the title, biggest gain/loss first, short K/M/B numbers.
          const shortGp = n => {
            const a = Math.abs(n), s = n < 0 ? '−' : '';
            if (a >= 1e9) return s + (a / 1e9).toFixed(2) + 'B';
            if (a >= 1e6) return s + (a / 1e6).toFixed(1) + 'M';
            if (a >= 1e4) return s + (a / 1e3).toFixed(1) + 'K';
            return s + Math.round(a).toLocaleString();
          };
          const sign = n => (n > 0 ? '+' : '') + shortGp(n);
          rows.sort((a, b) => Math.abs(b.pl) - Math.abs(a.pl));
          queue(`Portfolio ${sign(totalPL)} · ${rows.length} position${rows.length === 1 ? '' : 's'} · worth ${shortGp(totalValue)}`,
            rows.map(r => `${r.pl >= 0 ? '▲' : '▼'} ${r.name}  ${sign(r.pl)} (${shortGp(r.price)} ea)`).join('\n'), 'digest', 'portfolio_digest');
          CapacitorKV.set('rb_portfolioDigestLastSent', String(Date.now()));
        }
      }
    }

    if (inboxPending.length) setJSON('rb_inboxPending', [...getJSON('rb_inboxPending', []), ...inboxPending].slice(-100));
    if (notifications.length) CapacitorNotifications.schedule(notifications);
    resolve();
  } catch (err) {
    console.error('[GEnius bg] checkNotifications failed: ' + err.message);
    reject(err);
  }
});
