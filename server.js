'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { randomUUID, timingSafeEqual } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 8000);
const DB_FILE = path.resolve(
  process.env.VOLT_DATABASE_PATH || path.join(__dirname, 'data', 'trading.sqlite')
);
const PRICE_API_URL = process.env.VOLT_PRICE_API_URL || 'https://api.energy-charts.info/price';
const PRICE_API_TIMEOUT_MS = 20_000;
const PRICE_REFRESH_INTERVAL_MS = 15 * 60_000;
const SYNC_CHECK_INTERVAL_MS = 60_000;
const SOURCE_REQUEST_SPACING_MS = Number(process.env.VOLT_SOURCE_REQUEST_SPACING_MS ?? 2000);
const MAX_QUOTE_AGE_MS = 90 * 60_000;
const MAX_BODY_BYTES = 16 * 1024;
const SOURCE_NAME = 'Energy-Charts API';
const SOURCE_URL = 'https://api.energy-charts.info/';
const FIRST_HISTORY_MS = 72 * 60 * 60_000;
const DAY_AHEAD_FORWARD_WINDOW_MS = 48 * 60 * 60_000;
const WRITE_TOKEN = randomUUID();

const MARKETS = [
  { id: 'epex-de', name: 'EPEX DE/LU', region: 'Germany/Luxembourg', product: 'Day-ahead', biddingZone: 'DE-LU' },
  { id: 'epex-fr', name: 'EPEX FR', region: 'France', product: 'Day-ahead', biddingZone: 'FR' },
  { id: 'epex-at', name: 'EPEX AT', region: 'Austria', product: 'Day-ahead', biddingZone: 'AT' },
  { id: 'epex-be', name: 'EPEX BE', region: 'Belgium', product: 'Day-ahead', biddingZone: 'BE' },
  { id: 'omie-es', name: 'OMIE ES', region: 'Spain', product: 'Day-ahead', biddingZone: 'ES' },
  { id: 'omie-pt', name: 'OMIE PT', region: 'Portugal', product: 'Day-ahead', biddingZone: 'PT' },
  { id: 'np-dk1', name: 'Nord Pool DK1', region: 'Denmark West', product: 'Day-ahead', biddingZone: 'DK1' },
  { id: 'np-no1', name: 'Nord Pool NO1', region: 'Norway South-East', product: 'Day-ahead', biddingZone: 'NO1' },
  { id: 'n2ex-uk', name: 'N2EX GB', region: 'Great Britain', product: 'Day-ahead', biddingZone: null },
  { id: 'ida-de', name: 'IDA DE/LU', region: 'Germany/Luxembourg', product: 'Intraday', biddingZone: null },
  { id: 'ida-fr', name: 'IDA FR', region: 'France', product: 'Intraday', biddingZone: null },
  { id: 'ida-es', name: 'IDA ES', region: 'Spain', product: 'Intraday', biddingZone: null },
  { id: 'ida-it', name: 'GME IT', region: 'Italy', product: 'Intraday', biddingZone: null },
  { id: 'ida-pl', name: 'TGE PL', region: 'Poland', product: 'Intraday', biddingZone: null },
  { id: 'ida-nl', name: 'EPEX NL', region: 'Netherlands', product: 'Intraday', biddingZone: null },
  { id: 'afrr-de', name: 'aFRR DE', region: 'Germany', product: 'aFRR capacity', biddingZone: null },
  { id: 'mfrr-de', name: 'mFRR DE', region: 'Germany', product: 'mFRR capacity', biddingZone: null },
  { id: 'fcr-eu', name: 'FCR EU', region: 'Europe', product: 'FCR capacity', biddingZone: null },
  { id: 'afrr-es', name: 'aFRR ES', region: 'Spain', product: 'aFRR capacity', biddingZone: null },
  { id: 'rr-eu', name: 'RR EU', region: 'Europe', product: 'Replacement reserve', biddingZone: null },
  { id: 'imbalance-de', name: 'Imbalance DE', region: 'Germany', product: 'Imbalance', biddingZone: null }
];
const MARKET_BY_ID = new Map(MARKETS.map((market) => [market.id, market]));
const DAY_AHEAD_MARKETS = MARKETS.filter((market) => market.biddingZone);

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const database = new DatabaseSync(DB_FILE);
database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS markets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    region TEXT NOT NULL,
    product TEXT NOT NULL,
    bidding_zone TEXT UNIQUE
  );
  CREATE TABLE IF NOT EXISTS market_prices (
    id INTEGER PRIMARY KEY,
    market_id TEXT NOT NULL REFERENCES markets(id),
    interval_start TEXT NOT NULL,
    price REAL NOT NULL,
    unit TEXT NOT NULL,
    source TEXT NOT NULL,
    source_url TEXT NOT NULL,
    license_info TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    UNIQUE (market_id, interval_start)
  );
  CREATE INDEX IF NOT EXISTS market_prices_latest
    ON market_prices(market_id, interval_start DESC);
  CREATE TABLE IF NOT EXISTS feed_sync (
    bidding_zone TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    last_attempt_at TEXT NOT NULL,
    last_success_at TEXT,
    last_error TEXT
  );
  CREATE TABLE IF NOT EXISTS paper_trades (
    id TEXT PRIMARY KEY,
    market_id TEXT NOT NULL REFERENCES markets(id),
    side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
    quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 500),
    fill_price REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'EUR',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS paper_trades_latest
    ON paper_trades(created_at DESC);
