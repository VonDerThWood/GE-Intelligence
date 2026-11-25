/**
 * Capacitor (mobile) implementation of storage.js's interface — same
 * function names/signatures, backed by @capacitor/filesystem (real files
 * in app-private storage) and @capacitor/preferences (for the KV store)
 * instead of Node's fs. This is the ONLY file that needs to differ between
 * the desktop and mobile builds; api.js, run.js, etc. never know which one
 * they're talking to.
 *
 * A bundler alias swaps this in for storage.js when building the mobile
 * web assets (see mobile/build.js) — nothing elsewhere needs to change.
 *
 * Paths used elsewhere in the app are real filesystem-style paths (e.g.
 * "C:/Users/.../data/history/123.json") since that's what desktop's fs
 * needs — Capacitor's Filesystem plugin addresses files by a path string
 * too, just relative to a chosen Directory root, so the same path strings
 * work here once the common dataDir prefix is stripped.
 */

const { Filesystem, Directory, Encoding } = require('@capacitor/filesystem');
const { Preferences } = require('@capacitor/preferences');
const { pack, unpack } = require('./history-format.js');

// All app data lives under Directory.Data (app-private, survives updates,
// removed on uninstall — the mobile equivalent of Electron's userData dir).
const ROOT = Directory.Data;

// api.js builds paths via path.join(dataDir, ...) where dataDir is a real
// absolute desktop path — that prefix is meaningless on mobile, so strip
// it down to a relative path Capacitor's Filesystem can use directly.
// dataDir itself is passed in by whoever constructs the mobile bridge
// (see mobile/bridge.js) and is just a logical root like "genius-data".
let dataDirPrefix = '';
function setDataDirPrefix(prefix) { dataDirPrefix = prefix; }

function relativize(filePath) {
  let p = filePath.replace(/\\/g, '/');
  if (dataDirPrefix && p.startsWith(dataDirPrefix)) {
    p = p.slice(dataDirPrefix.length).replace(/^\/+/, '');
  }
  return p;
}

async function atomicWrite(filePath, data) {
  // Capacitor's Filesystem.writeFile already writes the full file content
  // in one native call (no partial-write window visible to JS the way a
  // multi-step streamed write would have) — there's no separate temp-file/
  // rename step available (or needed) the way Node's fs exposes one.
  // 2026-11-24: writeFile overwrites in place, so a read during the save got half a
  // file (a tester's search went blank: latest.json read mid-save came back empty), and
  // Android killing the app mid-save could leave a truncated file. Write a temp file
  // beside it, then rename it over the real one, as desktop does. If rename isn't
  // possible, fall back to the old direct write so saving never stops working.
  const path = relativize(filePath);
  const tmp = `${path}.${++tmpSeq}.tmp`;
  try {
    await Filesystem.writeFile({ path: tmp, data, directory: ROOT, encoding: Encoding.UTF8, recursive: true });
    await Filesystem.rename({ from: tmp, to: path, directory: ROOT, toDirectory: ROOT });
  } catch (e) {
    try { await Filesystem.deleteFile({ path: tmp, directory: ROOT }); } catch {}
    await Filesystem.writeFile({ path, data, directory: ROOT, encoding: Encoding.UTF8, recursive: true });
  }
}
let tmpSeq = 0;

async function readJSON(filePath, fallback = null) {
  try {
    const path = relativize(filePath);
    const { data } = await Filesystem.readFile({ path, directory: ROOT, encoding: Encoding.UTF8 });
    return JSON.parse(data);
  } catch {
    return fallback;
  }
}

async function writeJSON(filePath, data, { pretty = false } = {}) {
  await atomicWrite(filePath, pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data));
}

async function ensureDir(dirPath) {
  try {
    await Filesystem.mkdir({ path: relativize(dirPath), directory: ROOT, recursive: true });
  } catch {
    // Already exists — Filesystem.mkdir throws in that case, unlike
    // Node's fs.mkdir({recursive:true}) which silently no-ops.
  }
}

