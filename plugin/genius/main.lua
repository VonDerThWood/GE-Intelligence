-- GEnius GE Offers (version 0.5, development)
--
-- Shows a small panel listing the player's Grand Exchange offers: what each
-- slot is buying or selling, how much of it is done, for sells what the
-- finished part pays out after the 2% GE tax, and (with internet access)
-- how each active offer compares with live prices from the RuneScape Wiki.
-- It updates itself when any offer changes; Refresh also fetches fresh prices.

-- Our own modules. Paths are relative to the plugin folder, without ".lua".
-- require returns nil if loading fails, so stop with a clear message.
local core = require("core/genius_core")
assert(core, "GEnius: could not load core/genius_core")
local offers = require("core/offers")
assert(offers, "GEnius: could not load core/offers")
local json = require("core/json")
assert(json, "GEnius: could not load core/json")

-- Offer types and stages as numbers (from the GrandExchange API).
local OFFER_SELL = 1
local STAGE_EMPTY = 0
local STAGE_FINISHED = 5

-- GEnius colours as RuneScape text colour tags (<col=RRGGBB>...</col>).
-- Text has no colour property; the game's own text markup is used instead.
local GOLD = "c9a84c"
local GREEN = "4caf50"
local AMBER = "e0a030"
local DIM = "9c8b6e"
local function colour(hex, text) return "<col=" .. hex .. ">" .. text .. "</col>" end

-- Panel layout in pixels.
local PANEL_WIDTH = 440
local LINE_HEIGHT = 22
local LINES_PER_OFFER = 3

-- ─── Live prices ──────────────────────────────────────────────────────────

