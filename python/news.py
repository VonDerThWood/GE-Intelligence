"""
GEnius News Scraper — RS3 news, wiki edits, Reddit mentions
Detects item names in headlines and flags them.
"""

import requests
import json
import re
from datetime import datetime
from catalogue import get_all_items

HEADERS = {"User-Agent": "GEnius/1.0 RS3 Market Intelligence (github.com/VonDerThWood/GE-Intelligence)"}

# ─── Build item name lookup ────────────────────────────────────────────────────
def build_item_index():
    items = get_all_items()
    # Sort longest first so "Dragon platebody" matches before "Dragon"
    return sorted([it["name"].lower() for it in items], key=lambda x: -len(x))

ITEM_INDEX = build_item_index()

def detect_mentions(text):
    """Return list of item names mentioned in text."""
    text_lower = text.lower()
    found = []
    for name in ITEM_INDEX:
        if name in text_lower and name not in found:
            found.append(name)
            if len(found) >= 5:
                break
    # Title-case them back
    return [n.title() for n in found]

# ─── RS3 News ─────────────────────────────────────────────────────────────────
def fetch_rs3_news(limit=15):
    """Fetch official RS3 news from the RSS feed."""
    items = []
    try:
        resp = requests.get(
            "https://services.runescape.com/m=news/latest_news.rss",
            headers=HEADERS, timeout=10
        )
        resp.raise_for_status()
        # Simple RSS parse without lxml
        entries = re.findall(r'<item>(.*?)</item>', resp.text, re.DOTALL)
        for entry in entries[:limit]:
            title_m = re.search(r'<title><!\[CDATA\[(.*?)\]\]></title>', entry)
            link_m  = re.search(r'<link>(.*?)</link>', entry)
            date_m  = re.search(r'<pubDate>(.*?)</pubDate>', entry)
            if not title_m:
                title_m = re.search(r'<title>(.*?)</title>', entry)
            if title_m:
                title = title_m.group(1).strip()
                link  = link_m.group(1).strip() if link_m else ''
                date  = date_m.group(1).strip() if date_m else ''
                # Parse date
                try:
                    parsed = datetime.strptime(date, '%a, %d %b %Y %H:%M:%S %z')
                    date = parsed.strftime('%Y-%m-%d')
                except:
                    date = date[:16] if date else ''
                items.append({
                    "source": "RS3 News",
                    "title": title,
                    "url": link,
                    "date": date,
                    "mentions": detect_mentions(title)
                })
    except Exception as e:
        print(f"[news] RS3 news error: {e}")
    return items

# ─── RS Wiki Recent Changes ────────────────────────────────────────────────────
def fetch_wiki_changes(limit=10):
    """Fetch recent RS Wiki edits that touch item pages."""
    items = []
    try:
        params = {
            "action": "query",
            "list": "recentchanges",
            "rclimit": 50,
            "rcnamespace": "0",  # Main namespace
            "rcprop": "title|timestamp|comment|user",
            "format": "json"
        }
        resp = requests.get(
            "https://runescape.wiki/api.php",
            params=params, headers=HEADERS, timeout=10
        )
        resp.raise_for_status()
        data = resp.json()
        changes = data.get("query", {}).get("recentchanges", [])
        seen = set()
        for ch in changes:
            title = ch.get("title", "")
            if title in seen:
                continue
            seen.add(title)
            mentions = detect_mentions(title)
            # Only include if the page title matches an item
            if mentions:
                ts = ch.get("timestamp", "")
                try:
                    parsed = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                    date = parsed.strftime('%Y-%m-%d %H:%M')
                except:
                    date = ts[:16]
                items.append({
                    "source": "RS Wiki",
                    "title": f"Wiki updated: {title}",
                    "url": f"https://runescape.wiki/w/{title.replace(' ', '_')}",
                    "date": date,
                    "mentions": mentions
                })
            if len(items) >= limit:
                break
    except Exception as e:
        print(f"[news] Wiki changes error: {e}")
    return items

# ─── Reddit RS3 ───────────────────────────────────────────────────────────────
def fetch_reddit_posts(limit=10):
    """Fetch top posts from r/runescape mentioning economy/market/GE."""
    items = []
    try:
        headers = {**HEADERS, "Accept": "application/json"}
        resp = requests.get(
            "https://www.reddit.com/r/runescape/search.json",
            params={"q": "GE OR market OR price OR merch OR flip", "sort": "new", "limit": 25, "restrict_sr": "1"},
            headers=headers, timeout=10
        )
        resp.raise_for_status()
        data = resp.json()
        posts = data.get("data", {}).get("children", [])
        for post in posts[:limit]:
            pd = post.get("data", {})
            title = pd.get("title", "")
            url = "https://reddit.com" + pd.get("permalink", "")
            ts = pd.get("created_utc", 0)
            date = datetime.utcfromtimestamp(ts).strftime('%Y-%m-%d') if ts else ''
            items.append({
                "source": "Reddit r/runescape",
                "title": title,
                "url": url,
                "date": date,
                "mentions": detect_mentions(title)
            })
    except Exception as e:
        print(f"[news] Reddit error: {e}")
    return items

# ─── Main ─────────────────────────────────────────────────────────────────────
def fetch_all_news():
    """Fetch all news sources and combine."""
    print("[news] Fetching RS3 news…")
    rs_news = fetch_rs3_news()
    print(f"[news] Got {len(rs_news)} official news items")

    print("[news] Fetching wiki changes…")
    wiki = fetch_wiki_changes()
    print(f"[news] Got {len(wiki)} wiki edits")

    print("[news] Fetching Reddit…")
    reddit = fetch_reddit_posts()
    print(f"[news] Got {len(reddit)} Reddit posts")

    all_news = rs_news + wiki + reddit
    # Sort by date descending
    all_news.sort(key=lambda x: x.get("date", ""), reverse=True)
    return all_news

if __name__ == "__main__":
    news = fetch_all_news()
    print(f"\nTotal: {len(news)} articles")
    for n in news[:5]:
        print(f"  [{n['source']}] {n['title'][:70]}")
        if n['mentions']:
            print(f"    → Items: {', '.join(n['mentions'])}")
