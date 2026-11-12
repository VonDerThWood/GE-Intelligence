// v3.0.0 history compression, end to end on a COPY of some real history files.
//   node scripts/test-history-compaction.js
const os = require('os'), fs = require('fs'), path = require('path');
const storage = require('../src/backend-js/storage.js');
const { createGeniusApi } = require('../src/backend-js/api.js');

let failed = 0;
const ok = (c, m) => { console.log((c ? 'ok  ' : 'FAIL') + ' ' + m); if (!c) failed++; };

(async () => {
  const real = path.join(process.env.APPDATA, 'GEnius', 'data', 'history');
  const ids = (await storage.listJSONFiles(real)).filter(f => /^\d+\.json$/.test(f)).slice(0, 300).map(f => f.slice(0, -5));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'genius-compact-'));
  const hist = path.join(dir, 'history');
  fs.mkdirSync(hist);
  // Real history may already be compact: write old-format copies to convert.
  for (const id of ids) fs.writeFileSync(path.join(hist, id + '.json'), JSON.stringify(await storage.readDirItem(real, id)));
  const original = Object.fromEntries(ids.map(id => [id, fs.readFileSync(path.join(hist, id + '.json'), 'utf8')]));

  const store = await storage.createKVStore(path.join(dir, 'config.json'));
  let api = await createGeniusApi({ dataDir: dir, store, platform: 'desktop' });
  api.loadHistory(); await api.historyLoadedPromise;
  const before = await api.getHistoryStatus();

  let ticks = 0;
  const r = await api.compactHistory(() => ticks++);
  ok(r.success && r.converted === ids.length, `converted ${r.converted}/${ids.length}, failed ${r.failed.length}`);
  const files = fs.readdirSync(hist);
  ok(files.every(f => f.endsWith('.json.gz')), 'only compact files left: ' + files.length);
  const sizeOld = Object.values(original).reduce((a, s) => a + Buffer.byteLength(s), 0);
  const sizeNew = files.reduce((a, f) => a + fs.statSync(path.join(hist, f)).size, 0);
  console.log(`     size ${(sizeOld / 1048576).toFixed(1)}MB -> ${(sizeNew / 1048576).toFixed(1)}MB`);

  // A fresh start reads the compact files: same items, same points.
  api = await createGeniusApi({ dataDir: dir, store, platform: 'desktop' });
  api.loadHistory(); await api.historyLoadedPromise;
  const after = await api.getHistoryStatus();
  ok(after.stored === before.stored, `same number of items known after restart: ${after.stored}`);
  const sample = ids.filter((_, i) => i % 15 === 0);
  let same = 0;
  for (const id of sample) if (JSON.stringify(await api.getItemHistory(Number(id))) !== undefined && JSON.stringify(await storage.readDirItem(hist, id)) === original[id]) same++;
  ok(same === sample.length, `readDirItem gives exactly the original for ${same}/${sample.length} sampled items`);

  // The bulk loader used by each fetch (run.js) reads them too.
  const all = await storage.loadDirBatched(hist);
  ok(Object.keys(all).length === ids.length && JSON.stringify(all[ids[0]]) === original[ids[0]], 'loadDirBatched reads the compact files');

  // A save after conversion stays compact; a mixed folder still works.
  const id0 = ids[0];
  const pts = JSON.parse(original[id0]);
  pts.push({ timestamp: pts[pts.length - 1].timestamp + 86400000, price: 123, volume: 4 });
  await storage.writeDirItem(hist, id0, pts, { compact: true });
  ok(!fs.existsSync(path.join(hist, id0 + '.json')) && (await storage.readDirItem(hist, id0)).length === pts.length, 'compact save works and keeps the new point');
  fs.writeFileSync(path.join(hist, '999999999.json'), JSON.stringify([{ timestamp: 1, price: 2, volume: 3 }]));
  ok((await storage.listJSONFiles(hist)).includes('999999999.json') && (await storage.readDirItem(hist, '999999999'))[0].price === 2, 'old and compact files side by side both read');

  // Test mode must never convert.
  const roApi = await createGeniusApi({ dataDir: dir, store, platform: 'desktop', readOnlyHistory: true });
  ok((await roApi.compactHistory()).error, 'refused in test mode (read-only history)');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
