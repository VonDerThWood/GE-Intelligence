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
  const path = relativize(filePath);
  await Filesystem.writeFile({ path, data, directory: ROOT, encoding: Encoding.UTF8, recursive: true });
}

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

async function listJSONFiles(dirPath) {
  try {
    const { files } = await Filesystem.readdir({ path: relativize(dirPath), directory: ROOT });
    return files.map(f => (typeof f === 'string' ? f : f.name)).filter(f => f.endsWith('.json'));
  } catch {
    return [];
  }
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

async function writeDirItem(dirPath, id, data) {
  await ensureDir(dirPath);
  await atomicWrite(dirPath.replace(/\\/g, '/') + `/${id}.json`, JSON.stringify(data));
}

async function readDirItem(dirPath, id) {
  return readJSON(dirPath.replace(/\\/g, '/') + `/${id}.json`, null);
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

module.exports = {
  atomicWrite, readJSON, writeJSON, ensureDir, pathExists,
  listJSONFiles, loadDirBatched, writeDirItem, readDirItem,
  migrateLegacyHistoryFile, createKVStore, setDataDirPrefix,
};
