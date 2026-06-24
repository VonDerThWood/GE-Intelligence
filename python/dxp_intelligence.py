"""
GEnius Almanac — DXP event module.

The Almanac is designed to eventually cover multiple recurring seasonal
events (DXP, and later things like Easter/Summer/Halloween/Christmas); this
module is the DXP-specific implementation, not the whole Almanac. Computes
historical DXP-event price/volume patterns from the app's own
locally-accumulated history.json, instead of a one-off research pull. This is
the production port of research/fetch_and_analyze.py + trough_analysis.py.

Self-updating: EVENTS is no longer a hardcoded constant. python/dxp_events.json
ships the dev-curated baseline list with the app (updated whenever we confirm a
new completed DXP cycle via research). At runtime, load_events() merges that
bundled list with a local copy in the user's data dir, unions them, and persists
the result back to the data dir — so a long-running install never loses events
even across app updates that ship a differently-ordered or independently-grown
bundled list. See HYBRID SEED + LOCAL HISTORY MODEL in TODO.txt for the design.
"""
import bisect
import json
import statistics
from datetime import datetime, timedelta
from pathlib import Path

# Fallback baseline if dxp_events.json is ever missing — keeps the module
# importable/testable standalone. Real runs should always go through
# load_events(), which supersedes this with the bundled + local merge.
EVENTS = [
    ("2025-11-07", "2025-11-14", "2025-11-24"),
    ("2025-08-06", "2025-08-15", "2025-08-25"),
    ("2025-04-25", "2025-05-16", "2025-05-26"),
    ("2025-01-23", "2025-02-21", "2025-03-03"),
    ("2024-11-04", "2024-11-15", "2024-11-25"),
    ("2024-07-23", "2024-08-02", "2024-08-12"),
    ("2024-04-16", "2024-05-17", "2024-05-27"),
    ("2024-02-01", "2024-02-16", "2024-02-26"),
    ("2023-10-27", "2023-11-10", "2023-11-20"),
    ("2023-06-29", "2023-07-28", "2023-08-07"),
]


def _load_event_list(path):
    if not path.exists():
        return []
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        return [tuple(e) for e in raw]
    except Exception:
        return []


def load_events(data_dir=None):
    """Merges the bundled dev-curated event list (python/dxp_events.json)
    with the user's local copy (data_dir/dxp_events.json), unions them
    (dedup by the exact announced/start/end triple), and persists the
    merged result back to the local copy. This is the actual self-update
    mechanism: we ship updated bundled lists as we confirm new cycles via
    research, and any locally-grown list (e.g. from a future auto-detect
    feature) never gets clobbered by an app update shipping a shorter or
    differently-ordered bundled list — the merge always keeps the union."""
    bundled = _load_event_list(Path(__file__).parent / "dxp_events.json")
    local_path = Path(data_dir) / "dxp_events.json" if data_dir else None
    local = _load_event_list(local_path) if local_path else []

    merged = sorted(set(bundled) | set(local), key=lambda e: e[1], reverse=True)
    if not merged:
        merged = list(EVENTS)

    if local_path:
        try:
            local_path.write_text(json.dumps([list(e) for e in merged], indent=2), encoding="utf-8")
        except Exception:
            pass
    return merged

EARLY_EVENT_DAYS = 5      # how many days into the event count as "early" vs "late"
RISE_THRESH = 3.0
DROP_THRESH = -3.0
PHASES = ["pre_announce", "anticipation", "early_event", "late_event", "post_event"]

# Minimum bar before a confidence score is reported for an item at all —
# matches the rigor established during research (require most of the tracked
# events to actually have usable price data).
MIN_EVENTS_FOR_CONFIDENCE = 7


def to_dt(ts):
    return datetime.utcfromtimestamp(ts / 1000 if ts > 1e11 else ts)


