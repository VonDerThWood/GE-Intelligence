# GEnius — RuneScape 3 Grand Exchange Intelligence

A desktop market intelligence tool for RuneScape 3's Grand Exchange. Track prices, spot opportunities, manage your portfolio, and get a feel for the market — all in one place.

Built with Electron. Windows only. No account, no server, no subscription — everything runs and stays on your machine.

---

## Features

### Live Market Tracking
- Real-time instant-buy/instant-sell prices with per-price "X minutes ago" freshness, sourced from the wiki's real-time RS3 prices API
- The rest of the catalogue (7,000+ items) refreshes on a configurable interval (default: every 15 minutes)
- Price change indicators across 7d, 30d, and 90d windows
- Volume tracking with unusual volume detection

### Signals
Automatic flags applied to items based on market behaviour:

| Signal | Meaning |
|--------|---------|
| `SURGE` | Price up 5%+ with above-average volume |
| `DUMP` | Price down 5%+ with above-average volume |
| `FRENZY` | Extreme price movement, very high volume |
| `THIN` | Volume 50%+ below average — illiquid market |
| `ALCH` | High alchemy profit after GE tax + nature rune cost |
| `MANIPULATED` | Extreme volume spike on a low buy-limit item with a large price move |
| `OVERPRICED` | Listed GE price is 20%+ higher than real live buy/sell — the displayed price may be stale or fake |
| `UNDERPRICED` | Real live buy/sell is 20%+ higher than the listed GE price |

### Opportunity Scoring
Items are ranked by an opportunity score (0–100) based on momentum, volume behaviour, active signals, and alch value. Expand any score in the Opportunities tab to see a full breakdown.

### Monster Lookup
- Search any monster for its drop table and an estimated gp/kill, straight from the wiki
- Combat stats (level, HP, weakness, poison/stun/deflect/drain susceptibility), correctly split for bosses with a Normal/Hard Mode toggle, and for duo/trio encounters (e.g. Vindicta & Gorvek) where the wiki keeps each half's stats on its own page
- Flags any drop whose rarity the wiki itself lists as "Unknown" rather than silently omitting it from the gp/kill estimate
- Sort the drop table by Rarity or GE Price; click any item to open it in the item lookup panel
- Live search suggestions as you type, plus custom search shorthands

### Price Charts
- 7-day, 30-day, 90-day, and all-time views
- Seasonal chart showing average weekly price patterns across the year
- Support/resistance detection
- Zoom and scroll support
- Date lookup — enter a date to see what the price was
- All-time high/low markers with dates

### Portfolio Tracker
- Log buy positions with quantity and price
- Track unrealised P&L in real time
- Record sells and track closed position history
- GE tax applied automatically
- Portfolio allocation breakdown

### Watchlist & Alerts
- Star any item to add it to your watchlist
- Set alerts on a price threshold, a percent change, or a specific market signal
- Optional Discord webhook notifications

### Item Details
- Full stat panel from the RS Wiki (combat stats, requirements, examine text)
- Item image lightbox — click the icon to see the full detail image from the wiki
- Market personality blurb — flavour text based on the item's behaviour
- Price in Big Macs — live conversion based on Bond price and the Big Mac index
- Notes — attach personal notes to any item

### Dashboard
- Item of the Day — a different featured item every day, seeded by date
- Mood of the Market — live sentiment based on surge/dump/frenzy ratios across all items
- Sector heat map, top movers, and unusual volume at a glance

### Invention
- Components and untradeable-item prices
- Machine profit calculators — Plank Maker, Hide Tanner, Partial Potion Producer — with live prices, real charge costs, profit/item, ROI%, and hourly/daily projections

### Search
- Instant search-as-you-type across all 7,000+ tracked items
- Built-in shorthand lookup — type `FSOA`, `EZK`, `AGS`, `EOF`, and 40+ other community abbreviations
- Custom shorthands — define your own in Settings
- 🎲 Random item button — rolls a tradeable item with meaningful price or volume

### Data
- Export your watchlist, portfolio, alerts, notes, and settings to a backup file
- Import on any machine to restore everything
- Category overrides — reassign items to different market categories

---

## Installation

Download the latest `GEnius Setup x.x.x.exe` from the [Releases](../../releases) page and run it. No prerequisites required.

Windows may show a SmartScreen warning since the app isn't code-signed — click "More info" → "Run anyway."

---

## Usage

On first launch, GEnius fetches current prices and starts building historical price data in the background — this can take 10+ minutes for the full catalogue, but the app is usable while it finishes. Subsequent launches load from the local cache and refresh on your chosen interval (default: every 15 minutes).

**Keyboard shortcuts**
- `S` or `/` — focus the search bar from anywhere
- `Esc` — close open modals (chart, image viewer)

---

## Data sources

- **Main catalogue & prices** — a WeirdGloop-maintained GE data dump, refreshed on a scheduled interval
- **Live instant-buy/instant-sell prices** — the RuneScape Wiki's real-time [prices API](https://prices.runescape.wiki/rs)
- **Item/monster stats, drop tables, examine text** — the [RuneScape Wiki API](https://runescape.wiki/w/RuneScape_Wiki_API)
- **Historical price data** — [WeirdGloop's exchange history API](https://api.weirdgloop.org/)

---

## Stack

- [Electron](https://www.electronjs.org/) v28
- React (UMD, no build step for the renderer)
- A custom JSON-file-based local store for settings/portfolio/history persistence (no external database, no account)

---

## Disclaimer

GEnius is a third-party tool and is not affiliated with Jagex or RuneScape. Price data is sourced from public wiki APIs and may not reflect real-time GE prices exactly. Do your own research before making large trades.

---

## License

MIT
