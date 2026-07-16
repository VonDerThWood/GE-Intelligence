/**
 * Pre-build script: merges Ben's personal in-app category edits into the
 * project's bundled category_overrides.json, so every fresh install gets
 * his corrections automatically — without personal_overrides.json itself
 * needing to be a bundled, reshipped file.
 *
 * personal_overrides.json now lives in the installed app's real userData
 * dir (%AppData%/GEnius/data/), an ordinary writable per-user file same as
 * alerts.json/portfolio.json — see catalogue.js's file comment for why it
 * moved there (it used to live inside src/backend-js/data/, bundled via
 * asarUnpack specifically so it could be both shipped AND writable, which
 * is what caused the category editor's Save to silently no-op in a
 * packaged install: 2026-07-10).
 *
 * This script's OWN job is unchanged in spirit from before: get Ben's
 * local edits into source control before a release. What changed is the
 * destination — instead of copying personal_overrides.json forward as its
 * own separate reshipped file (two files serving one purpose: bulk
 * corrections for every user), his edits get merged directly into
 * category_overrides.json, the one bundled bulk file every install already
 * reads. Personal edits win on conflict, matching the same precedence the
 * app itself uses at runtime. Ben's local personal_overrides.json is left
 * alone (not cleared) — once merged, it's redundant with category_overrides
 * .json but harmless to keep, and clearing it would just be extra risk for
 * no benefit.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const personalPath = path.join(os.homedir(), 'AppData', 'Roaming', 'GEnius', 'data', 'personal_overrides.json');
const bulkPath = path.join(__dirname, '..', 'src', 'backend-js', 'data', 'category_overrides.json');

if (!fs.existsSync(personalPath)) {
  console.log('[prebuild] No personal overrides found, using project category_overrides.json as-is');
} else {
  const personal = JSON.parse(fs.readFileSync(personalPath, 'utf8'));
  const bulk = JSON.parse(fs.readFileSync(bulkPath, 'utf8'));

  const personalKeys = Object.keys(personal);
  if (!personalKeys.length) {
    console.log('[prebuild] Personal overrides file is empty, nothing to merge');
  } else {
    // Preserve the bulk file's existing key order exactly (it's hand-
    // curated and reviewed as a diff over time — NOT strictly alphabetical
    // as-is, e.g. leading-space entries sort differently under JS's default
    // string sort than whatever produced this file originally, so a fresh
    // re-sort touched nearly every line for zero real content change on
    // the first attempt at this). Existing keys get their value updated
    // in place; only genuinely new keys get appended at the end — keeps
    // the diff scoped to what actually changed.
    const merged = { ...bulk };
    let newCount = 0;
    for (const [k, v] of Object.entries(personal)) {
      if (!(k in merged)) newCount++;
      merged[k] = v;
    }
    if (newCount) console.log(`[prebuild]   (${newCount} of those are brand new entries, rest updated existing ones)`);

    fs.writeFileSync(bulkPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
    console.log(`[prebuild] Merged ${personalKeys.length} personal override(s) into category_overrides.json`);
  }
}
