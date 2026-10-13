'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { after, before, test } = require('node:test');

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'volt-terminal-test-'));
let app;
let source;
let baseUrl;
let databaseFile;
let port;
let sourcePort;
let appOutput = '';
let writeToken;
let requestedSourceEnd;

async function availablePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const { port: available } = probe.address();
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return available;
}

function createSourceServer() {
  return http.createServer((request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${sourcePort}`);
    const zone = url.searchParams.get('bzn');
    requestedSourceEnd = url.searchParams.get('end');
    const zoneOffset = [...(zone || '')].reduce((total, character) => total + character.charCodeAt(0), 0) / 10;
    const end = Math.floor(Date.now() / 900_000) * 900_000;
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      license_info: 'Test feed; CC BY 4.0',
      unix_seconds: [
        (end - 1_800_000) / 1000,
        (end - 900_000) / 1000,
        end / 1000,
        (end + 86_400_000) / 1000
      ],
      price: [80 + zoneOffset, 81 + zoneOffset, 82 + zoneOffset, 83 + zoneOffset],
      unit: 'EUR / MWh'
    }));
  });
}

async function waitFor(predicate, description) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const result = await predicate();
      if (result) return result;
    } catch {
      // The local server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const diagnostic = baseUrl ? await fetch(`${baseUrl}/api/state`)
    .then((response) => response.json())
    .then((data) => JSON.stringify({
      coverage: data.dataStatus?.coverage,
      zones: data.dataStatus?.zoneSync,
      applicationLog: appOutput
    }))
    .catch((error) => error.message) : appOutput;
  throw new Error(`Timed out waiting for ${description}. ${diagnostic}`);
}

async function postJson(route, data, headers = {}) {
  return fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: baseUrl,
      'X-CSRF-Token': writeToken,
      ...headers
    },
    body: JSON.stringify(data)
  });
}

async function startApp() {
  app = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env,
      PORT: String(port),
      VOLT_DATABASE_PATH: databaseFile,
      VOLT_PRICE_API_URL: `http://127.0.0.1:${sourcePort}/price`,
      VOLT_SOURCE_REQUEST_SPACING_MS: '0'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  app.stdout.setEncoding('utf8').on('data', (chunk) => { appOutput += chunk; });
  app.stderr.setEncoding('utf8').on('data', (chunk) => { appOutput += chunk; });
  try {
    await waitFor(async () => {
      const response = await fetch(`${baseUrl}/api/state`);
      return response.ok;
    }, 'application server');
    writeToken = (await fetch(`${baseUrl}/api/state`).then((response) => response.json())).writeToken;
  } catch (error) {
    throw new Error(`${error.message}\n${appOutput}`);
  }
}

before(async () => {
  port = await availablePort();
  sourcePort = await availablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  databaseFile = path.join(temporaryDirectory, 'terminal.sqlite');
  source = createSourceServer();
  await new Promise((resolve, reject) => source.once('error', reject).listen(sourcePort, '127.0.0.1', resolve));
  await startApp();
});

after(async () => {
  if (app && app.exitCode === null) {
    app.kill('SIGTERM');
    await once(app, 'exit');
  }
  if (source) await new Promise((resolve, reject) => source.close((error) => error ? reject(error) : resolve()));
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

test('ingests source-attributed market observations into SQLite and persists paper trades', async () => {
  const page = await fetch(`${baseUrl}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /real-market-data/);

  const firstState = await waitFor(async () => {
    const response = await fetch(`${baseUrl}/api/state?marketId=epex-de`);
    const data = await response.json();
    return data.markets['epex-de'].price !== null && data.dataStatus.coverage.marketsWithPrices === 8
      ? data
      : null;
  }, 'initial real-price source ingestion');
  assert.equal(firstState.markets['epex-de'].price, 82 + [...'DE-LU'].reduce((sum, character) => sum + character.charCodeAt(0), 0) / 10);
  assert.equal(firstState.markets['epex-de'].freshness, 'fresh');
  assert.equal(firstState.markets['epex-de'].unit, 'EUR / MWh');
  assert.match(firstState.markets['epex-de'].licenseInfo, /CC BY 4\.0/);
  assert.equal(firstState.markets['epex-de'].history.length, 3);
  assert.equal(firstState.markets['n2ex-uk'].freshness, 'not_covered');
  assert.equal(firstState.dataStatus.zoneSync.length, 8);
  assert.ok(Date.parse(requestedSourceEnd) >= Date.now() + 47 * 60 * 60_000);
  assert.equal(firstState.markets['ida-de'].price, null);
  assert.equal(firstState.markets['ida-de'].freshness, 'not_covered');
  assert.equal(firstState.positions.length, 0);

  const refreshResponse = await postJson('/api/refresh?marketId=epex-de', {});
  assert.equal(refreshResponse.status, 200);
  assert.equal((await refreshResponse.json()).refresh.attemptedZones, 8);

  const book = await postJson('/api/trades', { side: 'SELL', quantity: 10, marketId: 'ida-de' });
  assert.equal(book.status, 409);

  const invalidTrade = await postJson('/api/trades', {
    side: 'BUY',
    quantity: 501,
    marketId: 'epex-de'
  });
  assert.equal(invalidTrade.status, 400);

  const database = new DatabaseSync(databaseFile);
  database.prepare('UPDATE feed_sync SET last_success_at = ? WHERE bidding_zone = ?')
    .run(new Date(Date.now() - 60 * 60_000).toISOString(), 'DE-LU');
  const staleTrade = await postJson('/api/trades', {
    side: 'BUY',
    quantity: 10,
    marketId: 'epex-de'
  });
  assert.equal(staleTrade.status, 409);
  database.prepare('UPDATE feed_sync SET last_success_at = ? WHERE bidding_zone = ?')
    .run(new Date().toISOString(), 'DE-LU');

  const tradeResponse = await postJson('/api/trades', {
    side: 'BUY',
    quantity: 10,
    marketId: 'epex-de'
  });
  assert.equal(tradeResponse.status, 201);
  const tradeResult = await tradeResponse.json();
  assert.equal(tradeResult.positions.length, 1);
  assert.equal(tradeResult.trade.qty, 10);
  assert.equal(tradeResult.trade.side, 'BUY');
  assert.ok(Math.abs(Number(tradeResult.trade.px) - (firstState.markets['epex-de'].price + 0.1)) < 0.000001);

  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM markets").get().count, 21);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM market_prices").get().count, 32);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM market_prices WHERE interval_start > ?')
    .get(new Date().toISOString()).count, 8);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM paper_trades").get().count, 1);
  database.close();

  app.kill('SIGTERM');
  await once(app, 'exit');
  await startApp();
  const restoredResponse = await fetch(`${baseUrl}/api/state?marketId=epex-de`);
  const restored = await restoredResponse.json();
  assert.equal(restored.positions.length, 1);
  assert.equal(restored.tradeLog.length, 1);
  assert.ok(restored.markets['epex-de'].price);
});

test('rejects malformed and out-of-range paper-trade requests', async () => {
  const invalidSide = await postJson('/api/trades', {
    side: 'HOLD',
    quantity: 1,
    marketId: 'epex-de'
  });
  assert.equal(invalidSide.status, 400);

  const invalidMarket = await postJson('/api/trades', {
    side: 'BUY',
    quantity: 1,
    marketId: 'unknown'
  });
  assert.equal(invalidMarket.status, 400);
});

test('protects write routes with content type, origin, host, and token checks', async () => {
  const nonJsonContentType = await fetch(`${baseUrl}/api/trades`, {
    method: 'POST',
    headers: { Origin: baseUrl, 'X-CSRF-Token': writeToken, 'Content-Type': 'text/plain' },
    body: '{}'
  });
  assert.equal(nonJsonContentType.status, 415);

  const wrongOrigin = await postJson('/api/trades', {}, { Origin: 'https://attacker.example' });
  assert.equal(wrongOrigin.status, 403);

  const missingToken = await postJson('/api/trades', {}, { 'X-CSRF-Token': '' });
  assert.equal(missingToken.status, 403);

  const wrongHost = await new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/api/refresh',
      method: 'POST',
      headers: {
        Host: `attacker.example:${port}`,
        Origin: baseUrl,
        'Content-Type': 'application/json',
        'X-CSRF-Token': writeToken
      }
    }, (response) => {
      response.resume();
      resolve(response);
    });
    request.on('error', reject);
    request.end('{}');
  });
  assert.equal(wrongHost.statusCode, 403);
});
