# GEnius — Grand Exchange Intelligence
### A RuneScape 3 market tracking desktop application

---

## What Is GEnius?

GEnius is a standalone Windows desktop app that pulls live Grand Exchange price data and turns it into an organised, signal-driven market tracker. It is built for players who flip items, supply raids, manage skilling stockpiles, or just want to know what the market is doing at a glance — without having to tab out to a spreadsheet or refresh a wiki page every five minutes.

It runs silently in the background. You click **Fetch Now**, it goes out and pulls fresh prices, appends untradeable item data, loads market indexes and game news, then presents everything in a categorised interface with sorting, filtering, watchlists, alerts, and signals.

---

## Current Features

### Live Price Data
- Pulls RS3 Grand Exchange prices from the WeirdGloop GazBot dump
- Tracks daily price change (%) for every item with historical data
- Volume tracking with exponential moving average for trend smoothing
- Alch profit calculation using live nature rune price

### Market Signals
Every item in the app is automatically tagged with one or more signals:

| Signal | Meaning |
|---|---|
| **SURGE** | Price rising 5%+ with elevated volume |
| **DUMP** | Price falling 5%+ with elevated volume |
| **ACCUMULATION** | Price flat, volume 1.3–2.5× average |
| **DISTRIBUTION** | Price flat, volume 2.5×+ average |
| **FRENZY** | Volume 2.5× average or more |
| **HIGH_VOL** | Volume 1.5–2.5× average |
| **ACTIVE** | Volume 1.1–1.5× average |
| **QUIET** | Volume below 0.9× average |
| **THIN** | Volume below 0.5× average |
| **ALCH** | High alchemy profit beats GE sell price after tax + nature rune cost |

### Dashboard
The first screen you see. Gives a full market overview at a glance:
- **Market Indexes** — the 6 RS Wiki Grand Exchange indexes (Common Trade, Rune, Log, Food, Metal, Herb), each showing current value and daily change
- **Market Pulse** — total items tracked, items with price data, rising vs. falling counts
- **Active Signals** — live counts of each signal type across all items
- **Top Gainers / Top Losers** — the 6 biggest movers by % change today
- **Volume Anomalies** — items currently showing FRENZY or HIGH_VOL

### Watchlist
Star any item from any tab to add it to your personal watchlist. Shows current price and daily change for everything you're tracking. Persists between sessions.

### Market Tab
A full cross-category market overview showing:
- Stat cards (rising items, falling items, items with volume anomalies, alch opportunities)
- Top 10 movers by absolute % change
- Top 10 volume leaders
- A sortable table of all items matching the current search/filter

### Opportunities Tab
Surfaces items showing unusual combinations of price movement and volume — items the signals engine has flagged as potentially interesting. Filterable by signal type.

### Portfolio
Track your GE positions — what you bought, at what price, and how much. Shows:
- All open positions with current market value
- Profit/loss per position and in total
- Tax statistics (GE tax paid and saved via the 1.2m threshold)
- Closed position history

### Alch Tab
Dedicated view for alchemy flipping. Shows all items where the alch value beats the GE sell price after 2% tax and nature rune cost. Sorted by profit per item.

### High Value Tab
Everything priced above a configurable threshold (default 500m). For tracking big-ticket items without wading through the full item list.

### Invention Tab
Full list of tradeable Invention supplies, plus a sub-tab for all **86 Invention components** scraped from the RS Wiki. Components show production cost and rarity tier (common / uncommon / rare / ancient). Untradeable items show a badge instead of price change data.

### Herblore Tab
Tradeable potions and supplies, plus a **Combination Potions** sub-tab with the 23 untradeable combination potions (Elder Overload Salve, Holy Aggroverload, etc.) scraped from the wiki with production costs.

### Combat Tabs
Separate tabs for **Melee**, **Magic**, **Ranged**, **Necromancy**, **Hybrid**, and **Ammo / Pocket slot** items. Boss-exclusive drops have their own Boss tab.

