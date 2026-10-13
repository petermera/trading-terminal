# VOLT Electricity Market Terminal

A local browser dashboard backed by a SQLite database. It downloads published day-ahead electricity prices from the [Energy-Charts API](https://api.energy-charts.info/) and stores each interval, source attribution, unit, and import time locally.

> **Real market data, simulated trades.** Day-ahead prices are fetched from the named public source and their age and attribution are displayed. Buy/sell actions are paper trades only; there is no exchange/broker connection or live order execution. Intraday and balancing products are not passed off as day-ahead prices. This software is not investment advice.

## Run it

Install [Node.js 22.13 or newer](https://nodejs.org/) (the built-in SQLite module is used). From the repository root:

```sh
npm start
```

Open <http://127.0.0.1:8000/>. No package install, API key, or third-party runtime dependency is needed. The server creates `data/trading.sqlite`, imports published observations at startup, and checks each zone for a due refresh every minute, rather than relying on a 15-minute timer that can skip later zones after a long batch. It also requests the next 48 hours of published intervals so tomorrow's day-ahead prices are stored without being treated as current quotes. You can also click **Sync source now**. Stop it with `Ctrl+C`; the SQLite database and recorded paper trades persist between restarts. `data/` is ignored by Git.

Check and test it:

```sh
npm run check
npm test
```

## Data scope and attribution

Energy-Charts exposes historical and published day-ahead prices by bidding zone. This app imports supported zones listed on the dashboard and stores the source's returned attribution/license text with each observation. Great Britain remains listed but is marked not covered because the source rejects its current `GB` zone identifier. Zone availability or rate limits can differ: failed imports are shown as unavailable/stale, retained data is not replaced with fabricated prices, and paper trades are blocked without a fresh quote. Write requests are restricted to the local app origin and require the per-process token returned with the state response.

This source does **not** provide the intraday, balancing-capacity, order-book, or broker execution data shown in a live exchange terminal. Those products deliberately display as not covered until an appropriate licensed feed is configured. The order book is only illustrative paper-trading depth.

To inspect stored market data:

```sh
sqlite3 data/trading.sqlite \
  "SELECT m.name, p.interval_start, p.price, p.unit, p.source, p.license_info FROM market_prices p JOIN markets m ON m.id=p.market_id ORDER BY p.interval_start DESC LIMIT 20;"
```

The database contains:

- `markets` — market/product catalogue and supported bidding zones
- `market_prices` — timestamped source observations and attribution
- `feed_sync` — per-zone import status and errors
- `paper_trades` — locally recorded paper fills

## Technology

HTML/CSS/JavaScript render the browser UI. Node.js provides the API and data importer. SQLite is the real local database. C++ is not required to serve a browser interface; [`cpp/`](./cpp/) remains a separate optional console demonstration.

## Before using for real trading

The app is **not** production or live-trading software. A production system needs verified and licensed feeds for each exact product, secure user authentication, an appropriately hosted production database, feed monitoring/reconciliation, risk controls, audit trails, and a separately reviewed broker/exchange integration. Never treat public day-ahead prices as an executable quote for another market product.

The longer-term product repository is [`petermera/Terminal_Trading`](https://github.com/petermera/Terminal_Trading).
