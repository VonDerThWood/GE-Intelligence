/**
 * live-hourly.js: keeps the wiki's HOURLY live buy/sell prices and volumes on
 * disk for good (Ben, 2026-11-07). Daily averages flatten spikes: a scrimshaw
 * that sold at 20m for an hour still averages ~14m for the day. The wiki keeps
 * about 100 days of hours, then they're gone, so the Almanac needs its own copy.
 *
 * Opt-in (Settings > Hourly price history): every hour is a ~260KB download.
 * Stored gzipped, one file per UTC day (~800KB/day, ~25MB/month):
 *   live_hourly/2026-11-07.json.gz  { hours: { "13": { "<id>": [buy, buyVol, sell, sellVol] } } }
 *   live_hourly/meta.json           { floor: "2026-07-25T04" } (no data at or before this hour)
 * Desktop only: it uses Node's fs and zlib directly.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BASE_URL = 'https://prices.runescape.wiki/api/v2/rs/1h';
const HEADERS = { 'User-Agent': 'GEnius/1.3 (github.com/VonDerThWood/GE-Intelligence)' };
const HOUR_MS = 3600000;
const REQUEST_GAP_MS = 400;
const LOOKBACK_HOURS = 110 * 24;   // a little past what the wiki keeps
const MAX_HOURS_PER_RUN = 400;     // ~3 min per run; a full backfill takes a few fetches
const FLOOR_MIN_AGE_HOURS = 30 * 24;

const hourKey = ms => new Date(ms).toISOString().slice(0, 13); // "2026-11-07T13"
const round = v => (v == null ? null : Math.round(v));

function createLiveHourly({ dataDir }) {
  const dir = path.join(dataDir, 'live_hourly');
  const metaFile = path.join(dir, 'meta.json');
  const dayFile = day => path.join(dir, `${day}.json.gz`);
  let running = null;

  const readDay = day => {
    try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(dayFile(day))).toString('utf8')); }
    catch { return { hours: {} }; }
  };
  const writeDay = (day, doc) => {
    const tmp = dayFile(day) + '.tmp';
    fs.writeFileSync(tmp, zlib.gzipSync(JSON.stringify(doc), { level: 9 }));
    fs.renameSync(tmp, dayFile(day));
  };
  const readMeta = () => { try { return JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch { return {}; } };

  // null = the request failed, {} = the wiki has nothing for that hour.
  async function fetchHour(startMs) {
    try {
      const res = await fetch(`${BASE_URL}?timestamp=${startMs / 1000}`, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
      if (!res.ok) return null;
      const data = (await res.json()).data;
      if (!data) return null;
      const out = {};
      for (const [id, v] of Object.entries(data)) {
        out[id] = [round(v.avgHighPrice), v.highPriceVolume || 0, round(v.avgLowPrice), v.lowPriceVolume || 0];
      }
      return out;
    } catch {
      return null;
    }
  }

  // Saves missing complete hours, newest first, so a running DXP is covered
  // before the backfill reaches older weeks. Stops at the first failed request.
  async function syncOnce() {
    fs.mkdirSync(dir, { recursive: true });
    const meta = readMeta();
    const lastComplete = Math.floor(Date.now() / HOUR_MS) * HOUR_MS - HOUR_MS;
    let day = null, doc = null, dirty = false, saved = 0, fetched = 0;
    const flush = () => { if (doc && dirty) writeDay(day, doc); dirty = false; };
    for (let i = 0; i < LOOKBACK_HOURS && fetched < MAX_HOURS_PER_RUN; i++) {
      const start = lastComplete - i * HOUR_MS;
      const key = hourKey(start);
      if (meta.floor && key <= meta.floor) break;
      const d = key.slice(0, 10), hh = key.slice(11, 13);
      if (d !== day) { flush(); day = d; doc = readDay(d); }
      if (doc.hours[hh]) continue;
      if (fetched) await new Promise(r => setTimeout(r, REQUEST_GAP_MS));
      fetched++;
      const items = await fetchHour(start);
      if (!items) break;
      if (!Object.keys(items).length) {
        if (i > FLOOR_MIN_AGE_HOURS) {
          meta.floor = key;
          fs.writeFileSync(metaFile, JSON.stringify(meta));
          break;
        }
        continue;
      }
      doc.hours[hh] = items;
      dirty = true;
      saved++;
    }
    flush();
    if (saved) console.log(`[live-hourly] Saved ${saved} hour(s)`);
    return { saved, fetched };
  }

  function sync() {
    if (!running) running = syncOnce().catch(e => { console.log(`[live-hourly] Sync failed (non-fatal): ${e.message}`); return { saved: 0 }; }).finally(() => { running = null; });
    return running;
  }

  // Oldest first: [{ time, buy, buyVol, sell, sellVol }] for the last `days` days.
  function getItem(itemId, days = 30) {
    const key = String(itemId);
    const cutoff = hourKey(Date.now() - days * 86400000);
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}\.json\.gz$/.test(f)).map(f => f.slice(0, 10)).filter(d => d >= cutoff.slice(0, 10)).sort(); } catch {}
    const out = [];
    for (const d of files) {
      const doc = readDay(d);
      for (const hh of Object.keys(doc.hours).sort()) {
        const row = doc.hours[hh][key];
        const time = `${d}T${hh}`;
        if (row && time >= cutoff) out.push({ time, buy: row[0], buyVol: row[1], sell: row[2], sellVol: row[3] });
      }
    }
    return out;
  }

  // Per UTC day: highest and lowest hourly average, so one-hour spikes survive.
  function getItemDailyRange(itemId, days = 30) {
    const byDay = {};
    for (const r of getItem(itemId, days)) {
      const d = r.time.slice(0, 10);
      const e = byDay[d] || (byDay[d] = { date: d, high: null, low: null, hours: 0 });
      e.hours++;
      for (const p of [r.buy, r.sell]) {
        if (p == null) continue;
        if (e.high == null || p > e.high) e.high = p;
        if (e.low == null || p < e.low) e.low = p;
      }
    }
    return Object.values(byDay);
  }

  function status() {
    let files = [], bytes = 0;
    try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json.gz')); for (const f of files) bytes += fs.statSync(path.join(dir, f)).size; } catch {}
    files.sort();
    return { days: files.length, bytes, oldest: files[0]?.slice(0, 10) || null, newest: files[files.length - 1]?.slice(0, 10) || null };
  }

  return { sync, getItem, getItemDailyRange, status };
}

module.exports = { createLiveHourly };
