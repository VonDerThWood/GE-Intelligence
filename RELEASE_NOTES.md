## GEnius v2.9.0

**The Almanac gets a reality check, Notifications finally remembers things, and Jagex is about to touch your stuff. Ayo...**

This one's a big one. Better-tested market recommendations, a proper notification history, early warnings about game updates, and live prices making themselves useful across the app. Let's get into it.

### Almanac: Show your work.
The Almanac has a new job: proving its recommendations aren't just making things up.

- **Every DXP plan gets tested.** GEnius now replays each item's strategy against historical Double XP events it wasn't trained on, accounting for GE tax. It also compares the results against simply trading 45 days before DXP. Only strategies that hold up across at least 8 tests earn a place in Recommendations. The rest get a *No reliable trade* label. We'd rather tell you we don't know than pretend we do.
- **Forecasts, in plain English.** Click the 📋 icon in the Plan column to see a plain-English breakdown of the Forecast, including when to buy and when to sell. Once a Double XP is announced, relative timing is replaced with actual dates.
- **Already own it?** Plans that begin by selling now get an *Only if you own it* label. No point recommending a strategy you can't actually follow.
- **This DXP, live.** The forecast pop-up now compares actual market trades during the current Double XP against the GE guide price. Untested strategies are clearly identified, while GEnius tracks how the old approach performs against the market.
- **New Items.** Items released within the last 18 months are too new for regular recommendations, so they get their own tab. They're tested using the same process and compared with their closest older counterparts (Eternal frames vs. Elder and Magic frames, for example). Active items appear by default, with a Show all option for everything else. Items between 18 and 30 months old get a *Fairly new item* label.
- **No more double-counting.** Double XP events are no longer counted twice, and an event that's still underway won't skew the historical statistics.

### Notifications: We have things to tell you.
The old Alerts tab has grown up. Or at least learned to keep receipts.

- **Alerts is now Notifications.** Four pills organize everything: Inbox, Upcoming Changes, Almanac and My Alerts.
- **Inbox remembers.** Every notification GEnius sends is saved until you clear it. Dismissed a popup? No problem. It isn't gone forever.
- **Almanac flags.** New *Start selling now*, *Start buying now* and *Coming up* flags are tracked across the item catalogue. Your holdings and watchlists get priority, and new findings arrive together in a single digest notification.
- **Unread indicators.** Each pill gets its own unread dot, with optional emoji indicators if you'd rather give things a little personality. Configure them under Settings → Notifications.

### Upcoming Changes: Jagex has plans. Your bank has concerns.
GEnius now watches upcoming game update previews and looks for items that might be caught in the crossfire.

- **Early warnings.** Items you hold or watch that might be affected by an upcoming update are flagged across the Dashboard, Portfolio, Watchlist, item panel and the new Upcoming Changes page.
- **Related items count, too.** Materials associated with skills or content targeted by an update can also be flagged, even when the items themselves aren't explicitly mentioned.
- **No financial advice from a nervous friend.** GEnius identifies potential exposure; it doesn't tell you to buy or sell. These warnings are informational, and related-item detection isn't guaranteed to catch everything.

This feature exists because we nearly sold 93,000 Magic frames right before the 120 Construction release. We didn't. We were approximately 2.8b poorer for the experience.

*Might be nothing. Might be 2.8b.*

### Portfolio: Know what you're holding.
- **Risk badges.** Every position and item now gets a Low, Medium or High risk rating based on price volatility, its largest historical drop, buy/sell spread and the size of your stack relative to daily trading volume. Click a badge to see what contributed to the rating. It's a description of risk, not a prediction of what happens next.
- **Multiple positions, one row.** Positions in the same item are now grouped together, showing combined quantity, average cost, value and P&L. Expand the row to see the individual positions.
- **Full Numbers.** A new display setting replaces abbreviated values with their full amounts. 13,903,000 instead of 13.90M. For those who like counting zeroes.

### Live Prices: The numbers should actually be live.
Live buy and sell prices now reach considerably more corners of GEnius.

- **Live prices across the app.** Profit calculations now use live buy/sell prices throughout Alch, Invention machines, Make it yourself, potions, DXP ideas, Portfolio and more.
- **Less weird price behavior.** Live prices now use recent trade averages instead of relying on a single latest trade. One unusually priced transaction shouldn't make Soul runes look like they're worth 200gp.
- **Tax fixes.** Alch profit no longer takes GE tax off the purchase price (tax only applies when you sell), which made alchs look more profitable than they were. Invention machine profit calculations now include tax as well.
- **Live price history is permanent.** GEnius now saves its collected live prices instead of relying entirely on the Wiki's roughly 100-day history window. That gives us a much longer history to work with as the app grows.

### Smaller Things
- **Theme names cleaned up.** Classic (formerly Dark) and Dark (formerly Black). Your saved theme preference carries over.
- **DXP alerts use game days.** Notifications now say things like *3 days before DXP starts* or *day 5 of DXP*, rather than awkwardly changing at noon.
- **News cleanup.** "Name Release" news posts no longer get mistaken for actual game releases.
- **Layout fixes.** Fixed cut-off layouts and column-resize lines extending above table headers.
- **Under the hood.** Faster Almanac flags, fewer unnecessary redraws, and a batch of additional fixes from a code review.

**GEnius v2.9.0 — More history. Better signals. Fewer expensive surprises.**
