"""
GE Intelligence — Alert Engine
Reads latest.json, checks all alert rules, fires Discord notifications.
"""

import json
import os
import requests
import math
from datetime import datetime, timezone

DATA_DIR   = os.path.join(os.path.dirname(__file__), "data")
CONFIG_DIR = os.path.join(os.path.dirname(__file__), "config")
os.makedirs(CONFIG_DIR, exist_ok=True)

DISCORD_WEBHOOK = os.environ.get("DISCORD_WEBHOOK_URL", "")

# ─────────────────────────────────────────────────────────────
# USER ALERT RULES
# Edit this file to set your personal price alerts.
# Format:
#   item_id: {
#     "above": price_in_gp,   ← alert if GE price goes ABOVE this
#     "below": price_in_gp,   ← alert if GE price goes BELOW this
#     "flip_above": price,    ← alert if Flipaholics mid goes ABOVE this
#     "flip_below": price,    ← alert if Flipaholics mid goes BELOW this
#   }
# ─────────────────────────────────────────────────────────────

USER_PRICE_ALERTS = {
    # Example — edit these to your actual targets:
    2361:  {"above": 5000,    "below": 4500},      # Runite bar
    # High value examples:
    # 33088: {"flip_above": 3_000_000_000, "flip_below": 2_000_000_000},  # Tumeken's shadow
}

# ─────────────────────────────────────────────────────────────
# SYSTEM ALERT THRESHOLDS
# ─────────────────────────────────────────────────────────────

PRICE_SPIKE_THRESHOLD_PCT   = 5.0    # Alert if 90d change exceeds ±5%
DIVERGENCE_THRESHOLD_PCT    = 10.0   # Alert if Flipaholics vs GE diverges >10%
VOLUME_SPIKE_THRESHOLD_PCT  = 50.0   # Alert if 7d vol avg is 50% above 30d avg
RSI_OVERBOUGHT              = 70     # RSI above this = overbought
RSI_OVERSOLD                = 30     # RSI below this = oversold
MA_SHORT_DAYS               = 7
MA_LONG_DAYS                = 30
INDEX_MOVE_THRESHOLD_PCT    = 3.0    # Alert if sector index moves ±3% (requires history)

# ─────────────────────────────────────────────────────────────
# TECHNICAL INDICATORS
# ─────────────────────────────────────────────────────────────

def compute_rsi(prices, period=14):
    """
    Relative Strength Index.
    Returns float 0-100 or None if insufficient data.
    - Above 70: overbought (price rose fast, correction possible)
    - Below 30: oversold (price fell fast, bounce possible)
    """
    if len(prices) < period + 1:
        return None
    gains, losses = [], []
    for i in range(1, len(prices)):
        change = prices[i] - prices[i - 1]
        gains.append(max(change, 0))
        losses.append(max(-change, 0))
    avg_gain = sum(gains[-period:]) / period
    avg_loss = sum(losses[-period:]) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return round(100 - (100 / (1 + rs)), 2)

def compute_moving_averages(prices, short=MA_SHORT_DAYS, long=MA_LONG_DAYS):
    """
    Returns (short_ma, long_ma, crossover_signal).
    crossover_signal: 'golden_cross' | 'death_cross' | None
    - Golden cross: short MA crosses above long MA = bullish
    - Death cross:  short MA crosses below long MA = bearish
    """
    if len(prices) < long:
        return None, None, None
    short_ma = sum(prices[-short:]) / short
    long_ma  = sum(prices[-long:])  / long

    # Check if crossover happened in last 2 days
    if len(prices) >= long + 1:
        prev_short = sum(prices[-(short+1):-1]) / short
        prev_long  = sum(prices[-(long+1):-1])  / long
        if prev_short <= prev_long and short_ma > long_ma:
            signal = "golden_cross"
        elif prev_short >= prev_long and short_ma < long_ma:
            signal = "death_cross"
        else:
            signal = None
    else:
        signal = None

    return round(short_ma, 0), round(long_ma, 0), signal

