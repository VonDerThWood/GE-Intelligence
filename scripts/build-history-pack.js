/**
 * Builds the history pack new installs download on first start (v3.0.0,
 * Ben 2026-11-11): every item's price history from this PC, in one gzipped
 * file, instead of ~7,400 separate WeirdGloop requests.
 *   node scripts/build-history-pack.js            -> dist/history-pack.jsonl.gz
 *   node scripts/build-history-pack.js --upload   -> also attaches it to this
 *     version's GitHub release (v<package.json version>), after CI has published it.
 * REQUIRED before every release (Ben, 2026-11-11). The app downloads it from
 * releases/latest, and tops up the days since it was built by itself.
 */
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const storage = require('../src/backend-js/storage.js');

(async () => {
  const hist = path.join(process.env.APPDATA, 'GEnius', 'data', 'history');
  const out = path.join(__dirname, '..', 'dist', 'history-pack.jsonl.gz');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const t = Date.now();
  const r = await storage.writeHistoryPack(hist, out, { onProgress: (n, of) => process.stdout.write(`\r${n}/${of}`) });
  console.log(`\n${r.items} items -> ${out} (${(fs.statSync(out).size / 1048576).toFixed(1)}MB) in ${((Date.now() - t) / 1000).toFixed(0)}s`);

  if (process.argv.includes('--upload')) {
    const tag = 'v' + require('../package.json').version;
    execFileSync('gh', ['release', 'upload', tag, out, '--clobber'], { stdio: 'inherit' });
    console.log('attached to ' + tag);
  }
})().catch(e => { console.error(e); process.exit(1); });