`);

const insertMarket = database.prepare(`
  INSERT INTO markets (id, name, region, product, bidding_zone)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    region = excluded.region,
    product = excluded.product,
    bidding_zone = excluded.bidding_zone
`);
for (const market of MARKETS) {
  insertMarket.run(market.id, market.name, market.region, market.product, market.biddingZone);
}

const insertPrice = database.prepare(`
  INSERT INTO market_prices (
    market_id, interval_start, price, unit, source, source_url, license_info, fetched_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(market_id, interval_start) DO UPDATE SET
    price = excluded.price,
    unit = excluded.unit,
    source = excluded.source,
    source_url = excluded.source_url,
    license_info = excluded.license_info,
    fetched_at = excluded.fetched_at
`);
const upsertSyncStatus = database.prepare(`
  INSERT INTO feed_sync (bidding_zone, status, last_attempt_at, last_success_at, last_error)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(bidding_zone) DO UPDATE SET
    status = excluded.status,
    last_attempt_at = excluded.last_attempt_at,
    last_success_at = COALESCE(excluded.last_success_at, feed_sync.last_success_at),
    last_error = excluded.last_error
`);

const selectMarkets = database.prepare(`
  SELECT id, name, region, product, bidding_zone
  FROM markets ORDER BY bidding_zone IS NULL, name
`);
const selectLatestPrice = database.prepare(`
  SELECT interval_start, price, unit, source, source_url, license_info, fetched_at
  FROM market_prices
  WHERE market_id = ? AND interval_start <= ?
  ORDER BY interval_start DESC LIMIT 1
`);
const selectHistory = database.prepare(`
  SELECT interval_start, price
  FROM market_prices
  WHERE market_id = ? AND interval_start <= ?
  ORDER BY interval_start DESC LIMIT 24
`);
const selectPreviousPrice = database.prepare(`
  SELECT price
  FROM market_prices
  WHERE market_id = ? AND interval_start < ?
  ORDER BY interval_start DESC LIMIT 1
`);
const selectDayStats = database.prepare(`
  SELECT MAX(price) AS high, MIN(price) AS low, AVG(price) AS average
  FROM market_prices
  WHERE market_id = ? AND interval_start >= ? AND interval_start <= ?
`);
const selectSyncStatus = database.prepare(`
  SELECT bidding_zone AS biddingZone, status, last_success_at AS lastSuccessAt, last_error AS lastError
  FROM feed_sync ORDER BY bidding_zone
`);
const selectTrades = database.prepare(`
  SELECT id, market_id AS marketId, side, quantity AS qty, fill_price AS entryPx,
         currency, created_at AS createdAt
  FROM paper_trades ORDER BY created_at, rowid
`);
const selectTradeById = database.prepare(`
  SELECT t.id, t.market_id AS marketId, t.side, t.quantity AS qty,
         t.fill_price AS px, t.currency, t.created_at AS createdAt, m.name AS market
  FROM paper_trades t JOIN markets m ON m.id = t.market_id
  WHERE t.id = ?
`);
const selectRecentTrades = database.prepare(`
  SELECT t.id, t.market_id AS marketId, t.side, t.quantity AS qty, m.name AS market,
         t.fill_price AS px, t.created_at AS createdAt
  FROM paper_trades t JOIN markets m ON m.id = t.market_id
  ORDER BY t.created_at DESC LIMIT 50
`);
const insertTrade = database.prepare(`
  INSERT INTO paper_trades (id, market_id, side, quantity, fill_price, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);

let syncing = false;
let syncPromise = null;

function parsePriceFeed(payload, now) {
  if (!payload || !Array.isArray(payload.unix_seconds) || !Array.isArray(payload.price) ||
      payload.unix_seconds.length !== payload.price.length ||
      typeof payload.license_info !== 'string' || payload.license_info.length === 0 ||
      typeof payload.unit !== 'string' || payload.unit.length === 0) {
    throw new Error('The market-data source returned an unexpected or unattributed response.');
  }

  const fetchedAt = now.toISOString();
  const parsed = [];
  for (let index = 0; index < payload.price.length; index += 1) {
    const timestamp = Number(payload.unix_seconds[index]);
    const price = Number(payload.price[index]);
    if (!Number.isFinite(timestamp) || !Number.isFinite(price)) continue;
    const interval = new Date(timestamp * 1000);
    if (Number.isNaN(interval.getTime())) continue;
    parsed.push({
      intervalStart: interval.toISOString(),
      price,
      unit: payload.unit,
      source: payload.license_info,
      sourceUrl: SOURCE_URL,
      licenseInfo: payload.license_info,
      fetchedAt
    });
  }
  if (parsed.length === 0) {
    throw new Error('The market-data source returned no valid published intervals.');
  }
  return parsed;
}

async function syncBiddingZone(market, now = new Date()) {
  upsertSyncStatus.run(market.biddingZone, 'syncing', now.toISOString(), null, null);
  const start = new Date(now.getTime() - FIRST_HISTORY_MS);
  const end = new Date(now.getTime() + DAY_AHEAD_FORWARD_WINDOW_MS);
  const url = new URL(PRICE_API_URL);
  url.searchParams.set('bzn', market.biddingZone);
  url.searchParams.set('start', start.toISOString());
  url.searchParams.set('end', end.toISOString());

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(PRICE_API_TIMEOUT_MS) });
    if (!response.ok) {
      throw new Error(`Price source returned HTTP ${response.status}.`);
    }
    const payload = await response.json();
    const prices = parsePriceFeed(payload, now);
    database.exec('BEGIN');
    try {
      for (const item of prices) {
        insertPrice.run(
          market.id, item.intervalStart, item.price, item.unit,
          item.source, item.sourceUrl, item.licenseInfo, item.fetchedAt
        );
      }
      const retention = new Date(now.getTime() - 30 * 24 * 60 * 60_000).toISOString();
      database.prepare('DELETE FROM market_prices WHERE market_id = ? AND interval_start < ?')
        .run(market.id, retention);
      upsertSyncStatus.run(market.biddingZone, 'ok', now.toISOString(), now.toISOString(), null);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
    return { biddingZone: market.biddingZone, savedIntervals: prices.length };
  } catch (error) {
    upsertSyncStatus.run(
      market.biddingZone, 'error', new Date().toISOString(), null, error.message.slice(0, 300)
    );
    throw error;
  }
}

