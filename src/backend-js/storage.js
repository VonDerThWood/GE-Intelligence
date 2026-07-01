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

async function atomicWrite(filePath, data) {
  const tmp = filePath + '.tmp';
  await fs.promises.writeFile(tmp, data, 'utf8');
  await fs.promises.rename(tmp, filePath);
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

async function listJSONFiles(dirPath) {
  try {
    return (await fs.promises.readdir(dirPath)).filter(f => f.endsWith('.json'));
  } catch {
    return [];
  }
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
        out[id] = JSON.parse(await fs.promises.readFile(path.join(dirPath, f), 'utf8'));
      } catch (e) {
        console.warn(`[storage] Skipping unreadable file ${f} in ${dirPath}:`, e.message);
      }
    }));
  }
  return out;
}

async function writeDirItem(dirPath, id, data) {
  await ensureDir(dirPath);
  await atomicWrite(path.join(dirPath, `${id}.json`), JSON.stringify(data));
}

async function readDirItem(dirPath, id) {
  return readJSON(path.join(dirPath, `${id}.json`), null);
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
  return {
    get(key, fallback) {
      return key in data ? data[key] : fallback;
    },
    set(key, value) {
      data[key] = value;
      writeJSON(filePath, data, { pretty: true }).catch(e =>
        console.error(`[storage] KV store write failed for key "${key}":`, e.message));
    },
  };
}

module.exports = {
  atomicWrite, readJSON, writeJSON, ensureDir, pathExists,
  listJSONFiles, loadDirBatched, writeDirItem, readDirItem,
  migrateLegacyHistoryFile, createKVStore,
};