def compute_bollinger_bands(prices, period=20, num_std=2):
    """
    Bollinger Bands — price envelope showing normal volatility range.
    Returns (upper, middle, lower, position_pct)
    position_pct: 0 = at lower band, 100 = at upper band, >100 = breakout above
    """
    if len(prices) < period:
        return None, None, None, None
    window  = prices[-period:]
    middle  = sum(window) / period
    std     = math.sqrt(sum((p - middle) ** 2 for p in window) / period)
    upper   = middle + num_std * std
    lower   = middle - num_std * std
    current = prices[-1]
    band_width = upper - lower
    if band_width == 0:
        return upper, middle, lower, 50.0
    position_pct = ((current - lower) / band_width) * 100
    return round(upper), round(middle), round(lower), round(position_pct, 1)

def detect_volume_price_divergence(item):
    """
    Detects: price rising but volume falling = weak move, possible reversal.
    Returns signal string or None.
    """
    pct = item.get("delta_pct")
    vol_trend = item.get("vol_trend_pct")
    if pct is None or vol_trend is None:
        return None
    if pct > 3 and vol_trend < -20:
        return "bearish_divergence"   # price up, volume down — weak
    if pct < -3 and vol_trend < -20:
        return "bullish_divergence"   # price down, volume also down — selling exhaustion
    return None

# ─────────────────────────────────────────────────────────────
# ALERT GENERATION
# ─────────────────────────────────────────────────────────────

