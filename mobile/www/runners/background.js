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
    if (d.dxpWatchlist) setJSON('rb_dxpWatchlist', d.dxpWatchlist);
    if (d.dxpTiming) setJSON('rb_dxpTiming', d.dxpTiming);
    if (d.dxpEvents) setJSON('rb_dxpEvents', d.dxpEvents);
    if (d.dxpSettings) setJSON('rb_dxpSettings', d.dxpSettings);
    if (d.watchlistSettings) setJSON('rb_watchlistSettings', d.watchlistSettings);
    if (d.reminders) setJSON('rb_reminders', d.reminders);
    if (typeof d.notificationsEnabled === 'boolean') CapacitorKV.set('rb_notifEnabled', String(d.notificationsEnabled));
    resolve();
  } catch (err) {
    reject(err);
  }
});

addEventListener('checkNotifications', async (resolve, reject) => {
  try {
    const notifEnabled = CapacitorKV.get('rb_notifEnabled').value !== 'false';
    if (!notifEnabled) { resolve(); return; }

    const watchlist = getJSON('rb_watchlist', []);
    const dxpWatchlist = getJSON('rb_dxpWatchlist', []);
    const dxpTiming = getJSON('rb_dxpTiming', {});
    const dxpEvents = getJSON('rb_dxpEvents', []);
    const dxpSettings = getJSON('rb_dxpSettings', { enabled: false });
    const watchlistSettings = getJSON('rb_watchlistSettings', { enabled: false });
    const reminders = getJSON('rb_reminders', []);

    const needsPrices = (watchlistSettings.enabled && watchlist.length) ||
      (dxpSettings.enabled && dxpWatchlist.length);

    let dump = null;
    if (needsPrices) {
      try {
        const res = await fetch(DUMP_URL, { method: 'GET' });
        dump = await res.json();
      } catch (e) {
        console.error('[GEnius bg] price fetch failed: ' + e.message);
      }
    }

    const notifications = [];
    let nextId = Math.floor(Date.now() / 1000) % 2000000000;
    const queue = (title, body) => {
      notifications.push({ id: nextId++, title, body, schedule: { at: new Date(Date.now() + 100) } });
    };

    // --- Reminders (pure date checks, no price data needed) ---
    let remindersChanged = false;
    for (const r of reminders) {
      const todayStr = new Date().toISOString().slice(0, 10);
      if (r.fired || !r.dueDate || r.dueDate > todayStr) continue;
      queue(r.itemName ? `Reminder: ${r.itemName}` : 'GEnius Reminder', r.message || 'Reminder due.');
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
        queue(title, body);
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

      const daysBetween = (a, b) => Math.round((b - a) / 86400000);
      for (const [announced, start, end] of dxpEvents) {
        if (dxpSettings.announceAlerts && todayStr === announced) {
          fire(`announce_${announced}`, '📅 DXP Announced',
            `A new Double XP event has been announced (${start} to ${end}). Check your Almanac watchlist for buy timing.`);
          continue;
        }
        const startDt = new Date(start + 'T00:00:00Z');
        const endDt = new Date(end + 'T00:00:00Z');
        const baselineDt = new Date(startDt.getTime() - 21 * 86400000);
        const afterDt = new Date(endDt.getTime() + 21 * 86400000);
        if (today < baselineDt || today > afterDt) continue;
        const dayOffset = daysBetween(startDt, today);

        for (const w of dxpWatchlist) {
          const timing = dxpTiming[w.id];
          if (!timing) continue;
          if (dxpSettings.buyAlerts && timing.best_buy_day_offset != null) {
            const std = Math.max(timing.best_buy_day_std || 0, 0.5);
            if (Math.abs(dayOffset - timing.best_buy_day_offset) <= std) {
              fire(`${w.id}_buy_${start}_${todayStr}`, '📅 DXP Buy Window',
                `${w.name} is at its historical best-buy day (day ${dayOffset} of the event).`);
            }
          }
          if (dxpSettings.sellAlerts && timing.best_sell_day_offset != null) {
            const std = Math.max(timing.best_sell_day_std || 0, 0.5);
            if (Math.abs(dayOffset - timing.best_sell_day_offset) <= std) {
              fire(`${w.id}_sell_${start}_${todayStr}`, '📅 DXP Sell Window',
                `${w.name} is at its historical best-sell day (day ${dayOffset} of the event).`);
            }
          }
        }
      }
      if (logChanged) {
        const cutoff = Date.now() - 60 * 86400000;
        for (const k in notifiedLog) {
          if (new Date(notifiedLog[k]).getTime() < cutoff) delete notifiedLog[k];
        }
        setJSON('rb_dxpNotifiedLog', notifiedLog);
      }
    }

    // --- Watchlist digest (uses the rolling price log this runner builds itself) ---
    if (watchlistSettings.enabled && watchlist.length && dump) {
      const todayStr = new Date().toISOString().slice(0, 10);
      const lastSent = CapacitorKV.get('rb_watchlistDigestLastSent').value;
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

      if (lastSent !== todayStr) {
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
          queue(`Watchlist — ${movers.length} item${movers.length === 1 ? '' : 's'} moving`, lines.join('\n'));
          CapacitorKV.set('rb_watchlistDigestLastSent', todayStr);
        }
      }
    }

    if (notifications.length) CapacitorNotifications.schedule(notifications);
    resolve();
  } catch (err) {
    console.error('[GEnius bg] checkNotifications failed: ' + err.message);
    reject(err);
  }
});
