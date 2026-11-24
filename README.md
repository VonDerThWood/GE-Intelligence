# GEnius — RuneScape 3 Grand Exchange Intelligence

A free, open-source market tool for RuneScape 3's Grand Exchange, on **Windows** and **Android**. Track prices, find flips and money makers, plan around Double XP, manage your portfolio, and get warned before Jagex moves your items.

No account, no server, no subscription. Everything runs on your own devices, and your data stays there.

---

## Get it

- **Windows:** download the latest `GEnius Setup x.x.x.exe` from the [Releases](../../releases) page and run it. Windows may show a SmartScreen warning (the app isn't code-signed): click "More info" → "Run anyway".
- **Android:** in closed testing on Google Play. Want in? Email **vonderthwood@gmail.com**.

First start takes about a minute: GEnius downloads the full price history in one file, then catches every item up to today in the background.

---

## Features

### On your phone and PC
- The same app and data on both. **Phone ↔ PC sync** over your home Wi-Fi: scan a QR code once, no accounts, nothing leaves your house. Google Drive sync on desktop.
- **Background alerts** on Android: price alerts, watchlist and portfolio digests, DXP news and reminders keep working with the app closed. **Live monitoring** checks every fetch interval.
- Built for phones: pull to refresh, full-width search, readable charts.

### Live prices
- Real instant-buy / instant-sell prices from the RuneScape Wiki, averaged over recent trades so one odd sale doesn't move the number.
- The full catalogue (7,000+ items) refreshes on an interval you choose (default 15 minutes).
- GEnius saves its own daily and hourly live-price archive, so history goes beyond the wiki's ~100-day window.

### Flips
Ranks the catalogue by real, repeatable margin after the 2% GE tax: **fill time** and **profit per 4 hours** from each side's recent trading, risk pills (Low / Medium / High), **↓ Still falling** tags, and checks that skip overpaying buyers, flukes and thin markets.

### Money Makers
Ten skills, all at live prices, alphabetical: **Archaeology** (collections, artefacts, disassembling materials for ancient components, including by auto disassembler), **Construction**, **Crafting**, **Divination**, **Farming** (herbs, flowers and allotments with the wiki's own yield formula: compost, tools, outfits, juju, Plant Power, Scroll of life, disease risk or protection), **Fletching**, **Herblore**, **Magic**, **Smithing** (every anvil product from scratch) and **Summoning**. Toggles for boosts like the Dungeoneering scrolls and Brooch of the Gods.

### GEnius Almanac
- **DXP plans** built from past Double XP events, tested against events they weren't built from, and **graded against real live trades** after each DXP. Plans that don't hold up are labelled, not recommended.
- **Seasonal** patterns for Christmas, Halloween, Summer and Easter, graded the same way ("Broke in 2026" when a pattern stops working).
- **Game Updates** and **Launches**: how past updates moved prices, and every new item from launch to today.

### Notifications
Inbox, **Upcoming Changes** (items you hold or watch that an announced update may affect), **Almanac** flags, and **My Alerts**: price, percent move, signal, "stops falling" and date reminders. Desktop and push notifications, optional Discord webhook. Items Jagex removes from the GE are labelled **Removed from GE** instead of showing frozen prices.

### Portfolio and Watchlist
- Positions with live P&L after tax, risk badges, break-even, "since bought" ranges, sortable columns, a **Buy Planner** for buying across several 4-hour limits and accounts, conversions (e.g. logs → planks) and **net worth over time**. Export to spreadsheets.
- Watchlist with sorting and a Cards or List view.
- The item panel tells you **what to offer** to buy or sell, and how far the price is from normal.

### Market research
- Market and category tabs with signals (SURGE, DUMP, ACCUMULATION, WIDE_SPREAD, ALCH, OVERPRICED and more), Opportunities with a score and a track record, Top Movers (GEnius's own and Jagex's official Top 100), and Compare.
- Price charts with chart analysis: support/resistance, the alch floor, where the price sits in its yearly range, and how its dips usually play out.
- **New drop source warnings** when a new boss starts dropping something you hold.
- Monster Lookup with drop tables and gp/kill; Alch and Invention calculators (Plank Maker, Hide Tanner, Partial Potion Producer, Alchemiser).

### Search and data
- Search as you type, community shorthands (`FSOA`, `EZK`, `AGS`...), your own shorthands, and `Ctrl+K` quick search on desktop.
- Daily automatic backups, backup import/restore, and spreadsheet export.

---

## Data sources

- **Prices and catalogue:** WeirdGloop's GE data dump and [exchange history API](https://api.weirdgloop.org/)
- **Live buy/sell prices:** the RuneScape Wiki's real-time [prices API](https://prices.runescape.wiki/rs)
- **Items, monsters, drop tables, recipes, yields:** the [RuneScape Wiki](https://runescape.wiki/)
- **News and Top 100:** official RuneScape news and the GE Top 100 pages

---

## Stack

- Desktop: [Electron](https://www.electronjs.org/) (Windows)
- Android: [Capacitor](https://capacitorjs.com/), same code, with a background runner for alerts
- Plain JavaScript, React via UMD (no build step for the UI), JSON-file storage on your device (no database, no account)

---

## Disclaimer

GEnius is a third-party tool and is not affiliated with Jagex or RuneScape. Prices come from public APIs and can lag or be wrong. Nothing in GEnius is financial advice: do your own research before big trades.

---

## License

MIT
