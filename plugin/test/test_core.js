// Runs plugin/core/genius_core.lua inside fengari (Lua 5.3 in JS) and checks
// every function against the desktop app's JavaScript on fixed edge cases
// plus thousands of random inputs. The JS references below are copied
// verbatim from src/renderer.js / src/backend-js/api.js — if those change,
// update them here too (the test exists to catch the two drifting apart).
//
//   cd plugin && npm install && npm test
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require('fengari');

// ─── JS references (verbatim from the app) ────────────────────────────────
const JS = {
  applyTax: price => price < 50 ? price : Math.floor(price * 0.98),
  saleNet: (price, qty) => price >= 50 ? Math.round(price * qty * 0.98) : price * qty,
  breakEvenPrice: cost => { const untaxed = Math.ceil(cost); return untaxed < 50 ? untaxed : Math.ceil(cost / 0.98); },
  gp: n => { if (!n && n !== 0) return '—'; const a = Math.abs(n); if (a >= 1e9) return (n/1e9).toFixed(2)+'B'; if (a >= 1e6) return (n/1e6).toFixed(2)+'M'; if (a >= 1e3) return (n/1e3).toFixed(1)+'K'; return n.toLocaleString('en-US'); },
  pct: n => (n >= 0 ? '+' : '') + n.toFixed(2) + '%',
  positionPL: (costBasis, quantity, currentPrice) => {
    const currentValue = currentPrice * quantity;
    const costValue = costBasis * quantity;
    const grossPL = currentValue - costValue;
    const tax = currentValue - JS.saleNet(currentPrice, quantity);
    const netPL = grossPL - tax;
    const plPct = costValue > 0 ? (grossPL / costValue) * 100 : 0;
    return { value: currentValue, cost: costValue, grossPL, tax, netPL, plPct };
  },
  plannerPace: history => {
    if (!history || history.length < 2) return null;
    const first = history[0], last = history[history.length - 1];
    const days = (last.t - first.t) / 86400000;
    if (days < 0.5) return null;
    const perDay = (last.bought - first.bought) / days;
    return perDay > 0 ? { perDay, updates: history.length } : null;
  },
  plannerFinish: (left, perDay, now) => { if (!(perDay > 0)) return null; const days = Math.ceil(left / perDay); return { days, date: now + days * 86400000 }; },
  plannerEstimates: (goal, item, now) => {
    const left = Math.max(0, (goal.target || 0) - (goal.bought || 0));
    const limit = item.limit || null;
    const share = (goal.marketShare || 25) / 100;
    const best = limit ? JS.plannerFinish(left, limit * 6, now) : null;
    const marketPerDay = item.dailyVolume ? Math.min(item.dailyVolume * share, limit ? limit * 6 : Infinity) : null;
    const market = marketPerDay ? JS.plannerFinish(left, marketPerDay, now) : null;
    const pace = JS.plannerPace(goal.history);
    const yours = pace ? JS.plannerFinish(left, pace.perDay, now) : null;
    const slowest = [['best', best], ['market', market], ['pace', yours]].filter(([, e]) => e).sort((a, b) => b[1].days - a[1].days)[0];
    const bottleneck = slowest && [best, market, yours].filter(Boolean).some(e => e.days < slowest[1].days) ? slowest[0] : null;
    return { left, best, market, yours, bottleneck };
  },
};

// ─── Lua side ─────────────────────────────────────────────────────────────
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const src = fs.readFileSync(path.join(__dirname, '..', 'genius', 'core', 'genius_core.lua'), 'utf8');
if (lauxlib.luaL_loadstring(L, to_luastring(src)) !== lua.LUA_OK || lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK) {
  console.error('Lua load error:', to_jsstring(lua.lua_tostring(L, -1))); process.exit(1);
}
lua.lua_setglobal(L, to_luastring('core'));

