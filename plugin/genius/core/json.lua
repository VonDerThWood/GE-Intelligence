-- GEnius JSON reader: turns JSON text (what web APIs send back) into Lua
-- tables. The plugin system has no JSON decoder, and the RuneScape Wiki's
-- live prices arrive as JSON, so this small one is ours.
--
-- Supports everything JSON has: objects, arrays, strings (with escapes),
-- numbers, true, false and null (null becomes nil). It reads only; the
-- plugin never needs to write JSON. Plain Lua 5.1-5.4.
--
-- Usage:
--   local json = require("core/json")
--   local value, err = json.decode('{"high": 163, "low": 160}')
--   -- value.high == 163; on bad input value is nil and err says why

local M = {}

-- Characters that can appear between JSON values and are ignored.
local WHITESPACE = { [" "] = true, ["\t"] = true, ["\n"] = true, ["\r"] = true }

-- What a backslash escape inside a JSON string stands for.
local ESCAPES = { ['"'] = '"', ["\\"] = "\\", ["/"] = "/", b = "\b", f = "\f", n = "\n", r = "\r", t = "\t" }

-- Turns a Unicode code point (from a \uXXXX escape) into UTF-8 text.
local function utf8char(code)
  if code < 0x80 then return string.char(code) end
  if code < 0x800 then
    return string.char(0xC0 + math.floor(code / 0x40), 0x80 + code % 0x40)
  end
  return string.char(0xE0 + math.floor(code / 0x1000), 0x80 + math.floor(code / 0x40) % 0x40, 0x80 + code % 0x40)
end

-- The reader walks through the text one value at a time. `pos` is where it
-- is in the text; each read function returns the value and the position
-- just after it. Errors are raised with error() and caught in decode().
local readValue

local function skipWhitespace(text, pos)
  while WHITESPACE[text:sub(pos, pos)] do pos = pos + 1 end
  return pos
end

local function readString(text, pos)
  -- pos is at the opening quote
  local parts = {}
  local i = pos + 1
  while true do
    local c = text:sub(i, i)
    if c == "" then error("unfinished string") end
    if c == '"' then return table.concat(parts), i + 1 end
    if c == "\\" then
      local e = text:sub(i + 1, i + 1)
      if e == "u" then
        local code = tonumber(text:sub(i + 2, i + 5), 16)
        if not code then error("bad \\u escape") end
        parts[#parts + 1] = utf8char(code)
        i = i + 6
      elseif ESCAPES[e] then
        parts[#parts + 1] = ESCAPES[e]
        i = i + 2
      else
        error("bad escape \\" .. e)
      end
    else
      parts[#parts + 1] = c
      i = i + 1
    end
  end
end

local function readNumber(text, pos)
  local numText = text:match("^-?%d+%.?%d*[eE]?[-+]?%d*", pos)
  if not numText or numText == "" then error("bad number") end
  return tonumber(numText), pos + #numText
end

local function readArray(text, pos)
  local list = {}
  pos = skipWhitespace(text, pos + 1)
  if text:sub(pos, pos) == "]" then return list, pos + 1 end
  while true do
    local value
    value, pos = readValue(text, pos)
    list[#list + 1] = value
    pos = skipWhitespace(text, pos)
    local c = text:sub(pos, pos)
    if c == "]" then return list, pos + 1 end
    if c ~= "," then error("expected , or ] in array") end
    pos = pos + 1
  end
end

local function readObject(text, pos)
  local obj = {}
  pos = skipWhitespace(text, pos + 1)
  if text:sub(pos, pos) == "}" then return obj, pos + 1 end
  while true do
    pos = skipWhitespace(text, pos)
    if text:sub(pos, pos) ~= '"' then error("expected a key in quotes") end
    local key
    key, pos = readString(text, pos)
    pos = skipWhitespace(text, pos)
    if text:sub(pos, pos) ~= ":" then error("expected : after key") end
    local value
    value, pos = readValue(text, pos + 1)
    obj[key] = value
    pos = skipWhitespace(text, pos)
    local c = text:sub(pos, pos)
    if c == "}" then return obj, pos + 1 end
    if c ~= "," then error("expected , or } in object") end
    pos = pos + 1
  end
end

readValue = function(text, pos)
  pos = skipWhitespace(text, pos)
  local c = text:sub(pos, pos)
  if c == "{" then return readObject(text, pos) end
  if c == "[" then return readArray(text, pos) end
  if c == '"' then return readString(text, pos) end
  if c == "-" or c:match("%d") then return readNumber(text, pos) end
  if text:sub(pos, pos + 3) == "true" then return true, pos + 4 end
  if text:sub(pos, pos + 4) == "false" then return false, pos + 5 end
  if text:sub(pos, pos + 3) == "null" then return nil, pos + 4 end
  error("unexpected character '" .. c .. "'")
end

-- Decodes JSON text. Returns the value, or nil plus an error message
-- (never stops the plugin on bad input from the network).
function M.decode(text)
  if type(text) ~= "string" or text == "" then return nil, "no text" end
  local ok, value = pcall(function()
    local v, pos = readValue(text, 1)
    pos = skipWhitespace(text, pos)
    if pos <= #text then error("extra text after the value") end
    return v
  end)
  if not ok then
    -- Remove Lua's "file:line:" prefix so the message is readable.
    return nil, "JSON: " .. tostring(value):gsub("^.-:%d+: ", "")
  end
  return value
end

return M
