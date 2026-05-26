import { useState, useEffect, useCallback } from "react";
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
  CartesianGrid
} from "recharts";

// ─────────────────────────────────────────────────────────────
// THEME
// ─────────────────────────────────────────────────────────────
const T = {
  bg:       "#07090d",
  surface:  "#0d1117",
  panel:    "#111620",
  border:   "rgba(255,255,255,0.06)",
  borderHi: "rgba(255,255,255,0.12)",
  gold:     "#c9a84c",
  goldDim:  "#8a6f30",
  green:    "#3ddc84",
  red:      "#ff5c5c",
  blue:     "#5b8dee",
  purple:   "#9b72cf",
  amber:    "#f0a500",
  text:     "#d4cfc7",
  textDim:  "#6b7280",
  textMid:  "#9ca3af",
};

const CATEGORY_META = {
  liquidity:    { label: "High Liquidity", color: T.blue,   icon: "◈" },
  event_driven: { label: "Event-Driven",   color: T.amber,  icon: "◆" },
  chain:        { label: "Chain Reaction", color: T.purple, icon: "⬡" },
  high_value:   { label: "High Value",     color: T.gold,   icon: "◉" },
};

const ALERT_META = {
  price_ceiling_breach:   { label: "Ceiling Breach",    color: T.red,    icon: "▲" },
  price_floor_breach:     { label: "Floor Breach",      color: T.green,  icon: "▼" },
  flip_ceiling_breach:    { label: "Flip Ceiling",      color: T.red,    icon: "▲" },
  flip_floor_breach:      { label: "Flip Floor",        color: T.green,  icon: "▼" },
  price_spike:            { label: "Price Spike",       color: T.amber,  icon: "⚡" },
  ge_flip_divergence:     { label: "GE Divergence",     color: T.red,    icon: "≠" },
  volume_spike:           { label: "Volume Spike",      color: T.blue,   icon: "◈" },
  bearish_divergence:     { label: "Bearish Div.",      color: T.red,    icon: "⚠" },
  bullish_divergence:     { label: "Bullish Div.",      color: T.green,  icon: "◎" },
  rsi_overbought:         { label: "RSI Overbought",    color: T.red,    icon: "●" },
  rsi_oversold:           { label: "RSI Oversold",      color: T.green,  icon: "●" },
  golden_cross:           { label: "Golden Cross",      color: T.gold,   icon: "✦" },
  death_cross:            { label: "Death Cross",       color: T.red,    icon: "✦" },
  bollinger_breakout_up:  { label: "Breakout Up",       color: T.green,  icon: "↑" },
  bollinger_breakout_down:{ label: "Breakout Down",     color: T.red,    icon: "↓" },
  dxp_accumulation:       { label: "DXP Accum.",        color: T.amber,  icon: "⚡" },
  post_dxp_dump:          { label: "Post-DXP Dump",     color: T.purple, icon: "↓" },
};

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────
function fmtGp(n) {
  if (n == null) return "—";
  n = Number(n);
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
}

function fmtPct(n, showSign = true) {
  if (n == null) return "—";
  const sign = showSign && n > 0 ? "+" : "";
  return `${sign}${Number(n).toFixed(2)}%`;
}

