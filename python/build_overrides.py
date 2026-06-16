#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_overrides.py — Generate category_overrides.json from RS Wiki data.

Queries the RS Wiki API in batches to get page categories for every item in
latest.json, maps those to GEnius categories, and writes category_overrides.json.
Existing hand-written overrides are preserved and take priority over wiki results.

Usage:
  python build_overrides.py
  python build_overrides.py --data-dir="C:/Users/lette/AppData/Roaming/GEnius/data"
  python build_overrides.py --dry-run        (print without writing)
  python build_overrides.py --limit=100      (test on first 100 items only)

Run time: ~2-3 minutes for all 7,000+ items.
"""

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

import requests

SCRIPT_DIR   = Path(__file__).parent
OVERRIDES_FILE = SCRIPT_DIR / 'category_overrides.json'
WIKI_API     = 'https://runescape.wiki/api.php'
HEADERS      = {'User-Agent': 'GEnius/1.0 (github.com/VonDerThWood/GE-Intelligence; category builder)'}
BATCH_SIZE   = 50
DELAY        = 0.6   # seconds between batches — well within wiki rate limits

# ── Meta-category keywords to discard ────────────────────────────────────────
# These are maintenance / wiki-structure categories, not item type categories.
SKIP_CAT_KEYWORDS = [
    'stub', 'incomplete', 'disambiguation', 'maintenance',
    'pages ', 'articles ', 'template', 'candidates',
    'redirects', 'deprecated', 'historical', 'obsolete',
    'infobox', 'navbox', 'hatnote', 'dynamicpagelist',
    'wikify', 'cleanup', 'references',
]

# ── Wiki category → GEnius category ──────────────────────────────────────────
# Lowercase wiki category name → GEnius category ID.
# Checked as substring matches, so "magic armour" matches "rs3 magic armour" etc.
# More specific entries should come first within each group.
WIKI_TO_GENIUS = {

    # ── Rares ────────────────────────────────────────────────────────────────
    'discontinued items':              'rares',
    'holiday items':                   'rares',

    # ── Treasure Trails ──────────────────────────────────────────────────────
    'treasure trails rewards':         'treasure_trails',
    'clue scroll rewards':             'treasure_trails',
    'treasure trails':                 'treasure_trails',

    # ── Boss ─────────────────────────────────────────────────────────────────
    'boss drops':                      'boss',
    'boss drop':                       'boss',
    'superior dragon':                 'boss',

    # ── Prayer ───────────────────────────────────────────────────────────────
    'bones':                           'prayer',
    'ashes':                           'prayer',
    'ensouled heads':                  'prayer',

    # ── Archaeology ──────────────────────────────────────────────────────────
    'artefacts':                       'archaeology',
    'archaeology materials':           'archaeology',
    'excavation hotspot materials':    'archaeology',
    'chronotes':                       'archaeology',
    'tetracompass':                    'archaeology',

    # ── Codex ────────────────────────────────────────────────────────────────
    'ability codices':                 'codex',
    'ability codex':                   'codex',
    'ability books':                   'codex',

    # ── Overrides / Titles ───────────────────────────────────────────────────
    'cosmetic overrides':              'overrides',
    'title scrolls':                   'overrides',
    'override tokens':                 'overrides',
    'loyalty programme rewards':       'overrides',
    'solomon\'s general store':        'overrides',

    # ── Runes ────────────────────────────────────────────────────────────────
    'runes':                           'runes',
    'combination runes':               'runes',
    'rune essence':                    'runes',
    'necrotic runes':                  'runes',

    # ── Summoning ────────────────────────────────────────────────────────────
    'summoning pouches':               'summoning',
    'summoning scrolls':               'summoning',
    'charms':                          'summoning',
    'summoning ingredients':           'summoning',
    'familiars':                       'summoning',

    # ── Hybrid ───────────────────────────────────────────────────────────────
    'hybrid armour':                   'hybrid',
    'hybrid equipment':                'hybrid',
    'hybrid weapons':                  'hybrid',

    # ── Necromancy (before melee/magic/ranged) ────────────────────────────────
    'necromancy equipment':            'necromancy',
    'necromancy armour':               'necromancy',
    'necromancy weapons':              'necromancy',
    'necromancy off-hand weapons':     'necromancy',
    'death guard':                     'necromancy',
    'deathwarden':                     'necromancy',
    'deathdealer':                     'necromancy',

    # ── Magic ────────────────────────────────────────────────────────────────
    'magic armour':                    'magic',
    'magic weapons':                   'magic',
    'magic equipment':                 'magic',
    'magic off-hand weapons':          'magic',
    'staves':                          'magic',
    'wands':                           'magic',
    'magical staves':                  'magic',
    'magic shields':                   'magic',
    'orbs':                            'magic',
    'books (magic)':                   'magic',

    # ── Melee ────────────────────────────────────────────────────────────────
    'melee armour':                    'melee',
    'melee weapons':                   'melee',
    'melee equipment':                 'melee',
    'melee off-hand weapons':          'melee',
    'melee shields':                   'melee',
    'swords':                          'melee',
    'longswords':                      'melee',
    'scimitars':                       'melee',
    'daggers':                         'melee',
    'maces':                           'melee',
    'battleaxes':                      'melee',
    'warhammers':                      'melee',
    'halberds':                        'melee',
    'spears':                          'melee',
    'two-handed swords':               'melee',
    'claws':                           'melee',
    'platebodies':                     'melee',
    'platelegs':                       'melee',
    'plateskirts':                     'melee',
    'full helms':                      'melee',
    'chainbodies':                     'melee',
    'kiteshields':                     'melee',
    'square shields':                  'melee',

    # ── Ranged ───────────────────────────────────────────────────────────────
    'ranged armour':                   'ranged',
    'ranged weapons':                  'ranged',
    'ranged equipment':                'ranged',
    'ranged off-hand weapons':         'ranged',
    'ranged shields':                  'ranged',
    'bows':                            'ranged',
    'crossbows':                       'ranged',
    'throwing weapons':                'ranged',
    'throwing knives':                 'ranged',
    'death lotus':                     'ranged',

    # ── Ammo ─────────────────────────────────────────────────────────────────
    'ammunition':                      'ammo',
    'arrows':                          'ammo',
    'bolts':                           'ammo',
    'darts':                           'ammo',
    'javelins':                        'ammo',
    'chinchompas':                     'ammo',
    'cannonballs':                     'ammo',

    # ── Pocket ───────────────────────────────────────────────────────────────
    'pocket slot items':               'pocket',
    'scrimshaws':                      'pocket',
    'signs of the porter':             'pocket',
    'portents':                        'pocket',
    'god books':                       'pocket',
    'illuminated god books':           'pocket',
    'brooch':                          'pocket',

    # ── Herblore ─────────────────────────────────────────────────────────────
    'potions':                         'herblore',
    'herbs':                           'herblore',
    'herblore secondary ingredients':  'herblore',
    'herblore ingredients':            'herblore',
    'vials':                           'herblore',
    'flasks':                          'herblore',
    'powerburst potions':              'herblore',

    # ── Smithing ─────────────────────────────────────────────────────────────
    'metal ores':                      'smithing',
    'metal bars':                      'smithing',
    'ores':                            'smithing',
    'bars':                            'smithing',

    # ── Crafting ─────────────────────────────────────────────────────────────
    'uncut gems':                      'crafting',
    'gems':                            'crafting',
    'hides':                           'crafting',
    'leathers':                        'crafting',
    'jewellery':                       'crafting',
    'amulets':                         'crafting',
    'rings':                           'crafting',
    'necklaces':                       'crafting',
    'bracelets':                       'crafting',
    'tiaras':                          'crafting',

    # ── Fletching ────────────────────────────────────────────────────────────
    'fletching':                       'fletching',
    'bows (ustrung)':                  'fletching',
    'crossbow stocks':                 'fletching',
    'crossbow limbs':                  'fletching',

    # ── Food ─────────────────────────────────────────────────────────────────
    'food':                            'food',
    'fish':                            'food',
    'raw fish':                        'food',
    'pies':                            'food',
    'cakes':                           'food',
    'pizzas':                          'food',
    'jellyfish':                       'food',

    # ── Farming ──────────────────────────────────────────────────────────────
    'allotment seeds':                 'farming',
    'herb seeds':                      'farming',
    'tree seeds':                      'farming',
    'fruit tree seeds':                'farming',
    'flower seeds':                    'farming',
    'bush seeds':                      'farming',
    'seeds':                           'farming',
    'saplings':                        'farming',
    'compost':                         'farming',

    # ── Mining / Woodcutting ─────────────────────────────────────────────────
    'logs':                            'mining',
    'woodcutting':                     'mining',
    'mining':                          'mining',
}

# GEnius category priority — when wiki gives multiple matches, pick highest priority.
CATEGORY_PRIORITY = [
    'rares', 'treasure_trails', 'boss',
    'prayer', 'archaeology', 'overrides', 'codex',
    'runes', 'summoning',
    'necromancy', 'hybrid', 'melee', 'magic', 'ranged', 'ammo', 'pocket',
    'herblore', 'smithing', 'crafting', 'fletching',
    'food', 'farming', 'mining',
    'low_tier', 'materials',
]

# If the top-priority match is in this set, return only it — prevents TT items
# also landing in combat tabs, rares landing in crafting, etc.
EXCLUSIVE_CATEGORIES = {'rares', 'treasure_trails', 'overrides', 'codex'}


# ── Helpers ───────────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(description='Build category_overrides.json from RS Wiki')
    p.add_argument('--data-dir', default=None)
    p.add_argument('--dry-run', action='store_true')
    p.add_argument('--limit', type=int, default=0, help='Process only first N items (for testing)')
    return p.parse_args()


def find_latest_json(data_dir_override):
    if data_dir_override:
        p = Path(data_dir_override) / 'latest.json'
        if p.exists():
            return p
        raise FileNotFoundError(f'latest.json not found in {data_dir_override}')
    candidates = [
        Path(os.environ.get('APPDATA', '')) / 'GEnius' / 'data' / 'latest.json',
        SCRIPT_DIR.parent / 'data' / 'latest.json',
    ]
    for c in candidates:
        if c.exists():
            return c
    raise FileNotFoundError(
        'Could not find latest.json.\n'
        'Run the app once to populate it, then pass --data-dir pointing to your GEnius data folder.'
    )


def wiki_name_candidates(item_name):
    """Return a list of wiki page name candidates to try for an item."""
    names = [item_name]
    # Strip dose number: "Super attack (4)" → "Super attack"
    stripped = re.sub(r'\s*\(\d+\)\s*$', '', item_name).strip()
    if stripped and stripped != item_name:
        names.append(stripped)
    # Strip single lowercase letter suffix: "Rune sword (g)" → "Rune sword"
    stripped2 = re.sub(r'\s*\([a-z]\)\s*$', '', item_name).strip()
    if stripped2 and stripped2 != item_name and stripped2 not in names:
        names.append(stripped2)
    return names


def is_meta_category(cat_name):
    cat_lower = cat_name.lower()
    return any(kw in cat_lower for kw in SKIP_CAT_KEYWORDS)


def fetch_categories_batch(titles):
    """
    Query RS Wiki for page categories for a list of titles (max 50).
    Returns dict: { lowercase_page_title: [category_name, ...] }
    Follows redirects automatically.
    """
    params = {
        'action':        'query',
        'titles':        '|'.join(titles),
        'prop':          'categories',
        'cllimit':       '100',
        'redirects':     '1',
        'format':        'json',
        'formatversion': '2',
    }
    try:
        r = requests.get(WIKI_API, params=params, headers=HEADERS, timeout=20)
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        print(f'\n  [wiki] Request error: {e}')
        return {}

    result = {}
    pages = data.get('query', {}).get('pages', [])
    # Build redirect map: original title → resolved title
    redirects = {}
    for rd in data.get('query', {}).get('redirects', []):
        redirects[rd['from'].lower()] = rd['to'].lower()

    for page in pages:
        if page.get('missing'):
            continue
        page_title = page.get('title', '').lower()
        raw_cats = page.get('categories', [])
        cats = [
            c['title'].replace('Category:', '').strip()
            for c in raw_cats
            if not is_meta_category(c['title'].replace('Category:', ''))
        ]
        if cats:
            result[page_title] = cats
            # Also index under the original (pre-redirect) title if applicable
            for orig, resolved in redirects.items():
                if resolved == page_title:
                    result[orig] = cats

    return result


def map_wiki_categories(wiki_cats):
    """
    Map RS Wiki category names to GEnius categories.
    Returns list ordered by CATEGORY_PRIORITY, or [] if nothing matched.
    Exclusive categories (TT, Rares, Boss, etc.) return alone — no combat tags added.
    """
    matched = set()
    for cat in wiki_cats:
        cat_lower = cat.lower()
        for wiki_key, genius_cat in WIKI_TO_GENIUS.items():
            if wiki_key in cat_lower or cat_lower == wiki_key:
                matched.add(genius_cat)
    ordered = [c for c in CATEGORY_PRIORITY if c in matched]
    if ordered and ordered[0] in EXCLUSIVE_CATEGORIES:
        return [ordered[0]]
    return ordered


# ── Main build logic ──────────────────────────────────────────────────────────

# Name prefixes that reliably indicate low-tier (T1–T69) combat gear.
# The RS3 wiki Cargo API is not available externally, so we infer tier from name.
# Ordered roughly by tier; "corrupt" covers corrupt dragon/ancient-warrior items.
LOW_TIER_NAME_PREFIXES = (
    'bronze ',       # T1
    'iron ',         # T10
    'steel ',        # T20
    'black ',        # T25
    'white ',        # T25
    'leather ',      # T20 ranged
    'hardleather',   # T30 ranged
    'studded ',      # T30 ranged
    'mithril ',      # T30
    'batwing ',      # T30 magic
    'ghostly ',      # T30
    'snakeskin ',    # T30 ranged
    'splitbark ',    # T40
    'mystic ',       # T40
    'adamant ',      # T40
    'lunar ',        # T40
    'carapace ',     # T40 ranged
    'green d\'hide', # T40 ranged
    'blue d\'hide',  # T50 ranged
    'rune ',         # T50
    'red d\'hide',   # T60 ranged
    'granite ',      # T50
    'dragon ',       # T60
    'corrupt ',      # T60–T78 (corrupt dragon etc.)
    'ricochet ',     # T60 ammo/ranged
    'green dragonhide ',  # T40 ranged (alt name)
    'blue dragonhide ',   # T50 ranged (alt name)
    'red dragonhide ',    # T60 ranged (alt name)
)


def is_low_tier_by_name(name_lower):
    """Return True if the item name suggests it is T1–T69 combat gear."""
    return any(name_lower.startswith(p) for p in LOW_TIER_NAME_PREFIXES)


def build_overrides(items, limit=0):
    if limit:
        items = items[:limit]
        print(f'[build] Limiting to first {limit} items (test mode)')

    # Deduplicate names
    seen, unique = set(), []
    for it in items:
        name = it.get('name', '').strip()
        if name and name not in seen:
            seen.add(name)
            unique.append(it)

    total = len(unique)
    print(f'[build] {total} unique items to process across {-(-total // BATCH_SIZE)} batches\n')

    overrides     = {}   # name_lower → [genius_cats]
    unmatched     = []   # (name, wiki_cats) — on wiki but no category mapping
    not_on_wiki   = []   # name — page not found at all

    batches = [unique[i:i+BATCH_SIZE] for i in range(0, total, BATCH_SIZE)]

    for idx, batch in enumerate(batches):
        # Collect all candidate titles for this batch
        title_to_name = {}  # lowercase wiki title → original item name
        all_titles = []
        for it in batch:
            for candidate in wiki_name_candidates(it['name']):
                lc = candidate.lower()
                if lc not in title_to_name:
                    title_to_name[lc] = it['name']
                    all_titles.append(candidate)

        wiki_results = fetch_categories_batch(all_titles[:50])  # API max is 50

        matched_count = 0
        for it in batch:
            name = it['name']
            candidates = [c.lower() for c in wiki_name_candidates(name)]

            wiki_cats = None
            for candidate in candidates:
                if candidate in wiki_results:
                    wiki_cats = wiki_results[candidate]
                    break

            if wiki_cats is None:
                not_on_wiki.append(name)
                continue

            genius_cats = map_wiki_categories(wiki_cats)
            if genius_cats:
                overrides[name.lower()] = genius_cats
                matched_count += 1
            else:
                unmatched.append((name, wiki_cats))

        pct = round((idx + 1) / len(batches) * 100)
        print(f'  [{pct:3d}%] Batch {idx+1}/{len(batches)} — {matched_count}/{len(batch)} categorized  '
              f'(total so far: {len(overrides)})', flush=True)

        if idx < len(batches) - 1:
            time.sleep(DELAY)

    # Tag low-tier combat items using name-prefix inference.
    # (RS3 wiki Cargo API is not publicly accessible, so name-based inference is used instead.)
    COMBAT_CATS = {'melee', 'magic', 'ranged', 'necromancy', 'ammo', 'pocket'}
    low_tier_count = 0
    for name_lower, cats in list(overrides.items()):
        if (any(c in COMBAT_CATS for c in cats)
                and 'low_tier' not in cats
                and is_low_tier_by_name(name_lower)):
            overrides[name_lower] = cats + ['low_tier']
            low_tier_count += 1
    print(f'[tiers] Tagged {low_tier_count} items as low_tier (name-prefix inference)')

    return overrides, unmatched, not_on_wiki


def main():
    args = parse_args()

    print('=' * 60)
    print('  GEnius Category Override Builder')
    print('  Querying RS Wiki — this takes ~2-3 minutes')
    print('=' * 60 + '\n')

    latest_path = find_latest_json(args.data_dir)
    data = json.loads(Path(latest_path).read_text(encoding='utf-8'))
    items = data.get('items', [])
    print(f'[build] {len(items)} items loaded from {latest_path}')

    # Load existing hand-written overrides — these take priority
    existing = {}
    if OVERRIDES_FILE.exists():
        try:
            raw = json.loads(OVERRIDES_FILE.read_text(encoding='utf-8'))
            existing = {k: v for k, v in raw.items() if not k.startswith('_')}
            print(f'[build] {len(existing)} existing hand-written overrides loaded (will be preserved)\n')
        except Exception as e:
            print(f'[build] Warning: could not load existing overrides: {e}\n')

    wiki_overrides, unmatched, not_on_wiki = build_overrides(items, limit=args.limit)

    print(f'\n{"=" * 60}')
    print(f'  Wiki-categorized:         {len(wiki_overrides):>5} items')
    print(f'  On wiki, no cat match:    {len(unmatched):>5} items')
    print(f'  Not found on wiki:        {len(not_on_wiki):>5} items')

    # Merge: wiki results first, then existing hand-written overrides overwrite
    merged = {**wiki_overrides, **existing}

    # Apply low_tier tagging to the final merged dict so hand-written entries also get tagged
    COMBAT_CATS = {'melee', 'magic', 'ranged', 'necromancy', 'ammo', 'pocket'}
    low_tier_count = 0
    for name_lower, cats in list(merged.items()):
        if (isinstance(cats, list)
                and any(c in COMBAT_CATS for c in cats)
                and 'low_tier' not in cats
                and is_low_tier_by_name(name_lower)):
            merged[name_lower] = cats + ['low_tier']
            low_tier_count += 1
    print(f'  Low-tier tagged:          {low_tier_count:>5} items (name-prefix inference)')

    merged['_note'] = 'Auto-generated from RS Wiki. Hand-written entries take priority over wiki results.'
    merged['_generated_items'] = len(wiki_overrides)

    print(f'  Final override count:     {len(merged) - 2:>5} items')
    print('=' * 60)

    if args.dry_run:
        print('\n[dry-run] First 30 wiki-derived entries:')
        for k, v in list(wiki_overrides.items())[:30]:
            print(f'  {k:<50} -> {v}')
        print('\n[dry-run] File not written.')
    else:
        OVERRIDES_FILE.write_text(
            json.dumps(merged, indent=2, ensure_ascii=False),
            encoding='utf-8'
        )
        print(f'\n[build] Written -> {OVERRIDES_FILE}')
        print('[build] Rebuild the app (npm run build) to apply changes.')

    # Show unmatched items so we can expand the mapping table over time
    if unmatched:
        print(f'\n[build] Items on wiki but no GEnius category match (showing first 40):')
        print('        These are falling through to Materials — add them to WIKI_TO_GENIUS if needed.\n')
        for name, cats in unmatched[:40]:
            print(f'  {name:<50}  wiki: {[c for c in cats[:4]]}')
        if len(unmatched) > 40:
            print(f'  ... and {len(unmatched) - 40} more')

    print('\n[build] Complete.')


if __name__ == '__main__':
    main()
