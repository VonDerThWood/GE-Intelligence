// End-to-end test of src/backend-js/sync.js: a PC and two phones in temp
// folders, talking over real local HTTP. Run: node scripts/test-sync.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { createSync } = require('../src/backend-js/sync.js');
const storage = require('../src/backend-js/storage.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'genius-sync-'));
const pos = (id, over = {}) => ({ id, item_name: `item${id}`, status: 'open', quantity: 100, cost_basis: 10, ...over });

function device(name, positions) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir);
  const pf = path.join(dir, 'portfolio.json');
  const mem = {};
  const store = { get: (k, d) => (k in mem ? mem[k] : d), set: (k, v) => { mem[k] = v; } };
  fs.writeFileSync(pf, JSON.stringify({ positions, buy_goals: [], tax_stats: { lifetime_tax: 0 } }));
  fs.writeFileSync(path.join(dir, 'alerts.json'), '[]');
  const read = () => JSON.parse(fs.readFileSync(pf, 'utf8'));
  const sync = createSync({ dataDir: dir, store,
    writePortfolio: d => storage.writeJSON(pf, d), buildExportBundle: async () => ({ version: 1, portfolio: read() }) });
  return { name, dir, store, sync, read, write: d => fs.writeFileSync(pf, JSON.stringify(d)), ids: () => read().positions.map(p => p.id).sort() };
}
const post = async (url, body) => {
  const r = await fetch(url, { method: 'POST', body: JSON.stringify(body) });
  return { status: r.status, data: await r.json() };
};
let t = 0;
const run = async (name, fn) => { await fn(); t++; console.log(`ok  ${name}`); };

(async () => {
  const pc = device('pc', [pos('1'), pos('2'), pos('3')]);
  const pixel = device('pixel', [pos('old')]);
  const moto = device('moto', []);
  let hubChanged = 0;
  const server = http.createServer((req, res) => {
    let s = '';
    req.on('data', d => { s += d; });
    req.on('end', async () => {
      const out = await pc.sync.handleRequest(req.url, s ? JSON.parse(s) : null, () => { hubChanged++; });
      res.writeHead(out.status); res.end(JSON.stringify(out.body));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const pair = (d, code) => d.sync.pairWith({ host: '127.0.0.1', port, code, name: d.name }, post);

  await run('pairing is refused unless the PC is pairing', async () => {
    assert.ok((await pair(pixel, 'WRONGCODE')).error);
  });
  await run('a wrong code is refused, the right one works, once', async () => {
    const { code } = pc.sync.startPairing();
    assert.strictEqual((await pair(pixel, 'WRONGCODE')).error, 'bad_code');
    assert.strictEqual((await pair(pixel, code)).success, true);
    assert.ok((await pair(moto, code)).error);
  });
  await run('too many wrong codes end the pairing', async () => {
    const { code } = pc.sync.startPairing();
    for (let i = 0; i < 5; i++) await pair(moto, 'WRONGCODE');
    assert.ok((await pair(moto, code)).error);
    assert.strictEqual(pc.sync.listDevices().length, 1);
  });
  await run('an unpaired device cannot sync, and forged requests are refused', async () => {
    assert.strictEqual((await moto.sync.syncNow(post)).error, 'not_paired');
    const r = await post(`http://127.0.0.1:${port}/sync`, { d: pixel.store.get('syncClient').deviceId, c: 'AAAA.AAAA' });
    assert.strictEqual(r.status, 403);
  });
  await run('first sync: the PC is the starting point, phone data is backed up', async () => {
    const r = await pixel.sync.syncNow(post);
    assert.strictEqual(r.success, true);
    assert.deepStrictEqual(pixel.ids(), ['1', '2', '3']);
    assert.deepStrictEqual(pc.ids(), ['1', '2', '3']);
    const backups = fs.readdirSync(path.join(pixel.dir, 'autobackups'));
    assert.ok(backups.length === 1 && JSON.parse(fs.readFileSync(path.join(pixel.dir, 'autobackups', backups[0]))).portfolio.positions[0].id === 'old');
  });
  await run('idle sync changes nothing on either side', async () => {
    const r = await pixel.sync.syncNow(post);
    assert.strictEqual(r.changed, false);
    assert.strictEqual(hubChanged, 0);
  });
  await run('changes on both sides reach both', async () => {
    const a = pc.read(); a.positions.push(pos('pc')); pc.write(a);
    const b = pixel.read(); b.positions.push(pos('ph')); b.positions = b.positions.filter(p => p.id !== '2'); pixel.write(b);
    await pixel.sync.syncNow(post);
    assert.deepStrictEqual(pc.ids(), ['1', '3', 'pc', 'ph']);
    assert.deepStrictEqual(pixel.ids(), ['1', '3', 'pc', 'ph']);
    assert.strictEqual(hubChanged, 1);
  });
  await run('a lost reply does not make PC changes look deleted', async () => {
    const a = pc.read(); a.positions.push(pos('lost')); pc.write(a);
    // The hub merges and answers, but the phone never gets the reply.
    let answered = false;
    await pixel.sync.syncNow(async (u, b) => { await post(u, b); answered = true; throw new Error('wifi dropped'); });
    assert.ok(answered);
    assert.ok(pc.ids().includes('lost'));
    assert.ok(!pixel.ids().includes('lost'));
    await pixel.sync.syncNow(post);
    assert.ok(pc.ids().includes('lost'), 'PC kept it');
    assert.ok(pixel.ids().includes('lost'), 'phone got it');
  });
  await run('a second phone gets the first phone\'s changes through the PC', async () => {
    const { code } = pc.sync.startPairing();
    assert.strictEqual((await pair(moto, code)).success, true);
    await moto.sync.syncNow(post);
    assert.deepStrictEqual(moto.ids(), pc.ids());
    const b = pixel.read(); b.positions.push(pos('fromPixel')); pixel.write(b);
    await pixel.sync.syncNow(post);
    await moto.sync.syncNow(post);
    assert.ok(moto.ids().includes('fromPixel'));
  });
  await run('a wiped phone is stopped, and the PC keeps its data', async () => {
    const before = pc.ids();
    const b = moto.read(); b.positions = []; moto.write(b);
    assert.strictEqual((await moto.sync.syncNow(post)).error, 'suspicious');
    assert.deepStrictEqual(pc.ids(), before);
    assert.strictEqual((await moto.sync.syncNow(post, { startOver: true })).success, true);
    assert.deepStrictEqual(moto.ids(), before);
  });
  await run('an unknown rev is refused rather than guessed', async () => {
    moto.store.set('syncClient', { ...moto.store.get('syncClient'), lastRev: 'nonsense' });
    assert.strictEqual((await moto.sync.syncNow(post)).error, 'out_of_step');
  });
  await run('unpairing cuts a phone off', async () => {
    pc.sync.unpairDevice(moto.store.get('syncClient').deviceId);
    await new Promise(r => setTimeout(r, 50));
    assert.strictEqual((await moto.sync.syncNow(post, { startOver: true })).error, 'not_paired');
  });

  server.close();
  fs.rmSync(root, { recursive: true, force: true });
  console.log(`All ${t} sync tests passed`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