class Parsed:
    """Sorted-by-date history for one item, with a parallel list of just the
    datetimes for bisecting. Every lookup (nearest_price, avg_volume,
    windowed_extreme) used to do a full O(n) scan of the item's entire price
    history — called ~160 times per item across 10 events x 5 phases x
    several lookups each. For items with years of daily history that's
    160 x thousands of comparisons, which is what made a full run take
    40+ seconds even after avoiding re-parsing timestamps. Binary-searching
    to the relevant date range first, then only touching that slice, cuts
    each lookup down to O(log n + window size)."""
    __slots__ = ("rows", "dts")

    def __init__(self, points):
        rows = [(to_dt(p["timestamp"]), p.get("price"), p.get("volume", 0) or 0) for p in points]
        rows.sort(key=lambda x: x[0])
        self.rows = rows
        self.dts = [r[0] for r in rows]

    def slice(self, start_dt, end_dt):
        lo = bisect.bisect_left(self.dts, start_dt)
        hi = bisect.bisect_right(self.dts, end_dt)
        return self.rows[lo:hi]


def parse_points(points):
    """Pre-parses raw history points ONCE per item into a Parsed wrapper
    supporting binary-search range lookups (see Parsed docstring)."""
    return Parsed(points)


def nearest_price(parsed, target_dt, max_days=5):
    window = parsed.slice(target_dt - timedelta(days=max_days), target_dt + timedelta(days=max_days))
    best, best_diff = None, None
    for dt, price, vol in window:
        if not price:
            continue
        diff = abs((dt - target_dt).total_seconds())
        if best_diff is None or diff < best_diff:
            best, best_diff = (dt, price, vol), diff
    if best is None:
        return None
    return {"timestamp": best[0], "price": best[1], "volume": best[2]}


def avg_volume(parsed, start_dt, end_dt):
    vols = [vol for dt, price, vol in parsed.slice(start_dt, end_dt)]
    return sum(vols) / len(vols) if vols else 0


def windowed_extreme(parsed, win_start, win_end, find="min"):
    pts = [(dt, price) for dt, price, vol in parsed.slice(win_start, win_end) if price]
    if not pts:
        return None
    pts.sort(key=lambda x: x[1], reverse=(find == "max"))
    return pts[0]