function timeAgo(isoStr) {
  if (!isoStr) return "—";
  const diff = (Date.now() - new Date(isoStr).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ─────────────────────────────────────────────────────────────
// DEMO DATA — used when no real data/latest.json is present
// ─────────────────────────────────────────────────────────────
function makeDemoHistory(base, days = 90, vol = 0.04) {
  const pts = [];
  let price = base;
  const now = Date.now();
  for (let i = days; i >= 0; i--) {
    price = Math.max(1, Math.round(price + (Math.random() - 0.48) * vol * price));
    pts.push({ ts: now - i * 86400000, price, volume: Math.round(Math.random() * 50000 + 10000) });
  }
  return pts;
}

const DEMO_ITEMS = [
  { item_id: 2361,  name: "Runite bar",        category: "event_driven", skill: "Smithing",   ge_price: 12400, baseline_price: 10200, delta_pct: 21.57,  delta_7d_pct: 4.2,  ge_volume: 48000, vol_7d_avg: 62000, vol_30d_avg: 41000, vol_trend_pct: 51.2, ge_flip_divergence_pct: 3.1,  flip_price_mid: 12784, flip_margin: 840, flip_roi: 6.8,  flip_buy_limit: 100, flip_net_profit: 82000, limitations: [] },
  { item_id: 9738,  name: "Runite ore",         category: "event_driven", skill: "Mining",     ge_price: 8100,  baseline_price: 9400,  delta_pct: -13.83, delta_7d_pct: -2.1, ge_volume: 72000, vol_7d_avg: 55000, vol_30d_avg: 70000, vol_trend_pct: -21.4, ge_flip_divergence_pct: -1.2, flip_price_mid: 8003, flip_margin: 220, flip_roi: 2.7,  flip_buy_limit: 100, flip_net_profit: 21780, limitations: [] },
  { item_id: 2440,  name: "Super restore (4)",  category: "event_driven", skill: "Herblore",   ge_price: 13200, baseline_price: 11000, delta_pct: 20.0,   delta_7d_pct: 6.8,  ge_volume: 110000,vol_7d_avg: 148000,vol_30d_avg: 98000, vol_trend_pct: 51.0, ge_flip_divergence_pct: 5.8,  flip_price_mid: 13966, flip_margin: 1100,flip_roi: 8.3,  flip_buy_limit: 1000,flip_net_profit: 1071000,limitations:[]},
  { item_id: 15272, name: "Snapdragon",          category: "event_driven", skill: "Herblore",   ge_price: 7300,  baseline_price: 7800,  delta_pct: -6.41,  delta_7d_pct: -1.4, ge_volume: 95000, vol_7d_avg: 72000, vol_30d_avg: 90000, vol_trend_pct: -20.0, ge_flip_divergence_pct: -2.1, flip_price_mid: 7146, flip_margin: 180, flip_roi: 2.5,  flip_buy_limit: 10000,flip_net_profit: 1782000,limitations:[]},
  { item_id: 453,   name: "Coal",                category: "liquidity",    skill: "Mining",     ge_price: 198,   baseline_price: 210,   delta_pct: -5.71,  delta_7d_pct: -1.0, ge_volume: 820000,vol_7d_avg: 810000,vol_30d_avg: 830000,vol_trend_pct: -2.4,  ge_flip_divergence_pct: null, flip_price_mid: null, limitations: ["Flipaholics not used for low-value liquidity items"] },
  { item_id: 554,   name: "Fire rune",            category: "liquidity",    skill: "Magic",      ge_price: 19,    baseline_price: 18,    delta_pct: 5.56,   delta_7d_pct: 1.1,  ge_volume: 2100000,vol_7d_avg:2300000,vol_30d_avg:2100000,vol_trend_pct:9.5,   ge_flip_divergence_pct: null, flip_price_mid: null, limitations: ["Flipaholics not used for low-value liquidity items"] },
  { item_id: 2349,  name: "Iron bar",             category: "chain",        skill: "Smithing",   ge_price: 870,   baseline_price: 920,   delta_pct: -5.43,  delta_7d_pct: -0.8, ge_volume: 340000,vol_7d_avg: 310000,vol_30d_avg: 350000,vol_trend_pct: -11.4, ge_flip_divergence_pct: null, flip_price_mid: null, limitations: [] },
  { item_id: 3040,  name: "Overload (4)",          category: "event_driven", skill: "Herblore",   ge_price: 52000, baseline_price: 44000, delta_pct: 18.18,  delta_7d_pct: 5.2,  ge_volume: 28000, vol_7d_avg: 38000, vol_30d_avg: 25000, vol_trend_pct: 52.0, ge_flip_divergence_pct: 7.2,  flip_price_mid: 55744, flip_margin: 4200,flip_roi: 8.1,  flip_buy_limit: 100, flip_net_profit: 411600,limitations:[]},
].map(item => ({ ...item, history: makeDemoHistory(item.baseline_price) }));

const DEMO_ALERTS = [
  { item_id: 2361,  item_name: "Runite bar",       category: "event_driven", skill: "Smithing", alert_type: "price_ceiling_breach", reason: "GE price **12,400 gp** crossed above your alert ceiling of **12,000 gp**", severity: "high",   metrics: { ge_price: 12400, threshold: 12000, delta_pct: 21.57 }, timestamp: new Date(Date.now()-3600000).toISOString() },
  { item_id: 2440,  item_name: "Super restore (4)", category: "event_driven", skill: "Herblore", alert_type: "dxp_accumulation",     reason: "DXP March 2026 starts in 9 days. Price already up +20.0% — accumulation phase likely underway.", severity: "medium", metrics: { ge_price: 13200, delta_pct: 20.0,  days_to_dxp: 9 },    timestamp: new Date(Date.now()-7200000).toISOString() },
  { item_id: 3040,  item_name: "Overload (4)",       category: "event_driven", skill: "Herblore", alert_type: "ge_flip_divergence",   reason: "Real-world price (**55,744 gp**) is +7.2% above GE (**52,000 gp**) — possible post-update spike.", severity: "high",   metrics: { ge_price: 52000, flip_mid: 55744, divergence_pct: 7.2 },timestamp: new Date(Date.now()-1800000).toISOString() },
  { item_id: 2440,  item_name: "Super restore (4)", category: "event_driven", skill: "Herblore", alert_type: "volume_spike",         reason: "Trade volume up +51% (7d avg vs 30d avg) — unusually high activity.", severity: "medium", metrics: { vol_7d: 148000, vol_30d: 98000, vol_trend_pct: 51.0 },   timestamp: new Date(Date.now()-5400000).toISOString() },
  { item_id: 9738,  item_name: "Runite ore",         category: "event_driven", skill: "Mining",   alert_type: "rsi_oversold",         reason: "RSI is 28 (below 30) — item is oversold. Price dropped hard; a bounce may be incoming.", severity: "low",    metrics: { rsi: 28, ge_price: 8100 },                               timestamp: new Date(Date.now()-10800000).toISOString() },
];

const DEMO_INDICES = {
  common: { name: "GE Common Trade Index", value: 171.67 },
  metal:  { name: "GE Metal Index",        value: 357.39 },
  rune:   { name: "GE Rune Index",         value: 345.59 },
  log:    { name: "GE Log Index",          value: 2263.91 },
  food:   { name: "GE Food Index",         value: 1125.39 },
  herb:   { name: "GE Herb Index",         value: 287.09  },
};

const DEMO_SNAPSHOT = {
  fetched_at: new Date(Date.now() - 900000).toISOString(),
  dxp_phase:  { phase: "pre_dxp", event: "DXP March 2026", days_to_start: 9 },
  indices:    DEMO_INDICES,
  items:      DEMO_ITEMS,
};

const DEMO_ALERT_DATA = {
  generated_at: new Date(Date.now() - 900000).toISOString(),
  total: DEMO_ALERTS.length,
  alerts: DEMO_ALERTS,
};

// ─────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────

function PctBadge({ pct, size = "sm" }) {
  if (pct == null) return <span style={{ color: T.textDim, fontSize: 11 }}>—</span>;
  const pos = pct >= 0;
  const fs  = size === "lg" ? 15 : 12;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 3,
      padding: size === "lg" ? "3px 10px" : "2px 7px",
      borderRadius: 4, fontSize: fs, fontWeight: 700,
      fontFamily: "monospace",
      background: pos ? "rgba(61,220,132,0.1)" : "rgba(255,92,92,0.1)",
      color: pos ? T.green : T.red,
      border: `1px solid ${pos ? "rgba(61,220,132,0.2)" : "rgba(255,92,92,0.2)"}`,
    }}>
      {pos ? "▲" : "▼"} {Math.abs(pct).toFixed(2)}%
    </span>
  );
}

