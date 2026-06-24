# GEnius — RuneScape 3 Grand Exchange Intelligence

A desktop market analysis tool for RuneScape 3. Track prices, spot opportunities, manage your portfolio, and get a feel for the market — all in one place.

Built with Electron. Windows only.

---

## Features

### Market Tracking
- Live GE prices pulled from the RS Wiki API, refreshed on a configurable interval
- Price change indicators across 7d, 30d, and 90d windows
- Volume tracking with unusual volume detection
- Filters for surging, dumping, and high-value items

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

### Opportunity Scoring
Items are ranked by an opportunity score (0–100) based on momentum, volume behaviour, active signals, and alch value. Expand any score in the Opportunities tab to see a full breakdown.

### Price Charts
- 7-day, 30-day, 90-day, and all-time views
- Seasonal chart showing average weekly price patterns across the year
- Zoom and scroll support
- Date lookup — enter a date to see what the price was
- All-time high/low markers

### Portfolio Tracker
- Log buy positions with quantity and price
- Track unrealised P&L in real time
- Record sells and track closed position history
- GE tax applied automatically
- Portfolio allocation breakdown

### Watchlist & Alerts
- Star any item to add it to your watchlist
- Set price threshold alerts with optional Discord webhook notifications

### Item Details
- Full stat panel from the RS Wiki (combat stats, requirements, examine text)
- Item image lightbox — click the icon to see the full detail image from the wiki
- Market personality blurb — flavour text based on the item's behaviour
- Price in Big Macs — live conversion based on Bond price and the Big Mac index
- Notes — attach personal notes to any item

### Dashboard
- Item of the Day — a different featured item every day, seeded by date
- Mood of the Market — live sentiment based on surge/dump/frenzy ratios across all items
- Top movers and unusual volume at a glance

### Search
- Fuzzy search across all 7,000+ tracked items
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

---

## Usage

On first launch, GEnius will fetch the current GE price data and begin populating historical price data in the background. This may take a few minutes. Subsequent launches load from the local cache and refresh on your chosen interval (default: every 15 minutes).

**Keyboard shortcuts**
- `S` or `/` — focus the search bar from anywhere
- `Esc` — close open modals (chart, image viewer)

---

## Troubleshooting

**Fetch Now fails, or your item count stays unusually low after install.**

This is almost always caused by **AVG Antivirus** flagging GEnius's bundled Python runtime as suspicious and quarantining or silently deleting it during install. This is a known false positive — bundled/embedded Python interpreters in general trip AVG's heuristics, not a sign that GEnius itself is unsafe.

To fix it:
1. Open AVG and check **Quarantine** / **Protection history** for anything related to GEnius or `python.exe`.
2. If found, **restore it**, then add the GEnius install folder to AVG's exceptions list (**Menu > Settings > Exceptions** in AVG).
3. If it's not in Quarantine either, AVG likely deleted the files outright before they could be quarantined — **reinstall GEnius** after adding the exception so the files aren't removed again.
4. In-app: open **Settings**, scroll to the **Troubleshooting** section, and click **Run check** — it tells you directly whether the embedded Python runtime is present.

If you're on a different antivirus and see similar symptoms, the same exceptions-list approach applies — just substitute your AV's equivalent setting.

---

## Stack

- [Electron](https://www.electronjs.org/) v28
- React (UMD, no build step for the renderer)
- [RS Wiki API](https://runescape.wiki/w/RuneScape_Wiki_API) for prices and item data
- Python (bundled) for signal processing and opportunity scoring
- [electron-store](https://github.com/sindresorhus/electron-store) for local persistence

---

## Disclaimer

GEnius is a third-party tool and is not affiliated with Jagex or RuneScape. Price data is sourced from the RS Wiki and may not reflect real-time GE prices exactly. Do your own research before making large trades.

---

## License

MIT
