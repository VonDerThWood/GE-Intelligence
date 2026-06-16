# GEnius — RS3 Grand Exchange Market Intelligence
### Developer: WoodWorks (Ben) | GitHub: VonDerThWood/GE-Intelligence
### Google Play Developer Account: WoodWorks ($25 fee paid)

---

## FOR A FRESH CLAUDE INSTANCE — READ THIS FIRST

### Project overview
GEnius is a Windows desktop app (Electron) for tracking RS3 Grand Exchange prices.
It fetches live GE data and displays it in a categorized, filterable interface with
portfolio tracking, alch opportunities, price history charts, and market signals.

### Stack
- **Electron v26.6.10** — desktop shell
- **React (UMD inline)** — UI, no build step for renderer, uses `h()` not JSX
- **Python 3.13 (embedded)** — bundled in `python-embed/` folder, runs `run.py`
- **electron-builder** — packaging/installer
- **electron-store** — persistent settings/watchlist/hidden items
- **Local path:** `C:\Users\lette\GEnius\`
- **App data:** `C:\Users\lette\AppData\Roaming\GEnius\data\`

### CRITICAL quirks — things that will seem wrong but aren't

1. **`npm start` is BROKEN.** `isDev` detection doesn't work in dev mode. Ben's
   workflow is ALWAYS: edit → `npm run build` (as Administrator) → install exe → test.
   Never suggest `npm start`.

2. **Data source is WeirdGloop GazBot dump** — NOT the RS Wiki prices API.
   `https://chisel.weirdgloop.org/gazproj/gazbot/rs_dump.json`
   Returns dict format: `{"item_id": {"name","price","last","volume","highalch",
   "lowalch","limit","examine","members","id"}}`. Keys are item IDs as strings.
   The RS Wiki prices API (`prices.runescape.wiki/api/v1/rs/`) returns 404 for RS3
   — it is OSRS only. Do not suggest using it.

3. **Single price per item** — The GazBot dump gives one price used as both `high`
   and `low`. True buy/sell spread is not available from this source. Do not show
   separate buy/sell columns — they'd be identical. Use single "Price" column.

4. **`last` field in dump = previous daily GE price** — The GE updates prices once
   per day at daily reset. `last` is yesterday's price. `price - last` = daily change.
   When `last == price` (no change), fall back to `history.json` for price comparison.

5. **Python is embedded** — `python-embed/` folder in project root is bundled by
   electron-builder and gitignored. Contains Python 3.13 + requests + beautifulsoup4.
   `getPythonExecutable()` in main.js checks embedded first, then system Python.

6. **React uses `h()` not JSX** — The renderer uses `React.createElement` via `h()`.
   All components are written as `function Foo({props}) { return h('div', ...) }`.
   Do not convert to JSX syntax.

7. **GE tax rule** — 2% tax on items over 50gp. Items ≤50gp are tax-free.
   `applyTax(price)` helper in renderer.js handles this.

8. **History system** — `history.json` in AppData stores per-item 90-day price
   history fetched from WeirdGloop `/last90d` endpoint (requires item ID).
   This file is populated in the background by main.js at ~2.5 items/sec.
   `run.py` reads this file for volume averages AND previous-day prices for
   change_1d calculation. AppData survives reinstalls.

9. **Category system** — `catalogue.py` assigns categories via keyword rules.
   `category_overrides.json` provides manual per-item overrides (200+ entries).
   Priority order matters — overrides checked first, then keywords in order.

10. **Installer does NOT auto-close the app** — NSIS auto-close was attempted and
    abandoned due to macro conflicts. Users close the app manually before reinstalling.

### File structure
```
C:\Users\lette\GEnius\
├── src/
│   ├── main.js        ← Electron main process, IPC handlers, Python spawn
│   ├── preload.js     ← Exposes IPC to renderer via window.genius
│   └── renderer.js    ← Entire React UI (single file, ~2100 lines)
├── python/
│   ├── run.py         ← Price fetching, signal calculation, history reading
│   ├── catalogue.py   ← Category keyword rules
│   └── category_overrides.json  ← Manual item→category mappings
├── python-embed/      ← Bundled Python 3.13 (gitignored)
├── assets/icon.ico
├── package.json       ← version: "1.1.0"
└── FEATURES.md        ← This file
```

