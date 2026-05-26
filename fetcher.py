"""
GE Intelligence — Data Fetcher
Pulls from WeirdGloop API (prices + volume) and Flipaholics (real-world prices).
Saves snapshots to data/ folder as JSON for the dashboard to read.
"""

import requests
import json
import os
import time
import re
from datetime import datetime, timezone
from bs4 import BeautifulSoup

# ─────────────────────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────────────────────

HEADERS = {
    "User-Agent": "GE-Intelligence-Bot/1.0 (personal RS3 market tracker; contact via GitHub)",
}

WEIRDGLOOP_LATEST   = "https://api.weirdgloop.org/exchange/history/rs/latest"
WEIRDGLOOP_LAST90D  = "https://api.weirdgloop.org/exchange/history/rs/last90d"
WEIRDGLOOP_INDEX    = "https://api.weirdgloop.org/exchange/history/rs/latest"
RS_DUMP_URL         = "https://chisel.weirdgloop.org/gazproj/gazbot/rs_dump.json"
FLIPAHOLICS_BASE    = "https://flipaholics.pro/pricecheck"

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
os.makedirs(DATA_DIR, exist_ok=True)

# ─────────────────────────────────────────────────────────────
# ITEM LISTS
# Items are grouped by: watchlist type + skill category
# Format: { item_id: { name, category, skill, flipaholics_name } }
# ─────────────────────────────────────────────────────────────

TRACKED_ITEMS = {
    # ── HIGH VOLUME / LIQUIDITY ──────────────────────────────
    1514:  {"name": "Logs",              "category": "liquidity",    "skill": "Woodcutting", "flip_name": "Logs"},
    1521:  {"name": "Oak logs",          "category": "liquidity",    "skill": "Woodcutting", "flip_name": "Oak_logs"},
    453:   {"name": "Coal",              "category": "liquidity",    "skill": "Mining",      "flip_name": "Coal"},
    444:   {"name": "Iron ore",          "category": "liquidity",    "skill": "Mining",      "flip_name": "Iron_ore"},
    2349:  {"name": "Iron bar",          "category": "chain",        "skill": "Smithing",    "flip_name": "Iron_bar"},
    2351:  {"name": "Steel bar",         "category": "chain",        "skill": "Smithing",    "flip_name": "Steel_bar"},
    2353:  {"name": "Mithril bar",       "category": "chain",        "skill": "Smithing",    "flip_name": "Mithril_bar"},
    2359:  {"name": "Adamantite bar",    "category": "chain",        "skill": "Smithing",    "flip_name": "Adamantite_bar"},
    2361:  {"name": "Runite bar",        "category": "event_driven", "skill": "Smithing",    "flip_name": "Runite_bar"},
    554:   {"name": "Fire rune",         "category": "liquidity",    "skill": "Magic",       "flip_name": "Fire_rune"},
    556:   {"name": "Air rune",          "category": "liquidity",    "skill": "Magic",       "flip_name": "Air_rune"},
    558:   {"name": "Mind rune",         "category": "liquidity",    "skill": "Magic",       "flip_name": "Mind_rune"},
    562:   {"name": "Chaos rune",        "category": "liquidity",    "skill": "Magic",       "flip_name": "Chaos_rune"},
    565:   {"name": "Blood rune",        "category": "liquidity",    "skill": "Magic",       "flip_name": "Blood_rune"},
    1759:  {"name": "Flax",             "category": "chain",        "skill": "Crafting",    "flip_name": "Flax"},
    1779:  {"name": "Bowstring",         "category": "chain",        "skill": "Fletching",   "flip_name": "Bowstring"},

    # ── SEASONAL / DXP EVENT-DRIVEN ──────────────────────────
    9739:  {"name": "Adamantite ore",    "category": "event_driven", "skill": "Mining",      "flip_name": "Adamantite_ore"},
    9738:  {"name": "Runite ore",        "category": "event_driven", "skill": "Mining",      "flip_name": "Runite_ore"},
    1632:  {"name": "Raw shark",         "category": "event_driven", "skill": "Fishing",     "flip_name": "Raw_shark"},
    15272: {"name": "Snapdragon",        "category": "event_driven", "skill": "Herblore",    "flip_name": "Snapdragon"},
    2440:  {"name": "Super restore (4)", "category": "event_driven", "skill": "Herblore",    "flip_name": "Super_restore_(4)"},
    139:   {"name": "Prayer potion (4)", "category": "event_driven", "skill": "Herblore",    "flip_name": "Prayer_potion_(4)"},
    3040:  {"name": "Overload (4)",      "category": "event_driven", "skill": "Herblore",    "flip_name": "Overload_(4)"},

    # ── HIGH VALUE (Flipaholics most useful here) ─────────────
    33088: {"name": "Tumeken's shadow",  "category": "high_value",   "skill": "Magic",       "flip_name": "Tumeken%27s_shadow"},
    90000: {"name": "Noxious scythe",    "category": "high_value",   "skill": "Melee",       "flip_name": "Noxious_scythe"},
}

