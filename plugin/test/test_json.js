// Runs plugin/genius/core/json.lua inside fengari and checks it
// against JavaScript's own JSON.parse on the same text.
//
//   cd plugin && npm test
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require('fengari');

const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const src = fs.readFileSync(path.join(__dirname, '..', 'genius', 'core', 'json.lua'), 'utf8');
if (lauxlib.luaL_loadstring(L, to_luastring(src)) !== lua.LUA_OK || lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK) {
  console.error('Lua load error:', to_jsstring(lua.lua_tostring(L, -1))); process.exit(1);
}
lua.lua_setglobal(L, to_luastring('json'));

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
// Decode text in Lua and return [value, error] as JS.
function decode(text) {
  lua.lua_getglobal(L, to_luastring('json'));
  lua.lua_getfield(L, -1, to_luastring('decode'));
  lua.lua_pushstring(L, to_luastring(text));
  if (lua.lua_pcall(L, 1, 2, 0) !== lua.LUA_OK) throw new Error(to_jsstring(lua.lua_tostring(L, -1)));
  const value = toJS(-2), err = toJS(-1);
  lua.lua_pop(L, 3);
  return [value, err];
}
// Lua arrays come back keyed 1..n: compare against JS arrays as such.
function luaify(v) {
  if (Array.isArray(v)) { const o = {}; v.forEach((x, i) => { if (x !== null) o[i + 1] = luaify(x); }); return o; }
  if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) if (x !== null) o[k] = luaify(x); return o; }
  return v;
}

let passed = 0, failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else { failed++; console.log('FAIL', name, '\n  got     ', JSON.stringify(actual), '\n  expected', JSON.stringify(expected)); }
}

// The wiki's live price reply for one item (shape of /api/v2/rs/latest?id=...).
const wiki = '{"data":{"29324":{"high":166,"highTime":1792430000,"low":160,"lowTime":1792429000}}}';
check('wiki reply', decode(wiki)[0], luaify(JSON.parse(wiki)));
check('wiki: read a price', decode(wiki)[0].data['29324'].high, 166);
// An item with no recent instant-sell comes back with null.
check('null becomes missing', decode('{"high":5,"low":null}')[0], { high: 5 });

// General JSON, compared with JavaScript's own parser.
for (const text of [
  '[]', '{}', '[1,2,3]', '{"a":[1,{"b":"c"}],"d":true,"e":false}',
  ' { "spaced" : [ 1 , 2 ] } ', '-12.5', '1e3', '"plain"',
  '"esc \\" \\\\ \\/ \\n \\t"', '"unicode \\u00e9 \\u20ac"', '[[[]]]', '{"n":-0.25,"big":143259037}',
]) check('matches JSON.parse: ' + text, decode(text)[0], luaify(JSON.parse(text)));

// Bad input: returns nil and an error, never crashes.
for (const bad of ['', '{', '[1,', '{"a" 1}', 'nope', '[1] extra', '"unterminated']) {
  const [v, err] = decode(bad);
  check('bad input rejected: ' + JSON.stringify(bad), v === null && typeof err === 'string', true);
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
