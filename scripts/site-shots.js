/**
 * Retakes GitHub Pages screenshots from a running TEST MODE window, with FAKE
 * portfolio / watchlist / alerts / net worth so Ben's real holdings never go
 * public. Both themes: Classic (saved as <name>-dark.png) and Dark (<name>-black.png).
 *
 *   npm run test-mode            (in another terminal; test mode copies real data)
 *   node scripts/site-shots.js dashboard item flips money-makers
 *   (then quit test mode: it rebuilds its data folder from the real one next launch)
 *
 * 1440x900, the size of the existing shots in docs/assets/shots/.
 */
const fs = require('fs'), path = require('path');
const PORT = process.env.GENIUS_CDP_PORT || 9333;
const OUT = path.join(__dirname, '..', 'docs', 'assets', 'shots');
const TEST_DATA = path.join(process.env.APPDATA, 'GEnius-test', 'data');
const wait = ms => new Promise(r => setTimeout(r, ms));

// ── Fake data: ordinary items at believable prices, nothing of Ben's ──
function fakeData(items) {
  const by = n => items.find(i => i.name === n);
  const now = Date.now(), day = 86400000;
  const pos = [
    ['Dragon bones', 20000, 0.93, 40], ['Blood rune', 60000, 0.97, 25], ['Magic logs', 15000, 1.06, 18],
    ['Super restore (4)', 4000, 0.95, 12], ['Prayer renewal (4)', 2500, 1.04, 9], ['Black dragonhide', 8000, 0.9, 30],
  ].filter(([n]) => by(n)).map(([n, q, f, ago], i) => {
    const it = by(n), cost = Math.round((it.high || it.low) * f);
    return { id: 'demo' + i, item_name: n.toLowerCase(), quantity: q, cost_basis: cost, target_price: null, target_profit_pct: null,
      stop_loss: null, status: 'open', created_at: new Date(now - ago * day).toISOString(), date_opened: new Date(now - ago * day).toISOString().slice(0, 10) };
  });
  const portfolio = { positions: pos, tax_stats: { total_tax_paid: 0, trades_taxed: 0 }, buy_goals: [] };
  const alerts = [
    { id: 'demoa1', item_name: 'dragon bones', condition: 'below', price: 850, active: true },
    { id: 'demoa2', item_name: 'magic logs', condition: 'above', price: Math.round((by('Magic logs')?.high || 1000) * 1.1), active: true },
    { id: 'demoa3', item_name: 'blood rune', condition: 'below', price: 240, active: true },
  ];
  const watch = ['Dragon bones', 'Magic logs', 'Blood rune', 'Super restore (4)', 'Yew logs', 'Uncut onyx', 'Gold bar', 'Spirit weed seed']
    .map(n => by(n)?.id).filter(Boolean);
  const cost = pos.reduce((a, p) => a + p.cost_basis * p.quantity, 0);
  const netWorth = Array.from({ length: 45 }, (_, i) => {
    const d = new Date(now - (44 - i) * day).toISOString().slice(0, 10);
    return { date: d, value: Math.round(cost * (0.97 + 0.08 * i / 44 + 0.015 * Math.sin(i / 3))), cost };
  });
  return { portfolio, alerts, watch, netWorth };
}