async function syncAllMarkets() {
  if (syncPromise) return syncPromise;
  syncing = true;
  syncPromise = (async () => {
    const results = [];
    for (const market of DAY_AHEAD_MARKETS) {
      const previousSync = database.prepare(`
        SELECT status, last_attempt_at AS lastAttemptAt,
               last_success_at AS lastSuccessAt
        FROM feed_sync WHERE bidding_zone = ?
      `).get(market.biddingZone);
      const successAge = previousSync?.lastSuccessAt
        ? Date.now() - Date.parse(previousSync.lastSuccessAt)
        : Infinity;
      if (previousSync?.status === 'ok' && successAge < PRICE_REFRESH_INTERVAL_MS) {
        results.push({ biddingZone: market.biddingZone, skipped: true });
        continue;
      }
      const attemptAge = previousSync?.lastAttemptAt
        ? Date.now() - Date.parse(previousSync.lastAttemptAt)
        : Infinity;
      if (previousSync?.status === 'error' && attemptAge < 60_000) {
        results.push({ biddingZone: market.biddingZone, skipped: true });
        continue;
      }
      try {
        results.push(await syncBiddingZone(market));
      } catch (error) {
        console.error(`Real price sync failed for ${market.biddingZone}: ${error.message}`);
        results.push({ biddingZone: market.biddingZone, error: error.message });
      }
      if (SOURCE_REQUEST_SPACING_MS > 0) {
        await new Promise((resolve) => setTimeout(resolve, SOURCE_REQUEST_SPACING_MS));
      }
    }
    return results;
  })().finally(() => {
    syncing = false;
    syncPromise = null;
  });
  return syncPromise;
}

