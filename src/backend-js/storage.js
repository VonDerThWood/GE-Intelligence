/**
 * Shared persistence layer for main.js, run.js, and api.js.
 *
 * The point of this file: every direct filesystem call across the app
 * funnels through here instead of being scattered everywhere. This is the
 * ONE file a Capacitor/mobile port needs to replace (see storage-capacitor.js)
 * — everything else just calls these same function names and never knows
 * or cares whether they're backed by Node's fs or Capacitor's Filesystem/
 * Preferences plugins underneath.
 *
 * Every function here is async, even on desktop where the underlying fs
 * calls are synchronous — Capacitor's storage APIs are Promise-only (they
 * bridge to native code), so the interface has to be async-everywhere for
 * the two implementations to be truly swappable. This costs nothing on
 * desktop (wrapping an already-fast sync call in a resolved Promise is
 * free in practice) and every caller already awaits these.
 *
 * Two persistence shapes are covered, matching everything GEnius actually
 * stores:
 *   1. Single JSON blob files (settings-ish data: alerts.json,
 *      portfolio.json, latest.json, ath_cache.json, etc.) — readJSON/
 *      writeJSON.
 *   2. A directory of many small per-id JSON files (just the price
 *      history store, data/history/<id>.json — one file per item rather
 *      than one giant blob, see the loadHistory comment in api.js for
 *      why) — listJSONFiles/loadDirBatched/writeDirItem.
 *
 * Writes are always atomic (write to a .tmp file, then rename over the
 * real one) so a crash or power loss mid-write can never leave a
 * half-written, corrupt JSON file behind.
 */

const fs = require('fs');
const path = require('path');

// A handful of files under src/backend-js/data/ (personal_overrides.json,
// untradeable's dev-fallback cache) get __dirname-relative paths computed
// at the call site so the SAME path works unmodified in dev. In a packaged
// build, __dirname for a required module resolves inside the read-only
// app.asar archive — reads there work fine (Electron's asar-patched fs
// serves them transparently), but writes are rejected outright, even
// though `asarUnpack` (see package.json) physically copies these exact
// files to a real, writable mirror at the parallel app.asar.unpacked path.
// asarUnpack does NOT redirect a path string that still says ".../app.asar/..."
// to that mirror — code has to ask for the unpacked path explicitly. This
// resolves any path through that unpacked mirror when running packaged,
// and passes dev paths through unchanged (no "app.asar" segment to find).
// Confirmed for real (2026-07-10): this exact gap made the in-app category
// editor's Save silently no-op in the installed app — the write to the
// asar-internal path failed every time.
function resolveWritable(filePath) {
  const marker = 'app.asar' + path.sep;
  const idx = filePath.indexOf(marker);
  if (idx === -1) return filePath;
  return filePath.slice(0, idx) + 'app.asar.unpacked' + path.sep + filePath.slice(idx + marker.length);
}

