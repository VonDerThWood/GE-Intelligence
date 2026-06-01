"""
GEnius Python Runner — fetches all RS3 GE items from the GazBot dump.
Usage:
  python run.py --mode=full
  python run.py --mode=prices
  python run.py --mode=news
  python run.py --data-dir=PATH
  python run.py --webhook=URL
"""

import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPT_DIR))

HEADERS = {"User-Agent": "GEnius/1.0 (github.com/VonDerThWood/GE-Intelligence)"}

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--mode", default="full", choices=["full", "prices", "news"])
    p.add_argument("--data-dir", default=None)
    p.add_argument("--webhook", default=None)
    return p.parse_args()

def get_data_dir(override=None):
    d = Path(override) if override else SCRIPT_DIR.parent / "data"
    d.mkdir(parents=True, exist_ok=True)
    return d

def fetch_prices(data_dir, webhook_url=None):
    import requests
    from catalogue import assign_categories

    print("[prices] Fetching RS3 GE dump from WeirdGloop...")

    try:
        resp = requests.get(
            "https://chisel.weirdgloop.org/gazproj/gazbot/rs_dump.json",
            headers=HEADERS, timeout=30
        )
        resp.raise_for_status()
        dump = resp.json()
    except Exception as e:
        print(f"[prices] Error fetching dump: {e}")
        return []

    items_out = []
    skip_keys = {"%JAGEX_TIMESTAMP%", "%UPDATE_DETECTED%"}

    for item_id_str, data in dump.items():
        if item_id_str in skip_keys:
            continue
        try:
            item_id = int(item_id_str)
        except ValueError:
            continue

        name = data.get("name") or data.get("item")
        if not name:
            continue

        price = data.get("price") or data.get("value")
        last_price = data.get("last") or price
        volume = data.get("volume")

        # Skip items with no price (untradeable)
        if not price:
            continue

        # Calculate 24h change
        change_1d = None
        if price and last_price and last_price > 0:
            change_1d = round(((price - last_price) / last_price) * 100, 2)

        categories = assign_categories(name)

        items_out.append({
            "id": item_id,
            "name": name,
            "categories": categories,
            "high": price,
            "low": last_price,
            "volume": volume,
            "change_1d": change_1d,
            "limit": data.get("limit"),
        })

    print(f"[prices] Got {len(items_out)} tradeable RS3 items")
    items_out = run_signals(items_out)
    if webhook_url:
        check_alerts(items_out, data_dir, webhook_url)
    return items_out

def run_signals(items):
    for item in items:
        signals = []
        high = item.get("high") or 0
        low = item.get("low") or 0
        if high and low and low > 0:
            margin_pct = ((high - low) / low) * 100
            if margin_pct > 5:
                signals.append("MARGIN")
        chg = item.get("change_1d") or 0
        if chg > 10:
            signals.append("SURGE")
        elif chg < -10:
            signals.append("DUMP")
        vol = item.get("volume") or 0
        if vol > 10000:
            signals.append("HIGH_VOL")
        item["signals"] = signals
    return items

def check_alerts(items, data_dir, webhook_url):
    import requests
    alerts_file = data_dir / "alerts.json"
    if not alerts_file.exists():
        return
    try:
        alerts = json.loads(alerts_file.read_text())
    except:
        return
    price_map = {it["name"].lower(): it for it in items}
    triggered = []
    for alert in alerts:
        name = alert.get("item_name", "").lower()
        item = price_map.get(name)
        if not item:
            continue
        price = item.get("high") or 0
        condition = alert.get("condition", "above")
        threshold = alert.get("price", 0)
        if condition == "above" and price > threshold:
            triggered.append((alert, price))
        elif condition == "below" and price < threshold:
            triggered.append((alert, price))
    if triggered and webhook_url:
        lines = []
        for alert, price in triggered:
            d = "rose above" if alert["condition"] == "above" else "fell below"
            lines.append(f"**{alert['item_name']}** {d} **{alert['price']:,} gp** - now at **{price:,} gp**")
        try:
            requests.post(webhook_url, json={
                "username": "GEnius Alert",
                "content": "GE Price Alert\n" + "\n".join(lines)
            }, timeout=5)
            print(f"[alerts] Sent {len(triggered)} alert(s) to Discord")
        except Exception as e:
            print(f"[alerts] Discord error: {e}")

def fetch_news_data():
    try:
        from news import fetch_all_news
        return fetch_all_news()
    except Exception as e:
        print(f"[news] Error: {e}")
        return []

def main():
    args = parse_args()
    data_dir = get_data_dir(args.data_dir)
    out_file = data_dir / "latest.json"
    print(f"[run] Mode: {args.mode} | Data dir: {data_dir}")

    existing = {}
    if out_file.exists():
        try:
            existing = json.loads(out_file.read_text())
        except:
            pass

    items = existing.get("items", [])
    news = existing.get("news", [])

    if args.mode in ("full", "prices"):
        items = fetch_prices(data_dir, args.webhook)

    if args.mode in ("full", "news"):
        news = fetch_news_data()

    output = {
        "items": items,
        "news": news,
        "timestamp": int(time.time() * 1000),
        "updated_at": datetime.utcnow().isoformat() + "Z"
    }
    out_file.write_text(json.dumps(output, indent=2))
    print(f"[run] Saved {len(items)} items + {len(news)} news -> {out_file}")

if __name__ == "__main__":
    main()