// A compressed per-item history file (<id>.json.gz, v3.0.0) is listed under its
// plain name, so callers see one entry per item whichever format it's in (same
// as storage.js on desktop).
async function listJSONFiles(dirPath) {
  try {
    const { files } = await Filesystem.readdir({ path: relativize(dirPath), directory: ROOT });
    const names = new Set();
    for (const f0 of files) {
      const f = typeof f0 === 'string' ? f0 : f0.name;
      if (f.endsWith('.json')) names.add(f);
      else if (f.endsWith('.json.gz')) names.add(f.slice(0, -3));
    }
    return [...names];
  } catch {
    return [];
  }
}

// ─── Compact per-item history on the phone (v3.0.0, 2026-11-16) ─────────
// Same files as desktop (storage.js): <id>.json.gz = gzip(JSON of
// history-format pack()). Node's zlib isn't here, so the WebView's built-in
// CompressionStream / DecompressionStream do the gzip. Files go through the
// Filesystem plugin as base64 (no encoding = binary).
const hasGzip = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
const bytesToB64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
async function gzipText(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function gunzipToText(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}
const itemPath = (dirPath, id, ext) => relativize(dirPath.replace(/\\/g, '/') + `/${id}${ext}`);
async function readGzItem(dirPath, id) {
  const { data } = await Filesystem.readFile({ path: itemPath(dirPath, id, '.json.gz'), directory: ROOT });
  return unpack(JSON.parse(await gunzipToText(b64ToBytes(typeof data === 'string' ? data : await data.text()))));
}
async function writeGzItem(dirPath, id, packedJson) {
  await Filesystem.writeFile({ path: itemPath(dirPath, id, '.json.gz'), data: bytesToB64(await gzipText(packedJson)), directory: ROOT, recursive: true });
}
const rmItem = async (dirPath, id, ext) => { try { await Filesystem.deleteFile({ path: itemPath(dirPath, id, ext), directory: ROOT }); } catch {} };
// Either format; the compressed file wins when both exist (as on desktop).
async function readItemFile(dirPath, id) {
  if (hasGzip()) {
    try { return await readGzItem(dirPath, id); } catch {}
  }
  const { data } = await Filesystem.readFile({ path: itemPath(dirPath, id, '.json'), directory: ROOT, encoding: Encoding.UTF8 });
  return unpack(JSON.parse(data));
}

// Converts every plain <id>.json in a directory to <id>.json.gz, one file at a
// time: write the compact file, read it back, check it matches EXACTLY, and
// only then delete the plain one. Safe to stop and resume. Same contract as
// storage.js compactDirItems.
async function compactDirItems(dirPath, { onProgress, shouldStop } = {}) {
  if (!hasGzip()) throw new Error('no CompressionStream in this WebView');
  let names = [];
  try {
    const { files } = await Filesystem.readdir({ path: relativize(dirPath), directory: ROOT });
    names = files.map(f => (typeof f === 'string' ? f : f.name));
  } catch {}
  const olds = names.filter(f => /^\d+\.json$/.test(f));
  let done = 0; const failed = [];
  for (const f of olds) {
    if (shouldStop && shouldStop()) break;
    const id = f.slice(0, -5);
    try {
      let raw;
      try { raw = (await Filesystem.readFile({ path: itemPath(dirPath, id, '.json'), directory: ROOT, encoding: Encoding.UTF8 })).data; }
      catch { done++; continue; } // a save already converted it
      const points = unpack(JSON.parse(raw));
      await writeGzItem(dirPath, id, JSON.stringify(pack(points)));
      const back = await readGzItem(dirPath, id);
      if (JSON.stringify(back) !== JSON.stringify(points)) {
        // A real mismatch, or a newer save landed meanwhile (that save removes
        // the plain file). Only undo ours when the plain one is still there.
        if (await pathExists(dirPath.replace(/\\/g, '/') + `/${id}.json`)) { await rmItem(dirPath, id, '.json.gz'); failed.push(id); }
        done++; continue;
      }
      await rmItem(dirPath, id, '.json');
    } catch (e) { failed.push(id); }
    done++;
    if (onProgress && done % 100 === 0) onProgress(done, olds.length);
    if (done % 25 === 0) await new Promise(r => setTimeout(r, 0)); // keep the app responsive
  }
  if (onProgress) onProgress(done, olds.length);
  return { converted: done - failed.length, failed, total: olds.length };
}

async function loadDirBatched(dirPath, { batchSize = 50 } = {}) {
  // Smaller default batch than desktop's (200) — each read here is a real
  // bridge call across the JS<->native boundary, not a cheap libuv thread-
  // pool op, so a more conservative batch keeps a few thousand per-item
  // history files from saturating that bridge all at once.
  await ensureDir(dirPath);
  const files = await listJSONFiles(dirPath);
  const out = {};
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    await Promise.all(batch.map(async f => {
      const id = f.slice(0, -5);
      try {
        if (/^\d+$/.test(id)) { out[id] = await readItemFile(dirPath, id); return; } // either history format
        const path = relativize(dirPath) + '/' + f;
        const { data } = await Filesystem.readFile({ path, directory: ROOT, encoding: Encoding.UTF8 });
        out[id] = JSON.parse(data);
      } catch (e) {
        console.warn(`[storage-capacitor] Skipping unreadable file ${f}:`, e.message);
      }
    }));
  }
  return out;
}

