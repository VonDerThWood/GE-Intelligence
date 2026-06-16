"""
Fetches untradeable item prices from two RS Wiki sources:
  1. RS:Material_prices  — 86 Invention components
  2. Combination_potions — untradeable combination potions
"""

import urllib.request
import json
import re
import os
import time

_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_PATH = os.path.join(_DIR, '..', 'data', 'untradeable.json')
CACHE_TTL = 86400  # 24 hours

_HEADERS = {'User-Agent': 'GEnius-app/1.2 (RS3 GE tracker; contact: letterslive@gmail.com)'}

# ── Components ────────────────────────────────────────────────────────────────

_COMP_URL = 'https://runescape.wiki/w/RS:Material_prices'

_COMP_ROW_RE = re.compile(
    r'<tr\s+id="[^"]+">.*?'
    r'<td[^>]*>.*?'
    r'<a href="/w/[^"]*" title="([^"]+)">[^<]+</a>'   # name
    r'\s*\n\s*</td>\s*\n'
    r'<td[^>]*>([^<\n]+)\n</td>\s*\n'                  # rarity
    r'<td[^>]*><span class="coins[^"]*">([0-9,]+)</span></td>',  # price
    re.DOTALL
)

def _fetch_components(html):
    results = []
    seen = set()
    for m in _COMP_ROW_RE.finditer(html):
        name   = m.group(1).strip()
        rarity = m.group(2).strip().lower()
        price  = int(m.group(3).replace(',', ''))
        if name not in seen:
            seen.add(name)
            results.append({'name': name, 'price': price, 'rarity': rarity,
                            'categories': ['invention']})
    return results

# ── Combination potions ───────────────────────────────────────────────────────

_POTION_URL = 'https://runescape.wiki/w/Combination_potions'

# Each row: plinkt-link name, then last coins span = calculated cost
# X_mark.svg in row = untradeable
_POTION_ROW_RE = re.compile(
    r'<tr>\s*\n<td class="plinkt-image">.*?'
    r'<td class="plinkt-link"><a href="/w/[^"]*" title="([^"]+)">[^<]+</a>',
    re.DOTALL
)
_COINS_RE   = re.compile(r'<span class="coins[^"]*">([0-9,]+(?:\.[0-9]+)?)</span>')
_UNTRADE_RE = re.compile(r'X_mark\.svg')

_POTION_EXTRA_CATS = {
    'elder overload potion':   ['herblore', 'supplies'],
    'elder overload salve':    ['herblore', 'supplies'],
    'aggroverload':            ['herblore', 'supplies'],
    'holy aggroverload':       ['herblore', 'supplies'],
    'overload salve':          ['herblore', 'supplies'],
    'supreme overload potion': ['herblore', 'supplies'],
    'supreme overload salve':  ['herblore', 'supplies'],
    'replenishment potion':    ['herblore', 'supplies'],
    'enhanced replenishment potion': ['herblore', 'supplies'],
}

def _fetch_potions(html):
    results = []
    seen = set()
    # Split into rows
    rows = re.split(r'(?=<tr>\s*\n<td class="plinkt-image">)', html)
    for row in rows:
        name_m = _POTION_ROW_RE.search(row)
        if not name_m:
            continue
        name = name_m.group(1).strip().replace('&#39;', "'").replace('&amp;', '&')
        if name in seen:
            continue
        # Must have the untradeable X mark
        if not _UNTRADE_RE.search(row):
            continue
        # Last coins span = calculated production cost
        coins = _COINS_RE.findall(row)
        if not coins:
            continue
        try:
            price = int(float(coins[-1].replace(',', '')))
        except ValueError:
            continue
        seen.add(name)
        cats = _POTION_EXTRA_CATS.get(name.lower(), ['herblore'])
        results.append({'name': name, 'price': price, 'rarity': None,
                        'categories': cats})
    return results

# ── One-off untradeable items ─────────────────────────────────────────────────
# Each entry: (name, wiki_slug, categories, cost_label)
# cost_label: 'Calculated value' or 'Total cost' — which infobox row to read

_MISC_ITEMS = [
    ('Blessed flask',             'Blessed_flask',           ['supplies'],             'calcvalue'),
    ('Extreme prayer potion (3)', 'Extreme_prayer_potion',   ['herblore', 'supplies'], 'Total cost'),
]

