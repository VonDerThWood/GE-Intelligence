"""
Fetches the 6 RS Wiki Grand Exchange market indexes:
  Common Trade Index, Rune Index, Log Index, Food Index, Metal Index, Herb Index
Source: https://runescape.wiki/w/RuneScape:Grand_Exchange_Market_Watch
"""

import urllib.request
import json
import re
import os
import time

_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_PATH = os.path.join(_DIR, '..', 'data', 'market_watch.json')
CACHE_TTL = 3600  # 1 hour

_URL = 'https://runescape.wiki/w/RuneScape:Grand_Exchange_Market_Watch'
_HEADERS = {'User-Agent': 'GEnius-app/1.2 (RS3 GE tracker; contact: letterslive@gmail.com)'}

_INDEX_NAMES = [
    'Common Trade Index',
    'Rune Index',
    'Log Index',
    'Food Index',
    'Metal Index',
    'Herb Index',
]

_ROW_RE    = re.compile(r'<tr[^>]*>(.*?)</tr>', re.DOTALL)
_NAME_RE   = re.compile(r'>(' + '|'.join(re.escape(n) for n in _INDEX_NAMES) + r')</a>')
_VALUE_RE  = re.compile(r'<td>\s*([\d,]+\.[\d]+)\s*</td>')
_DIR_RE    = re.compile(r'(Up|Down|Neutral)\.svg', re.IGNORECASE)
# Change: optional +/- prefix, allow +-0.00 style (treat +- as 0)
_CHANGE_RE = re.compile(r'&#160;([+\-]?[+\-]?[\d,]+\.[\d]+)')


def _parse(html):
    results = []
    seen = set()
    for row_m in _ROW_RE.finditer(html):
        row = row_m.group(1)
        name_m = _NAME_RE.search(row)
        if not name_m:
            continue
        name = name_m.group(1)
        if name in seen:
            continue
        seen.add(name)

        value_m  = _VALUE_RE.search(row)
        dir_m    = _DIR_RE.search(row)
        change_m = _CHANGE_RE.search(row)

        if not value_m:
            continue

        value     = float(value_m.group(1).replace(',', ''))
        direction = dir_m.group(1).lower() if dir_m else 'neutral'

        raw_change = change_m.group(1) if change_m else '0'
        # Handle +-X.XX (wiki quirk for near-zero) — treat as 0
        raw_change = raw_change.lstrip('+-') if raw_change.startswith('+-') or raw_change.startswith('-+') else raw_change
        try:
            change = float(raw_change.replace(',', ''))
            if change_m and change_m.group(1).startswith('-') and not raw_change.startswith('-'):
                change = -change
        except ValueError:
            change = 0.0

        # Re-derive direction from change if SVG wasn't found
        if not dir_m:
            direction = 'up' if change > 0 else 'down' if change < 0 else 'neutral'

        results.append({
            'name': name,
            'value': value,
            'change': change,
            'direction': direction,
        })

    order = {n: i for i, n in enumerate(_INDEX_NAMES)}
    results.sort(key=lambda x: order.get(x['name'], 99))
    return results


def load(force=False):
    cache_file = os.path.abspath(CACHE_PATH)
    os.makedirs(os.path.dirname(cache_file), exist_ok=True)

    if not force and os.path.exists(cache_file):
        if time.time() - os.path.getmtime(cache_file) < CACHE_TTL:
            try:
                return json.load(open(cache_file, encoding='utf-8'))
            except Exception:
                pass

    try:
        req = urllib.request.Request(_URL, headers=_HEADERS)
        with urllib.request.urlopen(req, timeout=15) as r:
            html = r.read().decode('utf-8')
    except Exception as e:
        print(f'[market_watch] Fetch failed: {e}')
        if os.path.exists(cache_file):
            return json.load(open(cache_file, encoding='utf-8'))
        return []

    indexes = _parse(html)
    print(f'[market_watch] {len(indexes)} indexes fetched')

    if not indexes:
        if os.path.exists(cache_file):
            return json.load(open(cache_file, encoding='utf-8'))
        return []

    with open(cache_file, 'w', encoding='utf-8') as f:
        json.dump(indexes, f, indent=2)
    return indexes


if __name__ == '__main__':
    data = load(force=True)
    print(f'\n{len(data)} indexes:\n')
    for idx in data:
        arrow = '^' if idx['direction'] == 'up' else 'v' if idx['direction'] == 'down' else '='
        sign = '+' if idx['change'] >= 0 else ''
        print(f"  {idx['name']:25}  {idx['value']:>10.2f}  {arrow} {sign}{idx['change']:.2f}")
