"""
GEnius News Scraper — RS3 official news + RS Wiki recent changes + Reddit
Detects GE item name mentions in headlines.
"""

import urllib.request
import urllib.parse
import json
import re
import os
from datetime import datetime

_HEADERS = {'User-Agent': 'GEnius-app/1.2 (RS3 GE tracker; contact: letterslive@gmail.com)'}
_DIR = os.path.dirname(os.path.abspath(__file__))

# ─── Update type → affected categories ──────────────────────────────────────

UPDATE_RULES = [
    # Each rule: (keywords_any, update_label, affected_categories)
    (['dxp', 'double xp', 'double experience', 'bonus xp'],
     'DXP Weekend',
     ['herblore', 'summoning', 'construction', 'fletching', 'crafting', 'smithing', 'farming', 'archaeology', 'gathering']),

    (['archaeology', 'digsite', 'dig site', 'excavation', 'artifact', 'chronotes', 'mattock',
      'kharid-et', 'everlight', 'stormguard', 'warforge', 'city of senntisten', 'anachronia'],
     'Archaeology Update',
     ['archaeology', 'gathering']),

    (['new boss', 'new monster', 'raid', 'dungeon', 'slayer creature', 'combat update', 'combat rework',
      'boss encounter', 'boss fight', 'boss drop'],
     'Combat / Boss Update',
     ['boss', 'melee', 'ranged', 'magic', 'necromancy', 'supplies', 'herblore', 'food']),

    (['necromancy', 'ritual', 'ectoplasm', 'necrosis', 'conjure'],
     'Necromancy Update',
     ['necromancy', 'runes', 'prayer', 'supplies']),

    (['herblore', 'potion', 'overload', 'brew'],
     'Herblore Update',
     ['herblore', 'supplies']),

    (['slayer', 'slayer master', 'slayer task'],
     'Slayer Update',
     ['boss', 'melee', 'ranged', 'magic', 'supplies', 'herblore']),

    (['farming', 'seed', 'harvest', 'patch'],
     'Farming Update',
     ['farming', 'gathering', 'supplies']),

    (['mining', 'smithing', 'ore', 'smelting', 'metal'],
     'Mining & Smithing Update',
     ['mining', 'smithing', 'gathering']),

    (['prayer', 'bone', 'ashes', 'altar', 'ensoul'],
     'Prayer Update',
     ['prayer', 'bones', 'ashes']),

    (['summoning', 'familiar', 'pouch', 'charm'],
     'Summoning Update',
     ['summoning', 'supplies']),

    (['invention', 'perk', 'gizmo', 'component', 'disassemble'],
     'Invention Update',
     ['invention', 'supplies']),

    (['construction', 'player owned house', 'poh', 'butler', 'flatpack'],
     'Construction Update',
     ['construction', 'supplies']),

    (['wilderness', 'pvp', 'player vs player', 'bounty hunter'],
     'Wilderness / PvP Update',
     ['melee', 'ranged', 'magic', 'supplies', 'runes']),

    (['treasure trail', 'clue scroll', 'clue reward'],
     'Treasure Trails Update',
     ['treasure_trails', 'rares']),

    (['grand exchange', 'ge update', 'trade update', 'tax', 'ge tax'],
     'Grand Exchange Update',
     ['rares', 'boss', 'melee', 'ranged', 'magic', 'necromancy']),

    (['quest', 'miniquest', 'storyline', 'lore update'],
     'Quest / Lore Update',
     ['supplies', 'herblore', 'melee', 'ranged', 'magic']),

    (['seasonal', 'holiday', 'christmas', 'halloween', 'easter', 'event'],
     'Seasonal Event',
     ['rares', 'supplies']),

    (['graphical', 'rendering', 'visual update', 'client update', 'interface', 'ui update',
      'quality of life', 'qol update', 'bug fix', 'hotfix', 'patch notes', 'game update'],
     'Game Update',
     []),
]

def detect_update_type(title, description=''):
    text = (title + ' ' + description).lower()
    for keywords, label, cats in UPDATE_RULES:
        if any(re.search(r'\b' + re.escape(kw) + r'\b', text) for kw in keywords):
            return label, cats
    return None, []

def get_impacted_items(cats, all_items, limit=10):
    """Return top movers from the given categories, ranked by signal strength then change."""
    if not cats or not all_items:
        return []
    cat_set = set(cats)
    relevant = [it for it in all_items if any(c in cat_set for c in (it.get('categories') or []))]
    signal_rank = {'FRENZY': 0, 'SURGE': 1, 'DUMP': 2, 'MANIPULATED': 3}
    def sort_key(it):
        sigs = it.get('signals') or []
        top = min((signal_rank[s] for s in sigs if s in signal_rank), default=99)
        return (top, -abs(it.get('change_1d') or 0))
    relevant.sort(key=sort_key)
    movers = [it for it in relevant if (it.get('signals') or it.get('change_1d'))]
    return [
        {
            'name': it['name'],
            'change_1d': it.get('change_1d'),
            'signals': [s for s in (it.get('signals') or []) if s in signal_rank],
        }
        for it in movers[:limit]
    ]

# ─── Item name index (built lazily from price cache) ─────────────────────────

_ITEM_INDEX = None

def _get_index(items=None):
    global _ITEM_INDEX
    if _ITEM_INDEX is not None:
        return _ITEM_INDEX
    if items:
        names = [it['name'] for it in items if it.get('name')]
    else:
        try:
            cache = os.path.join(_DIR, '..', 'data', 'latest.json')
            with open(cache, encoding='utf-8') as f:
                data = json.load(f)
            names = [it['name'] for it in data.get('items', []) if it.get('name')]
        except Exception:
            return []
    _ITEM_INDEX = sorted([n.lower() for n in names], key=lambda x: -len(x))
    return _ITEM_INDEX

