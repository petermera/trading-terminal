const DEFAULT_STALE_MS = 60 * 60 * 1000;

export const MODEL_STATUS = Object.freeze({
  SIMULATED: 'simulated',
  LIVE: 'live'
});

export const MARK_STATUS = Object.freeze({
  FRESH: 'fresh',
  STALE: 'stale',
  MISSING: 'missing'
});

export function createBaseModel(overrides = {}) {
  const createdAt = overrides.createdAt ?? new Date().toISOString();

  return {
    modelVersion: '1.0.0',
    portfolio: {
      id: overrides.portfolioId ?? 'paper-portfolio',
      name: overrides.name ?? 'Paper Trading Portfolio',
      status: overrides.status ?? MODEL_STATUS.SIMULATED,
      createdAt,
      updatedAt: overrides.updatedAt ?? createdAt
    },
    orders: [],
    fills: [],
    positionLots: [],
    observations: [],
    marketMarks: {},
    ...overrides,
    portfolio: {
      id: overrides.portfolioId ?? 'paper-portfolio',
      name: overrides.name ?? 'Paper Trading Portfolio',
      status: overrides.status ?? MODEL_STATUS.SIMULATED,
      createdAt,
      updatedAt: overrides.updatedAt ?? createdAt,
      ...(overrides.portfolio ?? {})
    }
  };
}

export function createOrder({
  id,
  portfolioId,
  side,
  quantity,
  price,
  market,
  product,
  currency = 'EUR',
  unit = 'MWh',
  status = 'open',
  createdAt = new Date().toISOString(),
  lifecycleStatus = 'submitted'
}) {
  return {
    id: id ?? `order-${cryptoRandomId()}`,
    portfolioId,
    side,
    quantity,
    price,
    market,
    product,
    currency,
    unit,
    status,
    lifecycleStatus,
    createdAt
  };
}

export function createFill({
  id,
  orderId,
  portfolioId,
  side,
  quantity,
  price,
  market,
  product,
  currency = 'EUR',
  unit = 'MWh',
  status = 'filled',
  timestamp = new Date().toISOString(),
  lifecycleStatus = 'filled'
}) {
  return {
    id: id ?? `fill-${cryptoRandomId()}`,
    orderId,
    portfolioId,
    side,
    quantity,
    price,
    market,
    product,
    currency,
    unit,
    status,
    lifecycleStatus,
    timestamp
  };
}

export function addFill(model, fill) {
  if (!model || !Array.isArray(model.fills)) {
    throw new Error('A valid trading model is required.');
  }

  const normalizedFill = {
    ...createFill(fill),
    portfolioId: fill.portfolioId ?? model.portfolio.id
  };

  model.fills.push(normalizedFill);
  model.positionLots.push({
    id: `lot-${cryptoRandomId()}`,
    portfolioId: normalizedFill.portfolioId,
    market: normalizedFill.market,
    product: normalizedFill.product,
    side: normalizedFill.side === 'buy' ? 'long' : 'short',
    quantity: normalizedFill.quantity,
    averagePrice: normalizedFill.price,
    currency: normalizedFill.currency,
    unit: normalizedFill.unit,
    status: 'open',
    lifecycleStatus: 'open',
    openedAt: normalizedFill.timestamp,
    lastUpdated: normalizedFill.timestamp
  });

  model.portfolio.updatedAt = new Date().toISOString();
  return normalizedFill;
}

export function upsertMarketMark(model, mark) {
  const key = `${mark.market}:${mark.product}`;
  const normalizedMark = {
    ...mark,
    market: mark.market,
    product: mark.product,
    currency: mark.currency ?? 'EUR',
    unit: mark.unit ?? 'MWh',
    source: mark.source ?? 'simulated',
    timestamp: mark.timestamp ?? new Date().toISOString(),
    staleAfterMs: mark.staleAfterMs ?? DEFAULT_STALE_MS
  };

  model.marketMarks[key] = normalizedMark;
  model.portfolio.updatedAt = new Date().toISOString();
  return normalizedMark;
}

export function getMarketMark(model, market, product) {
  if (!model || !model.marketMarks) {
    return null;
  }

  return model.marketMarks[`${market}:${product}`] ?? null;
}