def generate_alerts(snapshot):
    """
    Run all alert rules against the latest snapshot.
    Returns list of alert dicts.
    """
    alerts = []
    items     = snapshot.get("items", [])
    dxp_phase = snapshot.get("dxp_phase", {})
    indices   = snapshot.get("indices", {})

    for item in items:
        item_id  = item.get("item_id")
        name     = item.get("name", "Unknown")
        category = item.get("category", "")
        ge_price = item.get("ge_price")
        delta_pct= item.get("delta_pct")
        history  = item.get("history", [])
        prices   = [h["price"] for h in history if h.get("price")]

        # ── 1. USER PRICE ALERTS (floor / ceiling) ───────────
        if item_id in USER_PRICE_ALERTS and ge_price:
            rules = USER_PRICE_ALERTS[item_id]

            if rules.get("above") and ge_price > rules["above"]:
                alerts.append(_alert(
                    item, "price_ceiling_breach",
                    f"GE price **{fmt(ge_price)}** crossed above your alert ceiling of **{fmt(rules['above'])}**",
                    severity="high",
                    metrics={"ge_price": ge_price, "threshold": rules["above"], "delta_pct": delta_pct},
                ))

            if rules.get("below") and ge_price < rules["below"]:
                alerts.append(_alert(
                    item, "price_floor_breach",
                    f"GE price **{fmt(ge_price)}** dropped below your alert floor of **{fmt(rules['below'])}**",
                    severity="high",
                    metrics={"ge_price": ge_price, "threshold": rules["below"], "delta_pct": delta_pct},
                ))

            flip_mid = item.get("flip_price_mid")
            if rules.get("flip_above") and flip_mid and flip_mid > rules["flip_above"]:
                alerts.append(_alert(
                    item, "flip_ceiling_breach",
                    f"Flipaholics real price **{fmt(flip_mid)}** crossed above your ceiling of **{fmt(rules['flip_above'])}**",
                    severity="high",
                    metrics={"flip_price": flip_mid, "threshold": rules["flip_above"]},
                ))

            if rules.get("flip_below") and flip_mid and flip_mid < rules["flip_below"]:
                alerts.append(_alert(
                    item, "flip_floor_breach",
                    f"Flipaholics real price **{fmt(flip_mid)}** dropped below your floor of **{fmt(rules['flip_below'])}**",
                    severity="high",
                    metrics={"flip_price": flip_mid, "threshold": rules["flip_below"]},
                ))

        # ── 2. PRICE SPIKE (90d baseline) ────────────────────
        if delta_pct is not None and abs(delta_pct) >= PRICE_SPIKE_THRESHOLD_PCT:
            direction = "surged" if delta_pct > 0 else "dropped"
            alerts.append(_alert(
                item, "price_spike",
                f"Price {direction} **{delta_pct:+.1f}%** from 90-day baseline "
                f"({fmt(item.get('baseline_price'))} → {fmt(ge_price)})",
                severity="medium",
                metrics={"ge_price": ge_price, "baseline": item.get("baseline_price"), "delta_pct": delta_pct},
            ))

        # ── 3. GE vs FLIPAHOLICS DIVERGENCE ──────────────────
        div = item.get("ge_flip_divergence_pct")
        if div is not None and abs(div) >= DIVERGENCE_THRESHOLD_PCT:
            if div > 0:
                reason = (f"Real-world price (**{fmt(item.get('flip_price_mid'))}**) is "
                          f"**{div:+.1f}%** above GE (**{fmt(ge_price)}**) — "
                          f"possible post-update spike. GE hasn't caught up yet.")
            else:
                reason = (f"Real-world price (**{fmt(item.get('flip_price_mid'))}**) is "
                          f"**{div:.1f}%** below GE (**{fmt(ge_price)}**) — "
                          f"market correcting below GE price.")
            alerts.append(_alert(
                item, "ge_flip_divergence", reason,
                severity="high",
                metrics={"ge_price": ge_price, "flip_mid": item.get("flip_price_mid"), "divergence_pct": div},
            ))

        # ── 4. VOLUME SPIKE ───────────────────────────────────
        vol_trend = item.get("vol_trend_pct")
        if vol_trend is not None and vol_trend >= VOLUME_SPIKE_THRESHOLD_PCT:
            alerts.append(_alert(
                item, "volume_spike",
                f"Trade volume up **{vol_trend:+.0f}%** (7d avg vs 30d avg) — "
                f"unusually high activity. Watch for price follow-through.",
                severity="medium",
                metrics={"vol_7d": item.get("vol_7d_avg"), "vol_30d": item.get("vol_30d_avg"), "vol_trend_pct": vol_trend},
            ))

        # ── 5. VOLUME / PRICE DIVERGENCE ─────────────────────
        div_signal = detect_volume_price_divergence(item)
        if div_signal == "bearish_divergence":
            alerts.append(_alert(
                item, "bearish_divergence",
                f"Price rising **{delta_pct:+.1f}%** but volume is falling "
                f"(**{item.get('vol_trend_pct'):.0f}%** below average) — "
                f"weak move, possible reversal incoming.",
                severity="medium",
                metrics={"delta_pct": delta_pct, "vol_trend_pct": item.get("vol_trend_pct")},
            ))
        elif div_signal == "bullish_divergence":
            alerts.append(_alert(
                item, "bullish_divergence",
                f"Price falling **{delta_pct:+.1f}%** but selling volume also declining — "
                f"possible selling exhaustion, bounce may be near.",
                severity="low",
                metrics={"delta_pct": delta_pct, "vol_trend_pct": item.get("vol_trend_pct")},
            ))

        # ── 6. TECHNICAL INDICATORS ───────────────────────────
        if len(prices) >= 15:
            rsi = compute_rsi(prices)
            short_ma, long_ma, ma_signal = compute_moving_averages(prices)
            bb_upper, bb_mid, bb_lower, bb_pos = compute_bollinger_bands(prices)

            if rsi is not None:
                if rsi >= RSI_OVERBOUGHT:
                    alerts.append(_alert(
                        item, "rsi_overbought",
                        f"RSI is **{rsi}** (above {RSI_OVERBOUGHT}) — item is overbought. "
                        f"Price rose quickly; a pullback or cooldown is likely.",
                        severity="low",
                        metrics={"rsi": rsi, "ge_price": ge_price},
                    ))
                elif rsi <= RSI_OVERSOLD:
                    alerts.append(_alert(
                        item, "rsi_oversold",
                        f"RSI is **{rsi}** (below {RSI_OVERSOLD}) — item is oversold. "
                        f"Price dropped hard; a bounce may be incoming.",
                        severity="low",
                        metrics={"rsi": rsi, "ge_price": ge_price},
                    ))

            if ma_signal == "golden_cross":
                alerts.append(_alert(
                    item, "golden_cross",
                    f"7-day MA (**{fmt(short_ma)}**) just crossed above 30-day MA (**{fmt(long_ma)}**) — "
                    f"bullish trend confirmation.",
                    severity="medium",
                    metrics={"ma_short": short_ma, "ma_long": long_ma},
                ))
            elif ma_signal == "death_cross":
                alerts.append(_alert(
                    item, "death_cross",
                    f"7-day MA (**{fmt(short_ma)}**) just crossed below 30-day MA (**{fmt(long_ma)}**) — "
                    f"bearish trend confirmation.",
                    severity="medium",
                    metrics={"ma_short": short_ma, "ma_long": long_ma},
                ))

            if bb_pos is not None and bb_pos > 100:
                alerts.append(_alert(
                    item, "bollinger_breakout_up",
                    f"Price broke above upper Bollinger Band (**{fmt(bb_upper)}**) — "
                    f"unusually strong move. Watch for continuation or reversal.",
                    severity="medium",
                    metrics={"ge_price": ge_price, "bb_upper": bb_upper, "bb_position_pct": bb_pos},
                ))
            elif bb_pos is not None and bb_pos < 0:
                alerts.append(_alert(
                    item, "bollinger_breakout_down",
                    f"Price broke below lower Bollinger Band (**{fmt(bb_lower)}**) — "
                    f"unusually sharp drop.",
                    severity="medium",
                    metrics={"ge_price": ge_price, "bb_lower": bb_lower, "bb_position_pct": bb_pos},
                ))

        # ── 7. DXP EVENT SIGNALS ──────────────────────────────
        phase = dxp_phase.get("phase", "none")
        if category == "event_driven":
            if phase == "pre_dxp" and delta_pct and delta_pct > 2:
                days_to = dxp_phase.get("days_to_start", "?")
                alerts.append(_alert(
                    item, "dxp_accumulation",
                    f"**{dxp_phase.get('event')}** starts in {days_to} days. "
                    f"Price already up **{delta_pct:+.1f}%** — accumulation phase likely underway.",
                    severity="medium",
                    metrics={"ge_price": ge_price, "delta_pct": delta_pct, "days_to_dxp": days_to},
                ))
            elif phase == "post_dxp" and delta_pct and delta_pct < -2:
                days_since = dxp_phase.get("days_since_end", "?")
                alerts.append(_alert(
                    item, "post_dxp_dump",
                    f"**{dxp_phase.get('event')}** ended {days_since} days ago. "
                    f"Price down **{delta_pct:+.1f}%** — post-event dump in progress.",
                    severity="medium",
                    metrics={"ge_price": ge_price, "delta_pct": delta_pct, "days_since_dxp": days_since},
                ))

    return alerts


