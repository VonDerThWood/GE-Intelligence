/**
 * live-history.js: keeps the wiki's daily live buy/sell prices and volumes on
 * disk for good (Ben, 2026-11-02: "the same way we save the GE price data").
 *
 * The wiki only serves roughly the last 3-6 months, and older days vanish, so
 * every complete UTC day is saved as soon as we can get it. One request covers
 * every item, so files are per month rather than per item:
 *   live_history/2026-11.json  { days: { "2026-11-02": { "<id>": [buy, buyVol, sell, sellVol] } } }
 *   live_history/meta.json     { floor: "2026-05-20" } (no data at or before this day)
 */
const path = require('path');
const storage = require('./storage.js');

const BASE_URL = 'https://prices.runescape.wiki/api/v2/rs/24h';
const HEADERS = { 'User-Agent': 'GEnius/1.3 (github.com/VonDerThWood/GE-Intelligence)' };
const DAY_MS = 86400000;
const REQUEST_GAP_MS = 400;
// An empty answer this recent is more likely an API hiccup than the end of
// the wiki's data, so it doesn't set the floor.
const FLOOR_MIN_AGE_DAYS = 30;
// Each day is a ~500KB download. The phone catches up in small steps over
// mobile data and only reaches back a little; the desktop takes it all.
const LIMITS = {
  desktop: { maxDaysPerRun: 200, lookbackDays: 200 },
  mobile: { maxDaysPerRun: 5, lookbackDays: 30 },
};

const dayStr = ms => new Date(ms).toISOString().slice(0, 10);

function createLiveHistory({ dataDir, platform = 'desktop' }) {
  const dir = path.join(dataDir, 'live_history');
  const metaFile = path.join(dir, 'meta.json');
  const monthFile = month => path.join(dir, `${month}.json`);
  const limits = LIMITS[platform] || LIMITS.desktop;
  let running = null;

  // null = the request failed, {} = the wiki has nothing for that day.
  async function fetchDay(startMs) {
    try {
      const res = await fetch(`${BASE_URL}?timestamp=${startMs / 1000}`, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
      if (!res.ok) return null;
      const out = {};
      const data = (await res.json()).data;
      if (!data) return null;
      for (const [id, v] of Object.entries(data)) {
        out[id] = [v.avgHighPrice ?? null, v.highPriceVolume || 0, v.avgLowPrice ?? null, v.lowPriceVolume || 0];
      }
      return out;
    } catch {
      return null;
    }
  }

  // Saves missing complete days, newest first. Stops at the first failed
  // request; the next fetch carries on from whatever is still missing.
  async function syncOnce() {
    await storage.ensureDir(dir);
    const meta = await storage.readJSON(metaFile, {});
    const today = Math.floor(Date.now() / DAY_MS) * DAY_MS;
    let month = null, doc = null, dirty = false, saved = 0, fetched = 0;
    const flush = async () => {
      if (doc && dirty) await storage.writeJSON(monthFile(month), doc);
      dirty = false;
    };
    for (let i = 1; i <= limits.lookbackDays && fetched < limits.maxDaysPerRun; i++) {
      const start = today - i * DAY_MS;
      const day = dayStr(start);
      if (meta.floor && day <= meta.floor) break;
      if (day.slice(0, 7) !== month) {
        await flush();
        month = day.slice(0, 7);
        doc = await storage.readJSON(monthFile(month), { days: {} });
      }
      if (doc.days[day]) continue;
      if (fetched) await new Promise(r => setTimeout(r, REQUEST_GAP_MS));
      fetched++;
      const items = await fetchDay(start);
      if (!items) break;
      if (!Object.keys(items).length) {
        if (i > FLOOR_MIN_AGE_DAYS) {
          meta.floor = day;
          await storage.writeJSON(metaFile, meta);
          break;
        }
        continue;
      }
      doc.days[day] = items;
      dirty = true;
      saved++;
      // Don't risk a long backfill's progress on one write at the very end.
      if (saved % 10 === 0) await flush();
    }
    await flush();
    if (saved) console.log(`[live-history] Saved ${saved} day(s)`);
    return { saved };
  }

  // Best-effort and safe to call after every fetch: once caught up it only
  // reads the current month's file.
  function sync() {
    if (!running) running = syncOnce().catch(e => { console.log(`[live-history] Sync failed (non-fatal): ${e.message}`); return { saved: 0 }; }).finally(() => { running = null; });
    return running;
  }

  // Oldest first: [{ date, buy, buyVol, sell, sellVol }], for the last `days` days.
  async function getItem(itemId, days = 365) {
    const key = String(itemId);
    const cutoff = dayStr(Date.now() - days * DAY_MS);
    const months = (await storage.listJSONFiles(dir)).filter(f => /^\d{4}-\d{2}\.json$/.test(f)).map(f => f.slice(0, 7)).filter(m => m >= cutoff.slice(0, 7)).sort();
    const out = [];
    for (const m of months) {
      const doc = await storage.readJSON(monthFile(m), { days: {} });
      for (const date of Object.keys(doc.days).sort()) {
        const row = doc.days[date][key];
        if (row && date >= cutoff) out.push({ date, buy: row[0], buyVol: row[1], sell: row[2], sellVol: row[3] });
      }
    }
    return out;
  }

  return { sync, getItem };
}

module.exports = { createLiveHistory };
