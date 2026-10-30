-- GEnius offers: compares one of the player's Grand Exchange offers with
-- the live market, so they can see at a glance whether it is likely to
-- fill, how far it is from what other players are paying, and what a sell
-- will actually pay out after the 2% GE tax.
--
-- Pure functions only: no game API, no network, no saved data. The plugin
-- reads the player's offers from the game and the live prices from the
-- RuneScape Wiki elsewhere, then hands plain numbers to these functions.
-- That keeps this file easy to test and easy for a moderator to review.
--
-- Prices used here (from the RuneScape Wiki's live prices):
--   instantBuy  - what the most recent instant BUYER paid. Buyers pay this,
--                 so it is roughly the best price a seller can expect fast.
--   instantSell - what the most recent instant SELLER accepted. Sellers
--                 take this, so it is roughly the cheapest a buyer can get.
--
-- Written in plain Lua 5.1-5.4 (see genius_core.lua for why).

-- Paths are relative to the plugin's root folder, without ".lua". The
-- plugin system's require returns nil (instead of erroring) if the file
-- is missing or fails to run, so stop here with a clear message.
local core = require("core/genius_core")
assert(core, "GEnius: could not load core/genius_core")

local M = {}

-- How close (as a fraction of the price) counts as "at the market" rather
-- than above or below it. 1% (Ben, 2026-10-19: small gaps are normal GE noise) stops tiny
-- differences, like 1gp on a
-- 1,000gp item, from being shown as a mismatch. Maybe a setting later.
local AT_MARKET_TOLERANCE = 0.01
M.AT_MARKET_TOLERANCE = AT_MARKET_TOLERANCE

-- Returns how a sell offer's price compares with what buyers are paying.
--   "likely"   - your price is at or below what buyers just paid: it should
--                sell soon.
--   "slow"     - a little above what buyers are paying (within tolerance
--                counts as "likely"; above that, it may sit for a while).
--   "unknown"  - no live price for this item right now (rarely traded, or
--                the wiki could not be reached). We say nothing rather than
--                guess.
local function sellOutlook(offerPrice, instantBuy)
  if instantBuy == nil or instantBuy <= 0 then
    return "unknown"
  end
  if offerPrice <= instantBuy * (1 + AT_MARKET_TOLERANCE) then
    return "likely"
  end
  return "slow"
end

-- The same idea for a buy offer, against what sellers are accepting.
--   "likely" - you are offering at least what sellers just took.
--   "slow"   - you are offering less, so you may wait for a seller.
local function buyOutlook(offerPrice, instantSell)
  if instantSell == nil or instantSell <= 0 then
    return "unknown"
  end
  if offerPrice >= instantSell * (1 - AT_MARKET_TOLERANCE) then
    return "likely"
  end
  return "slow"
end

-- Compares one offer with the live market.
--
-- offer:  { kind = "buy" or "sell", price = gp per item,
--           itemCount = total items in the offer, doneCount = items done }
-- market: { instantBuy = gp or nil, instantSell = gp or nil }
--
-- Returns a table:
--   outlook    - "likely", "slow" or "unknown" (see above)
--   marketPrice- the live price this offer is compared against, or nil
--   gapGp      - your price minus the market price (positive means above it)
--   gapPct     - the same gap as a percent of the market price
--   remaining  - items still waiting to buy or sell
--   netForRest - sells only: what the remaining items pay out after tax
--                (at your price), or nil for buys
function M.compareOffer(offer, market)
  local price = offer.price or 0
  local remaining = math.max(0, (offer.itemCount or 0) - (offer.doneCount or 0))

  -- A sell is judged against buyers (instantBuy); a buy against sellers
  -- (instantSell). That is the side of the market that would fill it.
  local marketPrice, outlook
  if offer.kind == "sell" then
    marketPrice = market.instantBuy
    outlook = sellOutlook(price, marketPrice)
  else
    marketPrice = market.instantSell
    outlook = buyOutlook(price, marketPrice)
  end

  local result = {
    outlook = outlook,
    marketPrice = marketPrice,
    remaining = remaining,
  }

  -- Only work out a gap when there is a real market price to compare to.
  if marketPrice ~= nil and marketPrice > 0 then
    result.gapGp = price - marketPrice
    result.gapPct = (price - marketPrice) / marketPrice * 100
  end

  -- What the rest of a sell offer pays out, after the GE's 2% tax. Uses
  -- the same tax maths as the GEnius app (genius_core.saleNet).
  if offer.kind == "sell" then
    result.netForRest = core.saleNet(price, remaining)
  end

  return result
end

-- A one-line, plain-English summary for showing next to an offer, e.g.
--   "Selling above buyers by 600K (+4.80%) - may sit"
--   "At the market - should fill soon"
--   "No live price right now"
function M.describe(offer, comparison)
  if comparison.outlook == "unknown" then
    return "No live price right now"
  end
  local gap = comparison.gapGp or 0
  local nearlyEqual = math.abs(comparison.gapPct or 0) <= AT_MARKET_TOLERANCE * 100
  if nearlyEqual then
    return "At the market - should fill soon"
  end

  local who = offer.kind == "sell" and "buyers" or "sellers"
  local side = gap > 0 and "above" or "below"
  local amount = core.gp(math.abs(gap)) .. " (" .. core.pct(comparison.gapPct) .. ")"
  local verb = offer.kind == "sell" and "Selling" or "Buying"
  local tail = comparison.outlook == "likely" and "should fill soon" or "may sit"
  return verb .. " " .. side .. " " .. who .. " by " .. amount .. " - " .. tail
end

return M
