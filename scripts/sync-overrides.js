/**
 * Pre-build script: pulls category_overrides.json from the installed app
 * back into the project so user edits are baked into the next release.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const installed = path.join(
  os.homedir(),
  'AppData', 'Local', 'Programs', 'GEnius',
  'resources', 'python', 'category_overrides.json'
);

const project = path.join(__dirname, '..', 'python', 'category_overrides.json');

if (fs.existsSync(installed)) {
  fs.copyFileSync(installed, project);
  console.log('[prebuild] Synced category_overrides.json from installed app → project');
} else {
  console.log('[prebuild] No installed overrides found, using project copy as-is');
}
