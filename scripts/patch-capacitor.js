// Small fixes to Capacitor plugins in node_modules, re-applied after every
// `npm install` (package.json postinstall), since installs replace the files.
// Each patch is idempotent and fails loudly if the plugin source changed
// shape, so an upgrade can't silently drop it.
const fs = require('fs');
const path = require('path');

const patches = [
  {
    // @capacitor/background-runner declares Notification.channelId but never
    // reads it from the JS options, so background notifications always went
    // to the default (sound + vibration) channel. GEnius quiet hours need to
    // send them to its silent channel instead (Ben, 2026-10-18).
    file: 'node_modules/@capacitor/background-runner/android/src/main/java/io/ionic/backgroundrunner/plugin/api/Notification.kt',
    anchor: 'actionTypeId = jsonObject.optString("actionTypeId", null)',
    insert: '        channelId = jsonObject.optString("channelId", null) // patched by scripts/patch-capacitor.js',
  },
];

for (const p of patches) {
  const file = path.join(__dirname, '..', p.file);
  if (!fs.existsSync(file)) { console.log(`[patch-capacitor] skip (not installed): ${p.file}`); continue; }
  let s = fs.readFileSync(file, 'utf8');
  if (s.includes(p.insert.trim())) { console.log(`[patch-capacitor] already applied: ${path.basename(file)}`); continue; }
  const i = s.indexOf(p.anchor);
  if (i < 0) throw new Error(`[patch-capacitor] anchor not found in ${p.file}; the plugin changed, re-check the patch`);
  const eol = s.indexOf('\n', i);
  s = s.slice(0, eol + 1) + p.insert + (s.includes('\r\n') ? '\r\n' : '\n') + s.slice(eol + 1);
  fs.writeFileSync(file, s);
  console.log(`[patch-capacitor] applied: ${path.basename(file)}`);
}
