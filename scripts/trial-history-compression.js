/**
 * Trial of the v3.0.0 history compression on a COPY of the real history
 * (Ben, 2026-11-11). Never touches data/history itself.
 *   node scripts/trial-history-compression.js [historyDir]
 * For every item file: pack -> JSON -> gzip -> write to a temp folder,
 * then read back -> gunzip -> unpack and check it is EXACTLY the original.
 * Reports sizes, timings, and any file that doesn't round-trip.
 */
const fs = require('fs'), path = require('path'), os = require('os'), zlib = require('zlib');
const { pack, unpack } = require('../src/backend-js/history-format.js');

const src = process.argv[2] || path.join(process.env.APPDATA, 'GEnius', 'data', 'history');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'genius-history-trial-'));
const files = fs.readdirSync(src).filter(f => /^\d+\.json$/.test(f));
let before = 0, after = 0, bad = [], fallback = 0, tEnc = 0, tDec = 0, tOldRead = 0;
const t0 = Date.now();
for (const f of files) {
  const raw = fs.readFileSync(path.join(src, f), 'utf8');
  before += Buffer.byteLength(raw);
  let a = Date.now();
  const points = JSON.parse(raw);
  tOldRead += Date.now() - a;
  a = Date.now();
  const packed = pack(points);
  if (packed.f === 0) fallback++;
  const gz = zlib.gzipSync(JSON.stringify(packed), { level: 9 });
  tEnc += Date.now() - a;
  const file = path.join(out, f.replace(/\.json$/, '.json.gz'));
  fs.writeFileSync(file, gz);
  after += gz.length;
  a = Date.now();
  const back = unpack(JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8')));
  tDec += Date.now() - a;
  if (JSON.stringify(back) !== JSON.stringify(points)) bad.push(f);
}
const mb = b => (b / 1048576).toFixed(1) + 'MB';
console.log(`files: ${files.length} | before ${mb(before)} -> after ${mb(after)} (${(before / after).toFixed(1)}x smaller)`);
console.log(`exact round-trip: ${files.length - bad.length}/${files.length}${bad.length ? ' FAILED: ' + bad.slice(0, 10).join(', ') : ''} | stored as-is (unusual data): ${fallback}`);
console.log(`time: convert all ${(tEnc / 1000).toFixed(1)}s | read all compressed ${(tDec / 1000).toFixed(1)}s vs read all old ${(tOldRead / 1000).toFixed(1)}s (parse only) | total ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.log('trial copy left in', out);
process.exit(bad.length ? 1 : 0);