async function atomicWrite(filePath, data) {
  const tmp = filePath + '.tmp';
  await fs.promises.writeFile(tmp, data, 'utf8');
  // Windows: antivirus/indexer briefly holding the file makes rename fail
  // with EPERM/EBUSY/EACCES. Seen for real (Ben, 2026-10-08): one such
  // failure on portfolio.json at startup blanked the whole UI. Retry for
  // up to ~2s before giving up.
  for (let i = 0; ; i++) {
    try { await fs.promises.rename(tmp, filePath); return; }
    catch (e) {
      if (i >= 9 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      await new Promise(r => setTimeout(r, 50 * (i + 1)));
    }
  }
}

// Reads a single JSON blob file. Returns `fallback` (default null) if the
// file doesn't exist or fails to parse — callers should pass a fallback
// that matches the shape they actually need (e.g. [] for a list file,
// {} for an object file) rather than checking for null everywhere.
async function readJSON(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

// Writes a single JSON blob file atomically. `pretty` controls
// indentation — used for files a human might actually open (exports,
// alerts, portfolio), skipped for large/internal files where the extra
// whitespace just costs disk space and parse time for no benefit.
async function writeJSON(filePath, data, { pretty = false } = {}) {
  await atomicWrite(filePath, pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data));
}

async function ensureDir(dirPath) {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

// deleteFile exists so callers (api.js) never need their own direct
// `require('fs')` just to prune old backup files — keeping every real
// filesystem call funneled through this one file is the whole point of it
// (see the file comment up top). Quiet no-op if already missing.
async function deleteFile(filePath) {
  try { await fs.promises.unlink(filePath); } catch {}
}

// Lists <name>.json files. A compressed per-item history file (<id>.json.gz,
// v3.0.0) is listed under its plain name, so callers see one entry per item
// whichever format it's in.
async function listJSONFiles(dirPath) {
  try {
    const names = new Set();
    for (const f of await fs.promises.readdir(dirPath)) {
      if (f.endsWith('.json')) names.add(f);
      else if (f.endsWith('.json.gz')) names.add(f.slice(0, -3));
    }
    return [...names];
  } catch {
    return [];
  }
}

// ─── Compact per-item history (v3.0.0, Ben 2026-11-11) ───────────────────
// history-format.js packs a history into columns of differences; gzipped it's
// ~27x smaller and exactly lossless. Readers accept both formats, preferring
// the compressed file when both exist.
const zlib = require('zlib');
const { pack, unpack } = require('./history-format.js');
async function readItemFile(dirPath, id) {
  const gz = path.join(dirPath, `${id}.json.gz`);
  try {
    return unpack(JSON.parse(zlib.gunzipSync(await fs.promises.readFile(gz)).toString('utf8')));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  return unpack(JSON.parse(await fs.promises.readFile(path.join(dirPath, `${id}.json`), 'utf8')));
}
async function atomicWriteBuffer(filePath, buf) {
  const tmp = filePath + '.tmp';
  await fs.promises.writeFile(tmp, buf);
  for (let i = 0; ; i++) {
    try { await fs.promises.rename(tmp, filePath); return; }
    catch (e) {
      if (i >= 9 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      await new Promise(r => setTimeout(r, 50 * (i + 1)));
    }
  }
}
const rmQuiet = async p => { try { await fs.promises.unlink(p); } catch {} };

// Converts every old <id>.json in a directory to <id>.json.gz, one file at a
// time: write the compact file, read it back, check it matches EXACTLY, and
// only then delete the old one. Safe to stop and resume (a crash leaves both,
// and the compact one wins on read only after it was written whole).
async function compactDirItems(dirPath, { onProgress, shouldStop } = {}) {
  const olds = (await fs.promises.readdir(dirPath)).filter(f => /^\d+\.json$/.test(f));
  let done = 0, failed = [];
  for (const f of olds) {
    if (shouldStop && shouldStop()) break;
    const id = f.slice(0, -5);
    try {
      const raw = await fs.promises.readFile(path.join(dirPath, f), 'utf8');
      const points = JSON.parse(raw);
      const gzFile = path.join(dirPath, `${id}.json.gz`);
      await atomicWriteBuffer(gzFile, zlib.gzipSync(JSON.stringify(pack(points)), { level: 9 }));
      const back = unpack(JSON.parse(zlib.gunzipSync(await fs.promises.readFile(gzFile)).toString('utf8')));
      if (JSON.stringify(back) !== JSON.stringify(points)) { await rmQuiet(gzFile); failed.push(id); continue; }
      await fs.promises.unlink(path.join(dirPath, f));
    } catch (e) { failed.push(id); }
    done++;
    if (onProgress && done % 100 === 0) onProgress(done, olds.length);
    if (done % 50 === 0) await new Promise(r => setTimeout(r, 0)); // keep the app responsive
  }
  if (onProgress) onProgress(done, olds.length);
  return { converted: done - failed.length, failed, total: olds.length };
}

// Batched async load of a directory of per-id JSON files into one plain
// object keyed by id (filename minus ".json"). Reads happen in parallel
// within each batch rather than a tight sequential loop — with thousands
// of files, doing them one at a time on desktop blocks the single JS
// thread's *queue* for the entire load even though each individual read is
// async (confirmed for real via Windows Event Viewer AppHangTransient
// events — this exact bug). Batching (rather than firing all reads at
// once) avoids opening thousands of concurrent file handles simultaneously.
async function loadDirBatched(dirPath, { batchSize = 200 } = {}) {
  await ensureDir(dirPath);
  const files = await listJSONFiles(dirPath);
  const out = {};
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    await Promise.all(batch.map(async f => {
      const id = f.slice(0, -5);
      try {
        out[id] = /^\d+$/.test(id) ? await readItemFile(dirPath, id) : JSON.parse(await fs.promises.readFile(path.join(dirPath, f), 'utf8'));
      } catch (e) {
        console.warn(`[storage] Skipping unreadable file ${f} in ${dirPath}:`, e.message);
      }
    }));
    // Confirmed for real (2026-07-09): with 7000+ item history files, this
    // directory alone took ~32 real-world seconds — almost certainly real
    // disk-I/O latency (AV real-time scanning per file open is the classic
    // cause with thousands of small files), not something batching alone
    // fixes. Batching within a batch was already here; what was missing was
    // a yield BETWEEN batches — ~36 batches back-to-back with each batch's
    // 200 parallel reads settling around the same moment is enough
    // synchronous JSON.parse/callback work in a row to read as a frozen
    // window to Windows even though every individual read is async. This
    // doesn't make the load faster, but it keeps the app responsive (no
    // more AppHangTransient) while it runs.
    await new Promise(res => setTimeout(res, 0));
  }
  return out;
}

// Item files are always <numeric id>.json — refuse anything else so an id
// can never become a path (e.g. '../x') no matter which caller passed it.
const isItemFileId = id => /^\d+$/.test(String(id));
// compact: write the compressed format (and remove the old file); otherwise
// the old format (and remove any compressed copy, which would otherwise win
// on read and be stale).
async function writeDirItem(dirPath, id, data, { compact = false } = {}) {
  if (!isItemFileId(id)) return;
  await ensureDir(dirPath);
  if (compact) {
    await atomicWriteBuffer(path.join(dirPath, `${id}.json.gz`), zlib.gzipSync(JSON.stringify(pack(data)), { level: 9 }));
    await rmQuiet(path.join(dirPath, `${id}.json`));
  } else {
    await atomicWrite(path.join(dirPath, `${id}.json`), JSON.stringify(data));
    await rmQuiet(path.join(dirPath, `${id}.json.gz`));
  }
}

async function readDirItem(dirPath, id) {
  if (!isItemFileId(id)) return null;
  try { return await readItemFile(dirPath, id); } catch { return null; }
}

async function pathExists(filePath) {
  try { await fs.promises.access(filePath); return true; }
  catch { return false; }
}

// One-time migration off the old monolithic history.json into the
// per-item directory store — desktop-only concern (a fresh mobile install
// never has this legacy file), so the mobile storage implementation can
// just no-op this.
async function migrateLegacyHistoryFile(legacyFile, targetDir) {
  if (!(await pathExists(legacyFile))) return { migrated: 0 };
  console.log('[history] Migrating from old monolithic history.json to per-item storage...');
  let migrated = 0;
  try {
    const old = JSON.parse(await fs.promises.readFile(legacyFile, 'utf8'));
    for (const [id, points] of Object.entries(old)) {
      try {
        await writeDirItem(targetDir, id, points);
        migrated++;
      } catch (e) {
        console.warn(`[history] Failed to migrate item ${id}:`, e.message);
      }
    }
    await fs.promises.rename(legacyFile, legacyFile + '.pre-migration-backup');
    console.log(`[history] Migration complete: ${migrated} items moved to per-item storage. Old file kept as history.json.pre-migration-backup.`);
  } catch (e) {
    console.error('[history] Failed to parse old history.json, resetting:', e.message);
    try {
      if (await pathExists(legacyFile)) await fs.promises.copyFile(legacyFile, legacyFile + '.corrupt-' + Date.now());
    } catch {}
  }
  return { migrated };
}

// Drop-in replacement for the `electron-store` key/value API (.get(key,
// default) / .set(key, value)) we used to depend on — electron-store
// itself calls Electron's app.getPath() internally, so it can't be reused
// outside an Electron process at all. Construction is async (loading the
// blob once), but .get()/.set() stay fully SYNCHRONOUS afterward — they
// only touch the in-memory copy, with .set() firing off its disk write
// without making the caller wait for it. This matters: dozens of call
// sites across the app call store.get()/.set() inline inside plain
// (non-async) functions, and keeping these synchronous post-construction
// means none of those call sites need to change for this to work on a
// platform (mobile) where the underlying write is async.
async function createKVStore(filePath) {
  const data = await readJSON(filePath, {});
  // Tracks in-flight writes so `flush()` can wait for them — needed because
  // set() below fires its disk write without making the caller wait, so a
  // process killed (or quitting) right after a set() can lose that write
  // entirely. Confirmed for real (Ben, 2026-07-29): a devMode toggle was
  // lost because the app got force-killed (taskkill, for a rebuild/
  // relaunch cycle) before this write had actually landed on disk.
  let pending = Promise.resolve();
  return {
    get(key, fallback) {
      return key in data ? data[key] : fallback;
    },
    set(key, value) {
      data[key] = value;
      // Re-read the file fresh right before writing, rather than blindly
      // overwriting with this instance's in-memory snapshot from startup.
      // Confirmed for real (Ben, 2026-07-17): watchlist and dxpWatchlist
      // both went completely empty after a night of repeated rebuild/
      // reinstall/relaunch cycles — the old behavior wrote the WHOLE
      // in-memory object back out on every .set(), so if two instances
      // ever briefly overlapped (exactly the single-instance-lock race
      // fixed elsewhere this session, before that fix existed), whichever
      // instance wrote last silently clobbered every key the other
      // instance had touched, wholesale. Reading fresh + merging just this
      // one key closes that window down to the vanishingly small case of
      // two writes landing at the literal same instant, instead of it
      // being the default behavior on every single write.
      // Chained onto `pending` (rather than fired independently) so
      // concurrent set() calls' reads/writes serialize instead of racing
      // each other, and so flush() has one promise that resolves only once
      // every queued write — not just the most recent one — is done.
      pending = pending
        .then(() => readJSON(filePath, {}))
        .then(onDisk => {
          onDisk[key] = value;
          return writeJSON(filePath, onDisk, { pretty: true });
        })
        .catch(e =>
          console.error(`[storage] KV store write failed for key "${key}":`, e.message));
    },
    // Waits for every write queued so far to finish. Call this before
    // anything that might end the process (quit, or an external kill from
    // a rebuild script) so a just-toggled setting can't be silently lost.
    flush() {
      return pending;
    },
  };
}

module.exports = {
  atomicWrite, readJSON, writeJSON, ensureDir, pathExists,
  listJSONFiles, loadDirBatched, writeDirItem, readDirItem,
  migrateLegacyHistoryFile, createKVStore, resolveWritable,
  deleteFile,
  compactDirItems,
};
