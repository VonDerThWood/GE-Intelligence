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
    for name in _get_index(items):
        if name in text_lower:
            found.append(name.title())
            if len(found) >= 5:
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

def fetch_rs3_news(limit=20):
    results = []
    try:
        html = _get('https://services.runescape.com/m=news/latest_news.rss')
        entries = re.findall(r'<item>(.*?)</item>', html, re.DOTALL)
        for entry in entries[:limit]:
            title_m = re.search(r'<title><!\[CDATA\[(.*?)\]\]></title>', entry) or \
                      re.search(r'<title>(.*?)</title>', entry)
            link_m  = re.search(r'<link>(.*?)</link>', entry)
            date_m  = re.search(r'<pubDate>(.*?)</pubDate>', entry)
            if not title_m:
                continue
            title = title_m.group(1).strip()
            title = title.replace('&amp;', '&').replace('&apos;', "'").replace('&quot;', '"').replace('&#39;', "'")
            link  = link_m.group(1).strip() if link_m else ''
            date  = date_m.group(1).strip() if date_m else ''
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
                'mentions': detect_mentions(title),
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
    rs_news = fetch_rs3_news()
    print(f'[news] {len(rs_news)} articles')

    print('[news] Fetching RS Wiki recent changes…')
    wiki = fetch_wiki_changes()
    print(f'[news] {len(wiki)} wiki edits matching items')

    combined = rs_news + wiki
    combined.sort(key=lambda x: x.get('date', ''), reverse=True)
    return combined


if __name__ == '__main__':
    news = fetch_all_news()
    print(f'\nTotal: {len(news)} articles')
    for n in news:
        print(f"  [{n['source']}] {n['date']}  {n['title'][:70]}")
        if n['mentions']:
            print(f"    → {', '.join(n['mentions'])}")