(async () => {
  const want = process.argv.slice(2);
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = list.find(t => t.type === 'page');
  let ws, id = 0; const pending = {};
  const connect = async () => {
    ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; } };
    await new Promise(r => { ws.onopen = r; });
  };
  await connect();
  const send = (method, params) => new Promise(r => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const js = async expr => { const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: `(async () => (${expr}))()` }); return r.result?.result?.value; };
  const until = async (expr, ms = 60000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await js(expr)) return true; await wait(500); } return false; };

  // Fake data in the test copy (never the real folder).
  const items = JSON.parse(fs.readFileSync(path.join(TEST_DATA, 'latest.json'), 'utf8')).items;
  const F = fakeData(items);
  if (!TEST_DATA.includes('GEnius-test')) throw new Error('refusing: not the test data folder');
  fs.writeFileSync(path.join(TEST_DATA, 'portfolio.json'), JSON.stringify(F.portfolio, null, 2));
  fs.writeFileSync(path.join(TEST_DATA, 'alerts.json'), JSON.stringify(F.alerts, null, 2));
  fs.writeFileSync(path.join(TEST_DATA, 'net_worth.json'), JSON.stringify(F.netWorth));
  await js(`window.genius.setWatchlist(${JSON.stringify(F.watch)})`);
  await js(`window.genius.testSeedInbox && window.genius.testSeedInbox([])`);

  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const SHOTS = {
    'dashboard': `window.__geniusTest.goto('dashboard')`,
    'flips': `window.__geniusTest.goto('flips')`,
    'item': `(window.__geniusTest.goto('market'), new Promise(r => setTimeout(r, 1500)).then(() => window.__geniusTest.openItem('Dragon dart tip')))`,
    // Farming open (Ben, 2026-11-23): shows the skill pills and the newest calculator.
    'money-makers': `window.__geniusTest.goto('money_makers').then(() => new Promise(r => setTimeout(r, 1200))).then(() => { const b = [...document.querySelectorAll('.content button')].find(x => x.textContent.trim() === 'Farming'); b && b.click(); return new Promise(r => setTimeout(r, 2000)); })`,
    'watchlist': `window.__geniusTest.goto('watchlist')`,
    // Phone shots: 412x915 at 2x (824x1830, the size on the site). IS_PHONE is
    // set once at load, so these run after a reload at phone size (below).
    'phone-dashboard': `window.__geniusTest.goto('dashboard')`,
    'phone-portfolio': `window.__geniusTest.goto('portfolio')`,
    'phone-market': `window.__geniusTest.goto('watchlist')`,
  };
  const DESK = { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false };
  const PHONE = { width: 412, height: 915, deviceScaleFactor: 2, mobile: true };
  const groups = [[DESK, want.filter(n => !n.startsWith('phone-'))], [PHONE, want.filter(n => n.startsWith('phone-'))]].filter(g => g[1].length);
  for (const [theme, suffix] of [['dark', 'dark'], ['black', 'black']]) for (const [METRICS, names] of groups) {
    await send('Emulation.setDeviceMetricsOverride', METRICS);
    await js(`window.genius.getSettings().then(s => window.genius.saveSettings({...s, theme: '${theme}'}))`);
    await js(`(localStorage.setItem('pageGuidesOff','true'), localStorage.removeItem('genius_dash_folds'), localStorage.removeItem('genius_goodnow_open'), location.reload(), true)`).catch(() => {});
    await wait(2000);
    try { ws.close(); } catch {}
    await connect();
    await send('Emulation.setDeviceMetricsOverride', METRICS);
    await until(`!!window.__geniusTest && document.body.innerText.length > (${METRICS.mobile} ? 800 : 3000)`);
    // The theme applies once settings have loaded after the reload; the first
    // shot came out in the wrong theme with only 4s (2026-11-12).
    await wait(10000);
    for (const name of names) {
      if (!SHOTS[name]) { console.log('unknown shot ' + name); continue; }
      // Close any open item panel first (the item shot leaves one open).
      if (name !== 'item') { await js(`([...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'X')?.click(), true)`); await wait(400); }
      await js(SHOTS[name]);
      await wait(name === 'flips' ? 1000 : 3500);
      // Every visible row needs its risk worked out: a "—" or "…" in the Risk column
      // made the Nov 12 shot look like items had no rating (Ben caught it).
      if (name === 'flips') await until(`[...document.querySelectorAll('.pt-flips tbody tr')].slice(0, 14).every(tr => { const t = tr.children[1]?.textContent.trim(); return t && t !== '—' && t !== '…'; })`, 180000);
      // Fill time comes from hourly volume that loads in the background (2026-11-18).
      if (name === 'flips') await until(`(() => { const t = document.querySelector('.pt-flips'); const c = [...t.querySelectorAll('thead th')].findIndex(th => /Fill time/.test(th.textContent)); return c >= 0 && [...t.querySelectorAll('tbody tr')].slice(0, 10).filter(tr => /\\d/.test(tr.children[c]?.textContent || '')).length >= 8; })()`, 180000);
      if (name === 'flips') await until(`!document.body.innerText.includes('Still working out risk') && [...document.querySelectorAll('button')].some(b => /^Low risk \\([1-9]/.test(b.textContent))`, 120000), await wait(1500);
      await js(`(document.querySelector('.content').scrollTop = 0, true)`);
      await wait(600);
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(OUT, `${name}-${suffix}.png`);
      fs.writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
      console.log('saved', file);
    }
  }
  await send('Emulation.clearDeviceMetricsOverride', {});
  process.exit(0);
})().catch(e => { console.log('ERROR:', e.message); process.exit(1); });
