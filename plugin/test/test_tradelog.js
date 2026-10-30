// Runs plugin/core/tradelog.lua inside fengari and checks that trades are
// found correctly between two readings of the GE offer slots.
//
//   cd plugin && npm test
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require('fengari');

const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
function loadFile(rel) {
  const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  if (lauxlib.luaL_loadstring(L, to_luastring(src)) !== lua.LUA_OK || lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK) {
    console.error('Lua load error in', rel, ':', to_jsstring(lua.lua_tostring(L, -1))); process.exit(1);
  }
}
// tradelog.lua does require("core/genius_core"): register that module first.
lua.lua_getglobal(L, to_luastring('package'));
lua.lua_getfield(L, -1, to_luastring('loaded'));
loadFile('genius/core/genius_core.lua');
lua.lua_setfield(L, -2, to_luastring('core/genius_core'));
lua.lua_pop(L, 2);
loadFile('genius/core/tradelog.lua');
lua.lua_setglobal(L, to_luastring('tradelog'));

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
  return '<' + t + '>';
}
function run(code) {
  if (lauxlib.luaL_loadstring(L, to_luastring('return ' + code)) !== lua.LUA_OK || lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK) {
    throw new Error(to_jsstring(lua.lua_tostring(L, -1)) + ' in: ' + code);
  }
  const v = toJS(-1); lua.lua_pop(L, 1); return v;
}
let passed = 0, failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else { failed++; console.log('FAIL', name, '\n  got     ', JSON.stringify(actual), '\n  expected', JSON.stringify(expected)); }
}
// Lua arrays come back as {1: ..., 2: ...}; turn them into JS arrays.
const list = o => (o ? Object.keys(o).sort((a, b) => a - b).map(k => o[k]) : []);
const find = (prev, curr, n = 8) => list(run(`tradelog.findTrades(${prev}, ${curr}, ${n}, 1000)`));

const shards = (done, gold) => `{kind="sell", item="Shard of Genesis Essence", price=685000000, itemCount=3, doneCount=${done}${gold != null ? ', goldSoFar=' + gold : ''}}`;

// 1. Nothing changed: no trades.
check('no change', find(`{[1]=${shards(1)}}`, `{[1]=${shards(1)}}`), []);

// 2. Partial fill: 1 -> 3 of 3 sold = 2 sold at asking price, taxed.
let t = find(`{[1]=${shards(1)}}`, `{[1]=${shards(3)}}`);
check('partial fill: count', t.length, 1);
check('partial fill: qty', t[0].qty, 2);
check('partial fill: gross', t[0].gross, 1370000000);
check('partial fill: net (after 2%)', t[0].net, 1342600000);   // Ben's real sale, 2026-10-16
check('partial fill: tax', t[0].tax, 27400000);
check('partial fill: slot', t[0].slot, 1);

// 3. Sell filled ABOVE asking: real gold reported by the game wins.
t = find(`{[2]=${shards(0, 0)}}`, `{[2]=${shards(1, 700000000)}}`);
check('above asking: pricePer uses real gold', t[0].pricePer, 700000000);
check('above asking: net', t[0].net, 686000000);

// 3a. Real in-game sale (2026-10-19): 861,312 Incandescent energy at 163. The
// game reported 140,393,856 gold; the GE screen said "received 137,585,979".
t = find(`{[1]={kind="sell", item="Incandescent energy", price=163, itemCount=861312, doneCount=0, goldSoFar=0}}`,
         `{[1]={kind="sell", item="Incandescent energy", price=163, itemCount=861312, doneCount=861312, goldSoFar=140393856}}`);
check('real sale: gross = game gold', t[0].gross, 140393856);
check('real sale: net = what the GE screen showed', t[0].net, 137585979);

// 3b. Gold collected in between (gold waiting dropped): fall back to asking price.
t = find(`{[2]=${shards(1, 685000000)}}`, `{[2]=${shards(2, 0)}}`);
check('gold collected: falls back to asking', t[0].gross, 685000000);
// 3c. Buys ignore the gold figure (it is leftover change, not spend).
t = find(`{[5]={kind="buy", item="Vulnerability bomb", price=20000, itemCount=10, doneCount=0, goldSoFar=0}}`,
         `{[5]={kind="buy", item="Vulnerability bomb", price=20000, itemCount=10, doneCount=10, goldSoFar=5000}}`);
check('buy: change ignored, spent = asking x qty', t[0].gross, 200000);

// 4. A brand-new offer in a slot counts everything done so far.
const bombsBuy = done => `{kind="buy", item="Vulnerability bomb", price=20000, itemCount=100000, doneCount=${done}}`;
t = find(`{[3]=${shards(3)}}`, `{[3]=${bombsBuy(25000)}}`);
check('new offer: whole done count', t[0].qty, 25000);
check('new offer: buy spent', t[0].gross, 500000000);
check('new offer: buys have no tax', t[0].tax ?? null, null);

// 5. Same item but a different price = a different offer (not merged).
t = find(`{[1]=${shards(2)}}`, `{[1]={kind="sell", item="Shard of Genesis Essence", price=670000000, itemCount=3, doneCount=1}}`);
check('repriced: counts as new offer', t[0].qty, 1);

// 6. Slot emptied (offer collected): no trade from the empty slot.
check('emptied slot', find(`{[1]=${shards(3)}}`, `{}`), []);

// 7. Several slots at once, in slot order.
t = find(`{[1]=${shards(1)}, [4]=${bombsBuy(0)}}`, `{[1]=${shards(2)}, [4]=${bombsBuy(1000)}}`);
check('two slots: count', t.length, 2);
check('two slots: order', [t[0].slot, t[1].slot], [1, 4]);

// 8. Session summary.
const s = run(`tradelog.summarize(tradelog.findTrades({[1]=${shards(1)}, [4]=${bombsBuy(0)}}, {[1]=${shards(3)}, [4]=${bombsBuy(1000)}}, 8, 1000))`);
check('summary', s, { bought: 1000, spent: 20000000, sold: 2, received: 1342600000, tax: 27400000 });

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