# GE Market Indices (all available via WeirdGloop)
INDICES = {
    "GE Common Trade Index": "common",
    "GE Metal Index":        "metal",
    "GE Rune Index":         "rune",
    "GE Log Index":          "log",
    "GE Food Index":         "food",
    "GE Herb Index":         "herb",
}

# ─────────────────────────────────────────────────────────────
# DXP WINDOWS — add future events here
# ─────────────────────────────────────────────────────────────
DXP_WINDOWS = [
    {"start": "2024-03-08", "end": "2024-03-18", "name": "DXP March 2024"},
    {"start": "2024-09-06", "end": "2024-09-16", "name": "DXP Sep 2024"},
    {"start": "2025-03-07", "end": "2025-03-17", "name": "DXP March 2025"},
    {"start": "2025-09-05", "end": "2025-09-15", "name": "DXP Sep 2025"},
    {"start": "2026-03-06", "end": "2026-03-16", "name": "DXP March 2026"},
    {"start": "2026-09-04", "end": "2026-09-14", "name": "DXP Sep 2026"},
]

# ─────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────

def parse_gp(text):
    """Convert '1,234,567' or '2.305B' or '150M' to int."""
    if text is None:
        return None
    t = str(text).strip().lower().replace(",", "").replace(" gp", "").replace("gp", "")
    t = t.replace("\xa0", "").strip()
    try:
        if "b" in t:
            return int(float(t.replace("b", "")) * 1_000_000_000)
        if "m" in t:
            return int(float(t.replace("m", "")) * 1_000_000)
        if "k" in t:
            return int(float(t.replace("k", "")) * 1_000)
        return int(float(t))
    except (ValueError, TypeError):
        return None

def now_iso():
    return datetime.now(timezone.utc).isoformat()

def get_dxp_phase():
    now = datetime.now(timezone.utc)
    from datetime import timedelta
    for ev in DXP_WINDOWS:
        start = datetime.fromisoformat(ev["start"]).replace(tzinfo=timezone.utc)
        end   = datetime.fromisoformat(ev["end"]).replace(tzinfo=timezone.utc)
        pre   = start - timedelta(days=14)
        post  = end   + timedelta(days=7)
        if pre <= now < start:
            return {"phase": "pre_dxp",    "event": ev["name"], "days_to_start": (start - now).days}
        if start <= now <= end:
            return {"phase": "active_dxp", "event": ev["name"]}
        if end < now <= post:
            return {"phase": "post_dxp",   "event": ev["name"], "days_since_end": (now - end).days}
    return {"phase": "none"}

# ─────────────────────────────────────────────────────────────
# WEIRDGLOOP — Bulk latest prices + volumes
# ─────────────────────────────────────────────────────────────

def fetch_weirdgloop_bulk(item_ids):
    """
    Fetch latest price + volume for up to 100 items in one call.
    Returns dict: { item_id_str: { price, volume, timestamp } }
    """
    results = {}
    # WeirdGloop allows up to 100 IDs per request
    chunks = [item_ids[i:i+100] for i in range(0, len(item_ids), 100)]
    for chunk in chunks:
        id_str = "|".join(str(i) for i in chunk)
        url = f"{WEIRDGLOOP_LATEST}?id={id_str}"
        try:
            resp = requests.get(url, headers=HEADERS, timeout=15)
            resp.raise_for_status()
            data = resp.json()
            for k, v in data.items():
                if isinstance(v, dict):
                    results[k] = {
                        "price":     v.get("price"),
                        "volume":    v.get("volume"),
                        "timestamp": v.get("timestamp"),
                    }
        except Exception as e:
            print(f"  [WeirdGloop bulk error] {e}")
        time.sleep(0.3)
    return results