function quoteForMarket(market, now) {
  const latest = selectLatestPrice.get(market.id, now.toISOString());
  if (!latest) {
    return {
      price: null, prev: null, change: null, history: [],
      intervalStart: null, fetchedAt: null, freshness: market.bidding_zone ? 'unavailable' : 'not_covered',
      unit: 'EUR / MWh', source: null, sourceUrl: null, licenseInfo: null
    };
  }

  const history = selectHistory.all(market.id, now.toISOString()).reverse();
  const previous = selectPreviousPrice.get(market.id, latest.interval_start);
  const ageMs = now.getTime() - Date.parse(latest.interval_start);
  const biddingZone = market.bidding_zone || market.biddingZone;
  const sync = biddingZone
    ? database.prepare('SELECT last_success_at AS lastSuccessAt FROM feed_sync WHERE bidding_zone = ?')
      .get(biddingZone)
    : null;
  const fetchAge = sync?.lastSuccessAt ? now.getTime() - Date.parse(sync.lastSuccessAt) : Infinity;
  const freshness = ageMs <= MAX_QUOTE_AGE_MS && fetchAge <= 45 * 60_000 ? 'fresh' : 'stale';
  return {
    price: latest.price,
    prev: previous?.price ?? latest.price,
    change: latest.price - (previous?.price ?? latest.price),
    history: history.map((item) => ({ timestamp: item.interval_start, price: item.price })),
    intervalStart: latest.interval_start,
    fetchedAt: latest.fetched_at,
    freshness,
    unit: latest.unit,
    source: latest.source,
    sourceUrl: latest.source_url,
    licenseInfo: latest.license_info
  };
}