### IPC exposed via window.genius (preload.js)
getData, fetchNow, getDataDir, getItemStats, getItemHistory, getItemHistoryLocal,
getHistoryStatus, startHistoryPopulation, stopHistoryPopulation, getSettings,
saveSettings, getWatchlist, setWatchlist, getHidden, setHidden, getAlerts,
saveAlert, deleteAlert, getPortfolio, savePosition, deletePosition, sellPosition,
openExternal, showNotification, testNotification, onFetchComplete, onFetchError,
onHistoryProgress, removeAllListeners

### Data files in AppData
- `latest.json` — current price data for all 7,178 items (overwritten each fetch)
- `history.json` — per-item 90-day price history, keyed by item ID string
- `portfolio.json` — portfolio positions and tax stats
- `alerts.json` — price alerts

---

## Current Features (v1.1.0)

### Core data
- Live RS3 GE prices from WeirdGloop GazBot dump (~7,178 tradeable items)
- Fetches: name, price, last price, volume, highalch, lowalch, limit, examine, members, item ID
- Auto-fetch on configurable interval (5/10/15/30/60 min), default 15min
- Fetch Now button for manual refresh
- Price change tracking: dump's `last` field first, history.json fallback
- Rolling average volume from 90-day history (EMA fallback for items without history)
- SURGE/DUMP/MARGIN/HIGH_VOL/ALCH signals calculated in run.py
- All data stored locally, survives reinstalls

### Price history system
- WeirdGloop `/last90d` endpoint fetched per item (requires item ID)
- On first run: top 300 items by volume fetched immediately with progress popup
- Background continuation: remaining ~6,880 items fetched at ~2.5/sec silently
- Any clicked item fetches history immediately regardless of queue position
- Stored in history.json, loaded by run.py for avgVolume and change_1d
- Progress popup shows phases: initial 300 (gold) → background (blue) → complete (green)
- Dismissable but continues in background

### Item Panel (opens on item click)
- Item name, P2P badge for members items, category tags
- Current price, Daily Change % + raw gp, After 2% tax, High Alch, GE Limit, Volume
- **Price Trend Badges** — 7d/30d/90d compact badges showing % and gp change
  Calculated from history.json. Clicking opens chart modal at that range.
- Signal badges: SURGE, DUMP, MARGIN, HIGH_VOL, ALCH
- Examine text (from dump directly, no wiki call needed)
- Equipment Stats for gear: fetched from RS Wiki MediaWiki API on click, cached
  (Tier, Class, Slot, Damage, Accuracy, Style, Speed, Armour, LP, Prayer)
- Watch/Watching toggle button
- Hide button — removes item from all tabs, manageable in Settings
- 📖 RS Wiki button — opens browser via shell.openExternal
- Sparkline chart (click to expand full chart modal)

### Chart Modal
- Real 90-day price history from WeirdGloop (fetched on demand, cached)
- 7d/30d/90d toggle buttons, default 30d
- Price line chart with left-side Y-axis labels (min/25%/50%/75%/max gridlines)
- Volume bar chart below, aligned to same X-axis
- Hover tooltips on price points and volume bars showing exact values + date
- Stats row: period low/high, current price, daily change, volume
- Loading state: "Fetching price history..." while API call in progress
- Error state: "Historical data unavailable" if API fails

### Sidebar / Navigation
Fully categorized, drag-and-drop reorderable, persists between sessions.

**Watchlist ★** | **Combat:** Melee ⚔ Magic ✦ Ranged ◎ Necromancy ☠ Ammo ◈ Pocket ◇
**Skilling:** Herblore ⚗ Smithing ⚒ Crafting ◉ Fletching ↑ Food ◬ Farming ❧
Mining/WC ⛏ Prayer ✙ Archaeology ⌖ Runes ◈ Summoning ⟡
**Special:** Boss Drops ☠ Treasure Trails 🗺 Rares 💎 Ability Codex 📖 Overrides/Titles ✦
**Other:** High Value 💎 Materials ◆ Alch 🔥 Portfolio 📊 Market ◐ News ✦ Alerts ◉ Settings ⚙

### Category system
- 23 item categories assigned by keyword rules in catalogue.py
- 200+ manual overrides in category_overrides.json
- Priority order: rares → treasure_trails → boss → prayer → archaeology →
  overrides → codex → runes → summoning → melee → magic → ranged → necromancy →
  ammo → pocket → herblore → smithing → crafting → fletching → food → farming →
  mining → materials (catch-all)

