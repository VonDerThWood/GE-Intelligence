/**
 * cloud-sync.js: sync through one file in the user's own Google Drive
 * (Ben, 2026-11-10: phone sync away from home, no GEnius server, no account of ours).
 *
 * Every device reads the shared file, merges it with its own data and writes the
 * result back. It uses the same three-way merge as home-Wi-Fi sync
 * (sync-merge.js): each device keeps the copy it last agreed with the cloud
 * (its "base", in data/sync/cloud-base.json), so a change on one side is simply
 * taken and only a field changed differently on both sides is a conflict.
 *
 * First sync on a device: if the cloud file exists, this device takes the cloud
 * copy (after a backup), like a phone's first home sync takes the PC's data.
 * Either button in Settings can override that ("use this device's data" /
 * "replace with the cloud copy").
 *
 * The transport is swappable: Drive for real (createDriveTransport), a plain
 * folder for tests (createFolderTransport). Both: read() -> { content, version } | null,
 * write(content) -> void.
 */
const path = require('path');
const storage = require('./storage.js');
const { merge } = require('./sync-merge.js');

const FILE_NAME = 'GEnius sync.json';
const stable = v => Array.isArray(v) ? `[${v.map(stable).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`
  : v === undefined ? 'undefined' : JSON.stringify(v);
const same = (a, b) => stable(a) === stable(b);
const newRev = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function createCloudSync({ dataDir, store, readState, applyIfChanged, withUserData = fn => fn, transport, deviceName = 'GEnius' }) {
  const baseFile = path.join(dataDir, 'sync', 'cloud-base.json');
  let running = null;

  async function syncOnce({ startOver = false, useCloud = false } = {}) {
    const remote = await transport.read();
    if (remote && (!remote.content || !remote.content.state)) return { error: 'The cloud file is not a GEnius sync file' };
    return withUserData(async () => {
      const mine = await readState();
      const base = await storage.readJSON(baseFile, null);
      let merged, conflicts = [];
      if (!remote || startOver) merged = mine;                       // first device, or "use this device's data"
      else if (!base || useCloud) merged = remote.content.state;     // joining: the cloud copy is the starting point
      else if (base.rev === remote.content.rev) merged = mine;       // nobody else changed it: just our changes
      else {
        const r = merge({ base: base.state, hub: remote.content.state, phone: mine });
        if (r.suspicious) return { error: 'suspicious' };
        merged = r.merged; conflicts = r.conflicts;
      }
      // Losing most of the portfolio in one sync is far more likely a wiped device
      // or a bug than a real choice: stop and ask, whichever path got here.
      // ("Use this device's data" is the explicit way through.)
      if (!startOver) {
        const before = Math.max(base?.state?.portfolio?.positions?.length || 0, remote?.content.state.portfolio?.positions?.length || 0);
        if (before >= 5 && (merged.portfolio?.positions?.length || 0) < before / 2) return { error: 'suspicious' };
      }
      const changed = await applyIfChanged(mine, merged);
      let rev = remote?.content.rev, uploaded = false;
      if (!remote || startOver || !same(merged, remote.content.state)) {
        rev = newRev();
        await transport.write({ format: 1, app: 'GEnius', rev, updatedAt: new Date().toISOString(), device: deviceName, state: merged });
        uploaded = true;
      }
      await storage.ensureDir(path.dirname(baseFile));
      await storage.writeJSON(baseFile, { rev, state: merged });
      const result = { success: true, changed, uploaded, conflicts: conflicts.length };
      store.set('cloudSyncLast', { at: Date.now(), ...result });
      if (conflicts.length) store.set('cloudSyncConflicts', [...conflicts, ...(store.get('cloudSyncConflicts', []) || [])].slice(0, 50));
      return result;
    })();
  }
  function syncNow(opts) {
    if (!running) running = syncOnce(opts).catch(e => ({ error: e.message })).finally(() => { running = null; });
    return running;
  }
  return { syncNow, last: () => store.get('cloudSyncLast', null), conflicts: () => store.get('cloudSyncConflicts', []), clearConflicts: () => store.set('cloudSyncConflicts', []) };
}

// A plain folder, for tests (or a folder another tool keeps in sync).
function createFolderTransport(dir) {
  const file = path.join(dir, FILE_NAME);
  return {
    async read() {
      if (!(await storage.pathExists(file))) return null;
      const content = await storage.readJSON(file, null);
      if (content === null) throw new Error('Could not read the cloud file');
      return { content, version: content.rev };
    },
    async write(content) { await storage.ensureDir(dir); await storage.writeJSON(file, content, { pretty: true }); },
  };
}

// Google Drive, drive.file scope: GEnius only sees the file it created itself.
function createDriveTransport({ getToken, store, fetchImpl = (...a) => fetch(...a) }) {
  const api = async (url, opts = {}) => {
    const token = await getToken();
    const res = await fetchImpl(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Google Drive: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
    return res;
  };
  async function findId() {
    const cached = store.get('cloudSyncFileId', null);
    if (cached) {
      const r = await api(`https://www.googleapis.com/drive/v3/files/${cached}?fields=id,trashed`).catch(() => null);
      if (r && !(await r.json()).trashed) return cached;
    }
    const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
    const list = await (await api(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,modifiedTime)&orderBy=modifiedTime desc`)).json();
    const id = list.files?.[0]?.id || null;
    store.set('cloudSyncFileId', id);
    return id;
  }
  return {
    async read() {
      const id = await findId();
      if (!id) return null;
      const content = await (await api(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`)).json();
      return { content, version: content.rev };
    },
    async write(content) {
      const body = JSON.stringify(content);
      const id = await findId();
      if (id) {
        await api(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
        return;
      }
      const boundary = 'genius' + Math.random().toString(36).slice(2);
      const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: FILE_NAME, mimeType: 'application/json' })}\r\n`
        + `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
      const made = await (await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
        method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart })).json();
      store.set('cloudSyncFileId', made.id);
    },
  };
}

module.exports = { createCloudSync, createFolderTransport, createDriveTransport, FILE_NAME };
