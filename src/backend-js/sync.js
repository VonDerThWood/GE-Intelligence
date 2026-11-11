/**
 * sync.js: phone <-> PC sync over the home network (no accounts, no servers).
 *
 * The PC is the hub; each phone talks only to it, and gets other phones'
 * changes through it. Requests and replies are AES-256-GCM encrypted with a key
 * shared at pairing, because the connection itself is plain HTTP on the LAN.
 *
 * Pairing: the PC shows host, port and a short code (as a QR, or to type in).
 * The code encrypts the exchange of the real key, works once, and only for a
 * couple of minutes and a few attempts.
 *
 * Syncing: the hub keeps, per phone, the state they last agreed on (the base
 * for sync-merge.js) and its rev. The phone sends the rev it last APPLIED. The
 * previous base is kept too: if a reply gets lost, the phone's data is still
 * from the previous rev, and comparing it with the newer base would make
 * everything added since look deleted.
 *
 * Network transport lives elsewhere (http server in main.js, native HTTP in the
 * mobile bridge), so all of this can be tested with no devices.
 */
const path = require('path');
const storage = require('./storage.js');
const { merge } = require('./sync-merge.js');

const PAIR_WINDOW_MS = 2 * 60 * 1000;
const PAIR_MAX_ATTEMPTS = 5;
const CLOCK_SKEW_MS = 10 * 60 * 1000;
const BACKUP_DAYS = 15;
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I/L to misread
const enc = new TextEncoder(), dec = new TextDecoder();
const subtle = () => globalThis.crypto.subtle;

const toB64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const randomBytes = n => globalThis.crypto.getRandomValues(new Uint8Array(n));
const newId = () => toB64(randomBytes(12)).replace(/[+/=]/g, '');

