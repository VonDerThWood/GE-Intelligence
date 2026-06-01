/* ═══════════════════════════════════════════════════════════════
   GEnius Renderer — Grand Exchange skin
   Inline React (UMD), no build step required
═══════════════════════════════════════════════════════════════ */
const { createElement: h, useState, useEffect, useCallback, useRef, useMemo } = React;
const { createRoot } = ReactDOM;

const T = {
  bg:        '#1a1209',
  panel:     '#2b1f0e',
  panel2:    '#3a2b13',
  inset:     '#150e05',
  border:    '#6b4c1e',
  borderDim: '#3d2c0e',
  borderGold:'#c9a84c',
  text:      '#f0d98a',
  textDim:   '#9c7b3f',
  textBright:'#ffe9a0',
  gold:      '#c9a84c',
  goldBright:'#ffd700',
  copper:    '#b87333',
  green:     '#4caf50',
  red:       '#e53935',
  blue:      '#64b5f6',
  shadow:    'rgba(0,0,0,0.6)',
};

const CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body, #root { height: 100%; overflow: hidden; }
body {
  background: ${T.bg}; color: ${T.text};
  font-family: 'Cinzel', 'Georgia', serif; font-size: 14px;
  -webkit-font-smoothing: antialiased;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='4'%3E%3Crect width='4' height='4' fill='%231a1209'/%3E%3Crect width='1' height='1' fill='%23221508' opacity='0.6'/%3E%3Crect x='2' y='2' width='1' height='1' fill='%23110c04' opacity='0.6'/%3E%3C/svg%3E");
}
::-webkit-scrollbar { width: 7px; height: 7px; }
::-webkit-scrollbar-track { background: ${T.panel}; }
::-webkit-scrollbar-thumb { background: ${T.border}; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: ${T.gold}; }
.app { display: flex; height: 100vh; }
.main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.ge-header {
  background: linear-gradient(180deg, #3d2c0f 0%, #2b1e0a 100%);
  border-bottom: 2px solid ${T.border}; padding: 0 16px; height: 44px;
  display: flex; align-items: center; gap: 12px; flex-shrink: 0;
}
.ge-logo { font-family: 'Cinzel', serif; font-size: 18px; font-weight: 700; color: ${T.goldBright}; letter-spacing: 3px; text-shadow: 0 1px 3px rgba(0,0,0,0.8), 0 0 12px rgba(255,215,0,0.3); flex-shrink: 0; }
.ge-logo span { color: ${T.copper}; }
.sidebar {
  width: 172px; min-width: 172px; background: ${T.panel}; border-right: 2px solid ${T.border};
  display: flex; flex-direction: column; overflow-y: auto; overflow-x: hidden; padding: 8px 0 16px;
}
.nav-group-label { font-size: 9px; letter-spacing: 2px; text-transform: uppercase; color: ${T.textDim}; padding: 10px 12px 3px; border-top: 1px solid ${T.borderDim}; margin-top: 4px; }
.nav-group-label:first-child { border-top: none; margin-top: 0; }
.nav-btn { display: flex; align-items: center; gap: 7px; width: 100%; padding: 6px 12px; background: none; border: none; cursor: pointer; color: ${T.textDim}; font-family: 'Cinzel', serif; font-size: 12px; text-align: left; border-left: 3px solid transparent; transition: all 0.1s; letter-spacing: 0.3px; }
.nav-btn:hover { color: ${T.text}; background: rgba(201,168,76,0.06); }
.nav-btn.active { color: ${T.goldBright}; background: rgba(201,168,76,0.12); border-left-color: ${T.gold}; }
.nav-icon { font-size: 12px; width: 14px; text-align: center; flex-shrink: 0; }
.ge-search-wrap { flex: 1; max-width: 460px; position: relative; }
.ge-search-input { width: 100%; background: ${T.inset}; border: 2px solid ${T.border}; border-radius: 3px; padding: 6px 34px 6px 10px; color: ${T.textBright}; font-family: 'Cinzel', serif; font-size: 13px; outline: none; box-shadow: inset 0 1px 4px rgba(0,0,0,0.5); transition: border-color 0.15s; letter-spacing: 0.3px; }
.ge-search-input:focus { border-color: ${T.gold}; }
.ge-search-input::placeholder { color: ${T.textDim}; font-size: 12px; }
.ge-search-clear { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); background: none; border: none; color: ${T.textDim}; cursor: pointer; font-size: 13px; padding: 2px; }
.ge-search-clear:hover { color: ${T.text}; }
.ge-search-results { position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 100; background: ${T.panel}; border: 2px solid ${T.border}; border-radius: 3px; box-shadow: 0 4px 16px rgba(0,0,0,0.7); max-height: 320px; overflow-y: auto; }
.ge-result-item { display: flex; align-items: center; gap: 10px; padding: 7px 10px; cursor: pointer; border-bottom: 1px solid ${T.borderDim}; transition: background 0.1s; }
.ge-result-item:last-child { border-bottom: none; }
.ge-result-item:hover, .ge-result-item.focused { background: rgba(201,168,76,0.12); }
.ge-result-name { flex: 1; font-size: 13px; color: ${T.text}; }
.ge-result-price { font-size: 12px; color: ${T.gold}; }
.ge-result-category { font-size: 10px; color: ${T.textDim}; background: rgba(107,76,30,0.4); padding: 1px 5px; border-radius: 2px; }
.ge-status { display: flex; align-items: center; gap: 6px; padding: 3px 8px; background: ${T.inset}; border: 1px solid ${T.borderDim}; border-radius: 2px; font-size: 11px; color: ${T.textDim}; white-space: nowrap; }
.status-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.status-dot.live   { background: ${T.green}; box-shadow: 0 0 5px ${T.green}; animation: blink 2s infinite; }
.status-dot.stale  { background: ${T.gold}; }
.status-dot.none   { background: ${T.textDim}; }
@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.3} }
.ge-btn { padding: 6px 14px; background: linear-gradient(180deg, #4a3510 0%, #2e200a 100%); border: 2px solid ${T.border}; border-radius: 3px; color: ${T.text}; font-family: 'Cinzel', serif; font-size: 12px; cursor: pointer; letter-spacing: 0.5px; box-shadow: inset 0 1px 0 rgba(201,168,76,0.2), 1px 1px 3px rgba(0,0,0,0.4); transition: all 0.1s; white-space: nowrap; }
.ge-btn:hover { background: linear-gradient(180deg, #5a420f 0%, #3a270c 100%); border-color: ${T.gold}; color: ${T.textBright}; }
.ge-btn:active { box-shadow: inset 0 1px 3px rgba(0,0,0,0.5); transform: translateY(1px); }
.ge-btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }
.ge-btn.gold { background: linear-gradient(180deg, #c9a84c 0%, #8a6d2a 100%); color: #1a1209; border-color: ${T.goldBright}; }
.ge-btn.gold:hover { background: linear-gradient(180deg, #ffd700 0%, #c9a84c 100%); }
.ge-btn.danger { border-color: ${T.red}; color: ${T.red}; }
.ge-btn.danger:hover { background: rgba(229,57,53,0.15); }
.content { flex: 1; overflow-y: auto; padding: 14px 16px; }
.ge-table-wrap { overflow-x: auto; }
.ge-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.ge-table th { padding: 6px 10px; font-family: 'Cinzel', serif; font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase; color: ${T.gold}; border-bottom: 2px solid ${T.border}; text-align: left; cursor: pointer; user-select: none; background: rgba(0,0,0,0.2); white-space: nowrap; }
.ge-table th:hover { color: ${T.goldBright}; }
.ge-table td { padding: 6px 10px; border-bottom: 1px solid ${T.borderDim}; color: ${T.text}; }
.ge-table tr { cursor: pointer; }
.ge-table tr:hover td { background: rgba(201,168,76,0.07); }
.ge-table tr.selected td { background: rgba(201,168,76,0.14); border-left: 3px solid ${T.gold}; }
.ge-table tr.selected td:first-child { padding-left: 7px; }

/* ── Detail panel ── */
.detail-panel { width: 296px; min-width: 296px; background: ${T.panel}; border-left: 2px solid ${T.border}; display: flex; flex-direction: column; overflow-y: auto; }
.detail-top { padding: 14px; border-bottom: 2px solid ${T.border}; background: linear-gradient(180deg, ${T.panel2} 0%, ${T.panel} 100%); }
.detail-name { font-family: 'Cinzel', serif; font-size: 15px; color: ${T.goldBright}; margin-bottom: 2px; text-shadow: 0 1px 3px rgba(0,0,0,0.6); letter-spacing: 0.5px; }
.detail-cats { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
.cat-tag { font-size: 10px; padding: 1px 6px; background: rgba(107,76,30,0.5); border: 1px solid ${T.borderDim}; border-radius: 2px; color: ${T.textDim}; text-transform: uppercase; letter-spacing: 0.5px; }
.detail-price { font-size: 24px; color: ${T.gold}; font-weight: 300; }
.detail-body { padding: 12px 14px; }
.stat-row { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; border-bottom: 1px solid rgba(61,44,14,0.7); font-size: 12px; }
.stat-row:last-child { border-bottom: none; }
.stat-lbl { color: ${T.textDim}; }
.stat-val { color: ${T.text}; text-align: right; }

/* ── Sparkline ── */
.sparkline-wrap { margin: 10px 0; padding: 8px; background: ${T.inset}; border: 1px solid ${T.borderDim}; border-radius: 3px; cursor: pointer; position: relative; }
.sparkline-wrap:hover { border-color: ${T.gold}; }
.sparkline-expand-hint { position: absolute; bottom: 4px; right: 6px; font-size: 9px; color: ${T.textDim}; letter-spacing: 0.5px; }

/* ── Chart modal ── */
.chart-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.75); z-index: 500; display: flex; align-items: center; justify-content: center; }
.chart-modal { background: ${T.panel}; border: 2px solid ${T.border}; border-radius: 6px; padding: 20px; width: 680px; max-width: 95vw; box-shadow: 0 8px 32px rgba(0,0,0,0.8); }
.chart-modal-title { font-family: 'Cinzel', serif; font-size: 15px; color: ${T.goldBright}; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: center; }
.chart-modal-close { background: none; border: none; color: ${T.textDim}; font-size: 18px; cursor: pointer; padding: 0 4px; }
.chart-modal-close:hover { color: ${T.text}; }

/* ── Signal badges ── */
.signal-list { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
.signal-badge { font-size: 10px; padding: 2px 6px; border-radius: 2px; letter-spacing: 0.5px; border: 1px solid; }
.signal-badge.SURGE   { background: rgba(76,175,80,0.15); border-color: rgba(76,175,80,0.4); color: ${T.green}; }
.signal-badge.DUMP    { background: rgba(229,57,53,0.15); border-color: rgba(229,57,53,0.4); color: ${T.red}; }
.signal-badge.MARGIN  { background: rgba(201,168,76,0.15); border-color: rgba(201,168,76,0.4); color: ${T.gold}; }
.signal-badge.HIGH_VOL{ background: rgba(100,181,246,0.15); border-color: rgba(100,181,246,0.4); color: ${T.blue}; }

/* ── Star button ── */
.star-btn { background: none; border: none; cursor: pointer; font-size: 16px; padding: 2px 4px; transition: transform 0.1s; line-height: 1; }
.star-btn:hover { transform: scale(1.25); }
.star-on  { color: ${T.goldBright}; }
.star-off { color: ${T.borderDim}; }

/* ── Market overview ── */
.overview-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 14px; }
.ov-card { padding: 10px 12px; background: ${T.panel2}; border: 1px solid ${T.borderDim}; border-radius: 3px; box-shadow: inset 0 1px 0 rgba(201,168,76,0.08); }
.ov-val { font-size: 20px; color: ${T.gold}; font-weight: 300; }
.ov-lbl { font-size: 10px; color: ${T.textDim}; margin-top: 2px; letter-spacing: 0.5px; text-transform: uppercase; }

/* ── Watchlist offer slots ── */
.offer-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
.offer-slot { padding: 10px 12px; background: ${T.panel2}; border: 2px solid ${T.border}; border-radius: 3px; cursor: pointer; transition: border-color 0.15s; box-shadow: inset 0 1px 0 rgba(201,168,76,0.1), 1px 1px 4px rgba(0,0,0,0.3); position: relative; }
.offer-slot:hover { border-color: ${T.gold}; }
.offer-slot-name { font-size: 12px; color: ${T.textBright}; margin-bottom: 4px; letter-spacing: 0.3px; padding-right: 20px; }
.offer-slot-price { font-size: 16px; color: ${T.gold}; }
.offer-slot-change { font-size: 11px; margin-top: 3px; }
.offer-slot-star { position: absolute; top: 8px; right: 8px; }

/* ── Volume display ── */
.vol-high { color: ${T.green}; }
.vol-low  { color: ${T.textDim}; }
.vol-wrap { display: flex; flex-direction: column; line-height: 1.3; }
.vol-last { font-size: 11px; }
.vol-avg  { font-size: 10px; color: ${T.textDim}; }

/* ── Form elements ── */
.ge-input { background: ${T.inset}; border: 2px solid ${T.borderDim}; border-radius: 3px; padding: 6px 10px; color: ${T.text}; font-family: 'Cinzel', serif; font-size: 12px; outline: none; width: 100%; box-shadow: inset 0 1px 3px rgba(0,0,0,0.4); transition: border-color 0.15s; }
.ge-input:focus { border-color: ${T.gold}; }
.ge-input::placeholder { color: ${T.textDim}; }
select.ge-input option { background: ${T.panel}; }
.form-lbl { font-size: 10px; letter-spacing: 1px; text-transform: uppercase; color: ${T.textDim}; margin-bottom: 4px; display: block; }
.ge-section-head { font-family: 'Cinzel', serif; font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: ${T.gold}; padding: 0 0 6px; border-bottom: 1px solid ${T.border}; margin-bottom: 10px; }
.news-item { padding: 10px 0; border-bottom: 1px solid ${T.borderDim}; }
.news-item:last-child { border-bottom: none; }
.news-src { font-size: 10px; color: ${T.textDim}; text-transform: uppercase; letter-spacing: 0.8px; }
.news-title { font-size: 13px; color: ${T.text}; cursor: pointer; margin: 2px 0; line-height: 1.4; }
.news-title:hover { color: ${T.goldBright}; }
.news-tag { font-size: 10px; padding: 1px 5px; background: rgba(201,168,76,0.12); border: 1px solid rgba(201,168,76,0.25); border-radius: 2px; color: ${T.textDim}; }
.alert-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid ${T.borderDim}; font-size: 12px; }
.alert-cond { font-size: 11px; padding: 1px 6px; border-radius: 2px; border: 1px solid; }
.alert-cond.above { background: rgba(229,57,53,0.12); border-color: rgba(229,57,53,0.3); color: ${T.red}; }
.alert-cond.below { background: rgba(76,175,80,0.12); border-color: rgba(76,175,80,0.3); color: ${T.green}; }
.toast-tray { position: fixed; bottom: 16px; right: 16px; display: flex; flex-direction: column; gap: 6px; z-index: 999; }
.toast { padding: 8px 14px; background: ${T.panel2}; border: 2px solid ${T.border}; border-radius: 3px; font-size: 12px; color: ${T.text}; box-shadow: 2px 2px 8px rgba(0,0,0,0.6); animation: toastIn 0.2s ease; max-width: 280px; }
.toast.success { border-left: 4px solid ${T.green}; }
.toast.error   { border-left: 4px solid ${T.red}; }
.toast.info    { border-left: 4px solid ${T.gold}; }
@keyframes toastIn { from { transform: translateX(16px); opacity: 0; } }
@keyframes spin { to { transform: rotate(360deg); } }
.spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid ${T.borderDim}; border-top-color: ${T.gold}; border-radius: 50%; animation: spin 0.7s linear infinite; }
.empty { text-align: center; padding: 40px 20px; color: ${T.textDim}; }
.empty .icon { font-size: 28px; margin-bottom: 8px; }
.empty p { font-size: 13px; }
.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.row { display: flex; align-items: center; gap: 8px; }
.row-between { display: flex; align-items: center; justify-content: space-between; }
.pct-up   { color: ${T.green}; }
.pct-down { color: ${T.red}; }
.pct-flat { color: ${T.textDim}; }
`;

const PARCHMENT_CSS = `
body { background: #f4e9d0 !important; color: #2a1a05 !important; background-image: none !important; }
.app { background: #f4e9d0; }
.sidebar { background: #e8d5a8 !important; border-color: #8b6914 !important; }
.ge-header { background: linear-gradient(180deg, #ddc88a 0%, #c9a84c 100%) !important; border-color: #8b6914 !important; }
.ge-logo { color: #3a1a00 !important; text-shadow: none !important; }
.nav-btn { color: #6b4c1e !important; }
.nav-btn:hover { background: rgba(139,105,20,0.12) !important; color: #3a1a00 !important; }
.nav-btn.active { color: #3a1a00 !important; background: rgba(139,105,20,0.2) !important; border-left-color: #8b6914 !important; }
.nav-group-label { color: #8b6914 !important; border-color: #c9a84c !important; }
.ge-search-input { background: #fdf6e3 !important; color: #2a1a05 !important; border-color: #8b6914 !important; }
.ge-search-results { background: #e8d5a8 !important; border-color: #8b6914 !important; }
.ge-result-name { color: #2a1a05 !important; }
.ge-result-item:hover, .ge-result-item.focused { background: rgba(139,105,20,0.15) !important; }
.ge-status { background: #fdf6e3 !important; border-color: #c9a84c !important; color: #6b4c1e !important; }
.ge-btn { background: linear-gradient(180deg, #ddc88a 0%, #c9a84c 100%) !important; color: #2a1a05 !important; border-color: #8b6914 !important; }
.ge-btn.gold { background: linear-gradient(180deg, #c9a84c 0%, #8b6914 100%) !important; color: #fff8e7 !important; }
.content { background: #f4e9d0 !important; }
.ge-table th { color: #6b3a00 !important; background: rgba(0,0,0,0.06) !important; border-color: #8b6914 !important; }
.ge-table td { color: #2a1a05 !important; border-color: rgba(139,105,20,0.3) !important; }
.ge-table tr:hover td { background: rgba(139,105,20,0.1) !important; }
.ge-table tr.selected td { background: rgba(139,105,20,0.2) !important; border-left-color: #8b6914 !important; }
.detail-panel { background: #e8d5a8 !important; border-color: #8b6914 !important; }
.detail-top { background: linear-gradient(180deg, #ddc88a 0%, #e8d5a8 100%) !important; border-color: #8b6914 !important; }
.detail-name { color: #3a1a00 !important; text-shadow: none !important; }
.detail-price { color: #6b3a00 !important; }
.stat-lbl { color: #8b6914 !important; }
.stat-val { color: #2a1a05 !important; }
.sparkline-wrap { background: #fdf6e3 !important; border-color: #c9a84c !important; }
.chart-modal { background: #e8d5a8 !important; border-color: #8b6914 !important; }
.cat-tag { background: rgba(139,105,20,0.2) !important; border-color: #c9a84c !important; color: #6b3a00 !important; }
.ov-card { background: #ddc88a !important; border-color: #c9a84c !important; }
.ov-val { color: #6b3a00 !important; }
.ov-lbl { color: #8b6914 !important; }
.offer-slot { background: #ddc88a !important; border-color: #8b6914 !important; }
.offer-slot-name { color: #2a1a05 !important; }
.offer-slot-price { color: #6b3a00 !important; }
.ge-input { background: #fdf6e3 !important; color: #2a1a05 !important; border-color: #c9a84c !important; }
.ge-section-head { color: #6b3a00 !important; border-color: #8b6914 !important; }
.news-title { color: #2a1a05 !important; }
.news-title:hover { color: #6b3a00 !important; }
.toast { background: #e8d5a8 !important; border-color: #8b6914 !important; color: #2a1a05 !important; }
.star-off { color: #c9a84c !important; }
::-webkit-scrollbar-track { background: #e8d5a8 !important; }
::-webkit-scrollbar-thumb { background: #8b6914 !important; }
`;

/* ─── Helpers ────────────────────────────────────────────────── */
const fmt = {
  gp:  n => { if (!n && n !== 0) return '—'; const a = Math.abs(n); if (a >= 1e9) return (n/1e9).toFixed(2)+'B'; if (a >= 1e6) return (n/1e6).toFixed(2)+'M'; if (a >= 1e3) return (n/1e3).toFixed(1)+'K'; return n.toLocaleString(); },
  pct: n => (n >= 0 ? '+' : '') + n.toFixed(2) + '%',
  num: n => n ? n.toLocaleString() : '—',
};
const pctClass = n => !n ? 'pct-flat' : n > 0 ? 'pct-up' : 'pct-down';

function useToast() {
  const [toasts, setToasts] = useState([]);
  const add = useCallback((msg, type='info') => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, {id, msg, type}]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3200);
  }, []);
  return {toasts, add};
}

/* ─── Volume display — last vs avg ──────────────────────────── */
function VolDisplay({volume, avgVolume}) {
  if (!volume && !avgVolume) return h('span', {style:{color:T.textDim}}, '—');
  const isHigh = avgVolume && volume && volume > avgVolume * 1.5;
  const isLow  = avgVolume && volume && volume < avgVolume * 0.5;
  const cls = isHigh ? 'vol-high' : isLow ? 'vol-low' : '';
  if (avgVolume && avgVolume !== volume) {
    return h('div', {className:'vol-wrap'},
      h('span', {className:`vol-last ${cls}`}, fmt.num(volume)),
      h('span', {className:'vol-avg'}, 'avg ' + fmt.num(Math.round(avgVolume)))
    );
  }
  return h('span', {className:cls}, fmt.num(volume));
}

/* ─── Sparkline — small and modal versions ───────────────────── */
function SparklineSVG({data, color, w, ht}) {
  if (!data || data.length < 2) return null;
  const mn = Math.min(...data), mx = Math.max(...data), rng = mx - mn || 1;
  const pts = data.map((v,i) => `${(i/(data.length-1))*w},${ht - ((v-mn)/rng)*(ht-6) - 3}`);
  const line = pts.join(' L ');
  const gid = `sg${color.replace('#','')}${w}`;
  return h('svg', {viewBox:`0 0 ${w} ${ht}`, style:{width:'100%',height:ht,display:'block'}},
    h('defs',null,
      h('linearGradient',{id:gid,x1:'0',y1:'0',x2:'0',y2:'1'},
        h('stop',{offset:'0%',stopColor:color,stopOpacity:0.3}),
        h('stop',{offset:'100%',stopColor:color,stopOpacity:0})
      )
    ),
    h('path',{d:`M ${pts[0]} L ${line} L ${w},${ht} L 0,${ht} Z`,fill:`url(#${gid})`}),
    h('path',{d:`M ${line}`,fill:'none',stroke:color,strokeWidth:1.5,strokeLinejoin:'round'})
  );
}

/* ─── Chart modal ────────────────────────────────────────────── */
function ChartModal({item, onClose}) {
  if (!item) return null;
  const chg = item.change_1d;
  const color = chg < 0 ? T.red : T.green;
  const mockHistory = useMemo(() => {
    const base = item.high || 100000;
    return Array.from({length:90}, (_,i) => base * (0.85 + Math.random()*0.3) * (1+(i-45)*0.002));
  }, [item.id]);
  const mn = Math.min(...mockHistory), mx = Math.max(...mockHistory);
  const labels = ['90d ago','75d','60d','45d','30d','15d','Now'];

  return h('div', {className:'chart-modal-overlay', onClick:onClose},
    h('div', {className:'chart-modal', onClick:e=>e.stopPropagation()},
      h('div', {className:'chart-modal-title'},
        h('span', null, item.name + ' — 90 Day Price History'),
        h('button', {className:'chart-modal-close', onClick:onClose}, 'X')
      ),
      h('div', {style:{background:T.inset, border:`1px solid ${T.borderDim}`, borderRadius:3, padding:12}},
        h(SparklineSVG, {data:mockHistory, color, w:620, ht:180}),
        h('div', {style:{display:'flex',justifyContent:'space-between',marginTop:6}},
          labels.map(l => h('span',{key:l,style:{fontSize:9,color:T.textDim,letterSpacing:0.5}},l))
        )
      ),
      h('div', {style:{display:'flex',gap:20,marginTop:12,fontSize:12}},
        h('span',null, h('span',{style:{color:T.textDim}},'90d Low: '), h('span',{style:{color:T.red}}, fmt.gp(mn)+'gp')),
        h('span',null, h('span',{style:{color:T.textDim}},'90d High: '), h('span',{style:{color:T.green}}, fmt.gp(mx)+'gp')),
        h('span',null, h('span',{style:{color:T.textDim}},'Current: '), h('span',{style:{color:T.gold}}, fmt.gp(item.high)+'gp')),
        chg != null && h('span',null, h('span',{style:{color:T.textDim}},'24h: '), h('span',{className:pctClass(chg)}, fmt.pct(chg)))
      ),
      h('div',{style:{fontSize:10,color:T.textDim,marginTop:8}},'* Price history is illustrative — live 90-day history coming in a future update.')
    )
  );
}

/* ─── Item search ────────────────────────────────────────────── */
function useSearch(items) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [focusIdx, setFocusIdx] = useState(0);
  const ref = useRef(null);
  const results = useMemo(() => {
    if (!query.trim() || query.length < 2) return [];
    const q = query.toLowerCase();
    return items
      .filter(it => it.name.toLowerCase().includes(q))
      .sort((a,b) => {
        const ai=a.name.toLowerCase().indexOf(q), bi=b.name.toLowerCase().indexOf(q);
        if (ai !== bi) return ai - bi;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 12);
  }, [query, items]);
  useEffect(() => { setFocusIdx(0); }, [results]);
  function onKey(e, onSelect) {
    if (!results.length) return;
    if (e.key==='ArrowDown') { e.preventDefault(); setFocusIdx(i=>Math.min(i+1,results.length-1)); }
    if (e.key==='ArrowUp')   { e.preventDefault(); setFocusIdx(i=>Math.max(i-1,0)); }
    if (e.key==='Enter')     { e.preventDefault(); onSelect(results[focusIdx]); setQuery(''); setFocused(false); }
    if (e.key==='Escape')    { setQuery(''); setFocused(false); }
  }
  return {query, setQuery, focused, setFocused, results, focusIdx, ref, onKey};
}

function GESearchBar({items, onSelect}) {
  const s = useSearch(items);
  const showDrop = s.focused && s.results.length > 0;
  return h('div', {className:'ge-search-wrap'},
    h('input', {
      className:'ge-search-input',
      placeholder:'Search any item — Dragon bones, Overload, Abyssal whip...',
      value:s.query, ref:s.ref,
      onChange:e=>s.setQuery(e.target.value),
      onFocus:()=>s.setFocused(true),
      onBlur:()=>setTimeout(()=>s.setFocused(false),150),
      onKeyDown:e=>s.onKey(e, it=>{onSelect(it); s.setQuery('');}),
    }),
    s.query && h('button',{className:'ge-search-clear',onClick:()=>s.setQuery('')},'x'),
    showDrop && h('div',{className:'ge-search-results'},
      s.results.map((it,i) =>
        h('div',{
          key:it.id,
          className:'ge-result-item'+(i===s.focusIdx?' focused':''),
          onMouseDown:()=>{onSelect(it); s.setQuery('');}
        },
          h('div',{className:'ge-result-name'},it.name),
          it.high && h('div',{className:'ge-result-price'},fmt.gp(it.high)+'gp'),
          it.categories&&it.categories[0]&&h('div',{className:'ge-result-category'},it.categories[0])
        )
      )
    )
  );
}

/* ─── Detail panel ───────────────────────────────────────────── */
function DetailPanel({item, watchlist, onToggleWatch, onClose}) {
  const [chartOpen, setChartOpen] = useState(false);
  if (!item) return null;
  const inWatch = watchlist.includes(item.id);
  const chg = item.change_1d;
  const sparkColor = chg != null && chg < 0 ? T.red : T.green;
  const mockHistory = useMemo(() => {
    const base = item.high || 100000;
    return Array.from({length:24}, (_,i) => base*(0.9+Math.random()*0.2)*(1+(i-12)*0.003));
  }, [item.id]);

  return h('div', {className:'detail-panel'},
    chartOpen && h(ChartModal, {item, onClose:()=>setChartOpen(false)}),
    h('div', {className:'detail-top'},
      h('div', {className:'row-between', style:{marginBottom:6}},
        h('div', {className:'detail-name'}, item.name),
        h('div', {className:'row', style:{gap:4}},
          h('button', {
            className:'star-btn',
            title: inWatch ? 'Remove from watchlist' : 'Add to watchlist',
            onClick: e => { e.stopPropagation(); onToggleWatch(item.id); }
          }, h('span', {className: inWatch ? 'star-on' : 'star-off'}, inWatch ? '★' : '☆')),
          h('button', {className:'ge-btn', style:{padding:'3px 8px',fontSize:12}, onClick:onClose}, 'X')
        )
      ),
      item.categories && h('div', {className:'detail-cats'},
        item.categories.map(c => h('span',{key:c,className:'cat-tag'},c))
      ),
      h('div', {className:'detail-price'}, fmt.gp(item.high||item.low)+' gp'),
      chg != null && h('div', {className:pctClass(chg), style:{fontSize:12,marginTop:2}}, fmt.pct(chg)+' today')
    ),
    h('div', {className:'detail-body'},
      h('div', {className:'sparkline-wrap', onClick:()=>setChartOpen(true), title:'Click to enlarge'},
        h(SparklineSVG, {data:mockHistory, color:sparkColor, w:260, ht:52}),
        h('span', {className:'sparkline-expand-hint'}, 'click to expand')
      ),
      [
        ['Buy price',  fmt.gp(item.high)+' gp'],
        ['Sell price', fmt.gp(item.low)+' gp'],
        ['Margin',     item.high&&item.low ? fmt.gp(item.high-item.low)+' gp' : '—'],
        ['GE Limit',   item.limit ? item.limit.toLocaleString() : '—'],
      ].map(([l,v]) => h('div',{className:'stat-row',key:l},
        h('span',{className:'stat-lbl'},l),
        h('span',{className:'stat-val'},v)
      )),
      h('div', {className:'stat-row'},
        h('span',{className:'stat-lbl'},'Volume'),
        h('span',{className:'stat-val'}, h(VolDisplay,{volume:item.volume, avgVolume:item.avgVolume}))
      ),
      item.signals&&item.signals.length>0 && h('div',{className:'signal-list'},
        item.signals.map(s=>h('span',{key:s,className:`signal-badge ${s}`},s))
      ),
      h('div',{style:{marginTop:12}},
        h('a',{
          href:'#', style:{fontSize:11,color:T.blue},
          onClick:e=>{e.preventDefault(); window.genius?.openExternal(`https://runescape.wiki/w/${encodeURIComponent(item.name)}`);}
        },'RS Wiki')
      )
    )
  );
}

/* ─── Item table ─────────────────────────────────────────────── */
function ItemTable({items, selected, onSelect, watchlist, onToggleWatch}) {
  const [sort, setSort] = useState({key:'name',dir:1});
  const sorted = useMemo(() => {
    return [...items].sort((a,b) => {
      const av=a[sort.key]??0, bv=b[sort.key]??0;
      return typeof av==='string' ? av.localeCompare(bv)*sort.dir : (av-bv)*sort.dir;
    });
  }, [items, sort]);
  const tog = key => setSort(s=>({key,dir:s.key===key?-s.dir:1}));
  const arr = key => sort.key===key?(sort.dir>0?' ↑':' ↓'):'';
  if (!items.length) return h('div',{className:'empty'},h('div',{className:'icon'},'◎'),h('p',null,'No items in this category yet.'));
  return h('div',{className:'ge-table-wrap'},
    h('table',{className:'ge-table'},
      h('thead',null,h('tr',null,
        h('th',{onClick:()=>tog('name')},'Item'+arr('name')),
        h('th',{onClick:()=>tog('high')},'Buy'+arr('high')),
        h('th',{onClick:()=>tog('low')},'Sell'+arr('low')),
        h('th',{onClick:()=>tog('change_1d')},'24h'+arr('change_1d')),
        h('th',{onClick:()=>tog('volume')},'Volume'+arr('volume')),
        h('th',{style:{width:30}},null)
      )),
      h('tbody',null, sorted.map(it =>
        h('tr',{key:it.id, className:selected?.id===it.id?'selected':'', onClick:()=>onSelect(it)},
          h('td',null,it.name),
          h('td',{style:{color:T.gold}},fmt.gp(it.high)+'gp'),
          h('td',null,fmt.gp(it.low)+'gp'),
          h('td',{className:pctClass(it.change_1d)},it.change_1d?fmt.pct(it.change_1d):'—'),
          h('td',null, h(VolDisplay,{volume:it.volume, avgVolume:it.avgVolume})),
          h('td',{onClick:e=>{e.stopPropagation(); onToggleWatch(it.id);}, style:{textAlign:'center',padding:'6px 6px'}},
            h('button',{className:'star-btn'},
              h('span',{className:watchlist.includes(it.id)?'star-on':'star-off'}, watchlist.includes(it.id)?'★':'☆')
            )
          )
        )
      ))
    )
  );
}

/* ─── Tab views ──────────────────────────────────────────────── */
function WatchlistTab({items, watchlist, selected, onSelect, onToggleWatch}) {
  const watched = items.filter(it=>watchlist.includes(it.id));
  if (!watched.length) return h('div',{className:'empty'},h('div',{className:'icon'},'★'),h('p',null,'Star any item from any category to add it here.'));
  return h('div',{className:'offer-grid'},
    watched.map(it =>
      h('div',{key:it.id, className:'offer-slot', onClick:()=>onSelect(it)},
        h('div',{className:'offer-slot-name'},it.name),
        h('div',{className:'offer-slot-price'},fmt.gp(it.high||it.low)+'gp'),
        h('div',{className:'offer-slot-change '+pctClass(it.change_1d)},it.change_1d?fmt.pct(it.change_1d):''),
        h('div',{className:'offer-slot-star'},
          h('button',{
            className:'star-btn',
            onClick:e=>{e.stopPropagation(); onToggleWatch(it.id);}
          }, h('span',{className:'star-on'},'★'))
        ),
        it.signals&&it.signals.map(s=>h('span',{key:s,className:`signal-badge ${s}`,style:{marginTop:4,display:'inline-block',marginRight:2}},s))
      )
    )
  );
}

/* ─── Market tab ─────────────────────────────────────────────── */
function MarketTab({items}) {
  const [filter, setFilter] = useState(null);
  const [sort, setSort] = useState({key:'name',dir:1});
  const tog = key => setSort(s=>({key,dir:s.key===key?-s.dir:1}));
  const arr = key => sort.key===key?(sort.dir>0?' ↑':' ↓'):'';
  const movers  = useMemo(()=>[...items].sort((a,b)=>Math.abs(b.change_1d||0)-Math.abs(a.change_1d||0)).slice(0,10),[items]);
  const volTop  = useMemo(()=>[...items].sort((a,b)=>(b.volume||0)-(a.volume||0)).slice(0,10),[items]);
  const rising  = useMemo(()=>items.filter(it=>(it.change_1d||0)>0),[items]);
  const falling = useMemo(()=>items.filter(it=>(it.change_1d||0)<0),[items]);
  const signals = useMemo(()=>items.filter(it=>it.signals&&it.signals.length),[items]);
  const filterMap = {rising,falling,signals};
  const filteredItems = useMemo(()=>{
    if (!filter) return null;
    const base = filterMap[filter]||[];
    return [...base].sort((a,b)=>{
      if (sort.key==='signals') return ((a.signals||[]).join(',').localeCompare((b.signals||[]).join(',')))*sort.dir;
      const av=a[sort.key]??0, bv=b[sort.key]??0;
      return typeof av==='string'?av.localeCompare(bv)*sort.dir:(av-bv)*sort.dir;
    });
  },[filter,rising,falling,signals,sort]);
  const cardStyle = key=>({cursor:'pointer',outline:filter===key?`2px solid ${T.gold}`:'none'});
  return h('div',null,
    h('div',{className:'overview-grid'},
      h('div',{className:'ov-card'},h('div',{className:'ov-val'},items.length),h('div',{className:'ov-lbl'},'Items tracked')),
      h('div',{className:'ov-card',style:cardStyle('rising'),onClick:()=>setFilter(f=>f==='rising'?null:'rising')},
        h('div',{className:'ov-val pct-up'},rising.length),h('div',{className:'ov-lbl'},'Rising today'+(filter==='rising'?' ▲':''))
      ),
      h('div',{className:'ov-card',style:cardStyle('falling'),onClick:()=>setFilter(f=>f==='falling'?null:'falling')},
        h('div',{className:'ov-val pct-down'},falling.length),h('div',{className:'ov-lbl'},'Falling today'+(filter==='falling'?' ▲':''))
      ),
      h('div',{className:'ov-card',style:cardStyle('signals'),onClick:()=>setFilter(f=>f==='signals'?null:'signals')},
        h('div',{className:'ov-val',style:{color:T.blue}},signals.length),h('div',{className:'ov-lbl'},'Signal items'+(filter==='signals'?' ▲':''))
      )
    ),
    filteredItems && h('div',{style:{marginBottom:14}},
      h('div',{className:'ge-section-head'},
        filter==='rising'?'Rising items':filter==='falling'?'Falling items':'Signal items'
      ),
      h('table',{className:'ge-table'},
        h('thead',null,h('tr',null,
          h('th',{onClick:()=>tog('name')},'Item'+arr('name')),
          h('th',{onClick:()=>tog('high')},'Price'+arr('high')),
          h('th',{onClick:()=>tog('change_1d')},'24h'+arr('change_1d')),
          h('th',{onClick:()=>tog('volume')},'Volume'+arr('volume')),
          filter==='signals'&&h('th',{onClick:()=>tog('signals')},'Signals'+arr('signals'))
        )),
        h('tbody',null, filteredItems.map(it=>
          h('tr',{key:it.id},
            h('td',null,it.name),
            h('td',{style:{color:T.gold}},fmt.gp(it.high)+'gp'),
            h('td',{className:pctClass(it.change_1d)},it.change_1d?fmt.pct(it.change_1d):'—'),
            h('td',null,h(VolDisplay,{volume:it.volume,avgVolume:it.avgVolume})),
            filter==='signals'&&h('td',null,(it.signals||[]).map(s=>h('span',{key:s,className:`signal-badge ${s}`,style:{marginRight:3}},s)))
          )
        ))
      )
    ),
    !filteredItems && h('div',{className:'two-col'},
      h('div',null,
        h('div',{className:'ge-section-head'},'Top movers'),
        h('table',{className:'ge-table'},
          h('thead',null,h('tr',null,h('th',null,'Item'),h('th',null,'24h'),h('th',null,'Price'))),
          h('tbody',null,movers.map(it=>h('tr',{key:it.id},h('td',null,it.name),h('td',{className:pctClass(it.change_1d)},it.change_1d?fmt.pct(it.change_1d):'—'),h('td',{style:{color:T.gold}},fmt.gp(it.high||it.low)+'gp'))))
        )
      ),
      h('div',null,
        h('div',{className:'ge-section-head'},'Highest volume'),
        h('table',{className:'ge-table'},
          h('thead',null,h('tr',null,h('th',null,'Item'),h('th',null,'Volume'),h('th',null,'Price'))),
          h('tbody',null,volTop.map(it=>h('tr',{key:it.id},h('td',null,it.name),h('td',null,h(VolDisplay,{volume:it.volume,avgVolume:it.avgVolume})),h('td',{style:{color:T.gold}},fmt.gp(it.high||it.low)+'gp'))))
        )
      )
    )
  );
}

function NewsTab({news, onOpen}) {
  if (!news||!news.length) return h('div',{className:'empty'},h('div',{className:'icon'},'◎'),h('p',null,'No news yet — click Fetch Now.'));
  return h('div',null,
    news.map((n,i)=>h('div',{key:i,className:'news-item'},
      h('div',{className:'row',style:{gap:6,marginBottom:2}},h('span',{className:'news-src'},n.source),h('span',{style:{fontSize:10,color:T.textDim}},n.date)),
      h('div',{className:'news-title',onClick:()=>n.url&&onOpen(n.url)},n.title),
      n.mentions&&n.mentions.length>0&&h('div',{style:{display:'flex',flexWrap:'wrap',gap:4,marginTop:3}},n.mentions.map(m=>h('span',{key:m,className:'news-tag'},m)))
    ))
  );
}

function AlertsTab({items, alerts, onSave, onDelete, toast}) {
  const [form, setForm] = useState({item_name:'',condition:'above',price:''});
  const [editId, setEditId] = useState(null);
  const set = k => e => setForm(f=>({...f,[k]:e.target.value}));
  const submit = async () => {
    if (!form.item_name||!form.price) { toast('Fill in all fields','error'); return; }
    const a = {...form, id:editId||Date.now().toString(), price:Number(form.price)};
    await window.genius?.saveAlert(a);
    onSave(a);
    setForm({item_name:'',condition:'above',price:''});
    setEditId(null);
    toast('Alert saved','success');
  };
  return h('div',{className:'two-col'},
    h('div',null,
      h('div',{className:'ge-section-head'},editId?'Edit alert':'New alert'),
      h('div',{style:{display:'flex',flexDirection:'column',gap:10}},
        h('div',null,
          h('label',{className:'form-lbl'},'Item name'),
          h('input',{className:'ge-input',list:'al-items',placeholder:'Dragon bones...',value:form.item_name,onChange:set('item_name')}),
          h('datalist',{id:'al-items'},items.slice(0,100).map(it=>h('option',{key:it.id,value:it.name})))
        ),
        h('div',null,
          h('label',{className:'form-lbl'},'Condition'),
          h('select',{className:'ge-input',value:form.condition,onChange:set('condition')},
            h('option',{value:'above'},'Price rises above'),
            h('option',{value:'below'},'Price falls below')
          )
        ),
        h('div',null,
          h('label',{className:'form-lbl'},'Price (gp)'),
          h('input',{className:'ge-input',type:'number',placeholder:'1000000',value:form.price,onChange:set('price')})
        ),
        h('div',{className:'row'},
          h('button',{className:'ge-btn gold',onClick:submit},editId?'Update':'Add alert'),
          editId&&h('button',{className:'ge-btn',onClick:()=>{setEditId(null);setForm({item_name:'',condition:'above',price:''})}}, 'Cancel')
        )
      )
    ),
    h('div',null,
      h('div',{className:'ge-section-head'},`Active alerts (${alerts.length})`),
      !alerts.length
        ? h('div',{className:'empty',style:{padding:'20px 0'}},h('p',null,'No alerts set.'))
        : alerts.map(a=>h('div',{key:a.id,className:'alert-row'},
          h('span',{style:{flex:1,color:T.text,fontSize:12}},a.item_name),
          h('span',{className:`alert-cond ${a.condition}`},a.condition==='above'?'above':'below'),
          h('span',{style:{color:T.gold,fontSize:12,minWidth:60,textAlign:'right'}},fmt.gp(a.price)+'gp'),
          h('button',{className:'ge-btn',style:{padding:'2px 8px',fontSize:11},onClick:()=>{setEditId(a.id);setForm(a)}},'Edit'),
          h('button',{className:'ge-btn danger',style:{padding:'2px 8px',fontSize:11},onClick:async()=>{await window.genius?.deleteAlert(a.id);onDelete(a.id);toast('Deleted','info')}},'Del')
        ))
    )
  );
}

function SettingsTab({settings, onChange, toast}) {
  const [s, setS] = useState(settings);
  useEffect(()=>setS(settings),[settings]);
  const set = k => e => setS(x=>({...x,[k]:e.target.value}));
  const setChk = k => e => setS(x=>({...x,[k]:e.target.checked}));
  const save = async () => { await window.genius?.saveSettings(s); onChange(s); toast('Settings saved','success'); };
  const testHook = async () => {
    if (!s.discordWebhook) { toast('Enter webhook URL first','error'); return; }
    try {
      await fetch(s.discordWebhook,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:'GEnius test — connected!'})});
      toast('Webhook test sent!','success');
    } catch { toast('Webhook failed','error'); }
  };
  return h('div',{style:{maxWidth:500}},
    h('div',{style:{marginBottom:20}},
      h('div',{className:'ge-section-head'},'Discord webhook'),
      h('label',{className:'form-lbl'},'Webhook URL'),
      h('input',{className:'ge-input',type:'text',placeholder:'https://discord.com/api/webhooks/...',value:s.discordWebhook||'',onChange:set('discordWebhook'),style:{marginBottom:8}}),
      h('button',{className:'ge-btn',onClick:testHook},'Test webhook')
    ),
    h('div',{style:{marginBottom:20}},
      h('div',{className:'ge-section-head'},'Auto-fetch interval'),
      h('select',{className:'ge-input',value:s.fetchInterval||15,onChange:set('fetchInterval')},
        [5,10,15,30,60].map(v=>h('option',{key:v,value:v},`Every ${v} minutes`))
      )
    ),
    h('div',{style:{marginBottom:20}},
      h('div',{className:'ge-section-head'},'Theme'),
      h('select',{className:'ge-input',value:s.theme||'dark',onChange:set('theme')},
        h('option',{value:'dark'},'Dark (default)'),
        h('option',{value:'parchment'},'Parchment (light)')
      )
    ),
    h('div',{style:{marginBottom:20}},
      h('div',{className:'ge-section-head'},'Notifications'),
      h('label',{className:'row',style:{gap:8,cursor:'pointer'}},
        h('input',{type:'checkbox',checked:!!s.notifications,onChange:setChk('notifications')}),
        h('span',null,'Desktop notifications for price alerts')
      )
    ),
    h('button',{className:'ge-btn gold',onClick:save},'Save settings')
  );
}

/* ─── Nav config ─────────────────────────────────────────────── */
const NAV = [
  {id:'watchlist',label:'Watchlist',icon:'★'},
  {group:'Combat'},
  {id:'melee',    label:'Melee',    icon:'⚔'},
  {id:'magic',    label:'Magic',    icon:'✦'},
  {id:'ranged',   label:'Ranged',   icon:'◎'},
  {id:'ammo',     label:'Ammo',     icon:'◈'},
  {id:'pocket',   label:'Pocket',   icon:'◇'},
  {group:'Skilling'},
  {id:'herblore', label:'Herblore', icon:'⚗'},
  {id:'smithing', label:'Smithing', icon:'⚒'},
  {id:'crafting', label:'Crafting', icon:'◉'},
  {id:'fletching',label:'Fletching',icon:'↑'},
  {id:'cooking',  label:'Cooking',  icon:'◬'},
  {id:'farming',  label:'Farming',  icon:'❧'},
  {id:'mining',   label:'Mining/WC',icon:'⛏'},
  {group:''},
  {id:'materials',label:'Materials',icon:'◆'},
  {id:'market',   label:'Market',   icon:'◐'},
  {id:'news',     label:'News',     icon:'✦'},
  {id:'alerts',   label:'Alerts',   icon:'◉'},
  {id:'settings', label:'Settings', icon:'⚙'},
];

/* ─── App ─────────────────────────────────────────────────────── */
function App() {
  const [tab, setTab] = useState('market');
  const [items, setItems] = useState([]);
  const [news, setNews] = useState([]);
  const [watchlist, setWatchlist] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [settings, setSettings] = useState({});
  const [selected, setSelected] = useState(null);
  const [fetching, setFetching] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const {toasts, add:toast} = useToast();
  const theme = settings.theme || 'dark';

  useEffect(() => {
    if (!window.genius) return;
    Promise.all([
      window.genius.getData(),
      window.genius.getWatchlist(),
      window.genius.getAlerts(),
      window.genius.getSettings()
    ]).then(([data,wl,al,s]) => {
      if (data.items)     setItems(data.items);
      if (data.news)      setNews(data.news);
      if (data.timestamp) setLastUpdate(data.timestamp);
      setWatchlist(wl||[]);
      setAlerts(al||[]);
      setSettings(s||{});
    });
    window.genius.onFetchComplete(d => {
      setFetching(false); setLastUpdate(d.timestamp);
      window.genius.getData().then(data => {
        if (data.items) setItems(data.items);
        if (data.news)  setNews(data.news);
      });
      toast('Prices updated','success');
    });
    window.genius.onFetchError(d => { setFetching(false); toast('Fetch error: '+(d.error||'unknown'),'error'); });
    return () => { window.genius.removeAllListeners('fetch-complete'); window.genius.removeAllListeners('fetch-error'); };
  }, []);

  const toggleWatch = useCallback(async id => {
    const nw = watchlist.includes(id) ? watchlist.filter(x=>x!==id) : [...watchlist,id];
    setWatchlist(nw);
    await window.genius?.setWatchlist(nw);
    toast(watchlist.includes(id) ? 'Removed from watchlist' : 'Added to watchlist', 'info');
  }, [watchlist]);

  const byCategory = useMemo(() => {
    const m={};
    items.forEach(it=>(it.categories||['materials']).forEach(c=>{if(!m[c])m[c]=[];m[c].push(it);}));
    return m;
  }, [items]);

  const catItems = useMemo(() => {
    if (['watchlist','market','news','alerts','settings'].includes(tab)) return items;
    return byCategory[tab]||[];
  }, [tab,items,byCategory]);

  const handleFetch = async () => {
    setFetching(true);
    const res = await window.genius?.fetchNow('prices');
    if (res&&!res.success) { setFetching(false); toast('Fetch failed','error'); }
  };

  const stale = lastUpdate ? Math.floor((Date.now()-lastUpdate)/60000) : null;
  const statusType = !lastUpdate ? 'none' : stale < 20 ? 'live' : 'stale';
  const statusText = !lastUpdate ? 'No data' : stale < 1 ? 'Live' : `${stale}m ago`;
  const showDetail = selected && !['market','news','alerts','settings'].includes(tab);

  const handleSearchSelect = item => {
    setSelected(item);
    if (item.categories&&item.categories.length) setTab(item.categories[0]);
  };

  return h('div',{className:'app'},
    h('style',null,CSS),
    theme==='parchment'&&h('style',null,PARCHMENT_CSS),
    h('link',{rel:'preconnect',href:'https://fonts.googleapis.com'}),
    h('link',{href:'https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&display=swap',rel:'stylesheet'}),

    h('nav',{className:'sidebar'},
      h('div',{style:{padding:'12px 12px 8px',borderBottom:`2px solid ${T.border}`,marginBottom:4}},
        h('div',{style:{fontFamily:'Cinzel,serif',fontSize:18,fontWeight:700,color:T.goldBright,letterSpacing:3,textShadow:`0 0 10px rgba(255,215,0,0.3)`}},'GE',h('span',{style:{color:T.copper}},'nius')),
        h('div',{style:{fontSize:9,color:T.textDim,letterSpacing:2,textTransform:'uppercase',marginTop:1}},'Market Intelligence')
      ),
      NAV.map((entry,i) =>
        entry.group!==undefined
          ? h('div',{key:'g'+i,className:'nav-group-label'},entry.group)
          : h('button',{
              key:entry.id,
              className:'nav-btn'+(tab===entry.id?' active':''),
              onClick:()=>{setTab(entry.id);setSelected(null);}
            },
            h('span',{className:'nav-icon'},entry.icon),
            entry.label
          )
      )
    ),

    h('div',{className:'main'},
      h('div',{className:'ge-header'},
        h('span',{className:'ge-logo'},'GE',h('span',null,'nius')),
        h('div',{style:{width:2,height:20,background:T.borderDim,flexShrink:0}}),
        h(GESearchBar,{items,onSelect:handleSearchSelect}),
        h('div',{className:'ge-status'},h('div',{className:`status-dot ${statusType}`}),statusText),
        h('button',{
          className:'ge-btn gold',disabled:fetching,onClick:handleFetch,
          style:{display:'flex',alignItems:'center',gap:6,flexShrink:0}
        },
          fetching&&h('span',{className:'spinner'}),
          fetching?'Fetching...':'Fetch Now'
        )
      ),
      h('div',{style:{flex:1,display:'flex',overflow:'hidden'}},
        h('div',{className:'content',style:{flex:1}},
          tab==='watchlist'&&h(WatchlistTab,{items,watchlist,selected,onSelect:setSelected,onToggleWatch:toggleWatch}),
          ['melee','magic','ranged','ammo','pocket','herblore','smithing','crafting','fletching','cooking','farming','mining','materials'].includes(tab)&&
            h(ItemTable,{items:catItems,selected,onSelect:setSelected,watchlist,onToggleWatch:toggleWatch}),
          tab==='market'  &&h(MarketTab,  {items}),
          tab==='news'    &&h(NewsTab,    {news,onOpen:url=>window.genius?.openExternal(url)}),
          tab==='alerts'  &&h(AlertsTab,  {
            items,alerts,toast,
            onSave: a  =>setAlerts(al=>{const i=al.findIndex(x=>x.id===a.id);return i>=0?al.map((x,j)=>j===i?a:x):[...al,a];}),
            onDelete:id=>setAlerts(al=>al.filter(a=>a.id!==id))
          }),
          tab==='settings'&&h(SettingsTab,{settings,onChange:setSettings,toast})
        ),
        showDetail&&h(DetailPanel,{item:selected,watchlist,onToggleWatch:toggleWatch,onClose:()=>setSelected(null)})
      )
    ),

    h('div',{className:'toast-tray'},
      toasts.map(t=>h('div',{key:t.id,className:`toast ${t.type}`},t.msg))
    )
  );
}

createRoot(document.getElementById('root')).render(h(App,null));