def _alert(item, alert_type, reason, severity="medium", metrics=None):
    return {
        "item_id":    item.get("item_id"),
        "item_name":  item.get("name"),
        "category":   item.get("category"),
        "skill":      item.get("skill"),
        "alert_type": alert_type,
        "reason":     reason,
        "severity":   severity,
        "metrics":    metrics or {},
        "timestamp":  datetime.now(timezone.utc).isoformat(),
    }

def fmt(n):
    """Format GP value for display."""
    if n is None:
        return "N/A"
    n = int(n)
    if abs(n) >= 1_000_000_000:
        return f"{n/1_000_000_000:.2f}B gp"
    if abs(n) >= 1_000_000:
        return f"{n/1_000_000:.2f}M gp"
    if abs(n) >= 1_000:
        return f"{n/1_000:.1f}K gp"
    return f"{n:,} gp"

# ─────────────────────────────────────────────────────────────
# DISCORD SENDER
# ─────────────────────────────────────────────────────────────

SEVERITY_COLORS = {
    "high":   0xFF4444,   # Red
    "medium": 0xFFB300,   # Amber
    "low":    0x4CAF50,   # Green
}

ALERT_EMOJIS = {
    "price_ceiling_breach":  "🔔",
    "price_floor_breach":    "🔔",
    "flip_ceiling_breach":   "🔔",
    "flip_floor_breach":     "🔔",
    "price_spike":           "📈",
    "ge_flip_divergence":    "⚡",
    "volume_spike":          "📊",
    "bearish_divergence":    "⚠️",
    "bullish_divergence":    "💡",
    "rsi_overbought":        "🔴",
    "rsi_oversold":          "🟢",
    "golden_cross":          "✨",
    "death_cross":           "💀",
    "bollinger_breakout_up": "🚀",
    "bollinger_breakout_down":"📉",
    "dxp_accumulation":      "⚡",
    "post_dxp_dump":         "📉",
}