const importKey = b64 => subtle().importKey('raw', fromB64(b64), 'AES-GCM', false, ['encrypt', 'decrypt']);
async function seal(key, obj) {
  const iv = randomBytes(12);
  const data = await subtle().encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return `${toB64(iv)}.${toB64(new Uint8Array(data))}`;
}
async function open(key, text) {
  const [iv, data] = String(text).split('.');
  return JSON.parse(dec.decode(await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, key, fromB64(data))));
}
async function codeKey(code) {
  const raw = await subtle().importKey('raw', enc.encode(String(code).toUpperCase().replace(/[^A-Z0-9]/g, '')), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', salt: enc.encode('genius-sync-pair-v1'), iterations: 100000, hash: 'SHA-256' },
    raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
function newCode() {
  const r = randomBytes(8);
  return Array.from(r, b => CODE_CHARS[b % CODE_CHARS.length]).join('');
}
const fresh = ts => Math.abs(Date.now() - Number(ts)) < CLOCK_SKEW_MS;

function createSync({ dataDir, store, writePortfolio, buildExportBundle, withUserData = fn => fn }) {
  const portfolioFile = path.join(dataDir, 'portfolio.json');
  const alertsFile = path.join(dataDir, 'alerts.json');
  const eventsFile = path.join(dataDir, 'dxp_events.json');
  const syncDir = path.join(dataDir, 'sync');
  const backupDir = path.join(dataDir, 'autobackups');
  const baseFile = id => path.join(syncDir, `base-${String(id).replace(/[^\w-]/g, '')}.json`);

  // A missing file is just empty (new phone), but a file that exists and can't
  // be read must stop the sync, never read as "everything was deleted".
  async function readStrict(file, empty) {
    const data = await storage.readJSON(file, null);
    if (data !== null) return data;
    if (await storage.pathExists(file)) throw new Error(`Could not read ${path.basename(file)}`);
    return empty;
  }

  async function readState() {
    return {
      portfolio: await readStrict(portfolioFile, { positions: [], buy_goals: [], tax_stats: null }),
      alerts: await readStrict(alertsFile, []),
      reminders: store.get('reminders', []),
      watchlist: store.get('watchlist', []),
      hiddenItems: store.get('hiddenItems', []),
      dxpWatchlist: store.get('dxpWatchlist', []),
      itemNotes: store.get('itemNotes', {}),
      userShorthands: store.get('userShorthands', {}),
      dxpEvents: await storage.readJSON(eventsFile, []),
    };
  }

  async function writeState(s) {
    await writePortfolio(s.portfolio);
    await storage.writeJSON(alertsFile, s.alerts, { pretty: true });
    for (const k of ['reminders', 'watchlist', 'hiddenItems', 'dxpWatchlist', 'itemNotes', 'userShorthands']) store.set(k, s[k]);
    await storage.writeJSON(eventsFile, s.dxpEvents, { pretty: true });
  }

  // At most one per hour, listed by Settings → Restore like any other backup.
  async function backup() {
    await storage.ensureDir(backupDir);
    const stamp = `${new Date().toISOString().slice(0, 13)}-00`;
    const file = path.join(backupDir, `pre-restore-${stamp}.json`);
    if (!(await storage.pathExists(file))) {
      const now = await buildExportBundle();
      now.backedUpAt = new Date().toISOString();
      await storage.writeJSON(file, now, { pretty: true });
    }
    const cutoff = new Date(Date.now() - BACKUP_DAYS * 86400000).toISOString().slice(0, 10);
    for (const f of await storage.listJSONFiles(backupDir)) {
      const m = f.match(/^pre-restore-(\d{4}-\d{2}-\d{2})T\d{2}-00\.json$/);
      if (m && m[1] < cutoff) await storage.deleteFile(path.join(backupDir, f));
    }
  }

  // Applies only if something actually differs, so idle syncs write nothing.
  async function applyIfChanged(current, next) {
    if (JSON.stringify(current) === JSON.stringify(next)) return false;
    await backup();
    await writeState(next);
    return true;
  }

  // ─── Hub (PC) ───────────────────────────────────────────────────────────
  let pairing = null;
  let queue = Promise.resolve();
  const inOrder = fn => { const run = queue.then(fn, fn); queue = run.catch(() => {}); return run; };
  const devices = () => store.get('syncDevices', {});

  function startPairing() {
    pairing = { code: newCode(), expires: Date.now() + PAIR_WINDOW_MS, attempts: 0 };
    return { code: pairing.code, expires: pairing.expires };
  }
  const cancelPairing = () => { pairing = null; };

  async function handlePair(body) {
    if (!pairing || Date.now() > pairing.expires) return { status: 403, body: { error: 'not_pairing' } };
    if (++pairing.attempts > PAIR_MAX_ATTEMPTS) { pairing = null; return { status: 403, body: { error: 'not_pairing' } }; }
    const key = await codeKey(pairing.code);
    let hello;
    try { hello = await open(key, body.c); } catch { return { status: 403, body: { error: 'bad_code' } }; }
    if (!fresh(hello.ts) || !hello.deviceId) return { status: 403, body: { error: 'bad_code' } };
    pairing = null;
    const secret = toB64(randomBytes(32));
    store.set('syncDevices', { ...devices(), [hello.deviceId]: { name: String(hello.name || 'Phone').slice(0, 60), key: secret, pairedAt: Date.now(), lastSyncAt: null } });
    return { status: 200, body: { c: await seal(key, { key: secret }) } };
  }

  // Whole read-merge-save takes its turn with other portfolio/alert changes.
  const hubSync = (...args) => withUserData(hubSyncInner)(...args);
  async function hubSyncInner(deviceId, lastRev, phoneState) {
    const hubState = await readState();
    const file = baseFile(deviceId);
    const saved = await storage.readJSON(file, null);
    let merged, conflicts = [];
    if (lastRev == null) {
      // First sync (or the phone chose to start over): the PC's data is the
      // starting point. The phone backs up its own data before replacing it.
      merged = hubState;
    } else {
      const base = saved && [saved.current, saved.previous].find(x => x && x.rev === lastRev);
      if (!base) return { error: 'out_of_step' };
      const r = merge({ base: base.state, hub: hubState, phone: phoneState });
      if (r.suspicious) return { error: 'suspicious' };
      merged = r.merged; conflicts = r.conflicts;
      await applyIfChanged(hubState, merged);
    }
    // Same data as last time: keep the rev, so idle syncs don't shuffle bases.
    const unchanged = saved?.current && lastRev === saved.current.rev && JSON.stringify(saved.current.state) === JSON.stringify(merged);
    const rev = unchanged ? saved.current.rev : newId();
    if (!unchanged) {
      await storage.ensureDir(syncDir);
      await storage.writeJSON(file, { current: { rev, state: merged }, previous: saved?.current || null });
    }
    if (conflicts.length) {
      const log = await storage.readJSON(path.join(syncDir, 'conflicts.json'), []);
      const at = Date.now();
      await storage.writeJSON(path.join(syncDir, 'conflicts.json'), [...conflicts.map(c => ({ ...c, at, device: deviceId })), ...log].slice(0, 200), { pretty: true });
    }
    return { rev, state: merged, conflicts: conflicts.length, changedHub: lastRev != null && JSON.stringify(hubState) !== JSON.stringify(merged) };
  }

  // Answers one request. onHubChanged lets the desktop refresh its window.
  async function handleRequest(route, body, onHubChanged) {
    if (route === '/ping') return { status: 200, body: { app: 'genius-sync', v: 1 } };
    if (route === '/pair') return inOrder(() => handlePair(body || {}));
    if (route !== '/sync') return { status: 404, body: { error: 'not_found' } };
    const dev = devices()[body?.d];
    if (!dev) return { status: 403, body: { error: 'not_paired' } };
    const key = await importKey(dev.key);
    let msg;
    try { msg = await open(key, body.c); } catch { return { status: 403, body: { error: 'not_paired' } }; }
    if (!fresh(msg.ts)) return { status: 403, body: { error: 'clock' } };
    const out = await inOrder(async () => {
      try { return await hubSync(body.d, msg.lastRev ?? null, msg.state); }
      catch (e) { return { error: 'hub_failed', detail: e.message }; }
    });
    if (out.error) return { status: 200, body: { c: await seal(key, out) } };
    store.set('syncDevices', { ...devices(), [body.d]: { ...devices()[body.d], lastSyncAt: Date.now() } });
    if (out.changedHub && onHubChanged) onHubChanged();
    return { status: 200, body: { c: await seal(key, out) } };
  }

  const listDevices = () => Object.entries(devices()).map(([id, d]) => ({ id, name: d.name, pairedAt: d.pairedAt, lastSyncAt: d.lastSyncAt }));
  async function unpairDevice(id) {
    const { [id]: _gone, ...rest } = devices();
    store.set('syncDevices', rest);
    await storage.deleteFile(baseFile(id));
  }
  const getConflicts = () => storage.readJSON(path.join(syncDir, 'conflicts.json'), []);
  const clearConflicts = () => storage.writeJSON(path.join(syncDir, 'conflicts.json'), []);

  // ─── Phone ──────────────────────────────────────────────────────────────
  // post(url, bodyObject) -> { status, data } is supplied by the platform.
  const clientInfo = () => store.get('syncClient', null);

  async function pairWith({ host, port, code, name }, post) {
    const key = await codeKey(code);
    const deviceId = clientInfo()?.deviceId || newId();
    const r = await post(`http://${host}:${port}/pair`, { c: await seal(key, { deviceId, name, ts: Date.now() }) });
    if (r.status !== 200 || !r.data?.c) return { error: r.data?.error || 'no_reply' };
    const { key: secret } = await open(key, r.data.c);
    // A re-pair (new PC address) keeps lastRev, so the merge history carries on.
    store.set('syncClient', { ...(clientInfo() || {}), deviceId, host, port, key: secret, lastRev: clientInfo()?.lastRev ?? null, lastSyncAt: clientInfo()?.lastSyncAt ?? null });
    return { success: true };
  }

  let running = null;
  async function syncOnce(post, { startOver = false } = {}) {
    const c = clientInfo();
    if (!c) return { error: 'not_paired' };
    const key = await importKey(c.key);
    const mine = await readState();
    const lastRev = startOver ? null : c.lastRev;
    let r;
    try {
      r = await post(`http://${c.host}:${c.port}/sync`, { d: c.deviceId, c: await seal(key, { ts: Date.now(), lastRev, state: mine }) });
    } catch { return { error: 'unreachable' }; }
    if (r.status !== 200 || !r.data?.c) return { error: r.data?.error || 'unreachable' };
    const out = await open(key, r.data.c);
    if (out.error) return { error: out.error };
    const changed = await withUserData(async () => {
      const now = await readState();
      if (JSON.stringify(now) !== JSON.stringify(mine)) return null; // edited during the sync
      return applyIfChanged(mine, out.state);
    })();
    if (changed === null) return { success: true, changed: false, retry: true };
    // Only after the data is saved. If that fails, the hub still has this rev's
    // predecessor as `previous`, so the next sync merges correctly.
    store.set('syncClient', { ...clientInfo(), lastRev: out.rev, lastSyncAt: Date.now() });
    return { success: true, changed, conflicts: out.conflicts || 0 };
  }
  function syncNow(post, opts) {
    if (!running) running = syncOnce(post, opts).catch(e => ({ error: e.message })).finally(() => { running = null; });
    return running;
  }
  const clientStatus = () => { const c = clientInfo(); return c ? { paired: true, host: c.host, port: c.port, lastSyncAt: c.lastSyncAt } : { paired: false }; };
  const unpairClient = () => store.set('syncClient', null);

  return {
    // hub
    startPairing, cancelPairing, handleRequest, listDevices, unpairDevice, getConflicts, clearConflicts,
    // phone
    pairWith, syncNow, clientStatus, unpairClient,
    // shared with cloud-sync.js: the same safe read and backup-then-save
    state: { readState, applyIfChanged },
  };
}

module.exports = { createSync };
