/**
 * Pre-build script: pulls personal_overrides.json from the installed app
 * back into the project so Ben's individual in-app category edits are
 * baked into the next release.
 *
 * Deliberately scoped to personal_overrides.json only, NOT the bulk/dev-
 * curated category_overrides.json. The two used to be the same file —
 * a single whole-file copy from "whichever side is newer" sounds safe
 * but isn't: it can only pick ONE side, so it's always one accidental
 * edit away from silently destroying whatever the OTHER side had. That
 * happened for real once (see SESSION_LOG.md, 2026-06-26) — a routine
 * rebuild wiped out an entire session's worth of bulk catalogue fixes
 * by overwriting them with a stale installed copy. Splitting the two
 * concerns into separate files means a blind copy here is actually safe:
 * personal_overrides.json is NEVER touched by bulk/dev edits, only by
 * Ben's own in-app category changer, so the installed copy is always
 * the right source of truth for this one specific file.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const installed = path.join(
  os.homedir(),
  'AppData', 'Local', 'Programs', 'GEnius',
  'resources', 'app.asar.unpacked', 'src', 'backend-js', 'data', 'personal_overrides.json'
);

const project = path.join(__dirname, '..', 'src', 'backend-js', 'data', 'personal_overrides.json');

if (fs.existsSync(installed)) {
  fs.copyFileSync(installed, project);
  console.log('[prebuild] Synced personal_overrides.json from installed app → project');
} else {
  console.log('[prebuild] No installed personal overrides found, using project copy as-is');
}