### Skill Tabs
Dedicated tabs for: Smithing, Crafting, Fletching, Food, Farming, Mining, Prayer, Archaeology, Runes, Summoning, and Construction.

### Other Category Tabs
- **Treasure Trails** — TT-exclusive rewards, with dual-listing: items that belong to a combat or skill category also appear there
- **Rares** — discontinued and extremely high-value cosmetics
- **Cosmetics / Titles** — override cosmetics, title unlocks, dyes, wearable cosmetics
- **Codex** — ability codices and ability-unlocking items
- **Low Tier** — bronze through dragon gear
- **Materials** — raw crafting and construction materials
- **Supplies** — consumables (restore, energy, misc)

### News Tab
Pulls the latest RuneScape patch notes and game news and displays them with article source, date, and item mention tags. Clicking a headline opens it in your browser. Also shows **App News** (GEnius update notes) above the RS feed.

### Alerts Tab
Set price alerts on any item — trigger when price goes above or below a threshold. Optionally connects to a Discord webhook to send notifications to a channel automatically. Alerts are saved and checked every time prices are fetched.

### Settings Tab
- Configurable expensive item threshold
- Discord webhook URL for alert notifications
- Hidden items manager — hide items you never want to see from any tab
- Theme and display options

### Search
A global search bar that works across all items regardless of which tab you're on. Clicking a result highlights it in the detail panel.

### Detail Panel
Clicking any item opens a side panel showing:
- Full item name
- Current high/low price
- Daily % change
- Volume and average volume
- Buy limit
- Alch value and alch profit
- Active market signals
- GE tax info
- For untradeable items: production cost, rarity, and UNTRADEABLE badge

---

## Planned Features (Future Updates)

### Right-Click Context Menu
Right-click any item row for quick actions — add to watchlist, copy price, open RS Wiki page, add to portfolio — without having to click into the detail panel first.

### Advanced Alerts
More alert conditions beyond price above/below:
- Volume spike alerts (when a specific item hits FRENZY or SURGE)
- Percentage change alerts ("notify me when X moves more than 10% in a day")
- Alch profit alerts ("notify me when X becomes profitable to alch")

### Opportunity Score
A single composite score (1–100) for each item combining price momentum, volume anomaly, alch profit margin, and buy limit. Replaces having to read multiple signals manually. Items ranked by score in the Opportunities tab.

### Item Comparison
Select two or more items and see them side by side — price, volume, change, alch profit, signals. Useful for comparing gear upgrade paths or competing skilling supplies.

### Wishlist
Separate from the Watchlist. Set a target buy price on an item and track how close the market is to your goal. Visual indicator showing how far away the current price is from your target.

### Portfolio Analytics Improvements
- Historical portfolio value chart (day-over-day)
- Profit/loss by category (how much did your boss loot flips make vs. your supplies?)
- Average hold time per position

### More Untradeable Items
Expanding the untradeable pipeline to include:
- Barbarian Assault reward items
- Dungeoneering rewards
- Loyalty shop cosmetics with meaningful GP values
- Minigame reward items

### Price History Charts
An in-app price chart for individual items using cached historical data. See 7-day and 30-day price trends without leaving the app.

### Category Tagging Improvements
Continued cleanup of the Misc / Materials / Low Tier tabs. Items that don't clearly belong to a single category are an ongoing project.

---

## Technical Notes

- Built with Electron (v28) + React (UMD, no build step for renderer) + embedded Python 3
- Price data: WeirdGloop GazBot RS3 dump (updated regularly)
- Untradeable item data: RS Wiki scraper with 24-hour cache
- Market indexes: RS Wiki Grand Exchange Market Watch page, 1-hour cache
- News: RS Wiki and official RuneScape news feeds
- All data cached locally — no account or login required
- Alerts optionally connect to Discord via webhook
- Portfolio and watchlist stored locally in Electron Store (no cloud sync)

---

*GEnius is an independent fan-made tool and is not affiliated with Jagex or RuneScape.*
