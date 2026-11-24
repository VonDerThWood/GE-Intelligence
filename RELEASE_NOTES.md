## GEnius v3.0.0

**GEnius goes mobile, Money Makers learns to farm, and Jagex took our portables.**

This is the big one.

GEnius is officially an Android app, currently in closed testing on Google Play. Desktop gets a whole pile of new tools, the app has been brought up to speed with the Late-Game Rebalance, and we've made some pretty substantial improvements under the hood. If you want to get in on the closed testing beta, please contact me at **vonderthwood@gmail.com**. I'm in need of testers!

There's a lot here. Let's get into it.

### GEnius in your pocket
GEnius now runs on Android, with the same features and data you've got on desktop. And yes, it can keep doing things when you aren't actively staring at it.

- **Background alerts.** Price alerts, watchlist and portfolio digests, DXP news, and reminders keep working with the app closed. Enable **Live monitoring** (Settings → Background checking) to check at every fetch interval, rather than letting Android decide when it feels like doing something.
- **Phone ↔ PC sync.** Scan a QR code on your PC once, and your devices keep each other up to date over your home Wi-Fi. No accounts. No GEnius servers. Your data stays in your house.
- **Actually built for a phone.** Pull down to refresh, bigger chart numbers, full-width search results, quantities in your Portfolio, and a proper full-screen layout without the status bar getting in the way. Notifications are now called Push Notifications. Because that's what they are.
- **Bring your desktop data along.** Settings → Import Backup lets you bring your positions, alerts, and watchlists over from a desktop backup. Just in case you don't want to scan a QR code. But beware: they will not sync like this.

### The Almanac, put to the test
We've been saying the DXP Almanac is built on historical data. Now we've put its predictions up against the November Double XP event using actual live trades, not guide prices. Turns out, patience makes a pretty big difference.

- **Graded at live prices.** Every recommended DXP plan was checked against what actually traded during the event, with the 2% GE tax included. Using patient offers, 29 of 33 plans made money, averaging +12.6%. Buying and selling instantly at the going price? Just 16 of 33 made money, with an average return of -0.2%. The takeaway: these plans reward patience. Paying the spread can eat the profit entirely.
- **Sell-first plans came out ahead.** Plans that started by selling performed better than those that started by buying.
- **Seasonal predictions got a reality check.** Halloween 2026 was graded against the Seasonal tab's predictions. 12 of 20 calls held up. The 7 that didn't are now labelled **Broke in 2026**, rated Speculative, and include an explanation of what actually happened. Pumpkin crash estimates were also corrected to match reality: approximately -50%.
- **Two DXPs a year.** The next-DXP estimate now assumes a six-month gap, reflecting Jagex's new schedule instead of the old three-month assumption.

*The Almanac makes predictions. Now it has receipts to back those predictions up.*

### First start in about a minute (down from 45)
New installs no longer have to download roughly 7,400 items of price history. Even though it was roughly 2.5 items/second, it still took a ridiculous amount of time. Desktop and Android now grab the history in a single file, built from my personal history that has been building up for months, then catch everything up to today in the background. And that history? It's compressed now. The old 1.5GB collection takes up about 76MB. GEnius is helping you profit both in-game and storage capacity wise.

### Late-Game Rebalance: GEnius caught up
The Late-Game Rebalance changed a lot of item availability and production math. GEnius has been updated to match.

- **Alchemiser math updated.** A divine charge now covers 375 alchs instead of 500 (8 charges per item on the Mk. II). The Alch tab also reflects the new one-machine, 15-per-hour limit.
- **Removed from GE.** Portables, Silverhawk feathers, Slayer wildcards, and several other MTX items are now labelled **Removed from GE** in your Watchlist, Portfolio, and Alerts. No more pretending a frozen price is a useful market signal.
- **Springs.** The Make It Yourself calculator now uses the new recipe: 60 tensile + 1 subtle = 50 springs.
- **Portables are gone.** Their related toggles have gone with them. The Brooch of the Gods' new +5% Dungeoneering scroll chance is included instead. More on that below.

### Money Makers
Money Makers has been getting quite the workout. There's a new skill, more ways to calculate existing methods, and a few corrections that were long overdue.

- **Farming (new).** Herbs, flowers, and allotments, all priced using live market prices and the RuneScape Wiki's own yield formula. Account for compost, secateurs, ring of whispers, amulet of nature, farmer outfits, juju, Bountiful Harvest 2, Plant Power (up to 10 herb seeds), Scroll of life, Starbloom (Battlestaff included), and more. You can choose to pay a gardener or take your chances with disease.
  *At 99 Farming, almost every herb gives you the same yield. It's seed price versus herb price. That's the whole game.*
- **Dungeoneering scrolls.** Calculate Dexterity (dragonhide), Efficiency (smithing), Restoration (archaeology), and Cleansing (herblore), with individual toggles for the new +5% Brooch of the Gods effect.
- **Archaeology.** Collections, individual artefacts, and material disassembly for ancient components. There's also a **By auto disassembler** column that accounts for the machine charge.
- **Smithing from scratch.** Every anvil product can now be calculated per bar, including upgrades priced from the ground up.
- **Profit per limit fixed.** This one was embarrassing. The calculator used the smallest buy limit without accounting for how many of each item a recipe actually consumes. Divine charges were showing 22.5M profit when the real answer was closer to 2.5M. Oops.

### Flips that actually fill
A big volume number doesn't mean much if you can't get your offers filled. Flips now puts more emphasis on what the market is actually doing.

- **Fill time and Profit / 4h.** Both are calculated using the last 24 hours of trading on each side of the market. Buyers need sellers. Sellers need buyers. It's a pretty important part of flipping.
- **Prices from actual recent trades.** Flips no longer lets one weird sale dictate the picture. Markets where buyers are already overpaying get skipped, and items that are **↓ Still falling** get called out.
- **Risk pills.** Filter opportunities into All flips, Low risk, Medium risk, and High risk. There's also a new **Good potential flips right now** section on the Dashboard.

### Portfolio and Watchlist
A few quality-of-life improvements to make keeping track of your stuff a little less tedious.

- **Portfolio sorting.** Click a column to sort by item, quantity, value, net P&L, or how long you've held something.
- **Watchlist sorting.** Sort by date added, name, price, biggest risers, or biggest fallers. You can also switch between **Cards** and a more compact **List** view.
- **Net worth history.** A new chart tracks your net worth over time. You can also export your positions, trades, and tax information to a spreadsheet.
- **What to offer.** The item panel now tells you what to offer when buying or selling, and how far the current price is from normal.

### A few more things
- **Google Drive sync** is now available on desktop. Android sign-in is still a work in progress.
- **Ctrl+K** opens quick search for items, tabs, and Money Makers.
- **New drop source warnings.** If a new boss starts dropping something you own, GEnius will let you know. Looking at you, Elder seeds.
- **Stops falling alerts.** You can now get notified when an item's price finally stops dropping.
- **Hourly price history.** Item charts can now use archived hourly prices, rather than relying entirely on daily history.
- **Trillions are now T.** Because *3.41T gp traded today* is a lot easier to read than *3414.18B*.
- **Bug fixes.** Two rounds of bug audits turned up plenty of things worth fixing: safer saves, correct dates on phone reminders, no more double-counted sales, and a whole lot of smaller fixes.

**GEnius v3.0.0. On your PC, in your pocket, and still not financial advice.**