CATEGORY_LABELS = {
    "liquidity":    "💧 High Liquidity",
    "event_driven": "⚡ Event-Driven",
    "chain":        "🔗 Chain Reaction",
    "high_value":   "💎 High Value",
}


def send_discord_alert(alert, webhook_url=None):
    """Send a single alert as a Discord embed."""
    url = webhook_url or DISCORD_WEBHOOK
    if not url:
        print(f"  [Discord] No webhook URL set — skipping: {alert['alert_type']} for {alert['item_name']}")
        return False

    emoji    = ALERT_EMOJIS.get(alert["alert_type"], "🔔")
    color    = SEVERITY_COLORS.get(alert["severity"], 0x888888)
    cat_label= CATEGORY_LABELS.get(alert["category"], alert["category"])

    # Build metrics string
    metrics_lines = []
    for k, v in alert.get("metrics", {}).items():
        label = k.replace("_", " ").title()
        if isinstance(v, float):
            metrics_lines.append(f"`{label}` {v:+.2f}%" if "pct" in k else f"`{label}` {v:.2f}")
        elif isinstance(v, int) and v > 1000:
            metrics_lines.append(f"`{label}` {fmt(v)}")
        else:
            metrics_lines.append(f"`{label}` {v}")

    embed = {
        "title":       f"{emoji} {alert['item_name']}",
        "description": alert["reason"],
        "color":       color,
        "fields": [
            {"name": "Category",   "value": cat_label,          "inline": True},
            {"name": "Skill",      "value": alert.get("skill", "—"), "inline": True},
            {"name": "Alert Type", "value": alert["alert_type"].replace("_", " ").title(), "inline": True},
        ],
        "footer": {
            "text": f"GE Intelligence • {alert['timestamp'][:16].replace('T', ' ')} UTC • "
                    f"Confidence: {'High' if alert['severity'] == 'high' else 'Medium'}"
        },
        "timestamp": alert["timestamp"],
    }

    if metrics_lines:
        embed["fields"].append({
            "name":   "Metrics",
            "value":  "\n".join(metrics_lines),
            "inline": False,
        })

    try:
        resp = requests.post(url, json={"embeds": [embed]}, timeout=10)
        if resp.status_code == 204:
            print(f"  [Discord] ✓ Sent: {alert['alert_type']} for {alert['item_name']}")
            return True
        else:
            print(f"  [Discord] ✗ Failed ({resp.status_code}): {resp.text[:100]}")
            return False
    except Exception as e:
        print(f"  [Discord] ✗ Error: {e}")
        return False