def detect_mentions(text, items=None):
    text_lower = text.lower()
    found = []
    seen = set()
    for name in _get_index(items):
        if name in text_lower and name not in seen:
            # Skip overly generic single words that produce false positives
            if len(name) <= 3 and name in ('ore', 'log', 'bar', 'axe', 'bow', 'kit', 'dye', 'tar', 'oil', 'ash', 'wax'):
                continue
            seen.add(name)
            found.append(name.title())
            if len(found) >= 15:
                break
    return found

# ─── HTTP helper ─────────────────────────────────────────────────────────────

def _get(url, params=None):
    if params:
        url += '?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers=_HEADERS)
    with urllib.request.urlopen(req, timeout=12) as r:
        return r.read().decode('utf-8')

# ─── RS3 Official News (RSS) ─────────────────────────────────────────────────

def fetch_rs3_news(limit=20, all_items=None):
    results = []
    try:
        html = _get('https://services.runescape.com/m=news/latest_news.rss')
        entries = re.findall(r'<item>(.*?)</item>', html, re.DOTALL)
        for entry in entries[:limit]:
            title_m = re.search(r'<title><!\[CDATA\[(.*?)\]\]></title>', entry) or \
                      re.search(r'<title>(.*?)</title>', entry)
            link_m  = re.search(r'<link>(.*?)</link>', entry)
            date_m  = re.search(r'<pubDate>(.*?)</pubDate>', entry)
            desc_m  = re.search(r'<description><!\[CDATA\[(.*?)\]\]></description>', entry, re.DOTALL) or \
                      re.search(r'<description>(.*?)</description>', entry, re.DOTALL)
            if not title_m:
                continue
            title = title_m.group(1).strip()
            title = title.replace('&amp;', '&').replace('&apos;', "'").replace('&quot;', '"').replace('&#39;', "'")
            link  = link_m.group(1).strip() if link_m else ''
            date  = date_m.group(1).strip() if date_m else ''
            desc_raw = desc_m.group(1) if desc_m else ''
            # Strip HTML tags from description for text scanning
            desc  = re.sub(r'<[^>]+>', ' ', desc_raw).strip()
            try:
                # RSS dates vary: "Mon, 10 Jun 2025 12:00:00 +0000" or "...GMT"
                for fmt in ('%a, %d %b %Y %H:%M:%S %z', '%a, %d %b %Y %H:%M:%S GMT'):
                    try:
                        date = datetime.strptime(date, fmt).strftime('%Y-%m-%d')
                        break
                    except ValueError:
                        continue
                else:
                    # Extract YYYY-MM-DD if possible
                    m = re.search(r'(\d{4}-\d{2}-\d{2})', date)
                    date = m.group(1) if m else date[:10]
            except Exception:
                date = date[:10]
            results.append({
                'source': 'RS3 News',
                'title': title,
                'url': link,
                'date': date,
                'mentions': detect_mentions(title + ' ' + desc),
                'description': desc[:200] if desc else '',
                **( lambda ut, cats: {
                    'update_type': ut,
                    'impact_categories': cats,
                    'impact_items': get_impacted_items(cats, all_items) if all_items else [],
                })(*detect_update_type(title, desc)),
            })
    except Exception as e:
        print(f'[news] RS3 RSS error: {e}')
    return results

# ─── RS Wiki Recent Changes (item pages only) ─────────────────────────────────

def fetch_wiki_changes(limit=10):
    results = []
    try:
        params = {
            'action': 'query', 'list': 'recentchanges',
            'rclimit': 60, 'rcnamespace': '0',
            'rcprop': 'title|timestamp', 'format': 'json',
        }
        data = json.loads(_get('https://runescape.wiki/api.php', params))
        changes = data.get('query', {}).get('recentchanges', [])
        seen = set()
        for ch in changes:
            title = ch.get('title', '')
            if title in seen:
                continue
            seen.add(title)
            mentions = detect_mentions(title)
            if not mentions:
                continue
            ts = ch.get('timestamp', '')
            try:
                date = datetime.fromisoformat(ts.replace('Z', '+00:00')).strftime('%Y-%m-%d %H:%M')
            except Exception:
                date = ts[:16]
            results.append({
                'source': 'RS Wiki',
                'title': f'Wiki updated: {title}',
                'url': f"https://runescape.wiki/w/{title.replace(' ', '_')}",
                'date': date,
                'mentions': mentions,
            })
            if len(results) >= limit:
                break
    except Exception as e:
        print(f'[news] Wiki changes error: {e}')
    return results

# ─── Public API ──────────────────────────────────────────────────────────────

def fetch_all_news(items=None):
    # Seed index with live items if provided by run.py
    if items:
        _get_index(items)

    print('[news] Fetching RS3 official news…')
    rs_news = fetch_rs3_news(all_items=items)
    print(f'[news] {len(rs_news)} articles')

    rs_news.sort(key=lambda x: x.get('date', ''), reverse=True)
    return rs_news


if __name__ == '__main__':
    news = fetch_all_news()
    print(f'\nTotal: {len(news)} articles')
    for n in news:
        print(f"  [{n['source']}] {n['date']}  {n['title'][:70]}")
        if n['mentions']:
            print(f"    → {', '.join(n['mentions'])}")
