// Cloud sync (cloud-sync.js) end to end, with a folder standing in for Google Drive:
// two separate GEnius data folders ("PC" and "phone") syncing through it.
//   node scripts/test-cloud-sync.js
const os = require('os'), fs = require('fs'), path = require('path');
const storage = require('../src/backend-js/storage.js');
const { createGeniusApi } = require('../src/backend-js/api.js');
const { createCloudSync, createFolderTransport } = require('../src/backend-js/cloud-sync.js');

let failed = 0;
const ok = (c, m) => { console.log((c ? 'ok  ' : 'FAIL') + ' ' + m); if (!c) failed++; };

async function device(name, cloudDir) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `genius-cloud-${name}-`));
  const store = await storage.createKVStore(path.join(dir, 'config.json'));
  const api = await createGeniusApi({ dataDir: dir, store, platform: 'desktop' });
  const cloud = createCloudSync({ dataDir: dir, store, ...api.sync.state, transport: createFolderTransport(cloudDir), deviceName: name });
  const add = (id, item, qty) => api.savePosition({ id, status: 'open', item_name: item, quantity: qty, cost_basis: 100 });
  const names = async () => (await api.getPortfolio()).positions.filter(p => p.status === 'open').map(p => `${p.item_name} ${p.quantity}`).sort().join(', ');
  return { api, cloud, add, names, store, dir };
}

(async () => {
  const cloudDir = fs.mkdtempSync(path.join(os.tmpdir(), 'genius-cloud-drive-'));
  const pc = await device('PC', cloudDir), phone = await device('phone', cloudDir);

  await pc.add('a', 'Rune bar', 100);
  let r = await pc.cloud.syncNow();
  ok(r.success && r.uploaded, 'first device creates the cloud file');

  await phone.add('x', 'Coal', 5); // phone had its own data before joining
  r = await phone.cloud.syncNow();
  ok(r.success && r.changed && await phone.names() === 'Rune bar 100', 'joining device takes the cloud copy: ' + await phone.names());
  ok(fs.readdirSync(path.join(phone.dir, 'autobackups')).some(f => /^pre-restore-/.test(f)), 'a backup was made before replacing the phone data');

  await phone.add('b', 'Iron bar', 10);
  await pc.add('c', 'Steel bar', 7);
  await pc.cloud.syncNow();
  await phone.cloud.syncNow();
  await pc.cloud.syncNow();
  ok(await pc.names() === 'Iron bar 10, Rune bar 100, Steel bar 7', 'both sides\' new positions end up on the PC: ' + await pc.names());
  ok(await phone.names() === 'Iron bar 10, Rune bar 100, Steel bar 7', '...and on the phone: ' + await phone.names());

  await phone.api.sellPosition({ id: 'a', sell_price: 6000, quantity: 40 });
  await phone.cloud.syncNow(); await pc.cloud.syncNow();
  ok(await pc.names() === 'Iron bar 10, Rune bar 60, Steel bar 7', 'a sale on the phone reaches the PC: ' + await pc.names());

  await pc.api.deletePosition('b');
  await pc.cloud.syncNow(); await phone.cloud.syncNow();
  ok(await phone.names() === 'Rune bar 60, Steel bar 7', 'a delete on the PC reaches the phone: ' + await phone.names());

  r = await pc.cloud.syncNow();
  ok(r.success && !r.uploaded && !r.changed, 'an idle sync writes nothing');

  // Wiped phone must not wipe the cloud: suspicious guard.
  for (const id of ['d', 'e', 'f', 'g']) await pc.add(id, 'Item ' + id, 1);
  await pc.cloud.syncNow(); await phone.cloud.syncNow();
  const pf = await phone.api.getPortfolio();
  for (const p of pf.positions) await phone.api.deletePosition(p.id);
  r = await phone.cloud.syncNow();
  ok(r.error === 'suspicious', 'a wiped phone is stopped instead of wiping the cloud: ' + JSON.stringify(r));
  r = await phone.cloud.syncNow({ useCloud: true });
  ok(r.success && (await phone.names()).includes('Rune bar 60'), '"replace with the cloud copy" restores the phone');

  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
