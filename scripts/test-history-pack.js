// History pack round trip: serve dist/history-pack.jsonl.gz locally, import it
// into an empty folder, and check every item matches this PC's history exactly.
//   node scripts/build-history-pack.js && node scripts/test-history-pack.js
const os = require('os'), fs = require('fs'), path = require('path'), http = require('http');
const storage = require('../src/backend-js/storage.js');

(async () => {
  const packFile = path.join(__dirname, '..', 'dist', 'history-pack.jsonl.gz');
  const real = path.join(process.env.APPDATA, 'GEnius', 'data', 'history');
  const server = http.createServer((req, res) => {
    if (req.url === '/cut') { // a download that drops partway
      const buf = fs.readFileSync(packFile);
      res.write(buf.subarray(0, buf.length >> 2)); return setTimeout(() => res.destroy(), 1500);
    }
    res.writeHead(req.url === '/pack' ? 200 : 404); req.url === '/pack' ? fs.createReadStream(packFile).pipe(res) : res.end();
  }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  let failed = 0;
  const ok = (c, m) => { console.log((c ? 'ok  ' : 'FAIL') + ' ' + m); if (!c) failed++; };

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'genius-pack-'));
  const t = Date.now();
  const r = await storage.importHistoryPack(dir, base + '/pack', { skip: new Set(['2']) });
  console.log(`     imported ${r.imported} in ${((Date.now() - t) / 1000).toFixed(1)}s, built ${r.builtAt}`);
  ok(r.complete, 'download complete (end marker seen)');
  ok(!fs.existsSync(path.join(dir, '2.json.gz')), 'skipped an item already on disk');
  let same = 0, diff = [];
  const ids = (await storage.listJSONFiles(dir)).map(f => f.slice(0, -5));
  for (const id of ids) {
    const a = JSON.stringify(await storage.readDirItem(dir, id)), b = JSON.stringify(await storage.readDirItem(real, id));
    a === b ? same++ : diff.push(id);
  }
  ok(diff.length === 0 && same === r.imported, `every imported item identical to this PC's: ${same}/${r.imported}` + (diff.length ? ' differ: ' + diff.slice(0, 5) : ''));

  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'genius-pack-'));
  let r2 = null, err = null;
  try { r2 = await storage.importHistoryPack(dir2, base + '/cut'); } catch (e) { err = e; }
  const kept = (await storage.listJSONFiles(dir2)).length;
  ok(kept > 0 && (err || !r2.complete), `cut-off download keeps what arrived (${kept} items) and reports it`);
  let e404 = null; try { await storage.importHistoryPack(dir2, base + '/missing'); } catch (e) { e404 = e; }
  ok(e404 && /404/.test(e404.message), 'missing pack throws (app falls back to normal fetch)');
  server.close();
  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(dir2, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
