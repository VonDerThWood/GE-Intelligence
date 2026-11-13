/**
 * recent-prices.js: average instant-buy and instant-sell prices over the most
 * recent trading, for every item at once (Ben, 2026-11-12: "take the last
 * several trades on each side, average them out").
 *
 * The wiki doesn't expose single trades, only windows: average price and how
 * many ITEMS were bought/sold in each 5-minute or 1-hour block. So for each
 * item we walk back from now through those blocks until both sides have at
 * least TARGET_UNITS traded (or we hit MAX_HOURS), and average each side over
 * that same window (one window for both sides, or a spread can look upside
 * down). Fewer than MIN_UNITS on either side = not enough to call it a price.
 *
 * Blocks: 5-minute ones for the last 2 hours, 1-hour ones before that. Each
 * block is fetched once and kept in memory, so a refresh is usually one or two
 * small requests plus /latest. Shared by desktop and phone (plain fetch).
 */
const BASE = 'https://prices.runescape.wiki/api/v2/rs/';
const HEADERS = { 'User-Agent': 'GEnius/1.0 (github.com/VonDerThWood/GE-Intelligence)' };
const MIN_UNITS = 5;        // Ben: at least 5 per side
const TARGET_UNITS = 20;    // stop walking back once both sides have this many
const MAX_HOURS = 6;
const FIVE_MIN_HOURS = 2;   // 5-minute blocks this far back, hourly before
const REFRESH_MS = 4.5 * 60000;
const GAP_MS = 250;

// Weighted median of block prices, plus the lowest and highest block price.
// Blocks of a busy item hold hundreds of trades each, so their spread is small;
// a thin item's blocks are single trades, so lo/hi show how erratic it is.
function side(pts) {
  const sorted = pts.slice().sort((a, b) => a[0] - b[0]);
  const total = sorted.reduce((t, p) => t + p[1], 0);
  let acc = 0, mid = sorted[0][0];
  for (const [price, n] of sorted) { acc += n; if (acc * 2 >= total) { mid = price; break; } }
  return { mid: Math.max(1, Math.round(mid)), lo: Math.round(sorted[0][0]), hi: Math.round(sorted[sorted.length - 1][0]) };
}

function createRecentPrices() {
  const blocks = new Map(); // "5m:<ts>" | "1h:<ts>" -> {start, end, data: Map id -> [buyAvg, buyUnits, sellAvg, sellUnits]}
  let latest = {}, result = null, at = 0, running = null;

  async function getJson(url) {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
  async function loadBlock(kind, ts) {
    const key = `${kind}:${ts}`;
    if (blocks.has(key)) return;
    const j = await getJson(`${BASE}${kind}?timestamp=${ts}`);
    const data = new Map();
    for (const [id, v] of Object.entries(j.data || {})) {
      data.set(id, [v.avgHighPrice || 0, v.highPriceVolume || 0, v.avgLowPrice || 0, v.lowPriceVolume || 0]);
    }
    if (!data.size) return; // not published yet: try again next refresh
    blocks.set(key, { start: ts * 1000, end: (ts + (kind === '5m' ? 300 : 3600)) * 1000, data });
    await new Promise(r => setTimeout(r, GAP_MS));
  }

  async function refreshOnce() {
    const nowS = Math.floor(Date.now() / 1000);
    const last5 = Math.floor(nowS / 300) * 300 - 300;          // newest complete 5-minute block
    const split = Math.floor((last5 - FIVE_MIN_HOURS * 3600) / 3600) * 3600 + 3600; // 5m from here on
    const oldest = split - (MAX_HOURS - FIVE_MIN_HOURS) * 3600;
    const want = [];
    for (let t = last5; t >= split; t -= 300) want.push(['5m', t]);
    for (let t = split - 3600; t >= oldest; t -= 3600) want.push(['1h', t]);
    for (const [k, t] of want) { try { await loadBlock(k, t); } catch (e) { /* missing block: skip */ } }
    for (const [key, b] of blocks) if (b.end <= oldest * 1000 || (key.startsWith('5m:') && b.start < split * 1000)) blocks.delete(key);
    try { latest = (await getJson(BASE + 'latest')).data || latest; } catch (e) { /* keep last */ }

    // Newest first. Where a 5m block and an hour block overlap (shouldn't, but
    // a late hour), the 5m blocks win because hourly ones only cover older time.
    const ordered = [...blocks.values()].sort((a, b) => b.start - a.start);
    const ids = new Set();
    for (const b of ordered) for (const id of b.data.keys()) ids.add(id);
    const out = {};
    for (const id of ids) {
      let bN = 0, sN = 0, from = null, buyTime = null, sellTime = null;
      const bPts = [], sPts = []; // [price, units] per block
      for (const b of ordered) {
        const v = b.data.get(id);
        if (v) {
          if (v[1] && v[0]) { bPts.push([v[0], v[1]]); bN += v[1]; if (!buyTime) buyTime = b.end; }
          if (v[3] && v[2]) { sPts.push([v[2], v[3]]); sN += v[3]; if (!sellTime) sellTime = b.end; }
        }
        from = b.start;
        if (bN >= TARGET_UNITS && sN >= TARGET_UNITS) break;
      }
      if (bN < MIN_UNITS || sN < MIN_UNITS) continue;
      // Middle price weighted by units (Ben, 2026-11-12: Ring of Fortune's one
      // 10m buy dragged a plain average to 4.4m on a 1m item). lo/hi let the
      // app flag a side whose prices are all over the place.
      const bs = side(bPts), ss = side(sPts);
      out[id] = {
        buy: bs.mid, buyUnits: bN, buyTime, buyLo: bs.lo, buyHi: bs.hi,
        sell: ss.mid, sellUnits: sN, sellTime, sellLo: ss.lo, sellHi: ss.hi, from,
      };
    }
    for (const [id, l] of Object.entries(latest)) {
      const o = out[id] || (out[id] = { buy: null, sell: null });
      o.latestBuy = l.high ?? null; o.latestBuyTime = l.highTime ? l.highTime * 1000 : null;
      o.latestSell = l.low ?? null; o.latestSellTime = l.lowTime ? l.lowTime * 1000 : null;
    }
    result = out; at = Date.now();
    console.log(`[recent-prices] ${Object.values(out).filter(o => o.buy).length} items averaged from ${blocks.size} blocks`);
  }

  // Returns {at, minUnits, prices: {id: {buy, buyUnits, sell, sellUnits, from, latestBuy, ...}}}.
  async function get(force = false) {
    if (force || !result || Date.now() - at > REFRESH_MS) {
      if (!running) running = refreshOnce().catch(e => console.log(`[recent-prices] refresh failed: ${e.message}`)).finally(() => { running = null; });
      await running;
    }
    return { at, minUnits: MIN_UNITS, prices: result || {} };
  }
  return { get };
}

module.exports = { createRecentPrices };