// Call core.<fn>(...args) where args are Lua source literals; returns a JS
// value converted from the result (numbers, strings, tables → objects).
function luaCall(expr) {
  const code = `return ${expr}`;
  if (lauxlib.luaL_loadstring(L, to_luastring(code)) !== lua.LUA_OK || lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK) {
    throw new Error(to_jsstring(lua.lua_tostring(L, -1)) + ' in: ' + code);
  }
  const v = toJS(-1); lua.lua_pop(L, 1); return v;
}
function toJS(idx) {
  const t = lua.lua_type(L, idx);
  if (t === lua.LUA_TNIL) return null;
  if (t === lua.LUA_TNUMBER) return lua.lua_tonumber(L, idx);
  if (t === lua.LUA_TSTRING) return to_jsstring(lua.lua_tostring(L, idx));
  if (t === lua.LUA_TBOOLEAN) return lua.lua_toboolean(L, idx);
  if (t === lua.LUA_TTABLE) {
    const o = {}; const abs = lua.lua_absindex(L, idx);
    lua.lua_pushnil(L);
    while (lua.lua_next(L, abs) !== 0) {
      const k = lua.lua_type(L, -2) === lua.LUA_TSTRING ? to_jsstring(lua.lua_tostring(L, -2)) : lua.lua_tonumber(L, -2);
      o[k] = toJS(-1); lua.lua_pop(L, 1);
    }
    return o;
  }
  return undefined;
}
const lit = v => v === null || v === undefined ? 'nil' : typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toPrecision(17))
  : Array.isArray(v) ? '{' + v.map(lit).join(',') + '}'
  : typeof v === 'object' ? '{' + Object.entries(v).filter(([, x]) => x !== null && x !== undefined).map(([k, x]) => `${k}=${lit(x)}`).join(',') + '}' : JSON.stringify(v);

// ─── Checks ──────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
const close = (a, b) => (a === null && b === null) || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b)));
function check(name, args, jsVal, luaVal, cmp = (a, b) => a === b || close(a, b)) {
  // A Lua table field that's nil simply doesn't exist, so it arrives as
  // undefined — same meaning as JS null.
  if (jsVal === undefined) jsVal = null;
  if (luaVal === undefined) luaVal = null;
  if (cmp(jsVal, luaVal)) { pass++; return; }
  fail++;
  if (fail <= 25) console.log(`FAIL ${name}(${args}): js=${JSON.stringify(jsVal)} lua=${JSON.stringify(luaVal)}`);
}
const objEq = keys => (a, b) => (a === null && b === null) || (a && b && keys.every(k => close(a[k], b[k]) || a[k] === b[k]));

let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const randPrice = () => { const r = rnd(); return r < 0.15 ? Math.floor(rnd() * 60) : r < 0.5 ? Math.floor(rnd() * 100000) : r < 0.85 ? Math.floor(rnd() * 5e8) : Math.floor(rnd() * 2.5e11); };
const randQty = () => [1, 2, 10, 100, 1000, 10000, 200000][Math.floor(rnd() * 7)] + Math.floor(rnd() * 50);

