/**
 * history-format.js: the compact on-disk format for per-item price history
 * (v3.0.0, Ben 2026-11-11). Lossless: decode(encode(points)) is exactly the
 * original list of { timestamp, price, volume }.
 *
 * Old files (data/history/<id>.json) write every day as
 *   {"timestamp":1211328000000,"price":167,"volume":0}
 * The compact form stores three columns instead of millions of objects, and
 * each column as differences from the previous value (dates are almost always
 * exactly one day apart, prices move a little), which then zips very well:
 *   { "f": 1, "t": [first, +86400000, ...], "p": [first, +8, -3, ...], "v": [...] }
 * About 55x smaller than the old files across Ben's 7,467 items.
 *
 * Anything that doesn't fit (a missing or non-numeric value, an extra field)
 * is stored as-is ({ f: 0, raw: points }), so nothing can ever be lost.
 *
 * This file is pure (no disk); the zipping is done by the caller's platform
 * (Node zlib on desktop, CompressionStream on the phone).
 */
const FIELDS = ['timestamp', 'price', 'volume'];
const KEY = { timestamp: 't', price: 'p', volume: 'v' };

function packable(points) {
  if (!Array.isArray(points)) return false;
  for (const pt of points) {
    if (!pt || typeof pt !== 'object') return false;
    const ks = Object.keys(pt);
    if (ks.length !== 3) return false;
    for (const k of FIELDS) if (!Number.isSafeInteger(pt[k])) return false;
  }
  return true;
}

// points -> plain object (JSON-ready)
function pack(points) {
  if (!packable(points)) return { f: 0, raw: points };
  const out = { f: 1, n: points.length };
  for (const k of FIELDS) {
    const col = new Array(points.length);
    let prev = 0;
    for (let i = 0; i < points.length; i++) { const v = points[i][k]; col[i] = v - prev; prev = v; }
    out[KEY[k]] = col;
  }
  return out;
}

// plain object -> points (accepts the old plain array too)
function unpack(obj) {
  if (Array.isArray(obj)) return obj;              // old format, already points
  if (!obj || typeof obj !== 'object') return null;
  if (obj.f === 0) return obj.raw;
  if (obj.f !== 1) throw new Error('Unknown history format ' + obj.f);
  const n = obj.n, points = new Array(n);
  const sums = { t: 0, p: 0, v: 0 };
  for (let i = 0; i < n; i++) {
    sums.t += obj.t[i]; sums.p += obj.p[i]; sums.v += obj.v[i];
    points[i] = { timestamp: sums.t, price: sums.p, volume: sums.v };
  }
  return points;
}

module.exports = { pack, unpack };
