-- GEnius core — the app's market math, ported to Lua for the planned RS3
-- plugin (Jagex's official Lua plugin API; public dev access due late
-- October 2026). Pure functions only: no game API, no I/O, no network, so
-- it runs anywhere and is tested against the JavaScript originals
-- (plugin/test/test_core.js) to give byte-identical results.
--
-- Written in the portable subset of Lua 5.1-5.4 (no `//`, no bit operators,
-- no `goto`, no utf8 library) because the plugin API's Lua version isn't
-- known yet.
--
-- Mirrors, in src/renderer.js and src/backend-js/api.js:
--   applyTax, saleNet, fmt.gp, fmt.pct, breakEvenPrice, Portfolio P/L,
--   plannerPace, plannerFinish, the Buy Planner estimates.

local M = {}

local DAY_MS = 86400000

-- All money maths runs in floats. Lua 5.3+ keeps integer*integer as an
-- integer, and some Lua builds (fengari, used for the tests; possibly a
-- game client's embedded Lua) have 32-bit integers that silently wrap past
-- ~2.1 billion — and GEnius deals in billions. Doubles are exact for whole
-- numbers up to 2^53 (~9 quadrillion), on every Lua version.
local function f(x) return x + 0.0 end

-- JavaScript's Math.round: halves round toward +infinity (-2.5 -> -2).
local function jsRound(x)
  return math.floor(x + 0.5)
end
M.jsRound = jsRound

-- ─── GE tax ──────────────────────────────────────────────────────────────
-- 2% on items selling for 50gp or more; 1-49gp is untaxed. RS3 has no cap
-- (the 5M/item cap is Old School only).

-- Net per-item proceeds after tax (renderer.js applyTax).
function M.applyTax(price)
  price = f(price)
  if price < 50 then return price end
  return math.floor(price * 0.98)
end

-- Net proceeds of a whole sale, price x qty (api.js / renderer.js saleNet).
function M.saleNet(price, qty)
  price, qty = f(price), f(qty)
  if price >= 50 then return jsRound(price * qty * 0.98) end
  return price * qty
end

-- Tax paid on a whole sale.
function M.saleTax(price, qty)
  price, qty = f(price), f(qty)
  return price * qty - M.saleNet(price, qty)
end

-- Lowest per-item sell price that breaks even after tax (Portfolio
-- "Break-even" column).
function M.breakEvenPrice(cost)
  cost = f(cost)
  local untaxed = math.ceil(cost)
  if untaxed < 50 then return untaxed end
  return math.ceil(cost / 0.98)
end

-- ─── Positions ───────────────────────────────────────────────────────────
-- Portfolio maths for one open position (renderer.js PortfolioTab
-- `enriched`): value, cost, P/L before and after tax, P/L %.
function M.positionPL(costBasis, qty, currentPrice)
  costBasis, qty, currentPrice = f(costBasis), f(qty), f(currentPrice)
  local value = currentPrice * qty
  local cost = costBasis * qty
  local grossPL = value - cost
  local tax = value - M.saleNet(currentPrice, qty)
  local netPL = grossPL - tax
  local plPct = 0
  if cost > 0 then plPct = grossPL / cost * 100 end
  return { value = value, cost = cost, grossPL = grossPL, tax = tax, netPL = netPL, plPct = plPct }
end

-- Average cost from running totals (Buy Planner).
function M.averageCost(totalSpent, totalBought)
  if not totalBought or totalBought <= 0 then return nil end
  return totalSpent / totalBought
end

-- ─── Formatting ──────────────────────────────────────────────────────────
-- Thousands separators, matching toLocaleString() for whole numbers.
local function commas(n)
  local neg = n < 0
  -- %.0f, not %d: %d needs an integer and overflows on 32-bit builds.
  local s = string.format('%.0f', math.floor(math.abs(n) + 0.5))
  local out = s:reverse():gsub('(%d%d%d)', '%1,'):reverse()
  if out:sub(1, 1) == ',' then out = out:sub(2) end
  return (neg and '-' or '') .. out
end
M.commas = commas

-- renderer.js fmt.gp: 1.23B / 4.56M / 7.8K / plain.
function M.gp(n)
  if n == nil then return '—' end
  n = f(n)
  local a = math.abs(n)
  if a >= 1e9 then return string.format('%.2fB', n / 1e9) end
  if a >= 1e6 then return string.format('%.2fM', n / 1e6) end
  if a >= 1e3 then return string.format('%.1fK', n / 1e3) end
  if n == math.floor(n) then return commas(n) end
  -- toLocaleString keeps up to 3 decimals, trailing zeros dropped
  local s = string.format('%.3f', n):gsub('0+$', ''):gsub('%.$', '')
  return s
end

-- renderer.js fmt.pct: +1.23% / -4.56%.
function M.pct(n)
  n = f(n)
  return (n >= 0 and '+' or '') .. string.format('%.2f', n) .. '%'
end

-- ─── Buy Planner ─────────────────────────────────────────────────────────
-- history: array of { t = ms, bought = n } snapshots, oldest first.
-- Needs two updates 12h+ apart, or the rate is just noise.
function M.plannerPace(history)
  if not history or #history < 2 then return nil end
  local first, last = history[1], history[#history]
  local days = (f(last.t) - f(first.t)) / DAY_MS
  if days < 0.5 then return nil end
  local perDay = (last.bought - first.bought) / days
  if perDay > 0 then return { perDay = perDay, updates = #history } end
  return nil
end

-- Days (rounded up) to buy `left` at `perDay`, and the finish time in ms.
function M.plannerFinish(left, perDay, nowMs)
  if not perDay or perDay <= 0 then return nil end
  left, perDay, nowMs = f(left), f(perDay), f(nowMs)
  local days = math.ceil(left / perDay)
  return { days = days, date = nowMs + days * DAY_MS }
end

local LIMITS_PER_DAY = 6 -- a full 4-hour limit, around the clock
M.LIMITS_PER_DAY = LIMITS_PER_DAY

-- All three finish estimates and the bottleneck (the slowest one).
--   goal  = { target, bought, marketShare (percent, default 25), history }
--   item  = { limit, dailyVolume }
function M.plannerEstimates(goal, item, nowMs)
  local left = math.max(0, (goal.target or 0) - (goal.bought or 0))
  local limit = item.limit
  local share = (goal.marketShare or 25) / 100
  local best = limit and M.plannerFinish(left, limit * LIMITS_PER_DAY, nowMs) or nil
  local marketPerDay = nil
  if item.dailyVolume and item.dailyVolume > 0 then
    marketPerDay = item.dailyVolume * share
    if limit then marketPerDay = math.min(marketPerDay, limit * LIMITS_PER_DAY) end
  end
  local market = marketPerDay and M.plannerFinish(left, marketPerDay, nowMs) or nil
  local pace = M.plannerPace(goal.history)
  local yours = pace and M.plannerFinish(left, pace.perDay, nowMs) or nil
  -- The bottleneck is the slowest estimate, if it's slower than another.
  local slowestKey, slowest, fastest = nil, nil, nil
  for _, pair in ipairs({ { 'best', best }, { 'market', market }, { 'pace', yours } }) do
    local e = pair[2]
    if e then
      if not slowest or e.days > slowest.days then slowestKey, slowest = pair[1], e end
      if not fastest or e.days < fastest.days then fastest = e end
    end
  end
  local bottleneck = nil
  if slowest and fastest and fastest.days < slowest.days then bottleneck = slowestKey end
  return { left = left, best = best, market = market, marketPerDay = marketPerDay,
           pace = pace, yours = yours, bottleneck = bottleneck }
end

return M