function buildPaperLedger(trades, markets, valuationTime) {
  const positionsByMarket = new Map();
  let volume = 0;
  let tradedValue = 0;

  for (const trade of trades) {
    const quantity = Number(trade.qty);
    const fillPrice = Number(trade.entryPx);
    const signedQuantity = trade.side === 'BUY' ? quantity : -quantity;
    const position = positionsByMarket.get(trade.marketId) ?? {
      quantity: 0,
      averagePrice: 0,
      realizedPnl: 0
    };

    volume += quantity;
    tradedValue += quantity * fillPrice;

    if (position.quantity === 0 || Math.sign(position.quantity) === Math.sign(signedQuantity)) {
      const previousQuantity = Math.abs(position.quantity);
      const nextQuantity = previousQuantity + quantity;
      position.averagePrice = (
        position.averagePrice * previousQuantity + fillPrice * quantity
      ) / nextQuantity;
      position.quantity += signedQuantity;
    } else {
      const closedQuantity = Math.min(Math.abs(position.quantity), quantity);
      position.realizedPnl += (position.quantity > 0 ? 1 : -1) *
        (fillPrice - position.averagePrice) * closedQuantity;
      const nextQuantity = position.quantity + signedQuantity;
      if (nextQuantity === 0) {
        position.averagePrice = 0;
      } else if (Math.sign(nextQuantity) !== Math.sign(position.quantity)) {
        position.averagePrice = fillPrice;
      }
      position.quantity = nextQuantity;
    }

    positionsByMarket.set(trade.marketId, position);
  }

  const positions = [];
  let realizedPnl = 0;
  let unrealizedPnl = 0;
  let allMarksAvailable = true;

  for (const [marketId, position] of positionsByMarket) {
    realizedPnl += position.realizedPnl;
    if (position.quantity === 0) continue;

    const market = markets[marketId];
    const markIsFresh = market?.price !== null && market?.freshness === 'fresh';
    const markPrice = markIsFresh ? market.price : null;
    const pnl = markIsFresh
      ? Math.sign(position.quantity) * (markPrice - position.averagePrice) * Math.abs(position.quantity)
      : null;
    if (pnl === null) allMarksAvailable = false;
    else unrealizedPnl += pnl;

    positions.push({
      marketId,
      market: market?.name ?? marketId,
      side: position.quantity > 0 ? 'BUY' : 'SELL',
      qty: Math.abs(position.quantity),
      entryPx: position.averagePrice,
      currency: 'EUR',
      unit: 'MWh',
      markUnit: market?.unit ?? null,
      markPrice,
      markStatus: market?.price == null ? 'missing' : markIsFresh ? 'fresh' : 'stale',
      markSource: market?.price == null ? null : SOURCE_NAME,
      markSourceUrl: market?.sourceUrl ?? null,
      markLicenseInfo: market?.licenseInfo ?? null,
      markTimestamp: market?.intervalStart ?? null,
      markFetchedAt: market?.fetchedAt ?? null,
      valuationTime,
      realizedPnl: position.realizedPnl,
      pnl
    });
  }

  return {
    positions,
    session: {
      volume,
      executionVwap: volume > 0 ? tradedValue / volume : null,
      realizedPnl,
      unrealizedPnl: allMarksAvailable ? unrealizedPnl : null,
      totalPnl: allMarksAvailable ? realizedPnl + unrealizedPnl : null
    }
  };
}

function snapshot(selectedMarketId = 'epex-de') {
  const now = new Date();
  const marketDefinitions = selectMarkets.all();
  const markets = Object.fromEntries(marketDefinitions.map((market) => {
    const quote = quoteForMarket(market, now);
    return [market.id, {
      id: market.id,
      name: market.name,
      region: market.region,
      product: market.product,
      biddingZone: market.bidding_zone,
      ...quote
    }];
  }));

  const selected = markets[selectedMarketId] || markets['epex-de'];
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const stats = selected.biddingZone
    ? selectDayStats.get(selected.id, dayStart.toISOString(), now.toISOString())
    : { high: null, low: null, average: null };
  const trades = selectTrades.all();
  const ledger = buildPaperLedger(trades, markets, now.toISOString());
  const tradeLog = selectRecentTrades.all().reverse().map((trade) => {
    const currentPrice = markets[trade.marketId]?.price;
    const pnl = currentPrice == null || markets[trade.marketId]?.freshness !== 'fresh'
      ? null
      : (trade.side === 'BUY' ? 1 : -1) * (currentPrice - trade.px) * trade.qty;
    return { ...trade, time: trade.createdAt.slice(11, 19), pnl };
  });

  return {
    markets,
    positions: ledger.positions,
    tradeLog,
    session: {
      high: stats.high,
      low: stats.low,
      average: stats.average,
      ...ledger.session
    },
    dataStatus: {
      source: SOURCE_NAME,
      sourceUrl: SOURCE_URL,
      licenseInfo: selected.licenseInfo,
      selectedMarketFreshness: selected.freshness,
      lastIntervalAt: selected.intervalStart,
      lastFetchedAt: selected.fetchedAt,
      syncInProgress: syncing,
      coverage: {
        configuredDayAheadZones: marketDefinitions.filter((market) => market.bidding_zone).length,
        unsupportedProducts: marketDefinitions.filter((market) => !market.bidding_zone).length,
        marketsWithPrices: Object.values(markets).filter((market) => market.price !== null).length
      },
      zoneSync: selectSyncStatus.all()
    },
    writeToken: WRITE_TOKEN
  };
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(JSON.stringify(value));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    let tooLarge = false;
    request.on('data', (chunk) => {
      if (tooLarge) return;
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) tooLarge = true;
    });
    request.on('end', () => {
      if (tooLarge) {
        reject(Object.assign(new Error('Request body is too large.'), { statusCode: 413 }));
        return;
      }
      try {
        const parsed = body ? JSON.parse(body) : {};
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(Object.assign(new Error('Request body must be a JSON object.'), { statusCode: 400 }));
          return;
        }
        resolve(parsed);
      } catch {
        reject(Object.assign(new Error('Request body must be valid JSON.'), { statusCode: 400 }));
      }
    });
    request.on('error', reject);
  });
}