// Fixed edge cases: the 49/50 boundary, rounding halves, huge prices.
const prices = [0, 1, 49, 50, 51, 99, 100, 101, 149, 150, 999, 1000, 4992, 32084, 46510, 74500, 683670000, 2147483647, 57600000000];
for (const p of prices) for (const q of [1, 3, 7, 13, 630, 10000, 200000]) {
  check('applyTax', p, JS.applyTax(p), luaCall(`core.applyTax(${p})`));
  check('saleNet', `${p},${q}`, JS.saleNet(p, q), luaCall(`core.saleNet(${p},${q})`));
}
for (let i = 0; i < 4000; i++) {
  const p = randPrice(), q = randQty();
  check('applyTax', p, JS.applyTax(p), luaCall(`core.applyTax(${p})`));
  check('saleNet', `${p},${q}`, JS.saleNet(p, q), luaCall(`core.saleNet(${p},${q})`));
  const cost = rnd() < 0.3 ? Math.floor(rnd() * 80) + rnd() : rnd() * 1e7;
  check('breakEvenPrice', cost, JS.breakEvenPrice(cost), luaCall(`core.breakEvenPrice(${lit(cost)})`));
  const cp = Math.max(0, p);
  check('positionPL', `${cost},${q},${cp}`, JS.positionPL(cost, q, cp), luaCall(`core.positionPL(${lit(cost)},${q},${cp})`), objEq(['value', 'cost', 'grossPL', 'tax', 'netPL', 'plPct']));
}
const gps = [0, 1, 7, 999, 1000, 1049, 1050, 32084, 999949, 999950, 1e6, 20213090, 999994999, 1e9, 2.26e9, 57.6e9, -348010000, -1500, -42, 345.6, 12.25, 0.5];
for (let i = 0; i < 2000; i++) gps.push(((rnd() < 0.5 ? -1 : 1) * Math.floor(rnd() * 10 ** Math.floor(rnd() * 12))) || 0); // `|| 0`: no JS negative zero ("-0")
for (const n of gps) check('gp', n, JS.gp(n), luaCall(`core.gp(${lit(n)})`));
for (const n of [0, 1.234, -1.235, 99.999, -0.004, 16.28, -77.03, 181.8]) check('pct', n, JS.pct(n), luaCall(`core.pct(${lit(n)})`));

// Buy Planner, including the real hatchet goal (Sep 2 → Oct 6 updates).
const now = Date.parse('2026-10-07T12:00:00Z');
const hatchet = { target: 10000, bought: 630, marketShare: 25,
  history: [{ t: Date.parse('2026-09-02T23:05:34Z'), bought: 468 }, { t: Date.parse('2026-10-02T00:40:50Z'), bought: 630 }, { t: Date.parse('2026-10-06T16:51:09Z'), bought: 630 }] };
const cases = [[hatchet, { limit: 10, dailyVolume: 450 }], [hatchet, { limit: 10, dailyVolume: 100 }], [hatchet, { limit: null, dailyVolume: 450 }],
  [{ target: 500, bought: 0, history: [] }, { limit: 100, dailyVolume: 5000 }], [{ target: 500, bought: 500, history: [] }, { limit: 100, dailyVolume: 5000 }]];
for (let i = 0; i < 500; i++) {
  const hist = []; let t = now - Math.floor(rnd() * 60) * 86400000, b = Math.floor(rnd() * 1000);
  for (let k = 0; k < Math.floor(rnd() * 5); k++) { hist.push({ t, bought: b }); t += Math.floor(rnd() * 10 * 86400000); b += Math.floor(rnd() * 200); }
  cases.push([{ target: Math.floor(rnd() * 20000), bought: Math.floor(rnd() * 5000), marketShare: [10, 25, 50, 100][Math.floor(rnd() * 4)], history: hist },
    { limit: rnd() < 0.15 ? null : [1, 10, 100, 1000, 25000][Math.floor(rnd() * 5)], dailyVolume: rnd() < 0.15 ? null : Math.floor(rnd() * 100000) }]);
}
for (const [goal, item] of cases) {
  const js = JS.plannerEstimates(goal, item, now);
  const lu = luaCall(`core.plannerEstimates(${lit(goal)},${lit(item)},${now})`);
  const days = e => e ? e.days : null;
  check('planner.left', JSON.stringify(goal).slice(0, 60), js.left, lu.left);
  check('planner.best', '', days(js.best), days(lu.best));
  check('planner.market', '', days(js.market), days(lu.market));
  check('planner.yours', '', days(js.yours), days(lu.yours));
  check('planner.bottleneck', '', js.bottleneck, lu.bottleneck);
}
const hj = JS.plannerEstimates(hatchet, { limit: 10, dailyVolume: 450 }, now);
console.log(`Hatchet goal: best ${hj.best.days}d, market ${hj.market.days}d, your pace ${hj.yours.days}d, bottleneck: ${hj.bottleneck}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
