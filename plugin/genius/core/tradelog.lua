-- GEnius trade log: works out what the player bought and sold on the
-- Grand Exchange by comparing their offer slots now with the last time the
-- plugin looked. Each time an offer's "done" count goes up, that difference
-- is a trade, and it is recorded with its price and (for sells) what it
-- paid out after the 2% GE tax.
--
-- Pure functions only: no game API, no network, no saved data. The plugin
-- reads the slots from the game, keeps the previous reading, and passes
-- both here as plain tables. Written in plain Lua 5.1-5.4.
--
-- A slot, as this file expects it (the plugin fills these in):
--   { kind = "buy" or "sell", item = item name, price = gp per item,
--     itemCount = total items in the offer, doneCount = items done so far,
--     goldSoFar = gold handled so far, if the game reports it (optional) }
-- An empty slot is nil.

-- Paths are relative to the plugin's root folder, without ".lua". The
-- plugin system's require returns nil (instead of erroring) if the file
-- is missing or fails to run, so stop here with a clear message.
local core = require("core/genius_core")
assert(core, "GEnius: could not load core/genius_core")

local M = {}

-- True when two readings of a slot are the same offer: same item, same
-- direction, same asking price and same size. If any of those differ, the
-- player has collected the old offer and placed a new one in that slot.
local function sameOffer(a, b)
  return a ~= nil and b ~= nil
    and a.kind == b.kind
    and a.item == b.item
    and a.price == b.price
    and a.itemCount == b.itemCount
end
M.sameOffer = sameOffer

-- Builds one log entry for `qty` items that traded in an offer.
-- `gold` is the real gold involved if the game told us; otherwise we use
-- the asking price (a sell can fill above it, so real gold is better).
-- The game's figure is BEFORE the 2% tax: checked in-game 2026-10-19, an
-- energy sale reported 140,393,856 and the GE screen said "received
-- 137,585,979" = 140,393,856 x 0.98. So the tax is worked out here.
local function makeTrade(offer, qty, gold, nowMs)
  local gross = gold or (offer.price * qty)
  local trade = {
    kind = offer.kind,
    item = offer.item,
    qty = qty,
    pricePer = gross / qty,      -- average price actually paid/received
    gross = gross,
    at = nowMs,
  }
  if offer.kind == "sell" then
    -- What the player actually pockets after the GE tax, using the same
    -- maths as the GEnius app.
    trade.net = core.saleNet(trade.pricePer, qty)
    trade.tax = gross - trade.net
  end
  return trade
end

-- Compares the previous and current slot readings and returns the list of
-- trades that happened in between, oldest slot first.
--
-- previous, current: tables indexed by slot number (1, 2, 3, ...)
-- slotCount: how many slots to look at
-- nowMs: the time to stamp on the trades
function M.findTrades(previous, current, slotCount, nowMs)
  local trades = {}
  for slot = 1, slotCount do
    local before = previous[slot]
    local now = current[slot]

    if now ~= nil then
      -- If it is the same offer as last time, only count what is new since
      -- then. A brand-new offer counts everything done so far.
      local doneBefore, goldBefore = 0, 0
      if sameOffer(before, now) then
        doneBefore = before.doneCount or 0
        goldBefore = before.goldSoFar or 0
      end

      local newQty = (now.doneCount or 0) - doneBefore
      if newQty > 0 then
        -- The game reports gold that is WAITING TO BE COLLECTED in the slot,
        -- not a running total. So only trust it for sells, and only if it
        -- went up: if the player collected some in between, it drops, and
        -- for buys it is leftover change rather than what was spent. In
        -- those cases fall back to the asking price.
        local newGold = nil
        if now.kind == "sell" and now.goldSoFar ~= nil and now.goldSoFar >= goldBefore then
          newGold = now.goldSoFar - goldBefore
          if newGold <= 0 then newGold = nil end
        end
        local trade = makeTrade(now, newQty, newGold, nowMs)
        trade.slot = slot
        trades[#trades + 1] = trade
      end
    end
  end
  return trades
end

-- Totals for a list of trades: what was spent buying, what selling paid
-- out after tax, and the tax paid. Useful for a "this session" summary.
function M.summarize(trades)
  local totals = { bought = 0, spent = 0, sold = 0, received = 0, tax = 0 }
  for _, t in ipairs(trades) do
    if t.kind == "buy" then
      totals.bought = totals.bought + t.qty
      totals.spent = totals.spent + t.gross
    else
      totals.sold = totals.sold + t.qty
      totals.received = totals.received + t.net
      totals.tax = totals.tax + t.tax
    end
  end
  return totals
end

return M
