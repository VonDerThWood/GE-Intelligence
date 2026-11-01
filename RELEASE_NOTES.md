## GEnius v2.8.0

A pretty ridiculous amount of research, a much smarter Almanac, and your data is still there.

### Chart analysis and item research
- **Chart analysis** is now available under every item chart. See how an item compares to the market, where its price sits in its yearly range, tested support/resistance levels, and how its dips usually play out. Every reading comes with its own track record. If something doesn't hold up, it gets marked *Weak* instead of being dressed up as a sure thing.
- **Alch floor line** shows high alch minus a nature rune, along with exactly how often the item's price fell below it over the last 3 years.
- **Ask about this item** gives you 16 fill-in-the-blank questions about an item's own history: when it last hit a price, its biggest drops, how it behaved around DXP, flip odds, and more. Less guessing, more receipts.
- **Moves with** finds items whose prices tend to move together, or in opposite directions. Your portfolio may have some interesting relationships.

### Almanac and News
- **Game Updates** digs into how past updates moved prices and which items were affected. History has a habit of repeating itself, especially when Jagex changes something.
- **Launches** tracks every new item by update, from launch through its lowest price to today, using live prices.
- **News** got a redesign: upcoming dates, a monthly calendar, unread dots, and tags for DXP, items you hold or watch, and tracked updates. Finding the stuff that matters to you should take less digging.
- **DXP alerts:** GEnius now spots Double XP announcements and teases in the news automatically and notifies you. No more relying entirely on your ability to notice Jagex hinting at something.

### Portfolio
- **Buy Planner** helps you buy up an item across multiple 4-hour limits, including goals spread across several accounts. Keeping track of your true average cost across accounts is a major pain; this does it for you.
- Added **Break-even** and **Since bought** columns, a **High alch** sell option, and multi-input **Convert**.
- **Closed Positions** are now grouped by item, so they're easier to follow when you've bought, sold, and bought the same item again. Your money has a history, and now it's easier to read.

### November GE removals
- Items Jagex removes from the GE, including springs, Silverhawk feathers, and portables, stay on your Watchlist and in your Portfolio. They're labelled *Removed from GE* instead of disappearing like they owe you money.
- **Invention → Items** now includes a **Make it yourself** calculator for Tight springs and Enchanted notepaper, priced using the cheapest live disassembly source.

### Signals and markets
- **Opportunities → Track record** grades every high-scoring item based on what its price actually did 1, 7, and 30 days later. A high score is a lead, not a prophecy.
- New **SPIKE / SLUMP** signals based on live prices.
- Brand-new items no longer get volume badges on day one. Having a price and having meaningful trading volume are two different things.
- **Food** now shows heal amounts and cost per life point.
- The **Market** tab can now hide items below a price you set. Less scrolling past pocket change.

### Fixes and safety
- **Big fix: price history is updating again.** History for most items had stopped refreshing in late June, throwing off volume signals, Opportunity Score, and the Almanac. Background refresh is back, and the Almanac has been rebuilt. If some of those features seemed to have lost their minds, this is why.
- Fixed a failed file read at startup that made all your data *look* wiped. Your data was safe on disk the entire time; the app just did a spectacularly bad job of showing it.
- Fixed new items failing to download their price history.
- Fixed the Buy Planner counting items you'd already sold as still held when you updated your totals.
- **Restore a daily backup** from Settings. Your current data is saved first, so you can undo a restore if needed. Backups now include your portfolio and alerts, too.
- Update checks now run every 6 hours while GEnius is open.
- Security pass completed, Electron updated, and a whole pile of smaller fixes and improvements.

---

That's v2.8.0. GEnius now has a much better memory for the market, a much better idea of what its own predictions are worth, and considerably fewer ways to give you a heart attack at startup.