def classify_item(points, parsed=None, events=None):
    """Phase-by-phase price/volume tally across all tracked events.
    Returns dict: phase -> {rise, drop, flat, total, avg_pct, avg_vol_ratio}.
    Pass `parsed` (from parse_points) if already computed by the caller, to
    avoid re-parsing the same item's history twice (e.g. once here, once in
    best_buy_sell_days). Pass `events` (from load_events()) to use the
    merged bundled+local event list instead of the static EVENTS fallback."""
    if events is None:
        events = EVENTS
    tally = {p: {"rise": 0, "drop": 0, "flat": 0, "total": 0, "pcts": [], "vols": [], "events": []} for p in PHASES}
    if not points:
        return tally
    if parsed is None:
        parsed = parse_points(points)

    all_vols = sorted(v for _, _, v in parsed.rows if v is not None)
    baseline_vol = all_vols[len(all_vols) // 2] if all_vols else 0

    for announced, start, end in events:
        a_dt = datetime.strptime(announced, "%Y-%m-%d")
        s_dt = datetime.strptime(start, "%Y-%m-%d")
        e_dt = datetime.strptime(end, "%Y-%m-%d")
        mid_dt = s_dt + timedelta(days=EARLY_EVENT_DAYS)
        baseline_dt = a_dt - timedelta(days=21)
        after_dt = e_dt + timedelta(days=21)

        baseline = nearest_price(parsed, baseline_dt)
        at_announce = nearest_price(parsed, a_dt)
        at_start = nearest_price(parsed, s_dt)
        at_mid = nearest_price(parsed, mid_dt)
        at_end = nearest_price(parsed, e_dt)
        after = nearest_price(parsed, after_dt)

        pairs = {
            "pre_announce": (baseline, at_announce, baseline_dt, a_dt),
            "anticipation": (at_announce, at_start, a_dt, s_dt),
            "early_event": (at_start, at_mid, s_dt, mid_dt),
            "late_event": (at_mid, at_end, mid_dt, e_dt),
            "post_event": (at_end, after, e_dt, after_dt),
        }
        for phase, (a, b, win_start, win_end) in pairs.items():
            vol = avg_volume(parsed, win_start, win_end)
            if vol:
                tally[phase]["vols"].append(round(vol / baseline_vol, 2) if baseline_vol else None)
            if not (a and b and a["price"]):
                continue
            pct = (b["price"] - a["price"]) / a["price"] * 100
            tally[phase]["total"] += 1
            tally[phase]["pcts"].append(round(pct, 2))
            direction = "rise" if pct > RISE_THRESH else "drop" if pct < DROP_THRESH else "flat"
            tally[phase][direction] += 1
            tally[phase]["events"].append({"event_start": start, "pct": round(pct, 2), "direction": direction})

    for phase in PHASES:
        pcts = tally[phase]["pcts"]
        tally[phase]["avg_pct"] = round(sum(pcts) / len(pcts), 2) if pcts else None
        tally[phase]["median_pct"] = round(statistics.median(pcts), 2) if pcts else None
        vols = [v for v in tally[phase]["vols"] if v is not None]
        tally[phase]["avg_vol_ratio"] = round(sum(vols) / len(vols), 2) if vols else None
    return tally


def best_buy_sell_days(points, parsed=None, events=None):
    """Pinpoints the precise day (offset from event start) of the best buy
    and best sell window, with a std-dev confidence indicator, per the
    trough_analysis.py methodology."""
    if events is None:
        events = EVENTS
    if parsed is None:
        parsed = parse_points(points)
    pre_troughs, post_troughs, peaks, dips = [], [], [], []
    for announced, start, end in events:
        a_dt = datetime.strptime(announced, "%Y-%m-%d")
        s_dt = datetime.strptime(start, "%Y-%m-%d")
        e_dt = datetime.strptime(end, "%Y-%m-%d")
        baseline_dt = a_dt - timedelta(days=21)
        after_dt = e_dt + timedelta(days=21)

        pre = windowed_extreme(parsed, baseline_dt, s_dt, "min")
        post = windowed_extreme(parsed, e_dt, after_dt, "min")
        peak = windowed_extreme(parsed, s_dt, e_dt, "max")
        dip = windowed_extreme(parsed, s_dt, e_dt, "min")
        baseline_pt = windowed_extreme(parsed, baseline_dt, baseline_dt + timedelta(days=3), "min")
        if not (pre and post and peak and dip and baseline_pt):
            continue
        baseline_price = baseline_pt[1]
        pre_troughs.append((pre[0] - s_dt).days)
        post_troughs.append((post[0] - s_dt).days)
        peaks.append(((peak[0] - s_dt).days, round((peak[1] - baseline_price) / baseline_price * 100, 1)))
        dips.append(((dip[0] - s_dt).days, round((dip[1] - baseline_price) / baseline_price * 100, 1)))

    if len(peaks) < MIN_EVENTS_FOR_CONFIDENCE:
        return None

    peak_days = [p[0] for p in peaks]
    dip_days = [d[0] for d in dips]
    return {
        "n_events": len(peaks),
        "best_sell_day_offset": statistics.median(peak_days),
        "best_sell_day_std": round(statistics.pstdev(peak_days), 1),
        "best_sell_pct_median": statistics.median([p[1] for p in peaks]),
        "best_buy_day_offset": statistics.median(dip_days),
        "best_buy_day_std": round(statistics.pstdev(dip_days), 1),
        "best_buy_pct_median": statistics.median([d[1] for d in dips]),
        "pre_trough_offset_median": statistics.median(pre_troughs),
        "post_trough_offset_median": statistics.median(post_troughs),
    }


def confidence_score(tally, phase):
    """Returns (direction, score_out_of_n) for the strongest signal in a phase,
    or None if there isn't enough data / no clear direction."""
    t = tally[phase]
    if t["total"] < MIN_EVENTS_FOR_CONFIDENCE:
        return None
    if t["rise"] >= t["drop"] and t["rise"] / t["total"] >= 0.5:
        return ("rise", t["rise"], t["total"])
    if t["drop"] > t["rise"] and t["drop"] / t["total"] >= 0.5:
        return ("drop", t["drop"], t["total"])
    return None


def load_seed():
    """Loads the baked-in research seed (python/dxp_seed.json), shipped with
    the app so users get historical DXP analysis from day one, even for items
    their own local history.json hasn't background-populated yet."""
    seed_path = Path(__file__).parent / "dxp_seed.json"
    if not seed_path.exists():
        return {}
    try:
        return json.loads(seed_path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def merge_entry(live, seed):
    """Merges a live-computed entry with the seed entry for the same item,
    favoring whichever source has more event coverage PER PHASE (not just
    per item) — a long-time user's local history may have cycles the shared
    seed doesn't, and vice versa for newer users."""
    if not live:
        return seed
    if not seed:
        return live
    merged = {"name": live.get("name") or seed.get("name"), "limit": live.get("limit"), "phases": {}}
    for p in PHASES:
        lp, sp = live.get("phases", {}).get(p), seed.get("phases", {}).get(p)
        if not lp:
            merged["phases"][p] = sp
        elif not sp:
            merged["phases"][p] = lp
        else:
            merged["phases"][p] = lp if (lp.get("total") or 0) >= (sp.get("total") or 0) else sp
    live_t, seed_t = live.get("timing"), seed.get("timing")
    if live_t and seed_t:
        merged["timing"] = live_t if (live_t.get("n_events") or 0) >= (seed_t.get("n_events") or 0) else seed_t
    else:
        merged["timing"] = live_t or seed_t
    return merged


def compute_dxp_data(history_data, item_limits=None, item_names=None, use_seed=True, events=None):
    """history_data: {item_id_str: [{timestamp, price, volume}, ...]}
    item_limits: optional {item_id_str: buy_limit}
    item_names: optional {item_id_str: name}
    events: optional merged event list from load_events() — falls back to
    the static EVENTS constant if not given.
    Returns: {item_id_str: {name, phases: {...}, timing: {...}}, "_meta": {...}}"""
    if events is None:
        events = EVENTS
    item_limits = item_limits or {}
    item_names = item_names or {}
    live = {}
    for item_id, points in history_data.items():
        if not points or len(points) < 20:
            continue
        parsed = parse_points(points)
        tally = classify_item(points, parsed=parsed, events=events)
        timing = best_buy_sell_days(points, parsed=parsed, events=events)
        has_signal = any(confidence_score(tally, p) for p in PHASES)
        if not has_signal and not timing:
            continue
        live[item_id] = {
            "name": item_names.get(item_id, item_id),
            "limit": item_limits.get(item_id),
            "phases": {p: {
                "rise": tally[p]["rise"], "drop": tally[p]["drop"], "flat": tally[p]["flat"],
                "total": tally[p]["total"], "avg_pct": tally[p]["avg_pct"],
                "median_pct": tally[p]["median_pct"], "avg_vol_ratio": tally[p]["avg_vol_ratio"],
                "events": tally[p]["events"],
            } for p in PHASES},
            "timing": timing,
        }

    meta = {"event_count": len(events)}
    if not use_seed:
        live["_meta"] = meta
        return live

    seed = load_seed()
    all_ids = (set(live) | set(seed)) - {"_meta"}
    out = {}
    for item_id in all_ids:
        merged = merge_entry(live.get(item_id), seed.get(item_id))
        if item_id in item_limits:
            merged["limit"] = item_limits[item_id]
        if item_id in item_names:
            merged["name"] = item_names[item_id]
        out[item_id] = merged
    # event_count reflects the live merged event list (grows over time as
    # we ship newly-confirmed cycles) — always the more current number,
    # even though most items' actual per-phase totals come from the seed
    # until the user's own history.json catches up.
    out["_meta"] = meta
    return out


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", required=True)
    args = ap.parse_args()
    data_dir = Path(args.data_dir)

    history = json.loads((data_dir / "history.json").read_text(encoding="utf-8"))
    item_limits, item_names = {}, {}
    latest_file = data_dir / "latest.json"
    if latest_file.exists():
        latest = json.loads(latest_file.read_text(encoding="utf-8"))
        for it in latest.get("items", []):
            if it.get("id"):
                item_limits[str(it["id"])] = it.get("limit")
                item_names[str(it["id"])] = it.get("name")

    events = load_events(data_dir)
    result = compute_dxp_data(history, item_limits, item_names, events=events)
    out_file = data_dir / "dxp_intelligence.json"
    out_file.write_text(json.dumps(result), encoding="utf-8")
    item_count = len(result) - (1 if "_meta" in result else 0)
    print(f"[dxp_intelligence] {item_count} items with a usable signal, "
          f"tracking {len(events)} DXP events, written to {out_file}")


if __name__ == "__main__":
    main()