### Price filter bar (auto-shows on tabs with 300+ items)
Quick filter: All / 1K+ / 10K+ / 100K+ / 1M+ / Custom
Custom field accepts K/M/B shorthand (500k, 2.5m, 1b)
Shows item count: "142 of 847 items"

### Item hiding
- Hide button in item panel removes item from all tabs globally
- Stored in electron-store as `hiddenItems` array
- Manage/unhide in Settings → Hidden Items section

### K/M/B price input
All price fields accept shorthand: 2m, 500k, 1.5b with live formatted preview

### Alch Tab 🔥
- Items where alching beats selling on GE (after tax)
- Nature rune cost factored in (live price)
- Alchemiser MK II column: alch - nature rune - (divine charge ÷ 500)
- After Tax comparison column
- Sortable by any column

### High Value Tab 💎
- Items at or above configurable threshold (default 500m)
- Threshold set in Settings

### Market Tab
- Overview cards: items tracked, rising, falling, signal count (clickable filters)
- Top Movers table — largest price swings, clickable rows open item panel
- Unusual Volume — items trading 30%+ above rolling average
- All rows clickable, opens item panel

### Alerts
- Per-item price alerts: above/below threshold
- Windows desktop notifications
- Discord webhook integration with test button

### Portfolio / Investment Tracker
- Open positions with cost basis, current value, P&L %, target/stop-loss
- Sell modal with full tax breakdown
- Portfolio allocation by item (% of total value)
- GE Tax tracking: today/week/month/lifetime
- Auto-creates GE alerts from targets/stop-losses

### Watchlist
- Star any item from any tab
- Watchlist tab shows all watched items

### Settings
- Discord webhook + test button
- Auto-fetch interval
- Expensive items threshold
- Theme (Dark/Black/Parchment)
- Sidebar order (drag-and-drop + reset)
- Desktop notifications toggle + test
- Hidden items manager

### Themes
Dark (default), Black, Parchment

### Change display
Every table shows: percentage change + raw gp change stacked, color coded green/red

---

## Planned / In-Progress Features

### Supply Cost Calculator ("Loadout" tab)
User builds a loadout of consumables (item + qty/hr). Shows total GP/hr cost at
live GE prices. Save/name multiple loadouts. Handles overload upgrade chains.

### Flip Calculator Tab
Enter buy price, qty, target sell price. Shows gross profit, GE tax, net profit,
ROI%. Accounts for buy/sell limits.

### Android App (Google Play — WoodWorks account registered)
- Hosted Python backend API on Railway (Flask/FastAPI wrapping run.py logic)
- Capacitor for Android UI wrapper
- Google AdMob banner ad (bottom, unobtrusive)
- Ko-fi donation link in app
- Both Windows and Android apps point to same backend

### Ko-fi donation link
Set up at ko-fi.com, to be added to app Settings and GitHub README.

### News Tab (live)
Currently shows "Coming Soon". Needs RS3 news/patch notes feed integration.

### Portfolio enhancements
- Daily portfolio value history chart
- Closed trade log / export to CSV
- Volume anomaly alerts for owned positions

### Price history trend display improvements
- 24h change badge in item panel (currently shows 7d/30d/90d only)

### Additional category fixes
- Construction tab (flatpacks, planks) — many flatpacks still miscategorized
- Invention tab (components, divine charges, perks)
- Materials tab still has many miscategorized items (user was going to screenshot)

### npm start fix
isDev detection broken — dev mode non-functional. Low priority since build/install
cycle works fine.

---

## Monetization plan (Android)
- Google AdMob banner ad — small, bottom of screen, non-intrusive
- Ko-fi donation link in app
- App is and will remain free

---

## Known issues / things to watch for
- The Materials tab is a catch-all and still large despite category fixes. Price
  filter bar helps but more overrides needed.
- change_1d shows "—" for items without history.json data yet (populates over time)
- History population continues in background across sessions — history.json grows
  until all ~7,180 items are covered

---
*GEnius is an unofficial fan tool, not affiliated with Jagex or RuneScape.*
*Data: WeirdGloop GazBot. Equipment stats: RS Wiki API.*