def fetch_weirdgloop_history(item_id):
    """Fetch 90-day price+volume history for one item."""
    url = f"{WEIRDGLOOP_LAST90D}?id={item_id}"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        raw = data.get(str(item_id), [])
        # Each entry: [unix_ms, price] or [unix_ms, price, volume]
        history = []
        for entry in raw:
            if len(entry) >= 2:
                history.append({
                    "ts":     entry[0],
                    "price":  entry[1],
                    "volume": entry[2] if len(entry) > 2 else None,
                })
        return history
    except Exception as e:
        print(f"  [WeirdGloop history error for {item_id}] {e}")
        return []

def fetch_indices():
    """Fetch all 6 GE market indices."""
    results = {}
    for index_name, key in INDICES.items():
        encoded = index_name.replace(" ", "%20")
        url = f"{WEIRDGLOOP_INDEX}?id={encoded}"
        try:
            resp = requests.get(url, headers=HEADERS, timeout=15)
            resp.raise_for_status()
            data = resp.json()
            val = data.get(index_name)
            if val and isinstance(val, dict):
                results[key] = {
                    "name":      index_name,
                    "value":     val.get("price"),
                    "timestamp": val.get("timestamp"),
                }
        except Exception as e:
            print(f"  [Index error for {index_name}] {e}")
        time.sleep(0.2)
    return results

# ─────────────────────────────────────────────────────────────
# FLIPAHOLICS — Real-world price scraper
# Only used for high_value and event_driven items
# ─────────────────────────────────────────────────────────────

def fetch_flipaholics(item_id, item_meta):
    """
    Scrape real-world price from Flipaholics.
    Returns dict with price_range, low, high, margin, roi, staleness, or None on failure.
    """
    flip_name = item_meta.get("flip_name")
    if not flip_name:
        return None

    url = f"{FLIPAHOLICS_BASE}/{flip_name}"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        if resp.status_code == 404:
            return {"error": "Item not found on Flipaholics", "url": url}
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        result = {"url": url, "source": "flipaholics", "limitations": []}

        # ── Price range header ────────────────────────────────
        # Pattern: "2.305B – 2.399B GP" or "150,000 – 200,000 GP"
        price_text = None
        for tag in soup.find_all(["h2", "h3", "h4", "p", "span", "div"]):
            text = tag.get_text(strip=True)
            if "GP" in text and ("–" in text or "-" in text):
                price_text = text
                break

        if price_text:
            parts = re.split(r"[–\-]", price_text.replace("GP", "").replace("gp", ""))
            if len(parts) >= 2:
                result["price_low"]  = parse_gp(parts[0].strip())
                result["price_high"] = parse_gp(parts[1].strip())
                if result["price_low"] and result["price_high"]:
                    result["price_mid"] = (result["price_low"] + result["price_high"]) // 2
        else:
            result["limitations"].append("Could not parse price range from page")

        # ── Staleness ─────────────────────────────────────────
        for tag in soup.find_all(["span", "div", "p"]):
            t = tag.get_text(strip=True).lower()
            if "ago" in t and any(x in t for x in ["min", "hour", "day", "week"]):
                result["last_report_age"] = tag.get_text(strip=True)
                # Flag if stale
                if any(f"{n}d ago" in t for n in range(3, 30)):
                    result["limitations"].append(
                        f"Last report is {result['last_report_age']} — data may be stale"
                    )
                break

        # ── Stats panel: margin, ROI, buy limit, net profit ───
        stat_labels = {
            "margin":      ["margin"],
            "roi":         ["roi"],
            "buy_limit":   ["buy limit"],
            "gross_profit":["gross profit"],
            "net_profit":  ["net profit"],
            "all_time_high":["all time high"],
            "all_time_low": ["all time low"],
        }
        full_text = soup.get_text(separator="\n")
        lines = [l.strip() for l in full_text.split("\n") if l.strip()]

        for i, line in enumerate(lines):
            ll = line.lower()
            for stat_key, keywords in stat_labels.items():
                if any(kw in ll for kw in keywords) and stat_key not in result:
                    # Value is usually on the next non-empty line
                    if i + 1 < len(lines):
                        val_text = lines[i + 1]
                        if stat_key == "roi":
                            try:
                                result[stat_key] = float(val_text.replace("%", "").strip())
                            except ValueError:
                                pass
                        else:
                            parsed = parse_gp(val_text)
                            if parsed:
                                result[stat_key] = parsed

        if not result.get("price_mid"):
            result["limitations"].append(
                "No price data retrieved — selectors may need updating if Flipaholics changed layout"
            )

        return result

    except requests.Timeout:
        return {"error": "Flipaholics request timed out", "url": url}
    except Exception as e:
        return {"error": str(e), "url": url}

