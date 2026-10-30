// Copies the plugin into the game's dev_plugins folders, so the client sees
// the latest code. Run after any change, then reload in-game:
//   cd plugin && npm run sync        (then in the game console: prl genius)
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'genius');
const TARGETS = [
  'C:\\ProgramData\\Jagex\\RuneScape-BETA\\dev_plugins\\genius',
  'C:\\ProgramData\\Jagex\\RuneScape\\dev_plugins\\genius',
];

for (const dest of TARGETS) {
  // Skip a client that isn't installed (its Jagex folder doesn't exist).
  if (!fs.existsSync(path.dirname(path.dirname(dest)))) { console.log('skip (not installed):', dest); continue; }
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(SRC, dest, { recursive: true });
  // Check the copy really landed: once plugin.json went missing (likely
  // the game had the folder open), and the client then couldn't find the
  // plugin at all ("not found").
  for (const f of ['plugin.json', 'main.lua']) {
    if (!fs.existsSync(path.join(dest, f))) {
      console.error(`WARNING: ${f} missing in ${dest} - close the game client and run the sync again`);
      process.exitCode = 1;
    }
  }
  console.log('synced ->', dest);
}