def send_discord_summary(alerts, snapshot, webhook_url=None):
    """Send a daily summary embed even if no alerts fired."""
    url = webhook_url or DISCORD_WEBHOOK
    if not url:
        return

    dxp = snapshot.get("dxp_phase", {})
    indices = snapshot.get("indices", {})
    items = snapshot.get("items", [])

    # Top movers
    movers = sorted(
        [i for i in items if i.get("delta_pct") is not None],
        key=lambda x: abs(x["delta_pct"]), reverse=True
    )[:5]

    mover_lines = []
    for m in movers:
        pct = m["delta_pct"]
        arrow = "▲" if pct > 0 else "▼"
        mover_lines.append(f"{arrow} **{m['name']}** {pct:+.1f}% — {fmt(m.get('ge_price'))}")

    index_lines = []
    for key, idx in indices.items():
        val = idx.get("value")
        if val:
            index_lines.append(f"`{idx['name'].replace('GE ', '').replace(' Index', '')}` {val:.1f}")

    dxp_str = {
        "none":       "No active DXP event",
        "pre_dxp":    f"⚡ DXP in {dxp.get('days_to_start', '?')} days — {dxp.get('event', '')}",
        "active_dxp": f"⚡ DXP ACTIVE — {dxp.get('event', '')}",
        "post_dxp":   f"Post-DXP ({dxp.get('days_since_end', '?')}d ago) — {dxp.get('event', '')}",
    }.get(dxp.get("phase", "none"), "Unknown")

    embed = {
        "title":       "📊 GE Intelligence — Daily Summary",
        "color":       0x5865F2,
        "fields": [
            {"name": "🗓 DXP Status",      "value": dxp_str,                          "inline": False},
            {"name": "📈 Top Movers (90d)", "value": "\n".join(mover_lines) or "None", "inline": False},
            {"name": "📊 Market Indices",   "value": " | ".join(index_lines) or "N/A", "inline": False},
            {"name": "🔔 Alerts Fired",     "value": str(len(alerts)),                 "inline": True},
            {"name": "📦 Items Tracked",    "value": str(len(items)),                  "inline": True},
        ],
        "footer":  {"text": "GE Intelligence • Data: WeirdGloop API + Flipaholics.pro"},
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    try:
        resp = requests.post(url, json={"embeds": [embed]}, timeout=10)
        if resp.status_code == 204:
            print("  [Discord] ✓ Summary sent")
    except Exception as e:
        print(f"  [Discord] Summary error: {e}")


# ─────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────

def run_alerts():
    print(f"\n{'='*60}")
    print(f"  GE INTELLIGENCE — ALERT ENGINE")
    print(f"  {datetime.now(timezone.utc).isoformat()}")
    print(f"{'='*60}\n")

    # Load latest snapshot
    latest_path = os.path.join(DATA_DIR, "latest.json")
    if not os.path.exists(latest_path):
        print("  ERROR: No latest.json found. Run fetcher.py first.")
        return

    with open(latest_path) as f:
        snapshot = json.load(f)

    print(f"  Snapshot from: {snapshot.get('fetched_at', 'unknown')}")
    print(f"  DXP phase: {snapshot.get('dxp_phase', {}).get('phase', 'none')}")

    # Generate alerts
    alerts = generate_alerts(snapshot)
    print(f"\n  Alerts generated: {len(alerts)}")

    high   = [a for a in alerts if a["severity"] == "high"]
    medium = [a for a in alerts if a["severity"] == "medium"]
    low    = [a for a in alerts if a["severity"] == "low"]
    print(f"  High: {len(high)} | Medium: {len(medium)} | Low: {len(low)}")

    # Save alerts to file (dashboard reads this)
    alerts_path = os.path.join(DATA_DIR, "alerts.json")
    with open(alerts_path, "w") as f:
        json.dump({
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "total": len(alerts),
            "alerts": alerts,
        }, f, indent=2)
    print(f"\n  Saved alerts → {alerts_path}")

    # Send to Discord
    if DISCORD_WEBHOOK:
        print("\n  Sending to Discord...")
        # Send high severity first, then medium
        import time
        for alert in high + medium:
            send_discord_alert(alert)
            time.sleep(0.5)   # avoid rate limiting
        # Always send daily summary
        send_discord_summary(alerts, snapshot)
    else:
        print("\n  [Discord] DISCORD_WEBHOOK_URL not set — skipping notifications")
        print("  Set it in GitHub Secrets or as an environment variable.")

    print("\n  Done.\n")
    return alerts


if __name__ == "__main__":
    run_alerts()