# ─────────────────────────────────────────────────────────────
# ANALYTICS — Price change, divergence, sector context
# ─────────────────────────────────────────────────────────────

def compute_analytics(item_id, item_meta, ge_data, history, flip_data, indices):
    """
    Compute all derived metrics for one item.
    Returns enriched item dict ready for alerting + dashboard.
    """
    analytics = {
        "item_id":   item_id,
        "name":      item_meta["name"],
        "category":  item_meta["category"],
        "skill":     item_meta["skill"],
        "timestamp": now_iso(),
        "limitations": [],
    }

    # ── GE price ─────────────────────────────────────────────
    ge = ge_data.get(str(item_id), {})
    analytics["ge_price"]  = ge.get("price")
    analytics["ge_volume"] = ge.get("volume")

    # ── 90-day baseline + change ──────────────────────────────
    if history and len(history) >= 2:
        analytics["baseline_price"] = history[0]["price"]
        analytics["baseline_ts"]    = history[0]["ts"]
        if analytics["ge_price"] and analytics["baseline_price"]:
            delta_gp  = analytics["ge_price"] - analytics["baseline_price"]
            delta_pct = (delta_gp / analytics["baseline_price"]) * 100
            analytics["delta_gp"]  = delta_gp
            analytics["delta_pct"] = round(delta_pct, 2)

        # 7-day change
        week_ago = [h for h in history if h["ts"] < (history[-1]["ts"] - 7*86400*1000)]
        if week_ago and analytics["ge_price"]:
            w_delta = analytics["ge_price"] - week_ago[-1]["price"]
            analytics["delta_7d_pct"] = round((w_delta / week_ago[-1]["price"]) * 100, 2)

        # Volume trend (7d avg vs 30d avg)
        recent_vols  = [h["volume"] for h in history[-7:]  if h.get("volume")]
        baseline_vols= [h["volume"] for h in history[-30:] if h.get("volume")]
        if recent_vols and baseline_vols:
            analytics["vol_7d_avg"]  = int(sum(recent_vols)  / len(recent_vols))
            analytics["vol_30d_avg"] = int(sum(baseline_vols) / len(baseline_vols))
            analytics["vol_trend_pct"] = round(
                ((analytics["vol_7d_avg"] - analytics["vol_30d_avg"]) / analytics["vol_30d_avg"]) * 100, 2
            )
    else:
        analytics["limitations"].append("Insufficient history for baseline calculation")

    # ── Flipaholics divergence ────────────────────────────────
    if flip_data and not flip_data.get("error") and flip_data.get("price_mid") and analytics.get("ge_price"):
        analytics["flip_price_low"]  = flip_data.get("price_low")
        analytics["flip_price_high"] = flip_data.get("price_high")
        analytics["flip_price_mid"]  = flip_data.get("price_mid")
        analytics["flip_margin"]     = flip_data.get("margin")
        analytics["flip_roi"]        = flip_data.get("roi")
        analytics["flip_buy_limit"]  = flip_data.get("buy_limit")
        analytics["flip_net_profit"] = flip_data.get("net_profit")
        analytics["flip_ath"]        = flip_data.get("all_time_high")
        analytics["flip_atl"]        = flip_data.get("all_time_low")
        analytics["flip_staleness"]  = flip_data.get("last_report_age")
        analytics["flip_limitations"]= flip_data.get("limitations", [])

        divergence = ((flip_data["price_mid"] - analytics["ge_price"]) / analytics["ge_price"]) * 100
        analytics["ge_flip_divergence_pct"] = round(divergence, 2)
    elif flip_data and flip_data.get("error"):
        analytics["limitations"].append(f"Flipaholics: {flip_data['error']}")

    # ── Sector index context ──────────────────────────────────
    skill_to_index = {
        "Magic":      "rune",
        "Smithing":   "metal",
        "Mining":     "metal",
        "Woodcutting":"log",
        "Firemaking": "log",
        "Fletching":  "log",
        "Cooking":    "food",
        "Fishing":    "food",
        "Herblore":   "herb",
        "Farming":    "herb",
    }
    idx_key = skill_to_index.get(item_meta["skill"])
    if idx_key and idx_key in indices:
        analytics["sector_index_key"]   = idx_key
        analytics["sector_index_name"]  = indices[idx_key]["name"]
        analytics["sector_index_value"] = indices[idx_key]["value"]

    analytics["history"] = history[-90:] if history else []
    return analytics

