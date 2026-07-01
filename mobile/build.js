/**
 * Bundles bridge-src/bridge.js (which pulls in api.js, run.js, catalogue.js,
 * etc. from src/backend-js/) into a single browser-runnable file at
 * mobile/www/bridge.js, then copies the rest of the web assets (index.html,
 * renderer.js, vendor/, assets) into mobile/www/ so `npx cap sync` picks
 * them up.
 *
 * The one thing that makes this possible without touching any of the
 * backend-js source: aliasing the bare `./storage.js` require to
 * `./storage-capacitor.js` at bundle time. Every other file (api.js, run.js,
 * catalogue.js, dxp_intelligence.js, news.js, market_watch.js,
 * untradeable.js) requires storage.js by that exact relative path and never
 * knows the difference.
 */

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WWW = path.join(__dirname, 'www');

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

async function main() {
  fs.rmSync(WWW, { recursive: true, force: true });
  fs.mkdirSync(WWW, { recursive: true });

  const storagePath = path.join(ROOT, 'src', 'backend-js', 'storage.js');
  const storageCapacitorPath = path.join(ROOT, 'src', 'backend-js', 'storage-capacitor.js');

  // esbuild's `alias` option only takes bare package-style names (it's
  // meant for things like "react" -> "preact"), not arbitrary path
  // redirects — a resolver plugin is the actual mechanism for swapping one
  // specific relative-path require for another. Every file in backend-js/
  // requires storage.js by that exact relative path, so this one rule
  // catches all of them regardless of which file does the requiring.
  const swapStoragePlugin = {
    name: 'swap-storage-for-capacitor',
    setup(build) {
      build.onResolve({ filter: /storage\.js$/ }, args => {
        const resolved = path.join(args.resolveDir, args.path);
        if (resolved === storagePath) return { path: storageCapacitorPath };
      });
      // path.join/path.resolve are used throughout backend-js purely for
      // string manipulation (no real OS filesystem semantics needed once
      // storage-capacitor.js strips the dataDir prefix back off — see its
      // file comment) — path-browserify's POSIX-style join/resolve is a
      // perfectly adequate stand-in for that.
      build.onResolve({ filter: /^path$/ }, () => ({
        path: require.resolve('path-browserify'),
      }));
    },
  };

  // The bridge itself — api.js/run.js/etc. and their whole require graph,
  // minus storage.js which gets swapped for the Capacitor-backed version.
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'bridge-src', 'bridge.js')],
    bundle: true,
    outfile: path.join(WWW, 'bridge.js'),
    platform: 'browser',
    format: 'iife',
    target: 'es2020',
    plugins: [swapStoragePlugin],
    // __dirname doesn't exist in a browser at all — esbuild doesn't
    // polyfill it for browser-platform builds (it's not a real bundler
    // concern, it's a Node runtime global). Several backend-js files use
    // it as the root for a path.join(...) — mostly bundled read-only data
    // that's already require()'d directly now (resolved at bundle time,
    // doesn't need __dirname), except personal_overrides.json's path in
    // api.js/catalogue.js. Faking it as a fixed string is harmless: that
    // path just becomes a slightly odd-looking (but perfectly valid and
    // consistent) relative path under Capacitor's Directory.Data once
    // storage-capacitor.js's relativize() doesn't recognize it as needing
    // the dataDir prefix stripped — it still reads/writes correctly, just
    // under a folder named "fake-dirname" instead of mirroring desktop's
    // real backend-js/data folder structure.
    define: { 'process.env.NODE_ENV': '"production"', '__dirname': '"fake-dirname"' },
    logLevel: 'info',
  });

  // renderer.js itself needs zero changes (see the bridge.js file comment) —
  // it only ever calls window.genius.*, never require()/fs directly.
  copyRecursive(path.join(ROOT, 'src', 'vendor'), path.join(WWW, 'vendor'));
  fs.copyFileSync(path.join(ROOT, 'src', 'renderer.js'), path.join(WWW, 'renderer.js'));
  fs.mkdirSync(path.join(WWW, 'assets'), { recursive: true });
  copyRecursive(path.join(ROOT, 'assets'), path.join(WWW, 'assets'));

  // @capacitor/background-runner's `src` config path is relative to the
  // app bundle (webDir), not a real require()/import — it's a plain JS
  // file the OS loads into its own headless context, so it just needs to
  // exist at this path verbatim, no bundling.
  copyRecursive(path.join(__dirname, 'runners'), path.join(WWW, 'runners'));

  // Mobile-specific index.html — same shell as desktop's, minus the
  // Electron-only bits (no titleBarOverlay-related CSS hooks needed) and
  // loading bridge.js before renderer.js so window.genius exists in time.
  const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>GEnius — RS3 Market Intelligence</title>
  <style>html, body { background: #1a1209; margin: 0; }</style>
  <link href="vendor/fonts/fonts.css" rel="stylesheet" />
  <script src="vendor/react.production.min.js" defer></script>
  <script src="vendor/react-dom.production.min.js" defer></script>
  <script src="bridge.js"></script>
</head>
<body>
  <div id="splash" style="position:fixed; inset:0; z-index:99999; background:#1a1209; display:flex; flex-direction:column; align-items:center; justify-content:center; transition:opacity 0.4s ease;">
    <img src="assets/logo-full.png" alt="GEnius" style="width:340px; max-width:80vw; filter:drop-shadow(0 4px 24px rgba(0,0,0,0.6));" />
    <div style="margin-top:18px; color:#9c7b3f; font-family:Georgia,serif; font-size:13px; letter-spacing:2px; text-transform:uppercase;">Loading market data…</div>
  </div>
  <div id="root"></div>
  <script src="renderer.js" defer></script>
</body>
</html>
`;
  fs.writeFileSync(path.join(WWW, 'index.html'), indexHtml, 'utf8');

  console.log('[mobile/build.js] Done — output in mobile/www/');
}

main().catch(e => { console.error(e); process.exit(1); });
