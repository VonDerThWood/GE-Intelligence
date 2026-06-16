# -*- coding: utf-8 -*-
"""
GEnius Python Runner
Usage:
  python run.py --mode=full       # prices + news + alerts
  python run.py --mode=prices     # prices + alerts only
  python run.py --mode=news       # news only
  python run.py --data-dir=PATH   # override data directory
  python run.py --webhook=URL     # Discord webhook override
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Force UTF-8 output on Windows to avoid CP1252 encoding errors
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if sys.stderr.encoding and sys.stderr.encoding.lower() != 'utf-8':
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

# ── Resolve paths ─────────────────────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPT_DIR))

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--mode", default="full", choices=["full", "prices", "news"])
    p.add_argument("--data-dir", default=None)
    p.add_argument("--webhook", default=None)
    return p.parse_args()

def get_data_dir(override=None):
    if override:
        d = Path(override)
    else:
        d = SCRIPT_DIR.parent / "data"
    d.mkdir(parents=True, exist_ok=True)
    return d

# ── Prices via WeirdGloop GazBot dump ────────────────────────────────────────
def fetch_prices(data_dir, webhook_url=None, existing_items=None):
    import requests
    import json as json_mod
    from catalogue import assign_categories

    HEADERS = {"User-Agent": "GEnius/1.0 (github.com/VonDerThWood/GE-Intelligence)"}
    DUMP_URL = "https://chisel.weirdgloop.org/gazproj/gazbot/rs_dump.json"

    # Load history.json for real volume averages AND previous day prices
    history_vol_avg = {}   # item_id (str) -> average daily volume
    history_prev_price = {}  # item_id (str) -> previous day's price
    history_file = Path(data_dir) / "history.json"
    if history_file.exists():
        try:
            history = json_mod.loads(history_file.read_text(encoding='utf-8'))
            for item_id, points in history.items():
                if not points or len(points) < 2:
                    continue
                # Sort by timestamp ascending
                sorted_pts = sorted(points, key=lambda p: p.get('timestamp', 0))
                # Volume average from all points
                vols = [p.get('volume') for p in sorted_pts if p.get('volume') is not None]
                if vols:
                    history_vol_avg[str(item_id)] = round(sum(vols) / len(vols))
                # Previous price = second most recent point
                prev = sorted_pts[-2]
                if prev.get('price'):
                    history_prev_price[str(item_id)] = prev['price']
            print(f"[prices] Loaded history for {len(history_vol_avg)} items (vol) / {len(history_prev_price)} items (price)")
            # Sample a few to verify format
            sample = list(history_prev_price.items())[:3]
            for sid, prev in sample:
                print(f"[prices] Sample history price — id:{sid} prev:{prev}")
        except Exception as e:
            print(f"[prices] Could not load history.json: {e}")

    # Build previous volume lookups from last fetch (EMA fallback for items without history)
    EMA_ALPHA = 0.08
    prev_avg_volume = {}
    if existing_items:
        for it in existing_items:
            name = it.get("name", "")
            avg_vol = it.get("avgVolume")
            if name and avg_vol:
                prev_avg_volume[name] = avg_vol

    print(f"[prices] Fetching RS3 GE dump from WeirdGloop...")

    try:
        resp = requests.get(DUMP_URL, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        raw = resp.json()
    except Exception as e:
        print(f"[prices] Error fetching dump: {e}")
        return []

    print(f"[prices] Got {len(raw)} items from dump")

    items_out = []
    item_counter = 1

    # Known junk keys from GazBot dump to skip
    JUNK_PATTERNS = ['%UPDATE_DETECTED%', '%JAGEX_TIMESTAMP%', '%']

    for key, item_data in raw.items():
        if not item_data:
            continue

        # Skip GazBot metadata/placeholder entries
        if any(p in key for p in JUNK_PATTERNS):
            continue

        # Handle flat format: {"Item Name": price} — legacy/fallback
        if isinstance(item_data, (int, float)):
            price = int(item_data)
            high = price
            low  = price
            if key.isdigit():
                name = f"Item {key}"
                item_id = int(key)
            else:
                name = key
                item_id = item_counter
                item_counter += 1
            volume = None
            alch = None
            limit = None
            change_1d = None
            examine = None
            members = None
        elif isinstance(item_data, dict):
            price = item_data.get("price")
            if not price:
                continue
            name = item_data.get("name", key)
            # Skip junk names
            if any(p in name for p in JUNK_PATTERNS):
                continue
            item_id = item_data.get("id") or (int(key) if key.isdigit() else item_counter)
            if not key.isdigit() and not item_data.get("id"):
                item_counter += 1
            high = price
            low  = price
            volume  = item_data.get("volume")
            alch    = item_data.get("highalch")
            limit   = item_data.get("limit")
            examine = item_data.get("examine", "")
            members = item_data.get("members", False)

            # Price change — dump's last field first, then history fallback
            last_price = item_data.get("last")
            if last_price and last_price > 0 and price != last_price:
                change_1d = round(((price - last_price) / last_price) * 100, 2)
            elif item_id and str(item_id) in history_prev_price:
                prev = history_prev_price[str(item_id)]
                if prev and prev > 0:
                    change_1d = round(((price - prev) / prev) * 100, 2)
                else:
                    change_1d = None
            else:
                change_1d = None
        else:
            continue

        # Assign categories
        categories = assign_categories(name)

        # Compute avgVolume — prefer real history average, fall back to EMA
        if item_id and str(item_id) in history_vol_avg:
            avg_volume = history_vol_avg[str(item_id)]
        else:
            prev_avg = prev_avg_volume.get(name)
            if volume and prev_avg:
                avg_volume = round(EMA_ALPHA * volume + (1 - EMA_ALPHA) * prev_avg)
            elif volume:
                avg_volume = volume
            else:
                avg_volume = prev_avg

        items_out.append({
            "id": item_id,
            "name": name,
            "categories": categories,
            "high": high,
            "low": low,
            "alch": alch,
            "limit": limit,
            "volume": volume,
            "avgVolume": avg_volume,
            "change_1d": change_1d,
            "examine": examine,
            "members": members,
        })

    print(f"[prices] Processed {len(items_out)} tradeable items")
    changed = sum(1 for it in items_out if it.get('change_1d') is not None)
    print(f"[prices] Items with price change data: {changed}/{len(items_out)}")

    # Run signals
    items_out = run_signals(items_out)

    # Check alerts
    if webhook_url:
        check_alerts(items_out, data_dir, webhook_url)

    return items_out

# ── Signal thresholds ────────────────────────────────────────────────────────
# SURGE/DUMP require both price movement AND volume confirmation
SURGE_CHG_MIN    =  5.0   # % price change minimum
DUMP_CHG_MAX     = -5.0   # % price change maximum
DIR_VOL_RATIO    =  1.2   # volume must be 1.2× avg to confirm SURGE/DUMP
# ACCUMULATION/DISTRIBUTION: price flat, volume telling the story
FLAT_CHG_MIN     = -3.0   # % — price considered "flat" range
FLAT_CHG_MAX     =  3.0
ACCUM_VOL_MIN    =  1.3   # 1.3×–2.5× avg → ACCUMULATION
DISTRIB_VOL_MIN  =  2.5   # 2.5×+ avg → DISTRIBUTION
MIN_VOL_ABS      =  5000  # ignore noise below this absolute volume
# Volume tier badges (always shown, independent of price signals)
# Tiers: THIN (<0.5×) | QUIET (0.5–0.9×) | [normal 0.9–1.1×] | ACTIVE (1.1–1.5×) | HIGH_VOL (1.5–2.5×) | FRENZY (2.5×+)
VOL_FRENZY_MIN   =  2.5
VOL_HIGH_MIN     =  1.5
VOL_ACTIVE_MIN   =  1.1
VOL_QUIET_MAX    =  0.9
VOL_THIN_MAX     =  0.5

def run_signals(items):
    """Tag items with market signals based on price change and volume behavior."""
    nature_rune_price = 0
    for item in items:
        if item.get("name", "").lower() == "nature rune":
            nature_rune_price = item.get("high") or item.get("low") or 0
            break
    if nature_rune_price:
        print(f"[signals] Nature rune price: {nature_rune_price} gp")
    else:
        print(f"[signals] Nature rune price not found, defaulting to 0")

    for item in items:
        signals = []
        high    = item.get("high") or 0
        low     = item.get("low") or 0
        alch    = item.get("alch") or 0
        chg     = item.get("change_1d") or 0
        vol     = item.get("volume") or 0
        avg_vol = item.get("avgVolume") or 0

        has_avg = bool(avg_vol and vol >= MIN_VOL_ABS)
        vol_ratio = (vol / avg_vol) if has_avg else 0

        ge_price = high or low

        # Skip all signals for items under 900gp — not actionable
        if ge_price < 900:
            item["signals"] = []
            item["natureRunePrice"] = nature_rune_price
            continue

        abs_chg_gp = abs(chg / 100 * ge_price)
        # SURGE: price rising + volume elevated + at least 1k GP movement
        if chg >= SURGE_CHG_MIN and abs_chg_gp >= 1000 and (not has_avg or vol_ratio >= DIR_VOL_RATIO):
            signals.append("SURGE")
        # DUMP: price falling + volume elevated + at least 1k GP movement
        elif chg <= DUMP_CHG_MAX and abs_chg_gp >= 1000 and (not has_avg or vol_ratio >= DIR_VOL_RATIO):
            signals.append("DUMP")
        # ACCUMULATION / DISTRIBUTION: price flat, volume doing the talking
        elif has_avg and FLAT_CHG_MIN <= chg <= FLAT_CHG_MAX:
            if vol_ratio >= DISTRIB_VOL_MIN:
                signals.append("DISTRIBUTION")
            elif vol_ratio >= ACCUM_VOL_MIN:
                signals.append("ACCUMULATION")

        # Volume tier badge — always shown when volume deviates ≥10% from average.
        # Independent of price signals; answers "how unusual is today's volume?"
        if vol >= MIN_VOL_ABS and avg_vol:
            if vol_ratio >= VOL_FRENZY_MIN:
                signals.append("FRENZY")
            elif vol_ratio >= VOL_HIGH_MIN:
                signals.append("HIGH_VOL")
            elif vol_ratio >= VOL_ACTIVE_MIN:
                signals.append("ACTIVE")
            elif vol_ratio <= VOL_THIN_MAX:
                signals.append("THIN")
            elif vol_ratio <= VOL_QUIET_MAX:
                signals.append("QUIET")
        elif vol and not avg_vol and vol > 100000:
            signals.append("HIGH_VOL")

        # ALCH: alch profit beats GE sell (after 2% tax) + nature rune cost
        if alch and ge_price:
            if alch > (ge_price * 0.98 + nature_rune_price):
                signals.append("ALCH")

        item["natureRunePrice"] = nature_rune_price
        item["signals"] = signals

        # Opportunity Score (0–100)
        score = 0
        # Price momentum — up to 40 pts
        # Weighted by both % change and absolute GP change so cheap items don't score high
        if item.get("change_1d") is not None:
            ge_price_now = high or low
            abs_chg      = abs(item["change_1d"])
            pct_factor   = min(1.0, abs_chg / 20)                          # 20% = full pct weight
            gp_factor    = min(1.0, (abs_chg / 100 * ge_price_now) / 100000)  # 100k GP change = full gp weight
            score += 40 * (pct_factor * gp_factor) ** 0.5                  # geometric mean
        # Volume confirmation — up to 30 pts
        if has_avg and vol_ratio > 0:
            score += min(30, (vol_ratio - 1) / 2 * 30)
        # Signal bonuses
        if "SURGE"  in signals or "DUMP"  in signals:         score += 20
        if "ACCUMULATION" in signals or "DISTRIBUTION" in signals: score += 10
        if "FRENZY" in signals:                                score += 10
        # Alch profit bonus — up to 10 pts
        ge_price = high or low
        if alch and ge_price and nature_rune_price:
            profit = alch - (ge_price * 0.98) - nature_rune_price
            if profit > 0:
                score += min(10, profit / ge_price * 100)
        item["score"] = round(min(100, score), 1)

    counts = {s: sum(1 for it in items if s in (it.get("signals") or [])) for s in ["SURGE","DUMP","ACCUMULATION","DISTRIBUTION","FRENZY","HIGH_VOL","ACTIVE","QUIET","THIN","ALCH"]}
    print(f"[signals] {counts}")
    return items

# ── Alert checker ─────────────────────────────────────────────────────────────
def check_alerts(items, data_dir, webhook_url):
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

        condition  = alert.get("condition", "above")
        price      = item.get("high") or item.get("low") or 0
        change_1d  = item.get("change_1d")
        signals    = item.get("signals") or []
        threshold  = alert.get("price", 0)
        pct        = alert.get("pct", 0)
        sig_type   = alert.get("signal_type", "")

        hit = False
        if   condition == "above"    and price > threshold:
            hit = True
        elif condition == "below"    and price < threshold:
            hit = True
        elif condition == "pct_up"   and change_1d is not None and change_1d >= pct:
            hit = True
        elif condition == "pct_down" and change_1d is not None and change_1d <= -abs(pct):
            hit = True
        elif condition == "signal"   and sig_type in signals:
            hit = True
        elif condition == "alch"     and "ALCH" in signals:
            hit = True

        if hit:
            triggered.append((alert, item))

    if triggered and webhook_url:
        send_discord(triggered, webhook_url)

def send_discord(triggered, webhook_url):
    import requests
    lines = []
    for alert, item in triggered:
        condition = alert.get("condition", "above")
        name      = alert["item_name"]
        price     = item.get("high") or item.get("low") or 0
        change_1d = item.get("change_1d")
        signals   = item.get("signals") or []

        if condition == "above":
            msg = f"📈 **{name}** rose above **{fmt_gp(alert['price'])}gp** — now **{fmt_gp(price)}gp**"
        elif condition == "below":
            msg = f"📉 **{name}** fell below **{fmt_gp(alert['price'])}gp** — now **{fmt_gp(price)}gp**"
        elif condition == "pct_up":
            msg = f"📈 **{name}** up **+{change_1d:.2f}%** today (threshold: +{alert.get('pct',0)}%)"
        elif condition == "pct_down":
            msg = f"📉 **{name}** down **{change_1d:.2f}%** today (threshold: -{alert.get('pct',0)}%)"
        elif condition == "signal":
            msg = f"⚡ **{name}** triggered signal **{alert.get('signal_type','')}** — price: **{fmt_gp(price)}gp**"
        elif condition == "alch":
            msg = f"🔥 **{name}** is now alch-profitable — price: **{fmt_gp(price)}gp**"
        else:
            msg = f"⚠️ **{name}** alert triggered"
        lines.append(msg)

    payload = {
        "username": "GEnius Alert",
        "content": "⚠️ **GE Price Alert**\n" + "\n".join(lines)
    }
    try:
        requests.post(webhook_url, json=payload, timeout=5)
        print(f"[alerts] Sent {len(triggered)} alert(s) to Discord")
    except Exception as e:
        print(f"[alerts] Discord error: {e}")

def fmt_gp(n):
    n = int(n or 0)
    if n >= 1_000_000_000: return f"{n/1_000_000_000:.1f}b"
    if n >= 1_000_000:     return f"{n/1_000_000:.1f}m"
    if n >= 1_000:         return f"{n/1_000:.1f}k"
    return str(n)

# ── News ──────────────────────────────────────────────────────────────────────
def fetch_news_data():
    try:
        from news import fetch_all_news
        return fetch_all_news()
    except Exception as e:
        print(f"[news] Error: {e}")
        return []

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    args = parse_args()
    data_dir = get_data_dir(args.data_dir)
    out_file = data_dir / "latest.json"

    print(f"[run] Mode: {args.mode} | Data dir: {data_dir}")

    # Load existing data to preserve fields we're not refreshing
    existing = {}
    if out_file.exists():
        try:
            existing = json.loads(out_file.read_text(encoding='utf-8'))
        except:
            pass

    items = existing.get("items", [])
    news  = existing.get("news", [])

    if args.mode in ("full", "prices"):
        existing_items = existing.get("items", [])
        items = fetch_prices(data_dir, args.webhook, existing_items)

    if args.mode in ("full", "news"):
        news = fetch_news_data()

    # Append untradeable items (Invention components + combo potions)
    # Uses a 24h cache so this is fast on repeat fetches
    if args.mode in ("full", "prices"):
        try:
            from untradeable import load as load_untradeable
            nature_rune_price = next(
                (it['high'] for it in items if it.get('name','').lower() == 'nature rune'), 0
            )
            ut_items = load_untradeable(nature_rune_price=nature_rune_price)
            # Update nature rune price in cached items
            for it in ut_items:
                it['natureRunePrice'] = nature_rune_price
            items = items + ut_items
            print(f"[untradeable] Appended {len(ut_items)} untradeable items")
        except Exception as e:
            print(f"[untradeable] Error: {e}")

    # Fetch market indexes (1h cache)
    indexes = []
    if args.mode in ("full", "prices"):
        try:
            from market_watch import load as load_indexes
            indexes = load_indexes()
        except Exception as e:
            print(f"[market_watch] Error: {e}")

    output = {
        "items": items,
        "news": news,
        "indexes": indexes,
        "timestamp": int(time.time() * 1000),
        "updated_at": datetime.now(timezone.utc).isoformat()
    }

    out_file.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding='utf-8')
    print(f"[run] Saved {len(items)} items + {len(news)} news -> {out_file}")

if __name__ == "__main__":
    main()