# ─────────────────────────────────────────────────────────────
# MAIN FETCH CYCLE
# ─────────────────────────────────────────────────────────────

def run_fetch_cycle():
    print(f"\n{'='*60}")
    print(f"  GE INTELLIGENCE — FETCH CYCLE")
    print(f"  {now_iso()}")
    print(f"{'='*60}\n")

    item_ids = list(TRACKED_ITEMS.keys())

    # 1. Bulk GE prices + volumes (one API call)
    print("[1/4] Fetching GE prices + volumes from WeirdGloop...")
    ge_bulk = fetch_weirdgloop_bulk(item_ids)
    print(f"      Got data for {len(ge_bulk)} items")

    # 2. Market indices
    print("[2/4] Fetching market indices...")
    indices = fetch_indices()
    print(f"      Got {len(indices)} indices: {', '.join(indices.keys())}")

    # 3. Per-item history + Flipaholics (only for high_value + event_driven)
    print("[3/4] Fetching item histories + Flipaholics data...")
    all_analytics = []
    flip_categories = {"high_value", "event_driven"}

    for item_id, item_meta in TRACKED_ITEMS.items():
        print(f"  [{item_meta['name']}]")

        # History from WeirdGloop
        history = fetch_weirdgloop_history(item_id)
        time.sleep(0.3)

        # Flipaholics — only where it's actually useful
        flip_data = None
        if item_meta["category"] in flip_categories:
            flip_data = fetch_flipaholics(item_id, item_meta)
            if flip_data and not flip_data.get("error"):
                mid = flip_data.get("price_mid")
                print(f"    Flipaholics: {mid:,} gp (mid)" if mid else "    Flipaholics: no price")
            time.sleep(0.5)

        # Compute analytics
        analytics = compute_analytics(item_id, item_meta, ge_bulk, history, flip_data, indices)
        all_analytics.append(analytics)

        if analytics.get("ge_price"):
            pct = analytics.get("delta_pct", 0) or 0
            div = analytics.get("ge_flip_divergence_pct")
            print(f"    GE: {analytics['ge_price']:,} gp | Δ90d: {pct:+.1f}%"
                  + (f" | Flip div: {div:+.1f}%" if div else ""))

    # 4. Save snapshot
    print("\n[4/4] Saving snapshot...")
    dxp = get_dxp_phase()
    snapshot = {
        "fetched_at": now_iso(),
        "dxp_phase":  dxp,
        "indices":    indices,
        "items":      all_analytics,
    }

    out_path = os.path.join(DATA_DIR, "latest.json")
    with open(out_path, "w") as f:
        json.dump(snapshot, f, indent=2)
    print(f"  Saved → {out_path}")

    # Also keep a timestamped archive
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M")
    archive_path = os.path.join(DATA_DIR, f"snapshot_{ts}.json")
    with open(archive_path, "w") as f:
        json.dump(snapshot, f, indent=2)
    print(f"  Archived → {archive_path}")

    print(f"\n  Done. {len(all_analytics)} items processed.\n")
    return snapshot

if __name__ == "__main__":
    run_fetch_cycle()