// Item files are always <numeric id>.json — refuse anything else so an id
// can never become a path (e.g. '../x') no matter which caller passed it.
const isItemFileId = id => /^\d+$/.test(String(id));
// compact: write the compressed format (and remove the plain file); otherwise
// the plain format (and remove any compressed copy, which would win on read and
// be stale). Same contract as storage.js.
async function writeDirItem(dirPath, id, data, { compact = false } = {}) {
  if (!isItemFileId(id)) return;
  await ensureDir(dirPath);
  if (compact && hasGzip()) {
    await writeGzItem(dirPath, id, JSON.stringify(pack(data)));
    await rmItem(dirPath, id, '.json');
  } else {
    await atomicWrite(dirPath.replace(/\\/g, '/') + `/${id}.json`, JSON.stringify(data));
    await rmItem(dirPath, id, '.json.gz');
  }
}

async function readDirItem(dirPath, id) {
  if (!isItemFileId(id)) return null;
  try { return await readItemFile(dirPath, id); } catch { return null; }
}

async function pathExists(filePath) {
  try {
    await Filesystem.stat({ path: relativize(filePath), directory: ROOT });
    return true;
  } catch {
    return false;
  }
}

// Desktop-only concern (migrating off a legacy single-file history.json
// from a much older release) — a fresh mobile install never has this
// file, so this is always a no-op here.
async function migrateLegacyHistoryFile() {
  return { migrated: 0 };
}

// @capacitor/preferences is a real native key/value store (SharedPreferences
// on Android) — better suited to this than reimplementing one JSON blob
// over Filesystem, and avoids one more full-file read/write on every
// single settings change. Construction is async (one native call to load
// all current keys), but .get()/.set() stay synchronous afterward — see
// storage.js's comment on why that matters (every existing main.js/api.js
// call site assumes synchronous access after construction).
async function createKVStore() {
  const { keys } = await Preferences.keys();
  const data = {};
  await Promise.all(keys.map(async key => {
    const { value } = await Preferences.get({ key });
    try { data[key] = JSON.parse(value); } catch { data[key] = value; }
  }));

  return {
    get(key, fallback) {
      return key in data ? data[key] : fallback;
    },
    set(key, value) {
      data[key] = value;
      Preferences.set({ key, value: JSON.stringify(value) }).catch(e =>
        console.error(`[storage-capacitor] KV store write failed for key "${key}":`, e.message));
    },
  };
}

// storage.js's real resolveWritable remaps a path through Electron's
// app.asar.unpacked mirror — a packaging quirk that doesn't exist on
// Capacitor at all (there's no asar archive; writes go through the
// Filesystem plugin against Directory.Data, always writable). A plain
// passthrough matches storage.js's own behavior for any path that
// doesn't contain "app.asar" in the first place. Confirmed for real
// (2026-08-02): this function was simply missing here entirely —
// untradeable.js calls storage.resolveWritable(...) at MODULE LOAD TIME
// (not inside a function), so requiring it crashed the whole bridge
// bundle before the app ever got off the ground, on every launch — "0gp,
// 0 items, refreshing forever" with no fetch ever able to succeed, since
// the crash happened before api.js even finished initializing.
function resolveWritable(filePath) { return filePath; }

