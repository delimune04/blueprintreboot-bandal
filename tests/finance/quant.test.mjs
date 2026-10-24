import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PARAMETERS, validateParameters, validatePrices, simulatePaper, publicPerformance } from '../../hosting/finance/quant.mjs';
import { encryptCredentials, decryptCredentials, credentialStorageEnabled, liveEnabled, executeLimitOrder, validateLiveOrder } from '../../hosting/finance/brokers.mjs';
const prices = values => values.map((close, i) => ({ date: new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0, 10), close }));
const p = { ...DEFAULT_PARAMETERS, lookbackDays: 2, rebalanceDays: 1, maxExposure: 1, feeBps: 0, slippageBps: 0 };
test('parameters are bounded and cannot smuggle executable strategy source', () => {
  assert.deepEqual(validateParameters(), DEFAULT_PARAMETERS);
  for (const input of [{ lookbackDays: 1 }, { lookbackDays: 2.5 }, { maxExposure: 1.2 }, { feeBps: -1 }, { execute: 'steal()' }, { defensiveDrawdowns: [.1, .1, .2, .3, .4] }]) assert.throws(() => validateParameters(input));
});
test('prices reject duplicate dates, impossible dates, unsorted data and nonfinite prices', () => {
  const valid = prices([1, 2, 3, 4, 5]); assert.equal(validatePrices(valid).length, 5);
  for (const bad of [[...valid.slice(0, 4), { date: valid[0].date, close: 5 }], valid.map((r, i) => i === 2 ? { ...r, close: Infinity } : r), valid.map((r, i) => i === 0 ? { date: '2025-02-30', close: 1 } : r)]) assert.throws(() => validatePrices(bad));
});
test('signal only executes next close and cannot earn an already observed jump', () => {
  const run = simulatePaper(p, { initialCapital: 10000, prices: prices([100, 100, 200, 400, 400]), dataLabel: 'uploaded' });
  assert.equal(run.trades[0].date, '2025-01-04');
  assert.equal(run.trades[0].price, 400); assert.equal(run.totalReturnPct, 0);
  assert.equal(run.curve[2].exposure, 0);
});
test('appending future prices does not change prior signals, trades or valuations', () => {
  const input = [100, 102, 105, 108, 110, 99, 100, 101, 120, 200];
  const short = simulatePaper(p, { initialCapital: 10000, prices: prices(input.slice(0, 7)) });
  const long = simulatePaper(p, { initialCapital: 10000, prices: prices(input) });
  assert.deepEqual(short.curve, long.curve.slice(0, 7));
  assert.deepEqual(short.trades, long.trades.filter(t => t.date <= '2025-01-07'));
});
test('relative momentum uses a date-aligned benchmark and avoids weaker positive asset', () => {
  const run = simulatePaper(p, { initialCapital: 10000, prices: prices([100, 101, 102, 103, 104]), benchmark: prices([100, 105, 110, 115, 120]) });
  assert.equal(run.trades.length, 0);
  assert.throws(() => simulatePaper(p, { initialCapital: 10000, prices: prices([1, 2, 3, 4, 5]), benchmark: prices([1, 2, 3, 4, 5, 6]) }));
});
test('fees and slippage reduce net results and max exposure is enforced without leverage', () => {
  const values = prices([100, 101, 102, 103, 104, 105, 106, 107]);
  const free = simulatePaper(p, { initialCapital: 10000, prices: values });
  const cost = simulatePaper({ ...p, feeBps: 15, slippageBps: 20 }, { initialCapital: 10000, prices: values });
  assert(cost.finalEquity < free.finalEquity); assert(cost.trades.every(t => t.fee >= 0));
  assert(cost.curve.every(r => r.equity >= 0 && r.exposure >= 0 && r.exposure <= 1.000000001));
});
test('defensive L1-L5 records realized drawdown stages and reduces subsequent exposure', () => {
  const run = simulatePaper({ ...p, momentumThreshold: -.5 }, { initialCapital: 10000, prices: prices([100, 105, 110, 115, 90, 89, 88]) });
  assert(run.maxDrawdownPct > 15); assert(run.curve.some(r => r.defenseLevel === 5));
  assert(run.trades.some(t => t.side === 'sell'));
});
test('zero exposure and flat series remain cash with no invented Sharpe ratio', () => {
  const run = simulatePaper({ ...p, maxExposure: 0 }, { initialCapital: 10000, prices: prices([100, 100, 100, 100, 100]) });
  assert.equal(run.finalEquity, 10000); assert.equal(run.sharpe, null); assert.equal(run.trades.length, 0);
});
test('sharing projects only percentages and dates without capital, positions, parameters or identifiers', () => {
  const run = { ...simulatePaper(p, { initialCapital: 123456789, prices: prices([100, 101, 103, 104, 106]), dataLabel: 'PRIVATE_NAME' }), id: 'SECRET_ID', strategyId: 'SECRET_STRATEGY' };
  const shared = publicPerformance(run), serialized = JSON.stringify(shared);
  assert.equal(shared.dataLabel, 'uploaded');
  for (const privateField of ['123456789', 'SECRET', 'parameters', 'quantity', 'equity', 'initialCapital']) assert(!serialized.includes(privateField));
  assert.equal(shared.type, 'paper');
});
const secret = Buffer.alloc(32, 7).toString('base64'), context = { owner: 'alice', id: 'connection-a', provider: 'upbit' };
test('credential vault uses authenticated encryption bound to owner, record and provider', async () => {
  const values = { accessKey: 'PRIVATE_ACCESS', secretKey: 'PRIVATE_SECRET' };
  const first = await encryptCredentials(values, secret, context), second = await encryptCredentials(values, secret, context);
  assert.notEqual(first, second); assert(!first.includes('PRIVATE'));
  assert.deepEqual(await decryptCredentials(first, secret, context), values);
  for (const changed of [{ ...context, owner: 'bob' }, { ...context, id: 'connection-b' }, { ...context, provider: 'kis' }]) await assert.rejects(() => decryptCredentials(first, secret, changed));
  const tampered = JSON.parse(first); tampered.ciphertext = 'A' + tampered.ciphertext.slice(1); await assert.rejects(() => decryptCredentials(JSON.stringify(tampered), secret, context));
});
test('live support requires all independent operator switches and positive cap', () => {
  assert.equal(credentialStorageEnabled({}), false);
  assert.equal(liveEnabled({ FINANCE_CREDENTIAL_KEY: secret, FINANCE_LIVE_TRADING_ENABLED: 'true' }), false);
  assert.equal(liveEnabled({ FINANCE_CREDENTIAL_KEY: secret, FINANCE_LIVE_TRADING_ENABLED: 'true', FINANCE_BROKER_LIVE_VERIFIED: 'true', FINANCE_MAX_ORDER_KRW: '100000' }), true);
});
test('order validator enforces KRW limit orders, amount cap and per-order confirmation', () => {
  const order = { symbol: 'KRW-BTC', side: 'buy', quantity: .001, limitPrice: 100000000, confirm: true, idempotencyKey: 'request-unique-key-12345' };
  assert.equal(validateLiveOrder('upbit', order, 100000).notional, 100000);
  for (const quantity of [.29, .00000029, 1.23456789, 1e-8]) {
    assert.equal(validateLiveOrder('upbit', { ...order, quantity, limitPrice: 1000 }, 100000).quantity, quantity);
  }
  for (const quantity of [1e-9, .000000291, 1.234567891, .29000000001]) {
    assert.throws(() => validateLiveOrder('upbit', { ...order, quantity, limitPrice: 1000 }, 100000));
  }
  for (const changes of [{ confirm: false }, { limitPrice: 100000001 }, { symbol: 'USDT-BTC' }, { quantity: -.001 }, { quantity: .000000001 }]) assert.throws(() => validateLiveOrder('upbit', { ...order, ...changes }, 100000));
});
test('Upbit adapter signs exact order body and returns only whitelisted order receipt fields', async () => {
  const calls = [];
  const result = await executeLimitOrder('upbit', { accessKey: 'ACCESS', secretKey: 'SECRET' }, { symbol: 'KRW-BTC', side: 'buy', quantity: .001, limitPrice: 100000000, idempotencyKey: 'request-unique-key-12345' }, async (url, init) => {
    calls.push({ url, init }); const body = JSON.parse(init.body), token = init.headers.Authorization.slice(7);
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
    assert.equal(payload.access_key, 'ACCESS'); assert.equal(payload.query_hash_alg, 'SHA512');
    const expected = await crypto.subtle.digest('SHA-512', new TextEncoder().encode(Object.entries(body).map(([k, v]) => `${k}=${v}`).join('&')));
    assert.equal(payload.query_hash, Buffer.from(expected).toString('hex'));
    return Response.json({ uuid: 'order-123', state: 'wait', secret: 'DO_NOT_RETURN' });
  });
  assert.equal(calls.length, 1); assert.equal(calls[0].url, 'https://api.upbit.com/v1/orders');
  assert.equal(JSON.parse(calls[0].init.body).ord_type, 'limit'); assert.equal(result.filled, false); assert(!JSON.stringify(result).includes('DO_NOT_RETURN'));
});
test('KIS adapter uses cash-only current official TR IDs and fixed provider host', async () => {
  const calls = [];
  const result = await executeLimitOrder('kis', { appKey: 'APP', appSecret: 'SECRET', accountNumber: '12345678', accountProductCode: '01' }, { symbol: '005930', side: 'buy', quantity: 1, limitPrice: 70000 }, async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/tokenP')) return Response.json({ access_token: 'TOKEN' });
    if (url.endsWith('/hashkey')) return Response.json({ HASH: 'HASH' });
    assert.equal(init.headers.tr_id, 'TTTC0012U'); assert.equal(JSON.parse(init.body).ORD_DVSN, '00');
    return Response.json({ rt_cd: '0', output: { ODNO: 'ORDER' } });
  });
  assert.equal(result.providerOrderId, 'ORDER'); assert.equal(result.filled, false); assert.equal(calls.length, 3);
  assert(calls.every(c => c.url.startsWith('https://openapi.koreainvestment.com:9443/')));
});

test('Upbit serializes the smallest quantity and exponent prices as exact decimal strings before hashing', async () => {
  await executeLimitOrder('upbit', { accessKey: 'ACCESS', secretKey: 'SECRET' }, { symbol: 'KRW-BTC', side: 'buy', quantity: 1e-8, limitPrice: 1e-9, idempotencyKey: 'request-small-quantity-12345' }, async (url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.volume, '0.00000001');
    assert.equal(body.price, '0.000000001');
    const payload = JSON.parse(Buffer.from(init.headers.Authorization.slice(7).split('.')[1], 'base64url'));
    const expected = await crypto.subtle.digest('SHA-512', new TextEncoder().encode(Object.entries(body).map(([k, v]) => `${k}=${v}`).join('&')));
    assert.equal(payload.query_hash, Buffer.from(expected).toString('hex'));
    return Response.json({ uuid: 'SMALL_ORDER', state: 'wait' });
  });
});