-- prices[itemId] = { instantBuy = gp, instantSell = gp }. Kept until the
-- player presses Refresh (plugins can't read Lua's clock, os.time, so
-- prices don't expire on a timer; Refresh is what asks for new ones).
-- pending[itemId] = true while a request for that item is on its way.
local prices = {}
local pending = {}

-- True if the player allowed internet access (it's optional in plugin.json).
local function canUseInternet()
  return Plugin.HasPermission(PluginPermissions.httpAccess)
end

-- Forward declaration: render() is defined further down, and the price
-- callback needs to call it when a price arrives.
local render

-- Asks the wiki for one item's latest instant-buy and instant-sell prices,
-- unless we already have one or a request is already waiting.
local function requestPrice(itemId)
  if prices[itemId] or pending[itemId] or not canUseInternet() then return end
  pending[itemId] = true

  -- Called by the game when the wiki answers (or the request fails).
  local function onResult(request)
    pending[itemId] = nil
    if not request.successful then
      -- Log everything the request reports, so the reason is visible.
      log("GEnius: price request failed for item " .. itemId
        .. " | url=" .. tostring(request.url)
        .. " | finished=" .. tostring(request.finished)
        .. " failed=" .. tostring(request.failed)
        .. " timedOut=" .. tostring(request.timedOut)
        .. " cancelled=" .. tostring(request.cancelled)
        .. " | response=" .. tostring(request.responseCode)
        .. " error=" .. tostring(request.errorCode)
        .. " info=" .. tostring(request.errorInfo)
        .. " | data=" .. string.sub(tostring(request.data), 1, 120))
      return
    end
    -- The reply looks like {"data":{"29324":{"high":166,"low":160,...}}}.
    -- "high" is what instant buyers paid, "low" what instant sellers took.
    local reply, err = json.decode(request.data)
    local entry = reply and reply.data and reply.data[tostring(itemId)]
    if not entry then
      log("GEnius: no price in the wiki reply for item " .. itemId .. (err and (" (" .. err .. ")") or ""))
      return
    end
    prices[itemId] = { instantBuy = entry.high, instantSell = entry.low }
    render()
  end

  local request = HTTPRequest.new(Plugin.urls.wikiPrices, "/api/v2/rs/latest?id=" .. itemId)
  -- The wiki's price API turns away (403) requests that don't say who is
  -- asking, so identify the plugin and where to find it, as they request.
  request:AddHeader("User-Agent", "GEnius-plugin/0.5 (github.com/VonDerThWood/GE-Intelligence)")
  request:Get(onResult)
end

-- ─── Turning offers into text ─────────────────────────────────────────────

-- The lines for one offer, for example:
--   "7. SELL Elder plank"
--   "    0/81,332 at 11,000"
--   "    Selling above buyers by 600.0K (+4.58%) - may sit"
local function describeOffer(slot, offer)
  local isSell = (offer.type == OFFER_SELL)
  local kind = isSell and colour(GREEN, "SELL") or colour(AMBER, "BUY")
  local name = offer.item and offer.item.name or "?"
  local lines = { slot .. ". " .. kind .. " " .. name }

  local detail = "    " .. core.commas(offer.soldCount) .. "/" .. core.commas(offer.itemCount)
    .. " at " .. core.commas(offer.price)
  if offer.stage == STAGE_FINISHED then
    detail = detail .. " - " .. colour(GREEN, "DONE")
  end
  -- For sells with gold waiting, show what the player actually receives.
  -- The game's figure is before tax, so take the 2% off ourselves.
  if isSell and (offer.goldFromSale or 0) > 0 and offer.soldCount > 0 then
    local received = core.saleNet(offer.goldFromSale / offer.soldCount, offer.soldCount)
    detail = detail .. " - " .. colour(GOLD, core.gp(received)) .. " after tax"
  end
  lines[2] = detail

  -- Market comparison, only for offers still waiting to fill.
  if offer.stage ~= STAGE_FINISHED and offer.item then
    local price = prices[offer.item.id]
    if price then
      local asOffer = { kind = isSell and "sell" or "buy", price = offer.price,
                        itemCount = offer.itemCount, doneCount = offer.soldCount }
      local result = offers.compareOffer(asOffer, price)
      local text = offers.describe(asOffer, result)
      local hue = (result.outlook == "likely") and GREEN or (result.outlook == "slow") and AMBER or DIM
      lines[3] = "    " .. colour(hue, text)
    elseif canUseInternet() then
      lines[3] = "    " .. colour(DIM, "Checking live price...")
      requestPrice(offer.item.id)
    else
      -- Say why there's no comparison instead of silently leaving it out.
      lines[3] = "    " .. colour(DIM, "Live prices off (internet access not allowed)")
    end
  end
  return lines
end

-- ─── The window (built with the PrettyUI library) ─────────────────────────

-- PrettyUI is a required dependency (plugin.json), so the game loads it
-- first and hands it to us as the global `prettyui`.

-- The window's parts, kept so render() can update them in place. Each GE
-- slot gets one fixed row: an item icon with the offer's text beside it.
local view = { window = nil, rows = {}, key = nil }

-- Which slots were already finished last time we looked, so the
-- "offer complete" popup only shows once per offer.
local wasFinished = {}

-- Shows the collection-log style popup when an offer finishes.
local function announceFinished(offer)
  local isSell = (offer.type == OFFER_SELL)
  prettyui.AchievementPopup.show({
    title = isSell and "SOLD!" or "BOUGHT!",
    text = core.commas(offer.itemCount) .. " x " .. (offer.item and offer.item.name or "?")
      .. (isSell and " sold" or " bought") .. " on the Grand Exchange.",
    item = offer.item,
    quantity = offer.itemCount,
  })
end

-- Builds the window: centred on the game area, draggable by its title,
-- with a Refresh button and one row (icon + text) per slot in `slots`.
-- PrettyUI rows can't be hidden, so the window is rebuilt (see render)
-- whenever the set of slots in use changes.
local function buildWindow(slots)
  local gameArea = ui.Interfaces:GetComponent(id.Component.TOPLEVEL_V2__GAME_AREA)
  local window = prettyui.Window.new(gameArea, {
    title = "GEnius - GE offers",
    x = -PANEL_WIDTH / 2, y = -200,
    xAnchor = 0.5, yAnchor = 0.5,
    width = PANEL_WIDTH, height = 400,
    resizable = true,
    rowBackgroundColours = { 0x24211EFF, 0x2E2825FF },
  })

  -- Refresh forgets the stored prices, so fresh ones are fetched.
  window:AddSimpleButton("Refresh prices", function()
    prices = {}
    render()
  end)
  if #slots == 0 then
    window:AddText("No offers on the Grand Exchange right now.")
  end

  view.rows = {}
  for _, slot in ipairs(slots) do
    local icon = window:AddItemSlot(nil)
    local text = window:AddText({ text = "", inline = true, width = PANEL_WIDTH - 90,
                                  height = LINE_HEIGHT * LINES_PER_OFFER })
    view.rows[slot] = { icon = icon, text = text }
  end
  window:RefreshRowBackgrounds()
  view.window = window
end

-- Reads every slot, rebuilds the window if offers were placed or
-- collected, then fills each row with the offer's icon and text.
render = function()
  local slots = {}
  for slot = 1, GrandExchange.MaxOffers() do
    local offer = GrandExchange.GetOffer(slot)
    if offer ~= nil and offer.stage ~= STAGE_EMPTY then
      slots[#slots + 1] = slot
    else
      wasFinished[slot] = nil
    end
  end

  -- e.g. "7,8": only rebuild when this changes.
  local key = table.concat(slots, ",")
  if key ~= view.key then
    if view.window then view.window:Destroy() end
    buildWindow(slots)
    view.key = key
  end

  for _, slot in ipairs(slots) do
    local offer = GrandExchange.GetOffer(slot)
    local row = view.rows[slot]
    row.icon:SetObject(offer.item, offer.itemCount)
    row.text.content = table.concat(describeOffer(slot, offer), "<br>")
    local finished = (offer.stage == STAGE_FINISHED)
    if finished and wasFinished[slot] == false then announceFinished(offer) end
    wasFinished[slot] = finished
  end
end

log("GEnius: internet access allowed = " .. tostring(canUseInternet()))
render()

-- Update the window by itself whenever the server reports a change to any
-- GE offer (something bought or sold, an offer placed or collected), so
-- the Refresh button is only needed for fresh market prices.
Event.GrandExchangeOfferUpdated.Subscribe("genius-offer-updated", function(event)
  render()
end)

-- Clean up when the plugin is turned off or reloaded.
function PluginShutdown()
  Event.GrandExchangeOfferUpdated.Unsubscribe("genius-offer-updated")
  if view.window then view.window:Destroy() end
end