export function evaluateMarkStatus(mark, valuationTime = new Date().toISOString(), staleAfterMs = DEFAULT_STALE_MS) {
  if (!mark) {
    return {
      status: MARK_STATUS.MISSING,
      price: null,
      timestamp: null,
      staleAfterMs
    };
  }

  const valuationTimestamp = Date.parse(valuationTime);
  const markTimestamp = Date.parse(mark.timestamp);

  if (Number.isNaN(valuationTimestamp) || Number.isNaN(markTimestamp)) {
    return {
      status: MARK_STATUS.MISSING,
      price: mark.price ?? null,
      timestamp: mark.timestamp ?? null,
      staleAfterMs: mark.staleAfterMs ?? staleAfterMs
    };
  }

  const ageMs = Math.max(0, valuationTimestamp - markTimestamp);
  const status = ageMs > (mark.staleAfterMs ?? staleAfterMs) ? MARK_STATUS.STALE : MARK_STATUS.FRESH;

  return {
    status,
    price: mark.price,
    timestamp: mark.timestamp,
    staleAfterMs: mark.staleAfterMs ?? staleAfterMs,
    ageMs
  };
}

export function buildTradeLog(model) {
  return [...(model.fills ?? [])].sort((left, right) => {
    return new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime();
  });
}

export function buildOpenPositions(model, valuationTime = new Date().toISOString()) {
  const lotsByKey = new Map();

  for (const lot of model.positionLots ?? []) {
    const key = `${lot.market}:${lot.product}:${lot.side}`;
    if (!lotsByKey.has(key)) {
      lotsByKey.set(key, []);
    }

    lotsByKey.get(key).push(lot);
  }

  return Array.from(lotsByKey.entries()).map(([key, lots]) => {
    const [market, product, side] = key.split(':');
    const quantity = lots.reduce((total, lot) => total + Number(lot.quantity), 0);
    const weightedAverage = lots.reduce((total, lot) => total + Number(lot.averagePrice) * Number(lot.quantity), 0) / quantity;
    const mark = getMarketMark(model, market, product);
    const markEvaluation = evaluateMarkStatus(mark, valuationTime, mark?.staleAfterMs ?? DEFAULT_STALE_MS);

    return {
      id: `${market}-${product}-${side}`,
      market,
      product,
      side,
      quantity,
      averagePrice: weightedAverage,
      currency: lots[0].currency,
      unit: lots[0].unit,
      markPrice: mark?.price ?? null,
      markStatus: markEvaluation.status,
      pnl: determinePositionPnl({
        side,
        quantity,
        averagePrice: weightedAverage,
        markPrice: mark?.price ?? null,
        markStatus: markEvaluation.status
      }),
      lifecycleStatus: quantity > 0 ? 'open' : 'closed'
    };
  });
}

export function determinePositionPnl({ side, quantity, averagePrice, markPrice, markStatus }) {
  if (markStatus === MARK_STATUS.MISSING || markStatus === MARK_STATUS.STALE || markPrice === null || averagePrice === null) {
    return null;
  }

  if (side === 'long') {
    return (markPrice - averagePrice) * quantity;
  }

  return (averagePrice - markPrice) * quantity;
}

export function buildSessionKpis(model, valuationTime = new Date().toISOString()) {
  const openPositions = buildOpenPositions(model, valuationTime);
  const tradeLog = buildTradeLog(model);
  const totalVolume = tradeLog.reduce((total, fill) => total + Number(fill.quantity), 0);
  const totalPnl = openPositions.reduce((total, position) => total + (position.pnl ?? 0), 0);

  return {
    openPositionCount: openPositions.length,
    totalVolume,
    totalPnl,
    netExposure: openPositions.reduce((total, position) => {
      return total + (position.side === 'long' ? position.quantity : -position.quantity);
    }, 0),
    staleOrMissingMarks: openPositions.filter((position) => position.markStatus !== MARK_STATUS.FRESH).length,
    valuationTime
  };
}

export function buildDashboardReadModel(model, valuationTime = new Date().toISOString()) {
  const openPositions = buildOpenPositions(model, valuationTime);
  const tradeLog = buildTradeLog(model);
  const sessionKpis = buildSessionKpis(model, valuationTime);

  return {
    portfolio: {
      id: model.portfolio.id,
      name: model.portfolio.name,
      status: model.portfolio.status
    },
    openPositions,
    tradeLog,
    sessionKpis,
    marketStatusSummary: {
      fresh: Object.values(model.marketMarks ?? {}).filter((mark) => evaluateMarkStatus(mark, valuationTime).status === MARK_STATUS.FRESH).length,
      stale: Object.values(model.marketMarks ?? {}).filter((mark) => evaluateMarkStatus(mark, valuationTime).status === MARK_STATUS.STALE).length,
      missing: Object.values(model.marketMarks ?? {}).filter((mark) => evaluateMarkStatus(mark, valuationTime).status === MARK_STATUS.MISSING).length,
      total: Object.keys(model.marketMarks ?? {}).length
    }
  };
}

function cryptoRandomId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