function validateWriteRequest(request, response) {
  const allowedHosts = new Set([`${HOST}:${PORT}`, `localhost:${PORT}`]);
  if (!allowedHosts.has(request.headers.host)) {
    sendJson(response, 403, { error: 'This request host is not allowed.' });
    return false;
  }

  const origin = request.headers.origin;
  if (origin !== undefined) {
    let parsedOrigin;
    try {
      parsedOrigin = new URL(origin);
    } catch {
      sendJson(response, 403, { error: 'This request origin is not allowed.' });
      return false;
    }
    if (parsedOrigin.protocol !== 'http:' || parsedOrigin.origin !== origin ||
        !allowedHosts.has(parsedOrigin.host)) {
      sendJson(response, 403, { error: 'This request origin is not allowed.' });
      return false;
    }
  }

  const contentType = request.headers['content-type'] || '';
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    sendJson(response, 415, { error: 'Content-Type must be application/json.' });
    return false;
  }

  const token = request.headers['x-csrf-token'] || '';
  const tokenBuffer = Buffer.from(token);
  const expectedTokenBuffer = Buffer.from(WRITE_TOKEN);
  if (tokenBuffer.length !== expectedTokenBuffer.length ||
      !timingSafeEqual(tokenBuffer, expectedTokenBuffer)) {
    sendJson(response, 403, { error: 'A valid write token is required.' });
    return false;
  }

  return true;
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${HOST}:${PORT}`);

  if (request.method === 'POST' &&
      (url.pathname === '/api/refresh' || url.pathname === '/api/trades') &&
      !validateWriteRequest(request, response)) {
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/state') {
    const marketId = url.searchParams.get('marketId') || 'epex-de';
    if (!MARKET_BY_ID.has(marketId)) return sendJson(response, 400, { error: 'Unknown market.' });
    return sendJson(response, 200, snapshot(marketId));
  }

  if (request.method === 'POST' && url.pathname === '/api/refresh') {
    const results = await syncAllMarkets();
    const marketId = url.searchParams.get('marketId') || 'epex-de';
    const data = snapshot(marketId);
    const failures = results.filter((result) => result.error);
    return sendJson(response, failures.length === results.length ? 503 : 200, {
      ...data,
      refresh: {
        attemptedZones: results.length,
        savedIntervals: results.reduce((total, result) => total + (result.savedIntervals || 0), 0),
        failures
      }
    });
  }

  if (request.method === 'POST' && url.pathname === '/api/trades') {
    const body = await readJson(request);
    const market = MARKET_BY_ID.get(body.marketId);
    if (!market) return sendJson(response, 400, { error: 'Select a valid market before placing a paper trade.' });
    if (body.side !== 'BUY' && body.side !== 'SELL') {
      return sendJson(response, 400, { error: 'Trade side must be BUY or SELL.' });
    }
    if (!Number.isInteger(body.quantity) || body.quantity < 1 || body.quantity > 500) {
      return sendJson(response, 400, { error: 'Quantity must be a whole number from 1 to 500 MWh.' });
    }
    if (body.fillId !== undefined &&
        (typeof body.fillId !== 'string' || body.fillId.trim().length === 0 || body.fillId.length > 100)) {
      return sendJson(response, 400, { error: 'Fill identifier must be a non-empty string of at most 100 characters.' });
    }

    const id = body.fillId ?? randomUUID();
    const existingTrade = selectTradeById.get(id);
    if (existingTrade) {
      if (existingTrade.marketId !== market.id || existingTrade.side !== body.side ||
          existingTrade.qty !== body.quantity) {
        return sendJson(response, 409, { error: 'This fill identifier was already used for a different paper fill.' });
      }
      return sendJson(response, 200, {
        ...snapshot(market.id),
        trade: {
          id: existingTrade.id,
          time: existingTrade.createdAt.slice(11, 19),
          side: existingTrade.side,
          qty: existingTrade.qty,
          market: existingTrade.market,
          px: existingTrade.px.toFixed(2),
          priceSource: SOURCE_NAME
        },
        replayed: true
      });
    }

    if (!market.biddingZone) {
      return sendJson(response, 409, { error: 'This product does not have a connected real-price feed. No trade was created.' });
    }

    const quote = quoteForMarket(market, new Date());
    if (quote.price === null || quote.freshness !== 'fresh') {
      return sendJson(response, 409, { error: 'No fresh real market price is available. The paper trade was not created.' });
    }

    const spread = body.side === 'BUY' ? 0.1 : -0.1;
    const fillPrice = quote.price + spread;
    const createdAt = new Date().toISOString();
    insertTrade.run(id, market.id, body.side, body.quantity, fillPrice, createdAt);
    const result = snapshot(market.id);
    return sendJson(response, 201, {
      ...result,
      trade: {
        id,
        time: createdAt.slice(11, 19),
        side: body.side,
        qty: body.quantity,
        market: market.name,
        px: fillPrice.toFixed(2),
        priceSource: SOURCE_NAME
      },
      replayed: false
    });
  }

  if (request.method === 'GET' &&
      (url.pathname === '/' || url.pathname === '/global_electricity_trading_platform.html')) {
    const page = fs.readFileSync(path.join(__dirname, 'global_electricity_trading_platform.html'));
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    return response.end(page);
  }

  return sendJson(response, 404, { error: 'Not found.' });
}

let server;
async function start() {
  server = http.createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      if (!response.headersSent) {
        sendJson(response, error.statusCode || 500, {
          error: error.statusCode ? error.message : 'The local terminal server encountered an error.'
        });
      } else {
        response.destroy(error);
      }
      if (!error.statusCode) console.error(error);
    });
  });

  server.listen(PORT, HOST, () => {
    console.log(`VOLT terminal: http://${HOST}:${PORT}/`);
    console.log(`SQLite database: ${DB_FILE}`);
    console.log(`Real day-ahead prices: ${SOURCE_NAME} (refresh every ${PRICE_REFRESH_INTERVAL_MS / 60_000} minutes).`);
    console.log('Paper trading only — no exchange or broker order connection.');
  });

  syncAllMarkets().catch((error) => console.error(`Initial market-data sync failed: ${error.message}`));
  const syncTimer = setInterval(() => {
    syncAllMarkets().catch((error) => console.error(`Scheduled market-data sync failed: ${error.message}`));
  }, SYNC_CHECK_INTERVAL_MS);
  syncTimer.unref();
}

function shutdown() {
  if (server) server.close(() => {
    Promise.resolve(syncPromise)
      .catch((error) => console.error(`Market-data sync stopped during shutdown: ${error.message}`))
      .finally(() => {
        database.close();
        process.exit(0);
      });
  });
  else database.close();
}

if (require.main === module) {
  start();
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, shutdown);
}

module.exports = {
  DAY_AHEAD_MARKETS, MARKETS, buildPaperLedger, parsePriceFeed, quoteForMarket, snapshot, syncAllMarkets
};
