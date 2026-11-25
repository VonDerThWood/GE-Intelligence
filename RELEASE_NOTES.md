## GEnius v3.0.1

**A small release with one fix that matters: your price history keeps itself up to date again.**

### Price history catches up again
GEnius keeps every item's price history topped up in the background after each fetch. Since early November, that top-up was quietly getting stuck after a single item, so the guide-price history behind charts, the Almanac, signals and chart analysis slowly went stale. Live prices were never affected.

- **Fixed.** The background top-up runs in full again. Once you update, a few hours of normal use brings every item back up to date. Nothing was lost; the missing days are simply downloaded.
- **It can't hide again.** If most of your price history falls more than 3 days behind, **Settings → Background problems** now says so.

### Logging sales from the GE reader
- If your Portfolio already has recent sales of an item at the same price (logged by hand or on another device), the GE reader now warns you before logging an offer's sales again, and logs only the new ones. This stops an offer's earlier fills being counted twice.

### Small fixes
- Search could stop showing results for a while after a price fetch (seen on opening the app after a few days away): the item list could be swapped for an empty one if prices were read while still being saved. It now keeps the list it has and tries the read again.
- Search: if you type before the very first price fetch has finished, the search list now says prices are still loading, instead of showing nothing.
- Settings → Background problems: entries older than 7 days now drop off by themselves, so old, already-fixed errors don't hang around.

### Money Makers
- Construction: plank machine rows showed the manual row's Profit/Limit, ignoring the machine's charge cost. Fixed (Elder planks: 30.7M → 22.3M per limit). The charge now shows in whole coins ("337gp", not "337.035gp").

### Android
- Fixed a behind-the-scenes mix-up where the phone app thought some desktop-only features existed. Settings on the phone now shows the right sections.
- Watchlist notifications no longer show a bare item number (like "52861") instead of the item's name.

**GEnius v3.0.1. Same app, fresher history.**