// ─── History pack on the phone (2026-11-15) ────────────────────────
// Same pack desktop uses (storage.js importHistoryPack, built by
// scripts/build-history-pack.js): gzipped lines "<id>\t<packed JSON>", ending
// "#end\t<count>\t<built ISO date>". The phone can't do it the desktop way:
// GitHub's downloads send no CORS headers, and CapacitorHttp's patched fetch
// hands back the whole 60MB body at once (risking the WebView's memory). So:
// download natively straight to a file, read it back 1MB at a time, gunzip with
// the WebView's built-in DecompressionStream, and write each item as the phone's
// normal plain <id>.json. Any failure falls back to the one-by-one fetch.
const PACK_TMP = 'history-pack.tmp.gz';
const CHUNK = 1024 * 1024;
const b64ToBytes = b64 => { const s = atob(b64), out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; };

async function importHistoryPack(dirPath, url, { skip = new Set(), onItem, timeoutMs = 15 * 60000 } = {}) {
  if (typeof DecompressionStream === 'undefined') throw new Error('no DecompressionStream in this WebView');
  await ensureDir(dirPath);
  try { await Filesystem.deleteFile({ path: PACK_TMP, directory: Directory.Cache }); } catch {}
  await Filesystem.downloadFile({ url, path: PACK_TMP, directory: Directory.Cache, connectTimeout: 30000, readTimeout: timeoutMs,
    headers: { 'User-Agent': 'GEnius (github.com/VonDerThWood/GE-Intelligence)' } });
  const { size } = await Filesystem.stat({ path: PACK_TMP, directory: Directory.Cache });
  if (!(size > 1000)) throw new Error('history pack: download too small (' + size + ' bytes)');

  // The file, 1MB at a time, as a byte stream.
  let offset = 0;
  const bytes = new ReadableStream({
    async pull(ctl) {
      if (offset >= size) { ctl.close(); return; }
      const length = Math.min(CHUNK, size - offset);
      const { data } = await Filesystem.readFile({ path: PACK_TMP, directory: Directory.Cache, offset, length });
      offset += length;
      ctl.enqueue(b64ToBytes(typeof data === 'string' ? data : await data.text()));
    },
  });
  const reader = bytes.pipeThrough(new DecompressionStream('gzip')).pipeThrough(new TextDecoderStream()).getReader();

  let imported = 0, complete = false, builtAt = null, error = null, rest = '';
  const dir = dirPath.replace(/\\/g, '/');
  const pending = new Set();
  const put = async (id, json) => {
    let points;
    try { points = unpack(JSON.parse(json)); } catch { return; } // a bad line is skipped; that item gets fetched normally
    if (!Array.isArray(points) || !points.length || !points.every(p => p && typeof p.timestamp === 'number')) return;
    // The pack line already IS the compact format: gzip it as is (v3.0.0).
    if (hasGzip()) await writeGzItem(dirPath, id, json);
    else await atomicWrite(`${dir}/${id}.json`, JSON.stringify(points));
    imported++;
    if (onItem) onItem(id);
  };
  try {
    outer: for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      rest += value;
      let nl;
      while ((nl = rest.indexOf('\n')) >= 0) {
        const line = rest.slice(0, nl); rest = rest.slice(nl + 1);
        const tab = line.indexOf('\t');
        if (tab < 0) continue;
        const id = line.slice(0, tab);
        if (id === '#end') { complete = true; builtAt = line.split('\t')[2] || null; break outer; }
        if (!/^\d+$/.test(id) || skip.has(id)) continue;
        // A few writes in flight at once: each is a bridge call to native.
        const p = put(id, line.slice(tab + 1)).catch(() => {}).finally(() => pending.delete(p));
        pending.add(p);
        if (pending.size >= 8) await Promise.race(pending);
      }
    }
  } catch (e) { error = e.message; } // a cut-short file keeps everything before the break
  await Promise.all(pending);
  try { reader.cancel(); } catch {}
  try { await Filesystem.deleteFile({ path: PACK_TMP, directory: Directory.Cache }); } catch {}
  return { imported, complete, builtAt, error };
}

module.exports = {
  atomicWrite, readJSON, writeJSON, ensureDir, pathExists,
  listJSONFiles, loadDirBatched, writeDirItem, readDirItem,
  migrateLegacyHistoryFile, createKVStore, setDataDirPrefix, resolveWritable,
  importHistoryPack, compactDirItems, canCompact: hasGzip,
};
