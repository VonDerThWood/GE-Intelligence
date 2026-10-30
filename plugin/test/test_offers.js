// Runs plugin/core/offers.lua inside fengari (Lua in JS) and checks the
// offer-vs-market comparison on hand-picked cases, including the edge cases
// (no live price, exactly at the market, partly filled offers).
//
//   cd plugin && npm test
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require('fengari');

const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);

// Load a Lua file and leave its returned table on the stack.
function loadFile(rel) {
  const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  if (lauxlib.luaL_loadstring(L, to_luastring(src)) !== lua.LUA_OK || lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK) {
    console.error('Lua load error in', rel, ':', to_jsstring(lua.lua_tostring(L, -1))); process.exit(1);
  }
}

// offers.lua does require("core/genius_core"): register that module first.
lua.lua_getglobal(L, to_luastring('package'));
lua.lua_getfield(L, -1, to_luastring('loaded'));
loadFile('genius/core/genius_core.lua');
lua.lua_setfield(L, -2, to_luastring('core/genius_core'));
lua.lua_pop(L, 2);
loadFile('genius/core/offers.lua');
lua.lua_setglobal(L, to_luastring('offers'));

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
      o[to_jsstring(lua.lua_tostring(L, -2))] = toJS(-1); lua.lua_pop(L, 1);
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
const cmp = (offer, market) => run(`offers.compareOffer(${offer}, ${market})`);
const desc = (offer, market) => run(`offers.describe(${offer}, offers.compareOffer(${offer}, ${market}))`);

// Sell above buyers: Anima core legs listed at 13.7M while buyers pay 13.1M.
const legs = '{kind="sell", price=13700000, itemCount=1, doneCount=0}';
const legsMkt = '{instantBuy=13100000, instantSell=11200000}';
check('sell above: outlook', cmp(legs, legsMkt).outlook, 'slow');
check('sell above: gap', cmp(legs, legsMkt).gapGp, 600000);
check('sell above: net after tax', cmp(legs, legsMkt).netForRest, 13426000);
check('sell above: text', desc(legs, legsMkt), 'Selling above buyers by 600.0K (+4.58%) - may sit');

// Sell at or under what buyers pay: should fill.
check('sell at market: outlook', cmp('{kind="sell", price=13100000, itemCount=1, doneCount=0}', legsMkt).outlook, 'likely');
check('sell at market: text', desc('{kind="sell", price=13100000, itemCount=1, doneCount=0}', legsMkt), 'At the market - should fill soon');
check('sell below buyers: text', desc('{kind="sell", price=12000000, itemCount=1, doneCount=0}', legsMkt), 'Selling below buyers by 1.10M (-8.40%) - should fill soon');

// Within the 1% tolerance counts as at the market.
check('sell 0.4% above: outlook', cmp('{kind="sell", price=1004, itemCount=10, doneCount=0}', '{instantBuy=1000}').outlook, 'likely');
check('sell 0.9% above: outlook', cmp('{kind="sell", price=1009, itemCount=10, doneCount=0}', '{instantBuy=1000}').outlook, 'likely');
check('sell 1.1% above: outlook', cmp('{kind="sell", price=1011, itemCount=10, doneCount=0}', '{instantBuy=1000}').outlook, 'slow');

// Buy offers are judged against sellers (instantSell).
const bombs = '{kind="buy", price=20000, itemCount=100000, doneCount=25000}';
check('buy below sellers: outlook', cmp(bombs, '{instantBuy=20750, instantSell=20300}').outlook, 'slow');
check('buy below sellers: remaining', cmp(bombs, '{instantBuy=20750, instantSell=20300}').remaining, 75000);
check('buy: no tax figure', cmp(bombs, '{instantBuy=20750, instantSell=20300}').netForRest ?? null, null);
check('buy below sellers: text', desc(bombs, '{instantBuy=20750, instantSell=20300}'), 'Buying below sellers by 300 (-1.48%) - may sit');
check('buy above sellers: outlook', cmp('{kind="buy", price=21000, itemCount=10, doneCount=0}', '{instantSell=20300}').outlook, 'likely');

// No live price: say nothing rather than guess.
check('no price: outlook', cmp(legs, '{}').outlook, 'unknown');
check('no price: no gap', cmp(legs, '{}').gapGp ?? null, null);
check('no price: text', desc(legs, '{}'), 'No live price right now');

// Partly sold: tax maths covers only what is left; under 50gp is untaxed.
check('partly sold: net', cmp('{kind="sell", price=1000, itemCount=100, doneCount=40}', '{instantBuy=1000}').netForRest, 58800);
check('cheap item: untaxed', cmp('{kind="sell", price=40, itemCount=10, doneCount=0}', '{instantBuy=40}').netForRest, 400);

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