function MiniSparkline({ history, color }) {
  if (!history || history.length < 2) return <div style={{ color: T.textDim, fontSize: 11 }}>No data</div>;
  const pts = history.slice(-30).map(h => ({ price: h.price }));
  return (
    <ResponsiveContainer width="100%" height={36}>
      <AreaChart data={pts} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
        <defs>
          <linearGradient id={`sg_${color.replace("#","")}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={color} stopOpacity={0.25} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="price" stroke={color} strokeWidth={1.5}
          fill={`url(#sg_${color.replace("#","")})`} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function StatBox({ label, value, sub, color }) {
  return (
    <div style={{
      padding: "12px 14px",
      background: T.panel,
      border: `1px solid ${T.border}`,
      borderRadius: 8,
      flex: 1,
      minWidth: 100,
    }}>
      <div style={{ fontSize: 10, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: color || T.text, fontFamily: "monospace" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: T.textDim, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function IndexPill({ idx }) {
  return (
    <div style={{
      padding: "6px 12px",
      background: T.panel,
      border: `1px solid ${T.border}`,
      borderRadius: 6,
      display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
    }}>
      <div style={{ fontSize: 9, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.08em" }}>
        {idx.name.replace("GE ", "").replace(" Index", "")}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: T.gold, fontFamily: "monospace" }}>
        {idx.value?.toFixed(1) ?? "—"}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ITEM ROW
// ─────────────────────────────────────────────────────────────
function ItemRow({ item, selected, onClick }) {
  const cat   = CATEGORY_META[item.category] || { label: item.category, color: T.textDim, icon: "•" };
  const pos   = item.delta_pct >= 0;
  const color = item.delta_pct == null ? T.textDim : pos ? T.green : T.red;
  const hasFlip = item.ge_flip_divergence_pct != null;

  return (
    <div
      onClick={() => onClick(item)}
      style={{
        display: "grid",
        gridTemplateColumns: "24px 1fr 100px 80px 80px 110px 90px",
        alignItems: "center",
        gap: 8,
        padding: "10px 16px",
        cursor: "pointer",
        borderLeft: selected ? `3px solid ${T.gold}` : "3px solid transparent",
        background: selected ? `rgba(201,168,76,0.05)` : "transparent",
        borderBottom: `1px solid ${T.border}`,
        transition: "background 0.12s",
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = "transparent"; }}
    >
      {/* Category icon */}
      <div style={{ color: cat.color, fontSize: 14, textAlign: "center" }}>{cat.icon}</div>

      {/* Name + skill */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{item.name}</div>
        <div style={{ fontSize: 10, color: T.textDim, marginTop: 1 }}>{item.skill}</div>
      </div>

      {/* GE Price */}
      <div style={{ textAlign: "right", fontFamily: "monospace", fontSize: 13, color: T.text }}>
        {fmtGp(item.ge_price)} <span style={{ fontSize: 10, color: T.textDim }}>gp</span>
      </div>

      {/* Δ% 90d */}
      <div style={{ textAlign: "right" }}>
        <PctBadge pct={item.delta_pct} />
      </div>

      {/* Δ% 7d */}
      <div style={{ textAlign: "right" }}>
        <PctBadge pct={item.delta_7d_pct} />
      </div>

      {/* Sparkline */}
      <div>
        <MiniSparkline history={item.history} color={color} />
      </div>

      {/* Flip divergence */}
      <div style={{ textAlign: "right" }}>
        {hasFlip
          ? <PctBadge pct={item.ge_flip_divergence_pct} />
          : <span style={{ fontSize: 10, color: T.textDim }}>—</span>
        }
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// DETAIL PANEL
// ─────────────────────────────────────────────────────────────
function DetailPanel({ item, onClose, onAddAlert }) {
  if (!item) return null;
  const cat  = CATEGORY_META[item.category] || { label: item.category, color: T.textDim, icon: "•" };
  const pos  = item.delta_pct >= 0;
  const lineColor = item.delta_pct == null ? T.textDim : pos ? T.green : T.red;

  const chartData = (item.history || []).map((h, i) => ({
    day: i,
    price: h.price,
    volume: h.volume,
    baseline: item.baseline_price,
  }));

  return (
    <div style={{
      position: "fixed", right: 0, top: 0, bottom: 0, width: 400,
      background: T.surface,
      borderLeft: `1px solid ${T.borderHi}`,
      display: "flex", flexDirection: "column",
      zIndex: 200, overflowY: "auto",
    }}>
      {/* Header */}
      <div style={{
        padding: "20px 20px 16px",
        borderBottom: `1px solid ${T.border}`,
        background: `linear-gradient(to bottom, rgba(201,168,76,0.06), transparent)`,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 9, color: cat.color, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 5 }}>
              {cat.icon} {cat.label} · {item.skill}
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: T.gold }}>{item.name}</div>
          </div>
          <button onClick={onClose} style={{
            background: "none", border: "none", color: T.textDim, cursor: "pointer",
            fontSize: 22, lineHeight: 1, padding: 0,
          }}>×</button>
        </div>
      </div>

      {/* Key metrics */}
      <div style={{ padding: "16px 20px", display: "flex", gap: 8, flexWrap: "wrap" }}>
        <StatBox label="GE Price"    value={fmtGp(item.ge_price)} sub="gp" />
        <StatBox label="90d Baseline" value={fmtGp(item.baseline_price)} sub="gp" />
        <StatBox label="Δ 90d"  value={fmtPct(item.delta_pct)}  color={pos ? T.green : T.red} />
        <StatBox label="Δ 7d"   value={fmtPct(item.delta_7d_pct)} color={item.delta_7d_pct >= 0 ? T.green : T.red} />
      </div>

      {/* Volume row */}
      <div style={{ padding: "0 20px 16px", display: "flex", gap: 8, flexWrap: "wrap" }}>
        <StatBox label="GE Volume (today)" value={item.ge_volume ? item.ge_volume.toLocaleString() : "—"} />
        <StatBox label="Vol 7d avg" value={item.vol_7d_avg ? item.vol_7d_avg.toLocaleString() : "—"} />
        <StatBox label="Vol trend" value={fmtPct(item.vol_trend_pct)} color={item.vol_trend_pct >= 0 ? T.green : T.red} />
      </div>

      {/* Price chart */}
      <div style={{ padding: "0 20px 16px" }}>
        <div style={{ fontSize: 10, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
          90-Day Price History
        </div>
        <ResponsiveContainer width="100%" height={140}>
          <AreaChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
            <defs>
              <linearGradient id="dp_price" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={lineColor} stopOpacity={0.2} />
                <stop offset="95%" stopColor={lineColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="day" hide />
            <YAxis hide domain={["auto", "auto"]} />
            <Tooltip
              contentStyle={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 6, fontSize: 11 }}
              formatter={v => [`${fmtGp(v)} gp`, "Price"]}
              labelFormatter={l => `Day ${l}`}
            />
            <ReferenceLine y={item.baseline_price} stroke={T.goldDim} strokeDasharray="3 3" />
            <Area type="monotone" dataKey="price" stroke={lineColor} strokeWidth={2}
              fill="url(#dp_price)" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Volume chart */}
      {chartData.some(d => d.volume) && (
        <div style={{ padding: "0 20px 16px" }}>
          <div style={{ fontSize: 10, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
            Trade Volume (90d)
          </div>
          <ResponsiveContainer width="100%" height={70}>
            <BarChart data={chartData} margin={{ top: 2, right: 5, left: 5, bottom: 2 }}>
              <Bar dataKey="volume" fill={T.blue} opacity={0.6} radius={[1,1,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Flipaholics data */}
      {item.flip_price_mid && (
        <div style={{ margin: "0 20px 16px", padding: 14, background: T.panel, borderRadius: 8, border: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 10, color: T.gold, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
            Flipaholics Real-World Data
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {[
              ["Low",        fmtGp(item.flip_price_low)  + " gp"],
              ["High",       fmtGp(item.flip_price_high) + " gp"],
              ["Margin",     fmtGp(item.flip_margin)     + " gp"],
              ["Net Profit", fmtGp(item.flip_net_profit) + " gp"],
              ["ROI",        item.flip_roi != null ? `${item.flip_roi}%` : "—"],
              ["Buy Limit",  item.flip_buy_limit?.toLocaleString() ?? "—"],
              ["GE Div.",    fmtPct(item.ge_flip_divergence_pct)],
              ["Staleness",  item.flip_staleness || "—"],
            ].map(([l, v]) => (
              <div key={l}>
                <div style={{ fontSize: 9, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.08em" }}>{l}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.text, fontFamily: "monospace", marginTop: 2 }}>{v}</div>
              </div>
            ))}
          </div>
          {item.flip_limitations?.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 10, color: T.textDim, fontStyle: "italic" }}>
              ⚠ {item.flip_limitations[0]}
            </div>
          )}
        </div>
      )}

      {/* Limitations */}
      {item.limitations?.length > 0 && (
        <div style={{ margin: "0 20px 16px", padding: 12, background: "rgba(240,165,0,0.05)", borderRadius: 8, border: `1px solid rgba(240,165,0,0.15)` }}>
          <div style={{ fontSize: 10, color: T.amber, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
            ⚠ Data Limitations
          </div>
          {item.limitations.map((l, i) => (
            <div key={i} style={{ fontSize: 11, color: T.textMid, lineHeight: 1.6 }}>{l}</div>
          ))}
        </div>
      )}

      {/* Set Alert button */}
      <div style={{ padding: "0 20px 24px", marginTop: "auto" }}>
        <button
          onClick={() => onAddAlert(item)}
          style={{
            width: "100%", padding: "11px 0",
            background: "rgba(201,168,76,0.1)",
            border: `1px solid rgba(201,168,76,0.3)`,
            borderRadius: 8, color: T.gold,
            cursor: "pointer", fontSize: 13, fontWeight: 700,
            letterSpacing: "0.05em",
          }}
        >
          + Set Price Alert
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ALERT CARD
// ─────────────────────────────────────────────────────────────
function AlertCard({ alert }) {
  const meta = ALERT_META[alert.alert_type] || { label: alert.alert_type, color: T.textDim, icon: "•" };
  const sev  = { high: T.red, medium: T.amber, low: T.green }[alert.severity] || T.textDim;

  return (
    <div style={{
      padding: "14px 16px",
      borderLeft: `3px solid ${meta.color}`,
      borderBottom: `1px solid ${T.border}`,
      background: `linear-gradient(to right, ${meta.color}08, transparent)`,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ fontSize: 18, color: meta.color, lineHeight: 1, marginTop: 2 }}>{meta.icon}</div>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, flexWrap: "wrap" }}>
            <span style={{
              fontSize: 10, fontWeight: 700, color: meta.color,
              textTransform: "uppercase", letterSpacing: "0.08em",
              padding: "2px 7px", border: `1px solid ${meta.color}40`, borderRadius: 3,
            }}>{meta.label}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{alert.item_name}</span>
            <span style={{
              fontSize: 9, padding: "2px 6px", borderRadius: 3,
              background: `${sev}20`, color: sev,
              textTransform: "uppercase", letterSpacing: "0.06em",
            }}>{alert.severity}</span>
          </div>

          {/* Render reason — bold markdown approximation */}
          <div style={{ fontSize: 12, color: T.textMid, lineHeight: 1.6 }}>
            {alert.reason.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
              part.startsWith("**") && part.endsWith("**")
                ? <strong key={i} style={{ color: T.text }}>{part.slice(2,-2)}</strong>
                : part
            )}
          </div>

          <div style={{ marginTop: 7, display: "flex", gap: 12, fontSize: 10, color: T.textDim }}>
            <span>{alert.skill}</span>
            <span>{timeAgo(alert.timestamp)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ALERT SETUP MODAL
// ─────────────────────────────────────────────────────────────
function AlertModal({ item, onClose }) {
  const [above, setAbove] = useState("");
  const [below, setBelow] = useState("");

  if (!item) return null;

  const code = `# Add this to USER_PRICE_ALERTS in alerts.py:\n${item.item_id}: {"above": ${above || "None"}, "below": ${below || "None"}},  # ${item.name}`;

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 500,
    }}>
      <div style={{
        background: T.surface, border: `1px solid ${T.borderHi}`,
        borderRadius: 12, padding: 28, width: 380, maxWidth: "90vw",
      }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: T.gold, marginBottom: 6 }}>Set Price Alert</div>
        <div style={{ fontSize: 12, color: T.textDim, marginBottom: 20 }}>{item.name} · Current: {fmtGp(item.ge_price)} gp</div>

        {[["Alert above (ceiling)", above, setAbove], ["Alert below (floor)", below, setBelow]].map(([label, val, set]) => (
          <div key={label} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: T.textMid, marginBottom: 5 }}>{label}</div>
            <input
              value={val}
              onChange={e => set(e.target.value)}
              placeholder="e.g. 15000"
              style={{
                width: "100%", padding: "9px 12px",
                background: T.panel, border: `1px solid ${T.border}`,
                borderRadius: 6, color: T.text, fontSize: 13, outline: "none",
                fontFamily: "monospace", boxSizing: "border-box",
              }}
            />
          </div>
        ))}

        <div style={{ marginTop: 16, padding: 12, background: T.panel, borderRadius: 8, border: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 10, color: T.textDim, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Add this to alerts.py
          </div>
          <pre style={{ fontSize: 11, color: T.text, margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{code}</pre>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button onClick={onClose} style={{
            flex: 1, padding: "10px 0",
            background: "rgba(255,255,255,0.05)", border: `1px solid ${T.border}`,
            borderRadius: 8, color: T.textMid, cursor: "pointer", fontSize: 13,
          }}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────
export default function GEIntelligence() {
  const [snapshot, setSnapshot]   = useState(DEMO_SNAPSHOT);
  const [alertData, setAlertData] = useState(DEMO_ALERT_DATA);
  const [isDemo, setIsDemo]       = useState(true);
  const [tab, setTab]             = useState("watchlist");
  const [filter, setFilter]       = useState("all");
  const [search, setSearch]       = useState("");
  const [selectedItem, setSelectedItem] = useState(null);
  const [alertModal, setAlertModal]     = useState(null);
  const [sortBy, setSortBy]             = useState("delta_pct");

  // Try to load real data from GitHub Pages / local dev server
  useEffect(() => {
    fetch("./data/latest.json")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) { setSnapshot(d); setIsDemo(false); } })
      .catch(() => {});
    fetch("./data/alerts.json")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setAlertData(d); })
      .catch(() => {});
  }, []);

  const items   = snapshot?.items || [];
  const indices = snapshot?.indices || {};
  const dxp     = snapshot?.dxp_phase || { phase: "none" };
  const alerts  = alertData?.alerts || [];

  // Filter + sort items
  const displayed = items
    .filter(i => filter === "all" || i.category === filter)
    .filter(i => i.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === "delta_pct") return Math.abs(b.delta_pct || 0) - Math.abs(a.delta_pct || 0);
      if (sortBy === "volume")    return (b.ge_volume || 0) - (a.ge_volume || 0);
      if (sortBy === "divergence")return Math.abs(b.ge_flip_divergence_pct || 0) - Math.abs(a.ge_flip_divergence_pct || 0);
      return 0;
    });

  const highAlerts = alerts.filter(a => a.severity === "high").length;

  const DXP_BANNER = {
    pre_dxp:    { text: `DXP in ${dxp.days_to_start}d — ${dxp.event}`,  color: T.amber  },
    active_dxp: { text: `DXP ACTIVE — ${dxp.event}`,                     color: T.green  },
    post_dxp:   { text: `Post-DXP (${dxp.days_since_end}d) — ${dxp.event}`, color: T.purple },
  }[dxp.phase];

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.text, fontFamily: "'IBM Plex Mono', 'Courier New', monospace", display: "flex", flexDirection: "column" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Cinzel:wght@600;700&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: ${T.bg}; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 2px; }
        body { margin: 0; background: ${T.bg}; }
      `}</style>

      {/* ── HEADER ── */}
      <div style={{
        padding: "0 24px",
        borderBottom: `1px solid ${T.border}`,
        background: T.surface,
        display: "flex", alignItems: "center", gap: 16,
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ padding: "14px 0", display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: 34, height: 34,
            background: `linear-gradient(135deg, ${T.gold}, ${T.goldDim})`,
            borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 16, color: T.bg, fontWeight: 900,
          }}>⚔</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.gold, fontFamily: "'Cinzel', serif", letterSpacing: "0.05em" }}>
              GE Intelligence
            </div>
            <div style={{ fontSize: 9, color: T.textDim, letterSpacing: "0.1em", textTransform: "uppercase" }}>
              RS3 Market Analysis
            </div>
          </div>
        </div>

        <div style={{ flex: 1 }} />

        {/* DXP pill */}
        {DXP_BANNER && (
          <div style={{
            padding: "5px 12px", borderRadius: 20,
            background: `${DXP_BANNER.color}18`,
            border: `1px solid ${DXP_BANNER.color}40`,
            fontSize: 11, fontWeight: 700, color: DXP_BANNER.color,
          }}>⚡ {DXP_BANNER.text}</div>
        )}

        {/* Demo badge */}
        {isDemo && (
          <div style={{
            padding: "4px 10px", borderRadius: 20,
            background: "rgba(155,114,207,0.12)",
            border: "1px solid rgba(155,114,207,0.3)",
            fontSize: 10, color: T.purple,
          }}>DEMO DATA</div>
        )}

        {/* Last sync */}
        <div style={{ fontSize: 10, color: T.textDim }}>
          Synced {timeAgo(snapshot?.fetched_at)}
        </div>
        <div style={{ width: 7, height: 7, background: T.green, borderRadius: "50%", boxShadow: `0 0 6px ${T.green}` }} />
      </div>

      {/* ── INDICES BAR ── */}
      <div style={{
        padding: "10px 24px",
        background: T.surface,
        borderBottom: `1px solid ${T.border}`,
        display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center",
      }}>
        <div style={{ fontSize: 9, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.1em", marginRight: 4 }}>
          Indices
        </div>
        {Object.values(indices).map(idx => <IndexPill key={idx.name} idx={idx} />)}
      </div>

      {/* ── TABS ── */}
      <div style={{
        padding: "0 24px",
        background: T.surface,
        borderBottom: `1px solid ${T.border}`,
        display: "flex", alignItems: "center", gap: 4,
      }}>
        {[
          { id: "watchlist", label: "Market",   count: items.length },
          { id: "alerts",    label: "Alerts",   count: alerts.length, hot: highAlerts > 0 },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: "12px 14px",
            background: "none", border: "none", cursor: "pointer",
            fontSize: 12, fontWeight: 600,
            color: tab === t.id ? T.gold : T.textDim,
            borderBottom: tab === t.id ? `2px solid ${T.gold}` : "2px solid transparent",
            display: "flex", alignItems: "center", gap: 7,
            transition: "all 0.15s",
          }}>
            {t.label}
            <span style={{
              fontSize: 9, padding: "2px 6px", borderRadius: 10,
              background: t.hot ? T.red : "rgba(255,255,255,0.08)",
              color: t.hot ? "#fff" : T.textDim,
            }}>{t.count}</span>
          </button>
        ))}
      </div>

      {/* ── CONTENT ── */}
      <div style={{ flex: 1, display: "flex", marginRight: selectedItem ? 400 : 0, transition: "margin-right 0.2s" }}>
        <div style={{ flex: 1, overflow: "auto" }}>

          {tab === "watchlist" && (
            <>
              {/* Controls */}
              <div style={{
                padding: "10px 16px",
                borderBottom: `1px solid ${T.border}`,
                display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                background: T.surface,
              }}>
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search items..."
                  style={{
                    padding: "6px 10px", background: T.panel,
                    border: `1px solid ${T.border}`, borderRadius: 6,
                    color: T.text, fontSize: 12, outline: "none", width: 160,
                    fontFamily: "inherit",
                  }}
                />
                {/* Category filter */}
                {[["all","All"], ["liquidity","Liquidity"], ["event_driven","Seasonal"], ["chain","Chain"], ["high_value","High Value"]].map(([val, label]) => (
                  <button key={val} onClick={() => setFilter(val)} style={{
                    padding: "5px 10px", borderRadius: 5,
                    background: filter === val ? `rgba(201,168,76,0.15)` : "transparent",
                    border: `1px solid ${filter === val ? T.gold : T.border}`,
                    color: filter === val ? T.gold : T.textDim,
                    cursor: "pointer", fontSize: 11, fontFamily: "inherit",
                  }}>{label}</button>
                ))}
                <div style={{ flex: 1 }} />
                <select
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value)}
                  style={{
                    padding: "5px 8px", background: T.panel,
                    border: `1px solid ${T.border}`, borderRadius: 5,
                    color: T.textMid, fontSize: 11, outline: "none", cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  <option value="delta_pct">Sort: Biggest Move</option>
                  <option value="volume">Sort: Volume</option>
                  <option value="divergence">Sort: Flip Divergence</option>
                </select>
              </div>

              {/* Column headers */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "24px 1fr 100px 80px 80px 110px 90px",
                gap: 8, padding: "8px 16px",
                fontSize: 9, color: T.textDim, textTransform: "uppercase",
                letterSpacing: "0.1em",
                borderBottom: `1px solid ${T.border}`,
                background: "rgba(255,255,255,0.01)",
              }}>
                <div />
                <div>Item</div>
                <div style={{ textAlign: "right" }}>GE Price</div>
                <div style={{ textAlign: "right" }}>Δ 90d</div>
                <div style={{ textAlign: "right" }}>Δ 7d</div>
                <div style={{ textAlign: "center" }}>Trend</div>
                <div style={{ textAlign: "right" }}>Flip Div.</div>
              </div>

              {displayed.map(item => (
                <ItemRow
                  key={item.item_id}
                  item={item}
                  selected={selectedItem?.item_id === item.item_id}
                  onClick={setSelectedItem}
                />
              ))}
            </>
          )}

          {tab === "alerts" && (
            <>
              <div style={{
                padding: "10px 16px",
                fontSize: 10, color: T.textDim,
                borderBottom: `1px solid ${T.border}`,
                background: "rgba(255,255,255,0.01)",
              }}>
                {alerts.length} alert{alerts.length !== 1 ? "s" : ""} ·
                Generated {timeAgo(alertData?.generated_at)} ·
                High severity alerts also sent to Discord
              </div>
              {alerts.length === 0 && (
                <div style={{ padding: 60, textAlign: "center", color: T.textDim }}>
                  No alerts triggered in the last cycle.
                </div>
              )}
              {alerts.map((a, i) => <AlertCard key={i} alert={a} />)}
            </>
          )}

        </div>
      </div>

      {/* ── DETAIL PANEL ── */}
      {selectedItem && (
        <DetailPanel
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onAddAlert={item => { setAlertModal(item); setSelectedItem(null); }}
        />
      )}

      {/* ── ALERT MODAL ── */}
      {alertModal && (
        <AlertModal item={alertModal} onClose={() => setAlertModal(null)} />
      )}

      {/* ── FOOTER ── */}
      <div style={{
        padding: "10px 24px",
        borderTop: `1px solid ${T.border}`,
        fontSize: 9, color: T.textDim,
        display: "flex", justifyContent: "space-between",
        background: T.surface,
        marginRight: selectedItem ? 400 : 0,
        transition: "margin-right 0.2s",
        letterSpacing: "0.06em", textTransform: "uppercase",
      }}>
        <div>GE Intelligence · RS3 Market Analysis</div>
        <div>Data: WeirdGloop API + Flipaholics.pro · Volume: Wiki API · Alerts: Price ±5% | Flip Div. ±10%</div>
      </div>
    </div>
  );
}
