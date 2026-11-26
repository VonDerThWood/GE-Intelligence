## GEnius v3.1.0

**Tester feedback, put to work: moving averages on the chart, an Almanac that tells you what to offer and until when, and price history that keeps itself up to date again.**

### Price chart: moving averages and the 90-day median
Tester request. The price chart has a new **Lines** row:
- **30, 90 and 200-day moving averages**: the trend at a glance. A price stuck under its 200-day line for months is a long decline.
- **90-day median (bid)**, dashed: the middle price of the last 90 days, day by day. Its latest point is what the Almanac bids.
- Hover a line to see its value today. Your choices are remembered.
- **Live price detail** (tester request): on phones, drag your finger along the chart to move through the times, instead of only tapping. The info box now moves to the other side of the chart from where you're looking, so it never covers the line.

### Almanac: bid and list, at a price, by a date
"Buy now" and "Sell now" are gone. Each flag now says what to offer and until when:
- **Bid ~X each, until about <date>**: the item's 90-day median, never above today's live prices. In a backtest on the November 2026 DXP's live prices (14 Almanac buy flags, each sold at its usual DXP peak), the median return per flag was +11.7% when bidding like this (unfilled bids counted as 0), against +4.0% when buying instantly. That's one DXP and a small sample, so treat it as encouraging, not proven.
- **List at ~X each, by about <date>**: its 90-day median plus its usual DXP rise, never below what buyers pay now or your break-even.
- Notifications read the same way: "Bid: Teak logs ~191 until Dec 4".

### Almanac: notifications and long declines
- **Almanac notifications now reach your phone.** The switch for them was off by default and hidden on the Almanac's DXP tab, labelled as if it only covered your DXP watchlist. It's now **on by default** (unless you turned it off yourself) and has its own place in **Settings → Notifications → Almanac**.
- Bid ideas now warn when an item is in a long decline: down 15% or more over 6 months and still falling. Declining items can swing hard either way, so check the chart first.
- Notifications list those items last, on their own "Long decline" line, below the other bid ideas.

### Item panel: the bigger picture
Tester feedback: an item up 24% in 90 days looked like a riser, even though it's down 15% on the year and 42% over three.
- Price changes now show **1 year and 3 years** next to 7, 30 and 90 days.
- **Flip margin** shows a realistic profit and how long a buy limit takes to fill, instead of "margin × buy limit" (which promised 240M on an item that trades about 70 a day). It also shows the prices it used, and warns when the latest trades show no margin.
- **What to offer** no longer quotes a per-buy-limit profit for items that would take days to fill, and gives the same latest-trades warning.

### Price history catches up again
GEnius keeps every item's price history topped up in the background after each fetch. Since early November, that top-up was quietly getting stuck after a single item, so the guide-price history behind charts, the Almanac, signals and chart analysis slowly went stale. Live prices were never affected.
- **Fixed.** The background top-up runs in full again. Once you update, a few hours of normal use brings every item back up to date. Nothing was lost; the missing days are simply downloaded.
- **It can't hide again.** If most of your price history falls more than 3 days behind, **Settings → Background problems** now says so.

### Logging sales from the GE reader
- If your Portfolio already has recent sales of an item at the same price (logged by hand or on another device), the GE reader now warns you before logging an offer's sales again, and logs only the new ones. This stops an offer's earlier fills being counted twice.
- The reader now recognises an offer by its item and price, so adding more items to an offer that's already selling no longer makes it log everything sold so far again.

### Money Makers
- Construction: plank machine rows showed the manual row's Profit/Limit, ignoring the machine's charge cost. Fixed (Elder planks: 30.7M → 22.3M per limit). The charge now shows in whole coins ("337gp", not "337.035gp").

### Small fixes
- Search could stop showing results for a while after a price fetch (seen on opening the app after a few days away): the item list could be swapped for an empty one if prices were read while still being saved. It now keeps the list it has and tries the read again.
- Search: if you type before the very first price fetch has finished, the search list now says prices are still loading, instead of showing nothing.
- Settings → Background problems: entries older than 7 days now drop off by themselves, so old, already-fixed errors don't hang around.

### Android
- Files are now saved safely (written in full first, then swapped in), so a read can't catch one half-saved, and closing the app mid-save can't leave a broken file.
- Fixed a behind-the-scenes mix-up where the phone app thought some desktop-only features existed. Settings on the phone now shows the right sections.
- Watchlist notifications no longer show a bare item number (like "52861") instead of the item's name.

**GEnius v3.1.0. Your testers talked; the Almanac listened.**