# calcvalue: infobox data-attr-param="calcvalue" pattern (Blessed Flask style)
_CALCVALUE_RE  = re.compile(r'data-attr-param="calcvalue"[^>]*>([0-9,]+)')
# Total cost: inline table row pattern
_TOTALCOST_RE  = re.compile(r'Total cost.*?>([0-9,]+(?:\.[0-9]+)?)</td>', re.DOTALL)
_COINS_SPAN_RE = re.compile(r'<span class="coins[^"]*">([0-9,]+)</span>')

def _fetch_misc_items():
    results = []
    for name, slug, cats, label in _MISC_ITEMS:
        try:
            html = _fetch(f'https://runescape.wiki/w/{slug}')
            raw = None
            if label == 'calcvalue':
                m = _CALCVALUE_RE.search(html)
                if m: raw = m.group(1)
            else:
                m = _TOTALCOST_RE.search(html)
                if m:
                    block = m.group(0)
                    cs = _COINS_SPAN_RE.search(block)
                    raw = cs.group(1) if cs else m.group(1)
            if raw:
                price = int(float(raw.replace(',', '')))
                results.append({'name': name, 'price': price, 'rarity': None, 'categories': cats})
                print(f'[untradeable] {name}: {price:,}gp')
            else:
                print(f'[untradeable] {name}: cost not found')
        except Exception as e:
            print(f'[untradeable] {name} fetch failed: {e}')
    return results

# ── Shared ────────────────────────────────────────────────────────────────────

def _fetch(url):
    req = urllib.request.Request(url, headers=_HEADERS)
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.read().decode('utf-8')

def _to_item(entry, nature_rune_price=0):
    item = {
        'id': f"untradeable_{entry['name'].lower().replace(' ', '_')}",
        'name': entry['name'],
        'categories': entry['categories'],
        'high': entry['price'],
        'low': entry['price'],
        'alch': None,
        'limit': None,
        'volume': None,
        'avgVolume': None,
        'change_1d': None,
        'members': True,
        'untradeable': True,
        'natureRunePrice': nature_rune_price,
        'signals': [],
    }
    if entry.get('rarity'):
        item['rarity'] = entry['rarity']
    return item

def load(nature_rune_price=0, force=False):
    cache_file = os.path.abspath(CACHE_PATH)
    os.makedirs(os.path.dirname(cache_file), exist_ok=True)

    if not force and os.path.exists(cache_file):
        if time.time() - os.path.getmtime(cache_file) < CACHE_TTL:
            try:
                return json.load(open(cache_file, encoding='utf-8'))
            except Exception:
                pass

    all_entries = []
    try:
        all_entries += _fetch_components(_fetch(_COMP_URL))
        print(f'[untradeable] {len(all_entries)} components fetched')
    except Exception as e:
        print(f'[untradeable] Components fetch failed: {e}')

    try:
        potions = _fetch_potions(_fetch(_POTION_URL))
        print(f'[untradeable] {len(potions)} untradeable potions fetched')
        all_entries += potions
    except Exception as e:
        print(f'[untradeable] Potions fetch failed: {e}')

    all_entries += _fetch_misc_items()

    if not all_entries:
        if os.path.exists(cache_file):
            return json.load(open(cache_file, encoding='utf-8'))
        return []

    items = [_to_item(e, nature_rune_price) for e in all_entries]
    with open(cache_file, 'w', encoding='utf-8') as f:
        json.dump(items, f, indent=2, ensure_ascii=False)
    return items


if __name__ == '__main__':
    items = load(force=True)
    comps    = [i for i in items if 'invention' in i['categories']]
    potions  = [i for i in items if 'herblore'  in i['categories']]
    print(f'\n{len(comps)} components, {len(potions)} potions — {len(items)} total\n')
    print('── Potions ──')
    for it in potions:
        print(f"  {it['name']:45}  {it['high']:>12,}gp")
    print('\n── Components (first 10) ──')
    for it in comps[:10]:
        print(f"  {it.get('rarity',''):10}  {it['name']:40}  {it['high']:>12,}gp")
