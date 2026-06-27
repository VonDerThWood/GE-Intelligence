/* ═══════════════════════════════════════════════════════════════
   GEnius Renderer — Grand Exchange skin
   Inline React (UMD), no build step required
═══════════════════════════════════════════════════════════════ */
const { createElement: h, useState, useEffect, useCallback, useRef, useMemo } = React;
const { createRoot } = ReactDOM;

let SHOW_THUMBNAILS = true;

function ItemThumb({name, size}) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  const wikiName = name.split(' ').map((w,i) => i===0 ? w.charAt(0).toUpperCase()+w.slice(1) : w).join('_');
  const src = `https://runescape.wiki/images/${encodeURIComponent(wikiName)}.png`;
  return h('img', {
    src, alt:'', draggable:false,
    style:{width:size||24, height:size||24, objectFit:'contain', flexShrink:0, marginLeft:6, verticalAlign:'middle'},
    onError: () => setHidden(true),
  });
}

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

const DEFAULT_ACCENT = '#c9a84c'; // matches T.gold's original default, for Reset

function _hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? [parseInt(m[1],16), parseInt(m[2],16), parseInt(m[3],16)] : [201,168,76];
}
function _lighten(hex, amt) {
  const [r,g,b] = _hexToRgb(hex);
  const mix = c => Math.round(c + (255 - c) * amt);
  return '#' + [mix(r), mix(g), mix(b)].map(c => c.toString(16).padStart(2,'0')).join('');
}
// Mutates T in place (can't reassign — it's referenced by name in 900+
// inline styles across the file) so every existing T.gold/T.goldBright/
// T.borderGold usage picks up the custom color on the next render,
// without threading a new prop through every component. Called at the
// top of App()'s render body, not in an effect, so the very same render
// pass (including buildCSS()/buildBlackCss() below) sees the update.
function applyAccentColor(hex) {
  const accent = /^#[0-9a-f]{6}$/i.test(hex||'') ? hex : DEFAULT_ACCENT;
  T.gold = accent;
  T.borderGold = accent;
  T.goldBright = accent === DEFAULT_ACCENT ? '#ffd700' : _lighten(accent, 0.35);
}

// Functions, not frozen consts — both reference T.gold/T.goldBright via
// template-literal interpolation, which freezes at string-creation time.
// Rebuilding on every render (called from inside App()) lets a custom
// accent color (see applyAccentColor below) actually reach these rules
// instead of only affecting inline styles.
function buildCSS() { return `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body, #root { height: 100%; overflow: hidden; }
#scale-root { transform-origin: top left; overflow: hidden; }
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
  -webkit-app-region: drag;
}
.ge-header button, .ge-header input, .ge-header select, .ge-header a, .ge-header .ge-search-wrap {
  -webkit-app-region: no-drag;
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
.col-resize-handle::after { content: ''; position: absolute; right: 3px; top: 4px; bottom: 4px; width: 1px; background: ${T.borderDim}; }
.col-resize-handle:hover::after { background: ${T.gold}; width: 2px; }
.ge-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.ge-table th { padding: 6px 10px; font-family: 'Cinzel', serif; font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase; color: ${T.gold}; border-bottom: 2px solid ${T.border}; text-align: left; cursor: pointer; user-select: none; background: rgba(0,0,0,0.2); white-space: nowrap; }
.ge-table th:hover { color: ${T.goldBright}; }
.ge-table td { padding: 6px 10px; border-bottom: 1px solid ${T.borderDim}; color: ${T.text}; }
.ge-table tr { cursor: pointer; }
.ge-table tr:hover td { background: rgba(201,168,76,0.07); }
.ge-table tr.selected td { background: rgba(201,168,76,0.14); border-left: 3px solid ${T.gold}; }
.ge-table tr.selected td:first-child { padding-left: 7px; }
.ge-table tr.multi-selected td { background: rgba(100,181,246,0.15) !important; border-left: 3px solid #64b5f6 !important; }
.ge-table tr.multi-selected td:first-child { padding-left: 7px; }
.ge-table tr.search-highlight td { background: rgba(201,168,76,0.35) !important; border-left: 3px solid ${T.gold} !important; transition: background 0.3s; }

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
.chart-modal { background: ${T.panel}; border: 2px solid ${T.border}; border-radius: 6px; padding: 20px; width: 680px; max-width: 95vw; max-height: 90vh; overflow-y: auto; box-shadow: 0 8px 32px rgba(0,0,0,0.8); }
.chart-modal-title { font-family: 'Cinzel', serif; font-size: 15px; color: ${T.goldBright}; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: center; }
.chart-modal-close { background: none; border: none; color: ${T.textDim}; font-size: 18px; cursor: pointer; padding: 0 4px; }
.chart-modal-close:hover { color: ${T.text}; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.75); z-index: 600; display: flex; align-items: center; justify-content: center; }
.modal { background: ${T.panel}; border: 1px solid ${T.border}; border-radius: 6px; width: 540px; max-width: 96vw; max-height: 90vh; overflow-y: auto; box-shadow: 0 8px 32px rgba(0,0,0,0.8); }
.modal-header { padding: 12px 16px; border-bottom: 1px solid ${T.border}; display: flex; justify-content: space-between; align-items: center; }
.modal-body { padding: 16px; }
.form-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
.form-grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 12px; }
.alloc-bar-bg { height: 6px; background: rgba(255,255,255,0.06); border-radius: 3px; margin-top: 3px; }
.alloc-bar-fg { height: 100%; background: ${T.gold}; border-radius: 3px; transition: width 0.3s; }
.drag-item { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border: 1px solid ${T.border}; border-radius: 3px; margin-bottom: 4px; cursor: grab; user-select: none; }
.drag-item:hover { border-color: ${T.gold}; background: rgba(201,168,76,0.06); }
.drag-item.drag-over { border-color: ${T.goldBright}; background: rgba(201,168,76,0.12); }

/* ── Signal badges ── */
.signal-list { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
.signal-badge { font-size: 10px; padding: 2px 6px; border-radius: 2px; letter-spacing: 0.5px; border: 1px solid; }
.signal-badge.SURGE        { background: rgba(76,175,80,0.15);   border-color: rgba(76,175,80,0.4);   color: ${T.green}; }
.signal-badge.DUMP         { background: rgba(229,57,53,0.15);   border-color: rgba(229,57,53,0.4);   color: ${T.red}; }
.signal-badge.ACCUMULATION { background: rgba(0,188,212,0.12);   border-color: rgba(0,188,212,0.4);   color: #4dd0e1; }
.signal-badge.DISTRIBUTION { background: rgba(255,152,0,0.12);   border-color: rgba(255,152,0,0.4);   color: #ffb74d; }
.signal-badge.FRENZY       { background: rgba(255,64,129,0.15);  border-color: rgba(255,64,129,0.5);  color: #ff80ab; }
.signal-badge.HIGH_VOL     { background: rgba(100,181,246,0.15); border-color: rgba(100,181,246,0.4); color: ${T.blue}; }
.signal-badge.ACTIVE       { background: rgba(100,181,246,0.08); border-color: rgba(100,181,246,0.25); color: #90caf9; }
.signal-badge.QUIET        { background: rgba(158,158,158,0.1);  border-color: rgba(158,158,158,0.3); color: #bdbdbd; }
.signal-badge.THIN         { background: rgba(229,57,53,0.08);   border-color: rgba(229,57,53,0.25);  color: #ef9a9a; }
.signal-badge.ALCH         { background: rgba(156,39,176,0.15);  border-color: rgba(156,39,176,0.5);  color: #ce93d8; }
.signal-badge.MANIPULATED  { background: rgba(229,57,53,0.18);   border-color: #e53935;               color: #e53935; font-weight: bold; letter-spacing: 0.03em; }

/* ── Star button ── */
.star-btn { background: none; border: none; cursor: pointer; font-size: 20px; padding: 2px 6px; transition: transform 0.15s; line-height: 1; }
.star-btn:hover { transform: scale(1.3); }
.star-on  { color: ${T.goldBright}; text-shadow: 0 0 6px ${T.goldBright}; }
.star-off { color: rgba(201,168,76,0.45); }

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
`; }


function buildBlackCss() { return `
body { background: #000 !important; }
.app { background: #000 !important; }
.sidebar { background: #0a0a0a !important; border-color: #1c1c1c !important; }
.ge-header { background: linear-gradient(180deg, #111 0%, #0a0a0a 100%) !important; border-color: #1c1c1c !important; }
.nav-btn { color: ${T.gold} !important; }
.nav-btn:hover { background: rgba(201,168,76,0.08) !important; }
.nav-btn.active { background: rgba(201,168,76,0.1) !important; border-left-color: ${T.gold} !important; }
.content { background: #000 !important; }
.ge-table th { background: #0a0a0a !important; border-color: #1c1c1c !important; }
.ge-table td { border-color: #1c1c1c !important; }
.ge-table tr:nth-child(even) td { background: rgba(255,255,255,0.02) !important; }
.ge-table tr:hover td { background: rgba(201,168,76,0.06) !important; }
.ge-table tr.selected td { background: rgba(201,168,76,0.1) !important; }
.detail-panel { background: #0a0a0a !important; border-color: #1c1c1c !important; }
.detail-top { background: linear-gradient(180deg, #111 0%, #0a0a0a 100%) !important; border-color: #1c1c1c !important; }
.sparkline-wrap { background: #0a0a0a !important; border-color: #1c1c1c !important; }
.ov-card { background: #0a0a0a !important; border-color: #1c1c1c !important; }
.ge-btn { background: #111 !important; border-color: #2a2a2a !important; color: ${T.gold} !important; }
.ge-btn:hover { background: #1a1a1a !important; color: ${T.goldBright} !important; }
.ge-btn.gold { background: rgba(201,168,76,0.15) !important; border-color: ${T.gold} !important; color: ${T.goldBright} !important; }
.ge-btn.danger { color: ${T.red} !important; border-color: rgba(229,57,53,0.4) !important; }
.ge-input { background: #0a0a0a !important; border-color: #2a2a2a !important; color: ${T.text} !important; }
.ge-search-input { background: #0a0a0a !important; border-color: #2a2a2a !important; }
.ge-search-results { background: #0a0a0a !important; border-color: #1c1c1c !important; }
.cat-tag { background: rgba(201,168,76,0.08) !important; border-color: rgba(201,168,76,0.2) !important; }
.toast { background: #111 !important; border-color: #2a2a2a !important; }
.modal { background: #0a0a0a !important; border-color: #1c1c1c !important; }
::-webkit-scrollbar-track { background: #0a0a0a !important; }
::-webkit-scrollbar-thumb { background: #2a2a2a !important; }
`; }

/* ─── Signal info ────────────────────────────────────────────── */
const SIGNAL_INFO = {
  SURGE:        'Price is up 5%+ today with above-average volume — buyers are actively pushing the price higher.',
  DUMP:         'Price is down 5%+ today with above-average volume — sellers are offloading heavily.',
  ACCUMULATION: 'Price is flat while volume quietly builds — often signals that someone is loading up before a move.',
  DISTRIBUTION: 'Price is flat but volume is extremely elevated — large quantities are changing hands, which can precede a sharp drop.',
  FRENZY:       'Volume is 250%+ above average — an extreme trading spike. Something is driving unusual attention to this item.',
  HIGH_VOL:     'Volume is 150–249% above average — significantly more trading than usual.',
  ACTIVE:       'Volume is 10–49% above average — slightly elevated trading activity.',
  QUIET:        'Volume is 10–50% below average — trading has slowed down compared to normal.',
  THIN:         'Volume is 50%+ below average — very few trades. This market is illiquid; prices may be unreliable.',
  ALCH:         'High alchemy yields more than selling on the GE after the 2% tax and the cost of a nature rune. Profitable to alch.',
  MANIPULATED:  'Extreme volume spike on an item with a tiny GE buy limit and a large price move — a classic sign of coordinated buying to inflate the price. Trade with caution.',
};

function SignalBadge({signal, style: extraStyle}) {
  const [pos, setPos] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    if (!pos) return;
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setPos(null); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [pos]);

  const info = SIGNAL_INFO[signal];
  return h('span', {ref, style:{position:'relative', display:'inline-block', ...extraStyle}},
    h('span', {
      className: `signal-badge ${signal}`,
      onClick: e => {
        e.stopPropagation();
        if (!info) return;
        setPos(p => p ? null : {x: e.clientX, y: e.clientY});
      },
      style: {cursor: info ? 'pointer' : 'default'},
    }, signal),
    pos && info && h('div', {
      style: {
        position:'fixed', zIndex:9999,
        left: Math.min(pos.x + 12, window.innerWidth - 230),
        top: pos.y + 16 + 210 > window.innerHeight
          ? pos.y - 210 - 8
          : pos.y + 16,
        background:T.panel2, border:`1px solid ${T.border}`,
        borderRadius:4, padding:'8px 10px',
        fontSize:11, color:T.text, lineHeight:1.5,
        width:210, boxShadow:'0 4px 16px rgba(0,0,0,0.7)',
        pointerEvents:'none',
      }
    },
      h('div', {style:{fontWeight:'bold', color:T.gold, marginBottom:4, letterSpacing:'0.5px'}}, signal),
      info
    )
  );
}

/* ─── Helpers ────────────────────────────────────────────────── */
const fmt = {
  gp:  n => { if (!n && n !== 0) return '—'; const a = Math.abs(n); if (a >= 1e9) return (n/1e9).toFixed(2)+'B'; if (a >= 1e6) return (n/1e6).toFixed(2)+'M'; if (a >= 1e3) return (n/1e3).toFixed(1)+'K'; return n.toLocaleString(); },
  pct: n => (n >= 0 ? '+' : '') + n.toFixed(2) + '%',
  num: n => n ? n.toLocaleString() : '—',
};
const pctClass = n => (n == null) ? 'pct-flat' : n > 0 ? 'pct-up' : n < 0 ? 'pct-down' : 'pct-flat';
const showPct  = n => n != null ? fmt.pct(n) : '—';

// Shows percentage change + raw gp change stacked
function ChangeDisplay({change_1d, price}) {
  if (change_1d == null) return h('span', {style:{color:'#555'}}, '—');
  const cls = pctClass(change_1d);
  const gpChange = price ? Math.round(price - (price / (1 + change_1d / 100))) : null;
  return h('div', {style:{lineHeight:1.2}},
    h('span', {className:cls}, fmt.pct(change_1d)),
    gpChange != null && h('div', {style:{fontSize:10, opacity:0.8, className:cls}},
      h('span', {className:cls}, (gpChange > 0 ? '+' : '') + fmt.gp(gpChange) + 'gp')
    )
  );
}
// GE tax: 2% on items over 50gp. RS3 has NO cap on the tax (unlike OSRS,
// which caps at 5m/item) — corrected 2026-06-24 after Ben caught the old
// 5,000,000gp cap, which was an OSRS-only mechanic that had been wrongly
// applied here, affecting the margin calculator and item detail panel too.
const applyTax = price => price <= 50 ? price : Math.floor(price * 0.98);

// ── Fun features ─────────────────────────────────────────────────────────────

// Big Mac conversion: bond price (live) / $7.49 USD × Big Mac $5.69 USD
const BOND_USD  = 9.99;
const BIGMAC_USD = 5.69;

function getBigMacs(price, bondGP) {
  if (!price || !bondGP) return null;
  const gpPerMac = bondGP / BOND_USD * BIGMAC_USD;
  const macs = price / gpPerMac;
  if (macs < 0.05) return null;
  if (macs >= 1000) return `${Math.round(macs).toLocaleString()} Big Macs 🍔`;
  if (macs >= 1)    return `${macs >= 10 ? Math.round(macs) : macs.toFixed(1)} Big Mac${macs >= 1.05 ? 's' : ''} 🍔`;
  return `${(macs * 100).toFixed(0)}% of a Big Mac 🍔`;
}

function getMarketPersonality(item) {
  const sigs  = item.signals || [];
  const cats  = item.categories || [];
  const price = item.high || item.low || 0;
  const vol   = item.volume || 0;
  const avg   = item.avgVolume || 0;
  const chg   = item.change_1d;
  const name  = (item.name || '').toLowerCase();

  // Specific recognisable items first
  if (name.includes('party hat'))     return 'The ultra-rare heirloom. Never actually worn to a party. Functionally a wealth storage unit that happens to look festive.';
  if (name.includes('abyssal whip'))  return "The old reliable. Every mid-level's first real weapon. Been relevant for over a decade. Somehow still here.";
  if (name.includes('nature rune'))   return 'The backbone of the economy. Every alcher, every crafter, every skiller needs these. You never notice them until they spike.';
  if (name.includes('cannonball'))    return 'Deceptively humble. Made in bulk, sold in bulk, used in bulk. The market equivalent of background noise.';
  if (name.includes('bond'))          return "Jagex's official bridge between real money and GP. Tracks membership sentiment more than the market.";
  if (name.includes('dragon bones') || name.includes('superior dragon bones')) return 'The prayer grinder\'s burden. Price lives and dies by how many people are doing Slayer this week.';
  if (name.includes('pure essence') || name.includes('rune essence')) return 'The literal building block of magic. Bought in the millions by bots and legitimate players alike. Impossible to tell apart.';

  // Signal-driven personalities
  if (sigs.includes('SURGE') && sigs.includes('FRENZY')) return 'Right now? Absolute chaos. Something happened — a game update, a streamer, a rumour — and everyone piled in at once.';
  if (sigs.includes('DUMP')  && sigs.includes('FRENZY')) return "It's not a crash, it's a sale. Everyone is selling and nobody knows exactly why. Could be nothing. Could be everything.";
  if (sigs.includes('SURGE'))  return 'On the rise. Steady hands are being rewarded. Whether this lasts depends entirely on what caused it.';
  if (sigs.includes('DUMP'))   return 'Taking a hit. Could be a temporary dip, could be the start of something worse. The chart will tell you more than the price will.';
  if (sigs.includes('ACCUMULATION')) return 'Quiet activity. Volume is elevated but the price isn\'t moving much — someone is buying without making a scene.';
  if (sigs.includes('DISTRIBUTION')) return 'Heavy selling at a steady price. Someone is offloading quietly. Worth watching.';
  if (sigs.includes('FRENZY')) return 'Unusually high trading volume today. The market is paying attention to this one.';

  // Category-based
  if (cats.includes('runes'))     return 'Reliable. Consumed endlessly, replenished constantly. The market equivalent of a utility bill.';
  if (cats.includes('herbs') || cats.includes('potions')) return 'Tied to the skilling economy. Moves with Herblore training demand and DXP weekends. Predictable if you know the calendar.';
  if (cats.includes('logs') || cats.includes('planks'))   return 'Construction and Firemaking fuel. Slow and steady. Nobody gets rich trading these; nobody loses big either.';
  if (cats.includes('food'))      return 'Bossing staple or skilling food — either way it gets consumed and replaced. Demand is nearly infinite, just not always urgent.';
  if (cats.includes('gems'))      return 'Fluctuates with crafting and quest demand. Often ignored until a crafting method gets popular, then everyone remembers it exists.';
  if (cats.includes('seeds'))     return 'Farming economy in a nutshell. Cyclical demand, patches reset, prices follow.';
  if (cats.includes('weapons') || cats.includes('armour')) {
    if (price > 10_000_000) return 'High-value gear. Demand follows the meta. When a boss or activity gets popular, these spike. When the hype dies, so does the price.';
    return 'Mid-tier gear. Useful for a while, then outgrown. Consistent demand from players levelling through the tier.';
  }

  // Price tier fallback
  if (price > 100_000_000) return 'Expensive enough that most players have only seen it in someone else\'s bank. Thin market, big swings.';
  if (price > 10_000_000)  return 'High-value, low-volume. Trades slowly, moves meaningfully when it does.';
  if (price < 100)         return 'Worth almost nothing individually. Worth everything in bulk. The backbone of every skiller\'s supply chain.';

  // Volume personality
  if (avg > 0 && vol / avg > 3) return 'Extremely active today. Something is driving unusual interest — worth figuring out what before making a move.';
  if (avg > 500_000)             return 'One of the market\'s workhorses. High volume, consistent demand. Not glamorous, but always moving.';

  return 'Quietly going about its business. Nothing unusual today.';
}

function getMarketWeather(items) {
  if (!items || !items.length) return null;
  const tradeable = items.filter(it => !it.untradeable && it.change_1d != null);
  if (!tradeable.length) return null;

  let surges = 0, dumps = 0, frenzies = 0, accums = 0;
  for (const it of tradeable) {
    const sigs = it.signals || [];
    if (sigs.includes('SURGE'))        surges++;
    if (sigs.includes('DUMP'))         dumps++;
    if (sigs.includes('FRENZY'))       frenzies++;
    if (sigs.includes('ACCUMULATION') || sigs.includes('DISTRIBUTION')) accums++;
  }

  const total = tradeable.length;
  const surgeRatio  = surges  / total;
  const dumpRatio   = dumps   / total;
  const frenzyRatio = frenzies / total;
  const net = surgeRatio - dumpRatio;

  if (frenzyRatio > 0.06 && net > 0.02)  return { emoji:'🌪️', label:'Tornado Warning',  tip:'Frenzy signals widespread — high volume and sharp moves across the board. Anything can happen.' };
  if (frenzyRatio > 0.06 && net < -0.02) return { emoji:'⛈️',  label:'Storm Warning',    tip:'Heavy selling on high volume. Volatile conditions — prices may shift rapidly.' };
  if (frenzyRatio > 0.04)                return { emoji:'🌩️', label:'Thunderstorms',    tip:'Elevated activity and volume spikes. The market is unsettled.' };
  if (net > 0.04)                         return { emoji:'☀️',  label:'Clear Skies',      tip:'Mostly positive movement across the market. A good day for buyers.' };
  if (net < -0.04)                        return { emoji:'🌧️', label:'Rainy Day',        tip:'More items falling than rising. Broad selling pressure — proceed carefully.' };
  if (accums / total > 0.05)             return { emoji:'🌫️', label:'Foggy Conditions', tip:'Prices look calm but volume says otherwise. Something is moving quietly beneath the surface.' };
  return { emoji:'🌤️', label:'Partly Cloudy',  tip:'Low signals, mild activity. The market is ticking along without much drama today.' };
}

// Full legend of every possible Market Weather status — getMarketWeather
// above only ever returns ONE of these (whichever currently applies), so
// this exists purely to let the user see all of them at once. Keep in
// sync with the labels/tips above if those ever change.
const MARKET_WEATHER_LEGEND = [
  { emoji:'🌪️', label:'Tornado Warning',  tip:'Frenzy signals widespread — high volume and sharp moves across the board. Anything can happen.' },
  { emoji:'⛈️',  label:'Storm Warning',    tip:'Heavy selling on high volume. Volatile conditions — prices may shift rapidly.' },
  { emoji:'🌩️', label:'Thunderstorms',    tip:'Elevated activity and volume spikes. The market is unsettled.' },
  { emoji:'☀️',  label:'Clear Skies',      tip:'Mostly positive movement across the market. A good day for buyers.' },
  { emoji:'🌧️', label:'Rainy Day',        tip:'More items falling than rising. Broad selling pressure — proceed carefully.' },
  { emoji:'🌫️', label:'Foggy Conditions', tip:'Prices look calm but volume says otherwise. Something is moving quietly beneath the surface.' },
  { emoji:'🌤️', label:'Partly Cloudy',    tip:'Low signals, mild activity. The market is ticking along without much drama today.' },
];

// Parse human-readable price input: "2m" -> 2000000, "1.5b" -> 1500000000, "500k" -> 500000
function parseGP(str) {
  if (!str && str !== 0) return '';
  const s = String(str).trim().toLowerCase().replace(/,/g, '');
  if (s === '') return '';
  const match = s.match(/^([0-9.]+)\s*([kmb]?)$/);
  if (!match) return s; // return as-is if doesn't match (let browser validate)
  const num = parseFloat(match[1]);
  if (isNaN(num)) return s;
  const mult = {k: 1e3, m: 1e6, b: 1e9}[match[2]] || 1;
  return Math.round(num * mult);
}

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
    const diff = volume - Math.round(avgVolume);
    const pct  = ((diff / avgVolume) * 100).toFixed(1);
    const diffCls = diff > 0 ? 'pct-up' : diff < 0 ? 'pct-down' : 'pct-flat';
    const diffStr = (diff > 0 ? '+' : '') + fmt.num(diff) + ' (' + (diff > 0 ? '+' : '') + pct + '%)';
    return h('div', {className:'vol-wrap'},
      h('span', {className:`vol-last ${cls}`}, fmt.num(volume)),
      h('span', {className:'vol-avg'}, 'avg ' + fmt.num(Math.round(avgVolume))),
      h('span', {className:`vol-avg ${diffCls}`}, diffStr)
    );
  }
  return h('span', {className:cls}, fmt.num(volume));
}

/* ─── Sparkline — small and modal versions ───────────────────── */
function SparklineSVG({data, color, w, ht, showLabels}) {
  if (!data || data.length < 2) return null;
  const mn = Math.min(...data), mx = Math.max(...data), rng = mx - mn || 1;
  const PAD_L = showLabels ? 38 : 0;
  const PAD_R = showLabels ? 4 : 0;
  const chartW = w - PAD_L - PAD_R;
  const pts = data.map((v,i) => `${PAD_L + (i/(data.length-1))*chartW},${ht - ((v-mn)/rng)*(ht-14) - 7}`);
  const line = pts.join(' L ');
  const gid = `sg${color.replace('#','')}${w}`;
  return h('svg', {viewBox:`0 0 ${w} ${ht}`, style:{width:'100%',height:ht,display:'block'}},
    h('defs',null,
      h('linearGradient',{id:gid,x1:'0',y1:'0',x2:'0',y2:'1'},
        h('stop',{offset:'0%',stopColor:color,stopOpacity:0.3}),
        h('stop',{offset:'100%',stopColor:color,stopOpacity:0})
      )
    ),
    h('path',{d:`M ${pts[0]} L ${line} L ${PAD_L+chartW},${ht} L ${PAD_L},${ht} Z`,fill:`url(#${gid})`}),
    h('path',{d:`M ${line}`,fill:'none',stroke:color,strokeWidth:1.5,strokeLinejoin:'round'}),
    showLabels && h('text',{x:PAD_L-3, y:10, fontSize:8, fill:T.textDim, textAnchor:'end'}, fmt.gp(mx)),
    showLabels && h('text',{x:PAD_L-3, y:ht-2, fontSize:8, fill:T.textDim, textAnchor:'end'}, fmt.gp(mn)),
    showLabels && h('text',{x:w-PAD_R, y:10, fontSize:8, fill:color, textAnchor:'end'}, fmt.gp(data[data.length-1])),
  );
}

/* ─── Chart modal ────────────────────────────────────────────── */
function ImageModal({name, fallbackUrl, onClose}) {
  const wikiName = name.split(' ').map((w,i) => i===0 ? w.charAt(0).toUpperCase()+w.slice(1) : w).join('_');
  const detailUrl = `https://runescape.wiki/images/${encodeURIComponent(wikiName + '_detail')}.png`;
  const [src, setSrc] = useState(detailUrl);

  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  return h('div', {
    onClick: onClose,
    style: {
      position:'fixed', inset:0, zIndex:10000,
      background:'rgba(0,0,0,0.82)',
      display:'flex', alignItems:'center', justifyContent:'center',
      cursor:'zoom-out',
    }
  },
    h('div', {style:{display:'flex', flexDirection:'column', alignItems:'center', gap:10}},
      h('img', {
        src,
        alt: name,
        onError: () => { if (src !== fallbackUrl) setSrc(fallbackUrl); else onClose(); },
        style: {
          maxWidth: '80vw', maxHeight: '75vh',
          borderRadius: 4,
          boxShadow: '0 8px 40px rgba(0,0,0,0.8)',
        }
      }),
      h('div', {style:{color:'rgba(255,255,255,0.5)', fontSize:12}}, name),
      h('div', {style:{color:'rgba(255,255,255,0.3)', fontSize:11}}, 'Click anywhere or press Esc to close')
    )
  );
}

function ChartModal({item, onClose, dateFormat, populatedHistoryIds}) {
  const [range, setRange] = useState(30);
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [hoverIdx, setHoverIdx] = useState(null);
  const [hoverType, setHoverType] = useState(null);
  const [timeseries, setTimeseries] = useState(null);
  const [timeseriesLoading, setTimeseriesLoading] = useState(false);
  const [snapshots, setSnapshots] = useState([]);
  const [dateQuery, setDateQuery] = useState('');
  const [dateLookup, setDateLookup] = useState(null);
  const [seasonalView, setSeasonalView] = useState('weekly');
  const [seasonalHover, setSeasonalHover] = useState(null);
  const [chartView, setChartView] = useState('recent');
  const [chartMode, setChartMode] = useState('line'); // 'line' | 'candle'
  const [zoomFrom, setZoomFrom] = useState('');
  const [zoomTo, setZoomTo] = useState('');
  const [zoomWindow, setZoomWindow] = useState(null); // [startIdx, endIdx] into timeseries
  const zoomCenterRef = React.useRef(0.5); // 0-1 fraction of chart where cursor is

  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (!item?.id) return;
    setLoading(true); setError(false); setHistory(null); setTimeseries(null); setTimeseriesLoading(true); setDateLookup(null); setDateQuery(''); setChartView('recent'); setSnapshots([]);
    window.genius?.getItemHistory(item.id).then(hist => {
      if (hist && hist.length) setHistory(hist); else setError(true);
      setLoading(false);
    }).catch(() => { setError(true); setLoading(false); });
    window.genius?.getItemTimeseries(item.id).then(ts => {
      setTimeseries(ts && ts.length ? ts : null);
      setTimeseriesLoading(false);
    }).catch(() => setTimeseriesLoading(false));
    window.genius?.getPriceSnapshots(item.id).then(snaps => {
      setSnapshots(snaps && snaps.length ? snaps : []);
    }).catch(() => {});
  }, [item?.id]);

  if (!item) return null;

  // Zoom helper — called by scroll and arrow keys
  const doZoom = useCallback((direction) => {
    if (!timeseries || !timeseries.length) return;
    const total = timeseries.length;
    const cur = zoomWindow || [0, total - 1];
    const span = cur[1] - cur[0];
    const center = cur[0] + Math.round(span * zoomCenterRef.current);
    const STEP = 0.15; // zoom 15% per tick
    const newSpan = direction === 'in'
      ? Math.max(10, Math.round(span * (1 - STEP)))
      : Math.min(total - 1, Math.round(span * (1 + STEP)));
    const half = Math.round(newSpan / 2);
    const start = Math.max(0, center - half);
    const end   = Math.min(total - 1, start + newSpan);
    const adjStart = Math.max(0, end - newSpan);
    if (adjStart === 0 && end === total - 1) { setZoomWindow(null); return; }
    setZoomWindow([adjStart, end]);
    setHoverIdx(null);
  }, [timeseries, zoomWindow]);

  // Arrow key zoom when modal is open
  useEffect(() => {
    if (chartView !== 'alltime') return;
    const onKey = e => {
      if (e.key === 'ArrowUp')   { e.preventDefault(); doZoom('in');  }
      if (e.key === 'ArrowDown') { e.preventDefault(); doZoom('out'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chartView, doZoom]);

  // Merge WeirdGloop history with local snapshots, filter to range
  const points = useMemo(() => {
    if (!history && !snapshots.length) return [];
    const getTs = p => typeof p.timestamp === 'number' ? p.timestamp * (p.timestamp < 1e12 ? 1000 : 1) : new Date(p.timestamp).getTime();

    // Dedup history by day — keep latest entry per day (API sometimes returns 2 per day)
    const dedupedHistory = [];
    const histByDay = {};
    for (const p of (history || [])) {
      const day = new Date(getTs(p)).toDateString();
      if (!histByDay[day] || getTs(p) > getTs(histByDay[day])) histByDay[day] = p;
    }
    for (const day in histByDay) dedupedHistory.push(histByDay[day]);

    // Merge with snapshots — snapshot wins for same day (fresher data)
    const combined = [...dedupedHistory];
    const histDays = new Set(dedupedHistory.map(p => new Date(getTs(p)).toDateString()));
    snapshots.forEach(s => {
      const day = new Date(getTs(s)).toDateString();
      if (!histDays.has(day)) combined.push(s);
      else {
        const idx = combined.findIndex(p => new Date(getTs(p)).toDateString() === day);
        if (idx !== -1) combined[idx] = s;
      }
    });
    combined.sort((a, b) => getTs(a) - getTs(b));
    const latestTs = combined.reduce((max, p) => Math.max(max, getTs(p)), 0);
    const cutoff = latestTs - range * 24 * 60 * 60 * 1000;
    return combined.filter(p => getTs(p) >= cutoff);
  }, [history, snapshots, range]);

  // ATH/ATL from full timeseries
  const athData = useMemo(() => {
    if (!timeseries || !timeseries.length) return null;
    const fmtTs = ts => {
      const d = new Date(ts * (ts < 1e12 ? 1000 : 1));
      const fmt = dateFormat || 'MM/DD/YYYY';
      const M = String(d.getMonth()+1).padStart(2,'0'), D = String(d.getDate()).padStart(2,'0'), Y = d.getFullYear();
      if (fmt === 'DD/MM/YYYY') return `${D}/${M}/${Y}`;
      if (fmt === 'YYYY-MM-DD') return `${Y}-${M}-${D}`;
      return `${M}/${D}/${Y}`;
    };
    let ath = {price: -Infinity, date: ''};
    let atl = {price: Infinity, date: ''};
    timeseries.forEach(p => {
      if (p.high && p.high > ath.price) ath = {price: p.high, date: fmtTs(p.timestamp)};
      if (p.low  && p.low  < atl.price) atl = {price: p.low,  date: fmtTs(p.timestamp)};
    });
    return {ath, atl};
  }, [timeseries]);

  // Support & resistance levels — volume-weighted, like real "Volume
  // Profile" technical analysis: a price the item traded heavily at one
  // day means more than a price it just quietly drifted through for a
  // week, even though both look identical if you only count how many
  // daily snapshots landed there. Each day's price (high/low are the same
  // value in this data — one snapshot per day, not a real OHLC range) gets
  // weighted by that day's volume instead of counted as a flat +1.
  // Log-dampened so one freak high-volume day (a bot dump, a manipulation
  // spike, a single whale trade) can't single-handedly dominate a bucket
  // and masquerade as a real recurring level.
  const supportResistance = useMemo(() => {
    if (!timeseries || timeseries.length < 30) return null;
    const points = timeseries.filter(p => p.high || p.low);
    if (!points.length) return null;
    const prices = points.map(p => p.high || p.low);

    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min;
    if (range === 0) return null;

    // Bucket prices into 20 bins, weighted by dampened volume
    const BINS = 20;
    const bucketSize = range / BINS;
    const buckets = Array(BINS).fill(0);
    let totalWeight = 0;
    points.forEach(p => {
      const price = p.high || p.low;
      const idx = Math.min(BINS - 1, Math.floor((price - min) / bucketSize));
      const weight = Math.log10((p.volume || 0) + 10); // +10 floor so zero-volume days still count a little
      buckets[idx] += weight;
      totalWeight += weight;
    });

    const currentPrice = timeseries[timeseries.length-1]?.high || timeseries[timeseries.length-1]?.low || 0;

    // Find local maxima in the histogram — these are price clusters (support/resistance)
    // Only include levels within 50% of current price so stale historical levels don't show
    const levels = [];
    for (let i = 1; i < BINS - 1; i++) {
      if (buckets[i] > buckets[i-1] && buckets[i] > buckets[i+1] && buckets[i] > totalWeight * 0.04) {
        const price = min + (i + 0.5) * bucketSize;
        if (currentPrice > 0 && (price < currentPrice * 0.75 || price > currentPrice * 1.25)) continue;
        levels.push({
          price,
          strength: buckets[i],
          type: price < currentPrice ? 'support' : 'resistance',
        });
      }
    }

    if (!levels.length) return null;
    return levels.sort((a,b) => b.strength - a.strength).slice(0, 4);
  }, [timeseries]);

  // Seasonal data — monthly and weekly
  const seasonalData = useMemo(() => {
    if (!timeseries || timeseries.length < 60) return null;
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const earliest = timeseries.reduce((min, p) => {
      const t = p.timestamp * (p.timestamp < 1e12 ? 1000 : 1);
      return t < min ? t : min;
    }, Infinity);
    const yearsOfData = (Date.now() - earliest) / (1000 * 60 * 60 * 24 * 365);

    // Monthly buckets
    const mBuckets = Array(12).fill(null).map(() => []);
    // Weekly buckets (weeks 1-52)
    const wBuckets = Array(53).fill(null).map(() => []);

    timeseries.forEach(p => {
      const price = p.high || p.low;
      if (!price) return;
      const d = new Date(p.timestamp * (p.timestamp < 1e12 ? 1000 : 1));
      mBuckets[d.getMonth()].push(price);
      // ISO week number
      const jan1 = new Date(d.getFullYear(), 0, 1);
      const week = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
      if (week >= 1 && week <= 52) wBuckets[week].push(price);
    });

    const monthAvgs = mBuckets.map((arr, i) => ({
      label: MONTHS[i],
      avg: arr.length ? Math.round(arr.reduce((s,v)=>s+v,0)/arr.length) : null,
    })).filter(m => m.avg !== null);

    const weekAvgs = wBuckets.map((arr, i) => ({
      label: `W${i}`,
      avg: arr.length >= 2 ? Math.round(arr.reduce((s,v)=>s+v,0)/arr.length) : null,
    })).filter(w => w.avg !== null);

    if (monthAvgs.length < 3) return null;

    const mOverall = monthAvgs.reduce((s,m)=>s+m.avg,0)/monthAvgs.length;
    const wOverall = weekAvgs.length ? weekAvgs.reduce((s,w)=>s+w.avg,0)/weekAvgs.length : 0;

    return {
      months: monthAvgs.map(m => ({...m, pct: ((m.avg - mOverall) / mOverall) * 100})),
      weeks:  weekAvgs.map(w => ({...w,  pct: ((w.avg  - wOverall)  / wOverall)  * 100})),
      yearsOfData,
      newItem: yearsOfData < 1.5,
    };
  }, [timeseries]);

  // Date lookup
  const handleDateLookup = val => {
    setDateQuery(val);
    if (!timeseries || !val) { setDateLookup(null); return; }
    const target = new Date(val).getTime();
    if (isNaN(target)) { setDateLookup(null); return; }
    let best = null, bestDiff = Infinity;
    timeseries.forEach(p => {
      const t = p.timestamp * (p.timestamp < 1e12 ? 1000 : 1);
      const diff = Math.abs(t - target);
      if (diff < bestDiff) { bestDiff = diff; best = p; }
    });
    if (best) {
      const d = new Date(best.timestamp * (best.timestamp < 1e12 ? 1000 : 1));
      setDateLookup({
        date: d.toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'}),
        high: best.high,
        low: best.low,
      });
    }
  };

  const activePoints = useMemo(() => {
    if (chartView !== 'alltime' || !timeseries) return points;
    // Apply scroll/key zoom window first
    let base = timeseries;
    if (zoomWindow) {
      base = timeseries.slice(zoomWindow[0], zoomWindow[1] + 1);
    }
    // Then apply date picker filter on top
    if (!zoomFrom && !zoomTo) return base;
    const fromMs = zoomFrom ? new Date(zoomFrom).getTime() : -Infinity;
    const toMs   = zoomTo   ? new Date(zoomTo).getTime()   :  Infinity;
    if (isNaN(fromMs) && isNaN(toMs)) return base;
    return base.filter(p => {
      const t = p.timestamp * (p.timestamp < 1e12 ? 1000 : 1);
      return t >= (isNaN(fromMs) ? -Infinity : fromMs) && t <= (isNaN(toMs) ? Infinity : toMs);
    });
  }, [chartView, timeseries, points, zoomFrom, zoomTo, zoomWindow]);
  const prices  = activePoints.map(p => p.price ?? p.high ?? p.low ?? 0);
  const volumes = activePoints.map(p => p.volume || 0);
  const minP = Math.min(...prices), maxP = Math.max(...prices);
  const maxV = Math.max(...volumes, 1);
  const YLAB = 52; // width reserved for Y-axis labels on left
  const W = 620, PH = 160, VH = 60, PAD = 8;
  const CW = W - YLAB; // chart width after Y-axis

  const px = (i) => YLAB + PAD + (i / Math.max(activePoints.length - 1, 1)) * (CW - PAD * 2);
  const py = (v) => PH - PAD - ((v - minP) / Math.max(maxP - minP, 1)) * (PH - PAD * 2);
  const vy = (v) => VH - (v / maxV) * (VH - 4);

  // Y-axis grid levels: min, 25%, 50%, 75%, max
  const gridLevels = [0, 0.25, 0.5, 0.75, 1].map(t => ({
    t,
    val: minP + t * (maxP - minP),
    y: PAD + (1 - t) * (PH - PAD * 2)
  }));

  const priceColor = prices.length > 1 && prices[prices.length-1] >= prices[0] ? T.green : T.red;

  // Candlestick data — group points into buckets based on view range
  const candles = useMemo(() => {
    if (activePoints.length < 2) return [];
    // Target ~30 candles, but ensure at least 3 data points per candle so bodies have variation
    const bucketSize = Math.max(3, Math.ceil(activePoints.length / 30));
    const buckets = [];
    for (let i = 0; i < activePoints.length; i += bucketSize) {
      buckets.push(activePoints.slice(i, i + bucketSize));
    }
    return buckets.map(pts => {
      const prices = pts.map(p => p.price ?? p.high ?? p.low ?? 0).filter(Boolean);
      const highs  = pts.map(p => p.high ?? p.price ?? 0).filter(Boolean);
      const lows   = pts.map(p => p.low  ?? p.price ?? 0).filter(Boolean);
      if (!prices.length) return null;
      return {
        ts:    pts[0].timestamp,
        open:  prices[0],
        close: prices[prices.length - 1],
        high:  Math.max(...(highs.length ? highs : prices)),
        low:   Math.min(...(lows.length  ? lows  : prices)),
      };
    }).filter(Boolean);
  }, [activePoints]);

  const pricePath = prices.length > 1
    ? `M ${px(0)} ${py(prices[0])} ` + prices.slice(1).map((v,i) => `L ${px(i+1)} ${py(v)}`).join(' ')
    : '';

  const areaPath = prices.length > 1
    ? `${pricePath} L ${px(prices.length-1)} ${PH} L ${px(0)} ${PH} Z`
    : '';

  // Precompute candle SVG elements (avoids IIFE-in-children issues)
  const candleElements = useMemo(() => {
    if (!candles.length) return [];
    const allPrices = candles.flatMap(c => [c.high, c.low]).filter(Boolean);
    if (!allPrices.length) return [];
    const cMin = Math.min(...allPrices), cMax = Math.max(...allPrices);
    const cpy = v => PH - PAD - ((v - cMin) / Math.max(cMax - cMin, 1)) * (PH - PAD * 2);
    const cw2 = Math.max(2, (CW - PAD * 2) / Math.max(candles.length, 1) * 0.7);
    return candles.map((c, i) => {
      const cx2 = YLAB + PAD + (i / Math.max(candles.length - 1, 1)) * (CW - PAD * 2);
      const color = c.close >= c.open ? T.green : T.red;
      const bodyTop = cpy(Math.max(c.open, c.close));
      const bodyBot = cpy(Math.min(c.open, c.close));
      const bodyH = Math.max(1, bodyBot - bodyTop);
      return h('g', {key: i},
        h('line', {x1: cx2, x2: cx2, y1: cpy(c.high), y2: cpy(c.low), stroke: color, strokeWidth: 1}),
        h('rect', {x: cx2 - cw2/2, y: bodyTop, width: cw2, height: bodyH, fill: color, opacity: 0.85}),
      );
    });
  }, [candles]);

  // Date label helpers
  const labelCount = Math.min(activePoints.length, 6);
  const labelIdxs = Array.from({length: labelCount}, (_, i) =>
    Math.round(i * (activePoints.length - 1) / Math.max(labelCount - 1, 1))
  );
  const fmtDate = ts => {
    const d = new Date(typeof ts === 'number' ? ts * (ts < 1e12 ? 1000 : 1) : ts);
    if (chartView === 'alltime') return d.toLocaleDateString('en-US', {month:'short', year:'numeric'});
    if (range === 365) return d.toLocaleDateString('en-US', {month:'short', year:'2-digit'});
    const fmt = dateFormat || 'MM/DD/YYYY';
    const M = d.getMonth()+1, D = d.getDate();
    if (fmt === 'DD/MM/YYYY') return `${D}/${M}`;
    if (fmt === 'YYYY-MM-DD') return `${d.getFullYear()}-${String(M).padStart(2,'0')}-${String(D).padStart(2,'0')}`;
    return `${M}/${D}`;
  };

  return h('div', {className:'chart-modal-overlay', onClick:onClose},
    h('div', {className:'chart-modal', style:{width:680}, onClick:e=>e.stopPropagation()},

      // Header
      h('div', {className:'chart-modal-title'},
        h('span', null, item.name),
        h('div', {style:{display:'flex', gap:6, alignItems:'center'}},
          [7,30,90,365].map(r => h('button', {
            key:r, onClick:()=>{ setRange(r); setChartView('recent'); setHoverIdx(null); setZoomFrom(''); setZoomTo(''); setZoomWindow(null); },
            style:{
              padding:'2px 10px', fontSize:11, cursor:'pointer', borderRadius:3,
              background: chartView==='recent' && range===r ? 'rgba(201,168,76,0.2)' : 'transparent',
              border: `1px solid ${chartView==='recent' && range===r ? T.gold : T.border}`,
              color: chartView==='recent' && range===r ? T.goldBright : T.textDim,
            }
          }, r === 365 ? '1y' : `${r}d`)),
          h('button', {
            onClick:()=>{ if (!timeseries && !timeseriesLoading) return; setChartView('alltime'); setHoverIdx(null); },
            disabled: timeseriesLoading && !timeseries,
            style:{
              padding:'2px 10px', fontSize:11, cursor: timeseriesLoading && !timeseries ? 'default' : 'pointer', borderRadius:3,
              background: chartView==='alltime' ? 'rgba(201,168,76,0.2)' : 'transparent',
              border: `1px solid ${chartView==='alltime' ? T.gold : T.border}`,
              color: chartView==='alltime' ? T.goldBright : timeseriesLoading && !timeseries ? T.borderDim : T.textDim,
              opacity: !timeseries && !timeseriesLoading ? 0.35 : 1,
            }
          }, timeseriesLoading && !timeseries ? '⏳ All Time' : 'All Time'),
          h('div', {style:{display:'flex', gap:4, marginLeft:8, borderLeft:`1px solid ${T.border}`, paddingLeft:8}},
            ['line','candle'].map(mode =>
              h('button', {
                key:mode,
                onClick: () => setChartMode(mode),
                title: mode === 'line' ? 'Line chart' : 'Candlestick chart',
                style:{
                  padding:'2px 8px', fontSize:11, cursor:'pointer', borderRadius:3,
                  background: chartMode===mode ? 'rgba(201,168,76,0.2)' : 'transparent',
                  border: `1px solid ${chartMode===mode ? T.gold : T.border}`,
                  color: chartMode===mode ? T.goldBright : T.textDim,
                }
              }, mode === 'line' ? '📈' : '🕯️')
            )
          ),
          h('button', {className:'chart-modal-close', onClick:onClose, style:{marginLeft:4}}, '✕')
        )
      ),

      // Chart body
      loading && h('div', {style:{height:240, display:'flex', alignItems:'center', justifyContent:'center', color:T.textDim, fontSize:12}},
        h('span', null, '⏳ Fetching price history...')
      ),

      // Date range row (all-time only)
      chartView === 'alltime' && timeseries && h('div', {style:{display:'flex', alignItems:'center', gap:8, padding:'6px 4px 2px', fontSize:11}},
        h('span', {style:{color:T.textDim}}, 'From'),
        h('input', {
          type:'date', value:zoomFrom,
          onChange: e => { setZoomFrom(e.target.value); setHoverIdx(null); },
          style:{background:T.panel2, border:`1px solid ${T.border}`, borderRadius:3, color:T.text, padding:'2px 6px', fontSize:11, colorScheme:'dark'},
        }),
        h('span', {style:{color:T.textDim}}, 'To'),
        h('input', {
          type:'date', value:zoomTo,
          onChange: e => { setZoomTo(e.target.value); setHoverIdx(null); },
          style:{background:T.panel2, border:`1px solid ${T.border}`, borderRadius:3, color:T.text, padding:'2px 6px', fontSize:11, colorScheme:'dark'},
        }),
        (zoomFrom || zoomTo || zoomWindow) && h('button', {
          onClick: () => { setZoomFrom(''); setZoomTo(''); setZoomWindow(null); setHoverIdx(null); },
          style:{padding:'2px 8px', fontSize:10, cursor:'pointer', borderRadius:3, background:'transparent', border:`1px solid ${T.border}`, color:T.textDim},
        }, 'Reset'),
        h('span', {style:{color:T.textDim, marginLeft:'auto'}},
          activePoints.length > 0
            ? `${activePoints.length.toLocaleString()} data points`
            : ''
        ),
      ),

      error && h('div', {style:{height:240, display:'flex', alignItems:'center', justifyContent:'center', color:T.textDim, fontSize:12}},
        h('span', null, 'Historical data unavailable for this item.')
      ),

      !loading && !error && activePoints.length === 0 && h('div', {style:{height:240, display:'flex', alignItems:'center', justifyContent:'center', color:T.textDim, fontSize:12}},
        h('span', null, chartView === 'alltime' ? 'All-time data unavailable.' : `No data in the last ${range} days.`)
      ),

      !loading && !error && activePoints.length > 0 && h('div', null,
        // Price chart
        h('div', {style:{background:'rgba(0,0,0,0.25)', borderRadius:4, padding:'8px 4px 0', position:'relative'}},
          h('div', {style:{fontSize:9, color:T.textDim, marginLeft:YLAB+PAD, marginBottom:2}}, 'PRICE'),
          h('svg', {
            viewBox:`0 0 ${W} ${PH}`, style:{width:'100%', display:'block', cursor:'crosshair'},
            onMouseMove: e => {
              const rect = e.currentTarget.getBoundingClientRect();
              const svgX = (e.clientX - rect.left) / rect.width * W;
              const relX = svgX - YLAB - PAD;
              const chartW = CW - PAD * 2;
              zoomCenterRef.current = Math.max(0, Math.min(1, relX / chartW));
              const idx = Math.round(relX / (chartW / Math.max(activePoints.length-1,1)));
              const clamped = Math.max(0, Math.min(activePoints.length-1, idx));
              setHoverIdx(clamped);
              setHoverType('price');
            },
            onMouseLeave: () => setHoverIdx(null),
            onWheel: e => {
              if (chartView !== 'alltime') return;
              e.preventDefault();
              doZoom(e.deltaY < 0 ? 'in' : 'out');
            },
          },
            // Y-axis labels on left
            gridLevels.map((g, i) =>
              h('text', {key:i, x:YLAB-4, y:g.y+3, fontSize:9, fill:T.textDim, textAnchor:'end'},
                fmt.gp(g.val)+'gp'
              )
            ),
            // Vertical divider line
            h('line', {x1:YLAB, x2:YLAB, y1:PAD, y2:PH-PAD, stroke:'rgba(255,255,255,0.1)', strokeWidth:1}),
            // Horizontal gridlines
            gridLevels.map((g, i) =>
              h('line', {key:i, x1:YLAB, x2:W-PAD, y1:g.y, y2:g.y,
                stroke:'rgba(255,255,255,0.05)', strokeWidth:1,
                strokeDasharray: g.t===0||g.t===1 ? 'none' : '3,3'
              })
            ),
            chartMode === 'line' && [
              // Area fill
              h('path', {key:'area', d:areaPath, fill:`${priceColor}18`, stroke:'none'}),
              // Price line
              h('path', {key:'line', d:pricePath, fill:'none', stroke:priceColor, strokeWidth:1.5}),
              // Hover crosshair + dot
              hoverIdx !== null && hoverType === 'price' && [
                h('line', {key:'vl', x1:px(hoverIdx), x2:px(hoverIdx), y1:PAD, y2:PH-PAD, stroke:'rgba(255,255,255,0.2)', strokeWidth:1, pointerEvents:'none'}),
                h('circle', {key:'dot', cx:px(hoverIdx), cy:py(prices[hoverIdx]), r:4, fill:priceColor, stroke:T.panel, strokeWidth:1.5, pointerEvents:'none'}),
              ],
              // Current price dot
              prices.length > 0 && h('circle', {key:'cur', cx:px(prices.length-1), cy:py(prices[prices.length-1]), r:3, fill:priceColor, pointerEvents:'none'}),
            ],
            chartMode === 'candle' && candleElements,
          ),
          // Volume bars
          h('div', {style:{display:'flex', alignItems:'center', gap:8, marginLeft:YLAB+PAD, marginTop:4}},
            h('div', {style:{fontSize:9, color:T.textDim}}, 'VOLUME'),
            maxV > 0 && h('div', {style:{fontSize:9, color:T.textDim}},
              '— today: ', h('span', {style:{color:T.blue}}, (volumes[volumes.length-1]||0).toLocaleString()),
              item.avgVolume ? [' · 90d avg: ', h('span', {key:'avg', style:{color:T.textDim}}, Math.round(item.avgVolume).toLocaleString())] : null,
            ),
          ),
          h('svg', {
            viewBox:`0 0 ${W} ${VH}`, style:{width:'100%', display:'block', marginBottom:4, cursor:'crosshair'},
            onMouseMove: e => {
              const rect = e.currentTarget.getBoundingClientRect();
              const svgX = (e.clientX - rect.left) / rect.width * W;
              const relX = svgX - YLAB - PAD;
              const idx = Math.round(relX / ((CW - PAD*2) / Math.max(activePoints.length-1,1)));
              const clamped = Math.max(0, Math.min(activePoints.length-1, idx));
              setHoverIdx(clamped);
              setHoverType('vol');
            },
            onMouseLeave: () => setHoverIdx(null),
          },
            h('line', {x1:YLAB, x2:YLAB, y1:0, y2:VH, stroke:'rgba(255,255,255,0.1)', strokeWidth:1}),
            maxV > 0 && h('text', {x:YLAB-4, y:8, fontSize:8, fill:T.textDim, textAnchor:'end'}, fmt.gp(maxV)),
            maxV > 0 && h('text', {x:YLAB-4, y:VH-2, fontSize:8, fill:T.textDim, textAnchor:'end'}, '0'),
            item.avgVolume && h('line', {
              x1:YLAB, x2:W-PAD, y1:vy(item.avgVolume), y2:vy(item.avgVolume),
              stroke:`${T.gold}55`, strokeWidth:1, strokeDasharray:'3,3',
            }),
            volumes.map((v, i) => {
              const bw = Math.max(1, (CW - PAD*2) / volumes.length - 1);
              const bh = vy(v);
              return h('rect', {key:i, x:px(i)-bw/2, y:bh, width:bw, height:Math.max(0,VH-bh),
                fill: hoverIdx===i ? T.blue : `${T.blue}55`, pointerEvents:'none'});
            })
          ),
          // Hover tooltip overlay
          hoverIdx !== null && h('div', {style:{
            position:'absolute', top:8, right:8,
            background:T.panel2, border:`1px solid ${T.border}`, borderRadius:4,
            padding:'5px 10px', fontSize:11, color:T.text, pointerEvents:'none', zIndex:10,
            boxShadow:'0 2px 8px rgba(0,0,0,0.5)'
          }},
            h('div', {style:{color:T.textDim, fontSize:10, marginBottom:2}}, fmtDate(activePoints[hoverIdx].timestamp)),
            h('div', null, h('span', {style:{color:T.textDim}}, 'Price: '), h('span', {style:{color:T.gold}}, fmt.gp(prices[hoverIdx])+'gp')),
            h('div', null, h('span', {style:{color:T.textDim}}, 'Volume: '), h('span', {style:{color:T.blue}}, volumes[hoverIdx]!=null ? volumes[hoverIdx].toLocaleString() : '—')),
          ),
          h('div', {style:{display:'flex', justifyContent:'space-between', padding:`2px ${PAD}px 6px ${YLAB+PAD}px`, fontSize:9, color:T.textDim}},
            labelIdxs.map(i => h('span', {key:i}, fmtDate(activePoints[i].timestamp)))
          ),
          chartView === 'alltime' && h('div', {style:{textAlign:'center', fontSize:9, color:T.textDim, paddingBottom:4}},
            'Scroll or ↑ ↓ to zoom · Use date pickers above to select a range'
          ),
        ),

        // Signal badges — same ones shown in the side detail panel,
        // surfaced here too so they're visible while looking at the
        // chart instead of having to glance back over at the panel.
        item.signals && item.signals.length > 0 && h('div', {style:{display:'flex', gap:6, flexWrap:'wrap', marginTop:10}},
          item.signals.map(s => h(SignalBadge, {key:s, signal:s}))
        ),

        populatedHistoryIds && !populatedHistoryIds.has(item.id) && h('div',{
          style:{fontSize:11, color:T.textDim, fontStyle:'italic', marginTop:8}
        }, '📊 Price history still loading for this item in the background — avg volume and daily change will firm up once it finishes.'),

        // Stats row
        h('div', {style:{display:'flex', gap:20, marginTop:10, fontSize:12, flexWrap:'wrap'}},
          h('span',null, h('span',{style:{color:T.textDim}},`${range}d Low: `), h('span',{style:{color:T.red}}, fmt.gp(minP)+'gp')),
          h('span',null, h('span',{style:{color:T.textDim}},`${range}d High: `), h('span',{style:{color:T.green}}, fmt.gp(maxP)+'gp')),
          h('span',null, h('span',{style:{color:T.textDim}},'Current: '), h('span',{style:{color:T.gold}}, fmt.gp(item.high||item.low)+'gp')),
          item.change_1d != null && h('span',null,
            h('span',{style:{color:T.textDim}},'Daily Δ: '),
            h('span',{className:pctClass(item.change_1d)}, fmt.pct(item.change_1d))
          ),
          item.volume != null && h('span',null,
            h('span',{style:{color:T.textDim}},'Volume: '),
            h('span',{style:{color:T.blue}}, item.volume.toLocaleString())
          ),
          item.avgVolume != null && h('span',null,
            h('span',{style:{color:T.textDim}},'90d Avg Vol: '),
            h('span',{style:{color:T.blue}}, Math.round(item.avgVolume).toLocaleString())
          )
        ),

        // ATH / ATL row
        timeseriesLoading && h('div', {style:{marginTop:6, fontSize:11, color:T.textDim, borderTop:`1px solid ${T.borderDim}`, paddingTop:8, display:'flex', alignItems:'center', gap:8}},
          h('span', null, '⏳'),
          h('span', null, 'Fetching all-time data — this may take a moment on first load, then it\'s cached permanently.')
        ),
        !timeseriesLoading && !timeseries && h('div', {style:{marginTop:6, fontSize:11, color:T.textDim, borderTop:`1px solid ${T.borderDim}`, paddingTop:8}},
          'All-time data unavailable for this item.'
        ),
        athData && h('div', {style:{display:'flex', gap:20, marginTop:6, fontSize:12, flexWrap:'wrap', borderTop:`1px solid ${T.borderDim}`, paddingTop:8}},
          h('span',null,
            h('span',{style:{color:T.textDim}},'All-Time High: '),
            h('span',{style:{color:T.green, fontWeight:'bold'}}, fmt.gp(athData.ath.price)+'gp'),
            h('span',{style:{color:T.textDim, fontSize:10, marginLeft:4}}, athData.ath.date)
          ),
          h('span',null,
            h('span',{style:{color:T.textDim}},'All-Time Low: '),
            h('span',{style:{color:T.red, fontWeight:'bold'}}, fmt.gp(athData.atl.price)+'gp'),
            h('span',{style:{color:T.textDim, fontSize:10, marginLeft:4}}, athData.atl.date)
          ),
        ),

        // Date lookup
        timeseries && h('div', {style:{display:'flex', alignItems:'center', gap:10, marginTop:8, borderTop:`1px solid ${T.borderDim}`, paddingTop:8}},
          h('span',{style:{fontSize:11, color:T.textDim}},'Price on date:'),
          h('input', {
            type:'date', className:'ge-input',
            style:{fontSize:11, padding:'2px 6px', width:140, WebkitAppRegion:'no-drag'},
            value:dateQuery,
            onChange: e => handleDateLookup(e.target.value),
          }),
          dateLookup && h('span', {style:{fontSize:12}},
            h('span',{style:{color:T.textDim}}, dateLookup.date+': '),
            dateLookup.high && h('span',null, h('span',{style:{color:T.textDim,fontSize:10}},'High '), h('span',{style:{color:T.green}}, fmt.gp(dateLookup.high)+'gp ')),
            dateLookup.low  && h('span',null, h('span',{style:{color:T.textDim,fontSize:10}},'Low '),  h('span',{style:{color:T.red}},   fmt.gp(dateLookup.low)+'gp')),
          )
        ),

        // Support & Resistance
        timeseries && h('div', {style:{marginTop:12, borderTop:`1px solid ${T.borderDim}`, paddingTop:10}},
          h('div', {style:{fontFamily:'Cinzel,serif', fontSize:11, letterSpacing:'1px', color:T.gold, marginBottom:8}}, 'SUPPORT & RESISTANCE'),
          supportResistance && supportResistance.length > 0
            ? h('div', {style:{display:'flex', gap:8, flexWrap:'wrap'}},
                supportResistance.map((lvl, i) =>
                  h('div', {key:i, style:{
                    padding:'5px 12px', borderRadius:3, fontSize:12,
                    background: lvl.type==='support' ? 'rgba(100,200,100,0.08)' : 'rgba(200,100,100,0.08)',
                    border: `1px solid ${lvl.type==='support' ? T.green : T.red}55`,
                  }},
                    h('span', {style:{color: lvl.type==='support' ? T.green : T.red, fontWeight:'bold'}}, fmt.gp(lvl.price)+'gp'),
                    h('span', {style:{color:T.textDim, fontSize:10, marginLeft:6}}, lvl.type)
                  )
                )
              )
            : h('div', {style:{fontSize:11, color:T.textDim}},
                'No significant levels detected near the current price. The item may be trending without a clear floor or ceiling.'
              )
        ),

        seasonalData && seasonalData.newItem && h('div', {style:{marginTop:12, borderTop:`1px solid ${T.borderDim}`, paddingTop:10, fontSize:11, color:T.textDim}},
          `⚠ Seasonal analysis requires at least 1.5 years of data. This item only has ${seasonalData.yearsOfData.toFixed(1)} year(s) — check back later.`
        ),
        // Seasonal averages — only show if enough data
        seasonalData && !seasonalData.newItem && h('div', {style:{marginTop:12, borderTop:`1px solid ${T.borderDim}`, paddingTop:10}},
          // Header + pill toggle
          h('div', {style:{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10}},
            h('div', {style:{fontFamily:'Cinzel,serif', fontSize:11, letterSpacing:'1px', color:T.gold}}, 'SEASONAL AVERAGES'),
            h('div', {style:{display:'flex', gap:4}},
              ['weekly','monthly'].map(v =>
                h('button', {
                  key:v,
                  onClick: () => setSeasonalView(v),
                  style:{
                    padding:'2px 10px', fontSize:10, cursor:'pointer', borderRadius:10,
                    background: seasonalView===v ? 'rgba(201,168,76,0.2)' : 'transparent',
                    border: `1px solid ${seasonalView===v ? T.gold : T.borderDim}`,
                    color: seasonalView===v ? T.goldBright : T.textDim,
                  }
                }, v.charAt(0).toUpperCase()+v.slice(1))
              )
            )
          ),
          // Chart
          h('div', {style:{position:'relative'}},
            seasonalHover && h('div', {style:{
              position:'absolute', top:0, right:0, zIndex:20,
              background:T.panel2, border:`1px solid ${T.border}`, borderRadius:4,
              padding:'4px 10px', fontSize:11, color:T.text, pointerEvents:'none',
              boxShadow:'0 2px 8px rgba(0,0,0,0.5)', whiteSpace:'nowrap',
            }},
              h('span', {style:{color:T.textDim}}, seasonalHover.label+': '),
              h('span', {style:{color: seasonalHover.pct >= 5 ? T.green : seasonalHover.pct <= -5 ? T.red : T.gold}},
                (seasonalHover.pct >= 0 ? '+' : '') + seasonalHover.pct.toFixed(1) + '%'
              ),
              h('span', {style:{color:T.textDim}}, ' · '),
              h('span', {style:{color:T.gold}}, fmt.gp(seasonalHover.avg)+'gp'),
            ),
            h('div', {style:{display:'flex', gap: seasonalView==='weekly' ? 2 : 4, alignItems:'flex-end', position:'relative', paddingBottom:4, overflowX:'auto'}},
              h('div', {style:{position:'absolute', left:0, right:0, height:1, background:T.borderDim, top:'50%'}}),
              (seasonalView === 'weekly' ? seasonalData.weeks : seasonalData.months).map((m, i) => {
                const _now = new Date();
                const _jan1 = new Date(_now.getFullYear(), 0, 1);
                const _curWeek = Math.ceil(((_now - _jan1) / 86400000 + _jan1.getDay() + 1) / 7);
                const isCurrent = seasonalView === 'weekly'
                  ? m.label === `W${_curWeek}`
                  : i === _now.getMonth();
                const barColor = m.pct >= 5 ? T.green : m.pct <= -5 ? T.red : T.gold;
                const BAR_SCALE = seasonalView === 'weekly' ? 1.5 : 2.5;
                const barH = Math.max(3, Math.abs(m.pct) * BAR_SCALE);
                const barW = seasonalView === 'weekly' ? 8 : 28;
                const showLabel = seasonalView === 'monthly' || i % 4 === 0;
                const hoverProps = {
                  onMouseEnter: () => setSeasonalHover(m),
                  onMouseLeave: () => setSeasonalHover(null),
                  style:{cursor:'default'},
                };
                const barStyle = isCurrent
                  ? {...hoverProps.style, width:barW, height:barH, outline:`2px solid white`, outlineOffset:1, zIndex:2}
                  : {...hoverProps.style, width:barW, height:barH};
                return h('div', {key:i, style:{display:'flex', flexDirection:'column', alignItems:'center', minWidth:barW+2, zIndex: isCurrent ? 2 : 1}},
                  m.pct >= 0
                    ? h('div', {style:{display:'flex', flexDirection:'column', alignItems:'center'}},
                        isCurrent && h('div', {style:{fontSize:7, color:'white', fontWeight:'bold', marginBottom:1, whiteSpace:'nowrap'}}, 'NOW'),
                        showLabel && !isCurrent && m.pct >= 5 && h('div', {style:{fontSize:8, color:barColor, fontWeight:'bold', marginBottom:1, whiteSpace:'nowrap'}}, '+'+m.pct.toFixed(1)+'%'),
                        h('div', {...hoverProps, style:{...barStyle, background:barColor+(isCurrent ? 'ff' : '99'), borderRadius:'2px 2px 0 0'}}),
                        h('div', {style:{height:1, width:barW, background: isCurrent ? 'white' : T.border}}),
                        (showLabel || isCurrent) && h('div', {style:{fontSize:8, color: isCurrent ? 'white' : T.textDim, fontWeight: isCurrent ? 'bold' : 'normal', marginTop:2, whiteSpace:'nowrap'}}, m.label),
                        seasonalView === 'monthly' && h('div', {style:{fontSize:8, color:T.gold}}, fmt.gp(m.avg)+'gp'),
                      )
                    : h('div', {style:{display:'flex', flexDirection:'column', alignItems:'center'}},
                        (showLabel || isCurrent) && h('div', {style:{fontSize:8, color: isCurrent ? 'white' : T.textDim, fontWeight: isCurrent ? 'bold' : 'normal', marginBottom:2, whiteSpace:'nowrap'}}, m.label),
                        seasonalView === 'monthly' && h('div', {style:{fontSize:8, color:T.gold, marginBottom:1}}, fmt.gp(m.avg)+'gp'),
                        h('div', {style:{height:1, width:barW, background: isCurrent ? 'white' : T.border}}),
                        h('div', {...hoverProps, style:{...barStyle, background:barColor+(isCurrent ? 'ff' : '99'), borderRadius:'0 0 2px 2px'}}),
                        isCurrent && h('div', {style:{fontSize:7, color:'white', fontWeight:'bold', marginTop:1, whiteSpace:'nowrap'}}, 'NOW'),
                        showLabel && !isCurrent && m.pct <= -5 && h('div', {style:{fontSize:8, color:barColor, fontWeight:'bold', marginTop:1, whiteSpace:'nowrap'}}, m.pct.toFixed(1)+'%'),
                      )
                );
              })
            )
          ),
          h('div', {style:{fontSize:10, color:T.textDim, marginTop:8}},
            seasonalView === 'weekly' ? 'Hover any bar for exact values. ' : '',
            h('span',{style:{color:T.green}},'Green'), ' = 5%+ above average, ',
            h('span',{style:{color:T.red}},'red'), ' = 5%+ below, ',
            h('span',{style:{color:T.gold}},'gold'), ' = neutral. Based on ',
            Math.round(seasonalData.yearsOfData*10)/10, '+ years of data.'
          )
        )
      )
    )
  );
}

/* ─── Item search ────────────────────────────────────────────── */
const BUILTIN_SHORTHANDS = {
  // Weapons
  'FSOA':   'Fractured Staff of Armadyl',
  'EZK':    'Ek-ZekKil',
  'NOX':    'Noxious scythe',
  'NOXBOW': 'Noxious longbow',
  'NOXSTAFF': 'Noxious staff',
  'SGB':    'Seren godbow',
  'BOLG':   'Bow of the Last Guardian',
  'BBC':    'Blightbound crossbow',
  'ACB':    'Ascension crossbow',
  'ZBOW':   'Zaryte bow',
  'RCB':    'Royal crossbow',
  'WHIP':   'Abyssal whip',
  'GMAUL':  'Granite maul',
  'DFS':    'Dragonfire shield',
  'DCLAWS': 'Dragon claws',
  // Godswords
  'AGS':    'Armadyl godsword',
  'BGS':    'Bandos godsword',
  'SGS':    'Saradomin godsword',
  'ZGS':    ['Zamorak godsword', 'Zaros godsword'],
  // Staves
  'ABS':    'Armadyl battlestaff',
  'MWSOA':  'Masterwork Spear of Annihilation',
  // Armour
  'MALEV':  'Malevolent cuirass',
  'VIRTUS': 'Virtus robe top',
  'VIRT':   'Virtus robe top',
  'MW':     'Masterwork platebody',
  'STEADS': 'Steadfast boots',
  'TASSY':  'Bandos tassets',
  'SHB':    'Silverhawk boots',
  // Jewellery / accessories
  'EOF':    'Essence of Finality amulet',
  'AOS':    'Amulet of souls',
  'LOTD':   'Luck of the Dwarves',
  'HSR':    'Hazelmere\'s signet ring',
  'GOTE':   'Grace of the elves',
  'BOTE':   'Brooch of the Gods',
  'BOTG':   'Brooch of the Gods',
  'EE':     'Enhanced Excalibur',
  // Consumables / misc
  'PHAT':   'Blue partyhat',
  'BOND':   'Bond',
  // Crossbows
  'ECB':    'Eldritch crossbow',
  // Ability codexes
  'GCONC':  'Greater Concentrated Blast ability codex',
  'GRICO':  'Greater Ricochet ability codex',
  'GSUN':   'Greater Sunshine ability codex',
  'GSWIFT': 'Greater Death\'s Swiftness ability codex',
  'IOH':    'Ingenuity of the Humans ability codex',
  'IOTH':   'Ingenuity of the Humans ability codex',
  'GFURY':  'Greater Fury ability codex',
  'GBARGE': 'Greater Barge ability codex',
  'GFLURRY':'Greater Flurry ability codex',
  'GCHAIN': 'Greater Chain ability codex',
  'CROAR':  'Chaos Roar ability codex',
  'GSONIC': 'Greater Sonic Wave ability codex',
  'GSW':    'Greater Sonic Wave ability codex',
};

function resolveShorthand(query, userShorthands) {
  const key = query.trim().toUpperCase();
  const merged = {...BUILTIN_SHORTHANDS, ...userShorthands};
  const val = merged[key];
  if (!val) return null;
  return Array.isArray(val) ? val : [val];
}

function useSearch(items, userShorthands = {}) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [focusIdx, setFocusIdx] = useState(0);
  const ref = useRef(null);
  const results = useMemo(() => {
    if (!query.trim() || query.length < 2) return [];
    const resolved = resolveShorthand(query, userShorthands);
    if (resolved) {
      const seen = new Set();
      const out = [];
      for (const name of resolved) {
        const q = name.toLowerCase();
        items
          .filter(it => it.name.toLowerCase().includes(q) && !seen.has(it.id))
          .sort((a,b) => {
            const ai=a.name.toLowerCase().indexOf(q), bi=b.name.toLowerCase().indexOf(q);
            if (ai !== bi) return ai - bi;
            return a.name.localeCompare(b.name);
          })
          .forEach(it => { seen.add(it.id); out.push(it); });
      }
      return out.slice(0, 12);
    }
    const q = query.toLowerCase();
    return items
      .filter(it => it.name.toLowerCase().includes(q))
      .sort((a,b) => {
        const ai=a.name.toLowerCase().indexOf(q), bi=b.name.toLowerCase().indexOf(q);
        if (ai !== bi) return ai - bi;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 12);
  }, [query, items, userShorthands]);
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

function GESearchBar({items, onSelect, userShorthands}) {
  const s = useSearch(items, userShorthands);
  const showDrop = s.focused && s.results.length > 0;
  const pickRandom = () => {
    const seen = new Set();
    const BORING_ONLY = new Set(['misc', 'low_tier', 'materials']);
    const pool = items.filter(it => {
      if (it.untradeable || (!it.high && !it.low)) return false;
      if (seen.has(it.id)) return false;
      seen.add(it.id);
      const cats = it.categories || [];
      const hasInterestingCat = cats.some(c => !BORING_ONLY.has(c));
      const hasVolume = (it.volume || 0) > 5000;
      const hasPrice  = (it.high || it.low || 0) > 10000;
      return hasInterestingCat || (hasVolume && hasPrice);
    });
    if (!pool.length) return;
    onSelect(pool[Math.floor(Math.random() * pool.length)]);
  };
  return h('div', {className:'ge-search-wrap'},
    h('input', {
      className:'ge-search-input',
      placeholder:'Search any item — or press S or / to focus here',
      value:s.query, ref:s.ref,
      onChange:e=>s.setQuery(e.target.value),
      onFocus:()=>s.setFocused(true),
      onBlur:()=>setTimeout(()=>s.setFocused(false),150),
      onKeyDown:e=>s.onKey(e, it=>{onSelect(it); s.setQuery('');}),
    }),
    !s.query && h('button', {
      onClick: pickRandom,
      title: "I'm feeling lucky. You might not be.",
      style:{
        position:'absolute', right:8, top:'50%', transform:'translateY(-50%)',
        background:'transparent', border:'none', cursor:'pointer',
        fontSize:15, color:T.textDim, padding:'2px 4px', lineHeight:1,
        transition:'color 0.15s',
      },
      onMouseEnter: e => e.currentTarget.style.color = T.goldBright,
      onMouseLeave: e => e.currentTarget.style.color = T.textDim,
    }, '🎲'),
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
          it.categories&&it.categories[0]&&h('div',{className:'ge-result-category'},CAT_LABEL[it.categories[0]]||it.categories[0])
        )
      )
    )
  );
}

/* ─── Price trend badges ─────────────────────────────────────── */
function PriceTrendBadges({itemId, currentPrice, onOpenChart}) {
  const [trends, setTrends] = useState(null);

  useEffect(() => {
    if (!itemId || !currentPrice) return;
    window.genius?.getItemHistory(itemId).then(history => {
      if (!history || history.length < 2) return;
      const getTs = p => typeof p.timestamp==='number' ? p.timestamp*(p.timestamp<1e12?1000:1) : new Date(p.timestamp).getTime();
      const sorted = [...history].sort((a,b) => getTs(a) - getTs(b));
      // Use the most recent history point as reference so data lag doesn't kill 7d
      const latestTs = getTs(sorted[sorted.length - 1]);
      const calc = (days) => {
        const cutoff = latestTs - days*24*60*60*1000;
        const pt = sorted.find(p => getTs(p) >= cutoff);
        if (!pt || !pt.price) return null;
        const chg = ((currentPrice - pt.price) / pt.price) * 100;
        const gp  = Math.round(currentPrice - pt.price);
        return {chg: Math.round(chg*100)/100, gp};
      };
      setTrends({d7:calc(7), d30:calc(30), d90:calc(90)});
    });
  }, [itemId, currentPrice]);

  if (!trends) return null;
  const entries = [
    ['7d',  trends.d7],
    ['30d', trends.d30],
    ['90d', trends.d90],
  ].filter(([,v]) => v != null);
  if (!entries.length) return null;

  return h('div', {style:{marginTop:8, display:'flex', gap:6, flexWrap:'wrap'}},
    entries.map(([label, {chg, gp}]) =>
      h('div', {
        key:label,
        onClick: onOpenChart,
        style:{
          cursor:'pointer', padding:'3px 8px', borderRadius:3, fontSize:10,
          background:'rgba(0,0,0,0.25)', border:`1px solid ${T.border}`,
          display:'flex', flexDirection:'column', alignItems:'center', gap:1
        },
        title:`Click to open chart`
      },
        h('span', {style:{color:T.textDim, fontSize:9}}, label),
        h('span', {className:pctClass(chg)}, (chg>0?'+':'')+chg.toFixed(2)+'%'),
        h('span', {className:pctClass(gp), style:{fontSize:9}}, (gp>0?'+':'')+fmt.gp(gp)+'gp')
      )
    )
  );
}

/* ─── Detail panel ───────────────────────────────────────────── */
function RecipeSection({item, allItems}) {
  const recipe = COMBINATION_RECIPES.find(r => r.name.toLowerCase() === item.name.toLowerCase());
  if (!recipe) return null;

  const findIngItem = name => {
    const lower = name.toLowerCase();
    // Try exact match first
    let it = (allItems||[]).find(i => i.name.toLowerCase() === lower);
    if (it) return it;
    // Try stripping dose suffix e.g. "Elder overload potion (6)" → "Elder overload potion"
    const stripped = lower.replace(/\s*\(\d+\)\s*$/, '').trim();
    return (allItems||[]).find(i => i.name.toLowerCase() === stripped) || null;
  };

  const rows = recipe.ingredients.map(ing => {
    const ingItem = findIngItem(ing.name);
    const price = ingItem ? (ingItem.high || ingItem.low || null) : null;
    return {...ing, price, isUntrade: ingItem?.untradeable};
  });

  const total = rows.every(r => r.price != null) ? rows.reduce((s,r) => s + r.price * r.qty, 0) : null;
  const doses = recipe.name.match(/\((\d)\)/)?.[1] || 4;

  return h('div',{style:{marginTop:16, borderTop:`1px solid ${T.border}`, paddingTop:12}},
    h('div',{style:{fontSize:11, fontWeight:'bold', color:T.textDim, letterSpacing:'0.05em', marginBottom:8}}, 'RECIPE'),
    rows.map(ing =>
      h('div',{key:ing.name, style:{display:'flex', justifyContent:'space-between', alignItems:'center',
        padding:'4px 0', borderBottom:`1px solid ${T.borderDim}`, fontSize:12}},
        h('div',{style:{display:'flex', alignItems:'center', gap:5}},
          h('span',{style:{
            fontSize:9, padding:'1px 4px', borderRadius:2,
            background: ing.isUntrade ? 'rgba(255,180,0,0.08)' : 'rgba(201,168,76,0.1)',
            border:`1px solid ${ing.isUntrade ? 'rgba(255,180,0,0.25)' : 'rgba(201,168,76,0.2)'}`,
            color: ing.isUntrade ? T.gold : T.textDim
          }}, ing.isUntrade ? 'made' : 'GE'),
          h('span',{style:{color:T.text}}, ing.qty > 1 ? `${ing.qty}× ${ing.name}` : ing.name)
        ),
        h('span',{style:{color: ing.price != null ? T.textBright : T.textDim}},
          ing.price != null ? fmt.gp(ing.price * ing.qty)+' gp' : '—')
      )
    ),
    h('div',{style:{display:'flex', justifyContent:'space-between', padding:'6px 0 0',
      fontSize:12, fontWeight:'bold', color:T.gold}},
      h('span',null,'Total'),
      h('span',null, total != null ? fmt.gp(total)+' gp' : '—')
    ),
    total != null && h('div',{style:{fontSize:11, color:T.textDim, marginTop:4}},
      `Per dose: ${fmt.gp(Math.round(total / doses))} gp`)
  );
}

function BigMacLine({price, bondGP}) {
  const [pos, setPos] = useState(null);
  const macs = getBigMacs(price, bondGP);
  if (!macs) return null;
  return h('div', {
    style:{fontSize:11, color:T.textDim, cursor:'help', marginTop:8, display:'inline-block'},
    onMouseMove: e => setPos({x: e.clientX, y: e.clientY}),
    onMouseLeave: () => setPos(null),
  },
    '≈ ', macs,
    pos && h('div', {style:{
      position:'fixed', left:pos.x + 12, top:pos.y + 12, zIndex:9999,
      background:T.panel, border:`1px solid ${T.border}`, borderRadius:4,
      padding:'5px 8px', fontSize:11, color:T.textDim, maxWidth:180, lineHeight:1.5,
      pointerEvents:'none', boxShadow:'0 2px 8px rgba(0,0,0,0.5)',
    }}, `Based on live bond price (${fmt.gp(bondGP)}gp = $${BOND_USD} USD) and Big Mac index ($${BIGMAC_USD} USD)`)
  );
}

function FlipCalculator({item, onAddToPortfolio}) {
  const buyPrice  = item.low  || item.high || 0;
  const sellPrice = item.high || item.low  || 0;
  const [buy,  setBuy]  = useState(buyPrice);
  const [sell, setSell] = useState(sellPrice);
  const [qty,  setQty]  = useState(1);

  useEffect(() => { setBuy(item.low || item.high || 0); setSell(item.high || item.low || 0); }, [item.id]);

  const tax       = Math.floor(sell * 0.02);
  const netSell   = sell - tax;
  const profit    = (netSell - buy) * qty;
  const investment = buy * qty;
  const roi       = investment > 0 ? (profit / investment) * 100 : 0;
  const profitColor = profit > 0 ? T.green : profit < 0 ? T.red : T.textDim;

  const inputStyle = {
    background:'rgba(0,0,0,0.25)', border:`1px solid ${T.border}`, borderRadius:3,
    color:T.text, fontSize:12, padding:'4px 6px', width:'100%', boxSizing:'border-box',
  };
  const labelStyle = {fontSize:10, color:T.textDim, marginBottom:3, textTransform:'uppercase', letterSpacing:'0.05em'};

  return h('div', {style:{marginTop:16, borderTop:`1px solid ${T.border}`, paddingTop:12}},
    h('div', {style:{fontSize:11, fontWeight:'bold', color:T.textDim, letterSpacing:'0.05em', marginBottom:8}}, 'MARGIN CALCULATOR'),
    h('div', {style:{display:'flex', gap:6, marginBottom:8}},
      h('div', {style:{flex:1}},
        h('div', {style:labelStyle}, 'Buy Price'),
        h('input', {type:'number', value:buy, min:0, onChange:e=>setBuy(+e.target.value||0), style:inputStyle})
      ),
      h('div', {style:{flex:1}},
        h('div', {style:labelStyle}, 'Sell Price'),
        h('input', {type:'number', value:sell, min:0, onChange:e=>setSell(+e.target.value||0), style:inputStyle})
      ),
      h('div', {style:{flex:'0 0 70px'}},
        h('div', {style:labelStyle}, 'Quantity'),
        h('input', {type:'number', value:qty, min:1, max:item.limit||99999, onChange:e=>setQty(Math.max(1,+e.target.value||1)), style:inputStyle})
      ),
    ),
    h('div', {style:{display:'flex', gap:6, fontSize:11}},
      h('div', {style:{flex:1, background:'rgba(0,0,0,0.2)', borderRadius:3, padding:'5px 8px'}},
        h('div', {style:{color:T.textDim, marginBottom:2}}, 'Investment'),
        h('div', {style:{color:T.textBright, fontWeight:'bold'}}, fmt.gp(investment)+'gp')
      ),
      h('div', {style:{flex:1, background:'rgba(0,0,0,0.2)', borderRadius:3, padding:'5px 8px'}},
        h('div', {style:{color:T.textDim, marginBottom:2}}, 'GE Tax'),
        h('div', {style:{color:T.textDim}}, fmt.gp(tax * qty)+'gp')
      ),
      h('div', {style:{flex:1, background:'rgba(0,0,0,0.2)', borderRadius:3, padding:'5px 8px'}},
        h('div', {style:{color:T.textDim, marginBottom:2}}, 'Profit'),
        h('div', {style:{color:profitColor, fontWeight:'bold'}}, (profit >= 0 ? '+' : '') + fmt.gp(profit)+'gp')
      ),
      h('div', {style:{flex:1, background:'rgba(0,0,0,0.2)', borderRadius:3, padding:'5px 8px'}},
        h('div', {style:{color:T.textDim, marginBottom:2}}, 'ROI'),
        h('div', {style:{color:profitColor, fontWeight:'bold'}}, roi.toFixed(2)+'%')
      ),
    ),
    onAddToPortfolio && h('button', {
      className:'ge-btn gold',
      style:{fontSize:11, padding:'3px 10px', marginTop:6},
      onClick: () => onAddToPortfolio({item_name: item.name, cost_basis: String(buy), quantity: String(qty)}),
      title: 'Log this buy to your portfolio'
    }, '+ Log to Portfolio')
  );
}

function DetailPanel({item, watchlist, onToggleWatch, onToggleHide, hiddenItems, onClose, onCategoryChange, notes, onSaveNote, allItems, dateFormat, onAddToPortfolio, panelWidth, populatedHistoryIds}) {
  const [chartOpen, setChartOpen]     = useState(false);
  const [imageOpen, setImageOpen]     = useState(false);
  const [wikiStats, setWikiStats]     = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [iconUrl, setIconUrl]         = useState(null);
  const [editingCats, setEditingCats] = useState(false);
  const [draftCats, setDraftCats]     = useState([]);
  const [savingCats, setSavingCats]   = useState(false);
  const [noteText, setNoteText]       = useState('');

  useEffect(() => {
    if (!item) return;
    setWikiStats(null);
    setStatsLoading(true);
    setEditingCats(false);
    setDraftCats(item.categories || []);
    setNoteText((notes && notes[item.id]) || '');
    window.genius?.getItemStats(item.name).then(stats => {
      setWikiStats(stats);
      setStatsLoading(false);
    }).catch(() => setStatsLoading(false));
    const wikiName = item.name.split(' ').map((w,i) => i===0 ? w.charAt(0).toUpperCase()+w.slice(1) : w).join('_');
    setIconUrl(`https://runescape.wiki/images/${encodeURIComponent(wikiName)}.png`);
  }, [item?.id]);

  const saveCats = async () => {
    setSavingCats(true);
    const ov = await window.genius?.getOverrides() || {};
    ov[item.name.toLowerCase()] = draftCats;
    const res = await window.genius?.saveOverrides(ov);
    setSavingCats(false);
    if (res?.success) {
      setEditingCats(false);
      onCategoryChange && onCategoryChange(item.name, draftCats);
    }
  };

  if (!item) return null;
  const inWatch = watchlist.includes(item.id);
  const chg = item.change_1d;
  const sparkColor = chg != null && chg < 0 ? T.red : T.green;
  const [sparkHistory, setSparkHistory] = useState([]);
  useEffect(() => {
    if (!item?.id) return;
    setSparkHistory([]);
    window.genius?.getItemHistory(item.id).then(hist => {
      if (!hist || !hist.length) return;
      const cutoff = Date.now() - 30 * 86400000;
      const pts = hist
        .filter(p => {
          const ts = typeof p.timestamp === 'number' ? p.timestamp * (p.timestamp < 1e12 ? 1000 : 1) : new Date(p.timestamp).getTime();
          return ts >= cutoff;
        })
        .map(p => p.price ?? p.high ?? p.low ?? 0)
        .filter(Boolean);
      setSparkHistory(pts);
    }).catch(() => {});
  }, [item.id]);

  const slotLabel = (slot) => {
    if (!slot) return null;
    const s = slot.toLowerCase();
    if (s.includes('2h') || s.includes('two')) return 'Two-handed';
    if (s.includes('off')) return 'Off-hand';
    if (s.includes('weapon') || s.includes('main')) return 'Main hand';
    return slot;
  };

  return h('div', {className:'detail-panel', style: panelWidth ? {width:panelWidth, minWidth:260} : undefined},
    chartOpen && h(ChartModal, {item, onClose:()=>setChartOpen(false), dateFormat, populatedHistoryIds}),
    imageOpen && h(ImageModal, {name: item.name, fallbackUrl: iconUrl, onClose:()=>setImageOpen(false)}),
    h('div', {className:'detail-top'},
      h('div', {className:'row-between', style:{marginBottom:6}},
        h('div', {className:'row', style:{gap:8, alignItems:'center', minWidth:0, overflow:'hidden'}},
          iconUrl && h('img', {
            src: iconUrl,
            alt: '',
            onError: () => setIconUrl(null),
            onClick: () => setImageOpen(true),
            title: 'Click to enlarge',
            style: {width:32, height:32, imageRendering:'pixelated', flexShrink:0, cursor:'zoom-in'}
          }),
          h('div', {className:'detail-name', style:{overflow:'hidden', textOverflow:'ellipsis'}}, item.name)
        ),
        h('div', {className:'row', style:{gap:4, flexShrink:0}},
          h('button', {
            className:'star-btn',
            title: inWatch ? 'Remove from watchlist' : 'Add to watchlist',
            onClick: e => { e.stopPropagation(); onToggleWatch(item.id); },
            style: { display:'flex', alignItems:'center', gap:3, fontSize:13, color: inWatch ? T.goldBright : 'rgba(201,168,76,0.55)', border: `1px solid ${inWatch ? T.goldBright : 'rgba(201,168,76,0.3)'}`, borderRadius:4, padding:'3px 8px', background: inWatch ? 'rgba(201,168,76,0.12)' : 'none' }
          },
            h('span', {style:{fontSize:18, lineHeight:1}}, inWatch ? '★' : '☆'),
            h('span', null, inWatch ? 'Watching' : 'Watch')
          ),
          h('button', {
            className:'ge-btn',
            title: 'Hide this item from all tabs',
            style:{padding:'3px 8px', fontSize:12, color:T.textDim},
            onClick: () => onToggleHide && onToggleHide(item.id)
          }, '🚫 Hide'),
          h('button', {className:'ge-btn', style:{padding:'3px 8px',fontSize:12}, onClick:onClose}, 'X')
        )
      ),
      item.categories && h('div', {className:'detail-cats'},
        item.categories.map(c => h('span',{key:c,className:'cat-tag'}, CAT_LABEL[c] || c)),
        !item.untradeable && h('span',{
          className:'cat-tag', title:'Edit categories',
          style:{cursor:'pointer',opacity:0.6,borderStyle:'dashed'},
          onClick:()=>setEditingCats(v=>!v)
        }, editingCats ? '✕ cancel' : '✎ edit')
      ),
      editingCats && h('div',{style:{padding:'6px 0 4px'}},
        CAT_GROUPS.map(group => h('div',{key:group.label, style:{marginBottom:8}},
          h('div',{style:{fontSize:9,color:T.textDim,textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:4}}, group.label),
          h('div',{style:{display:'flex',flexWrap:'wrap',gap:4}},
            group.cats.map(c => {
              const active = draftCats.includes(c);
              return h('span',{key:c,
                onClick:()=>setDraftCats(prev=>prev.includes(c)?prev.filter(x=>x!==c):[...prev,c]),
                style:{fontSize:11,padding:'3px 8px',borderRadius:3,cursor:'pointer',userSelect:'none',
                  background: active ? T.gold : 'rgba(255,255,255,0.05)',
                  color: active ? '#1a1208' : T.textDim,
                  border:`1px solid ${active ? T.gold : T.border}`
                }
              }, CAT_LABEL[c] || c);
            })
          )
        )),
        h('button',{className:'ge-btn gold',style:{fontSize:11,padding:'3px 10px',marginTop:4},
          onClick:saveCats,disabled:savingCats},
          savingCats ? 'Saving…' : 'Save — takes effect on next Fetch Now')
      ),
      h('div', {className:'detail-price'}, fmt.gp(item.high||item.low)+' gp'),
        item.untradeable
          ? h('div', {style:{marginTop:4}},
              h('span', {style:{fontSize:11, padding:'2px 7px', borderRadius:3, background:'rgba(255,180,0,0.15)', color:T.gold, border:`1px solid ${T.gold}`, fontWeight:600, letterSpacing:'0.04em'}}, 'UNTRADEABLE'),
              h('span', {style:{fontSize:11, color:T.textDim, marginLeft:8}}, 'Calculated production cost')
            )
          : item.change_1d != null && h('div', {className:pctClass(item.change_1d), style:{fontSize:12,marginTop:2}},
              fmt.pct(item.change_1d),
              item.high && h('span', {style:{fontSize:11, marginLeft:6, opacity:0.85}},
                '(' + (item.change_1d > 0 ? '+' : '') + fmt.gp(Math.round(item.high - (item.high / (1 + item.change_1d / 100)))) + 'gp)'
              )
            )
    ),
    h('div', {className:'detail-body'},
      h('div', {className:'sparkline-wrap', onClick:()=>setChartOpen(true), title:'Click to enlarge'},
        h(SparklineSVG, {data:sparkHistory.length ? sparkHistory : [item.high||0, item.high||0], color:sparkColor, w:260, ht:52, showLabels:sparkHistory.length > 0}),
        h('span', {className:'sparkline-expand-hint'}, 'click to expand')
      ),
      item.untradeable
        ? [
            ['Production cost', fmt.gp(item.high || item.low)+' gp'],
            item.rarity && ['Rarity', item.rarity[0].toUpperCase() + item.rarity.slice(1)],
          ].filter(Boolean).map(([l,v]) => h('div',{className:'stat-row',key:l},
            h('span',{className:'stat-lbl'},l),
            h('span',{className:'stat-val'},v)
          ))
        : [
            ['Price',         fmt.gp(item.high || item.low)+' gp'],
            ['After 2% tax', item.low ? fmt.gp(applyTax(item.low))+' gp' : '—'],
            ['Daily Change',  (() => {
              const price = item.high || item.low;
              const chg = item.change_1d;
              if (!price || chg == null) return '—';
              const prevPrice = price / (1 + chg / 100);
              const diff = Math.round(price - prevPrice);
              return h('span', {className: pctClass(diff)}, (diff > 0 ? '+' : '') + fmt.gp(diff) + ' gp');
            })()],
            ['High alch',    item.alch ? fmt.gp(item.alch)+' gp' : '—'],
            ['GE Limit',     item.limit ? item.limit.toLocaleString() : '—'],
          ].map(([l,v]) => h('div',{className:'stat-row',key:l},
            h('span',{className:'stat-lbl'},l),
            h('span',{className:'stat-val'},v)
          )),
      !item.untradeable && h('div', {className:'stat-row'},
        h('span',{className:'stat-lbl'},'Volume'),
        h('span',{className:'stat-val'}, h(VolDisplay,{volume:item.volume, avgVolume:item.avgVolume}))
      ),
      !item.untradeable && populatedHistoryIds && !populatedHistoryIds.has(item.id) && h('div',{
        style:{fontSize:10, color:T.textDim, fontStyle:'italic', marginTop:2, marginBottom:4}
      }, '📊 Price history still loading for this item — Volume avg and Daily Change will firm up once it finishes.'),
      !item.untradeable && item.signals&&item.signals.length>0 && h('div',{className:'signal-list'},
        item.signals.map(s=>h(SignalBadge,{key:s,signal:s}))
      ),

      // Price trend badges from history
      item.id && h(PriceTrendBadges, {itemId: item.id, currentPrice: item.high||item.low, onOpenChart:()=>setChartOpen(true)}),

      // Big Mac price conversion
      !item.untradeable && h(BigMacLine, {
        price: item.high || item.low,
        bondGP: (allItems||[]).find(it => it.name === 'Bond')?.high || 0,
      }),

      // Examine text — use dump data first, fall back to wiki fetch
      statsLoading && !item.examine && h('div',{style:{marginTop:12,fontSize:11,color:T.textDim}},'Loading item info...'),
      h('div',{style:{marginTop:12,padding:'8px 10px',background:'rgba(0,0,0,0.2)',borderRadius:4,fontSize:11,color:T.textDim,fontStyle:'italic',lineHeight:1.5}},
        (() => {
          const txt = item.examine || wikiStats?.examine;
          if (txt) return ['"', txt, '"'];
          if (statsLoading) return null;
          return '"This item is so boring that not even the API has a description for it."';
        })()
      ),

      // Market Personality
      !item.untradeable && h('div', {style:{marginTop:10, padding:'8px 10px', background:'rgba(0,0,0,0.15)', borderRadius:4, borderLeft:`2px solid ${T.borderDim}`, fontSize:11, color:T.textDim, lineHeight:1.5}},
        h('span', {style:{color:T.gold, fontWeight:'bold', marginRight:6}}, '◈'),
        getMarketPersonality(item)
      ),

      // Equipment stats table
      wikiStats?.isGear && h('div',{style:{marginTop:12}},
        h('div',{style:{fontSize:11,fontWeight:'bold',color:T.gold,textTransform:'uppercase',letterSpacing:1,marginBottom:6}},
          'Combat Stats'
        ),
        h('table',{style:{width:'100%',borderCollapse:'collapse',fontSize:11}},
          h('tbody',null,
            // Requirements / Tier / Class / Slot row
            wikiStats.tier && h('tr',null,
              h('td',{style:{color:T.textDim,padding:'3px 0'}}, 'Tier'),
              h('td',{style:{color:T.gold,textAlign:'right',padding:'3px 0'}}, wikiStats.tier)
            ),
            wikiStats.combatClass && h('tr',null,
              h('td',{style:{color:T.textDim,padding:'3px 0'}}, 'Class'),
              h('td',{style:{color:T.gold,textAlign:'right',padding:'3px 0'}}, wikiStats.combatClass)
            ),
            wikiStats.slot && h('tr',null,
              h('td',{style:{color:T.textDim,padding:'3px 0'}}, 'Slot'),
              h('td',{style:{color:T.gold,textAlign:'right',padding:'3px 0'}}, slotLabel(wikiStats.slot) || wikiStats.slot)
            ),
            wikiStats.type && h('tr',null,
              h('td',{style:{color:T.textDim,padding:'3px 0'}}, 'Type'),
              h('td',{style:{color:T.gold,textAlign:'right',padding:'3px 0'}}, wikiStats.type)
            ),
            // Separator
            h('tr',null, h('td',{colSpan:2, style:{padding:'4px 0'}},
              h('div',{style:{borderTop:`1px solid ${T.border}`,margin:'2px 0'}})
            )),
            // Offensive stats
            wikiStats.damage && h('tr',null,
              h('td',{style:{color:T.textDim,padding:'3px 0'}}, 'Damage'),
              h('td',{style:{color:T.green,textAlign:'right',padding:'3px 0'}}, wikiStats.damage)
            ),
            wikiStats.accuracy && h('tr',null,
              h('td',{style:{color:T.textDim,padding:'3px 0'}}, 'Accuracy'),
              h('td',{style:{color:T.green,textAlign:'right',padding:'3px 0'}}, wikiStats.accuracy)
            ),
            wikiStats.style && h('tr',null,
              h('td',{style:{color:T.textDim,padding:'3px 0'}}, 'Style'),
              h('td',{style:{color:T.gold,textAlign:'right',padding:'3px 0'}}, wikiStats.style)
            ),
            wikiStats.speed && h('tr',null,
              h('td',{style:{color:T.textDim,padding:'3px 0'}}, 'Speed'),
              h('td',{style:{color:T.gold,textAlign:'right',padding:'3px 0'}}, wikiStats.speed)
            ),
            wikiStats.range && h('tr',null,
              h('td',{style:{color:T.textDim,padding:'3px 0'}}, 'Range'),
              h('td',{style:{color:T.gold,textAlign:'right',padding:'3px 0'}}, wikiStats.range)
            ),
            // Defensive stats
            (wikiStats.armour || wikiStats.lp || wikiStats.prayer) && h('tr',null,
              h('td',{colSpan:2, style:{padding:'4px 0'}},
                h('div',{style:{borderTop:`1px solid ${T.border}`,margin:'2px 0'}})
              )
            ),
            wikiStats.armour && h('tr',null,
              h('td',{style:{color:T.textDim,padding:'3px 0'}}, 'Armour'),
              h('td',{style:{color:T.blue,textAlign:'right',padding:'3px 0'}}, wikiStats.armour)
            ),
            wikiStats.lp && h('tr',null,
              h('td',{style:{color:T.textDim,padding:'3px 0'}}, 'Life Points'),
              h('td',{style:{color:T.blue,textAlign:'right',padding:'3px 0'}}, wikiStats.lp)
            ),
            wikiStats.prayer && h('tr',null,
              h('td',{style:{color:T.textDim,padding:'3px 0'}}, 'Prayer'),
              h('td',{style:{color:T.blue,textAlign:'right',padding:'3px 0'}}, wikiStats.prayer)
            ),
          )
        )
      ),

      h('div',{style:{marginTop:12}},
        h('button',{
          className:'ge-btn',
          style:{fontSize:11, padding:'3px 10px'},
          onClick:()=>{
            const url = `https://runescape.wiki/w/${encodeURIComponent(item.name.replace(/ /g,'_'))}`;
            window.genius?.openExternal(url);
          }
        },'📖 RS Wiki')
      ),

      h(RecipeSection, {item, allItems}),

      !item.untradeable && h(FlipCalculator, {item, onAddToPortfolio}),

      h('div',{style:{marginTop:16, borderTop:`1px solid ${T.border}`, paddingTop:12}},
        h('div',{style:{fontSize:11, fontWeight:'bold', color:T.textDim, letterSpacing:'0.05em', marginBottom:6}}, 'NOTES'),
        h('textarea',{
          value: noteText,
          onChange: e => setNoteText(e.target.value),
          onBlur: () => onSaveNote && onSaveNote(item.id, noteText),
          placeholder: 'Personal notes on this item…',
          rows: 4,
          style:{
            width:'100%', boxSizing:'border-box', resize:'vertical',
            background:'rgba(0,0,0,0.2)', border:`1px solid ${T.border}`,
            borderRadius:3, color:T.text, fontSize:12, padding:'6px 8px',
            fontFamily:'inherit', lineHeight:1.5,
          }
        }),
        noteText && h('div',{style:{fontSize:10,color:T.textDim,marginTop:3,textAlign:'right'}},'Auto-saved on blur')
      )
    )
  );
}

/* ─── Item table ─────────────────────────────────────────────── */
const DEFAULT_COL_WIDTHS = {name:340, high:110, change_1d:110, volume:140, signals:160, star:30};
function loadColWidths() {
  try { return {...DEFAULT_COL_WIDTHS, ...JSON.parse(localStorage.getItem('genius_col_widths')||'{}')}; }
  catch { return {...DEFAULT_COL_WIDTHS}; }
}

function ItemTable({items, selected, onSelect, watchlist, onToggleWatch, onToggleHide, onAddCompare, description, showSignals}) {
  const [sort, setSort] = useState({key:'name',dir:1});
  const [ctxMenu, setCtxMenu] = useState(null); // {x, y, item}
  const [colWidths, setColWidths] = useState(loadColWidths);
  const colWidthsRef = useRef(colWidths);
  const startColResize = (key) => e => {
    e.preventDefault();
    e.stopPropagation();
    const table = e.currentTarget.closest('.ge-table-wrap')?.querySelector('table');
    const startW = colWidthsRef.current[key] || 110;
    const logicalTotal = Object.values(colWidthsRef.current).reduce((a,b) => a + (b||0), 0);
    // Derive the real-world scale factor (handles UI Scale zoom) from rendered vs logical total width
    const scaleFactor = table && logicalTotal ? (table.getBoundingClientRect().width / logicalTotal) : 1;
    const startX = e.clientX;
    const onMove = me => {
      const deltaReal = me.clientX - startX;
      const deltaLogical = scaleFactor ? deltaReal / scaleFactor : deltaReal;
      const w = Math.max(50, Math.round(startW + deltaLogical));
      colWidthsRef.current = {...colWidthsRef.current, [key]: w};
      setColWidths(colWidthsRef.current);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      try { localStorage.setItem('genius_col_widths', JSON.stringify(colWidthsRef.current)); } catch {}
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const COL_ORDER = ['name','high','change_1d','volume', ...(showSignals?['signals']:[]), 'star'];
  const tableWrapRef = useRef(null);
  const [handleLefts, setHandleLefts] = useState({});
  useEffect(() => {
    const measure = () => {
      const wrap = tableWrapRef.current;
      if (!wrap) return;
      const ths = wrap.querySelectorAll('thead th');
      const wrapRect = wrap.getBoundingClientRect();
      const lefts = {};
      COL_ORDER.filter(k => k !== 'star').forEach((k, i) => {
        const th = ths[i];
        if (th) lefts[k] = th.getBoundingClientRect().right - wrapRect.left + wrap.scrollLeft;
      });
      setHandleLefts(lefts);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [colWidths, items.length, showSignals]);
  // Full-height overlay handles — rendered over the table so the divider is grabbable at any row, not just the header
  const overlayHandle = key => h('span', {
    key,
    onMouseDown: startColResize(key),
    className: 'col-resize-handle',
    style:{
      position:'absolute', top:0, bottom:0,
      left: (handleLefts[key] || 0) - 4,
      width:8, cursor:'col-resize', zIndex:10,
    },
  });

  const openCtx = (e, it) => {
    e.preventDefault();
    e.stopPropagation();
    const x = Math.min(e.clientX, window.innerWidth  - 180);
    const y = Math.min(e.clientY, window.innerHeight - 160);
    setCtxMenu({x, y, item: it});
  };
  const closeCtx = () => setCtxMenu(null);

  const [multiSelect, setMultiSelect] = useState(new Set());
  const toggleMulti = (id) => setMultiSelect(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const clearMulti = () => setMultiSelect(new Set());

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') clearMulti(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const [minPrice, setMinPrice] = useState(0);
  const [customVal, setCustomVal] = useState('');
  const [showCustom, setShowCustom] = useState(false);

  const isLarge = items.length > 300;
  const FILTER_OPTIONS = [
    {label:'All',   value:0},
    {label:'1K+',   value:1000},
    {label:'10K+',  value:10000},
    {label:'100K+', value:100000},
    {label:'1M+',   value:1000000},
    {label:'Custom',value:'custom'},
  ];

  const handleFilterClick = opt => {
    if (opt.value === 'custom') {
      setShowCustom(true);
    } else {
      setShowCustom(false);
      setCustomVal('');
      setMinPrice(opt.value);
    }
  };

  const handleCustomApply = () => {
    const parsed = parseGP(customVal);
    if (typeof parsed === 'number' && parsed > 0) setMinPrice(parsed);
  };

  const activeFilter = showCustom ? 'custom' : minPrice;

  const filtered = useMemo(() => {
    if (!minPrice) return items;
    return items.filter(it => (it.high || it.low || 0) >= minPrice);
  }, [items, minPrice]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a,b) => {
      const av=a[sort.key]??0, bv=b[sort.key]??0;
      return typeof av==='string' ? av.localeCompare(bv)*sort.dir : (av-bv)*sort.dir;
    });
  }, [filtered, sort]);

  const tog = key => setSort(s=>({key,dir:s.key===key?-s.dir:1}));
  const arr = key => sort.key===key?(sort.dir>0?' ↑':' ↓'):'';
  if (!items.length) return h('div',{className:'empty'},h('div',{className:'icon'},'◎'),h('p',null,'No items in this category yet.'));
  return h('div',{className:'ge-table-wrap', style:{position:'relative'}, ref:tableWrapRef, onClick: ctxMenu ? closeCtx : undefined},
    COL_ORDER.filter(k => k !== 'star').map(k => overlayHandle(k)),
    ctxMenu && h('div', {
      style:{
        position:'fixed', zIndex:9999, left:ctxMenu.x, top:ctxMenu.y,
        background:T.panel2, border:`1px solid ${T.borderGold}`, borderRadius:4,
        minWidth:170, boxShadow:'0 4px 16px rgba(0,0,0,0.6)', overflow:'hidden',
      },
      onClick: e => e.stopPropagation(),
    },
      [
        {
          label: watchlist.includes(ctxMenu.item.id) ? '★ Unwatch' : '☆ Watch',
          action: () => { onToggleWatch(ctxMenu.item.id); closeCtx(); },
          color: T.gold,
        },
        {
          label: '📋 Copy price',
          action: () => {
            const price = ctxMenu.item.high || ctxMenu.item.low;
            navigator.clipboard?.writeText(String(price));
            closeCtx();
          },
        },
        {
          label: '🔗 Open on wiki',
          action: () => {
            const slug = ctxMenu.item.name.replace(/ /g, '_');
            window.genius?.openExternal(`https://runescape.wiki/w/${encodeURIComponent(slug)}`);
            closeCtx();
          },
        },
        {
          label: '⇌ Add to compare',
          action: () => { onAddCompare && onAddCompare(ctxMenu.item); closeCtx(); },
        },
        {
          label: '🚫 Hide item',
          action: () => { onToggleHide && onToggleHide(ctxMenu.item.id); closeCtx(); },
          color: T.textDim,
        },
      ].map((opt, i) => h('div', {
        key: i,
        onClick: opt.action,
        style:{
          padding:'8px 14px', cursor:'pointer', fontSize:13,
          color: opt.color || T.text,
          borderBottom: i < 3 ? `1px solid ${T.borderDim}` : 'none',
        },
        onMouseEnter: e => e.currentTarget.style.background = T.panel,
        onMouseLeave: e => e.currentTarget.style.background = 'transparent',
      }, opt.label))
    ),
    description && h('div',{style:{padding:'8px 14px', borderBottom:`1px solid ${T.border}`, fontSize:12, color:T.textDim, fontStyle:'italic', lineHeight:1.5}}, description),
    h('div',{style:{display:'flex', alignItems:'center', gap:8, padding:'6px 10px', borderBottom:`1px solid ${T.border}`, fontSize:11, flexWrap:'wrap'}},
      h('span',{style:{color:T.textDim}}, `${sorted.length}${minPrice?` of ${items.length}`:''} items`),
      isLarge && h('span',{style:{color:T.textDim, marginLeft:'auto'}}, 'Min price:'),
      isLarge && FILTER_OPTIONS.map(opt =>
        h('button',{
          key: opt.value,
          onClick: () => handleFilterClick(opt),
          style:{
            padding:'2px 8px', fontSize:10, cursor:'pointer', borderRadius:3,
            background: activeFilter===opt.value ? 'rgba(201,168,76,0.2)' : 'transparent',
            border: `1px solid ${activeFilter===opt.value ? T.gold : T.border}`,
            color: activeFilter===opt.value ? T.goldBright : T.textDim,
          }
        }, opt.label)
      ),
      isLarge && showCustom && h('div',{style:{display:'flex', gap:4, alignItems:'center'}},
        h('input',{
          className:'ge-input',
          style:{width:90, padding:'2px 6px', fontSize:11},
          placeholder:'e.g. 500k',
          value:customVal,
          onChange:e=>setCustomVal(e.target.value),
          onKeyDown:e=>e.key==='Enter'&&handleCustomApply(),
          autoFocus:true,
        }),
        h('button',{
          className:'ge-btn',
          style:{padding:'2px 8px', fontSize:10},
          onClick:handleCustomApply
        },'Apply')
      )
    ),
    multiSelect.size > 0 && h('div', {style:{
      display:'flex', alignItems:'center', gap:8, padding:'6px 12px',
      background:T.panel2, borderBottom:`1px solid ${T.borderGold}`,
      fontSize:12,
    }},
      h('span',{style:{color:T.gold, fontWeight:'bold'}}, `${multiSelect.size} selected`),
      h('button',{className:'ge-btn',style:{padding:'2px 10px',fontSize:11},
        onClick:()=>{ onToggleHide&&onToggleHide([...multiSelect]); clearMulti(); }
      }, '🚫 Hide all'),
      h('button',{className:'ge-btn',style:{padding:'2px 10px',fontSize:11},
        onClick:()=>{ multiSelect.forEach(id=>onToggleWatch(id)); clearMulti(); }
      }, '★ Watch all'),
      onAddCompare && h('button',{className:'ge-btn',style:{padding:'2px 10px',fontSize:11},
        onClick:()=>{
          sorted.filter(it=>multiSelect.has(it.id)).slice(0,4).forEach(it=>onAddCompare(it));
          clearMulti();
        }
      }, '⇌ Compare all'),
      h('button',{className:'ge-btn',style:{padding:'2px 10px',fontSize:11},onClick:clearMulti},'✕ Clear')
    ),
    h('table',{className:'ge-table', style:{tableLayout:'fixed', width:'max-content'}},
      h('colgroup',null,
        h('col',{style:{width:colWidths.name}}),
        h('col',{style:{width:colWidths.high}}),
        h('col',{style:{width:colWidths.change_1d}}),
        h('col',{style:{width:colWidths.volume}}),
        showSignals && h('col',{style:{width:colWidths.signals}}),
        h('col',{style:{width:colWidths.star}}),
      ),
      h('thead',null,h('tr',null,
        h('th',{onClick:()=>tog('name')},'Item'+arr('name')),
        h('th',{onClick:()=>tog('high')},'Price'+arr('high')),
        h('th',{onClick:()=>tog('change_1d')},'Change'+arr('change_1d')),
        h('th',{onClick:()=>tog('volume')},'Volume'+arr('volume')),
        showSignals && h('th',null,'Signals'),
        h('th',{style:{width:30}},null)
      )),
      h('tbody',null, sorted.map(it =>
        h('tr',{
          key:it.id, 'data-item-id':it.id,
          className: multiSelect.has(it.id) ? 'selected multi-selected' : selected?.id===it.id ? 'selected' : '',
          onClick: e => {
            if (e.ctrlKey || e.metaKey) { e.preventDefault(); toggleMulti(it.id); }
            else { clearMulti(); onSelect(it); }
          },
          onContextMenu: e => openCtx(e, it),
        },
          h('td',null, h('div',{style:{display:'flex', alignItems:'center', justifyContent:'space-between'}},
            h('span',null, it.name),
            SHOW_THUMBNAILS && h(ItemThumb,{name:it.name}),
          )),
          h('td',{style:{color:T.gold}},fmt.gp(it.high||it.low)+'gp'),
          h('td',null, h(ChangeDisplay,{change_1d:it.change_1d, price:it.high||it.low})),
          h('td',null, h(VolDisplay,{volume:it.volume, avgVolume:it.avgVolume})),
          showSignals && h('td',null, h('div',{style:{display:'flex',flexWrap:'wrap',gap:3}},
            (it.signals||[]).map(s=>h(SignalBadge,{key:s,signal:s}))
          )),
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

// Module-level, not nested inside DashboardTab — it used to be defined
// inside DashboardTab's render body, which meant React saw a brand-new
// component type every time DashboardTab re-rendered (e.g. on a routine
// data refresh) and force-unmounted/remounted every card, wiping its
// `pos` (tooltip position) state mid-hover. That's what made the
// tooltip seem to randomly snap shut almost immediately — nothing
// wrong with the hover logic itself, the component just kept getting
// thrown away underneath it.
function SectorCard({sector, onClick}) {
  const [pos, setPos] = useState(null);
  const {score, label, emoji, count, surge, dump, frenzy, active, avgChg} = sector;
  const heat = score >= 72 ? {color:'#ff6b35', label:'🔥 Hot'}
             : score >= 55 ? {color:'#ffd700', label:'🟡 Warm'}
             : score >= 40 ? {color:T.green,   label:'🟢 Active'}
             : score >= 25 ? {color:T.textDim,  label:'⬜ Quiet'}
             :               {color:T.red,      label:'🔴 Cold'};
  const tip = [
    `${count} ${count === 1 ? 'item' : 'items'} tracked`,
    active != null ? `${active} with price movement today` : null,
    surge  ? `${surge} surging`  : null,
    dump   ? `${dump} dumping`   : null,
    frenzy ? `${frenzy} in frenzy` : null,
    avgChg != null ? `Avg change: ${avgChg >= 0 ? '+' : ''}${avgChg.toFixed(2)}%` : null,
    `Heat score reflects price momentum, opportunity scores, and signal activity across all items in this sector.`,
  ].filter(Boolean).join(' · ');

  return h('div', {
    onClick,
    style:{
      background:T.panel, border:`1px solid ${T.border}`, borderRadius:4,
      padding:'8px 10px', flex:'1 1 100px', minWidth:100,
      cursor:'pointer', position:'relative',
      borderLeft:`3px solid ${heat.color}`,
      transition:'border-color 0.15s',
    },
    onMouseEnter: e => e.currentTarget.style.borderColor = heat.color,
    onMouseLeave: e => { e.currentTarget.style.borderColor = T.border; setPos(null); },
    onMouseMove: e => setPos({x: e.clientX, y: e.clientY}),
  },
    h('div', {style:{display:'flex', alignItems:'center', gap:5, marginBottom:4}},
      h('span', {style:{fontSize:14}}, emoji),
      h('span', {style:{fontSize:11, fontWeight:'bold', color:T.textBright}}, label),
    ),
    h('div', {style:{fontSize:10, color:heat.color}}, heat.label),
    pos && h('div', {style:{
      position:'fixed', left: Math.min(pos.x + 12, window.innerWidth - 260), zIndex:9999,
      top: pos.y + 16 + 120 > window.innerHeight ? pos.y - 120 : pos.y + 16,
      background:T.panel2, border:`1px solid ${T.border}`, borderRadius:4,
      padding:'8px 10px', fontSize:11, color:T.textDim, maxWidth:250, lineHeight:1.6,
      pointerEvents:'none', boxShadow:'0 4px 16px rgba(0,0,0,0.6)',
    }},
      h('div', {style:{color:T.textBright, fontWeight:'bold', marginBottom:4}}, `${emoji} ${label}`),
      tip
    )
  );
}

/* ─── Dashboard tab ──────────────────────────────────────────── */
function DashboardTab({items, indexes, selected, onSelect, watchlist, onToggleWatch, onToggleHide, onAddCompare, description, alerts, portfolio, onNavigate, news}) {
  const [activeSignal, setActiveSignal] = useState(null);
  const [activeIndexId, setActiveIndexId] = useState(null);
  const [activeSector, setActiveSector] = useState(null);
  const [newsExpanded, setNewsExpanded] = useState(true);
  const [expandedArticle, setExpandedArticle] = useState(null);
  const [signalTrend, setSignalTrend] = useState(null);
  const [signalWindow, setSignalWindow] = useState('today');
  useEffect(() => { setSignalWindow('today'); }, [activeSignal]);
  useEffect(() => {
    const limits = {};
    items.forEach(it => { if (it.id && it.limit) limits[it.id] = it.limit; });
    window.genius?.getSignalTrend?.(limits).then(setSignalTrend).catch(() => {});
  }, [items]);

  // Backspace backs out of a drill-down view (signal / index / sector)
  useEffect(() => {
    const onKey = e => {
      if (e.key !== 'Backspace') return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (document.activeElement?.isContentEditable) return;
      if (activeSignal) { e.preventDefault(); setActiveSignal(null); }
      else if (activeIndexId) { e.preventDefault(); setActiveIndexId(null); }
      else if (activeSector) { e.preventDefault(); setActiveSector(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeSignal, activeIndexId, activeSector]);
  const tradeableItems = useMemo(() => items.filter(it => !it.untradeable), [items]);

  const risers  = useMemo(() => [...tradeableItems].filter(it => (it.change_1d||0) > 0 && it.high > 1000)
    .sort((a,b) => (b.change_1d||0)-(a.change_1d||0)).slice(0,6), [tradeableItems]);
  const fallers = useMemo(() => [...tradeableItems].filter(it => (it.change_1d||0) < 0 && it.high > 1000)
    .sort((a,b) => (a.change_1d||0)-(b.change_1d||0)).slice(0,6), [tradeableItems]);
  const volume  = useMemo(() => [...tradeableItems]
    .filter(it => it.signals && (it.signals.includes('FRENZY') || it.signals.includes('HIGH_VOL')))
    .sort((a,b) => {
      const ra = a.volume && a.avgVolume ? a.volume/a.avgVolume : 0;
      const rb = b.volume && b.avgVolume ? b.volume/b.avgVolume : 0;
      return rb - ra;
    }).slice(0,6), [tradeableItems]);

  const signalCounts = useMemo(() => {
    const counts = {SURGE:0,DUMP:0,ACCUMULATION:0,DISTRIBUTION:0,FRENZY:0,HIGH_VOL:0,MANIPULATED:0};
    for (const it of tradeableItems) {
      for (const s of (it.signals||[])) { if (s in counts) counts[s]++; }
    }
    return counts;
  }, [tradeableItems]);

  const totalWithChange = tradeableItems.filter(it => it.change_1d != null).length;
  const rising  = tradeableItems.filter(it => (it.change_1d||0) > 0).length;
  const falling = tradeableItems.filter(it => (it.change_1d||0) < 0).length;

  // Personal — watchlist movers
  const watchlistItems = useMemo(() => items.filter(it => watchlist.includes(it.id)), [items, watchlist]);
  const watchlistMovers = useMemo(() =>
    [...watchlistItems].filter(it => it.change_1d != null)
      .sort((a,b) => Math.abs(b.change_1d||0) - Math.abs(a.change_1d||0))
      .slice(0, 6),
  [watchlistItems]);

  // Personal — portfolio
  const positions = portfolio?.positions || [];
  const openPositions = positions.filter(p => p.status !== 'sold');
  const {totalInvested, totalCurrent, unrealizedPL, unrealizedPct} = useMemo(() => {
    let inv = 0, cur = 0;
    for (const pos of openPositions) {
      const it = items.find(i => i.name.toLowerCase() === (pos.item_name||'').toLowerCase());
      const price = it ? (it.high || it.low || 0) : 0;
      inv += pos.cost_basis * pos.quantity;
      cur += price * pos.quantity;
    }
    const pl = cur - inv;
    const pct = inv > 0 ? (pl / inv) * 100 : 0;
    return {totalInvested:inv, totalCurrent:cur, unrealizedPL:pl, unrealizedPct:pct};
  }, [openPositions, items]);

  // Personal — alerts
  const alertCount = (alerts||[]).length;
  const triggeredAlerts = useMemo(() => (alerts||[]).filter(a => {
    const it = items.find(i => i.name.toLowerCase() === (a.item_name||'').toLowerCase());
    if (!it) return false;
    const price = it.high || it.low || 0;
    if (a.condition === 'above') return price >= a.price;
    if (a.condition === 'below') return price <= a.price;
    if (a.condition === 'signal') return (it.signals||[]).includes(a.signal);
    return false;
  }), [alerts, items]);

  // Market stats — total GP traded, items tracked
  const marketStats = useMemo(() => {
    const totalGP = tradeableItems.reduce((s, it) => s + ((it.high || it.low || 0) * (it.volume || 0)), 0);
    const itemsTraded = tradeableItems.filter(it => (it.volume || 0) > 0).length;
    const itemsTracked = tradeableItems.length;
    return { totalGP, itemsTraded, itemsTracked };
  }, [tradeableItems]);

  // Item of the Day — seeded by date so it's the same for everyone all day
  const itemOfTheDay = useMemo(() => {
    const pool = tradeableItems.filter(it => it.high || it.low);
    if (!pool.length) return null;
    const today = new Date();
    const seed  = today.getFullYear() * 10000 + (today.getMonth()+1) * 100 + today.getDate();
    const idx   = seed % pool.length;
    return pool[idx];
  }, [tradeableItems]);

  // Mood of the Market
  const mood = useMemo(() => getMarketWeather(tradeableItems), [tradeableItems]);
  const [showWeatherLegend, setShowWeatherLegend] = useState(false);

  // Hall of Shame
  const hallOfShame = useMemo(() => {
    const priced = tradeableItems.filter(it => (it.high || it.low) > 10000 && it.change_1d != null);
    const biggestCrash = [...priced].sort((a,b) => (a.change_1d||0) - (b.change_1d||0))[0];
    const biggestDump  = [...priced].filter(it => (it.signals||[]).includes('DUMP'))
      .sort((a,b) => {
        const ra = a.volume && a.avgVolume ? a.volume/a.avgVolume : 0;
        const rb = b.volume && b.avgVolume ? b.volume/b.avgVolume : 0;
        return rb - ra;
      })[0];
    const mostVolatile = [...priced].filter(it => (it.signals||[]).includes('FRENZY'))
      .sort((a,b) => Math.abs(b.change_1d||0) - Math.abs(a.change_1d||0))[0];
    const manipulated  = [...priced].filter(it => (it.signals||[]).includes('MANIPULATED'))
      .sort((a,b) => Math.abs(b.change_1d||0) - Math.abs(a.change_1d||0))[0];

    const entries = [];
    if (biggestCrash && (biggestCrash.change_1d||0) < -3)
      entries.push({ icon:'📉', title:'Biggest Crash', item: biggestCrash, stat: (biggestCrash.change_1d).toFixed(2)+'% today' });
    if (biggestDump && biggestDump !== biggestCrash)
      entries.push({ icon:'🚮', title:'Heaviest Dump', item: biggestDump,  stat: (biggestDump.change_1d||0).toFixed(2)+'% on '+(biggestDump.volume&&biggestDump.avgVolume?(biggestDump.volume/biggestDump.avgVolume).toFixed(1)+'x avg vol':'high volume') });
    if (mostVolatile)
      entries.push({ icon:'🌪️', title:'Most Volatile',  item: mostVolatile, stat: Math.abs(mostVolatile.change_1d||0).toFixed(2)+'% swing today' });
    if (manipulated)
      entries.push({ icon:'🎭', title:'Probably Manipulated', item: manipulated, stat: Math.abs(manipulated.change_1d||0).toFixed(2)+'% move on tiny buy limit' });
    return entries;
  }, [tradeableItems]);

  // Sector Heat Map
  const SECTORS = [
    {label:'Melee',       cats:['melee'],                          emoji:'⚔️'},
    {label:'Ranged',      cats:['ranged','ammo'],                   emoji:'🏹'},
    {label:'Magic',       cats:['magic','runes'],                  emoji:'🔮'},
    {label:'Necromancy',  cats:['necromancy'],                     emoji:'💀'},
    {label:'Herblore',    cats:['herblore','supplies'],            emoji:'⚗️'},
    {label:'Boss Drops',  cats:['boss'],                           emoji:'🐉'},
    {label:'Rares',       cats:['rares'],                          emoji:'🎩'},
    {label:'Skilling',    cats:['mining','artisan','farming','archaeology'], emoji:'⛏️'},
    {label:'Prayer',      cats:['prayer'],                         emoji:'🦴'},
    {label:'Summoning',   cats:['summoning'],                      emoji:'🐾'},
    {label:'Invention',   cats:['invention'],                      emoji:'⚙️'},
    {label:'Treasure Trails', cats:['treasure_trails'],            emoji:'📦'},
  ];

  const sectorHeat = useMemo(() => {
    return SECTORS.map(sector => {
      const catSet = new Set(sector.cats);
      const members = tradeableItems.filter(it =>
        (it.categories||[]).some(c => catSet.has(c)) && (it.high || it.low)
      );
      if (!members.length) return {...sector, score:0, count:0, surge:0, dump:0, active:0};

      const surge  = members.filter(it => (it.signals||[]).includes('SURGE')).length;
      const dump   = members.filter(it => (it.signals||[]).includes('DUMP')).length;
      const frenzy = members.filter(it => (it.signals||[]).includes('FRENZY')).length;
      const active = members.filter(it => (it.change_1d||0) !== 0).length;

      const avgChg = members.reduce((s,it) => s + (it.change_1d||0), 0) / members.length;
      const avgOpp = members.reduce((s,it) => s + (it.opportunity_score||0), 0) / members.length;

      // Heat score: blend momentum + opportunity + signal activity
      const momentumScore = Math.max(0, Math.min(100, 50 + avgChg * 4));
      const signalScore   = Math.min(100, ((surge + frenzy * 2) / Math.max(members.length, 1)) * 1000);
      const score = momentumScore * 0.5 + signalScore * 0.3 + avgOpp * 0.2;

      return {...sector, score, count:members.length, surge, dump, frenzy, active, avgChg, members};
    });
  }, [tradeableItems]);

  const sectionStyle = {marginBottom:20};
  const headingStyle = {fontSize:11, fontWeight:'bold', letterSpacing:'0.08em', textTransform:'uppercase',
    color:T.textDim, borderBottom:`1px solid ${T.borderDim}`, paddingBottom:4, marginBottom:10};
  const cardRowStyle = {display:'flex', flexWrap:'wrap', gap:8};

  // Index card
  const IndexCard = ({idx}) => {
    const up = idx.direction === 'up';
    const dn = idx.direction === 'down';
    const chgColor = up ? T.green : dn ? T.red : T.textDim;
    const arrow = up ? '▲' : dn ? '▼' : '●';
    const sign = idx.change > 0 ? '+' : '';
    const def = INDEXES.find(d => d.name === idx.name);
    return h('div', {
      onClick: () => def && setActiveIndexId(def.id),
      style:{
        background:T.panel, border:`1px solid ${T.border}`, borderRadius:4,
        padding:'10px 14px', minWidth:150, flex:'1 1 140px',
        cursor: def ? 'pointer' : 'default', transition:'border-color 0.15s',
      },
      onMouseEnter: e => { if (def) e.currentTarget.style.borderColor = T.gold+'88'; },
      onMouseLeave: e => { e.currentTarget.style.borderColor = T.border; },
    },
      h('div', {style:{fontSize:11, color:T.textDim, marginBottom:4}}, idx.name),
      h('div', {style:{fontSize:18, fontWeight:'bold', color:T.textBright, marginBottom:2}},
        idx.value.toFixed(2)),
      h('div', {style:{fontSize:12, color:chgColor}},
        `${arrow} ${sign}${idx.change.toFixed(2)}`)
    );
  };

  // Mini item row
  const MiniRow = ({it, showChange}) => {
    const price = it.high || it.low;
    const chg = it.change_1d;
    return h('div', {
      style:{display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'5px 8px', borderRadius:3, cursor:'pointer',
        background: selected?.id===it.id ? T.panel2 : 'transparent'},
      onClick: () => onSelect(it),
    },
      h('div', {style:{fontSize:12, color:T.text, flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}, it.name),
      h('div', {style:{fontSize:12, color:T.textDim, marginLeft:8, whiteSpace:'nowrap'}}, fmt.gp(price)+'gp'),
      showChange && chg != null && h('div', {
        style:{fontSize:11, color: chg>0?T.green:T.red, marginLeft:8, minWidth:46, textAlign:'right'}
      }, (chg>0?'+':'')+chg.toFixed(2)+'%')
    );
  };

  // Signal pill
  const SIG_COLORS = {
    SURGE:{bg:'#1a3a1a',border:'#4caf50',text:'#4caf50'},
    DUMP:{bg:'#3a1a1a',border:'#e53935',text:'#e53935'},
    ACCUMULATION:{bg:'#1a2a3a',border:'#64b5f6',text:'#64b5f6'},
    DISTRIBUTION:{bg:'#2a1a3a',border:'#ce93d8',text:'#ce93d8'},
    FRENZY:{bg:'#3a2a0a',border:'#ffd700',text:'#ffd700'},
    HIGH_VOL:{bg:'#2a2a1a',border:'#c9a84c',text:'#c9a84c'},
  };
  const SignalPill = ({signal, count}) => {
    const c = SIG_COLORS[signal] || {bg:T.panel,border:T.border,text:T.text};
    const active = activeSignal === signal;
    const trend = signalTrend?.counts?.[signal];
    return h('div', {
      onClick: () => setActiveSignal(s => s === signal ? null : signal),
      title: trend ? `Past ${trend.length} days: ${trend.join(', ')}` : undefined,
      style:{
        background: active ? c.border : c.bg,
        border:`1px solid ${c.border}`, borderRadius:4,
        padding:'6px 12px', display:'flex', flexDirection:'column', alignItems:'center',
        minWidth:90, flex:'1 1 80px', cursor:'pointer',
        transition:'background 0.15s',
      }
    },
      h('div', {style:{fontSize:18, fontWeight:'bold', color: active ? T.bg : c.text}}, count),
      h('div', {style:{fontSize:10, color: active ? T.bg : c.text, opacity: active ? 1 : 0.8, marginTop:2}}, signal),
      trend && h('div', {style:{display:'flex', alignItems:'flex-end', gap:2, marginTop:5, height:16}},
        trend.map((v,i) => {
          const max = Math.max(...trend, 1);
          const isToday = i === trend.length - 1;
          return h('div', {key:i, style:{
            width:5, height: Math.max(2, (v/max)*16),
            background: isToday ? (active ? T.bg : c.text) : (active ? `${T.bg}99` : `${c.text}55`),
            borderRadius:1,
          }, title:`${v}`});
        })
      )
    );
  };

  // Signal drill-down view
  if (activeSignal) {
    const todayItems = tradeableItems.filter(it => (it.signals||[]).includes(activeSignal));
    const weekEntries = signalTrend?.itemIds?.[activeSignal] || [];
    const lastDayIdx = signalTrend ? signalTrend.days.length - 1 : 0;
    const weekItems = signalWindow === '7d'
      ? (() => {
          const byId = new Map();
          weekEntries.forEach(e => byId.set(String(e.id), e.lastDayIdx));
          todayItems.forEach(it => byId.set(String(it.id), lastDayIdx)); // today's live signals always count
          return [...byId.entries()].map(([id, idx]) => {
            const it = tradeableItems.find(t => String(t.id) === id);
            return it ? {...it, _lastDayIdx: idx} : null;
          }).filter(Boolean);
        })()
      : [];
    const sigItems = (signalWindow === '7d' ? weekItems : todayItems)
      .sort((a,b) => {
        if (signalWindow === '7d') {
          const da = a._lastDayIdx ?? 0, db = b._lastDayIdx ?? 0;
          if (da !== db) return db - da;
        }
        if (activeSignal === 'DUMP') return (a.change_1d||0) - (b.change_1d||0);
        if (activeSignal === 'SURGE') return (b.change_1d||0) - (a.change_1d||0);
        const ra = a.volume && a.avgVolume ? a.volume/a.avgVolume : 0;
        const rb = b.volume && b.avgVolume ? b.volume/b.avgVolume : 0;
        return rb - ra;
      });
    const c = SIG_COLORS[activeSignal] || {bg:T.panel, border:T.border, text:T.text};
    return h('div', {style:{display:'flex', flexDirection:'column', height:'100%'}},
      h('div', {style:{display:'flex', alignItems:'center', gap:10, padding:'10px 14px', borderBottom:`1px solid ${T.border}`, flexShrink:0}},
        h('button', {className:'ge-btn', style:{padding:'3px 10px', fontSize:12}, onClick:()=>setActiveSignal(null)}, '← Back'),
        h('div', {style:{fontSize:12, fontWeight:'bold', color:c.text, letterSpacing:'0.08em'}}, activeSignal),
        h('div', {style:{fontSize:11, color:T.textDim}}, `${sigItems.length} items`),
        h('div', {style:{display:'flex', gap:4, marginLeft:'auto'}},
          ['today','7d'].map(w => h('button', {
            key:w,
            onClick:()=>setSignalWindow(w),
            style:{
              padding:'3px 10px', fontSize:11, cursor:'pointer', borderRadius:3,
              background: signalWindow===w ? 'rgba(201,168,76,0.2)' : 'transparent',
              border:`1px solid ${signalWindow===w ? T.gold : T.border}`,
              color: signalWindow===w ? T.goldBright : T.textDim,
            }
          }, w==='today' ? 'Today' : 'Last 7 Days'))
        )
      ),
      SIGNAL_INFO[activeSignal] && h('div', {style:{
        padding:'8px 14px', fontSize:11, color:T.textDim, fontStyle:'italic', lineHeight:1.5,
        borderBottom:`1px solid ${T.borderDim}`, flexShrink:0,
      }}, SIGNAL_INFO[activeSignal] + (signalWindow==='7d' ? ' Showing any item that triggered this in the last 7 days.' : '')),
      h('div', {style:{flex:1, overflowY:'auto'}},
        h(ItemTable, {items:sigItems, selected, onSelect, watchlist, onToggleWatch, onToggleHide, onAddCompare})

      )
    );
  }

  // Index drill-down view
  if (activeIndexId) {
    const def = INDEXES.find(d => d.id === activeIndexId);
    const itemById = {};
    items.forEach(it => { itemById[it.id] = it; });
    const indexItems = def ? def.items.map(d => itemById[d.id]).filter(Boolean) : [];
    const withChange = indexItems.filter(it => it.change_1d != null);
    const avgChange = withChange.length ? withChange.reduce((s,it) => s+it.change_1d, 0) / withChange.length : null;
    return h('div', {style:{display:'flex', flexDirection:'column', height:'100%'}},
      h('div', {style:{display:'flex', alignItems:'center', gap:10, padding:'10px 14px', borderBottom:`1px solid ${T.border}`, flexShrink:0}},
        h('button', {className:'ge-btn', style:{padding:'3px 10px', fontSize:12}, onClick:()=>setActiveIndexId(null)}, '← Back'),
        h('div', {style:{fontSize:12, fontWeight:'bold', color:T.goldBright, letterSpacing:'0.08em'}}, def?.name),
        avgChange != null && h('div', {style:{fontSize:12, color: avgChange >= 0 ? T.green : T.red}},
          (avgChange >= 0 ? '▲ +' : '▼ ') + avgChange.toFixed(2) + '% avg today'),
        h('div', {style:{fontSize:11, color:T.textDim, marginLeft:'auto'}},
          `${indexItems.length} / ${def?.items.length || 0} items tracked`),
      ),
      h('div', {style:{flex:1, overflowY:'auto'}},
        h(ItemTable, {items:indexItems, selected, onSelect, watchlist, onToggleWatch, onToggleHide, onAddCompare})
      )
    );
  }

  // Sector drill-down view
  if (activeSector) {
    const {label, emoji, members, surge, dump, frenzy, active, count} = activeSector;
    const HEAT_SIGNALS = new Set(['SURGE','FRENZY','DUMP','MANIPULATED']);
    const sorted = [...(members||[])]
      .filter(it => (it.signals||[]).some(s => HEAT_SIGNALS.has(s)))
      .sort((a,b) => {
        const order = ['FRENZY','SURGE','DUMP','MANIPULATED'];
        const aTop = order.find(s => (a.signals||[]).includes(s)) || 'ZZZ';
        const bTop = order.find(s => (b.signals||[]).includes(s)) || 'ZZZ';
        if (aTop !== bTop) return order.indexOf(aTop) - order.indexOf(bTop);
        return Math.abs(b.change_1d||0) - Math.abs(a.change_1d||0);
      });
    const stats = [surge && `${surge} surging`, dump && `${dump} dumping`, frenzy && `${frenzy} in frenzy`].filter(Boolean).join(', ');
    return h('div', {style:{display:'flex', flexDirection:'column', height:'100%'}},
      h('div', {style:{display:'flex', alignItems:'center', gap:10, padding:'10px 14px', borderBottom:`1px solid ${T.border}`, flexShrink:0}},
        h('button', {className:'ge-btn', style:{padding:'3px 10px', fontSize:12}, onClick:()=>setActiveSector(null)}, '← Back'),
        h('span', {style:{fontSize:16}}, emoji),
        h('div', {style:{fontSize:12, fontWeight:'bold', color:T.goldBright, letterSpacing:'0.08em'}}, label),
        stats && h('div', {style:{fontSize:11, color:T.textDim}}, stats),
        h('div', {style:{fontSize:11, color:T.textDim, marginLeft:'auto'}}, `${sorted.length} ${sorted.length === 1 ? 'item' : 'items'} with active signals (${count} in sector)`),
      ),
      sorted.length === 0
        ? h('div', {style:{padding:20, fontSize:12, color:T.textDim}}, 'No items with active surge, dump, frenzy, or manipulated signals in this sector right now.')
        : h('div', {style:{flex:1, overflowY:'auto'}},
            h(ItemTable, {items:sorted, selected, onSelect, watchlist, onToggleWatch, onToggleHide, onAddCompare, showSignals:true})
          )
    );
  }

  return h('div', {style:{padding:'12px 14px', overflowY:'auto', height:'100%'}},
    description && h('div', {style:{padding:'4px 0 12px', fontSize:12, color:T.textDim, fontStyle:'italic', lineHeight:1.5, borderBottom:`1px solid ${T.borderDim}`, marginBottom:16}}, description),

    // ── Mood + Item of the Day ───────────────────────────────────
    h('div', {style:{display:'flex', gap:8, marginBottom:20}},

      // Mood of the Market
      mood && h('div', {
        title: mood.tip,
        style:{
          background:T.panel, border:`1px solid ${T.border}`, borderRadius:4,
          padding:'10px 14px', flex:'0 0 auto', cursor:'default',
          display:'flex', alignItems:'center', gap:10, position:'relative',
        }
      },
        h('div', {style:{fontSize:28, lineHeight:1}}, mood.emoji),
        h('div', null,
          h('div', {style:{display:'flex', alignItems:'center', gap:5}},
            h('div', {style:{fontSize:10, color:T.textDim, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:2}}, 'Market Weather'),
            h('span', {
              onClick: e => { e.stopPropagation(); setShowWeatherLegend(s => !s); },
              title:'See all possible Market Weather statuses',
              style:{cursor:'pointer', fontSize:10, color:T.textDim, border:`1px solid ${T.textDim}`, borderRadius:'50%', width:13, height:13, display:'inline-flex', alignItems:'center', justifyContent:'center', marginBottom:2},
            }, '?'),
          ),
          h('div', {style:{fontSize:13, fontWeight:'bold', color:T.textBright}}, mood.label),
        ),
        showWeatherLegend && h('div', {
          onClick: e => e.stopPropagation(),
          style:{
            position:'absolute', top:'100%', left:0, marginTop:6, zIndex:50, width:320,
            background:T.panel2, border:`1px solid ${T.borderGold}`, borderRadius:6,
            boxShadow:'0 4px 16px rgba(0,0,0,0.6)', padding:'10px 12px',
          },
        },
          h('div', {style:{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8}},
            h('div', {style:{fontSize:11, color:T.gold, textTransform:'uppercase', letterSpacing:'0.06em'}}, 'All Market Weather statuses'),
            h('span', {onClick:()=>setShowWeatherLegend(false), style:{cursor:'pointer', color:T.textDim, fontSize:13}}, '✕'),
          ),
          MARKET_WEATHER_LEGEND.map(w => h('div', {key:w.label, style:{display:'flex', gap:8, alignItems:'flex-start', padding:'6px 0', borderTop:`1px solid ${T.borderDim}`}},
            h('div', {style:{fontSize:18, lineHeight:1.3}}, w.emoji),
            h('div', null,
              h('div', {style:{fontSize:12, color: w.label===mood.label ? T.goldBright : T.textBright, fontWeight:'bold'}}, w.label, w.label===mood.label && h('span', {style:{color:T.textDim, fontWeight:'normal'}}, ' (current)')),
              h('div', {style:{fontSize:11, color:T.textDim, lineHeight:1.4}}, w.tip),
            ),
          )),
        ),
      ),

      // Item of the Day
      itemOfTheDay && h('div', {
        onClick: () => onSelect(itemOfTheDay),
        style:{
          background:T.panel, border:`1px solid ${T.border}`, borderRadius:4,
          padding:'10px 14px', flex:'1 1 0', cursor:'pointer',
          transition:'border-color 0.15s',
        },
        onMouseEnter: e => e.currentTarget.style.borderColor = T.gold+'88',
        onMouseLeave: e => e.currentTarget.style.borderColor = T.border,
      },
        h('div', {style:{fontSize:10, color:T.textDim, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:4}}, "Item of the Day"),
        h('div', {style:{display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:8}},
          h('div', {style:{fontSize:13, fontWeight:'bold', color:T.textBright, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}, itemOfTheDay.name),
          h('div', {style:{fontSize:12, color:T.gold, flexShrink:0}}, fmt.gp(itemOfTheDay.high||itemOfTheDay.low)+'gp'),
        ),
        h('div', {style:{fontSize:11, color:T.textDim, marginTop:4, fontStyle:'italic', lineHeight:1.4,
          overflow:'hidden', display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical'}},
          (() => {
            const txt = itemOfTheDay.examine;
            if (txt) return `"${txt}"`;
            return '"This item is so boring that not even the API has a description for it."';
          })()
        )
      ),
    ),

    // ── Market Stats ─────────────────────────────────────────────
    h('div', {style:{display:'flex', gap:8, marginBottom:20}},
      [
        ['💰', fmt.gp(marketStats.totalGP)+'gp', 'GP traded today'],
        ['📦', marketStats.itemsTraded.toLocaleString(), 'items with volume'],
        ['📊', marketStats.itemsTracked.toLocaleString(), 'items tracked'],
      ].map(([icon, val, label]) =>
        h('div', {key:label, style:{
          flex:'1 1 0', background:T.panel, border:`1px solid ${T.border}`, borderRadius:4,
          padding:'8px 12px', display:'flex', alignItems:'center', gap:8,
        }},
          h('span', {style:{fontSize:18}}, icon),
          h('div', null,
            h('div', {style:{fontSize:13, fontWeight:'bold', color:T.textBright}}, val),
            h('div', {style:{fontSize:10, color:T.textDim, marginTop:1}}, label),
          )
        )
      )
    ),

    // ── News Item Mentions ───────────────────────────────────────
    (() => {
      const now = new Date();
      const dow = now.getDay();
      const daysToMon = dow === 0 ? 6 : dow - 1;
      const lastMon = new Date(now); lastMon.setDate(now.getDate() - daysToMon); lastMon.setHours(0,0,0,0);
      const twoMonsAgo = new Date(lastMon); twoMonsAgo.setDate(lastMon.getDate() - 7);
      const recentNews = (news||[]).filter(n =>
        n.source === 'RS3 News' &&
        n.date && new Date(n.date) >= twoMonsAgo &&
        ((n.mentions&&n.mentions.length) || (n.impact_items&&n.impact_items.length))
      );
      if (!recentNews.length) return null;
      return h('div', {style:sectionStyle},
        h('div', {style:{...headingStyle, display:'flex', alignItems:'center', justifyContent:'space-between', cursor:'pointer'},
          onClick:()=>setNewsExpanded(e=>!e)},
          h('div', {style:{display:'flex', alignItems:'center', gap:8}},
            h('span', null, 'Recent Updates · Items'),
            h('span', {style:{fontSize:12, color:T.textDim}}, newsExpanded ? '▲' : '▼'),
          ),
          h('span', {
            style:{fontSize:11, color:T.textDim, fontWeight:'normal'},
            onClick: e => { e.stopPropagation(); onNavigate&&onNavigate('news'); },
          }, '→ News tab'),
        ),
        newsExpanded && recentNews.map((n,i) => {
          const isOpen = expandedArticle === i;
          return h('div', {key:i, style:{borderTop:`1px solid ${T.borderDim}`}},
            h('div', {
              style:{display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 12px 8px 0', cursor:'pointer', gap:8},
              onClick:()=>setExpandedArticle(isOpen ? null : i),
            },
              h('div', {style:{display:'flex', alignItems:'center', gap:8, minWidth:0, flex:1}},
                h('span', {style:{fontSize:10, color:T.textDim, flexShrink:0}}, n.date),
                h('span', {style:{fontSize:12, color:T.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}, n.title),
                n.update_type && h('span', {style:{
                  fontSize:9, padding:'1px 6px', borderRadius:2, flexShrink:0,
                  background:'rgba(201,168,76,0.12)', border:`1px solid rgba(201,168,76,0.25)`,
                  color:T.gold, textTransform:'uppercase', letterSpacing:'0.05em',
                }}, n.update_type),
              ),
              h('span', {style:{color:T.text, flexShrink:0, fontSize:18, minWidth:20, textAlign:'center', lineHeight:1}}, isOpen ? '▾' : '›'),
            ),
            isOpen && h('div', {style:{paddingBottom:10}},
              (n.mentions&&n.mentions.length) > 0 && h('div', {style:{marginBottom:8}},
                h('div', {style:{fontSize:9, color:T.textDim, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:4}}, 'Mentioned'),
                h('div', {style:{display:'flex', flexWrap:'wrap', gap:4}},
                  n.mentions.map(m => {
                    const it = items.find(it2 => it2.name.toLowerCase()===m.toLowerCase());
                    return h('span', {key:m, className:'news-tag',
                      style:{cursor:it?'pointer':'default', color:T.gold},
                      onClick: it ? ()=>onSelect(it) : undefined,
                    }, m);
                  })
                )
              ),
              (n.impact_items&&n.impact_items.length) > 0 && h('div', null,
                h('div', {style:{fontSize:9, color:T.textDim, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:4}}, 'Likely affected'),
                h('div', {style:{display:'flex', flexWrap:'wrap', gap:4}},
                  n.impact_items.map(m => {
                    const it = items.find(it2 => it2.name.toLowerCase()===m.name.toLowerCase());
                    const chgColor = (m.change_1d||0) > 0 ? T.green : (m.change_1d||0) < 0 ? T.red : T.textDim;
                    return h('span', {key:m.name, className:'news-tag',
                      style:{cursor:it?'pointer':'default', color:T.textDim},
                      onClick: it ? ()=>onSelect(it) : undefined,
                    },
                      m.name,
                      m.change_1d != null && h('span', {style:{color:chgColor, marginLeft:4}},
                        (m.change_1d>0?'+':'')+m.change_1d.toFixed(1)+'%')
                    );
                  })
                )
              ),
            ),
          );
        }),
      );
    })(),

    // ── Sector Heat Map ──────────────────────────────────────────
    h('div', {style:sectionStyle},
      h('div', {style:headingStyle}, 'Sector Heat Map'),
      h('div', {style:{display:'flex', flexWrap:'wrap', gap:6}},
        sectorHeat.map(sector => h(SectorCard, {key:sector.label, sector, onClick:()=>setActiveSector(sector)}))
      )
    ),

    // ── Personal command center ──────────────────────────────────

    // Watchlist movers
    h('div', {style:sectionStyle},
      h('div', {style:headingStyle}, 'Your Watchlist'),
      watchlistItems.length === 0
        ? h('div', {style:{fontSize:12, color:T.textDim, padding:'8px 0'}},
            'No items watched yet. Star any item to track it here.')
        : watchlistMovers.length === 0
          ? h('div', {style:{fontSize:12, color:T.textDim, padding:'8px 0'}}, 'No price movement on watched items today.')
          : watchlistMovers.map(it => h(MiniRow, {key:it.id, it, showChange:true}))
    ),

    // Portfolio snapshot
    openPositions.length > 0 && h('div', {style:sectionStyle},
      h('div', {style:{...headingStyle, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'space-between'}, onClick:()=>onNavigate&&onNavigate('portfolio'), title:'Go to Portfolio'},
        h('span', null, 'Portfolio'),
        h('span', {style:{fontSize:11, color:T.gold, fontWeight:'normal'}}, 'View all →')),
      h('div', {style:{display:'flex', flexWrap:'wrap', gap:8}},
        h('div', {onClick:()=>onNavigate&&onNavigate('portfolio'), style:{background:T.panel, border:`1px solid ${T.border}`, borderRadius:4, padding:'10px 14px', flex:'1 1 120px', cursor:'pointer'}},
          h('div', {style:{fontSize:16, fontWeight:'bold', color:T.textBright}}, fmt.gp(totalCurrent)+'gp'),
          h('div', {style:{fontSize:11, color:T.textDim, marginTop:2}}, `Current Value (${openPositions.length} positions)`)),
        h('div', {onClick:()=>onNavigate&&onNavigate('portfolio'), style:{background:T.panel, border:`1px solid ${T.border}`, borderRadius:4, padding:'10px 14px', flex:'1 1 120px', cursor:'pointer'}},
          h('div', {style:{fontSize:16, fontWeight:'bold', color: unrealizedPL >= 0 ? T.green : T.red}},
            (unrealizedPL >= 0 ? '+' : '') + fmt.gp(unrealizedPL) + 'gp'),
          h('div', {style:{fontSize:11, color:T.textDim, marginTop:2}},
            `Unrealized P&L (${unrealizedPct >= 0 ? '+' : ''}${unrealizedPct.toFixed(1)}%)`))
      )
    ),

    // Alerts status
    alertCount > 0 && h('div', {style:sectionStyle},
      h('div', {style:headingStyle}, 'Alerts'),
      h('div', {style:{display:'flex', flexWrap:'wrap', gap:8}},
        h('div', {style:{background:T.panel, border:`1px solid ${T.border}`, borderRadius:4, padding:'10px 14px', flex:'1 1 120px'}},
          h('div', {style:{fontSize:16, fontWeight:'bold', color:T.textBright}}, alertCount),
          h('div', {style:{fontSize:11, color:T.textDim, marginTop:2}}, 'Alerts Set')),
        triggeredAlerts.length > 0 && h('div', {style:{background:T.panel, border:`1px solid ${T.gold}`, borderRadius:4, padding:'10px 14px', flex:'1 1 120px'}},
          h('div', {style:{fontSize:16, fontWeight:'bold', color:T.gold}}, triggeredAlerts.length),
          h('div', {style:{fontSize:11, color:T.textDim, marginTop:2}}, 'Conditions Met'))
      ),
      triggeredAlerts.length > 0 && h('div', {style:{marginTop:8}},
        triggeredAlerts.slice(0,3).map(a =>
          h('div', {key:a.id, style:{fontSize:12, color:T.gold, padding:'3px 0'}},
            `⚡ ${a.item_name} — ${a.condition === 'above' ? 'above' : a.condition === 'below' ? 'below' : 'signal'} ${a.price ? fmt.gp(a.price)+'gp' : a.signal||''}`)
        )
      )
    ),

    h('div', {style:{borderTop:`1px solid ${T.borderDim}`, marginBottom:16}}),

    // Market indexes
    indexes.length > 0 && h('div', {style:sectionStyle},
      h('div', {style:headingStyle}, 'Market Indexes'),
      h('div', {style:cardRowStyle},
        indexes.map(idx => h(IndexCard, {key:idx.name, idx}))
      )
    ),

    // Stat pills
    h('div', {style:sectionStyle},
      h('div', {style:headingStyle}, 'Market Pulse'),
      h('div', {style:{display:'flex', flexWrap:'wrap', gap:8}},
        h('div', {style:{background:T.panel, border:`1px solid ${T.border}`, borderRadius:4, padding:'10px 14px', flex:'1 1 120px'}},
          h('div', {style:{fontSize:18, fontWeight:'bold', color:T.textBright}}, tradeableItems.length.toLocaleString()),
          h('div', {style:{fontSize:11, color:T.textDim, marginTop:2}}, 'Items Tracked')),
        h('div', {style:{background:T.panel, border:`1px solid ${T.border}`, borderRadius:4, padding:'10px 14px', flex:'1 1 120px'}},
          h('div', {style:{fontSize:18, fontWeight:'bold', color:T.textBright}}, totalWithChange.toLocaleString()),
          h('div', {style:{fontSize:11, color:T.textDim, marginTop:2}}, 'With Price Data')),
        h('div', {style:{background:T.panel, border:`1px solid ${T.border}`, borderRadius:4, padding:'10px 14px', flex:'1 1 120px'}},
          h('div', {style:{fontSize:18, fontWeight:'bold', color:T.green}}, rising.toLocaleString()),
          h('div', {style:{fontSize:11, color:T.textDim, marginTop:2}}, 'Rising Today')),
        h('div', {style:{background:T.panel, border:`1px solid ${T.border}`, borderRadius:4, padding:'10px 14px', flex:'1 1 120px'}},
          h('div', {style:{fontSize:18, fontWeight:'bold', color:T.red}}, falling.toLocaleString()),
          h('div', {style:{fontSize:11, color:T.textDim, marginTop:2}}, 'Falling Today'))
      )
    ),

    // Active signals
    h('div', {style:sectionStyle},
      h('div', {style:headingStyle}, 'Active Signals'),
      h('div', {style:{display:'flex', flexWrap:'wrap', gap:8}},
        Object.entries(signalCounts).map(([sig, cnt]) => h(SignalPill, {key:sig, signal:sig, count:cnt}))
      )
    ),

    // Top movers
    h('div', {style:{display:'flex', gap:16, flexWrap:'wrap', marginBottom:20}},
      h('div', {style:{flex:'1 1 200px', minWidth:200}},
        h('div', {style:headingStyle}, 'Top Gainers'),
        risers.length
          ? risers.map(it => h(MiniRow, {key:it.id, it, showChange:true}))
          : h('div', {style:{fontSize:12, color:T.textDim, padding:'8px 0'}}, 'No data yet')
      ),
      h('div', {style:{flex:'1 1 200px', minWidth:200}},
        h('div', {style:headingStyle}, 'Top Losers'),
        fallers.length
          ? fallers.map(it => h(MiniRow, {key:it.id, it, showChange:true}))
          : h('div', {style:{fontSize:12, color:T.textDim, padding:'8px 0'}}, 'No data yet')
      )
    ),

    // Volume anomalies
    volume.length > 0 && h('div', {style:sectionStyle},
      h('div', {style:headingStyle}, 'Volume Anomalies'),
      volume.map(it => h(MiniRow, {key:it.id, it, showChange:false}))
    ),

    // Hall of Shame
    hallOfShame.length > 0 && h('div', {style:sectionStyle},
      h('div', {style:headingStyle}, '🏛️ Hall of Shame'),
      h('div', {style:{display:'flex', flexDirection:'column', gap:6}},
        hallOfShame.map((entry, i) =>
          h('div', {
            key:i,
            onClick: () => onSelect(entry.item),
            style:{
              display:'flex', alignItems:'center', gap:10,
              padding:'8px 10px', borderRadius:4, cursor:'pointer',
              background:T.panel, border:`1px solid ${T.border}`,
              borderLeft:`3px solid ${T.red}`,
              transition:'border-color 0.15s',
            },
            onMouseEnter: e => e.currentTarget.style.borderColor = T.red,
            onMouseLeave: e => e.currentTarget.style.borderColor = T.border,
          },
            h('div', {style:{fontSize:20, flexShrink:0}}, entry.icon),
            h('div', {style:{flex:1, minWidth:0}},
              h('div', {style:{fontSize:10, color:T.red, fontWeight:'bold', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:2}}, entry.title),
              h('div', {style:{fontSize:12, color:T.textBright, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}, entry.item.name),
              h('div', {style:{fontSize:11, color:T.textDim}}, entry.stat),
            ),
            h('div', {style:{fontSize:12, color:T.red, flexShrink:0, fontWeight:'bold'}},
              fmt.gp(entry.item.high || entry.item.low)+'gp'
            ),
          )
        )
      )
    )
  );
}

/* ─── Compare tab ────────────────────────────────────────────── */
function CompareTab({compareList, onRemove, onClear, allItems, description}) {
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);

  const handleSearch = e => {
    const q = e.target.value;
    setSearch(q);
    if (q.length < 2) { setSearchResults([]); return; }
    const ql = q.toLowerCase();
    setSearchResults(allItems.filter(it => it.name.toLowerCase().includes(ql)).slice(0, 8));
  };

  const ROWS = [
    {label: 'Price',    render: it => fmt.gp(it.high||it.low)+'gp', color: it => T.gold},
    {label: 'Change',   render: it => it.change_1d != null ? (it.change_1d>0?'+':'')+it.change_1d.toFixed(2)+'%' : '—',
                        color:  it => it.change_1d == null ? T.textDim : it.change_1d>0 ? T.green : T.red},
    {label: 'Volume',   render: it => it.volume ? fmt.gp(it.volume) : '—', color: () => T.text},
    {label: 'Avg Vol',  render: it => it.avgVolume ? fmt.gp(it.avgVolume) : '—', color: () => T.textDim},
    {label: 'Vol Ratio',render: it => it.volume&&it.avgVolume ? (it.volume/it.avgVolume).toFixed(2)+'×' : '—',
                        color:  it => {
                          if (!it.volume||!it.avgVolume) return T.textDim;
                          const r = it.volume/it.avgVolume;
                          return r>=2.5?T.gold:r>=1.5?T.green:r<=0.5?T.red:T.text;
                        }},
    {label: 'Alch',     render: it => it.alch ? fmt.gp(it.alch)+'gp' : '—', color: () => T.textDim},
    {label: 'Score',    render: it => it.score != null ? h('span', null, h('span', null, it.score.toFixed(1)), h('span', {style:{color:T.textDim, fontSize:10}}, '/100')) : '—',
                        color:  it => {
                          const s = it.score||0;
                          return s>=70?T.green:s>=40?T.gold:T.textDim;
                        }},
    {label: 'Buy Limit',render: it => it.limit ? it.limit.toLocaleString() : '—', color: () => T.textDim},
    {label: 'Signals',  render: null, color: () => T.text},
  ];

  const colW = compareList.length === 0 ? 0 : Math.floor(80 / compareList.length);

  return h('div', {style:{display:'flex',flexDirection:'column',height:'100%'}},
    description && h('div',{style:{padding:'8px 14px',borderBottom:`1px solid ${T.border}`,fontSize:12,color:T.textDim,fontStyle:'italic',lineHeight:1.5}}, description),

    // Search bar to add items
    h('div',{style:{padding:'8px 12px',borderBottom:`1px solid ${T.border}`,display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}},
      h('span',{style:{fontSize:11,color:T.textDim}},'Add item:'),
      h('div',{style:{position:'relative',flex:'1',maxWidth:280}},
        h('input',{className:'ge-input',placeholder:'Search item name...',value:search,
          onChange:handleSearch, style:{width:'100%'}}),
        searchResults.length>0 && h('div',{style:{
          position:'absolute',top:'100%',left:0,right:0,zIndex:100,
          background:T.panel2,border:`1px solid ${T.borderGold}`,borderRadius:4,maxHeight:200,overflowY:'auto'
        }},
          searchResults.map(it => h('div',{
            key:it.id,
            style:{padding:'6px 10px',cursor:'pointer',fontSize:12,color:T.text},
            onMouseEnter:e=>e.currentTarget.style.background=T.panel,
            onMouseLeave:e=>e.currentTarget.style.background='transparent',
            onClick:()=>{
              if (compareList.length>=4){return;}
              if (!compareList.find(c=>c.id===it.id)) {
                compareList.push(it);
                // trigger re-render via onRemove pattern — handled in App
                onRemove({...it, _add:true});
              }
              setSearch(''); setSearchResults([]);
            }
          }, it.name))
        )
      ),
      compareList.length>0&&h('button',{className:'ge-btn',style:{fontSize:11,padding:'3px 8px'},onClick:onClear},'Clear all'),
      h('span',{style:{fontSize:11,color:T.textDim}}, `${compareList.length}/4 items`)
    ),

    compareList.length === 0
      ? h('div',{className:'empty'},
          h('div',{className:'icon'},'⇌'),
          h('p',null,'Search for items above, or right-click any item and choose Compare.')
        )
      : h('div',{style:{overflowX:'auto',flex:1}},
          h('table',{className:'ge-table',style:{tableLayout:'fixed',width:'100%'}},
            h('thead',null,
              h('tr',null,
                h('th',{style:{width:'20%'}},'Stat'),
                compareList.map(it=>h('th',{key:it.id,style:{width:`${colW}%`}},
                  h('div',{style:{display:'flex',alignItems:'center',justifyContent:'space-between',gap:4}},
                    h('span',{style:{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}},it.name),
                    h('button',{
                      style:{background:'none',border:'none',color:T.textDim,cursor:'pointer',fontSize:12,flexShrink:0},
                      onClick:()=>onRemove(it)
                    },'×')
                  )
                ))
              )
            ),
            h('tbody',null,
              ROWS.map(row=>h('tr',{key:row.label},
                h('td',{style:{color:T.textDim,fontSize:11,fontWeight:'bold'}},row.label),
                compareList.map(it=>h('td',{key:it.id},
                  row.render === null
                    ? h('div',{style:{display:'flex',flexWrap:'wrap',gap:2}},
                        (it.signals||[]).map(s=>h(SignalBadge,{key:s,signal:s}))
                      )
                    : h('span',{style:{color:row.color(it)}}, row.render(it))
                ))
              ))
            )
          )
        )
  );
}

/* ─── Tab views ──────────────────────────────────────────────── */
function WatchlistTab({items, watchlist, selected, onSelect, onToggleWatch, description, devMode}) {
  // Two-pill Normal/DXP switcher — dev-mode only for now (Ben: build and
  // test it now, hidden, same as the rest of the Almanac, before deciding
  // whether/how to expose it once the Almanac itself goes public). The
  // underlying lists stay genuinely separate (main watchlist vs the
  // Almanac's own dxpWatchlist) rather than merging, since someone
  // watching dozens of items broadly may not want all of them eligible
  // for DXP-specific alerts — this is just a unified place to SEE both.
  const [view, setView] = useState('normal');
  const [dxpWatchlist, setDxpWatchlist] = useState([]);
  useEffect(() => { if (devMode) window.genius?.getDxpWatchlist?.().then(list => setDxpWatchlist(list || [])); }, [devMode]);
  const toggleDxpWatch = id => {
    const sid = String(id); // store as string, matching the Almanac's own convention
    setDxpWatchlist(prev => {
      const next = prev.includes(sid) ? prev.filter(x=>x!==sid) : [...prev, sid];
      window.genius?.setDxpWatchlist?.(next);
      return next;
    });
  };

  const activeList = devMode && view === 'dxp' ? dxpWatchlist : watchlist;
  const activeToggle = devMode && view === 'dxp' ? toggleDxpWatch : onToggleWatch;
  // dxpWatchlist ids are strings (DXPIntelTab's `for (const id in data)`
  // always yields string object keys); the main item catalogue's `id` is
  // a number — String() both sides so the DXP pill actually matches.
  const watched = items.filter(it=>activeList.map(String).includes(String(it.id)));

  return h('div',null,
    description && h('div',{style:{padding:'8px 14px', borderBottom:`1px solid ${T.border}`, fontSize:12, color:T.textDim, fontStyle:'italic', lineHeight:1.5}}, description),
    devMode && h('div', {style:{display:'flex', alignItems:'center', gap:8, padding:'10px 14px', borderBottom:`1px solid ${T.border}`}},
      ['normal','dxp'].map(v => h('button', {
        key:v,
        onClick:()=>setView(v),
        style:{
          padding:'4px 12px', fontSize:11, borderRadius:4, cursor:'pointer',
          border:`1px solid ${view===v ? T.gold : T.borderDim}`,
          background: view===v ? 'rgba(201,168,76,0.15)' : 'transparent',
          color: view===v ? T.goldBright : T.textDim,
        }
      }, v === 'normal' ? 'Normal' : 'DXP')),
      h('span', {
        title:'These are two separate lists, not one merged watchlist. The main (Normal) watchlist drives the daily-digest notification; the DXP list is pinned inside the Almanac and drives its own buy/sell/announce alerts. Kept separate so watching dozens of items broadly doesn\'t force all of them into DXP-specific alerts.',
        style:{cursor:'help', fontSize:11, color:T.textDim, border:`1px solid ${T.textDim}`, borderRadius:'50%', width:16, height:16, display:'inline-flex', alignItems:'center', justifyContent:'center'},
      }, '?'),
    ),
    !watched.length
      ? h('div',{className:'empty'},
          h('div',{className:'icon'},'★'),
          h('p',null, devMode && view === 'dxp' ? 'No items pinned to the DXP watchlist yet.' : 'Your watchlist is empty.'),
          h('div',{style:{fontSize:12,color:T.textDim,marginTop:8,lineHeight:1.7,maxWidth:340,textAlign:'center'}},
            devMode && view === 'dxp'
              ? h('span', null, 'Pin items from inside the Almanac\'s Confirmed/Negligible/Speculative/Recommendations tables.')
              : h('span', null,
                  'Browse any category tab and click the ★ on an item to add it here.',h('br',null),
                  'Watched items show live prices and signals all in one place.'
                )
          )
        )
      : h('div',{className:'offer-grid'},
    watched.map(it =>
      h('div',{key:it.id, className:'offer-slot', onClick:()=>onSelect(it)},
        h('div',{className:'offer-slot-name'},it.name),
        h('div',{className:'offer-slot-price'},fmt.gp(it.high||it.low)+'gp'),
        h('div',{className:'offer-slot-change '+pctClass(it.change_1d)},h(ChangeDisplay,{change_1d:it.change_1d,price:it.high||it.low})),
        h('div',{className:'offer-slot-star'},
          h('button',{
            className:'star-btn',
            onClick:e=>{e.stopPropagation(); activeToggle(it.id);}
          }, h('span',{className:'star-on'},'★'))
        ),
        it.signals&&it.signals.map(s=>h(SignalBadge,{key:s,signal:s,style:{marginTop:4,marginRight:2}}))
      )
    )
  ));
}

/* ─── SplitTab — tradeable items + untradeable sub-tab ───────── */
const COMBINATION_RECIPES = [
  {name:'Super melee potion',            ingredients:[{name:'Super defence (4)',qty:1},{name:'Super strength (4)',qty:1},{name:'Super attack (4)',qty:1}]},
  {name:'Super warmaster\'s potion',     ingredients:[{name:'Super ranging potion (4)',qty:1},{name:'Super magic potion (4)',qty:1},{name:'Super defence (4)',qty:1},{name:'Super strength (4)',qty:1},{name:'Super attack (4)',qty:1}]},
  {name:'Super prayer renewal potion',   ingredients:[{name:'Prayer renewal (4)',qty:1},{name:'Prayer potion (4)',qty:1}]},
  {name:'Grand attack potion',           ingredients:[{name:'Super attack (4)',qty:1},{name:'Attack potion (4)',qty:1}]},
  {name:'Grand strength potion',         ingredients:[{name:'Super strength (4)',qty:1},{name:'Strength potion (4)',qty:1}]},
  {name:'Grand defence potion',          ingredients:[{name:'Super defence (4)',qty:1},{name:'Defence potion (4)',qty:1}]},
  {name:'Grand ranging potion',          ingredients:[{name:'Super ranging potion (4)',qty:1},{name:'Ranging potion (4)',qty:1}]},
  {name:'Grand magic potion',            ingredients:[{name:'Super magic potion (4)',qty:1},{name:'Magic potion (4)',qty:1}]},
  {name:'Extreme brawler\'s potion',     ingredients:[{name:'Extreme attack (4)',qty:1},{name:'Extreme defence (4)',qty:1},{name:'Extreme strength (4)',qty:1}]},
  {name:'Extreme sharpshooter\'s potion',ingredients:[{name:'Extreme ranging (4)',qty:1},{name:'Extreme defence (4)',qty:1}]},
  {name:'Extreme battlemage\'s potion',  ingredients:[{name:'Extreme magic (4)',qty:1},{name:'Extreme defence (4)',qty:1}]},
  {name:'Extreme warmaster\'s potion',   ingredients:[{name:'Extreme attack (4)',qty:1},{name:'Extreme defence (4)',qty:1},{name:'Extreme strength (4)',qty:1},{name:'Extreme ranging (4)',qty:1},{name:'Extreme magic (4)',qty:1}]},
  {name:'Holy overload potion',          ingredients:[{name:'Overload (4)',qty:1},{name:'Prayer renewal (4)',qty:1}]},
  {name:'Searing overload potion',       ingredients:[{name:'Overload (4)',qty:1},{name:'Super antifire (4)',qty:1}]},
  {name:'Overload salve',                ingredients:[{name:'Overload (4)',qty:1},{name:'Super antifire (4)',qty:1},{name:'Antifire (4)',qty:1},{name:'Prayer renewal (4)',qty:1},{name:'Prayer potion (4)',qty:1},{name:'Super antipoison (4)',qty:1}]},
  {name:'Aggroverload',                  ingredients:[{name:'Overload (4)',qty:1},{name:'Aggression potion (4)',qty:1},{name:'Clean arbuck',qty:1}]},
  {name:'Holy aggroverload',             ingredients:[{name:'Overload (4)',qty:1},{name:'Aggression potion (4)',qty:1},{name:'Prayer renewal (4)',qty:1},{name:'Spider venom',qty:1}]},
  {name:'Supreme attack potion',         ingredients:[{name:'Extreme attack (4)',qty:1},{name:'Super attack (4)',qty:1}]},
  {name:'Supreme strength potion',       ingredients:[{name:'Extreme strength (4)',qty:1},{name:'Super strength (4)',qty:1}]},
  {name:'Supreme defence potion',        ingredients:[{name:'Extreme defence (4)',qty:1},{name:'Super defence (4)',qty:1}]},
  {name:'Supreme ranging potion',        ingredients:[{name:'Extreme ranging (4)',qty:1},{name:'Super ranging potion (4)',qty:1}]},
  {name:'Supreme magic potion',          ingredients:[{name:'Extreme magic (4)',qty:1},{name:'Super magic potion (4)',qty:1}]},
  {name:'Supreme overload potion',       ingredients:[{name:'Overload (4)',qty:1},{name:'Super attack (4)',qty:1},{name:'Super strength (4)',qty:1},{name:'Super defence (4)',qty:1},{name:'Super ranging potion (4)',qty:1},{name:'Super magic potion (4)',qty:1},{name:'Super necromancy (4)',qty:1}]},
  {name:'Supreme overload salve',        ingredients:[{name:'Supreme overload potion (6)',qty:1},{name:'Super antifire (4)',qty:1},{name:'Antifire (4)',qty:1},{name:'Prayer renewal (4)',qty:1},{name:'Prayer potion (4)',qty:1},{name:'Super antipoison (4)',qty:1}]},
  {name:'Elder overload potion',         ingredients:[{name:'Supreme overload potion (6)',qty:1},{name:'Primal extract',qty:1},{name:'Clean fellstalk',qty:1}]},
  {name:'Elder overload salve',          ingredients:[{name:'Elder overload potion (6)',qty:1},{name:'Prayer renewal (4)',qty:1},{name:'Prayer potion (4)',qty:1},{name:'Super antipoison (4)',qty:1},{name:'Antifire (4)',qty:1},{name:'Super antifire (4)',qty:1},{name:'Primal extract',qty:1},{name:'Clean fellstalk',qty:1}]},
  {name:'Replenishment potion',          ingredients:[{name:'Adrenaline potion (4)',qty:1},{name:'Super restore (4)',qty:1}]},
  {name:'Enhanced replenishment potion', ingredients:[{name:'Replenishment potion (6)',qty:1},{name:'Adrenaline crystal',qty:1}]},
  {name:'Wyrmfire potion',               ingredients:[{name:'Super antifire (4)',qty:1},{name:'Antifire (4)',qty:1}]},
  {name:'Brightfire potion',             ingredients:[{name:'Prayer renewal (4)',qty:1},{name:'Super antifire (4)',qty:1}]},
  {name:'Perfect plus potion',           ingredients:[{name:'Overload (4)',qty:1},{name:'Harmony moss',qty:1},{name:'Crystal tree blossom',qty:1}]},
  {name:'Spiritual prayer potion',       ingredients:[{name:'Primal extract',qty:1},{name:'Prayer potion (4)',qty:1},{name:'Summoning potion (4)',qty:1}]},
];

function RecipePane({allItems}) {
  const [expanded, setExpanded] = useState(null);

  const findItem = name => {
    const lower = name.toLowerCase();
    return allItems.find(it => it.name.toLowerCase() === lower);
  };

  const getPrice = name => {
    const it = findItem(name);
    if (!it) return null;
    return it.high || it.low || null;
  };

  const calcTotal = ingredients => {
    let total = 0;
    for (const ing of ingredients) {
      const p = getPrice(ing.name);
      if (p == null) return null;
      total += p * ing.qty;
    }
    return total;
  };

  return h('div', {style:{padding:'0 0 12px'}},
    COMBINATION_RECIPES.map(recipe => {
      const isOpen   = expanded === recipe.name;
      const total    = calcTotal(recipe.ingredients);
      const wikiItem = findItem(recipe.name);
      const wikiCost = wikiItem ? (wikiItem.high || wikiItem.low) : null;
      const doses    = recipe.name.match(/\((\d)\)/)?.[1] || 4;

      return h('div', {key:recipe.name, style:{borderBottom:`1px solid ${T.borderDim}`}},
        h('div', {
          style:{display:'flex', justifyContent:'space-between', alignItems:'center',
            padding:'10px 14px', cursor:'pointer', userSelect:'none'},
          onClick: () => setExpanded(isOpen ? null : recipe.name)
        },
          h('div', null,
            h('div', {style:{fontSize:13, color:T.textBright, fontWeight:600}}, recipe.name),
            total != null
              ? h('div', {style:{fontSize:11, color:T.textDim, marginTop:2}},
                  'Calculated cost: ',
                  h('span', {style:{color:T.gold}}, fmt.gp(total) + ' gp'))
              : h('div', {style:{fontSize:11, color:T.textDim, marginTop:2}}, 'Some prices unavailable')
          ),
          h('span', {style:{fontSize:11, color:T.textDim}}, isOpen ? '▼' : '▶')
        ),

        isOpen && h('div', {style:{padding:'0 14px 12px'}},
          h('div', {style:{fontSize:10, color:T.textDim, letterSpacing:'0.06em', marginBottom:8}}, 'INGREDIENTS'),
          recipe.ingredients.map(ing => {
            const price = getPrice(ing.name);
            const ingItem = findItem(ing.name);
            const isUntrade = ingItem?.untradeable;
            return h('div', {key:ing.name,
              style:{display:'flex', justifyContent:'space-between', alignItems:'center',
                padding:'5px 0', borderBottom:`1px solid ${T.borderDim}`, fontSize:12}},
              h('div', {style:{display:'flex', alignItems:'center', gap:6}},
                h('span', {style:{
                  fontSize:10, padding:'1px 5px', borderRadius:2,
                  background: isUntrade ? 'rgba(255,180,0,0.08)' : 'rgba(201,168,76,0.1)',
                  border: `1px solid ${isUntrade ? 'rgba(255,180,0,0.25)' : 'rgba(201,168,76,0.2)'}`,
                  color: isUntrade ? T.gold : T.textDim
                }}, isUntrade ? 'made' : 'GE'),
                h('span', {style:{color:T.text}}, ing.qty > 1 ? `${ing.qty}× ${ing.name}` : ing.name)
              ),
              h('span', {style:{color: price != null ? T.textBright : T.textDim}},
                price != null ? fmt.gp(price * ing.qty) + ' gp' : '—')
            );
          }),

          h('div', {style:{display:'flex', justifyContent:'space-between', padding:'8px 0 0',
            fontSize:13, fontWeight:600, color:T.gold}},
            h('span', null, 'Total'),
            h('span', null, total != null ? fmt.gp(total) + ' gp' : '—')
          ),

          (total != null || wikiCost != null) && h('div', {
            style:{display:'flex', gap:16, marginTop:8, paddingTop:8,
              borderTop:`1px solid ${T.borderDim}`, fontSize:11, color:T.textDim}},
            wikiCost && h('span', null, 'Wiki cost: ', h('span',{style:{color:T.textBright}}, fmt.gp(wikiCost)+'gp')),
            total != null && h('span', null, 'Per dose: ', h('span',{style:{color:T.textBright}}, fmt.gp(Math.round(total/doses))+'gp'))
          )
        )
      );
    })
  );
}

function SplitTab({items, selected, onSelect, watchlist, onToggleWatch, onToggleHide, onAddCompare, description, splitLabel}) {
  const [view, setView] = useState('items');
  const tradeableItems    = useMemo(() => (items||[]).filter(it => !it.untradeable), [items]);
  const untradeableItems  = useMemo(() => (items||[]).filter(it =>  it.untradeable), [items]);
  const displayItems = view === 'items' ? tradeableItems : untradeableItems;
  return h('div', null,
    description && h('div', {style:{padding:'8px 14px', borderBottom:`1px solid ${T.border}`, fontSize:12, color:T.textDim, fontStyle:'italic', lineHeight:1.5}}, description),
    untradeableItems.length > 0 && h('div', {style:{display:'flex', gap:6, padding:'8px 12px', borderBottom:`1px solid ${T.border}`}},
      h('button', {className: view==='items' ? 'ge-btn gold' : 'ge-btn', onClick:()=>setView('items')},
        `Items (${tradeableItems.length})`),
      h('button', {className: view==='split' ? 'ge-btn gold' : 'ge-btn', onClick:()=>setView('split')},
        `${splitLabel} (${untradeableItems.length})`)
    ),
    h(ItemTable, {items:displayItems, selected, onSelect, watchlist, onToggleWatch, onToggleHide, onAddCompare})
  );
}

/* ─── Market tab ─────────────────────────────────────────────── */
function MarketTab({items, selected, onSelect, description}) {
  const [filter, setFilter] = useState(null);
  const [sort, setSort] = useState({key:'name',dir:1});
  const tog = key => setSort(s=>({key,dir:s.key===key?-s.dir:1}));
  const arr = key => sort.key===key?(sort.dir>0?' ↑':' ↓'):'';
  const movers  = useMemo(()=>[...items].filter(it=>it.change_1d!=null).sort((a,b)=>Math.abs(b.change_1d||0)-Math.abs(a.change_1d||0)).slice(0,10),[items]);
  const volTop  = useMemo(()=>[...items].filter(it=>it.volume&&it.avgVolume&&it.volume>it.avgVolume*1.3).sort((a,b)=>(b.volume/b.avgVolume)-(a.volume/a.avgVolume)).slice(0,10),[items]);
  const rising  = useMemo(()=>items.filter(it=>(it.change_1d||0)>0),[items]);
  const falling = useMemo(()=>items.filter(it=>(it.change_1d||0)<0),[items]);
  // Exclude ALCH from Market signals — they have their own tab
  const MARKET_SIGNALS = ['SURGE','DUMP','ACCUMULATION','DISTRIBUTION','FRENZY','HIGH_VOL','ACTIVE','QUIET','THIN'];
  const signals = useMemo(()=>items.filter(it=>
    it.signals && it.signals.some(s => MARKET_SIGNALS.includes(s))
  ),[items]);
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
    description && h('div',{style:{padding:'8px 14px', borderBottom:`1px solid ${T.border}`, fontSize:12, color:T.textDim, fontStyle:'italic', lineHeight:1.5}}, description),
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
          h('tr',{key:it.id, style:{cursor:'pointer'}, className:selected?.id===it.id?'selected':'', onClick:()=>onSelect&&onSelect(it)},
            h('td',null,it.name),
            h('td',{style:{color:T.gold}},fmt.gp(it.high)+'gp'),
            h('td',null,h(ChangeDisplay,{change_1d:it.change_1d,price:it.high||it.low})),
            h('td',null,h(VolDisplay,{volume:it.volume,avgVolume:it.avgVolume})),
            filter==='signals'&&h('td',null,
              (it.signals||[])
                .filter(s => MARKET_SIGNALS.includes(s))
                .map(s=>h(SignalBadge,{key:s,signal:s,style:{marginRight:3}}))
            )
          )
        ))
      )
    ),
    !filteredItems && h('div',{className:'two-col'},
      h('div',null,
        h('div',{className:'ge-section-head'},'Top movers'),
        h('table',{className:'ge-table'},
          h('thead',null,h('tr',null,h('th',null,'Item'),h('th',null,'Change'),h('th',null,'Price'))),
          h('tbody',null,movers.length
            ? movers.map(it=>h('tr',{key:it.id,style:{cursor:'pointer'},className:selected?.id===it.id?'selected':'',onClick:()=>onSelect&&onSelect(it)},h('td',null,it.name),h('td',null,h(ChangeDisplay,{change_1d:it.change_1d,price:it.high||it.low})),h('td',{style:{color:T.gold}},fmt.gp(it.high||it.low)+'gp')))
            : h('tr',null,h('td',{colSpan:3,style:{color:T.textDim,textAlign:'center',padding:'12px'}},'No significant price movement detected.'))
          )
        )
      ),
      h('div',null,
        h('div',{className:'ge-section-head'},'Unusual volume'),
        h('div',{style:{fontSize:10,color:T.textDim,marginBottom:6}},'Items trading 30%+ above their average'),
        h('table',{className:'ge-table'},
          h('thead',null,h('tr',null,h('th',null,'Item'),h('th',null,'Vol / Avg'),h('th',null,'Price'))),
          h('tbody',null,volTop.length
            ? volTop.map(it=>h('tr',{key:it.id,style:{cursor:'pointer'},className:selected?.id===it.id?'selected':'',onClick:()=>onSelect&&onSelect(it)},
                h('td',null,it.name),
                h('td',null,h(VolDisplay,{volume:it.volume,avgVolume:it.avgVolume})),
                h('td',{style:{color:T.gold}},fmt.gp(it.high||it.low)+'gp')
              ))
            : h('tr',null,h('td',{colSpan:3,style:{color:T.textDim,textAlign:'center',padding:'12px'}},'No unusual volume detected.'))
          )
        )
      )
    )
  );
}

const APP_NEWS = [
  {
    version: 'Coming Soon',
    items: [
      'GEnius Almanac — track items that historically spike around seasonal events like DXP weekends; early buy signals ahead of the rush',
      'Portfolio Analytics — profit by category, value over time, win rate, hold time distribution, and best possible sale price within your hold window',
      'Advanced Alerts — signal-based triggers (e.g. alert when SURGE fires on a watchlist item), not just price thresholds',
      'Price Since Post — track how item prices move after RS3 news articles; see what the market actually reacted to',
      'Reopen Position — undo a sale on a closed position and put it back into open positions',
    ]
  },
  {
    version: 'v1.8.0',
    items: [
      'GEnius no longer bundles or requires Python! The entire backend (price fetching, signals, categorization, news, and more) has been rewritten in JavaScript. The installer is smaller, startup is cleaner, and the infamous AVG antivirus issue is officially dead. You can\'t quarantine a Python runtime that doesn\'t exist.',
      'Settings has been reorganized into clear sections: Display, Data & Fetching, Notifications, and Data Management. Every setting now saves instantly, so the "Save Settings" button has been promoted to unemployment.',
      'Sidebar Order now lives inside a collapsible section in Settings, along with a note explaining that rearranging it gives up the Combat / Skilling / Other grouping.',
      'Custom accent colors are here! Pick whatever highlight color you like, or click once to return to the classic GEnius gold.',
      'The High Value threshold now understands shorthand. Type things like 500m or 1b instead of counting zeros like it\'s 2007.',
      'Smithing, Crafting, Fletching, and Construction have been merged into a single Artisan tab, matching RuneScape\'s own skill grouping. Gathering already combines Mining, Woodcutting, Divination, and Hunter. Yes, I know Fishing is technically a gathering skill... but Fishing and Food have been inseparable since the beginning of time.',
      'The old Overrides/Titles tab has been renamed Cosmetics, and Misc is now consistently called Misc everywhere instead of occasionally pretending to be Materials.',
      'Cleaned up a bunch of category mistakes:',
      'Ore boxes and wood boxes now belong in Gathering.',
      'Ore boxes stopped insisting they were Smithing items too.',
      'Dragonhide, cowhide, and snake hide are no longer pretending to be gathering resources.',
      'Magic Frame and other "* frame" items now correctly appear under Artisan.',
      'Treasure Trails rewards such as Blessed dragonhide and Ring of Trees no longer wander into unrelated tabs.',
      'Category edits you make inside GEnius are now stored separately from the main catalogue, so your personal changes survive future updates instead of risking being overwritten.',
      'Fixed a bug where changing an item\'s category wouldn\'t actually take effect until restarting the app. Apparently GEnius needed a nap before accepting feedback.',
      'Removed the P2P badge from the item details panel. It wasn\'t useful, and honestly I have no idea why I added it in the first place.',
      'Signal badges (SURGE, ACCUMULATION, ACTIVE, and friends) now appear in the chart popup as well as the item details panel.',
      'Price history downloads now properly resume after restarting GEnius instead of occasionally giving up forever. While an item\'s history is still downloading, you\'ll see a note explaining that its average volume and daily change are still estimates.',
      'Fixed the history-loading popup reporting percentages that didn\'t agree with its own numbers. The math and the progress bar are finally on speaking terms again.',
      'Fixed a rare but nasty bug where a brief network hiccup during a price update could wipe the entire item catalogue instead of simply skipping that fetch. That was... less than ideal.',
      'GEnius now only allows one instance to run at a time. Running two copies could cause them to overwrite each other\'s data, and they clearly weren\'t very good roommates.',
    ]
  },
  {
    version: 'v1.7.1',
    items: [
      'Watchlist daily digest — optional once-a-day desktop notification listing any watchlist item that moved past a threshold you set, even with GEnius minimized to the tray. Configure in Settings',
      'Reminders — new section in the Alerts tab for plain date-triggered reminders ("remind me to buy X on this date"), separate from price alerts, with an optional item link',
      'Adding a position to Portfolio now automatically adds that item to your Watchlist if it isn\'t already on there',
    ]
  },
  {
    version: 'v1.7.0',
    items: [
      'New app icon and logo',
      'Item thumbnails — small item icons now show next to names across every table and listing in the app, not just the item detail panel. Toggleable on/off from Settings',
      'Discord link added to Settings — join the community',
      'Fixed white screen on launch — the app now shows the splash screen immediately instead of a brief white flash before it loads',
      'Troubleshooting section in Settings — checks whether the bundled Python runtime is present and walks through the fix if your antivirus quarantined it (a known false positive with AVG specifically)',
      'Same Troubleshooting guidance added to the GitHub README for anyone who can\'t get the app running well enough to reach Settings',
    ]
  },
  {
    version: 'v1.6.0',
    items: [
      'UI Scale setting — resize the entire app interface from 80% to 150%',
      'Resizable item detail panel — drag the handle on its left edge',
      'Resizable table columns — drag column header edges to adjust width',
      'Signal history — each Dashboard signal now shows a 7-day trend, hover for daily breakdown',
      'Today / Last 7 Days toggle on signal drill-down pages — see everything that triggered a signal this week, not just today',
      'Brief description added to every signal drill-down page',
      'Fixed MANIPULATED signal — was defined in the UI but never actually computed; now properly flags extreme volume + large price move + tiny buy limit',
      'New shorthands — ECB and a batch of Greater/lesser ability codexes (Gconc, Grico, Gsun, Gswift, IOH/IOTH, GFury, gbarge, gflurry, gchain, croar, gsonic)',
      'ZGS now suggests both Zamorak godsword and Zaros godsword instead of only one',
      'Shorthand item name field now validates against real items live, with a dropdown of matches as you type',
      'Backspace now closes the item detail panel and backs out of Dashboard drill-down views',
      'Quit button added to the header — closing the window still minimizes to tray, this fully exits',
    ]
  },
  {
    version: 'v1.5.0',
    items: [
      'Candlestick chart view with 7d / 30d / 90d / 1Y / All time ranges',
      'Volume chart with current volume and 90-day average line; Y-axis labels added',
      'Portfolio investor tier badges — current tier, next goal, and all earned tiers',
      'Portfolio achievement badges — Trades Closed, Profit Made, and more',
      'Right-click a closed position to delete it',
      'Date Opened field with calendar picker on the position modal',
      'Held duration column on the open positions table',
      'Clicking an item name in the portfolio now opens the item panel',
      'Click an already-open item to close the panel (toggle)',
      'Dashboard news section — recent RS3 update articles with mentioned and likely affected items',
      'Collapsible news section and per-article expand/collapse rows',
      'Item tags in news articles are clickable to open the item panel directly',
      'Likely affected items based on update type — still in testing, not perfect',
      'News snapshot price tracking — item prices are recorded at time of article for future comparison',
      'Switched to RS3 official RSS feed as sole news source',
      'In-app update alert — GEnius notifies you when a new version is available',
    ]
  },
  {
    version: 'v1.4.1 — Security Patch',
    items: [
      'Shell injection fix — Python is now invoked with execFile() instead of a string command',
      'Renderer sandbox — removed an unnecessary sandbox: false override in the browser window config',
      'External URL validation — open-external now rejects non-http(s) URLs',
      'Import allowlist — data import now only applies known-safe settings keys',
      'Atomic file writes — history and snapshot files now write via temp file + rename, preventing corruption on interrupted writes',
    ]
  },
  {
    version: 'v1.4.0',
    items: [
      'All Time chart view — full price history with scroll-wheel zoom and date range filter',
      'Seasonal chart — average price patterns by week or month across historical data, with a NOW indicator',
      'Charts now match the Wiki — switched to a data source with no lag',
      'Price in Big Macs — shows item value in Big Macs using the live bond price; hover for methodology',
      'Market Personality — flavor description generated from signals, category, and trading behavior',
      '7d/30d/90d trend badges fixed — were silently broken due to stale data',
      'Opportunity Score breakdown — click ▾ next to any score to see what contributed; score now displays as X/100',
      'Market Indexes are now clickable — drill down to see all constituent items',
      'Mood of the Market — emoji card summarizing current market conditions, hover for explanation',
      'Item of the Day — a different item every day, click to open it',
      'Random item button — 🎲 feeling lucky?',
      'New MANIPULATED signal — fires on extreme volume, large price move, and tiny buy limit simultaneously',
      'Export and import your data — back up watchlist, portfolio, alerts, and notes; restore on any machine',
      'Parchment theme removed. Your retinas are safe now.',
    ]
  },
  {
    version: 'v1.3.0',
    items: [
      'Fixed crash that blanked the entire app when opening Watchlist, Settings, or other tabs',
      'Compare tab — side-by-side price and stat comparison for multiple items',
      'RS3 News feed — live news from the official RuneScape RSS feed',
      'Item notes — write and save freeform notes on any item from its detail panel',
      'Combination recipe panel — live ingredient cost breakdown for combination potions',
      'Category editor — reassign any item\'s category directly from its detail panel',
      'Dashboard personal sections — Watchlist Movers, Portfolio P&L, Triggered Alerts',
      'Alerts moved up in the sidebar to sit below Portfolio',
      'Press S or / anywhere to instantly focus the search bar',
      'Items under 900gp excluded from all signals — reduces noise',
      'Empty state hints on Watchlist, Alerts, and Portfolio for new users',
    ]
  },
  {
    version: 'v1.2.0',
    items: [
      'Dashboard tab — market indexes, pulse stats, top movers, volume anomalies',
      'Invention components sub-tab — all 86 components with production cost and rarity',
      'Combination Potions sub-tab — 23 untradeable combo potions with production costs',
      'Untradeable item badge in detail panel; hides irrelevant fields for untradeable items',
      'Treasure Trails items now dual-listed in their combat/skill tab and the TT tab',
      'Renamed Overrides/Titles to Cosmetics/Titles',
      'Corrected Anima Core of Zamorak (ranged), Anima Core of Zaros (melee)',
      'Corrected Divine/Elysian spirit shield categories',
      'Tab descriptions added across all tabs',
      'Numerous item category fixes and overrides',
    ]
  },
  {
    version: 'v1.1.0',
    items: [
      'Portfolio tab — track GE positions, profit/loss, tax statistics',
      'High Value tab — configurable threshold for expensive item filtering',
      'Price alerts with optional Discord webhook integration',
      'Global search bar across all items',
      'Hidden items — hide items you never want to see, manage in Settings',
      'Volume EMA smoothing and history-based price change tracking',
      'Market signals engine (SURGE, DUMP, ACCUMULATION, DISTRIBUTION, FRENZY, etc.)',
    ]
  },
  {
    version: 'v1.0.0',
    items: [
      'Initial release',
      'Live GE price data via WeirdGloop GazBot',
      'Category tabs for all combat styles, skills, and item types',
      'Watchlist, Market, Opportunities, Alch tabs',
      'RS game news feed',
      'Dark theme runescape-inspired UI',
    ]
  },
];

function NewsTab({news, onOpen, description, items, onSelect}) {
  const [sub, setSub] = useState('rs3');
  return h('div',null,
    h('div',{style:{display:'flex', justifyContent:'center', padding:'16px 0 4px'}},
      h('img',{src:'../assets/logo-full.png', alt:'GEnius', style:{width:200, maxWidth:'70%'}}),
    ),
    description && h('div',{style:{padding:'8px 14px', borderBottom:`1px solid ${T.border}`, fontSize:12, color:T.textDim, fontStyle:'italic', lineHeight:1.5}}, description),

    // Sub-tab pills
    h('div',{style:{display:'flex', gap:8, padding:'10px 14px', borderBottom:`1px solid ${T.border}`}},
      h('button',{
        onClick:()=>setSub('rs3'),
        style:{padding:'5px 14px', fontSize:12, fontWeight:'bold', letterSpacing:'0.05em',
          background: sub==='rs3' ? T.gold : 'transparent',
          color: sub==='rs3' ? '#1a1208' : T.textDim,
          border:`1px solid ${sub==='rs3' ? T.gold : T.border}`,
          borderRadius:3, cursor:'pointer'}
      }, `RS3 News${news&&news.length ? ` (${news.length})` : ''}`),
      h('button',{
        onClick:()=>setSub('app'),
        style:{padding:'5px 14px', fontSize:12, fontWeight:'bold', letterSpacing:'0.05em',
          background: sub==='app' ? T.gold : 'transparent',
          color: sub==='app' ? '#1a1208' : T.textDim,
          border:`1px solid ${sub==='app' ? T.gold : T.border}`,
          borderRadius:3, cursor:'pointer'}
      }, `App Updates (${APP_NEWS.length})`)
    ),

    // RS3 News pane
    sub==='rs3' && h('div',{style:{padding:'0 14px'}},
      (!news||!news.length)
        ? h('div',{className:'empty-state'},
            h('div',{style:{fontSize:32, marginBottom:8}}, '📰'),
            h('div',null,'No RS news loaded yet.'),
            h('div',{style:{fontSize:11, color:T.textDim, marginTop:4}}, 'Fetch Now to load.')
          )
        : news.map((n,i)=>h('div',{key:i,className:'news-item'},
            h('div',{className:'row',style:{gap:6,marginBottom:2}},
              h('span',{className:'news-src'},n.source),
              h('span',{style:{fontSize:10,color:T.textDim}},n.date),
              n.update_type && h('span',{style:{
                fontSize:9, padding:'1px 6px', borderRadius:2, marginLeft:4,
                background:'rgba(201,168,76,0.15)', border:`1px solid rgba(201,168,76,0.3)`,
                color:T.gold, letterSpacing:'0.05em', textTransform:'uppercase',
              }}, n.update_type),
            ),
            h('div',{className:'news-title',onClick:()=>n.url&&onOpen(n.url)},n.title),
            n.description && h('div',{style:{fontSize:11,color:T.textDim,marginTop:2,lineHeight:1.5}},n.description),
            n.mentions&&n.mentions.length>0&&h('div',{style:{marginTop:5}},
              h('div',{style:{fontSize:9,color:T.textDim,textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:3}}, 'Items mentioned'),
              h('div',{style:{display:'flex',flexWrap:'wrap',gap:4}},
                n.mentions.map(m => {
                  const item = items && items.find(it => it.name.toLowerCase() === m.toLowerCase());
                  return h('span',{
                    key:m, className:'news-tag',
                    onClick: item && onSelect ? ()=>onSelect(item) : undefined,
                    style:{cursor: item ? 'pointer' : 'default', color: item ? T.gold : T.textDim},
                    title: item ? `Click to view ${m}` : m,
                  }, m);
                })
              )
            ),
            n.price_since&&n.price_since.length>0&&h('div',{style:{marginTop:6}},
              h('div',{style:{fontSize:9,color:T.textDim,textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:3}},
                `Price since post · ${n.price_since_days||''}d later`
              ),
              h('div',{style:{display:'flex',flexWrap:'wrap',gap:4}},
                n.price_since.map(m => {
                  const it = items && items.find(i => i.name.toLowerCase()===m.name.toLowerCase());
                  const chgColor = m.pct > 0 ? T.green : m.pct < 0 ? T.red : T.textDim;
                  return h('span',{
                    key:m.name, className:'news-tag',
                    onClick: it && onSelect ? ()=>onSelect(it) : undefined,
                    style:{cursor:it?'pointer':'default', display:'flex', alignItems:'center', gap:4},
                  },
                    h('span',{style:{color:T.text}},m.name),
                    h('span',{style:{color:chgColor}},(m.pct>0?'+':'')+m.pct+'%'),
                  );
                })
              )
            ),

            n.impact_items&&n.impact_items.length>0&&h('div',{style:{marginTop:6}},
              h('div',{style:{fontSize:9,color:T.textDim,textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:3}},
                'Market reaction · ' + (n.impact_categories||[]).join(', ')
              ),
              h('div',{style:{display:'flex',flexWrap:'wrap',gap:4}},
                n.impact_items.map(m => {
                  const item = items && items.find(it => it.name.toLowerCase() === m.name.toLowerCase());
                  const chg = m.change_1d;
                  const chgColor = chg > 0 ? T.green : chg < 0 ? T.red : T.textDim;
                  return h('span',{
                    key:m.name, className:'news-tag',
                    onClick: item && onSelect ? ()=>onSelect(item) : undefined,
                    style:{cursor: item ? 'pointer' : 'default', display:'flex', alignItems:'center', gap:4},
                    title: item ? `Click to view ${m.name}` : m.name,
                  },
                    h('span',{style:{color:T.text}}, m.name),
                    chg != null && h('span',{style:{color:chgColor}}, (chg>0?'+':'')+chg.toFixed(1)+'%'),
                    (m.signals||[]).map(s=>h('span',{key:s,style:{color:T.gold,fontSize:9}},s))
                  );
                })
              )
            )
          ))
    ),

    // App Updates pane
    sub==='app' && h('div',{style:{padding:'0 14px 12px'}},
      APP_NEWS.map(section => h('div',{key:section.version, style:{marginBottom:14, paddingTop:12}},
        h('div',{style:{fontSize:11, fontWeight:'bold', color:T.textBright, marginBottom:6,
          paddingBottom:3, borderBottom:`1px solid ${T.borderDim}`}}, section.version),
        h('ul',{style:{listStyle:'none', margin:0, padding:0}},
          section.items.map((item,i) => h('li',{key:i, style:{
            fontSize:12, color:T.text, padding:'2px 0 2px 12px',
            position:'relative', lineHeight:1.5
          }},
            h('span',{style:{position:'absolute',left:0,color:T.textDim}}, '·'),
            item
          ))
        )
      ))
    )
  );
}

const ALERT_CONDITIONS = [
  {value:'above',      label:'Price rises above'},
  {value:'below',      label:'Price falls below'},
  {value:'pct_up',     label:'Price change % rises above'},
  {value:'pct_down',   label:'Price change % falls below'},
  {value:'signal',     label:'Signal triggers'},
  {value:'alch',       label:'Becomes alch-profitable'},
];
const ALERT_SIGNALS = ['SURGE','DUMP','ACCUMULATION','DISTRIBUTION','FRENZY','HIGH_VOL'];

function alertSummary(a) {
  switch(a.condition) {
    case 'above':    return `price > ${fmt.gp(a.price)}gp`;
    case 'below':    return `price < ${fmt.gp(a.price)}gp`;
    case 'pct_up':   return `change > +${a.pct}%`;
    case 'pct_down': return `change < -${a.pct}%`;
    case 'signal':   return `signal: ${a.signal_type||''}`;
    case 'alch':     return 'alch profit';
    default:         return a.condition;
  }
}

function AlertsTab({items, alerts, onSave, onDelete, toast, description, reminders, onSaveReminder, onDeleteReminder}) {
  const BLANK = {item_name:'', condition:'above', price:'', pct:'', signal_type:'SURGE'};
  const [form, setForm] = useState(BLANK);
  const [editId, setEditId] = useState(null);
  const set = k => e => setForm(f=>({...f,[k]:e.target.value}));

  const REM_BLANK = {item_name:'', due_date:'', message:''};
  const [remForm, setRemForm] = useState(REM_BLANK);
  const [remEditId, setRemEditId] = useState(null);
  const setRem = k => e => setRemForm(f=>({...f,[k]:e.target.value}));

  const submitReminder = async () => {
    if (!remForm.due_date) { toast('Pick a date','error'); return; }
    if (!remForm.message)  { toast('Enter a reminder message','error'); return; }
    const r = {
      id: remEditId || Date.now().toString(),
      itemName: remForm.item_name,
      dueDate: remForm.due_date,
      message: remForm.message,
      fired: false,
    };
    await window.genius?.saveReminder(r);
    onSaveReminder(r);
    setRemForm(REM_BLANK);
    setRemEditId(null);
    toast('Reminder saved','success');
  };
  const startEditReminder = r => {
    setRemEditId(r.id);
    setRemForm({item_name:r.itemName||'', due_date:r.dueDate||'', message:r.message||''});
  };
  const cancelEditReminder = () => { setRemEditId(null); setRemForm(REM_BLANK); };

  const needsPrice  = ['above','below'].includes(form.condition);
  const needsPct    = ['pct_up','pct_down'].includes(form.condition);
  const needsSignal = form.condition === 'signal';

  const submit = async () => {
    if (!form.item_name) { toast('Enter an item name','error'); return; }
    if (needsPrice  && !form.price)  { toast('Enter a price','error'); return; }
    if (needsPct    && !form.pct)    { toast('Enter a % value','error'); return; }
    if (needsSignal && !form.signal_type) { toast('Choose a signal','error'); return; }
    const a = {
      ...form,
      id: editId || Date.now().toString(),
      price:  needsPrice  ? Number(form.price) : 0,
      pct:    needsPct    ? Number(form.pct)   : 0,
    };
    await window.genius?.saveAlert(a);
    onSave(a);
    setForm(BLANK);
    setEditId(null);
    toast('Alert saved','success');
  };

  const startEdit = a => {
    setEditId(a.id);
    setForm({...BLANK, ...a, price: a.price||'', pct: a.pct||''});
  };
  const cancelEdit = () => { setEditId(null); setForm(BLANK); };

  return h('div',null,
    description && h('div',{style:{padding:'8px 14px', borderBottom:`1px solid ${T.border}`, fontSize:12, color:T.textDim, fontStyle:'italic', lineHeight:1.5}}, description),
    h('div',{className:'two-col'},
      h('div',null,
        h('div',{className:'ge-section-head'}, editId ? 'Edit alert' : 'New alert'),
        h('div',{style:{display:'flex',flexDirection:'column',gap:10}},
          h('div',null,
            h('label',{className:'form-lbl'},'Item name'),
            h(ItemAutocomplete,{items, value:form.item_name, onChange:name=>setForm(f=>({...f,item_name:name})), placeholder:'Search item...'})
          ),
          h('div',null,
            h('label',{className:'form-lbl'},'Condition'),
            h('select',{className:'ge-input',value:form.condition,onChange:set('condition')},
              ALERT_CONDITIONS.map(c => h('option',{key:c.value,value:c.value},c.label))
            )
          ),
          needsPrice && h('div',null,
            h('label',{className:'form-lbl'},'Price threshold'),
            h(GpInput,{value:form.price, placeholder:'e.g. 500m', onChange:v=>setForm(f=>({...f,price:v}))})
          ),
          needsPct && h('div',null,
            h('label',{className:'form-lbl'},'% threshold'),
            h('div',{style:{display:'flex',alignItems:'center',gap:6}},
              h('input',{className:'ge-input',type:'number',min:0,step:0.1,value:form.pct,
                onChange:set('pct'),placeholder:'e.g. 5', style:{width:80}}),
              h('span',{style:{color:T.textDim,fontSize:12}},'%')
            )
          ),
          needsSignal && h('div',null,
            h('label',{className:'form-lbl'},'Signal type'),
            h('select',{className:'ge-input',value:form.signal_type,onChange:set('signal_type')},
              ALERT_SIGNALS.map(s => h('option',{key:s,value:s},s))
            )
          ),
          form.condition === 'alch' && h('div',{style:{fontSize:11,color:T.textDim,fontStyle:'italic'}},
            'Triggers when alch value beats GE sell price after tax + nature rune cost.'
          ),
          h('div',{className:'row'},
            h('button',{className:'ge-btn gold',onClick:submit}, editId?'Update':'Add alert'),
            editId && h('button',{className:'ge-btn',onClick:cancelEdit},'Cancel')
          )
        )
      ),
      h('div',null,
        h('div',{className:'ge-section-head'},`Active alerts (${alerts.length})`),
        !alerts.length
          ? h('div',{className:'empty',style:{padding:'20px 0'}},
              h('div',{className:'icon'},'◉'),
              h('p',null,'No alerts set yet.'),
              h('div',{style:{fontSize:12,color:T.textDim,marginTop:6,lineHeight:1.7,maxWidth:280,textAlign:'center'}},
                'Use the form on the left to set a price, % change, or signal alert on any item.',h('br',null),
                'Alerts can optionally ping a Discord webhook when they trigger.'
              )
            )
          : alerts.map(a => h('div',{key:a.id,className:'alert-row'},
              h('span',{style:{flex:1,color:T.text,fontSize:12}},a.item_name),
              h('span',{className:'alert-cond',style:{
                fontSize:10, padding:'1px 6px', borderRadius:3, whiteSpace:'nowrap',
                background:'rgba(201,168,76,0.1)', border:`1px solid ${T.borderDim}`, color:T.textDim
              }}, alertSummary(a)),
              h('button',{className:'ge-btn',style:{padding:'2px 8px',fontSize:11},onClick:()=>startEdit(a)},'Edit'),
              h('button',{className:'ge-btn danger',style:{padding:'2px 8px',fontSize:11},
                onClick:async()=>{await window.genius?.deleteAlert(a.id);onDelete(a.id);toast('Deleted','info')}},'Del')
            ))
      )
    ),
    h('div',{style:{marginTop:24, paddingTop:18, borderTop:`1px solid ${T.border}`}},
      h('div',{className:'two-col'},
        h('div',null,
          h('div',{className:'ge-section-head'}, remEditId ? 'Edit reminder' : 'New reminder'),
          h('div',{style:{fontSize:11, color:T.textDim, fontStyle:'italic', marginBottom:10}},
            'Plain date-triggered reminders — no price involved, just "remind me on this date." Fires once via desktop notification (works even minimized to the tray), then it\'s done.'
          ),
          h('div',{style:{display:'flex',flexDirection:'column',gap:10}},
            h('div',null,
              h('label',{className:'form-lbl'},'Item (optional)'),
              h(ItemAutocomplete,{items, value:remForm.item_name, onChange:name=>setRemForm(f=>({...f,item_name:name})), placeholder:'Search item... (optional)'})
            ),
            h('div',null,
              h('label',{className:'form-lbl'},'Due date'),
              h('input',{className:'ge-input', type:'date', value:remForm.due_date, onChange:setRem('due_date')})
            ),
            h('div',null,
              h('label',{className:'form-lbl'},'Message'),
              h('textarea',{className:'ge-input', rows:2, value:remForm.message, onChange:setRem('message'), placeholder:'e.g. Buy Shard of Genesis Essence — tail end of Autumn before the Winter boss'})
            ),
            h('div',{className:'row'},
              h('button',{className:'ge-btn gold',onClick:submitReminder}, remEditId?'Update':'Add reminder'),
              remEditId && h('button',{className:'ge-btn',onClick:cancelEditReminder},'Cancel')
            )
          )
        ),
        h('div',null,
          h('div',{className:'ge-section-head'},`Reminders (${reminders.length})`),
          !reminders.length
            ? h('div',{className:'empty',style:{padding:'20px 0'}},
                h('div',{className:'icon'},'◷'),
                h('p',null,'No reminders set yet.'),
              )
            : reminders.slice().sort((a,b)=>(a.dueDate||'').localeCompare(b.dueDate||'')).map(r => h('div',{key:r.id,className:'alert-row'},
                h('span',{style:{flex:1,color:T.text,fontSize:12}},
                  r.itemName ? `${r.itemName} — ${r.message}` : r.message
                ),
                h('span',{className:'alert-cond',style:{
                  fontSize:10, padding:'1px 6px', borderRadius:3, whiteSpace:'nowrap',
                  background: r.fired ? 'rgba(76,175,80,0.1)' : 'rgba(201,168,76,0.1)',
                  border:`1px solid ${T.borderDim}`, color: r.fired ? T.green : T.textDim,
                }}, r.fired ? `Fired ${r.dueDate}` : `Due ${r.dueDate}`),
                h('button',{className:'ge-btn',style:{padding:'2px 8px',fontSize:11},onClick:()=>startEditReminder(r)},'Edit'),
                h('button',{className:'ge-btn danger',style:{padding:'2px 8px',fontSize:11},
                  onClick:async()=>{await window.genius?.deleteReminder(r.id);onDeleteReminder(r.id);toast('Deleted','info')}},'Del')
              ))
        )
      )
    )
  );
}

/* ─── GEnius Almanac — Event Intelligence, DXP is the first event type covered (hidden, dev-mode only) ─ */
// Items explicitly named in DXP_DEBUNKED_THEORIES below as confirmed noise
// — hard-excluded from Confirmed/Negligible/Speculative/Recommendations
// regardless of which specific phase happens to clear the volume floor.
// Ben caught "Logs" still surfacing in Recommendations via a different
// phase than the one flagged as noise — the per-phase volume check alone
// wasn't enough once an item has ANY phase that narrowly clears 0.5x, so
// this is a second, simpler filter: if we've told users in Debunked
// Theories that an item is noise, it should never show up as a live
// recommendation no matter which phase technically passes.
const DXP_DEBUNKED_EXACT_NAMES = new Set([
  'logs', 'oak logs', 'magic logs', 'yew logs', 'adamant bar', 'chaos rune',
  'cadmium red', 'soapstone', 'ruby', 'xp capacitor 5000 (charged)',
]);
function isDebunkedDxpItem(name) {
  const n = (name || '').toLowerCase();
  return DXP_DEBUNKED_EXACT_NAMES.has(n) || n.includes('wood spirit');
}

const ALMANAC_PHASES = [
  {key:'pre_announce', label:'Pre-Announcement'},
  {key:'anticipation', label:'Post-Announcement'},
  {key:'early_event',  label:'First 5 Days'},
  {key:'late_event',   label:'Last 5 Days'},
  {key:'post_event',   label:'Post-Event'},
];

const ALMANAC_CONFIDENCE_THRESHOLD = 0.7; // 7/10 or higher = Confirmed, below = Speculative

// Confidence (direction consistency) and margin (how much it actually moves)
// are deliberately kept as separate axes, not blended into one score — a low
// score can mean "inconsistent" or "consistent but tiny," and those need
// different responses from the user. An item can be highly confident AND
// have a margin too small to bother with once GE tax eats into it (e.g. the
// Summoning pouches in the Debunked Theories section — 8/10 confidence, but
// only a 2-5% median move). NEGLIGIBLE_NET_PROFIT_PCT is checked against the
// actual net-of-tax round-trip from buildTradeIdea() when timing data exists;
// NEGLIGIBLE_MEDIAN_PCT is the fallback gross-magnitude bar for phase-only
// rows that don't have a full buy/sell timing pair to compute tax against.
const NEGLIGIBLE_NET_PROFIT_PCT = 2;
const NEGLIGIBLE_MEDIAN_PCT = 3;
// Absolute floor, separate from the percentage check above — a high %
// return on a tiny buy-limit item still nets a trivial total profit (Ben:
// "why are we showing items with a profit per buy limit as low as 27k?").
// Below this, treat as negligible regardless of how clean the % looks.
const NEGLIGIBLE_PROFIT_FOR_LIMIT_GP = 100000;
// Per-item explanation of WHICH negligible threshold an item actually
// failed — the tier-level blurb explains the bar in general, but doesn't
// say which specific reason applies to a given item, and an item can fail
// more than one at once.
function negligibleReason(trade, medianPct) {
  if (!trade) {
    return `Only ${Math.abs(medianPct).toFixed(2)}% gross movement — under the ${NEGLIGIBLE_MEDIAN_PCT}% bar used when there's no full buy/sell timing pair to compute real profit against.`;
  }
  const reasons = [];
  if (trade.netProfitPct < NEGLIGIBLE_NET_PROFIT_PCT) {
    reasons.push(`only ${trade.netProfitPct.toFixed(2)}% net profit per item after tax (needs ${NEGLIGIBLE_NET_PROFIT_PCT}%+)`);
  }
  if (trade.profitForLimit != null && trade.profitForLimit < NEGLIGIBLE_PROFIT_FOR_LIMIT_GP) {
    reasons.push(`only ${fmt.gp(trade.profitForLimit)}gp total profit even buying the full GE limit (needs ${fmt.gp(NEGLIGIBLE_PROFIT_FOR_LIMIT_GP)}gp+)`);
  }
  return reasons.length ? `Negligible because ${reasons.join('; and ')}.` : null;
}
// RS3 Grand Exchange offer slots (6 base + 2 from Premier Club) — the
// Recommendations engine targets filling this many slots rather than
// dumping the whole budget into whichever single item has the best %.
const GE_SLOTS = 8;

// Curated from research/dxp_findings_v2.md — popular DXP theories that
// looked promising at first pass but didn't hold up once checked for
// consistency, magnitude, AND real trading volume. Static write-up, not
// computed from live data, since this is about documenting what we tested
// and ruled out, not a live signal.
const DXP_DEBUNKED_THEORIES = [
  {
    title: 'Burial set destruction',
    belief: 'Players buy burial-style armour sets to destroy for DXP, pumping their price.',
    reality: 'Flat — no signal at all — for every tier 0 through +4, every metal, bundled or individual pieces. The ONE real exception: Elder rune +5 individual pieces specifically (not the bundled set, not other metals, not lower tiers) show a genuine buy-up-then-dump cycle on real volume (1.0-1.8x baseline). Checking only the bundled set item was masking the real behavior happening in its individual pieces — a good lesson that composite GE items don\'t always reflect what\'s happening with their components.',
    verdict: 'Partially true, much narrower than believed',
  },
  {
    title: 'Summoning pouch spam-training',
    belief: 'Players stock up Summoning pouches to mass-train during DXP, and the generic creation materials (charms, scrolls) drive the price action.',
    reality: 'Mixed, and more layered than either the believers or the original "it\'s all noise" correction assumed. Triple-checked against the live 11-event dataset (2026-06-24): Geyser titan, Lava titan, Bunyip, and Spirit wolf pouches all show real, consistent, volume-backed direction signals (8/10, 8/10, 8/11, and 7/10 respectively, all on real volume up to 15x baseline) — these specific high-tier combat pouches are genuinely DXP-sensitive. But the magnitude is modest: all four land in a -2% to -5% median range, nowhere near the dataset\'s headline movers (Vulnerability bomb -14.5%) — a real, repeatable small bonus, not a "buy a stack and retire" opportunity. The generic creation materials people assume drive the price (charms, scrolls) show no signal of their own — the real bottleneck is the per-creature TERTIARY ingredient each pouch needs (e.g. Water talisman for Geyser titan — a perfect 10/10 anticipation rise and 10/10 post-event drop, the cleanest signal in the whole dataset).',
    verdict: 'Real, but small — several pouches ARE genuine signals, just modest ones',
  },
  {
    title: 'Chaos rune / Runecrafting',
    belief: 'Chaos rune looked like the best Runecrafting DXP signal in early passes (rise 7/10 early in the event, drop 8/10 after).',
    reality: 'Volume check killed it: only 0.16-0.32x of baseline volume across every phase — the price moves aren\'t backed by real trading, just noise on a thin market. After this correction, Runecrafting has no confirmed DXP signal in any rune or essence tested.',
    verdict: 'Debunked — looked clean, wasn\'t real',
  },
  {
    title: 'Basic logs and Adamant bar',
    belief: 'Logs, Oak logs, Magic logs, Yew logs, and Adamant bar looked consistent enough (70%+ direction agreement) to pass the confidence bar.',
    reality: 'Volume ratios crash to 0.01-0.2x of baseline on every one of them. These are bulk-traded, near-worthless commodities — at that volume and price point, background market noise alone is enough to produce a fluky 70%+ direction match across 10 cycles by chance. Nobody is buying basic logs because of DXP.',
    verdict: 'Debunked — statistical flukes from bulk junk items',
  },
  {
    title: 'Wood spirits',
    belief: 'Wood spirits (all tiers) show strong, consistent rises across multiple DXP phases.',
    reality: 'True that they rise — but they never show a corresponding drop to complete the cycle, the way every other real signal does (Vulnerability bomb, Dragonstone, Water talisman, etc. all rise then correct). Wood spirits just keep climbing regardless of phase, which looks much more like a secular adoption trend — a newer item category gradually getting more popular over time — than anything DXP actually causes.',
    verdict: 'Real price trend, wrong cause',
  },
  {
    title: 'XP Capacitor 5000',
    belief: 'The obvious DXP-banking play — store double-value XP during the event, redeem it later — should show up as a clear buy-ahead signal.',
    reality: 'Anticipation-window swings range from -7.8% to +18.2% across different cycles with no consistent direction at all. Likely too high-priced (2.6M-4.3M gp) and thin-volume for broad DXP demand to outweigh the noise of a handful of large individual trades.',
    verdict: 'Plausible in theory, absent in the data',
  },
  {
    title: 'Cadmium red, Soapstone, Ruby (cut)',
    belief: 'Early checkpoint sampling showed promising rise/drop patterns for these items.',
    reality: 'Pulling the FULL continuous price trajectory (not just the 5 checkpoint snapshots) across sample cycles showed no repeatable shape at all — sometimes the price ends near a peak, sometimes near a trough, with no consistency. The original "signal" was a checkpoint-sampling artifact: catching a narrow window in a favorable spot by chance a few times in a row, not a real repeatable pattern.',
    verdict: 'Debunked — a sampling artifact, not a real pattern',
  },
];

// Combines the buy-day and sell-day timing data into one "trade idea" —
// the actual point of this research is finding where the bottom and top are,
// not reporting a hypothetical loss on a buy-limit's worth of units.
// Profit is computed NET of GE tax (applyTax, defined above) — this was
// missing entirely until Ben caught it 2026-06-24; the raw sell-buy
// difference overstates every single trade idea in this tab by ~2%.
function buildTradeIdea(timing, price, limit) {
  if (!timing || !price) return null;
  const buyDay = timing.best_buy_day_offset, sellDay = timing.best_sell_day_offset;
  const buyPct = timing.best_buy_pct_median, sellPct = timing.best_sell_pct_median;
  if (buyDay == null || sellDay == null || buyPct == null || sellPct == null) return null;

  const sameySequence = buyDay <= sellDay; // buy happens first, sell happens after — the normal case
  const profitPct = sellPct - buyPct;
  const buyPrice = Math.round(price * (1 + buyPct / 100));
  const sellPrice = Math.round(price * (1 + sellPct / 100));
  const netSellPrice = applyTax(sellPrice);
  const profitPerItem = netSellPrice - buyPrice;
  // "Profit (buy limit)" is literally profit per item * the bare buy limit —
  // one full limit's worth of units (Ben: "if my buy limit is 10k and I can
  // make 1k per item, the profit per buy limit is 10m. That's how it should
  // show."). Deliberately NOT scaled by any assumed holding window — how
  // long someone actually leaves an offer open varies too much per player
  // to project a single "realistic" total from.
  const profitForLimit = limit ? profitPerItem * limit : null;
  const netProfitPct = buyPrice ? (profitPerItem / buyPrice) * 100 : profitPct;

  return {
    buyDay, sellDay, buyPct, sellPct, sameySequence,
    buyDayStd: timing.best_buy_day_std, sellDayStd: timing.best_sell_day_std,
    buyPrice, sellPrice, netSellPrice, profitPct, netProfitPct, profitPerItem, profitForLimit,
    nEvents: timing.n_events,
    // Day offset (relative to event START, negative = before) of the
    // lowest price point in the pre-event baseline window — was already
    // computed by the Python backend but never surfaced in the UI until
    // now. Useful for items like Yew frame that rise BEFORE the event:
    // tells you roughly how early to start buying, not just the in-event
    // buy/sell days above.
    preTroughOffset: timing.pre_trough_offset_median,
  };
}

// Item-level Almanac trade candidates, independent of whichever phase pill
// happens to be selected. Shared by DXPIntelTab's Recommendations engine
// and PortfolioTab's diversification suggestions (dev-mode only) so both
// pull from the exact same logic rather than two copies drifting apart.
function computeRecommendationCandidates(data, priceById) {
  if (!data) return [];
  const out = [];
  for (const id in data) {
    if (id === '_meta') continue;
    const entry = data[id];
    const liveItem = priceById[id];
    if (isDebunkedDxpItem(entry.name || liveItem?.name)) continue;
    const price = liveItem ? (liveItem.high || liveItem.low || 0) : 0;
    if (!price || !entry.timing) continue;
    const limit = entry.limit || liveItem?.limit || null;
    const trade = buildTradeIdea(entry.timing, price, limit);
    if (!trade || trade.profitPerItem == null) continue;
    let bestRatio = 0;
    for (const p of ALMANAC_PHASES) {
      const ph = entry.phases?.[p.key];
      if (!ph || !ph.total) continue;
      if (ph.avg_vol_ratio != null && ph.avg_vol_ratio < 0.5) continue; // same thin-volume noise filter as allRows
      bestRatio = Math.max(bestRatio, Math.max(ph.rise, ph.drop) / ph.total);
    }
    const negligible = trade.netProfitPct < NEGLIGIBLE_NET_PROFIT_PCT
      || (trade.profitForLimit != null && trade.profitForLimit < NEGLIGIBLE_PROFIT_FOR_LIMIT_GP);
    out.push({
      id, name: entry.name || liveItem?.name || id, price, limit, trade, bestRatio, negligible,
      category: liveItem?.categories?.[0] || 'misc',
    });
  }
  return out;
}

function DXPIntelTab({items, onSelect}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [activePhase, setActivePhase] = useState('anticipation');
  const [sort, setSort] = useState({key:'confidence', dir:-1});
  const [tier, setTier] = useState('confirmed'); // 'confirmed' | 'negligible' | 'speculative' | 'debunked' | 'watchlist' | 'recommendations'
  const [expanded, setExpanded] = useState(null);
  const [search, setSearch] = useState('');
  const [dxpWatchlist, setDxpWatchlistState] = useState([]);
  const [notifSettings, setNotifSettings] = useState({enabled:false, buyAlerts:true, sellAlerts:true, announceAlerts:true, windowApproachingAlerts:true});
  const [riskTolerance, setRiskTolerance] = useState('safe'); // 'safe' | 'risky'
  const [budgetInput, setBudgetInput] = useState('');
  const [slotsInput, setSlotsInput] = useState(String(GE_SLOTS));
  const [diversify, setDiversify] = useState(true);
  const [recSort, setRecSort] = useState({key:'profitForLimit', dir:-1}); // default: biggest buy-limit profit first
  const toggleRecSort = key => setRecSort(s => ({key, dir: s.key===key ? -s.dir : -1}));
  const recSortArrow = key => recSort.key===key ? (recSort.dir>0?' ↑':' ↓') : '';

  useEffect(() => {
    setLoading(true); setError(false);
    window.genius?.getDxpIntelligence?.().then(d => {
      setData(d || {});
      setLoading(false);
    }).catch(() => { setError(true); setLoading(false); });
    window.genius?.getDxpWatchlist?.().then(list => setDxpWatchlistState(list || []));
    window.genius?.getDxpNotificationSettings?.().then(s => s && setNotifSettings(s));
  }, []);

  const toggleDxpWatch = id => {
    setDxpWatchlistState(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      window.genius?.setDxpWatchlist?.(next);
      return next;
    });
  };

  const updateNotifSettings = patch => {
    setNotifSettings(prev => {
      const next = {...prev, ...patch};
      window.genius?.setDxpNotificationSettings?.(next);
      return next;
    });
  };

  const priceById = useMemo(() => {
    const m = {};
    items.forEach(it => { if (it.id) m[String(it.id)] = it; });
    return m;
  }, [items]);

  const eventCount = data?._meta?.event_count ?? null;
  const itemCount = data ? Object.keys(data).filter(k => k !== '_meta').length : 0;

  const allRows = useMemo(() => {
    if (!data) return [];
    const out = [];
    for (const id in data) {
      if (id === '_meta') continue;
      const entry = data[id];
      if (isDebunkedDxpItem(entry.name || priceById[id]?.name)) continue;
      const ph = entry.phases?.[activePhase];
      if (!ph || !ph.total || ph.total < 5) continue;
      // Thin-volume noise filter — the DXP research repeatedly found that
      // "consistent" direction agreement on a sub-0.5x-baseline-volume item
      // is a statistical fluke from bulk junk items (Mahogany plank, Logs,
      // Brilliant energy, etc — all explicitly named in Debunked Theories),
      // not a real signal. This floor was applied throughout the
      // qualitative research write-up but was never wired into the live
      // computation until Ben caught it testing the recommendation engine
      // 2026-06-24 — without it, Confirmed/Recommendations could surface
      // items the research itself already debunked.
      if (ph.avg_vol_ratio != null && ph.avg_vol_ratio < 0.5) continue;
      const dominant = ph.rise >= ph.drop ? 'rise' : 'drop';
      const score = dominant === 'rise' ? ph.rise : ph.drop;
      const ratio = score / ph.total;
      if (ratio < 0.5) continue;
      const liveItem = priceById[id];
      const price = liveItem ? (liveItem.high || liveItem.low || 0) : 0;
      const medianPct = ph.median_pct ?? ph.avg_pct ?? 0;
      const limit = entry.limit || liveItem?.limit || null;
      const trade = buildTradeIdea(entry.timing, price, limit);
      const negligible = trade
        ? trade.netProfitPct < NEGLIGIBLE_NET_PROFIT_PCT
          || (trade.profitForLimit != null && trade.profitForLimit < NEGLIGIBLE_PROFIT_FOR_LIMIT_GP)
        : Math.abs(medianPct) < NEGLIGIBLE_MEDIAN_PCT;
      out.push({
        id, name: entry.name || liveItem?.name || id, price, limit,
        dominant, score, total: ph.total, ratio, medianPct, negligible,
        negligibleReason: negligible ? negligibleReason(trade, medianPct) : null,
        volRatio: ph.avg_vol_ratio,
        timing: entry.timing,
        trade,
        events: ph.events || [],
      });
    }
    return out;
  }, [data, activePhase, priceById]);

  // Recommendation engine candidates — item-level, independent of the
  // activePhase tab above. A trade idea (buy day -> sell day) is computed
  // once per item from its timing data, not per phase, so this rebuilds
  // straight from `data` rather than reusing allRows (which is filtered to
  // whichever phase pill happens to be selected). "Confidence" here is the
  // strongest phase-direction agreement found anywhere across the item's 5
  // phases — used only to gate the Safe risk tier, not shown as a column.
  // Shared with PortfolioTab's diversification suggestions (dev-mode only)
  // so both pull from the exact same trade-idea logic, not a duplicate.
  const recommendationCandidates = useMemo(() => computeRecommendationCandidates(data, priceById), [data, priceById]);

  // How long someone actually leaves a buy offer open varies hugely by
  // player (Ben's real Vulnerability bomb offer sat ~16.6 days at 1,000/4hr
  // for 100k units; someone else might check back every couple days) — there's
  // no single "realistic window" to project a total qty/spend/profit from.
  // So this doesn't try to size a quantity at all: it just ranks the
  // strongest plays and shows profit/item and profit-per-buy-limit, and
  // lets the player decide their own qty based on their own patience and gp.
  const buildRecommendations = (riskTolerance, budget, slots, diversify) => {
    const numSlots = Math.max(1, slots || GE_SLOTS);
    let pool = recommendationCandidates.filter(r => !r.negligible);
    if (riskTolerance === 'safe') pool = pool.filter(r => r.bestRatio >= ALMANAC_CONFIDENCE_THRESHOLD);
    if (budget > 0) pool = pool.filter(r => r.trade.buyPrice <= budget); // can afford at least one unit
    // Ranked by total gp payout (Profit (buy limit)), not ROI — most
    // players care more about "how much total gp can this make me" than
    // squeezing out the best % return on a thin-limit item (Ben: "I can
    // double my money on this one, but it's only 1k profit each... we
    // don't care about ROI, we want the GP").
    pool = [...pool].sort((a, b) => (b.trade.profitForLimit ?? -Infinity) - (a.trade.profitForLimit ?? -Infinity));
    // Diversify across categories — without this, the best-payout items
    // are often clustered in one skill/category (Ben: "most of my
    // investments are the bombs at the moment"), so the top N slots could
    // all be the same category by coincidence. Cap how many slots any one
    // category can claim on the first pass; if too few categories have
    // real candidates to fill every slot that way, a second pass fills
    // whatever's left ignoring the cap rather than leaving slots empty.
    // User-toggleable — off just returns the plain best-payout ranking.
    const maxPerCategory = diversify ? Math.max(1, Math.ceil(numSlots / 3)) : Infinity;
    const categoryCounts = {};
    const picks = [];
    for (const r of pool) {
      if (picks.length >= numSlots) break;
      const cat = r.category || 'misc';
      if ((categoryCounts[cat] || 0) >= maxPerCategory) continue;
      picks.push(r);
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    }
    if (picks.length < numSlots) {
      const pickedIds = new Set(picks.map(p => p.id));
      for (const r of pool) {
        if (picks.length >= numSlots) break;
        if (pickedIds.has(r.id)) continue;
        picks.push(r);
      }
    }
    // Honorable mentions: the next-best plays just outside the requested
    // slot count — worth swapping in if a slot frees up.
    const pickedIds = new Set(picks.map(p => p.id));
    const honorableMentions = pool.filter(r => !pickedIds.has(r.id)).slice(0, numSlots);
    return { picks, honorableMentions };
  };

  const confident = r => r.ratio >= ALMANAC_CONFIDENCE_THRESHOLD;
  const rowTierLabel = r => confident(r) && !r.negligible ? 'Confirmed' : confident(r) && r.negligible ? 'Negligible' : 'Speculative';
  const isSearching = search.trim().length > 0;

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = allRows.filter(r => {
      if (q && !r.name?.toLowerCase().includes(q)) return false;
      // While searching, ignore the tier pill entirely and show matches
      // from every tier (Confirmed/Negligible/Speculative) plus anything
      // on the watchlist — Ben: "search should just bring the item up
      // regardless of what tab it's in." Each match gets a tier tag in
      // the table instead, so you can still see where it'd normally live.
      if (q) return true;
      if (tier === 'watchlist') return dxpWatchlist.includes(r.id);
      if (tier === 'confirmed') return confident(r) && !r.negligible;
      if (tier === 'negligible') return confident(r) && r.negligible;
      if (tier === 'speculative') return !confident(r);
      return false; // 'debunked' renders its own static content, not allRows
    });
    const SORT_KEYS = {
      name:        r => r.name?.toLowerCase() || '',
      direction:   r => r.dominant === 'rise' ? 1 : 0,
      confidence:  r => r.ratio,
      medianPct:   r => r.medianPct,
      profitPerItem: r => r.trade?.profitPerItem ?? -Infinity,
      profitForLimit: r => r.trade?.profitForLimit ?? -Infinity,
      volRatio:    r => r.volRatio ?? -Infinity,
    };
    const getKey = SORT_KEYS[sort.key] || SORT_KEYS.confidence;
    filtered.sort((a,b) => {
      const av = getKey(a), bv = getKey(b);
      const primary = (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir;
      if (primary !== 0) return primary;
      // Tiebreaker: when sorting by confidence, use realistic round-trip
      // profit opportunity to order within the same confidence tier.
      if (sort.key === 'confidence') {
        const ag = a.trade?.profitForLimit ?? -Infinity, bg = b.trade?.profitForLimit ?? -Infinity;
        return (bg - ag);
      }
      return (b.total - a.total);
    });
    return filtered;
  }, [allRows, sort, tier, dxpWatchlist, search]);

  const toggleSort = key => setSort(s => ({key, dir: s.key===key ? -s.dir : -1}));
  const sortArrow = key => sort.key===key ? (sort.dir>0?' ↑':' ↓') : '';
  // Shared "Trade idea" writeup shown when expanding a row — used by the
  // main Confirmed/Negligible/Speculative table AND Recommendations/
  // Honorable mentions, so the trade-idea expand behaves identically
  // everywhere instead of being a main-table-only feature.
  const tradeDetailBlock = t => !t ? null : h('div', {style:{marginBottom:12, paddingBottom:10, borderBottom:`1px solid ${T.borderDim}`}},
    h('div', {style:{fontSize:10, color:T.textDim, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:6}},
      `Trade idea — based on ${t.nEvents} tracked cycles`
    ),
    h('div', {style:{fontSize:12, color:T.text, lineHeight:1.6}},
      t.preTroughOffset != null && t.preTroughOffset < -1 && h('span', null,
        `Starts dipping as early as day ${t.preTroughOffset} relative to the event start (typically announced ~2-3 weeks before that) — for items that move ahead of the event, this is roughly when to start buying, earlier than the in-event "Bottom" day below.`, h('br',null),
      ),
      `Bottom: day ${t.buyDay} (±${t.buyDayStd}d), ${t.buyPct>=0?'+':''}${t.buyPct.toFixed(2)}% vs baseline, ~${fmt.gp(t.buyPrice)}gp.`, h('br',null),
      `Top: day ${t.sellDay} (±${t.sellDayStd}d), ${t.sellPct>=0?'+':''}${t.sellPct.toFixed(2)}% vs baseline, ~${fmt.gp(t.sellPrice)}gp before tax, ~${fmt.gp(t.netSellPrice)}gp after 2% GE tax.`, h('br',null),
      `Net: ${t.netProfitPct>=0?'+':''}${t.netProfitPct.toFixed(2)}% per item after tax.`, h('br',null),
      h('span', {style:{color:T.textDim, fontStyle:'italic'}},
        'Day 0 = the moment the event starts. Fractional days are sub-day precision — day 0.5 means about 12 hours in, day 2.5 means 2.5 days in, etc.'
      ), h('br',null),
      !t.sameySequence && h('span', {style:{color:T.textDim, fontStyle:'italic'}},
        'Top happens before bottom in this cycle — better suited to selling existing stock early, then buying the dip for next time.'
      ),
    )
  );
  const confidentRows = allRows.filter(r => r.ratio >= ALMANAC_CONFIDENCE_THRESHOLD);
  const confirmedCount = confidentRows.filter(r => !r.negligible).length;
  const negligibleRows = confidentRows.filter(r => r.negligible);
  const negligibleCount = negligibleRows.length;
  const negligibleNetNegativeCount = negligibleRows.filter(r => (r.trade?.profitPerItem ?? 0) < 0).length;
  const speculativeCount = allRows.length - confidentRows.length;
  const recBudget = parseGP(budgetInput) || 0;
  const recSlots = Math.max(1, parseInt(slotsInput, 10) || GE_SLOTS);
  const recs = buildRecommendations(riskTolerance, recBudget, recSlots, diversify);
  const REC_SORT_KEYS = {
    name: a => a.name?.toLowerCase() || '',
    netRoi: a => a.trade.netProfitPct,
    profitPerItem: a => a.trade.profitPerItem,
    profitForLimit: a => a.trade.profitForLimit ?? -Infinity,
  };
  const sortedPicks = [...recs.picks].sort((a, b) => {
    const getKey = REC_SORT_KEYS[recSort.key] || REC_SORT_KEYS.profitForLimit;
    const av = getKey(a), bv = getKey(b);
    return (av < bv ? -1 : av > bv ? 1 : 0) * recSort.dir;
  });

  return h('div', {style:{padding:'16px 20px', maxWidth:900}},
    h('div', {style:{display:'flex', alignItems:'center', gap:8, marginBottom:4}},
      h('span', {style:{fontSize:16}}, '📅'),
      h('div', {className:'ge-section-head', style:{marginBottom:0}}, 'GEnius Almanac — DXP Edition'),
    ),
    h('div', {style:{fontSize:12, color:T.gold, fontStyle:'italic', marginBottom:6}},
      'The market has seasons too. This is their almanac.'
    ),
    h('div', {style:{fontSize:11, color:T.textDim, marginBottom:14}},
      `Hidden developer build. Backed by ${itemCount || '700+'} items across ${eventCount ?? '10+'} historical DXP events. Estimates only — GE prices lag real trading activity during DXP.`
    ),

    h('div', {style:{border:`1px solid ${T.borderDim}`, borderRadius:6, padding:'10px 14px', marginBottom:14}},
      h('label', {style:{display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:12, color:T.text, marginBottom: notifSettings.enabled ? 8 : 0}},
        h('input', {
          type:'checkbox', checked:!!notifSettings.enabled,
          onChange:e => updateNotifSettings({enabled:e.target.checked}),
        }),
        '🔔 Notify me about my DXP watchlist',
      ),
      notifSettings.enabled && h('div', {style:{display:'flex', gap:14, flexWrap:'wrap', paddingLeft:24}},
        [
          {key:'windowApproachingAlerts', label:'DXP window approaching (heads-up before any announcement)'},
          {key:'announceAlerts', label:'New DXP announced'},
          {key:'buyAlerts', label:'Best-buy day hit'},
          {key:'sellAlerts', label:'Best-sell day hit'},
        ].map(o => h('label', {key:o.key, style:{display:'flex', alignItems:'center', gap:6, cursor:'pointer', fontSize:11, color:T.textDim}},
          h('input', {
            type:'checkbox', checked:!!notifSettings[o.key],
            onChange:e => updateNotifSettings({[o.key]: e.target.checked}),
          }),
          o.label,
        ))
      ),
      notifSettings.enabled && h('div', {style:{fontSize:10, color:T.textDim, fontStyle:'italic', paddingLeft:24, marginTop:6}},
        '"DXP window approaching" doesn\'t need a watchlist — it\'s a once-a-year calendar nudge based on historical clustering. Best-buy/sell/announced alerts need items pinned with the ☆ below.'
      ),
      notifSettings.enabled && dxpWatchlist.length === 0 && h('div', {style:{fontSize:11, color:T.textDim, fontStyle:'italic', paddingLeft:24, marginTop:4}},
        'No items pinned yet — click the ☆ next to any item below to add one.'
      ),
    ),

    h('div', {style:{display:'flex', gap:6, marginBottom:10, flexWrap:'wrap'}},
      ALMANAC_PHASES.map(p => h('button', {
        key:p.key,
        onClick:()=>{
          setActivePhase(p.key); setExpanded(null);
          // Debunked Theories and Recommendations are phase-independent
          // panels that otherwise stay open forever — clicking a phase
          // pill should always return you to the normal phase-filtered
          // table, not silently no-op while the old panel keeps showing.
          if (tier === 'debunked' || tier === 'recommendations') setTier('confirmed');
        },
        style:{
          padding:'6px 12px', fontSize:11, borderRadius:4, cursor:'pointer',
          border:`1px solid ${activePhase===p.key ? T.gold : T.border}`,
          background: activePhase===p.key ? 'rgba(201,168,76,0.2)' : 'transparent',
          color: activePhase===p.key ? T.goldBright : T.textDim,
        }
      }, p.label))
    ),

    h('div', {style:{display:'flex', gap:6, marginBottom:14, flexWrap:'wrap'}},
      [
        {key:'confirmed', label:`Confirmed (${confirmedCount})`},
        {key:'negligible', label:`Real but Negligible (${negligibleCount})`},
        {key:'speculative', label:`Highly Speculative (${speculativeCount})`},
        {key:'watchlist', label:`⭐ My Watchlist (${dxpWatchlist.length})`},
        {key:'recommendations', label:`🎯 Recommendations`},
        {key:'debunked', label:`📖 Debunked Theories (${DXP_DEBUNKED_THEORIES.length})`},
      ].map(t => {
        const golden = t.key==='debunked' || t.key==='watchlist' || t.key==='recommendations';
        return h('button', {
        key:t.key,
        onClick:()=>{setTier(t.key); setExpanded(null);},
        style:{
          padding:'5px 12px', fontSize:11, borderRadius:4, cursor:'pointer',
          border:`1px solid ${tier===t.key ? (t.key==='confirmed'?T.green:golden?T.gold:T.textDim) : T.borderDim}`,
          background: tier===t.key ? (t.key==='confirmed'?'rgba(76,175,80,0.15)':golden?'rgba(201,168,76,0.15)':'rgba(156,123,63,0.15)') : 'transparent',
          color: tier===t.key ? (t.key==='confirmed'?T.green:golden?T.goldBright:T.text) : T.textDim,
        }
      }, t.label);
      })
    ),
    tier !== 'debunked' && tier !== 'recommendations' && h('input', {
      type:'text', value:search, placeholder:'Search any item, across all tiers…',
      onChange:e=>setSearch(e.target.value),
      style:{
        width:'100%', maxWidth:280, marginBottom:12, padding:'6px 10px', fontSize:12,
        background:T.panel2, border:`1px solid ${T.borderDim}`, borderRadius:4, color:T.text,
      },
    }),
    tier === 'watchlist' && h('div', {style:{fontSize:11, color:T.textDim, fontStyle:'italic', marginBottom:10}},
      dxpWatchlist.length === 0
        ? 'No items pinned yet — click the ☆ next to any item in Confirmed/Negligible/Speculative to add it here.'
        : 'Items you\'ve pinned, regardless of confidence tier. Use the 🔔 Notifications panel below to get alerted at the right buy/sell day.'
    ),
    tier === 'confirmed' && h('div', {style:{fontSize:11, color:T.textDim, fontStyle:'italic', marginBottom:10}},
      `${Math.round(ALMANAC_CONFIDENCE_THRESHOLD*100)}%+ direction agreement across tracked DXP cycles, on real trading volume, with a worthwhile net-of-tax margin. The closest thing to a reliable signal this data can offer — still estimates, not guarantees.`
    ),
    tier === 'speculative' && h('div', {style:{fontSize:11, color:T.textDim, fontStyle:'italic', marginBottom:10}},
      `Below ${Math.round(ALMANAC_CONFIDENCE_THRESHOLD*100)}% direction agreement — interesting to look at, not reliable enough to act on.`
    ),
    tier === 'negligible' && h('div', {style:{fontSize:11, color:T.textDim, fontStyle:'italic', marginBottom:10}},
      `Same direction-confidence bar as Confirmed (${Math.round(ALMANAC_CONFIDENCE_THRESHOLD*100)}%+ agreement, real volume) — these items genuinely do move this way every cycle. But the opportunity is too small to matter: either under ${NEGLIGIBLE_NET_PROFIT_PCT}% net profit per item after 2% GE tax, under ${fmt.gp(NEGLIGIBLE_PROFIT_FOR_LIMIT_GP)}gp total profit even buying the full GE limit, or under ${NEGLIGIBLE_MEDIAN_PCT}% gross movement where full timing data isn't available. Real pattern, not worth the effort.`,
      negligibleNetNegativeCount > 0 && h('div', {style:{color:T.red, marginTop:6, fontWeight:'bold'}},
        `⚠ ${negligibleNetNegativeCount} of these are actually net-LOSING trades after tax (shown in red below) — the price moves the predicted direction, but not far enough to clear the 2% sell tax.`
      ),
    ),

    tier === 'recommendations' && h('div', null,
      h('div', {style:{fontSize:11, color:T.textDim, fontStyle:'italic', marginBottom:14}},
        'Set your risk tolerance and how much gp you\'re willing to put into DXP trades — this builds a concrete shopping list from the live data above, not just a vibe.'
      ),
      h('div', {style:{border:`1px solid ${T.borderDim}`, borderRadius:6, padding:'12px 14px', marginBottom:14, display:'flex', gap:20, flexWrap:'wrap', alignItems:'flex-end'}},
        h('div', null,
          h('div', {className:'form-lbl'}, 'Risk tolerance'),
          h('div', {style:{display:'flex', gap:6}},
            [{key:'safe', label:'Safe'}, {key:'risky', label:'Risky'}].map(o => h('button', {
              key:o.key,
              onClick:()=>setRiskTolerance(o.key),
              style:{
                padding:'5px 14px', fontSize:11, borderRadius:4, cursor:'pointer',
                border:`1px solid ${riskTolerance===o.key ? T.gold : T.borderDim}`,
                background: riskTolerance===o.key ? 'rgba(201,168,76,0.15)' : 'transparent',
                color: riskTolerance===o.key ? T.goldBright : T.textDim,
              }
            }, o.label))
          ),
        ),
        h('div', null,
          h('div', {className:'form-lbl', title:'Optional — just filters out items you can\'t afford even one unit of'}, 'GP you have (optional)'),
          h(GpInput, {value:budgetInput, placeholder:'e.g. 50m', onChange:setBudgetInput}),
        ),
        h('div', null,
          h('div', {className:'form-lbl', title:'How many GE offer slots you want filled — not necessarily all of them (e.g. one tied up in a standing collection-log offer)'}, 'GE slots to fill'),
          h('input', {
            type:'number', min:1, max:16, value:slotsInput,
            onChange:e=>setSlotsInput(e.target.value),
            style:{width:60, padding:'5px 8px', fontSize:13, background:T.panel2, border:`1px solid ${T.borderDim}`, borderRadius:4, color:T.text},
          }),
        ),
        h('div', null,
          h('div', {className:'form-lbl'}, 'Spread'),
          h('label', {
            style:{display:'flex', alignItems:'center', gap:6, cursor:'pointer', height:28},
            title:'When ON, no single skill/category can claim more than about a third of your slots, so the list won\'t just hand you several variations of the same item type. When OFF, picks are purely ranked by Probable profit (buy limit) with no category limit.',
          },
            h('input', {type:'checkbox', checked:diversify, onChange:e=>setDiversify(e.target.checked)}),
            h('span', {style:{fontSize:12, color:T.text}}, 'Suggest diversification'),
          ),
        ),
      ),
      h('div', {style:{fontSize:11, color:T.textDim, fontStyle:'italic', marginBottom:14}},
        riskTolerance === 'safe'
          ? `Safe: only items at ${Math.round(ALMANAC_CONFIDENCE_THRESHOLD*100)}%+ direction confidence somewhere in their cycle (the same bar as Confirmed), with a real net-of-tax margin.`
          : 'Risky: also includes Highly Speculative items (below the confidence bar) for a shot at bigger moves — these are less reliable, by definition.'
      ),
      h('div', {style:{fontSize:11, color:T.textDim, fontStyle:'italic', marginBottom:8}},
        'No assumed qty, spend, or total profit here — how long you\'ll actually leave a buy offer open varies too much person to person. Probable profit/item and Probable profit (buy limit) are shown so you can size it yourself.'
      ),
      h('div', {style:{fontSize:11, color:T.textDim, fontStyle:'italic', marginBottom:8}},
        diversify
          ? 'Spread across categories on purpose — no single skill/category can claim more than about a third of your slots, so the list won\'t just hand you several variations of the same item type. Turn off "Suggest diversification" above for a pure best-payout ranking instead.'
          : 'Diversification off — purely ranked by Probable profit (buy limit), with no category limit. Could end up concentrated in one skill/category.'
      ),
      h('div', {style:{fontSize:11, color:T.goldBright, border:`1px solid ${T.borderDim}`, borderRadius:4, padding:'8px 10px', marginBottom:14}},
        '⚠ Not a guarantee. These are historical buy/sell-day medians from past DXP events, not a live promise — actual prices move, buy orders may not fill in time, and any single future event can behave differently. Treat this as "extremely likely based on the data," not certain. All profit figures are calculated from the item\'s CURRENT price — the actual buy price, sell price, and profit you realize when the trade happens will differ, for better or worse.'
      ),
      recs.picks.length === 0 && h('div', {className:'empty-state'}, h('div', null, 'No items currently qualify for this risk tolerance — try Risky, or check back after the next fetch.')),
      recs.picks.length > 0 && h('div', null,
        h('table', {className:'ge-table'},
          h('thead', null, h('tr', null,
            h('th', {style:{width:20}}, null),
            h('th', {onClick:()=>toggleRecSort('name'), style:{cursor:'pointer'}}, 'Item'+recSortArrow('name')),
            h('th', null, 'Trade Idea'),
            h('th', {onClick:()=>toggleRecSort('netRoi'), style:{cursor:'pointer'}, title:'Net of the 2% GE sell tax'}, 'Net ROI'+recSortArrow('netRoi')),
            h('th', {onClick:()=>toggleRecSort('profitPerItem'), style:{cursor:'pointer'}, title:'Net of the 2% GE sell tax. Calculated from the item\'s CURRENT price — actual profit when the trade happens may be higher or lower.'}, 'Probable profit/item'+recSortArrow('profitPerItem')),
            h('th', {onClick:()=>toggleRecSort('profitForLimit'), style:{cursor:'pointer'}, title:'Profit per item (net of the 2% GE sell tax) × the GE buy limit — one full limit\'s worth of units, not a hard cap on what you can actually invest. Calculated from the item\'s CURRENT price.'}, 'Probable profit (buy limit)'+recSortArrow('profitForLimit')),
          )),
          h('tbody', null, sortedPicks.flatMap(r => [
            h('tr', {
              key:r.id, style:{cursor: onSelect ? 'pointer' : 'default'},
              onClick: onSelect ? ()=>onSelect(priceById[r.id]) : undefined,
            },
              h('td', {
                style:{cursor:'pointer', color: dxpWatchlist.includes(r.id) ? T.gold : T.textDim, textAlign:'center'},
                onClick: e => { e.stopPropagation(); toggleDxpWatch(r.id); },
              }, dxpWatchlist.includes(r.id) ? '★' : '☆'),
              h('td', null, r.name),
              h('td', {
                style:{fontSize:11, color:T.textDim, cursor:'pointer'},
                onClick: e => { e.stopPropagation(); setExpanded(expanded===r.id?null:r.id); },
                title:'Show trade idea details',
              },
                r.trade.sameySequence
                  ? `Buy ~day ${r.trade.buyDay} → Sell ~day ${r.trade.sellDay}`
                  : `Sell ~day ${r.trade.sellDay} → Buy ~day ${r.trade.buyDay} (next cycle)`
              ),
              h('td', {style:{color: r.trade.netProfitPct>=0?T.green:T.red}}, (r.trade.netProfitPct>=0?'+':'')+r.trade.netProfitPct.toFixed(2)+'%'),
              h('td', {style:{color: r.trade.profitPerItem>=0?T.gold:T.red}}, (r.trade.profitPerItem>=0?'+':'')+fmt.gp(r.trade.profitPerItem)+'gp'),
              h('td', {style:{color: r.trade.profitForLimit==null ? T.textDim : r.trade.profitForLimit>=0 ? T.gold : T.red}}, r.trade.profitForLimit!=null ? (r.trade.profitForLimit>=0?'+':'')+fmt.gp(r.trade.profitForLimit)+'gp' : '—'),
            ),
            expanded===r.id && h('tr', {key:r.id+'-detail'},
              h('td', {colSpan:6, style:{background:'rgba(0,0,0,0.2)', padding:'10px 14px'}}, tradeDetailBlock(r.trade)),
            ),
          ]))
        ),
        recs.honorableMentions.length > 0 && h('div', {style:{marginTop:18}},
          h('div', {className:'form-lbl', style:{marginBottom:6}}, 'Honorable mentions'),
          h('div', {style:{fontSize:11, color:T.textDim, fontStyle:'italic', marginBottom:8}},
            `Next best plays just outside your ${recSlots} slot${recSlots===1?'':'s'} — worth swapping in if one frees up.`
          ),
          h('table', {className:'ge-table'},
            h('thead', null, h('tr', null,
              h('th', {style:{width:20}}, null),
              h('th', null, 'Item'),
              h('th', null, 'Trade Idea'),
              h('th', {title:'Net of the 2% GE sell tax'}, 'Net ROI'),
              h('th', {title:'Net of the 2% GE sell tax. Calculated from the item\'s CURRENT price — actual profit when the trade happens may be higher or lower.'}, 'Probable profit/item'),
              h('th', {title:'Profit per item (net of the 2% GE sell tax) × the GE buy limit. Calculated from the item\'s CURRENT price.'}, 'Probable profit (buy limit)'),
            )),
            h('tbody', null, recs.honorableMentions.flatMap(r => [
              h('tr', {
                key:r.id, style:{cursor: onSelect ? 'pointer' : 'default'},
                onClick: onSelect ? ()=>onSelect(priceById[r.id]) : undefined,
              },
                h('td', {
                  style:{cursor:'pointer', color: dxpWatchlist.includes(r.id) ? T.gold : T.textDim, textAlign:'center'},
                  onClick: e => { e.stopPropagation(); toggleDxpWatch(r.id); },
                }, dxpWatchlist.includes(r.id) ? '★' : '☆'),
                h('td', null, r.name),
                h('td', {
                  style:{fontSize:11, color:T.textDim, cursor:'pointer'},
                  onClick: e => { e.stopPropagation(); setExpanded(expanded===r.id?null:r.id); },
                  title:'Show trade idea details',
                },
                  r.trade.sameySequence
                    ? `Buy ~day ${r.trade.buyDay} → Sell ~day ${r.trade.sellDay}`
                    : `Sell ~day ${r.trade.sellDay} → Buy ~day ${r.trade.buyDay} (next cycle)`
                ),
                h('td', {style:{color: r.trade.netProfitPct>=0?T.green:T.red}}, (r.trade.netProfitPct>=0?'+':'')+r.trade.netProfitPct.toFixed(2)+'%'),
                h('td', {style:{color: r.trade.profitPerItem>=0?T.gold:T.red}}, (r.trade.profitPerItem>=0?'+':'')+fmt.gp(r.trade.profitPerItem)+'gp'),
                h('td', {style:{color: r.trade.profitForLimit==null ? T.textDim : r.trade.profitForLimit>=0 ? T.gold : T.red}}, r.trade.profitForLimit!=null ? (r.trade.profitForLimit>=0?'+':'')+fmt.gp(r.trade.profitForLimit)+'gp' : '—'),
              ),
              expanded===r.id && h('tr', {key:r.id+'-detail'},
                h('td', {colSpan:6, style:{background:'rgba(0,0,0,0.2)', padding:'10px 14px'}}, tradeDetailBlock(r.trade)),
              ),
            ]))
          ),
        ),
      ),
    ),

    tier === 'debunked' && h('div', null,
      h('div', {style:{fontSize:11, color:T.textDim, fontStyle:'italic', marginBottom:14}},
        'Popular DXP theories we actually tested — common misconceptions about what gets affected, and items people expect to move that just... don\'t. Curated from the full research pass, kept here so the wrong intuitions don\'t keep resurfacing.'
      ),
      DXP_DEBUNKED_THEORIES.map((d, i) => h('div', {
        key:i,
        style:{
          border:`1px solid ${T.borderDim}`, borderRadius:6, padding:'12px 14px', marginBottom:10,
        }
      },
        h('div', {style:{display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:6, flexWrap:'wrap', gap:6}},
          h('div', {style:{fontWeight:'bold', color:T.text, fontSize:13}}, d.title),
          h('div', {style:{fontSize:10, color:T.gold, fontStyle:'italic'}}, d.verdict),
        ),
        h('div', {style:{fontSize:11, color:T.textDim, marginBottom:6}},
          h('b', {style:{color:T.textDim}}, 'The belief: '), d.belief
        ),
        h('div', {style:{fontSize:11, color:T.text, lineHeight:1.5}},
          h('b', {style:{color:T.text}}, 'What the data actually shows: '), d.reality
        ),
      ))
    ),

    loading && tier !== 'debunked' && tier !== 'recommendations' && h('div', {style:{color:T.textDim, fontSize:12, padding:'20px 0'}}, 'Computing DXP patterns from local + research history…'),
    error && tier !== 'debunked' && tier !== 'recommendations' && h('div', {style:{color:T.red, fontSize:12, padding:'20px 0'}}, 'Failed to load Almanac data.'),

    !loading && !error && tier !== 'debunked' && tier !== 'recommendations' && h('div', null,
      h('div', {style:{fontSize:11, color:T.textDim, marginBottom:8}},
        isSearching ? `${rows.length} match${rows.length===1?'':'es'} across all tiers` : `${rows.length} items in this view`
      ),
      rows.length === 0
        ? h('div', {className:'empty-state'}, h('div', null, 'No items show a clear signal for this phase.'))
        : h('table', {className:'ge-table'},
            h('thead', null, h('tr', null,
              h('th', {style:{width:20}}, null),
              h('th', {onClick:()=>toggleSort('name'), style:{cursor:'pointer'}}, 'Item'+sortArrow('name')),
              h('th', {onClick:()=>toggleSort('direction'), style:{cursor:'pointer'}}, 'Direction'+sortArrow('direction')),
              h('th', {onClick:()=>toggleSort('confidence'), style:{cursor:'pointer'}}, 'Confidence'+sortArrow('confidence')),
              h('th', {onClick:()=>toggleSort('medianPct'), style:{cursor:'pointer'}}, 'Median %'+sortArrow('medianPct')),
              h('th', null, 'Trade Idea'),
              h('th', {onClick:()=>toggleSort('profitPerItem'), style:{cursor:'pointer'}, title:'Net of the 2% GE sell tax. Calculated from the item\'s CURRENT price — actual profit when the trade happens may be higher or lower.'}, 'Probable profit/item'+sortArrow('profitPerItem')),
              h('th', {onClick:()=>toggleSort('profitForLimit'), style:{cursor:'pointer'}, title:'Profit per item (net of the 2% GE sell tax) × the GE buy limit — one full limit\'s worth of units, not a hard cap on what you can actually invest. Calculated from the item\'s CURRENT price.'}, 'Probable profit (buy limit)'+sortArrow('profitForLimit')),
              h('th', {onClick:()=>toggleSort('volRatio'), style:{cursor:'pointer'}}, 'Vol'+sortArrow('volRatio')),
              h('th', {style:{width:24}}, null),
            )),
            h('tbody', null, rows.map(r => {
              const t = r.trade;
              const tradeLabel = !t ? '—'
                : t.sameySequence
                  ? `Buy ~day ${t.buyDay} → Sell ~day ${t.sellDay}`
                  : `Sell ~day ${t.sellDay} → Buy ~day ${t.buyDay} (next cycle)`;
              return [
              h('tr', {key:r.id},
                h('td', {
                  style:{cursor:'pointer', color: dxpWatchlist.includes(r.id) ? T.gold : T.textDim, textAlign:'center'},
                  onClick:()=>toggleDxpWatch(r.id),
                }, dxpWatchlist.includes(r.id) ? '★' : '☆'),
                h('td', {
                  style:{cursor: onSelect ? 'pointer' : 'default', textDecoration: onSelect ? 'underline' : 'none', textDecorationColor:'transparent'},
                  onClick: onSelect ? ()=>onSelect(priceById[r.id]) : undefined,
                  onMouseEnter: e => { if (onSelect) e.currentTarget.style.color = T.goldBright; },
                  onMouseLeave: e => { if (onSelect) e.currentTarget.style.color = ''; },
                  title: onSelect ? 'Open item details' : undefined,
                },
                  r.name,
                  isSearching && h('span', {
                    style:{
                      marginLeft:8, fontSize:9, padding:'1px 6px', borderRadius:8, textDecoration:'none',
                      border:`1px solid ${T.borderDim}`, color:T.textDim, verticalAlign:'middle',
                    }
                  }, rowTierLabel(r)),
                ),
                h('td', {style:{color: r.dominant==='rise' ? T.green : T.red}}, r.dominant==='rise' ? '▲ Rise' : '▼ Drop'),
                h('td', null, `${r.score}/${r.total}`),
                h('td', {style:{color: r.medianPct>=0 ? T.green : T.red}}, `${r.medianPct>=0?'+':''}${r.medianPct}%`),
                h('td', {
                  style:{fontSize:11, color:T.textDim, cursor:'pointer'},
                  onClick:()=>setExpanded(expanded===r.id?null:r.id),
                  title:'Show trade idea details',
                }, tradeLabel),
                h('td', {style:{color: t?.profitPerItem==null ? T.textDim : t.profitPerItem>=0 ? T.gold : T.red}}, t?.profitPerItem!=null ? (t.profitPerItem>=0?'+':'')+fmt.gp(t.profitPerItem)+'gp' : '—'),
                h('td', {style:{color: t?.profitForLimit==null ? T.textDim : t.profitForLimit>=0 ? T.gold : T.red}}, t?.profitForLimit!=null ? (t.profitForLimit>=0?'+':'')+fmt.gp(t.profitForLimit)+'gp' : '—'),
                h('td', {style:{color:T.textDim}}, r.volRatio!=null ? r.volRatio+'x' : '—'),
                h('td', {
                  style:{cursor:'pointer', color:T.textDim, textAlign:'center'},
                  onClick:()=>setExpanded(expanded===r.id?null:r.id),
                  title:'Show trade idea details',
                }, expanded===r.id ? '▾' : '›'),
              ),
              expanded===r.id && h('tr', {key:r.id+'-detail'},
                h('td', {colSpan:10, style:{background:'rgba(0,0,0,0.2)', padding:'10px 14px'}},
                  r.negligible && r.negligibleReason && h('div', {style:{marginBottom:12, paddingBottom:10, borderBottom:`1px solid ${T.borderDim}`, fontSize:12, color:T.gold}},
                    r.negligibleReason
                  ),
                  tradeDetailBlock(t),
                  h('div', {style:{fontSize:10, color:T.textDim, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:6}},
                    `Tracked DXP events — ${r.events.length} with data for this phase`
                  ),
                  h('div', {style:{display:'flex', flexWrap:'wrap', gap:6}},
                    r.events.map(ev => h('span', {
                      key:ev.event_start,
                      style:{
                        fontSize:10, padding:'2px 8px', borderRadius:10,
                        border:`1px solid ${ev.direction==='rise'?'rgba(76,175,80,0.4)':ev.direction==='drop'?'rgba(229,57,53,0.4)':T.borderDim}`,
                        color: ev.direction==='rise'?T.green:ev.direction==='drop'?T.red:T.textDim,
                      }
                    }, `${ev.event_start} ${ev.pct>=0?'+':''}${ev.pct}%`))
                  )
                )
              ),
            ];}))
          )
    ),
  );
}

function AboutTab() {
  const [appVersion, setAppVersion] = useState('');
  useEffect(() => { window.genius?.getAppVersion?.().then(setAppVersion); }, []);

  const TIPS = [
    'Star (★) any item to add it to your Watchlist. The Watchlist tab is just a focused view of those, and you can turn on a once-a-day notification for big movers from Settings.',
    'The item detail panel has a candlestick chart with 7d/30d/90d/1Y/All ranges. Click any item name to open it.',
    'Track real positions in Portfolio to see your actual profit/loss, win rate, and hold time, not just current prices.',
    'Set Alerts for a specific price, % change, or signal, or use a plain date-triggered Reminder if it\'s not about price at all.',
    'Right-click items, and drag column headers and table edges. Most tables resize and rearrange more than they look like they do.',
  ];

  return h('div', null,
    h('div', {style:{display:'flex', flexDirection:'column', alignItems:'center', marginBottom:24, paddingBottom:20, borderBottom:`1px solid ${T.border}`}},
      h('img', {src:'../assets/logo-full.png', alt:'GEnius', style:{width:220, maxWidth:'100%'}}),
      appVersion && h('div', {style:{fontSize:11, color:T.textDim, marginTop:6}}, `Version ${appVersion}`),
      h('div', {style:{display:'flex', gap:10, marginTop:12}},
        h('button', {
          className:'ge-btn', style:{fontSize:11, padding:'5px 12px'},
          onClick:()=>window.genius?.openExternal('https://discord.gg/WFbJt9cDpP'),
        }, '💬 Discord'),
      ),
    ),
    h('div', {style:{maxWidth:560}},
      h('div', {style:{marginBottom:24}},
        h('div', {className:'ge-section-head'}, 'What is GEnius?'),
        h('div', {style:{fontSize:12, color:T.text, lineHeight:1.7}},
          'GEnius is a RuneScape 3 Grand Exchange market intelligence tool: live prices, signals, alerts, portfolio tracking, and historical event analysis, all running locally on your machine. No accounts, no servers, your data stays on your own computer.'
        ),
      ),
      h('div', {style:{marginBottom:24}},
        h('div', {className:'ge-section-head'}, 'The Ticker Rune'),
        h('div', {style:{fontSize:12, color:T.text, lineHeight:1.7}},
          'The central emblem of GEnius is the Ticker Rune, a symbol representing market knowledge, trade, and economic analysis, said to be what powers the inner workings of the Grand Exchange itself.'
        ),
      ),
      h('div', {style:{marginBottom:24}},
        h('div', {className:'ge-section-head'}, 'How the research works'),
        h('div', {style:{fontSize:12, color:T.text, lineHeight:1.7}},
          'The system is designed to prove itself wrong. Every pattern GEnius surfaces (DXP signals, alch opportunities, market behavior) is checked against real trading volume, not just price movement, and theories that don\'t hold up get published as Debunked, not quietly dropped. Confidence scores grow and adjust as new data comes in rather than freezing at a one-time snapshot. The goal isn\'t to confirm a hunch, it\'s to find out what\'s actually true, even when that means admitting an earlier finding was wrong.'
        ),
      ),
      h('div', {style:{marginBottom:24}},
        h('div', {className:'ge-section-head'}, 'Tips'),
        h('ul', {style:{margin:0, paddingLeft:18, fontSize:12, color:T.text, lineHeight:1.8}},
          TIPS.map((tip, i) => h('li', {key:i}, tip))
        ),
      ),
      h('div', {style:{marginBottom:24}},
        h('div', {className:'ge-section-head'}, 'Feedback'),
        h('div', {style:{fontSize:12, color:T.text, lineHeight:1.7}},
          'GEnius is built and maintained by one person. Feedback, bug reports, and feature suggestions all genuinely shape what gets built next. Drop them in the Discord above, or open an issue on '
          ,
          h('a', {
            href:'#', onClick:e=>{e.preventDefault(); window.genius?.openExternal('https://github.com/VonDerThWood/GE-Intelligence/issues');},
            style:{color:T.goldBright, cursor:'pointer'},
          }, 'GitHub'),
          '.'
        ),
      ),
    ),
  );
}

function SettingsTab({settings, onChange, toast, hiddenItems, onUnhide, items, userShorthands, onSaveShorthands}) {
  const [s, setS] = useState(settings);
  const [appVersion, setAppVersion] = useState('');
  useEffect(() => { window.genius?.getAppVersion?.().then(setAppVersion); }, []);
  const [watchNotif, setWatchNotif] = useState({enabled:false, dailyThresholdPct:5, trendThresholdPct:7});
  useEffect(() => { window.genius?.getWatchlistNotificationSettings?.().then(w => w && setWatchNotif(w)); }, []);
  const updateWatchNotif = patch => {
    setWatchNotif(prev => {
      const next = {...prev, ...patch};
      window.genius?.setWatchlistNotificationSettings?.(next);
      return next;
    });
  };
  const devTapCount = useRef(0);
  const devTapTimer = useRef(null);
  const handleVersionTap = () => {
    devTapCount.current += 1;
    clearTimeout(devTapTimer.current);
    devTapTimer.current = setTimeout(() => { devTapCount.current = 0; }, 2000);
    if (devTapCount.current >= 7) {
      devTapCount.current = 0;
      const next = !s.devMode;
      setS(x=>({...x, devMode:next}));
      onChange({...s, devMode:next});
      window.genius?.saveSettings({...s, devMode:next});
      toast(next ? 'Developer mode enabled' : 'Developer mode disabled', 'success');
    }
  };
  const [shDraft, setShDraft] = useState('');
  const [shKey, setShKey]     = useState('');
  const [shFocused, setShFocused] = useState(false);
  const shMatches = useMemo(() => {
    const q = shDraft.trim().toLowerCase();
    if (!q || q.length < 2) return [];
    return (items||[]).filter(it => it.name.toLowerCase().includes(q)).slice(0, 8);
  }, [shDraft, items]);
  const shExactMatch = useMemo(() =>
    (items||[]).some(it => it.name.toLowerCase() === shDraft.trim().toLowerCase()),
  [shDraft, items]);
  const addShorthand = () => {
    const k = shKey.trim(), v = shDraft.trim();
    if (!k || !v) { toast('Enter both a shorthand and an item name','error'); return; }
    if (!shExactMatch) { toast(`"${v}" doesn't match any known item — check the spelling`, 'error'); return; }
    const updated = {...(userShorthands||{}), [k]: v};
    onSaveShorthands(updated);
    setShKey(''); setShDraft('');
    toast(`Shorthand "${k}" saved`, 'success');
  };
  useEffect(()=>setS(settings),[settings]);
  // Every control here saves immediately on change — no separate "Save
  // settings" button. Previously some settings (Thumbnails, Watchlist
  // Digest) saved instantly while most others silently waited for a
  // button click below, and UI Scale's slider claimed to apply
  // immediately but didn't actually persist without that same click.
  // One consistent behavior for the whole tab now.
  const update = patch => {
    setS(x => {
      const next = {...x, ...patch};
      onChange(next);
      window.genius?.saveSettings(next);
      return next;
    });
  };
  const set = k => e => update({[k]: e.target.value});
  const setChk = k => e => update({[k]: e.target.checked});
  const testHook = async () => {
    if (!s.discordWebhook) { toast('Enter webhook URL first','error'); return; }
    try {
      await fetch(s.discordWebhook,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:'GEnius test — connected!'})});
      toast('Webhook test sent!','success');
    } catch { toast('Webhook failed','error'); }
  };
  // Mirrors App()'s navBase logic so the Almanac entry (dev-mode-only,
  // not in the static NAV constant) can actually be dragged/reordered
  // here too — previously this editor always read the static NAV list
  // directly, so dxp_intel was never reorderable even with dev mode on.
  const sidebarNavItems = useMemo(() => {
    const base = NAV.filter(n=>n.id);
    if (!s.devMode) return base;
    const idx = base.findIndex(n => n.id === 'dashboard') + 1;
    const withDev = [...base];
    withDev.splice(idx, 0, {id:'dxp_intel', label:'GEnius Almanac', icon:'📅'});
    return withDev;
  }, [s.devMode]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  return h('div',null,
    h('div',{style:{display:'flex', flexDirection:'column', alignItems:'center', marginBottom:24, paddingBottom:20, borderBottom:`1px solid ${T.border}`}},
      h('img',{src:'../assets/logo-full.png', alt:'GEnius', style:{width:220, maxWidth:'100%'}}),
      appVersion && h('div',{
        style:{fontSize:11, color:T.textDim, marginTop:6, cursor:'default', userSelect:'none'},
        onClick:handleVersionTap,
      }, `Version ${appVersion}`),
      s.devMode && h('div',{style:{fontSize:10, color:T.gold, marginTop:4, letterSpacing:'0.05em'}}, '⚙ DEVELOPER MODE'),
      h('div',{style:{display:'flex', gap:10, marginTop:12}},
        h('button',{
          className:'ge-btn', style:{fontSize:11, padding:'5px 12px'},
          onClick:()=>window.genius?.openExternal('https://discord.gg/WFbJt9cDpP'),
        }, '💬 Discord'),
      ),
    ),
    h('div',{style:{maxWidth:500}},

    h('div',{className:'ge-section-head', style:{fontSize:13, marginTop:0}},'Display'),
    h('div',{style:{marginBottom:20}},
      h('div',{className:'ge-section-head'},'Theme'),
      h('select',{className:'ge-input',value:s.theme||'dark',onChange:set('theme')},
        h('option',{value:'dark'},'Dark (default)'),
        h('option',{value:'black'},'Black'),
      )
    ),
    h('div',{style:{marginBottom:20}},
      h('div',{className:'ge-section-head'},'Accent Color'),
      h('div',{style:{display:'flex', alignItems:'center', gap:10}},
        h('input',{
          type:'color',
          value: s.accentColor || DEFAULT_ACCENT,
          onChange: e => update({accentColor: e.target.value}),
          style:{width:44, height:28, padding:0, border:`1px solid ${T.borderDim}`, borderRadius:4, background:'transparent', cursor:'pointer'},
        }),
        h('button',{className:'ge-btn', style:{fontSize:11, padding:'4px 10px'}, onClick:()=>update({accentColor: DEFAULT_ACCENT})}, 'Reset to default'),
      ),
      h('div',{style:{fontSize:11,color:T.textDim, marginTop:4}}, 'Recolors highlights, headers, active states, and buttons. Applies and saves immediately.'),
    ),
    h('div',{style:{marginBottom:20}},
      h('div',{className:'ge-section-head'},'Item Thumbnails'),
      h('label',{className:'row',style:{gap:8,cursor:'pointer'}},
        h('input',{type:'checkbox',checked:s.showThumbnails!==false,onChange:setChk('showThumbnails')}),
        h('span',null,'Show item icons next to names in tables')
      ),
    ),
    h('div',{style:{marginBottom:20}},
      h('div',{className:'ge-section-head'},'UI Scale'),
      h('div',{style:{display:'flex', alignItems:'center', gap:10}},
        h('input',{
          type:'range', min:80, max:150, step:5,
          value: s.uiScale || 100,
          onChange: e => update({uiScale: parseInt(e.target.value,10)}),
          style:{flex:1},
        }),
        h('span',{style:{fontSize:12, color:T.gold, minWidth:42, textAlign:'right'}}, `${s.uiScale||100}%`),
      ),
      h('div',{style:{fontSize:11,color:T.textDim, marginTop:4}}, 'Scales the whole app UI. Applies and saves immediately.'),
      h('button',{className:'ge-btn', style:{marginTop:6, fontSize:11, padding:'2px 8px'},
        onClick:()=>update({uiScale:100})
      }, 'Reset to 100%')
    ),
    h('div',{style:{marginBottom:20}},
      h('div',{className:'ge-section-head'},'Date Format'),
      h('select',{className:'ge-input',value:s.dateFormat||'MM/DD/YYYY',onChange:set('dateFormat')},
        h('option',{value:'MM/DD/YYYY'},'MM/DD/YYYY (US)'),
        h('option',{value:'DD/MM/YYYY'},'DD/MM/YYYY (EU)'),
        h('option',{value:'YYYY-MM-DD'},'YYYY-MM-DD (ISO)'),
      )
    ),
    h('div',{style:{marginBottom:20}},
      h('div',{
        style:{display:'flex', alignItems:'center', gap:6, cursor:'pointer', userSelect:'none'},
        onClick:()=>setSidebarOpen(o=>!o),
      },
        h('span',{style:{fontSize:11, color:T.textDim, transition:'transform 0.15s', transform: sidebarOpen ? 'rotate(90deg)' : 'rotate(0deg)', display:'inline-block'}}, '▸'),
        h('div',{className:'ge-section-head', style:{marginBottom:0, borderBottom:'none', padding:0}},'Sidebar Order'),
        h('span',{
          onClick: e => e.stopPropagation(),
          title:'Reordering the sidebar flattens it into one plain list — it loses the Combat/Skilling/Other grouping shown by default. It still works fine, just looks a bit less organized. You can always hit Reset to Default to get the grouping back.',
          style:{cursor:'help', fontSize:10, color:T.textDim, border:`1px solid ${T.textDim}`, borderRadius:'50%', width:13, height:13, display:'inline-flex', alignItems:'center', justifyContent:'center'},
        }, '?'),
      ),
      sidebarOpen && h('div',{style:{marginTop:10}},
        h('div',{style:{fontSize:11,color:T.textDim,marginBottom:8}},'Drag to reorder. Saves immediately.'),
        h(SidebarOrderEditor, {
          navItems: sidebarNavItems,
          order: s.navOrder||[],
          onChange: order => update({navOrder:order})
        }),
        h('button',{className:'ge-btn',style:{marginTop:8},onClick:()=>update({navOrder:[]})}, 'Reset to Default')
      )
    ),

    h('div',{className:'ge-section-head', style:{fontSize:13}},'Data and fetching'),
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
      h('div',{className:'ge-section-head'},'Expensive items threshold'),
      h('label',{className:'form-lbl'},'Show items at or above this price in the High Value tab'),
      h(GpInput,{
        value: s.expensiveThreshold || 500000000,
        placeholder: 'e.g. 500m',
        onChange: v => { if (typeof v === 'number') update({expensiveThreshold: v}); },
        style:{marginBottom:4}
      }),
      h('div',{style:{fontSize:11,color:T.textDim}},
        `Currently: ${fmt.gp(s.expensiveThreshold || 500000000)}gp`
      )
    ),

    h('div',{className:'ge-section-head', style:{fontSize:13}},'Notifications'),
    h('div',{style:{marginBottom:20}},
      h('div',{className:'ge-section-head'},'Desktop Notifications'),
      h('label',{className:'row',style:{gap:8,cursor:'pointer'}},
        h('input',{type:'checkbox',checked:!!s.notifications,onChange:setChk('notifications')}),
        h('span',null,'Desktop notifications for price alerts')
      ),
      h('button',{
        className:'ge-btn',
        style:{marginTop:8},
        onClick: async () => {
          const result = await window.genius?.testNotification({
            title:'GEnius — Test Notification',
            body:'Notifications are working correctly!'
          });
          if (result?.success === false) toast('Notification failed: ' + result.error, 'error');
          else toast('Test notification sent!', 'success');
        }
      },'Test notification')
    ),
    h('div',{style:{marginBottom:20}},
      h('div',{className:'ge-section-head'},'Watchlist Daily Digest'),
      h('div',{style:{fontSize:11,color:T.textDim,marginBottom:8}},
        'Once-a-day desktop notification (works even with GEnius minimized to the tray) listing any watchlist item that moved more than the thresholds below. Stays silent if nothing crossed either bar that day.'
      ),
      h('label',{className:'row',style:{gap:8,cursor:'pointer',marginBottom:10}},
        h('input',{type:'checkbox',checked:!!watchNotif.enabled,onChange:e=>updateWatchNotif({enabled:e.target.checked})}),
        h('span',null,'Enable watchlist daily digest')
      ),
      h('div',{style:{display:'flex',gap:20,flexWrap:'wrap',opacity:watchNotif.enabled?1:0.5}},
        h('div',null,
          h('div',{className:'form-lbl'},'Daily move threshold (%)'),
          h('input',{
            type:'number', min:0.5, step:0.5, value:watchNotif.dailyThresholdPct, disabled:!watchNotif.enabled,
            onChange:e=>updateWatchNotif({dailyThresholdPct: parseFloat(e.target.value)||0}),
            style:{width:70, padding:'5px 8px', fontSize:13, background:T.panel2, border:`1px solid ${T.borderDim}`, borderRadius:4, color:T.text},
          }),
        ),
        h('div',null,
          h('div',{className:'form-lbl', title:'A sustained week-long drift is a different signal than a single-day spike, so this defaults a bit higher.'},'7-day trend threshold (%)'),
          h('input',{
            type:'number', min:0.5, step:0.5, value:watchNotif.trendThresholdPct, disabled:!watchNotif.enabled,
            onChange:e=>updateWatchNotif({trendThresholdPct: parseFloat(e.target.value)||0}),
            style:{width:70, padding:'5px 8px', fontSize:13, background:T.panel2, border:`1px solid ${T.borderDim}`, borderRadius:4, color:T.text},
          }),
        ),
      ),
    ),

    h('div',{className:'ge-section-head', style:{fontSize:13}},'Data management'),
    h('div',{style:{marginBottom:20}},
      h('div',{className:'ge-section-head'},'Data Portability'),
      h('div',{style:{fontSize:11,color:T.textDim,marginBottom:12,lineHeight:1.5}},
        'Export your watchlist, portfolio, alerts, notes, and settings to a file. Import it on any machine to restore everything.'
      ),
      h('div',{style:{display:'flex',gap:8}},
        h('button',{className:'ge-btn gold',onClick:async()=>{
          const res = await window.genius?.exportData();
          if (res?.canceled) return;
          if (res?.error) toast('Export failed: '+res.error,'error');
          else toast('Data exported successfully','success');
        }},'⬆ Export Backup'),
        h('button',{className:'ge-btn',onClick:async()=>{
          const res = await window.genius?.importData();
          if (res?.canceled) return;
          if (res?.error) { toast('Import failed: '+res.error,'error'); return; }
          toast('Data imported — restart GEnius to see all changes','success');
        }},'⬇ Import Backup'),
      )
    ),

    h('div',{style:{marginBottom:20}},
      h('div',{className:'ge-section-head'},'Custom Shorthands'),
      h('div',{style:{fontSize:11,color:T.textDim,marginBottom:12,lineHeight:1.5}},
        'Add your own abbreviations. Type them in the search bar to jump straight to an item. (e.g. "T90" → "Noxious scythe")'
      ),
      h('div',{style:{display:'flex',gap:6,marginBottom:10, position:'relative'}},
        h('input',{
          className:'ge-input', placeholder:'Shorthand (e.g. T90)',
          value:shKey, onChange:e=>setShKey(e.target.value.toUpperCase()),
          style:{width:120, textTransform:'uppercase'},
        }),
        h('div',{style:{flex:1, position:'relative'}},
          h('input',{
            className:'ge-input', placeholder:'Item name (e.g. Noxious scythe)',
            value:shDraft, onChange:e=>setShDraft(e.target.value),
            onFocus:()=>setShFocused(true),
            onBlur:()=>setTimeout(()=>setShFocused(false),150),
            style:{width:'100%', borderColor: shDraft.trim() ? (shExactMatch ? T.green : T.red) : undefined},
            onKeyDown: e => { if (e.key === 'Enter') addShorthand(); }
          }),
          shFocused && shMatches.length > 0 && h('div',{style:{
            position:'absolute', top:'100%', left:0, right:0, zIndex:20,
            background:T.panel2, border:`1px solid ${T.borderGold}`, borderRadius:4,
            maxHeight:200, overflowY:'auto', boxShadow:'0 4px 16px rgba(0,0,0,0.6)',
          }},
            shMatches.map(it => h('div',{
              key:it.id, style:{padding:'6px 10px', fontSize:12, cursor:'pointer'},
              onMouseDown: () => setShDraft(it.name),
              onMouseEnter: e => e.currentTarget.style.background = T.panel,
              onMouseLeave: e => e.currentTarget.style.background = 'transparent',
            }, it.name))
          )
        ),
        h('button',{className:'ge-btn gold',onClick:addShorthand},'Add'),
      ),
      Object.keys(userShorthands||{}).length > 0 && h('div',{style:{display:'flex',flexDirection:'column',gap:4}},
        Object.entries(userShorthands).map(([k,v]) =>
          h('div',{key:k,style:{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'5px 8px',background:'rgba(0,0,0,0.2)',borderRadius:3,fontSize:12}},
            h('span',{style:{color:T.gold,fontWeight:'bold',minWidth:80}}, k),
            h('span',{style:{color:T.text,flex:1}}, v),
            h('button',{className:'ge-btn',style:{padding:'2px 8px',fontSize:10},onClick:()=>{
              const updated = {...userShorthands};
              delete updated[k];
              onSaveShorthands(updated);
              toast(`Shorthand "${k}" removed`,'info');
            }},'Remove')
          )
        )
      ),
      Object.keys(userShorthands||{}).length === 0 && h('div',{style:{fontSize:11,color:T.textDim,fontStyle:'italic'}},'No custom shorthands yet.')
    ),

    hiddenItems && hiddenItems.length > 0 && h('div',{style:{marginBottom:20}},
      h('div',{className:'ge-section-head'},'Hidden Items'),
      h('div',{style:{fontSize:11,color:T.textDim,marginBottom:8}},
        `${hiddenItems.length} item${hiddenItems.length!==1?'s':''} hidden from all tabs.`
      ),
      h('div',{style:{display:'flex',flexDirection:'column',gap:4}},
        hiddenItems.map(id => {
          const item = items?.find(it => it.id === id);
          const name = item?.name || `Item #${id}`;
          return h('div',{key:id, style:{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'5px 8px',background:'rgba(0,0,0,0.2)',borderRadius:3,fontSize:12}},
            h('span',{style:{color:T.text}}, name),
            h('button',{className:'ge-btn',style:{padding:'2px 8px',fontSize:10},onClick:()=>onUnhide&&onUnhide(id)},'Unhide')
          );
        })
      )
    )
    )
  );
}

/* ─── Category Editor ────────────────────────────────────────── */
const CAT_LABEL = {
  melee:          'Melee',
  magic:          'Magic',
  ranged:         'Ranged',
  necromancy:     'Necromancy',
  hybrid:         'Hybrid',
  ammo:           'Ammunition',
  boss:           'Boss Drops',
  invention:      'Invention',
  herblore:       'Herblore',
  artisan:        'Artisan',
  food:           'Food',
  farming:        'Farming',
  mining:         'Gathering',
  prayer:         'Prayer',
  archaeology:    'Archaeology',
  runes:          'Runes',
  summoning:      'Summoning',
  treasure_trails:'Treasure Trails',
  rares:          'Rares',
  cosmetics:      'Cosmetics',
  codex:          'Codex',
  low_tier:       'Low Tier',
  materials:      'Misc',
  supplies:       'PVM Supplies',
};

const CAT_GROUPS = [
  { label: 'Combat',      cats: ['melee','magic','ranged','necromancy','hybrid','ammo','boss','codex','supplies'] },
  { label: 'Skills',      cats: ['herblore','artisan','farming','mining','prayer','archaeology','summoning','invention','runes'] },
  { label: 'Economy',     cats: ['food','materials','low_tier'] },
  { label: 'Collections', cats: ['rares','treasure_trails','cosmetics'] },
];


/* ─── Expensive tab ───────────────────────────────────────────── */
function ExpensiveTab({items, selected, onSelect, watchlist, onToggleWatch, threshold, description}) {
  const [sort, setSort] = useState({key:'high', dir:-1});

  const expThreshold = Number(threshold) || 500000000;

  const expItems = useMemo(() => {
    return items.filter(it => (it.high || it.low || 0) >= expThreshold);
  }, [items, expThreshold]);

  const sorted = useMemo(() => {
    return [...expItems].sort((a,b) => {
      if (sort.key === 'name') return sort.dir * a.name.localeCompare(b.name);
      const av = a[sort.key] ?? 0;
      const bv = b[sort.key] ?? 0;
      return sort.dir * (av < bv ? -1 : av > bv ? 1 : 0);
    });
  }, [expItems, sort]);

  const Th = ({k, label}) => h('th', {
    style:{cursor:'pointer', userSelect:'none'},
    onClick: () => setSort(s => ({key:k, dir: s.key===k ? -s.dir : -1}))
  }, label + (sort.key===k ? (sort.dir>0 ? ' ↑' : ' ↓') : ''));

  if (!expItems.length) return h('div', {className:'empty-state'},
    h('div', {style:{fontSize:32, marginBottom:8}}, '💎'),
    h('div', null, `No items at or above ${fmt.gp(expThreshold)}gp.`),
    h('div', {style:{fontSize:11, color:T.textDim, marginTop:4}}, 'Adjust the threshold in Settings.')
  );

  return h('div', {className:'tab-content'},
    description && h('div',{style:{padding:'8px 14px', borderBottom:`1px solid ${T.border}`, fontSize:12, color:T.textDim, fontStyle:'italic', lineHeight:1.5}}, description),
    h('div', {style:{padding:'8px 12px', fontSize:11, color:T.textDim, borderBottom:`1px solid ${T.border}`, display:'flex', gap:16}},
      h('span', null, `${expItems.length} items at or above ${fmt.gp(expThreshold)}gp`),
      h('span', {style:{color:T.textDim, fontSize:10}}, 'Adjust threshold in Settings')
    ),
    h('table', {className:'ge-table'},
      h('thead', null,
        h('tr', null,
          h(Th, {k:'name',      label:'Item'}),
          h(Th, {k:'high',      label:'Price'}),
          h(Th, {k:'change_1d', label:'24h'}),
          h(Th, {k:'volume',    label:'Volume'}),
          h('th', null, '')
        )
      ),
      h('tbody', null, sorted.map(it =>
        h('tr', {key:it.id, 'data-item-id':it.id,
          className: selected?.id===it.id ? 'selected' : '',
          onClick: () => onSelect(it)
        },
          h('td', null, it.name),
          h('td', {style:{color:T.gold}}, fmt.gp(it.high||it.low)+'gp'),
          h('td',null,h(ChangeDisplay,{change_1d:it.change_1d,price:it.high||it.low})),
          h('td', null, h(VolDisplay, {volume:it.volume, avgVolume:it.avgVolume})),
          h('td', null,
            h('button', {
              className:'star-btn',
              onClick: e => { e.stopPropagation(); onToggleWatch(it.id); }
            }, h('span', {className: watchlist.includes(it.id)?'star-on':'star-off'},
              watchlist.includes(it.id)?'★':'☆'
            ))
          )
        )
      ))
    )
  );
}

/* ─── Alch tab ────────────────────────────────────────────────── */
const ALCH_DEFAULT_COL_WIDTHS = {name:280, high:110, afterTax:110, alch:110, alchProfit:140, alchemiserProfit:170, star:30};
const ALCH_COL_ORDER = ['name', 'high', 'afterTax', 'alch', 'alchProfit', 'alchemiserProfit', 'star'];
function loadAlchColWidths() {
  try { return {...ALCH_DEFAULT_COL_WIDTHS, ...JSON.parse(localStorage.getItem('genius_alch_col_widths')||'{}')}; }
  catch { return {...ALCH_DEFAULT_COL_WIDTHS}; }
}

function AlchTab({items, selected, onSelect, watchlist, onToggleWatch, description}) {
  const [sort, setSort] = useState({key:'alchProfit', dir:-1});

  // Resizable columns — AlchTab has its own column set (Alch Value, Manual
  // Profit, Alchemiser Profit) that doesn't match ItemTable's, so this
  // duplicates the resize pattern rather than trying to force-share
  // ItemTable's hardcoded columns.
  const [colWidths, setColWidths] = useState(loadAlchColWidths);
  const colWidthsRef = useRef(colWidths);
  const startColResize = (key) => e => {
    e.preventDefault();
    e.stopPropagation();
    const table = e.currentTarget.closest('.ge-table-wrap')?.querySelector('table');
    const startW = colWidthsRef.current[key] || 110;
    const logicalTotal = Object.values(colWidthsRef.current).reduce((a,b) => a + (b||0), 0);
    const scaleFactor = table && logicalTotal ? (table.getBoundingClientRect().width / logicalTotal) : 1;
    const startX = e.clientX;
    const onMove = me => {
      const deltaReal = me.clientX - startX;
      const deltaLogical = scaleFactor ? deltaReal / scaleFactor : deltaReal;
      const w = Math.max(50, Math.round(startW + deltaLogical));
      colWidthsRef.current = {...colWidthsRef.current, [key]: w};
      setColWidths(colWidthsRef.current);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      try { localStorage.setItem('genius_alch_col_widths', JSON.stringify(colWidthsRef.current)); } catch {}
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const tableWrapRef = useRef(null);
  const [handleLefts, setHandleLefts] = useState({});
  useEffect(() => {
    const measure = () => {
      const wrap = tableWrapRef.current;
      if (!wrap) return;
      const ths = wrap.querySelectorAll('thead th');
      const wrapRect = wrap.getBoundingClientRect();
      const lefts = {};
      ALCH_COL_ORDER.filter(k => k !== 'star').forEach((k, i) => {
        const th = ths[i];
        if (th) lefts[k] = th.getBoundingClientRect().right - wrapRect.left + wrap.scrollLeft;
      });
      setHandleLefts(lefts);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [colWidths, items.length]);
  const overlayHandle = key => h('span', {
    key,
    onMouseDown: startColResize(key),
    className: 'col-resize-handle',
    style:{
      position:'absolute', top:0, bottom:0,
      left: (handleLefts[key] || 0) - 4,
      width:8, cursor:'col-resize', zIndex:10,
    },
  });

  const natureRunePrice = useMemo(() => {
    const nr = items.find(it => it.natureRunePrice);
    return nr ? nr.natureRunePrice : 0;
  }, [items]);

  const divineChargePrice = useMemo(() => {
    const dc = items.find(it => it.name && it.name.toLowerCase() === 'divine charge');
    return dc ? (dc.high || dc.low || 0) : 0;
  }, [items]);

  const chargePerItem = divineChargePrice ? Math.round(divineChargePrice / 500) : 0;

  const alchItems = useMemo(() => {
    return items
      .filter(it => it.signals && it.signals.includes('ALCH'))
      .map(it => {
        const price = it.high || it.low || 0;
        const alch = it.alch || 0;
        const afterTax = applyTax(price);
        const alchProfit = alch - price - natureRunePrice;
        const alchemiserProfit = alch - price - natureRunePrice - chargePerItem;
        return {...it, afterTax, alchProfit, alchemiserProfit};
      });
  }, [items, natureRunePrice, chargePerItem]);

  const Th = ({k, label}) => h('th', {
    className:'sortable', style:{cursor:'pointer', userSelect:'none'},
    onClick: () => setSort(s => ({key:k, dir: s.key===k ? -s.dir : -1}))
  }, label + (sort.key===k ? (sort.dir>0 ? ' ↑' : ' ↓') : ''));

  const sorted = useMemo(() => {
    return [...alchItems].sort((a,b) => {
      if (sort.key === 'name') {
        return sort.dir * a.name.localeCompare(b.name);
      }
      const av = a[sort.key] ?? 0;
      const bv = b[sort.key] ?? 0;
      return sort.dir * (av < bv ? -1 : av > bv ? 1 : 0);
    });
  }, [alchItems, sort]);

  const descStrip = description && h('div',{style:{padding:'8px 14px', borderBottom:`1px solid ${T.border}`, fontSize:12, color:T.textDim, fontStyle:'italic', lineHeight:1.5}}, description);

  if (!alchItems.length) return h('div', null,
    descStrip,
    h('div', {className:'empty-state'},
      h('div', {style:{fontSize:32, marginBottom:8}}, '🔥'),
      h('div', null, 'No alch opportunities right now.'),
      h('div', {style:{fontSize:11, color:T.textDim, marginTop:4}}, 'Items appear here when their alch value exceeds GE sell price (after 2% tax) plus the cost of a nature rune.')
    )
  );

  return h('div', {className:'tab-content'},
    descStrip,
    h('div', {style:{padding:'8px 12px', fontSize:11, color:T.textDim, borderBottom:`1px solid ${T.border}`, display:'flex', gap:16}},
      h('span', null, `${alchItems.length} item${alchItems.length!==1?'s':''} worth alching`),
      natureRunePrice ? h('span', null, `Nature rune: ${fmt.gp(natureRunePrice)}gp`) : null,
      divineChargePrice ? h('span', null, `Divine charge: ${fmt.gp(divineChargePrice)}gp (${fmt.gp(chargePerItem)}gp/item)`) : null
    ),
    h('div', {className:'ge-table-wrap', style:{position:'relative'}, ref:tableWrapRef},
    ALCH_COL_ORDER.filter(k => k !== 'star').map(k => overlayHandle(k)),
    h('table', {className:'ge-table', style:{tableLayout:'fixed', width:'max-content'}},
      h('colgroup', null,
        h('col', {style:{width:colWidths.name}}),
        h('col', {style:{width:colWidths.high}}),
        h('col', {style:{width:colWidths.afterTax}}),
        h('col', {style:{width:colWidths.alch}}),
        h('col', {style:{width:colWidths.alchProfit}}),
        h('col', {style:{width:colWidths.alchemiserProfit}}),
        h('col', {style:{width:colWidths.star}}),
      ),
      h('thead', null,
        h('tr', null,
          h(Th, {k:'name',             label:'Item'}),
          h(Th, {k:'high',             label:'GE Price'}),
          h(Th, {k:'afterTax',         label:'After Tax'}),
          h(Th, {k:'alch',             label:'Alch Value'}),
          h(Th, {k:'alchProfit',       label:'Manual Profit'}),
          h('th', {
            className:'sortable', style:{cursor:'pointer', userSelect:'none'},
            onClick: () => setSort(s => ({key:'alchemiserProfit', dir: s.key==='alchemiserProfit' ? -s.dir : -1}))
          },
            'Alchemiser Profit' + (sort.key==='alchemiserProfit' ? (sort.dir>0 ? ' ↑' : ' ↓') : ''),
            h('span', {
              title:'The Alchemiser device cannot hold items worth more than 500,000gp. Items above that threshold can\'t be alchemised this way, regardless of profit.',
              style:{marginLeft:5, color:T.textDim, cursor:'help', fontSize:11, border:`1px solid ${T.textDim}`, borderRadius:'50%', width:14, height:14, display:'inline-flex', alignItems:'center', justifyContent:'center'},
            }, '?')
          ),
          h('th', {style:{width:30}}, null)
        )
      ),
      h('tbody', null, sorted.map(it =>
        h('tr', {key:it.id, 'data-item-id':it.id,
          className: selected?.id===it.id ? 'selected' : '',
          onClick: () => onSelect(it)
        },
          h('td', null, it.name),
          h('td', null, fmt.gp(it.high||it.low)+'gp'),
          h('td', {style:{color:T.textDim}}, fmt.gp(it.afterTax)+'gp'),
          h('td', {style:{color:'#ce93d8'}}, fmt.gp(it.alch)+'gp'),
          h('td', {style:{color: it.alchProfit > 0 ? T.green : T.red}},
            (it.alchProfit > 0 ? '+' : '') + fmt.gp(it.alchProfit)+'gp'
          ),
          (it.high||it.low||0) > 500000
            ? h('td', {style:{color:T.textDim}, title:'Over the Alchemiser\'s 500,000gp item value limit'}, 'N/A')
            : h('td', {style:{color: it.alchemiserProfit > 0 ? T.green : T.red}},
                (it.alchemiserProfit > 0 ? '+' : '') + fmt.gp(it.alchemiserProfit)+'gp'
              ),
          h('td', null,
            h('button', {
              className:'star-btn',
              onClick: e => { e.stopPropagation(); onToggleWatch(it.id); }
            }, h('span', {className: watchlist.includes(it.id)?'star-on':'star-off'},
              watchlist.includes(it.id)?'★':'☆'
            ))
          )
        )
      ))
    )
    )
  );
}

/* ─── Sidebar order editor ────────────────────────────────────── */
function SidebarOrderEditor({navItems, order, onChange}) {
  const ordered = useMemo(() => {
    if (!order || !order.length) return navItems;
    const byId = Object.fromEntries(navItems.map(n => [n.id, n]));
    const known = order.map(id => byId[id]).filter(Boolean);
    const newOnes = navItems.filter(n => !order.includes(n.id));
    return [...known, ...newOnes];
  }, [navItems, order]);

  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);

  const onDrop = (idx) => {
    if (dragIdx === null) return;
    const arr = [...ordered];
    const [moved] = arr.splice(dragIdx, 1);
    arr.splice(idx, 0, moved);
    onChange(arr.map(n => n.id));
    setDragIdx(null); setOverIdx(null);
  };

  return h('div', null,
    ordered.map((item, idx) =>
      h('div', {
        key: item.id, draggable: true,
        className: 'drag-item' + (overIdx === idx ? ' drag-over' : ''),
        onDragStart: () => setDragIdx(idx),
        onDragOver:  e => { e.preventDefault(); setOverIdx(idx); },
        onDrop:      () => onDrop(idx),
        onDragEnd:   () => { setDragIdx(null); setOverIdx(null); },
        style: { opacity: dragIdx === idx ? 0.4 : 1 }
      },
        h('span', {style:{color:T.textDim, fontSize:14}}, '⠿'),
        h('span', {style:{fontSize:13}}, item.icon),
        h('span', {style:{fontSize:12, color:T.text}}, item.label)
      )
    )
  );
}

/* ─── GP input with K/M/B shorthand ──────────────────────────── */
function GpInput({value, onChange, placeholder, style}) {
  const [raw, setRaw] = useState(value ? String(value) : '');

  useEffect(() => {
    // Sync if parent value changes externally (e.g. edit mode)
    if (value !== undefined && value !== '' && value !== null) {
      setRaw(String(value));
    }
  }, []);

  const parsed = parseGP(raw);
  const preview = (raw.length > 0 && typeof parsed === 'number' && String(parsed) !== raw)
    ? fmt.gp(parsed) + 'gp'
    : null;

  const handleChange = e => {
    const v = e.target.value;
    setRaw(v);
    const p = parseGP(v);
    onChange(typeof p === 'number' ? p : v);
  };

  const handleBlur = () => {
    const p = parseGP(raw);
    if (typeof p === 'number') {
      setRaw(String(p));
      onChange(p);
    }
  };

  return h('div', {style:{position:'relative'}},
    h('input', {
      className:'ge-input', type:'text', placeholder: placeholder || '0',
      value: raw, onChange: handleChange, onBlur: handleBlur,
      style: {...(style||{}), paddingRight: preview ? 60 : undefined}
    }),
    preview && h('span', {style:{
      position:'absolute', right:8, top:'50%', transform:'translateY(-50%)',
      fontSize:10, color:T.gold, pointerEvents:'none', whiteSpace:'nowrap'
    }}, preview)
  );
}

/* ─── Item autocomplete ───────────────────────────────────────── */
function ItemAutocomplete({items, value, onChange, placeholder}) {
  const [query, setQuery] = useState(value||'');
  const [open, setOpen] = useState(false);

  useEffect(() => { setQuery(value||''); }, [value]);

  const filtered = useMemo(() => {
    if (!query || query.length < 2) return [];
    const q = query.toLowerCase();
    return items
      .filter(it => it.name.toLowerCase().includes(q))
      .slice(0, 25);
  }, [items, query]);

  return h('div', {style:{position:'relative'}},
    h('input', {
      className:'ge-input',
      value: query,
      placeholder: placeholder || 'Search item...',
      autoComplete: 'off',
      onChange: e => { setQuery(e.target.value); onChange(e.target.value); setOpen(true); },
      onFocus:  () => setOpen(true),
      onBlur:   () => setTimeout(() => setOpen(false), 150),
      style: {marginBottom: 0}
    }),
    open && filtered.length > 0 && h('div', {style:{
      position:'absolute', top:'100%', left:0, right:0, zIndex:200,
      background:T.panel, border:`1px solid ${T.border}`, borderRadius:3,
      maxHeight:200, overflowY:'auto', boxShadow:'0 4px 16px rgba(0,0,0,0.6)'
    }},
      filtered.map(it =>
        h('div', {
          key:it.id,
          style:{padding:'6px 10px', cursor:'pointer', fontSize:12, borderBottom:`1px solid ${T.borderDim}`, display:'flex', justifyContent:'space-between', alignItems:'center'},
          onMouseDown: () => { setQuery(it.name); onChange(it.name); setOpen(false); }
        },
          h('span', {style:{color:T.text}}, it.name),
          h('span', {style:{color:T.textDim, fontSize:10}}, fmt.gp(it.high||it.low)+'gp')
        )
      )
    )
  );
}

/* ─── Position modal ──────────────────────────────────────────── */
function PositionModal({items, position, onSave, onClose}) {
  const todayStr = new Date().toISOString().slice(0,10);
  const blank = { id:Date.now().toString(), item_name:'', quantity:'', cost_basis:'',
    target_price:'', target_profit_pct:'', stop_loss:'', status:'open', created_at:new Date().toISOString(), date_opened: todayStr };
  const [form, setForm] = useState(position ? {...position,
    target_price: position.target_price||'',
    stop_loss: position.stop_loss||'',
    target_profit_pct: position.target_profit_pct||'',
    date_opened: position.date_opened || (position.created_at ? position.created_at.slice(0,10) : todayStr),
  } : blank);
  const [createAlert, setCreateAlert] = useState(false);
  const set = k => e => setForm(f => ({...f, [k]:e.target.value}));
  const totalCost = form.quantity && form.cost_basis ? Number(form.quantity) * Number(form.cost_basis) : 0;

  const handleSave = () => {
    if (!form.item_name || !form.quantity || !form.cost_basis) return;
    onSave({...form,
      quantity: Number(form.quantity),
      cost_basis: Number(form.cost_basis),
      target_price: form.target_price ? Number(form.target_price) : null,
      stop_loss: form.stop_loss ? Number(form.stop_loss) : null,
      target_profit_pct: form.target_profit_pct ? Number(form.target_profit_pct) : null,
    }, createAlert);
  };

  return h('div', {className:'modal-overlay', onClick:e=>{if(e.target===e.currentTarget)onClose();}},
    h('div', {className:'modal'},
      h('div', {className:'modal-header'},
        h('div', {className:'detail-name', style:{fontSize:15}}, position ? 'Edit Position' : 'Add Position'),
        h('button', {className:'ge-btn', style:{padding:'2px 8px'}, onClick:onClose}, 'X')
      ),
      h('div', {className:'modal-body'},
        h('label', {className:'form-lbl'}, 'Item Name'),
        h(ItemAutocomplete, {
          items,
          value: form.item_name,
          onChange: name => setForm(f=>({...f, item_name:name})),
          placeholder: 'Search item...'
        }),
        h('div', {style:{marginBottom:12}}),

        h('div', {className:'form-grid-2'},
          h('div', null, h('label',{className:'form-lbl'},'Quantity'),
            h('input',{className:'ge-input',type:'number',min:1,placeholder:'e.g. 100',value:form.quantity,onChange:set('quantity')})),
          h('div', null, h('label',{className:'form-lbl'},'Cost Basis (per item)'),
            h(GpInput,{value:form.cost_basis, placeholder:'Price paid each', onChange:v=>setForm(f=>({...f,cost_basis:v}))}))
        ),

        totalCost > 0 && h('div', {style:{fontSize:11,color:T.textDim,marginBottom:12}},
          `Total cost: ${fmt.gp(totalCost)}gp`),

        h('div', {className:'form-grid-2', style:{marginBottom:12}},
          h('div', null,
            h('label',{className:'form-lbl'},'Date Opened'),
            h('div', {style:{display:'flex', gap:6, alignItems:'center'}},
              h('input',{className:'ge-input', id:'date-opened-input', type:'date', value:form.date_opened, onChange:set('date_opened'), style:{flex:1}}),
              h('button', {
                className:'ge-btn',
                style:{padding:'4px 8px', fontSize:14},
                title:'Pick a date',
                onClick: () => { const el = document.getElementById('date-opened-input'); el && (el.showPicker ? el.showPicker() : el.click()); },
              }, '📅')
            )
          )
        ),

        h('div', {className:'ge-section-head'}, 'Optional Targets'),
        h('div', {className:'form-grid-3'},
          h('div', null, h('label',{className:'form-lbl'},'Target Price'),
            h(GpInput,{value:form.target_price, placeholder:'Exit price', onChange:v=>setForm(f=>({...f,target_price:v}))})),
          h('div', null, h('label',{className:'form-lbl'},'Target Profit %'),
            h('input',{className:'ge-input',type:'number',placeholder:'e.g. 15',value:form.target_profit_pct,onChange:set('target_profit_pct')})),
          h('div', null, h('label',{className:'form-lbl'},'Stop-Loss Price'),
            h(GpInput,{value:form.stop_loss, placeholder:'Floor price', onChange:v=>setForm(f=>({...f,stop_loss:v}))}))
        ),

        form.target_price && h('label', {className:'row', style:{gap:8,marginBottom:12,cursor:'pointer',fontSize:11}},
          h('input',{type:'checkbox',checked:createAlert,onChange:e=>setCreateAlert(e.target.checked)}),
          h('span',null,'Create GE alert when target price is reached')
        ),

        h('div', {style:{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}},
          h('button',{className:'ge-btn',onClick:onClose},'Cancel'),
          h('button',{className:'ge-btn gold',onClick:handleSave}, position?'Update':'Add Position')
        )
      )
    )
  );
}

/* ─── Sell modal ──────────────────────────────────────────────── */
function SellModal({position, onSell, onClose}) {
  const [sellPrice, setSellPrice] = useState(position.currentPrice || '');
  const [qty, setQty] = useState(position.quantity);
  const sp = typeof sellPrice === 'number' ? sellPrice : Number(sellPrice) || 0;
  const q = Number(qty);
  const gross = sp * q;
  const tax   = Math.round(gross * 0.02);
  const net   = Math.round(sp > 50 ? sp * q * 0.98 : sp * q);
  const cost  = position.cost_basis * q;
  const pl    = net - cost;

  return h('div', {className:'modal-overlay', onClick:e=>{if(e.target===e.currentTarget)onClose();}},
    h('div', {className:'modal'},
      h('div', {className:'modal-header'},
        h('div', {className:'detail-name', style:{fontSize:15}}, `Sell: ${position.item_name}`),
        h('button', {className:'ge-btn', style:{padding:'2px 8px'}, onClick:onClose}, 'X')
      ),
      h('div', {className:'modal-body'},
        h('div', {className:'form-grid-2'},
          h('div', null, h('label',{className:'form-lbl'},'Sell Price (per item)'),
            h(GpInput,{value:sellPrice, onChange:v=>setSellPrice(v), placeholder:'Sell price'})),
          h('div', null, h('label',{className:'form-lbl'},`Quantity (max ${position.quantity})`),
            h('input',{className:'ge-input',type:'number',min:1,max:position.quantity,value:qty,
              onChange:e=>setQty(Math.min(Math.max(1,Number(e.target.value)),position.quantity))}))
        ),

        sp > 0 && h('div', {style:{background:'rgba(0,0,0,0.25)',borderRadius:4,padding:'10px',marginBottom:12}},
          h('div', {className:'ge-section-head', style:{fontSize:10,marginBottom:6}}, 'What if I sold now?'),
          [['Gross Sale Value', fmt.gp(gross)+'gp', null],
           ['GE Tax (2%)',      '-'+fmt.gp(tax)+'gp', T.red],
           ['Net Proceeds',     fmt.gp(net)+'gp', null],
           ['Cost Basis',       '-'+fmt.gp(cost)+'gp', null],
           ['Net P&L',          (pl>=0?'+':'')+fmt.gp(pl)+'gp', pl>=0?T.green:T.red],
          ].map(([l,v,c])=>h('div',{key:l,style:{display:'flex',justifyContent:'space-between',fontSize:11,marginBottom:3}},
            h('span',{style:{color:T.textDim}},l),
            h('span',{style:{color:c||T.text}},v)
          ))
        ),

        h('div', {style:{display:'flex',gap:8,justifyContent:'flex-end'}},
          h('button',{className:'ge-btn',onClick:onClose},'Cancel'),
          h('button',{className:'ge-btn gold',disabled:!sp||sp<=0,
            onClick:()=>onSell({id:position.id,sell_price:sp,quantity:q})
          },'Confirm Sale')
        )
      )
    )
  );
}

/* ─── Portfolio tab ───────────────────────────────────────────── */
function PortfolioTab({items, portfolio, onSavePosition, onDeletePosition, onSellPosition, onSelect, toast, devMode}) {
  // Diversification suggestions — dev-mode only, since these pull real
  // picks from the Almanac's trade-idea engine, which itself stays hidden
  // until Ben says it's ready to go public. Fetches its own copy of the
  // DXP intelligence data independent of whether the Almanac tab has ever
  // been opened this session.
  const [dxpData, setDxpData] = useState(null);
  useEffect(() => { if (devMode) window.genius?.getDxpIntelligence?.().then(d => setDxpData(d || {})); }, [devMode]);
  const priceById = useMemo(() => {
    const m = {};
    items.forEach(it => { if (it.id) m[String(it.id)] = it; });
    return m;
  }, [items]);
  const [showModal,   setShowModal]   = useState(false);
  const [editPos,     setEditPos]     = useState(null);
  const [sellModal,   setSellModal]   = useState(null);
  const [showClosed,  setShowClosed]  = useState(false);
  const [ctxMenu,     setCtxMenu]     = useState(null); // {x, y, pos}

  const positions  = portfolio?.positions || [];
  const taxStats   = portfolio?.tax_stats  || {};

  const enriched = useMemo(() => positions.map(pos => {
    const item = items.find(it => it.name.toLowerCase() === (pos.item_name||'').toLowerCase());
    const currentPrice = item ? (item.high || item.low || 0) : 0;
    const currentValue = currentPrice * pos.quantity;
    const costValue    = pos.cost_basis * pos.quantity;
    const grossPL      = currentValue - costValue;
    const tax          = Math.round(currentValue * 0.02);
    const netPL        = grossPL - tax;
    const plPct        = costValue > 0 ? (grossPL / costValue) * 100 : 0;
    const targetDist   = pos.target_price ? pos.target_price - currentPrice : null;
    const stopDist     = pos.stop_loss    ? currentPrice - pos.stop_loss    : null;
    const category      = item?.categories?.[0] || 'misc';
    return {...pos, currentPrice, currentValue, costValue, grossPL, tax, netPL, plPct, targetDist, stopDist, category};
  }), [positions, items]);

  const openPos   = enriched.filter(p => p.status !== 'sold');
  const closedPos = enriched.filter(p => p.status === 'sold');

  const totalInvested = openPos.reduce((s,p) => s+p.costValue, 0);
  const totalCurrent  = openPos.reduce((s,p) => s+p.currentValue, 0);
  const unrealizedPL  = totalCurrent - totalInvested;
  const unrealizedPct = totalInvested > 0 ? (unrealizedPL / totalInvested) * 100 : 0;
  const realizedPL    = closedPos.reduce((s,p) => s+(p.realized_pl||0), 0);

  const PORTFOLIO_TIERS = [
    { threshold: 100000e6, icon:'🐉', label:'100B Investor',  sub:'Generational wealth' },
    { threshold:  50000e6, icon:'🌌', label:'50B Investor',   sub:'Legendary wealth' },
    { threshold:  25000e6, icon:'👑', label:'25B Investor',   sub:'Elite investor' },
    { threshold:  10000e6, icon:'💠', label:'10B Investor',   sub:'Top tier trader' },
    { threshold:   5000e6, icon:'💎', label:'5B Investor',    sub:'Serious money' },
    { threshold:   2500e6, icon:'🏦', label:'2.5B Investor',  sub:'Institutional money' },
    { threshold:   1000e6, icon:'🥇', label:'1B Investor',    sub:'The billionaire club' },
    { threshold:    500e6, icon:'🦈', label:'500M Investor',  sub:'Big fish' },
    { threshold:    250e6, icon:'🐟', label:'250M Investor',  sub:'High-net-worth trader' },
    { threshold:    100e6, icon:'📈', label:'100M Investor',  sub:'Getting serious' },
    { threshold:     10e6, icon:'🌱', label:'10M Investor',   sub:'First steps' },
  ];

  const tierIndex = PORTFOLIO_TIERS.findIndex(t => totalCurrent >= t.threshold);
  const currentTier = tierIndex >= 0 ? PORTFOLIO_TIERS[tierIndex] : null;
  const nextTier    = tierIndex > 0  ? PORTFOLIO_TIERS[tierIndex - 1] : null;
  const earnedTiers = tierIndex >= 0 ? PORTFOLIO_TIERS.slice(tierIndex + 1) : [];

  const milestones = useMemo(() => {
    const ms = [];
    if (!closedPos.length) return ms;

    const profits = closedPos.map(p => p.realized_pl || 0);
    const biggestWin  = Math.max(...profits);
    const biggestLoss = Math.min(...profits);
    const biggestWinPos  = closedPos.find(p => (p.realized_pl||0) === biggestWin);
    const biggestLossPos = closedPos.find(p => (p.realized_pl||0) === biggestLoss);
    const totalRealized  = profits.reduce((s,n) => s+n, 0);

    ms.push({ icon:'📦', label:'Trades Closed',  value: closedPos.length.toLocaleString(), sub: 'Total closed positions' });
    if (biggestWin > 0)  ms.push({ icon:'🏆', label:'Biggest Win',  value: '+'+fmt.gp(biggestWin)+'gp',  sub: biggestWinPos?.item_name || '' });
    if (biggestLoss < 0) ms.push({ icon:'💀', label:'Biggest Loss', value: fmt.gp(biggestLoss)+'gp',     sub: biggestLossPos?.item_name || '' });
    if (totalRealized >= 100e6) ms.push({ icon:'💰', label:'100m Club',   value: fmt.gp(totalRealized)+'gp total', sub: 'Total realized profit' });
    if (totalRealized >= 1e9)   ms.push({ icon:'💎', label:'Billionaire', value: fmt.gp(totalRealized)+'gp total', sub: 'Total realized profit' });
    if (closedPos.length >= 10)  ms.push({ icon:'🔁', label:'10 Trades',  value: closedPos.length+' closed', sub: 'Veteran trader' });
    if (closedPos.length >= 100) ms.push({ icon:'⚙️', label:'100 Trades', value: closedPos.length+' closed', sub: 'Market machine' });
    // Flawless — best streak of consecutive profitable trades
    let bestStreak = 0, currentStreak = 0;
    for (const p of closedPos) {
      if ((p.realized_pl||0) > 0) { currentStreak++; bestStreak = Math.max(bestStreak, currentStreak); }
      else currentStreak = 0;
    }
    const isCurrentlyFlawless = profits.every(p => p > 0) && closedPos.length >= 5;
    if (bestStreak >= 5)
      ms.push({ icon:'✨', label:'Flawless', value: isCurrentlyFlawless ? closedPos.length+' for '+closedPos.length : 'Best streak: '+bestStreak, sub: isCurrentlyFlawless ? 'Every trade profitable' : 'Streak broken — best was '+bestStreak, dimmed: !isCurrentlyFlawless });
    return ms;
  }, [closedPos, totalCurrent]);

  // Allocation by item
  const allocations = useMemo(() => {
    return openPos
      .filter(p => p.currentValue > 0)
      .map(p => ({
        name: p.item_name,
        val: p.currentValue,
        pct: totalCurrent > 0 ? (p.currentValue / totalCurrent) * 100 : 0,
        category: p.category,
      }))
      .sort((a, b) => b.val - a.val);
  }, [openPos, totalCurrent]);

  // Allocation by category — same idea as by-item, but grouped, so a
  // concentration warning can catch "all your eggs across 5 items that
  // are all secretly the same skill/category," not just one item.
  const ITEM_CONCENTRATION_WARN_PCT = 30;
  const CATEGORY_CONCENTRATION_WARN_PCT = 50;
  const categoryAllocations = useMemo(() => {
    const byCat = {};
    openPos.filter(p => p.currentValue > 0).forEach(p => {
      byCat[p.category] = (byCat[p.category] || 0) + p.currentValue;
    });
    return Object.entries(byCat)
      .map(([category, val]) => ({ category, val, pct: totalCurrent > 0 ? (val / totalCurrent) * 100 : 0 }))
      .sort((a, b) => b.val - a.val);
  }, [openPos, totalCurrent]);
  const topItemAlloc = allocations[0];
  const topCategoryAlloc = categoryAllocations[0];
  // Rares are an exception, not a diversification mistake — owning one
  // partyhat will always dwarf the rest of a portfolio by virtue of being
  // rare, not because the person failed to spread their capital around.
  // Warning about that every time would just be noise with no real action
  // to take, so skip it when the dominant holding is a rare.
  const dominatedByRare = topItemAlloc?.category === 'rares' || topCategoryAlloc?.category === 'rares';
  const concentrationWarning = !dominatedByRare && (
    (topItemAlloc && topItemAlloc.pct >= ITEM_CONCENTRATION_WARN_PCT)
    || (topCategoryAlloc && topCategoryAlloc.pct >= CATEGORY_CONCENTRATION_WARN_PCT)
  );

  // Real picks pulled from the Almanac's trade-idea engine, steered toward
  // categories the portfolio barely touches — the best payout candidate
  // currently dominating Recommendations might be the SAME category
  // that's already overweight here, which wouldn't help diversify at all.
  const UNDEREXPOSED_CATEGORY_PCT = 15;
  const diversificationSuggestions = useMemo(() => {
    if (!devMode || !dxpData) return [];
    const overweightCategories = new Set(
      categoryAllocations.filter(c => c.pct >= UNDEREXPOSED_CATEGORY_PCT && c.category !== 'rares').map(c => c.category)
    );
    const candidates = computeRecommendationCandidates(dxpData, priceById)
      .filter(r => !r.negligible && !overweightCategories.has(r.category))
      .sort((a, b) => (b.trade.profitForLimit ?? -Infinity) - (a.trade.profitForLimit ?? -Infinity));
    // Best one per underexposed category, not just the top N overall —
    // otherwise this could still surface 5 picks from a single category.
    const seen = new Set();
    const picks = [];
    for (const r of candidates) {
      if (seen.has(r.category)) continue;
      seen.add(r.category);
      picks.push(r);
      if (picks.length >= 5) break;
    }
    return picks;
  }, [devMode, dxpData, priceById, categoryAllocations]);

  const handleSave = async (pos, createAlert) => {
    await onSavePosition(pos);
    if (createAlert && pos.target_price) {
      await window.genius?.saveAlert({id:`p-${pos.id}`, item_name:pos.item_name, condition:'above', price:pos.target_price});
    }
    if (pos.stop_loss) {
      await window.genius?.saveAlert({id:`sl-${pos.id}`, item_name:pos.item_name, condition:'below', price:pos.stop_loss});
    }
    setShowModal(false); setEditPos(null);
    toast(editPos ? 'Position updated' : 'Position added', 'success');
  };

  return h('div', {className:'tab-content'},

    h('div',{style:{padding:'8px 14px', borderBottom:`1px solid ${T.border}`, fontSize:12, color:T.textDim, fontStyle:'italic', lineHeight:1.5}}, TAB_DESCRIPTIONS.portfolio),

    // Overview
    h('div', {className:'overview-grid'},
      h('div',{className:'ov-card'}, h('div',{className:'ov-val'},fmt.gp(totalInvested)+'gp'), h('div',{className:'ov-lbl'},'Total Invested')),
      h('div',{className:'ov-card'}, h('div',{className:'ov-val'},fmt.gp(totalCurrent)+'gp'),  h('div',{className:'ov-lbl'},'Current Value')),
      h('div',{className:'ov-card'},
        h('div',{className:'ov-val '+(unrealizedPL>=0?'pct-up':'pct-down')},
          (unrealizedPL>=0?'+':'')+fmt.gp(unrealizedPL)+'gp'),
        h('div',{className:'ov-lbl'},`Unrealized P&L (${unrealizedPct>=0?'+':''}${unrealizedPct.toFixed(1)}%)`)
      ),
      h('div',{className:'ov-card'},
        h('div',{className:'ov-val '+(realizedPL>=0?'pct-up':'pct-down')},
          (realizedPL>=0?'+':'')+fmt.gp(realizedPL)+'gp'),
        h('div',{className:'ov-lbl'},'Realized P&L')
      ),
    ),

    // Toolbar
    h('div',{style:{padding:'8px 12px',borderBottom:`1px solid ${T.border}`,display:'flex',justifyContent:'space-between',alignItems:'center'}},
      h('span',{style:{fontSize:12,color:T.textDim}},`${openPos.length} open position${openPos.length!==1?'s':''}`),
      h('button',{className:'ge-btn gold',onClick:()=>{setEditPos(null);setShowModal(true);}}, '+ Add Position')
    ),

    // Positions table
    openPos.length === 0
      ? h('div',{className:'empty-state'},
          h('div',{style:{fontSize:32,marginBottom:8}},'📊'),
          h('div',null,'No open positions.'),
          h('div',{style:{fontSize:12,color:T.textDim,marginTop:8,lineHeight:1.7,maxWidth:360,textAlign:'center'}},
            'Hit "+ Add Position" above to log a buy.',h('br',null),
            'GEnius will track live P&L, set target price alerts, and show your portfolio allocation.',h('br',null),
            'Sold positions move to the history section below.'
          )
        )
      : h('table',{className:'ge-table'},
          h('thead',null, h('tr',null,
            h('th',null,'Item'), h('th',null,'Qty'), h('th',null,'Cost/ea'),
            h('th',null,'Current'), h('th',null,'Value'),
            h('th',null,'Gross P&L'), h('th',null,'Net P&L'), h('th',null,'P&L %'),
            h('th',null,'Held'), h('th',null,'Target'), h('th',null,'')
          )),
          h('tbody',null, openPos.map(pos =>
            h('tr',{key:pos.id},
              h('td',{
                style: onSelect ? {cursor:'pointer', color:T.gold} : null,
                onClick: onSelect ? () => { const it = items.find(i => i.name.toLowerCase()===(pos.item_name||'').toLowerCase()); if(it) onSelect(it); } : null,
              }, pos.item_name),
              h('td',null,pos.quantity.toLocaleString()),
              h('td',null,fmt.gp(pos.cost_basis)+'gp'),
              h('td',{style:{color:T.gold}},fmt.gp(pos.currentPrice)+'gp'),
              h('td',null,fmt.gp(pos.currentValue)+'gp'),
              h('td',{className:pos.grossPL>=0?'pct-up':'pct-down'},(pos.grossPL>=0?'+':'')+fmt.gp(pos.grossPL)+'gp'),
              h('td',{className:pos.netPL>=0?'pct-up':'pct-down'},(pos.netPL>=0?'+':'')+fmt.gp(pos.netPL)+'gp'),
              h('td',{className:pos.plPct>=0?'pct-up':'pct-down'},fmt.pct(pos.plPct)),
              h('td',{style:{color:T.textDim}},(() => {
                const d = pos.date_opened || pos.created_at;
                if (!d) return '—';
                const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
                return days === 0 ? 'Today' : days === 1 ? '1d' : days < 30 ? `${days}d` : days < 365 ? `${Math.floor(days/30)}mo` : `${(days/365).toFixed(1)}y`;
              })()),
              h('td',{style:{color:pos.target_price?(pos.currentPrice>=pos.target_price?T.green:T.textDim):T.textDim}},
                pos.target_price ? fmt.gp(pos.target_price)+'gp' : '—'),
              h('td',null,
                h('div',{style:{display:'flex',gap:3}},
                  h('button',{className:'ge-btn',style:{padding:'2px 6px',fontSize:10},
                    onClick:()=>{setEditPos(pos);setShowModal(true);}},'Edit'),
                  h('button',{className:'ge-btn',style:{padding:'2px 6px',fontSize:10,borderColor:T.green},
                    onClick:()=>setSellModal({...pos, currentPrice:pos.currentPrice})},'Sell'),
                  h('button',{className:'ge-btn danger',style:{padding:'2px 6px',fontSize:10},
                    onClick:async()=>{if(confirm(`Delete position: ${pos.item_name}?`)){await onDeletePosition(pos.id);toast('Deleted','info');}}},'Del')
                )
              )
            )
          ))
        ),

    // Diversification warning — flags real concentration risk in tracked
    // capital, separate from the Almanac's own diversification logic in
    // Recommendations (that one shapes what gets suggested; this one
    // reacts to what you've actually already bought).
    totalCurrent > 0 && concentrationWarning && h('div',{style:{padding:'12px',marginTop:4,borderTop:`1px solid ${T.border}`}},
      h('div',{style:{fontSize:11, color:T.gold, border:`1px solid ${T.borderDim}`, borderRadius:4, padding:'8px 10px'}},
        '⚠ ', h('b',null,'Concentration risk: '),
        topItemAlloc && topItemAlloc.pct >= ITEM_CONCENTRATION_WARN_PCT && h('span', null,
          `${topItemAlloc.pct.toFixed(0)}% of your tracked portfolio is in ${topItemAlloc.name} alone. `
        ),
        topCategoryAlloc && topCategoryAlloc.pct >= CATEGORY_CONCENTRATION_WARN_PCT && h('span', null,
          `${topCategoryAlloc.pct.toFixed(0)}% is in ${CAT_LABEL[topCategoryAlloc.category] || topCategoryAlloc.category} items overall. `
        ),
        'A single item or category dropping hits you a lot harder than if this were spread out.'
      )
    ),

    // Diversification suggestions — dev-mode only. Uses the Almanac's
    // trade-idea engine to FIND worthwhile items in underexposed
    // categories, but deliberately doesn't show the DXP profit/timing
    // figures here — those imply a short-term flip, and Portfolio isn't
    // necessarily that (Ben: "the portfolio isn't always for short term
    // flips and trades... just some item suggestions"). Just the item and
    // category, nothing tying it to a buy/sell day.
    devMode && diversificationSuggestions.length > 0 && h('div',{style:{padding:'12px',marginTop:4,borderTop:`1px solid ${T.border}`}},
      h('div',{className:'ge-section-head'},'Diversification suggestions'),
      h('div',{style:{fontSize:11,color:T.textDim,fontStyle:'italic',marginBottom:8}},
        'Items worth a look in categories your portfolio barely touches — not financial advice, and not tied to any particular timing. Click one to check it out.'
      ),
      diversificationSuggestions.map(r => h('div',{
        key:r.id, style:{padding:'6px 0',borderBottom:`1px solid ${T.borderDim}`,cursor: onSelect?'pointer':'default'},
        onClick: onSelect ? ()=>onSelect(priceById[r.id]) : undefined,
      },
        h('div',{style:{color:T.gold,fontSize:12}},r.name),
        h('div',{style:{color:T.textDim,fontSize:10}},CAT_LABEL[r.category] || r.category),
      ))
    ),

    // Allocation
    totalCurrent > 0 && allocations.length > 0 && h('div',{style:{padding:'12px',marginTop:4,borderTop:`1px solid ${T.border}`}},
      h('div',{className:'ge-section-head'},'Portfolio Allocation'),
      allocations.map(({name,val,pct}) => {
        const allocItem = onSelect && items && items.find(i => i.name.toLowerCase() === name.toLowerCase());
        return h('div',{key:name,style:{marginBottom:8}},
          h('div',{style:{display:'flex',justifyContent:'space-between',fontSize:11,marginBottom:2}},
            h('span',{
              style:{color: allocItem ? T.gold : T.text, cursor: allocItem ? 'pointer' : 'default'},
              onClick: allocItem ? () => onSelect(allocItem) : undefined,
            },name),
            h('span',{style:{color:T.textDim}},`${fmt.gp(val)}gp (${pct.toFixed(1)}%)`)
          ),
          h('div',{className:'alloc-bar-bg'},
            h('div',{className:'alloc-bar-fg',style:{width:`${pct}%`}})
          )
        );
      })
    ),

    // Allocation by category
    totalCurrent > 0 && categoryAllocations.length > 0 && h('div',{style:{padding:'12px',marginTop:4,borderTop:`1px solid ${T.border}`}},
      h('div',{className:'ge-section-head'},'By Category'),
      categoryAllocations.map(({category,val,pct}) =>
        h('div',{key:category,style:{marginBottom:8}},
          h('div',{style:{display:'flex',justifyContent:'space-between',fontSize:11,marginBottom:2}},
            h('span',{style:{color: pct >= CATEGORY_CONCENTRATION_WARN_PCT ? T.gold : T.text}}, CAT_LABEL[category] || category),
            h('span',{style:{color:T.textDim}},`${fmt.gp(val)}gp (${pct.toFixed(1)}%)`)
          ),
          h('div',{className:'alloc-bar-bg'},
            h('div',{className:'alloc-bar-fg',style:{width:`${pct}%`, background: pct >= CATEGORY_CONCENTRATION_WARN_PCT ? T.gold : undefined}})
          )
        )
      )
    ),

    // Tax tracking
    h('div',{style:{padding:'12px',borderTop:`1px solid ${T.border}`,marginTop:4}},
      h('div',{className:'ge-section-head'},'GE Tax Tracking'),
      h('div',{className:'overview-grid'},
        h('div',{className:'ov-card'},h('div',{className:'ov-val'},fmt.gp(taxStats.today_tax||0)+'gp'),h('div',{className:'ov-lbl'},'Tax Today')),
        h('div',{className:'ov-card'},h('div',{className:'ov-val'},fmt.gp(taxStats.week_tax||0)+'gp'),h('div',{className:'ov-lbl'},'Tax This Week')),
        h('div',{className:'ov-card'},h('div',{className:'ov-val'},fmt.gp(taxStats.month_tax||0)+'gp'),h('div',{className:'ov-lbl'},'Tax This Month')),
        h('div',{className:'ov-card'},h('div',{className:'ov-val'},fmt.gp(taxStats.lifetime_tax||0)+'gp'),h('div',{className:'ov-lbl'},'Lifetime Tax')),
      )
    ),

    // Closed positions
    currentTier && h('div',{style:{padding:'12px',borderTop:`1px solid ${T.border}`}},
      h('div',{className:'ge-section-head'},'Investor Tier'),
      h('div',{style:{display:'flex',flexWrap:'wrap',gap:8,alignItems:'flex-start'}},
        // Next tier — goal badge
        nextTier && h('div',{key:'next',title:`${nextTier.label} · ${nextTier.sub}`,style:{
          display:'flex',flexDirection:'column',alignItems:'center',gap:3,
          padding:'8px 12px',borderRadius:4,minWidth:68,
          border:`1px dashed ${T.borderDim}`,background:T.panel,opacity:0.6,
        }},
          h('div',{style:{fontSize:20,filter:'grayscale(1)'}},nextTier.icon),
          h('div',{style:{fontSize:11,fontWeight:'bold',color:T.textDim}},nextTier.label.replace(' Investor','')),
          h('div',{style:{fontSize:10,color:T.textDim}},'Next'),
        ),
        // Current tier — highlighted
        h('div',{key:'cur',title:`${currentTier.label} · ${currentTier.sub}`,style:{
          display:'flex',flexDirection:'column',alignItems:'center',gap:3,
          padding:'8px 12px',borderRadius:4,minWidth:68,
          border:`1.5px solid ${T.gold}`,background:`rgba(201,168,76,0.1)`,
        }},
          h('div',{style:{fontSize:20}},currentTier.icon),
          h('div',{style:{fontSize:11,fontWeight:'bold',color:T.gold}},currentTier.label.replace(' Investor','')),
          h('div',{style:{fontSize:10,color:T.goldBright}},'Current'),
        ),
        // Earned lower tiers — faded
        earnedTiers.map(t => h('div',{key:t.label,title:`${t.label} · ${t.sub}`,style:{
          display:'flex',flexDirection:'column',alignItems:'center',gap:3,
          padding:'8px 12px',borderRadius:4,minWidth:68,
          border:`1px solid ${T.borderDim}`,background:T.panel,opacity:0.55,
        }},
          h('div',{style:{fontSize:20}},t.icon),
          h('div',{style:{fontSize:11,fontWeight:'bold',color:T.text}},t.label.replace(' Investor','')),
        )),
      ),
      h('div',{style:{fontSize:11,color:T.textDim,marginTop:8}},
        currentTier.label+' · '+currentTier.sub+' · '+fmt.gp(totalCurrent)+'gp invested'
      ),
    ),

    milestones.length > 0 && h('div',{style:{padding:'12px',borderTop:`1px solid ${T.border}`}},
      h('div',{className:'ge-section-head'},'Achievements'),
      h('div',{style:{display:'flex',flexWrap:'wrap',gap:8}},
        milestones.map((m,i) => h('div',{key:i,style:{
          display:'flex',flexDirection:'column',alignItems:'center',gap:3,
          padding:'8px 12px',borderRadius:4,minWidth:68,
          border:`1.5px solid ${m.dimmed ? T.borderDim : T.gold}`,
          background: m.dimmed ? T.panel : `rgba(201,168,76,0.1)`,
          opacity: m.dimmed ? 0.5 : 1,
        }},
          h('div',{style:{fontSize:20,filter:m.dimmed?'grayscale(1)':'none'}},m.icon),
          h('div',{style:{fontSize:11,fontWeight:'bold',color:m.dimmed?T.textDim:T.gold}},m.label),
          m.value && h('div',{style:{fontSize:12,fontWeight:'bold',color:m.dimmed?T.textDim:T.textBright,marginTop:1}},m.value),
          h('div',{style:{fontSize:10,color:T.textDim,marginTop:1,textAlign:'center'}},m.sub),
        ))
      )
    ),

    closedPos.length > 0 && h('div',{style:{padding:'12px',borderTop:`1px solid ${T.border}`}},
      h('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer',marginBottom:showClosed?8:0},
        onClick:()=>setShowClosed(s=>!s)},
        h('div',{className:'ge-section-head',style:{margin:0}},`Closed Positions (${closedPos.length})`),
        h('span',{style:{color:T.textDim}},showClosed?'▲':'▼')
      ),
      showClosed && h('table',{className:'ge-table'},
        h('thead',null,h('tr',null,
          h('th',null,'Item'),h('th',null,'Qty'),h('th',null,'Cost/ea'),
          h('th',null,'Sold At'),h('th',null,'Realized P&L')
        )),
        h('tbody',null, closedPos.map(pos=>
          h('tr',{key:pos.id,
            onContextMenu: e => { e.preventDefault(); setCtxMenu({x:e.clientX, y:e.clientY, pos}); },
            style:{cursor:'context-menu'},
          },
            h('td',null,pos.item_name),
            h('td',null,(pos.sold_quantity||pos.quantity).toLocaleString()),
            h('td',null,fmt.gp(pos.cost_basis)+'gp'),
            h('td',{style:{color:T.gold}},fmt.gp(pos.sold_price||0)+'gp'),
            h('td',{className:(pos.realized_pl||0)>=0?'pct-up':'pct-down'},
              (pos.realized_pl>=0?'+':'')+fmt.gp(pos.realized_pl||0)+'gp')
          )
        ))
      )
    ),

    // Closed position context menu
    ctxMenu && h('div', {
      style:{position:'fixed', inset:0, zIndex:800},
      onClick: () => setCtxMenu(null),
      onContextMenu: e => { e.preventDefault(); setCtxMenu(null); },
    },
      h('div', {style:{
        position:'fixed',
        left: ctxMenu.x + 180 > window.innerWidth  ? ctxMenu.x - 160 : ctxMenu.x,
        top:  ctxMenu.y + 100 > window.innerHeight ? ctxMenu.y - 80  : ctxMenu.y,
        zIndex:801,
        background:T.panel2, border:`1px solid ${T.border}`, borderRadius:4,
        boxShadow:'0 4px 12px rgba(0,0,0,0.5)', minWidth:160, overflow:'hidden',
      }},
        h('div', {style:{padding:'6px 8px', fontSize:10, color:T.textDim, borderBottom:`1px solid ${T.borderDim}`}},
          ctxMenu.pos.item_name
        ),
        h('div', {
          onClick: async () => {
            await onDeletePosition(ctxMenu.pos.id);
            setCtxMenu(null);
            toast('Position removed', 'success');
          },
          style:{padding:'8px 12px', fontSize:12, color:T.red, cursor:'pointer', display:'flex', alignItems:'center', gap:6},
          onMouseEnter: e => e.currentTarget.style.background = 'rgba(229,57,53,0.1)',
          onMouseLeave: e => e.currentTarget.style.background = 'transparent',
        }, '🗑 Delete position'),
      )
    ),

    // Modals
    showModal && h(PositionModal, {items, position:editPos, onClose:()=>{setShowModal(false);setEditPos(null);}, onSave:handleSave}),
    sellModal  && h(SellModal,    {position:sellModal, onClose:()=>setSellModal(null),
      onSell: async (opts) => {
        const res = await onSellPosition(opts);
        setSellModal(null);
        if (res?.success) toast(`Sold! Net P&L: ${res.realized_pl>=0?'+':''}${fmt.gp(res.realized_pl)}gp`, 'success');
      }
    })
  );
}

/* ─── History population popup ───────────────────────────────── */
function HistoryPopup({state, onDismiss}) {
  if (!state) return null;
  // Always driven by the REAL persisted stored/total counts — never a
  // per-session counter that restarts at 0. That per-session counter
  // (items processed in just this run) is what made a resumed,
  // already-mostly-complete backfill look like it had lost hundreds or
  // thousands of items of progress on every single relaunch, when
  // nothing was actually lost (see SESSION_LOG.md, 2026-06-26).
  // initial300Done is persisted across restarts too, so an interruption
  // during the first 300 correctly resumes still showing "first 300"
  // messaging instead of jumping straight to "background" framing.
  const { stored, total, initial300Done, fullyComplete } = state;
  const pct = total > 0 ? Math.round((stored / total) * 100) : 0;

  return h('div', {style:{
    position:'fixed', bottom:20, right:20, zIndex:900,
    background:T.panel, border:`1px solid ${T.border}`,
    borderRadius:6, padding:'14px 16px', width:320,
    boxShadow:'0 4px 20px rgba(0,0,0,0.6)'
  }},
    h('div', {style:{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8}},
      h('div', {style:{fontSize:12, fontWeight:'bold', color:T.goldBright}},
        fullyComplete
          ? '✓ Price history complete'
          : initial300Done
            ? '📊 Building history in background...'
            : '📊 Building price history...'
      ),
      h('button', {
        className:'ge-btn', style:{padding:'1px 8px', fontSize:10},
        onClick:onDismiss
      }, '✕')
    ),

    !initial300Done && h('div', {style:{fontSize:11, color:T.textDim, marginBottom:10, lineHeight:1.5}},
      `Fetching history for the most traded items (${stored}/300). `,
      'After this, history builds in the background — any item you open populates immediately.'
    ),

    initial300Done && !fullyComplete && h('div', {style:{fontSize:11, color:T.textDim, marginBottom:10, lineHeight:1.5}},
      `${stored.toLocaleString()} of ${total.toLocaleString()} items loaded. `,
      'You can dismiss this — history continues even if hidden, and picks up where it left off if interrupted.'
    ),

    fullyComplete && h('div', {style:{fontSize:11, color:T.textDim, marginBottom:10}},
      'All GE items have price history. You\'re fully loaded.'
    ),

    h('div', {style:{background:'rgba(0,0,0,0.3)', borderRadius:3, height:6, overflow:'hidden'}},
      h('div', {style:{
        height:'100%', borderRadius:3,
        width: fullyComplete ? '100%' : `${pct}%`,
        background: fullyComplete ? T.green : initial300Done ? T.blue : T.gold,
        transition:'width 0.5s'
      }})
    ),
    !fullyComplete && h('div', {style:{fontSize:10, color:T.textDim, marginTop:4, display:'flex', justifyContent:'space-between'}},
      h('span', null, `${stored.toLocaleString()} / ${total.toLocaleString()} items`),
      h('span', null, `${pct}%`)
    )
  );
}

/* ─── Market Indexes Tab ─────────────────────────────────────── */
const INDEXES = [
  {
    id: 'cti', name: 'Common Trade Index', color: '#c9a84c',
    items: [
      {id:453,name:'Coal'},{id:2353,name:'Steel bar'},{id:444,name:'Gold ore'},
      {id:561,name:'Nature rune'},{id:560,name:'Death rune'},{id:7936,name:'Pure essence'},
      {id:1515,name:'Yew logs'},{id:1513,name:'Magic logs'},{id:1739,name:'Cowhide'},
      {id:377,name:'Raw lobster'},{id:7944,name:'Raw monkfish'},{id:1779,name:'Flax'},
      {id:1761,name:'Soft clay'},{id:225,name:'Limpwurt root'},{id:231,name:'Snape grass'},
      {id:3000,name:'Clean snapdragon'},{id:263,name:'Clean kwuarm'},{id:4151,name:'Abyssal whip'},
      {id:11732,name:'Dragon boots'},{id:11838,name:'Rune armour set (lg)'},{id:10034,name:'Red chinchompa'},
      {id:8778,name:'Oak plank'},{id:385,name:'Shark'},{id:1753,name:'Green dragonhide'},
      {id:536,name:'Dragon bones'},{id:2,name:'Cannonball'},{id:11284,name:'Dragonfire shield'},
    ],
  },
  {
    id: 'rune', name: 'Rune Index', color: '#7986cb',
    items: [
      {id:556,name:'Air rune'},{id:558,name:'Mind rune'},{id:555,name:'Water rune'},
      {id:557,name:'Earth rune'},{id:554,name:'Fire rune'},{id:559,name:'Body rune'},
      {id:564,name:'Cosmic rune'},{id:562,name:'Chaos rune'},{id:561,name:'Nature rune'},
      {id:563,name:'Law rune'},{id:560,name:'Death rune'},{id:9075,name:'Astral rune'},
      {id:565,name:'Blood rune'},{id:566,name:'Soul rune'},{id:21773,name:'Armadyl rune'},
      {id:4694,name:'Steam rune'},{id:4695,name:'Mist rune'},{id:4696,name:'Dust rune'},
      {id:4697,name:'Smoke rune'},{id:4698,name:'Mud rune'},{id:4699,name:'Lava rune'},
    ],
  },
  {
    id: 'log', name: 'Log Index', color: '#8d6e63',
    items: [
      {id:1511,name:'Logs'},{id:2862,name:'Achey tree logs'},{id:1521,name:'Oak logs'},
      {id:1519,name:'Willow logs'},{id:6333,name:'Teak logs'},{id:1517,name:'Maple logs'},
      {id:3239,name:'Bark'},{id:40285,name:'Acadia logs'},{id:10810,name:'Arctic pine logs'},
      {id:12581,name:'Eucalyptus logs'},{id:6332,name:'Mahogany logs'},{id:1515,name:'Yew logs'},
      {id:1513,name:'Magic logs'},{id:29556,name:'Elder logs'},{id:58250,name:'Eternal magic logs'},
    ],
  },
  {
    id: 'food', name: 'Food Index', color: '#ef9a9a',
    items: [
      {id:329,name:'Salmon'},{id:361,name:'Tuna'},{id:379,name:'Lobster'},
      {id:365,name:'Bass'},{id:373,name:'Swordfish'},{id:7946,name:'Monkfish'},
      {id:385,name:'Shark'},{id:15266,name:'Cavefish'},{id:15272,name:'Rocktail'},
      {id:34729,name:'Great white shark'},{id:2309,name:'Bread'},{id:1891,name:'Cake'},
      {id:1897,name:'Chocolate cake'},{id:5406,name:'Strawberries (5)'},{id:6685,name:'Saradomin brew (4)'},
    ],
  },
  {
    id: 'metal', name: 'Metal Index', color: '#90a4ae',
    items: [
      {id:436,name:'Copper ore'},{id:438,name:'Tin ore'},{id:440,name:'Iron ore'},
      {id:442,name:'Silver ore'},{id:453,name:'Coal'},{id:444,name:'Gold ore'},
      {id:447,name:'Mithril ore'},{id:449,name:'Adamantite ore'},{id:44820,name:'Luminite'},
      {id:451,name:'Runite ore'},{id:44822,name:'Orichalcite ore'},{id:44824,name:'Drakolith'},
      {id:44826,name:'Necrite ore'},{id:44828,name:'Phasmatite'},{id:21778,name:'Banite ore'},
      {id:44830,name:'Light animica'},{id:44832,name:'Dark animica'},
      {id:2349,name:'Bronze bar'},{id:2351,name:'Iron bar'},{id:2355,name:'Silver bar'},
      {id:2353,name:'Steel bar'},{id:2357,name:'Gold bar'},{id:2359,name:'Mithril bar'},
      {id:2361,name:'Adamant bar'},{id:2363,name:'Rune bar'},{id:44838,name:'Orikalkum bar'},
      {id:44840,name:'Necronium bar'},{id:44842,name:'Bane bar'},{id:44844,name:'Elder rune bar'},
    ],
  },
  {
    id: 'herb', name: 'Herb Index', color: '#a5d6a7',
    items: [
      {id:199,name:'Grimy guam'},{id:201,name:'Grimy marrentill'},{id:203,name:'Grimy tarromin'},
      {id:205,name:'Grimy harralander'},{id:207,name:'Grimy ranarr'},{id:3049,name:'Grimy toadflax'},
      {id:209,name:'Grimy irit'},{id:14836,name:'Grimy wergali'},{id:12174,name:'Grimy spirit weed'},
      {id:211,name:'Grimy avantoe'},{id:213,name:'Grimy kwuarm'},{id:3051,name:'Grimy snapdragon'},
      {id:215,name:'Grimy cadantine'},{id:2485,name:'Grimy lantadyme'},{id:217,name:'Grimy dwarf weed'},
      {id:219,name:'Grimy torstol'},{id:21626,name:'Grimy fellstalk'},
      {id:249,name:'Clean guam'},{id:251,name:'Clean marrentill'},{id:253,name:'Clean tarromin'},
      {id:255,name:'Clean harralander'},{id:257,name:'Clean ranarr'},{id:2998,name:'Clean toadflax'},
      {id:259,name:'Clean irit'},{id:14854,name:'Clean wergali'},{id:12172,name:'Clean spirit weed'},
      {id:261,name:'Clean avantoe'},{id:263,name:'Clean kwuarm'},{id:3000,name:'Clean snapdragon'},
      {id:265,name:'Clean cadantine'},{id:2481,name:'Clean lantadyme'},{id:267,name:'Clean dwarf weed'},
      {id:269,name:'Clean torstol'},{id:21624,name:'Clean fellstalk'},
    ],
  },
];

function IndexesTab({items, selected, onSelect, onToggleWatch, watchlist, onToggleHide}) {
  const [activeIndex, setActiveIndex] = useState(null);

  const itemById = useMemo(() => {
    const map = {};
    items.forEach(it => { map[it.id] = it; });
    return map;
  }, [items]);

  const indexStats = useMemo(() => {
    return INDEXES.map(idx => {
      const matched = idx.items.map(def => itemById[def.id]).filter(Boolean);
      const withChange = matched.filter(it => it.change_1d != null);
      const avgChange = withChange.length
        ? withChange.reduce((s, it) => s + it.change_1d, 0) / withChange.length
        : null;
      return { ...idx, matched, avgChange, coverage: matched.length };
    });
  }, [itemById]);

  if (activeIndex !== null) {
    const idx = indexStats[activeIndex];
    return h('div', {style:{padding:'12px 16px'}},
      h('div', {style:{display:'flex', alignItems:'center', gap:12, marginBottom:16}},
        h('button', {
          onClick: () => setActiveIndex(null),
          style:{background:'transparent', border:`1px solid ${T.border}`, borderRadius:4,
            color:T.textDim, cursor:'pointer', padding:'4px 12px', fontSize:12},
        }, '← Back'),
        h('span', {style:{fontSize:16, fontWeight:'bold', color:idx.color}}, idx.name),
        idx.avgChange != null && h('span', {
          style:{fontSize:13, color: idx.avgChange >= 0 ? T.green : T.red, marginLeft:4},
        }, (idx.avgChange >= 0 ? '▲ +' : '▼ ') + idx.avgChange.toFixed(2) + '% avg today'),
        h('span', {style:{fontSize:11, color:T.textDim, marginLeft:'auto'}},
          `${idx.coverage} / ${idx.items.length} items tracked`),
      ),
      h('div', {style:{display:'flex', flexDirection:'column', gap:2}},
        idx.matched.length === 0 && h('div', {style:{color:T.textDim, fontSize:12, padding:'20px 0', textAlign:'center'}},
          'No price data available for these items yet.'
        ),
        idx.matched.map(it =>
          h('div', {
            key:it.id,
            onClick: () => onSelect(it),
            style:{
              display:'flex', alignItems:'center', gap:10, padding:'7px 10px',
              borderRadius:4, cursor:'pointer', background: selected?.id===it.id ? 'rgba(201,168,76,0.08)' : 'transparent',
              border: `1px solid ${selected?.id===it.id ? T.gold+'44' : 'transparent'}`,
            },
            onMouseEnter: e => e.currentTarget.style.background='rgba(255,255,255,0.04)',
            onMouseLeave: e => e.currentTarget.style.background = selected?.id===it.id ? 'rgba(201,168,76,0.08)' : 'transparent',
          },
            h('span', {style:{flex:1, fontSize:13, color:T.text}}, it.name),
            h('span', {style:{fontSize:13, color:T.gold, minWidth:90, textAlign:'right'}},
              fmt.gp(it.high || it.low) + 'gp'),
            it.change_1d != null && h('span', {
              style:{fontSize:12, minWidth:72, textAlign:'right',
                color: it.change_1d > 0 ? T.green : it.change_1d < 0 ? T.red : T.textDim},
            }, (it.change_1d > 0 ? '+' : '') + it.change_1d.toFixed(2) + '%'),
            it.volume != null && h('span', {style:{fontSize:11, color:T.textDim, minWidth:80, textAlign:'right'}},
              it.volume.toLocaleString() + ' vol'),
          )
        )
      )
    );
  }

  return h('div', {style:{padding:'12px 16px'}},
    h('div', {style:{fontSize:11, color:T.textDim, marginBottom:14}},
      'Click an index to see all constituent items and their current prices.'
    ),
    h('div', {style:{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap:12}},
      indexStats.map((idx, i) =>
        h('div', {
          key:idx.id,
          onClick: () => setActiveIndex(i),
          style:{
            background:'rgba(0,0,0,0.25)', border:`1px solid ${T.border}`, borderRadius:6,
            padding:'14px 16px', cursor:'pointer', transition:'border-color 0.15s',
          },
          onMouseEnter: e => e.currentTarget.style.borderColor = idx.color+'88',
          onMouseLeave: e => e.currentTarget.style.borderColor = T.border,
        },
          h('div', {style:{fontSize:11, color:idx.color, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:8}},
            idx.name),
          idx.avgChange != null
            ? h('div', {style:{display:'flex', alignItems:'baseline', gap:8}},
                h('span', {style:{fontSize:28, fontWeight:'bold', color:T.goldBright}},
                  (idx.avgChange >= 0 ? '+' : '') + idx.avgChange.toFixed(2) + '%'),
                h('span', {style:{fontSize:14, color: idx.avgChange >= 0 ? T.green : T.red}},
                  idx.avgChange >= 0 ? '▲' : '▼'),
              )
            : h('div', {style:{fontSize:14, color:T.textDim}}, 'No data'),
          h('div', {style:{fontSize:11, color:T.textDim, marginTop:6}},
            `avg daily change · ${idx.coverage} items tracked`),
        )
      )
    )
  );
}

/* ─── Market Opportunities Tab ───────────────────────────────── */
function ScoreBreakdown({it}) {
  const price   = it.high || it.low || 0;
  const chg     = it.change_1d;
  const vol     = it.volume || 0;
  const avg     = it.avgVolume || 0;
  const sigs    = it.signals || [];
  const alch    = it.alch || 0;
  const nature  = it.natureRunePrice || 0;

  const pctFactor = chg != null ? Math.min(1, Math.abs(chg) / 20) : 0;
  const gpFactor  = chg != null ? Math.min(1, (Math.abs(chg) / 100 * price) / 100000) : 0;
  const momPts    = chg != null ? Math.round(40 * Math.sqrt(pctFactor * gpFactor) * 10) / 10 : 0;

  const volRatio  = avg > 0 ? vol / avg : 0;
  const volPts    = avg > 0 && volRatio > 0 ? Math.round(Math.min(30, (volRatio - 1) / 2 * 30) * 10) / 10 : 0;

  let sigPts = 0;
  if (sigs.includes('SURGE') || sigs.includes('DUMP')) sigPts += 20;
  if (sigs.includes('ACCUMULATION') || sigs.includes('DISTRIBUTION')) sigPts += 10;
  if (sigs.includes('FRENZY')) sigPts += 10;

  const alchProfit = alch && price && nature ? alch - (price * 0.98) - nature : 0;
  const alchPts    = alchProfit > 0 ? Math.round(Math.min(10, alchProfit / price * 100) * 10) / 10 : 0;

  const cardStyle = {background:'rgba(0,0,0,0.3)', border:`1px solid ${T.borderDim}`, borderRadius:4, padding:'8px 10px', flex:'1 1 0'};
  const labelStyle = {fontSize:10, color:T.textDim, marginBottom:4, textTransform:'uppercase', letterSpacing:'0.05em'};
  const ptsStyle = pts => ({fontSize:14, fontWeight:'bold', color: pts > 0 ? T.green : T.textDim});
  const subStyle = {fontSize:10, color:T.borderGold, marginTop:3, opacity:0.8};

  return h('tr', null,
    h('td', {colSpan:6, style:{padding:'0 8px 10px', background:'rgba(0,0,0,0.2)'}},
      h('div', {style:{display:'flex', gap:6}},
        h('div', {style:cardStyle},
          h('div', {style:labelStyle}, 'Price momentum'),
          h('div', {style:ptsStyle(momPts)}, momPts > 0 ? `+${momPts} pts` : '0 pts'),
          h('div', {style:subStyle},
            chg != null
              ? `${chg > 0 ? '+' : ''}${chg.toFixed(2)}% · ${chg > 0 ? '+' : ''}${fmt.gp(Math.round(price - price / (1 + chg / 100)))}gp`
              : 'No price data'
          )
        ),
        h('div', {style:cardStyle},
          h('div', {style:labelStyle}, 'Volume'),
          h('div', {style:ptsStyle(volPts)}, volPts > 0 ? `+${volPts} pts` : '0 pts'),
          h('div', {style:subStyle},
            avg > 0 ? `${volRatio.toFixed(1)}× average` : 'No avg volume'
          )
        ),
        h('div', {style:cardStyle},
          h('div', {style:labelStyle}, 'Signal bonus'),
          h('div', {style:ptsStyle(sigPts)}, sigPts > 0 ? `+${sigPts} pts` : '0 pts'),
          h('div', {style:subStyle},
            sigPts > 0
              ? sigs.filter(s => ['SURGE','DUMP','ACCUMULATION','DISTRIBUTION','FRENZY'].includes(s)).join(', ')
              : 'No qualifying signals'
          )
        ),
        h('div', {style:cardStyle},
          h('div', {style:labelStyle}, 'Alch profit'),
          h('div', {style:ptsStyle(alchPts)}, alchPts > 0 ? `+${alchPts} pts` : '0 pts'),
          h('div', {style:subStyle},
            alchProfit > 0 ? `+${fmt.gp(Math.round(alchProfit))}gp margin` : 'No alch profit'
          )
        ),
      )
    )
  );
}

function ScoreTable({rows, selected, onSelect}) {
  const [expanded, setExpanded] = useState(null);
  const [sortCol, setSortCol] = useState(1);
  const [sortAsc, setSortAsc] = useState(false);

  const sortKeys = ['name', 'score', it=>it.high||it.low, 'change_1d', 'volume'];
  const sorted = useMemo(() => {
    const key = sortKeys[sortCol];
    return [...rows].sort((a,b) => {
      const av = typeof key === 'function' ? key(a) : (a[key] ?? 0);
      const bv = typeof key === 'function' ? key(b) : (b[key] ?? 0);
      if (typeof av === 'string') return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortAsc ? av - bv : bv - av;
    });
  }, [rows, sortCol, sortAsc]);

  const onHeader = i => {
    if (sortCol === i) setSortAsc(a => !a);
    else { setSortCol(i); setSortAsc(false); }
  };

  const headers = ['Item','Score','Price','Change','Volume','Signals'];

  return h('div', {style:{marginBottom:20}},
    h('div', {style:{display:'flex',alignItems:'baseline',gap:8,marginBottom:6}},
      h('span', {style:{fontSize:14}}, '◈'),
      h('span', {style:{fontFamily:'Cinzel,serif',fontSize:12,letterSpacing:'1.5px',textTransform:'uppercase',color:T.goldBright}}, 'Opportunity Score — Top 20'),
      h('span', {style:{fontSize:10,background:'rgba(201,168,76,0.15)',border:`1px solid ${T.borderDim}`,borderRadius:10,padding:'0 6px',color:T.textDim}}, rows.length),
      h('span', {style:{fontSize:10,color:T.textDim}}, '— composite score combining momentum, volume, signals, and alch profit'),
    ),
    h('div', {className:'ge-table-wrap'},
      h('table', {className:'ge-table'},
        h('thead', null, h('tr', null, headers.map((hd,i) =>
          h('th', {key:i, style:{cursor: i < 5 ? 'pointer' : 'default', userSelect:'none'}, onClick:()=>i<5&&onHeader(i)},
            hd, sortCol===i ? (sortAsc?' ▲':' ▼') : ''
          )
        ))),
        h('tbody', null, sorted.map(it => {
          const score = it.score || 0;
          const scoreColor = score >= 70 ? T.green : score >= 40 ? T.gold : T.textDim;
          const isExpanded = expanded === it.id;
          return [
            h('tr', {
              key: it.id,
              className: selected?.id === it.id ? 'selected' : '',
              onClick: () => onSelect && onSelect(it),
            },
              h('td', null, it.name),
              h('td', {style:{textAlign:'center'}},
                h('div', {style:{display:'flex', alignItems:'center', justifyContent:'center', gap:6}},
                  h('span', null,
                    h('span', {style:{color:scoreColor, fontWeight:'bold'}}, score.toFixed(1)),
                    h('span', {style:{color:T.textDim, fontSize:10}}, '/100'),
                  ),
                  h('span', {
                    onClick: e => { e.stopPropagation(); setExpanded(isExpanded ? null : it.id); },
                    style:{color:T.textDim, cursor:'pointer', fontSize:11, lineHeight:1,
                      display:'inline-block', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                      transition:'transform 0.2s'},
                  }, '▾')
                )
              ),
              h('td', {style:{color:T.gold}}, fmt.gp(it.high||it.low)+'gp'),
              h('td', null, h(ChangeDisplay, {change_1d:it.change_1d, price:it.high||it.low})),
              h('td', null, h(VolDisplay, {volume:it.volume, avgVolume:it.avgVolume})),
              h('td', null, h('div',{style:{display:'flex',flexWrap:'wrap',gap:3}},(it.signals||[]).map(s=>h(SignalBadge,{key:s,signal:s})))),
            ),
            isExpanded && h(ScoreBreakdown, {key: it.id+'-bd', it}),
          ];
        }))
      )
    )
  );
}

function OpportunitiesTab({items, selected, onSelect, description}) {
  const [signalFilter, setSignalFilter] = useState(null);

  const withSignal = useCallback((sig) =>
    items.filter(it => it.signals && it.signals.includes(sig)), [items]);

  const surge    = useMemo(() => withSignal('SURGE').sort((a,b)=>(b.change_1d||0)-(a.change_1d||0)).slice(0,20), [items]);
  const dump     = useMemo(() => withSignal('DUMP').sort((a,b)=>(a.change_1d||0)-(b.change_1d||0)).slice(0,20), [items]);
  const accum    = useMemo(() => withSignal('ACCUMULATION').sort((a,b)=>((b.volume||0)/(b.avgVolume||1))-((a.volume||0)/(a.avgVolume||1))).slice(0,20), [items]);
  const distrib  = useMemo(() => withSignal('DISTRIBUTION').sort((a,b)=>((b.volume||0)/(b.avgVolume||1))-((a.volume||0)/(a.avgVolume||1))).slice(0,20), [items]);
  const alchItems= useMemo(() => withSignal('ALCH').sort((a,b) => {
    const profit = it => (it.alch||0) - ((it.high||it.low||0)*0.98) - (it.natureRunePrice||0);
    return profit(b) - profit(a);
  }).slice(0,20), [items]);
  const frenzy   = useMemo(() => withSignal('FRENZY').sort((a,b)=>((b.volume||0)/(b.avgVolume||1))-((a.volume||0)/(a.avgVolume||1))).slice(0,15), [items]);
  const topScored = useMemo(() => [...items].filter(it=>it.score>0&&!it.untradeable).sort((a,b)=>(b.score||0)-(a.score||0)).slice(0,20), [items]);

  const risers  = useMemo(() => [...items].filter(it=>it.change_1d!=null&&it.change_1d>0).sort((a,b)=>(b.change_1d||0)-(a.change_1d||0)).slice(0,8), [items]);
  const fallers = useMemo(() => [...items].filter(it=>it.change_1d!=null&&it.change_1d<0).sort((a,b)=>(a.change_1d||0)-(b.change_1d||0)).slice(0,8), [items]);

  function SectionTable({title, icon, color, desc, rows, renderRow, headers, sortKeys, empty='None detected today.'}) {
    const [sortCol, setSortCol] = useState(null);
    const [sortAsc, setSortAsc] = useState(false);

    const sorted = useMemo(() => {
      if (sortCol === null || !sortKeys || !sortKeys[sortCol]) return rows;
      const key = sortKeys[sortCol];
      return [...rows].sort((a, b) => {
        const av = typeof key === 'function' ? key(a) : (a[key] ?? 0);
        const bv = typeof key === 'function' ? key(b) : (b[key] ?? 0);
        if (typeof av === 'string') return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
        return sortAsc ? av - bv : bv - av;
      });
    }, [rows, sortCol, sortAsc, sortKeys]);

    const onHeader = i => {
      if (!sortKeys || !sortKeys[i]) return;
      if (sortCol === i) setSortAsc(a => !a);
      else { setSortCol(i); setSortAsc(false); }
    };

    if (!rows.length) return h('div', {style:{marginBottom:18}},
      h('div', {style:{display:'flex',alignItems:'center',gap:8,marginBottom:6}},
        h('span', {style:{fontSize:14}}, icon),
        h('span', {style:{fontFamily:'Cinzel,serif',fontSize:12,letterSpacing:'1.5px',textTransform:'uppercase',color: color||T.gold}}, title),
        h('span', {style:{fontSize:10,color:T.textDim,marginLeft:4}}, '— ' + empty)
      )
    );
    return h('div', {style:{marginBottom:20}},
      h('div', {style:{display:'flex',alignItems:'baseline',gap:8,marginBottom:6}},
        h('span', {style:{fontSize:14}}, icon),
        h('span', {style:{fontFamily:'Cinzel,serif',fontSize:12,letterSpacing:'1.5px',textTransform:'uppercase',color:color||T.gold}}, title),
        h('span', {style:{fontSize:10,background:'rgba(201,168,76,0.15)',border:`1px solid ${T.borderDim}`,borderRadius:10,padding:'0 6px',color:T.textDim}}, rows.length),
        desc && h('span', {style:{fontSize:10,color:T.textDim}}, desc)
      ),
      h('div', {className:'ge-table-wrap'},
        h('table', {className:'ge-table'},
          h('thead', null, h('tr', null, headers.map((hd,i) => {
            const sortable = sortKeys && sortKeys[i];
            return h('th', {key:i, style:{cursor:sortable?'pointer':'default', userSelect:'none'}, onClick:()=>onHeader(i)},
              hd, sortable && sortCol===i ? (sortAsc?' ▲':' ▼') : ''
            );
          }))),
          h('tbody', null, sorted.map((it,i) =>
            h('tr', {key:it.id||i, className:selected?.id===it.id?'selected':'', onClick:()=>onSelect&&onSelect(it)},
              renderRow(it)
            )
          ))
        )
      )
    );
  }

  const signalCells = it => h('td', null,
    h('div', {style:{display:'flex',flexWrap:'wrap',gap:3}},
      (it.signals||[]).map(s => h(SignalBadge, {key:s, signal:s}))
    )
  );

  return h('div', {style:{padding:'4px 0'}},
    description && h('div',{style:{padding:'8px 14px', borderBottom:`1px solid ${T.border}`, fontSize:12, color:T.textDim, fontStyle:'italic', lineHeight:1.5}}, description),

    // Summary bar
    h('div', {style:{display:'flex',gap:10,flexWrap:'wrap',marginBottom:18,padding:'10px 12px',background:T.panel2,borderRadius:4,border:`1px solid ${T.borderDim}`}},
      [
        ['SURGE',    T.green,   surge.length,     'SURGE'],
        ['DUMP',     T.red,     dump.length,      'DUMP'],
        ['ACCUM',    '#4dd0e1', accum.length,     'ACCUMULATION'],
        ['DISTRIB',  '#ffb74d', distrib.length,   'DISTRIBUTION'],
        ['FRENZY',   '#ff80ab', frenzy.length,    'FRENZY'],
        ['ALCH',     '#ce93d8', alchItems.length, 'ALCH'],
      ].map(([label,color,count,sig]) => {
        const active = signalFilter === sig;
        return h('div', {
          key: label,
          title: active ? 'Click to show all' : `Filter to ${label} only`,
          onClick: () => setSignalFilter(active ? null : sig),
          style: {display:'flex',flexDirection:'column',alignItems:'center',minWidth:56,cursor:'pointer',borderRadius:4,padding:'4px 6px',
            background: active ? `${color}22` : 'transparent',
            border: active ? `1px solid ${color}66` : '1px solid transparent',
            transition:'background 0.15s'}
        },
          h('span', {style:{fontSize:18,fontWeight:300,color}}, count),
          h('span', {style:{fontSize:9,color: active ? color : T.textDim,letterSpacing:'1px',textTransform:'uppercase'}}, label)
        );
      })
    ),

    // Filtered view
    signalFilter && h('div', {style:{marginBottom:20}},
      h('div', {style:{display:'flex',alignItems:'center',gap:8,marginBottom:8,padding:'6px 10px',background:T.panel2,borderRadius:4,border:`1px solid ${T.borderDim}`}},
        h('span', {style:{fontSize:11,color:T.textDim}}, `Showing ${signalFilter} only —`),
        h('span', {style:{fontSize:11,color:T.gold,cursor:'pointer'}, onClick:()=>setSignalFilter(null)}, 'Clear filter ✕')
      ),
      h(ItemTable, {
        items: ({SURGE:surge,DUMP:dump,ACCUMULATION:accum,DISTRIBUTION:distrib,FRENZY:frenzy,ALCH:alchItems})[signalFilter] || [],
        selected, onSelect,
        showSignals: true
      })
    ),

    !signalFilter && h(ScoreTable, {rows:topScored, selected, onSelect}),

    // Strong Movers (hidden when signal filter active)
    !signalFilter && h('div', {style:{marginBottom:20}},
      h('div', {style:{fontFamily:'Cinzel,serif',fontSize:12,letterSpacing:'1.5px',textTransform:'uppercase',color:T.gold,marginBottom:8}},
        '📈 Strong Movers'
      ),
      h('div', {className:'two-col'},
        h('div', null,
          h('div', {style:{fontSize:10,color:T.textDim,marginBottom:4,textTransform:'uppercase',letterSpacing:'1px'}}, 'Top Risers'),
          risers.length ? h('table', {className:'ge-table'},
            h('thead',null,h('tr',null,h('th',null,'Item'),h('th',null,'Price'),h('th',null,'Change'))),
            h('tbody',null, risers.map(it=>h('tr',{key:it.id,className:selected?.id===it.id?'selected':'',onClick:()=>onSelect&&onSelect(it)},
              h('td',null,it.name),
              h('td',{style:{color:T.gold}},fmt.gp(it.high||it.low)+'gp'),
              h('td',null,h(ChangeDisplay,{change_1d:it.change_1d,price:it.high||it.low}))
            )))
          ) : h('div',{style:{color:T.textDim,fontSize:11,padding:'8px 0'}},'No rising items detected.')
        ),
        h('div', null,
          h('div', {style:{fontSize:10,color:T.textDim,marginBottom:4,textTransform:'uppercase',letterSpacing:'1px'}}, 'Top Fallers'),
          fallers.length ? h('table', {className:'ge-table'},
            h('thead',null,h('tr',null,h('th',null,'Item'),h('th',null,'Price'),h('th',null,'Change'))),
            h('tbody',null, fallers.map(it=>h('tr',{key:it.id,className:selected?.id===it.id?'selected':'',onClick:()=>onSelect&&onSelect(it)},
              h('td',null,it.name),
              h('td',{style:{color:T.gold}},fmt.gp(it.high||it.low)+'gp'),
              h('td',null,h(ChangeDisplay,{change_1d:it.change_1d,price:it.high||it.low}))
            )))
          ) : h('div',{style:{color:T.textDim,fontSize:11,padding:'8px 0'}},'No falling items detected.')
        )
      )
    ),

    !signalFilter && h(SectionTable, {
      title:'SURGE Signals', icon:'⚡', color:T.green,
      desc:'— price rising with elevated volume',
      rows:surge,
      headers:['Item','Price','Change','Volume','Signals'],
      sortKeys:['name',it=>it.high||it.low,'change_1d','volume',null],
      renderRow: it => [
        h('td',{key:'n'},it.name),
        h('td',{key:'p',style:{color:T.gold}},fmt.gp(it.high||it.low)+'gp'),
        h('td',{key:'c'},h(ChangeDisplay,{change_1d:it.change_1d,price:it.high||it.low})),
        h('td',{key:'v'},h(VolDisplay,{volume:it.volume,avgVolume:it.avgVolume})),
        signalCells(it),
      ],
    }),

    !signalFilter && h(SectionTable, {
      title:'DUMP Signals', icon:'📉', color:T.red,
      desc:'— price falling with elevated volume',
      rows:dump,
      headers:['Item','Price','Change','Volume','Signals'],
      sortKeys:['name',it=>it.high||it.low,'change_1d','volume',null],
      renderRow: it => [
        h('td',{key:'n'},it.name),
        h('td',{key:'p',style:{color:T.gold}},fmt.gp(it.high||it.low)+'gp'),
        h('td',{key:'c'},h(ChangeDisplay,{change_1d:it.change_1d,price:it.high||it.low})),
        h('td',{key:'v'},h(VolDisplay,{volume:it.volume,avgVolume:it.avgVolume})),
        signalCells(it),
      ],
    }),

    !signalFilter && h(SectionTable, {
      title:'Accumulation', icon:'📦', color:'#4dd0e1',
      desc:'— price flat, volume quietly building',
      rows:accum,
      headers:['Item','Price','Vol / Avg','Vol Ratio','Signals'],
      sortKeys:['name',it=>it.high||it.low,'volume',it=>it.avgVolume?(it.volume/it.avgVolume):0,null],
      renderRow: it => [
        h('td',{key:'n'},it.name),
        h('td',{key:'p',style:{color:T.gold}},fmt.gp(it.high||it.low)+'gp'),
        h('td',{key:'v'},h(VolDisplay,{volume:it.volume,avgVolume:it.avgVolume})),
        h('td',{key:'r',style:{color:'#4dd0e1'}}, it.avgVolume ? (it.volume/it.avgVolume).toFixed(2)+'×' : '—'),
        signalCells(it),
      ],
    }),

    !signalFilter && h(SectionTable, {
      title:'Distribution', icon:'🌊', color:'#ffb74d',
      desc:'— price flat, extreme volume — watch for incoming drop',
      rows:distrib,
      headers:['Item','Price','Vol / Avg','Vol Ratio','Signals'],
      sortKeys:['name',it=>it.high||it.low,'volume',it=>it.avgVolume?(it.volume/it.avgVolume):0,null],
      renderRow: it => [
        h('td',{key:'n'},it.name),
        h('td',{key:'p',style:{color:T.gold}},fmt.gp(it.high||it.low)+'gp'),
        h('td',{key:'v'},h(VolDisplay,{volume:it.volume,avgVolume:it.avgVolume})),
        h('td',{key:'r',style:{color:'#ffb74d'}}, it.avgVolume ? (it.volume/it.avgVolume).toFixed(2)+'×' : '—'),
        signalCells(it),
      ],
    }),

    !signalFilter && h(SectionTable, {
      title:'Volume Frenzy', icon:'🔥', color:'#ff80ab',
      desc:'— 250%+ above average volume',
      rows:frenzy,
      headers:['Item','Price','Change','Vol Ratio','Signals'],
      sortKeys:['name',it=>it.high||it.low,'change_1d',it=>it.avgVolume?(it.volume/it.avgVolume):0,null],
      renderRow: it => [
        h('td',{key:'n'},it.name),
        h('td',{key:'p',style:{color:T.gold}},fmt.gp(it.high||it.low)+'gp'),
        h('td',{key:'c'},h(ChangeDisplay,{change_1d:it.change_1d,price:it.high||it.low})),
        h('td',{key:'r',style:{color:'#ff80ab'}}, it.avgVolume ? (it.volume/it.avgVolume).toFixed(2)+'×' : '—'),
        signalCells(it),
      ],
    }),

    !signalFilter && h(SectionTable, {
      title:'Alch Opportunities', icon:'⚗', color:'#ce93d8',
      desc:'— alch profit exceeds GE sell after tax + nature rune',
      rows:alchItems,
      headers:['Item','GE Price','Alch Value','Profit / Ea','GE Limit'],
      sortKeys:['name',it=>it.high||it.low,'alch',it=>Math.round((it.alch||0)-(it.high||it.low||0)*0.98-(it.natureRunePrice||0)),'limit'],
      renderRow: it => {
        const profit = Math.round((it.alch||0) - (it.high||it.low||0)*0.98 - (it.natureRunePrice||0));
        return [
          h('td',{key:'n'},it.name),
          h('td',{key:'p',style:{color:T.gold}},fmt.gp(it.high||it.low)+'gp'),
          h('td',{key:'a',style:{color:'#ce93d8'}},fmt.gp(it.alch)+'gp'),
          h('td',{key:'pr',style:{color:T.green}},'+'+fmt.gp(profit)+'gp'),
          h('td',{key:'l',style:{color:T.textDim}},it.limit?it.limit.toLocaleString():'—'),
        ];
      },
    }),
  );
}

/* ─── Tab descriptions ───────────────────────────────────────── */
const TAB_DESCRIPTIONS = {
  dashboard:      'The big picture. Try not to panic.',
  compare:        'Side-by-side. May the best item win.',
  watchlist:      'The items you\'ve decided are worth obsessing over.',
  market:         'Everything the Grand Exchange has to offer. Yes, all of it.',
  opportunities:  'Items showing unusual price or volume activity. May or may not be a trap.',
  portfolio:      'Track positions, profits, losses, and questionable financial decisions.',
  alch:           'Items where nature runes are paying their own rent.',
  melee:          'For those who solve problems up close and personally.',
  magic:          'Wear a dress, cast spells, do more damage than everyone else.',
  ranged:         'Killing things from a comfortable distance since 2001.',
  necromancy:     'Ethically questionable workforce management.',
  hybrid:         'Items that don\'t discriminate.',
  prayer:         'The most expensive way to become holy.',
  summoning:      'Pouches, shards, and the creatures they become.',
  pocket:         'Small items, large implications.',
  codex:          'Teaching your character new moves, expensively.',
  ammo:           'Things you fire, then never find again.',
  runes:          'The original microtransaction.',
  low_tier:       'Bronze through dragon. Nostalgia or ironman supplies.',
  supplies:       'Consumables that keep you alive long enough to die later.',
  herblore:       'Crushing things together until they become medicine. Or poison.',
  artisan:        'Hitting hot metal, cutting gems, stitching leather, fletching bows, and building furniture until it all becomes better gear.',
  food:           'Eat. Heal. Repeat.',
  farming:        'Plant seeds, wait, harvest, pretend you\'re not just afking.',
  mining:         'Ores, logs, fish, energies — raw materials straight from the source.',
  archaeology:    'Digging up the past and selling it.',
  invention:      'A PhD in item destruction.',
  boss:           'Rare loot from things that were trying very hard to kill you.',
  treasure_trails:'Rewards from following cryptic instructions written by a sadist.',
  rares:          'Items worth more than most players\' entire banks.',
  expensive:      'Everything over a certain threshold. Handle with care.',
  cosmetics:      'Look good. That\'s it. That\'s the whole tab.',
  materials:      'Items that defied categorisation. We\'re working on it.',
  alerts:         'Because checking prices every five minutes is exhausting.',
  news:           'The new updates: Congratulations, or condolences. Whichever applies.',
  about:          'What this thing is, and what that symbol next to its name means.',
};

/* ─── Nav config ─────────────────────────────────────────────── */
const NAV = [
  {id:'dashboard',      label:'Dashboard',        icon:'◈'},
  {id:'watchlist',      label:'Watchlist',        icon:'★'},
  {id:'market',         label:'Market',           icon:'◐'},
  {id:'opportunities',  label:'Opportunities',    icon:'⚡'},
  {id:'compare',        label:'Compare',          icon:'⇌'},
  {id:'portfolio',      label:'Portfolio',        icon:'📊'},
  {id:'alerts',         label:'Alerts',           icon:'◉'},
  {id:'alch',           label:'Alch',             icon:'🔥'},
  {group:'Combat'},
  {id:'melee',          label:'Melee',            icon:'⚔'},
  {id:'magic',          label:'Magic',            icon:'✦'},
  {id:'ranged',         label:'Ranged',           icon:'◎'},
  {id:'necromancy',     label:'Necromancy',       icon:'☠'},
  {id:'hybrid',         label:'Hybrid',           icon:'⚜'},
  {id:'prayer',         label:'Prayer',           icon:'✙'},
  {id:'summoning',      label:'Summoning',        icon:'⟡'},
  {id:'pocket',         label:'Pocket',           icon:'◇'},
  {id:'codex',          label:'Ability Codexes',  icon:'📖'},
  {id:'ammo',           label:'Ammo',             icon:'◈'},
  {id:'runes',          label:'Runes',            icon:'◈'},
  {id:'low_tier',       label:'Low Tier',         icon:'⚔'},
  {id:'supplies',       label:'PVM Supplies',     icon:'⚗'},
  {group:'Skilling'},
  {id:'herblore',       label:'Herblore',         icon:'⚗'},
  {id:'artisan',        label:'Artisan',          icon:'⚒'},
  {id:'food',           label:'Food',             icon:'◬'},
  {id:'farming',        label:'Farming',          icon:'❧'},
  {id:'mining',         label:'Gathering',        icon:'⛏'},
  {id:'archaeology',    label:'Archaeology',      icon:'⌖'},
  {id:'invention',      label:'Invention',        icon:'⚙'},
  {group:'Other'},
  {id:'boss',           label:'Boss Drops',       icon:'☠'},
  {id:'treasure_trails',label:'Treasure Trails',  icon:'🗺'},
  {id:'rares',          label:'Rares',            icon:'💎'},
  {id:'expensive',      label:'High Value',       icon:'💎'},
  {id:'cosmetics',      label:'Cosmetics',        icon:'✦'},
  {id:'materials',      label:'Misc',             icon:'◆'},
  {id:'news',           label:'News',             icon:'✦'},
  {id:'settings',       label:'Settings',         icon:'⚙'},
  {id:'about',          label:'About',            icon:'ℹ'},
];

/* ─── App ─────────────────────────────────────────────────────── */
function App() {
  const [tab, setTab] = useState('dashboard');
  const [items, setItems] = useState([]);
  const [news, setNews] = useState([]);
  const [indexes, setIndexes] = useState([]);
  const [compareList, setCompareList] = useState([]);
  const [watchlist, setWatchlist] = useState([]);
  const [hiddenItems, setHiddenItems] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [settings, setSettings] = useState({});
  applyAccentColor(settings.accentColor);
  const [portfolio, setPortfolio] = useState({positions:[], tax_stats:{}});
  const [notes, setNotes] = useState({});
  const [userShorthands, setUserShorthands] = useState({});
  const [updateInfo, setUpdateInfo]         = useState(null);
  const [historyPopup, setHistoryPopup] = useState(null); // null | {done, total, complete}
  const [populatedHistoryIds, setPopulatedHistoryIds] = useState(null); // null = not loaded yet | Set<number>
  const refreshPopulatedHistoryIds = useCallback(() => {
    window.genius?.getHistoryPopulatedIds?.().then(ids => setPopulatedHistoryIds(new Set(ids)));
  }, []);
  const [selected, setSelected] = useState(null);
  const [quickAddPos, setQuickAddPos] = useState(null); // pre-filled position from margin calc
  const [fetching, setFetching] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const {toasts, add:toast} = useToast();
  const theme = settings.theme || 'dark';
  SHOW_THUMBNAILS = settings.showThumbnails !== false;
  const [detailPanelWidth, setDetailPanelWidth] = useState(settings.detailPanelWidth || 296);
  useEffect(() => { if (settings.detailPanelWidth) setDetailPanelWidth(settings.detailPanelWidth); }, [settings.detailPanelWidth]);
  const panelWidthRef = useRef(detailPanelWidth);
  const startPanelResize = e => {
    e.preventDefault();
    const startX = e.clientX, startW = detailPanelWidth;
    const onMove = me => {
      const w = Math.min(600, Math.max(260, startW - (me.clientX - startX)));
      panelWidthRef.current = w;
      setDetailPanelWidth(w);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.genius?.saveSettings({...settings, detailPanelWidth: panelWidthRef.current});
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const uiScale = (settings.uiScale || 100) / 100;
  const [scaleDims, setScaleDims] = useState({w: window.innerWidth, h: window.innerHeight});
  useEffect(() => {
    const onResize = () => setScaleDims({w: window.innerWidth, h: window.innerHeight});
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Custom nav order — flatten NAV when user has custom order (no group separators)
  const navBase = useMemo(() => {
    if (!settings.devMode) return NAV;
    // Hidden dev-only entry, inserted right below Dashboard — never shown unless devMode is on
    const idx = NAV.findIndex(n => n.id === 'dashboard') + 1;
    const withDev = [...NAV];
    withDev.splice(idx, 0, {id:'dxp_intel', label:'GEnius Almanac', icon:'📅'});
    return withDev;
  }, [settings.devMode]);
  const navItems = useMemo(() => {
    const order = settings.navOrder;
    if (!order || !order.length) return navBase;
    const byId = Object.fromEntries(navBase.filter(n=>n.id).map(n=>[n.id,n]));
    const known = order.map(id=>byId[id]).filter(Boolean);
    const newOnes = navBase.filter(n=>n.id && !order.includes(n.id));
    return [...known, ...newOnes]; // flat list, no groups
  }, [settings.navOrder, navBase]);

  useEffect(() => {
    if (!window.genius) { console.error('[GEnius] window.genius is not defined!'); return; }
    console.log('[GEnius] Loading initial data...');
    Promise.all([
      window.genius.getData(),
      window.genius.getWatchlist(),
      window.genius.getAlerts(),
      window.genius.getSettings(),
      window.genius.getPortfolio(),
      window.genius.getHidden(),
      window.genius.getNotes(),
      window.genius.getShorthands(),
      window.genius.getReminders(),
    ]).then(([data,wl,al,s,pf,hidden,nt,sh,rm]) => {
      console.log('[GEnius] getData returned:', data?.items?.length ?? 0, 'items, timestamp:', data?.timestamp);
      if (data.items)     setItems(data.items);
      if (data.news)      setNews(data.news);
      if (data.indexes)   setIndexes(data.indexes);
      if (data.timestamp) setLastUpdate(data.timestamp);
      setWatchlist(wl||[]);
      setAlerts(al||[]);
      setSettings(s||{});
      if (pf) setPortfolio(pf);
      setHiddenItems(hidden||[]);
      setNotes(nt||{});
      setUserShorthands(sh||{});
      setReminders(rm||[]);

      const splash = document.getElementById('splash');
      if (splash) {
        splash.style.opacity = '0';
        setTimeout(() => splash.remove(), 400);
      }

      // Trigger history population if needed. Previously this only ever
      // fired on a true first run or while under 50 items were stored —
      // meaning if the app got closed before the (~45+ minute) full
      // catalogue backfill finished, it never resumed on later launches.
      // Confirmed for real: after a long time using the app, only ~20%
      // of the catalogue (1415/7182 items) had ever been populated.
      // Comparing against the actual remaining gap instead means it
      // keeps making progress across restarts until genuinely done.
      // startHistoryPopulation already filters to just the unfetched
      // ids internally, so calling it with the full list here is safe.
      if (data.items && data.items.length) {
        window.genius?.getHistoryStatus().then(status => {
          // Untradeable items (Invention components, combo potions —
          // ~106 of them, added by untradeable.js) have an id but no
          // real GE exchange history to ever fetch. Without excluding
          // them, the queue can never reach 100% — it perpetually
          // re-queues and re-fails the same ~100 ids on every single
          // launch, which is exactly why the "Building history" popup
          // kept reappearing stuck at the same not-quite-complete count.
          const sorted = [...data.items]
            .filter(it => it.id && !it.untradeable)
            .sort((a,b) => (b.volume||0) - (a.volume||0));
          const allIds = sorted.map(it => it.id);
          if (status.isFirstRun || status.stored < allIds.length) {
            // Always seeded from the REAL persisted stored/total counts,
            // never from a per-session counter starting at 0 — that's
            // what made a resume look like lost progress before (see
            // SESSION_LOG.md, 2026-06-26). initial300Done is persisted
            // in main.js across restarts, so a real interruption during
            // the first 300 correctly resumes showing "still on the
            // first 300" instead of wrongly claiming background mode.
            setHistoryPopup({stored:status.stored, total:allIds.length,
              initial300Done:status.initial300Done, fullyComplete:false});
            window.genius?.startHistoryPopulation(allIds);
          }
        });
      }
      refreshPopulatedHistoryIds();
    }).catch(e => {
      console.error('[GEnius] Initial load error:', e);
      document.getElementById('splash')?.remove();
    });

    window.genius.onHistoryProgress(d => {
      refreshPopulatedHistoryIds();
      setHistoryPopup(prev => {
        if (!prev) return prev;
        // d.total here is just "items left in this run's queue," not
        // the overall catalogue size — keep using prev.total (set once,
        // from the real full item count) for that. Only stored count
        // and the persisted initial300Done flag come from the live tick.
        const fullyComplete = d.stored >= prev.total;
        return {...prev, stored: d.stored, initial300Done: d.initial300Done, fullyComplete};
      });
    });
    window.genius.onFetchComplete(d => {
      console.log('[GEnius] fetch-complete received:', d);
      setFetching(false); setLastUpdate(d.timestamp);
      window.genius.getData().then(data => {
        console.log('[GEnius] getData after fetch returned:', data?.items?.length ?? 0, 'items');
        if (data.items)   setItems(data.items);
        if (data.news)    setNews(data.news);
        if (data.indexes) setIndexes(data.indexes);
      }).catch(e => console.error('[GEnius] getData after fetch error:', e));
      toast('Prices updated','success');
    });
    window.genius.onFetchError(d => { setFetching(false); toast('Fetch error: '+(d.error||'unknown'),'error'); console.error('[GEnius] fetch-error:', d); });
    window.genius.onUpdateAvailable(d => setUpdateInfo(d));
    return () => { window.genius.removeAllListeners('fetch-complete'); window.genius.removeAllListeners('fetch-error'); window.genius.removeAllListeners('update-available'); };
  }, []);

  // Global shortcut: S or / focuses the search bar unless a text field is active
  useEffect(() => {
    const onKey = e => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (document.activeElement?.isContentEditable) return;
      if (e.key === 's' || e.key === 'S' || e.key === '/') {
        e.preventDefault();
        document.querySelector('.ge-search-input')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Backspace closes the item detail panel (when no text field is focused)
  useEffect(() => {
    const onKey = e => {
      if (e.key !== 'Backspace') return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (document.activeElement?.isContentEditable) return;
      if (selected) { e.preventDefault(); setSelected(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  const toggleWatch = useCallback(async id => {
    const nw = watchlist.includes(id) ? watchlist.filter(x=>x!==id) : [...watchlist,id];
    setWatchlist(nw);
    await window.genius?.setWatchlist(nw);
    toast(watchlist.includes(id) ? 'Removed from watchlist' : 'Added to watchlist', 'info');
  }, [watchlist]);

  const toggleHide = useCallback(async id => {
    const ids = Array.isArray(id) ? id : [id];
    let nh = [...hiddenItems];
    ids.forEach(i => {
      if (nh.includes(i)) nh = nh.filter(x=>x!==i);
      else nh.push(i);
    });
    setHiddenItems(nh);
    await window.genius?.setHidden(nh);
    if (ids.length > 1) {
      toast(`${ids.length} items hidden — manage in Settings`, 'info');
    } else if (!hiddenItems.includes(ids[0])) {
      setSelected(null);
      toast('Item hidden — manage in Settings', 'info');
    } else {
      toast('Item unhidden', 'info');
    }
  }, [hiddenItems]);

  const addToCompare = useCallback(it => {
    if (it._add) {
      // called from CompareTab search — item already pushed to list externally; just force re-render
      setCompareList(prev => prev.find(c=>c.id===it.id) ? prev : [...prev.slice(0,3), it]);
      return;
    }
    setCompareList(prev => {
      if (prev.find(c=>c.id===it.id)) { toast('Already in compare','info'); return prev; }
      if (prev.length>=4) { toast('Max 4 items in compare','info'); return prev; }
      toast(`${it.name} added to compare`,'success');
      return [...prev, it];
    });
  }, []);

  // Filter hidden items from everything except the settings hidden manager
  const visibleItems = useMemo(() => {
    if (!hiddenItems.length) return items;
    return items.filter(it => !hiddenItems.includes(it.id));
  }, [items, hiddenItems]);

  const byCategory = useMemo(() => {
    const m={};
    visibleItems.forEach(it=>(it.categories||['materials']).forEach(c=>{if(!m[c])m[c]=[];m[c].push(it);}));
    return m;
  }, [visibleItems]);

  const catItems = useMemo(() => {
    if (['watchlist','market','opportunities','news','alerts','settings'].includes(tab)) return visibleItems;
    return byCategory[tab]||[];
  }, [tab,visibleItems,byCategory]);

  const handleFetch = async () => {
    setFetching(true);
    const res = await window.genius?.fetchNow('full');
    if (res&&!res.success) { setFetching(false); toast('Fetch failed','error'); }
  };

  const stale = lastUpdate ? Math.floor((Date.now()-lastUpdate)/60000) : null;
  const statusType = !lastUpdate ? 'none' : stale < 20 ? 'live' : 'stale';
  const statusText = !lastUpdate ? 'No data' : stale < 1 ? 'Live' : `${stale}m ago`;
  const showDetail = selected && !['alerts','settings'].includes(tab);

  const handleSelect = item => {
    if (selected && item && selected.id === item.id) { setSelected(null); return; }
    setSelected(item);
  };

  const handleSearchSelect = item => {
    setSelected(item);
    if (item.categories&&item.categories.length) setTab(item.categories[0]);
    // Scroll to item in the table after a short delay (tab switch needs to render first)
    setTimeout(() => {
      const row = document.querySelector(`tr[data-item-id="${item.id}"]`);
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.classList.add('search-highlight');
        setTimeout(() => row.classList.remove('search-highlight'), 2000);
      }
    }, 80);
  };

  const logicalW = scaleDims.w / uiScale, logicalH = scaleDims.h / uiScale;
  return h('div',{id:'scale-root', style:{
    width: logicalW, height: logicalH,
    transform: `scale(${uiScale})`,
  }},
  h('div',{className:'app', style:{width: logicalW, height: logicalH}},
    h('style',null,buildCSS()),
    theme==='black'&&h('style',null,buildBlackCss()),

    updateInfo && h('div', {style:{
      position:'fixed', bottom:16, right:16, zIndex:10000,
      background:T.panel2, border:`1px solid ${T.gold}`,
      borderRadius:6, padding:'10px 14px',
      boxShadow:'0 4px 20px rgba(0,0,0,0.6)',
      display:'flex', alignItems:'center', gap:12, maxWidth:340,
    }},
      h('div', null,
        h('div', {style:{fontSize:12, fontWeight:'bold', color:T.goldBright, marginBottom:2}},
          `GEnius v${updateInfo.latest} is available`),
        h('div', {style:{fontSize:11, color:T.textDim}},
          `You're on v${updateInfo.current}. Click to download the latest release.`),
      ),
      h('div', {style:{display:'flex', flexDirection:'column', gap:4, flexShrink:0}},
        h('button', {
          className:'ge-btn gold',
          style:{padding:'4px 10px', fontSize:11},
          onClick: () => window.genius?.openExternal(updateInfo.url),
        }, 'Download'),
        h('button', {
          className:'ge-btn',
          style:{padding:'4px 10px', fontSize:11},
          onClick: () => setUpdateInfo(null),
        }, '✕'),
      )
    ),

    h('nav',{className:'sidebar'},
      h('div',{style:{padding:'12px 12px 8px',borderBottom:`2px solid ${T.border}`,marginBottom:4}},
        h('div',{style:{fontFamily:'Cinzel,serif',fontSize:18,fontWeight:700,color:T.goldBright,letterSpacing:3,textShadow:`0 0 10px rgba(255,215,0,0.3)`}},'GE',h('span',{style:{color:T.copper}},'nius')),
        h('div',{style:{fontSize:9,color:T.textDim,letterSpacing:2,textTransform:'uppercase',marginTop:1}},'Market Intelligence')
      ),
      navItems.map((entry,i) =>
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
        h(GESearchBar,{items,onSelect:handleSearchSelect,userShorthands}),
        h('div',{className:'ge-status'},h('div',{className:`status-dot ${statusType}`}),statusText),
        h('button',{
          className:'ge-btn gold',disabled:fetching,onClick:handleFetch,
          style:{display:'flex',alignItems:'center',gap:6,flexShrink:0}
        },
          fetching&&h('span',{className:'spinner'}),
          fetching?'Fetching...':'Fetch Now'
        ),
        h('div',{style:{width:1,height:20,background:T.borderDim,flexShrink:0,margin:'0 2px'}}),
        h('button',{
          className:'ge-btn danger', title:'Quit GEnius',
          style:{padding:'4px 8px', flexShrink:0},
          onClick:()=>{ if (window.confirm('Quit GEnius? Background price fetching will stop.')) window.genius?.quitApp(); }
        }, '⏻')
      ),
      h('div',{style:{flex:1,display:'flex',overflow:'hidden'}},
        h('div',{className:'content',style:{flex:1}},
          tab==='dashboard'&&h(DashboardTab,{items:visibleItems,indexes,selected,onSelect:handleSelect,watchlist,onToggleWatch:toggleWatch,onToggleHide:toggleHide,onAddCompare:addToCompare,description:TAB_DESCRIPTIONS.dashboard,alerts,portfolio,onNavigate:setTab,news}),
          tab==='compare' &&h(CompareTab,{compareList,onRemove:it=>it._add?addToCompare(it):setCompareList(prev=>prev.filter(c=>c.id!==it.id)),onClear:()=>setCompareList([]),allItems:visibleItems,description:TAB_DESCRIPTIONS.compare}),
          tab==='watchlist'&&h(WatchlistTab,{items:visibleItems,watchlist,selected,onSelect:handleSelect,onToggleWatch:toggleWatch,description:TAB_DESCRIPTIONS.watchlist,devMode:settings.devMode}),
          tab==='invention'&&h(SplitTab,{items:catItems,selected,onSelect:handleSelect,watchlist,onToggleWatch:toggleWatch,onToggleHide:toggleHide,onAddCompare:addToCompare,description:TAB_DESCRIPTIONS.invention,splitLabel:'Components'}),
          tab==='herblore' &&h(SplitTab,{items:catItems,selected,onSelect:handleSelect,watchlist,onToggleWatch:toggleWatch,onToggleHide:toggleHide,onAddCompare:addToCompare,description:TAB_DESCRIPTIONS.herblore, splitLabel:'Combination Potions'}),
          ['melee','magic','ranged','necromancy','hybrid','ammo','pocket','artisan','food','farming','mining','prayer','archaeology','runes','summoning','boss','treasure_trails','rares','codex','cosmetics','low_tier','materials','supplies'].includes(tab)&&
            h(ItemTable,{items:catItems,selected,onSelect:handleSelect,watchlist,onToggleWatch:toggleWatch,onToggleHide:toggleHide,onAddCompare:addToCompare,description:TAB_DESCRIPTIONS[tab]||''}),
          tab==='alch'    &&h(AlchTab,    {items:visibleItems,selected,onSelect:handleSelect,watchlist,onToggleWatch:toggleWatch,description:TAB_DESCRIPTIONS.alch}),
          tab==='expensive'&&h(ExpensiveTab,{items:visibleItems,selected,onSelect:handleSelect,watchlist,onToggleWatch:toggleWatch,threshold:settings.expensiveThreshold||500000000,description:TAB_DESCRIPTIONS.expensive}),
          tab==='portfolio'&&h(PortfolioTab,{
            items, portfolio, toast,
            onSavePosition: async pos => {
              await window.genius?.savePosition(pos);
              const p = await window.genius?.getPortfolio();
              if (p) setPortfolio(p);
              // Anything you put real gp into is worth tracking on the
              // watchlist too — auto-add the item if it isn't there yet.
              const it = items.find(i => i.name === pos.item_name);
              if (it && !watchlist.includes(it.id)) {
                const nw = [...watchlist, it.id];
                setWatchlist(nw);
                await window.genius?.setWatchlist(nw);
              }
            },
            onDeletePosition: async id => { await window.genius?.deletePosition(id); const p = await window.genius?.getPortfolio(); if(p) setPortfolio(p); },
            onSellPosition: async opts => { const r = await window.genius?.sellPosition(opts); const p = await window.genius?.getPortfolio(); if(p) setPortfolio(p); return r; },
            onSelect: handleSelect,
            devMode: settings.devMode,
          }),
          tab==='market'        &&h(MarketTab,        {items:visibleItems,selected,onSelect:handleSelect,description:TAB_DESCRIPTIONS.market}),
          tab==='opportunities' &&h(OpportunitiesTab, {items:visibleItems,selected,onSelect:handleSelect,description:TAB_DESCRIPTIONS.opportunities}),
          tab==='news'    &&h(NewsTab,    {news,onOpen:url=>window.genius?.openExternal(url),description:TAB_DESCRIPTIONS.news,items:visibleItems,onSelect:handleSelect}),
          tab==='alerts'  &&h(AlertsTab,  {
            items,alerts,toast,description:TAB_DESCRIPTIONS.alerts,
            onSave: a  =>setAlerts(al=>{const i=al.findIndex(x=>x.id===a.id);return i>=0?al.map((x,j)=>j===i?a:x):[...al,a];}),
            onDelete:id=>setAlerts(al=>al.filter(a=>a.id!==id)),
            reminders,
            onSaveReminder: r =>setReminders(rl=>{const i=rl.findIndex(x=>x.id===r.id);return i>=0?rl.map((x,j)=>j===i?r:x):[...rl,r];}),
            onDeleteReminder: id=>setReminders(rl=>rl.filter(r=>r.id!==id)),
          }),
          tab==='settings'&&h(SettingsTab,{settings,onChange:setSettings,toast,hiddenItems,items,onUnhide:toggleHide,userShorthands,onSaveShorthands:async sh=>{await window.genius?.saveShorthands(sh);setUserShorthands(sh);}}),
          tab==='about'&&h(AboutTab),
          tab==='dxp_intel'&&h(DXPIntelTab,{items,selected,onSelect:handleSelect})
        ),
        showDetail&&h('div',{style:{position:'relative', display:'flex'}},
          h('div',{
            onMouseDown:startPanelResize,
            style:{width:5, cursor:'col-resize', flexShrink:0, background:'transparent'},
            title:'Drag to resize',
          }),
          h(DetailPanel,{item:selected,watchlist,onToggleWatch:toggleWatch,onToggleHide:toggleHide,hiddenItems,onClose:()=>setSelected(null),onCategoryChange:()=>{},notes,onSaveNote:(id,text)=>{window.genius?.saveNote(id,text);setNotes(n=>({...n,[id]:text}));},allItems:items,dateFormat:settings.dateFormat,onAddToPortfolio:pos=>setQuickAddPos(pos),panelWidth:detailPanelWidth,populatedHistoryIds}),
        ),
      h(HistoryPopup,{state:historyPopup, onDismiss:()=>setHistoryPopup(null)})
      )
    ),

    quickAddPos && h(PositionModal, {
      items,
      position: {...quickAddPos, id: Date.now().toString(), status:'open', created_at: new Date().toISOString()},
      onClose: () => setQuickAddPos(null),
      onSave: async (pos, createAlert) => {
        await window.genius?.savePosition(pos);
        const p = await window.genius?.getPortfolio();
        if (p) setPortfolio(p);
        if (createAlert && pos.target_price) {
          await window.genius?.saveAlert({id:`p-${pos.id}`, item_name:pos.item_name, condition:'above', price:pos.target_price});
        }
        setQuickAddPos(null);
        toast('Position added', 'success');
      },
    }),

    h('div',{className:'toast-tray'},
      toasts.map(t=>h('div',{key:t.id,className:`toast ${t.type}`},t.msg))
    )
  ));
}

createRoot(document.getElementById('root')).render(h(App,null));
