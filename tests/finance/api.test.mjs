import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { handleFinanceApi } from '../../hosting/finance/api.mjs';
const accountKey = user => createHash('sha256').update('finance:' + user).digest('hex').slice(0, 24);
const fullOwner = user => createHash('sha256').update('finance:' + user).digest('hex');
const secret = Buffer.alloc(32, 5).toString('base64');
function environment(extra = {}) {
  const db = new DatabaseSync(':memory:');
  const root = new URL('../../hosting/drizzle/', import.meta.url);
  for (const name of readdirSync(root).filter(n => n.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(name, root), 'utf8'));
  return { sql: db, FINANCE_CREDENTIAL_KEY: secret, LABVIUM_DB: { prepare(query) { return { values: [], bind(...v) { this.values = v; return this; }, async first() { return db.prepare(query).get(...this.values) || null; }, async all() { return { results: db.prepare(query).all(...this.values) }; }, async run() { return { meta: { changes: Number(db.prepare(query).run(...this.values).changes) } }; } }; } }, ...extra };
}
async function call(env, path, { user = 'alice', account = user ? accountKey(user) : null, method = 'GET', body, headers = {} } = {}) {
  const request = new Request('https://bandal.app/finance/api/' + path, { method, headers: { ...(user ? { 'oai-authenticated-user-id': user } : {}), ...(account ? { 'X-Finance-Account': account } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const response = await handleFinanceApi(request, env);
  return { response, status: response.status, data: await response.json() };
}
const parameters = { lookbackDays: 2, rebalanceDays: 1, momentumThreshold: 0, maxExposure: .9, defensiveDrawdowns: [.03, .06, .09, .12, .15], feeBps: 15, slippageBps: 5 };
const prices = [100, 102, 104, 106, 108, 110].map((close, i) => ({ date: `2025-01-0${i + 1}`, close }));
async function strategy(env, user = 'alice') {
  const r = await call(env, 'strategies', { user, method: 'POST', body: { name: 'PRIVATE_STRATEGY_87654321', parameters, owner: 'bob' } });
  assert.equal(r.status, 201, JSON.stringify(r.data)); return r.data.strategy;
}
async function run(env, s, user = 'alice', dataLabel = 'uploaded') {
  const r = await call(env, `strategies/${s.id}/paper`, { user, method: 'POST', body: { initialCapital: 87654321, prices, dataLabel } });
  assert.equal(r.status, 201, JSON.stringify(r.data)); return r.data.run;
}
async function connection(env, user = 'alice') {
  const r = await call(env, 'connections', { user, method: 'POST', body: { provider: 'upbit', label: 'PRIVATE_ACCOUNT', credentials: { accessKey: 'PRIVATE_ACCESS_KEY', secretKey: 'PRIVATE_SECRET_KEY' } } });
  assert.equal(r.status, 201, JSON.stringify(r.data)); return r.data.connection;
}
async function share(env, r, user = 'alice') {
  const res = await call(env, `runs/${r.id}/share`, { user, method: 'POST', body: { days: 7, confirm: true, payload: { secret: 'DO_NOT_SHARE' } } });
  assert.equal(res.status, 201, JSON.stringify(res.data)); return { ...res.data, token: new URL(res.data.url).searchParams.get('share') };
}
test('session exposes no strategies, owner digest, credentials or another owner runner configuration', async () => {
  const env = environment({ FINANCE_QUANT_RUNNER_URL: 'https://private.example', FINANCE_QUANT_RUNNER_OWNER: fullOwner('alice') });
  const anon = await call(env, 'session', { user: null }); assert.equal(anon.data.authenticated, false); assert.equal(anon.data.liveEnabled, false);
  const bob = await call(env, 'session', { user: 'bob' }); assert.equal(bob.data.user.key, accountKey('bob')); assert.equal(bob.data.credentialStorageEnabled, true);
  const serialized = JSON.stringify(bob.data); for (const secret of ['private.example', fullOwner('bob'), 'quantRunnerConfigured', 'credentials', 'strategies']) assert(!serialized.includes(secret));
});
test('anonymous private reads, writes, runs, accounts and result endpoints are rejected', async () => {
  const env = environment(), s = await strategy(env), r = await run(env, s), c = await connection(env);
  for (const path of ['strategies', `strategies/${s.id}`, 'runs', `runs/${r.id}`, 'connections', 'shares', 'orders', 'runner/config']) assert.equal((await call(env, path, { user: null })).status, 401, path);
  assert.equal((await call(env, `strategies/${s.id}/paper`, { user: null, method: 'POST', body: { initialCapital: 1000, prices } })).status, 401);
  assert.equal((await call(env, `connections/${c.id}`, { user: null, method: 'DELETE' })).status, 401);
});
test('strategies, results and accounts are owner scoped even with forged owner query/body', async () => {
  const env = environment(), s = await strategy(env), r = await run(env, s), c = await connection(env);
  assert.equal((await call(env, 'strategies?owner=alice', { user: 'bob' })).data.strategies.length, 0);
  assert.equal((await call(env, 'runs?owner=alice', { user: 'bob' })).data.runs.length, 0);
  assert.equal((await call(env, 'connections?owner=alice', { user: 'bob' })).data.connections.length, 0);
  for (const [path, method, body] of [[`strategies/${s.id}`, 'GET'], [`strategies/${s.id}`, 'PUT', { revision: 1, name: 'HACK', parameters, owner: 'alice' }], [`strategies/${s.id}`, 'DELETE'], [`strategies/${s.id}/paper`, 'POST', { initialCapital: 1000, prices }], [`runs/${r.id}`, 'GET'], [`runs/${r.id}/share`, 'POST', { confirm: true, days: 7 }], [`connections/${c.id}`, 'DELETE']]) assert.equal((await call(env, path, { user: 'bob', method, body })).status, 404, path);
  assert.equal((await call(env, `strategies/${s.id}`)).data.strategy.name, s.name);
});
test('strategy revision CAS rejects stale devices and preserves newer parameters', async () => {
  const env = environment(), s = await strategy(env);
  const updated = await call(env, `strategies/${s.id}`, { method: 'PUT', body: { revision: 1, name: 'NEW', parameters: { ...parameters, maxExposure: .5 } } });
  assert.equal(updated.data.strategy.revision, 2);
  const stale = await call(env, `strategies/${s.id}`, { method: 'PUT', body: { revision: 1, name: 'OLD', parameters } });
  assert.equal(stale.status, 409); assert.equal((await call(env, `strategies/${s.id}`)).data.strategy.parameters.maxExposure, .5);
});
test('account switches reject every private read/mutation before touching another account', async () => {
  const env = environment(), s = await strategy(env), r = await run(env, s), c = await connection(env), shared = await share(env, r);
  const options = { user: 'bob', account: accountKey('alice') };
  for (const [path, method, body] of [['strategies', 'GET'], ['runs', 'GET'], ['connections', 'GET'], ['shares', 'GET'], ['orders', 'GET'], ['runner/config', 'GET'], ['runner/pair', 'POST', { pairingCode: '12345678', confirmReplaceDevice: true }], [`strategies/${s.id}`, 'PUT', { revision: 1, name: 'MIXED', parameters }], [`strategies/${s.id}/paper`, 'POST', { initialCapital: 1000, prices }], [`runs/${r.id}/share`, 'POST', { confirm: true, days: 7 }], [`shares/${shared.id}/revoke`, 'POST', {}], [`connections/${c.id}`, 'DELETE']]) {
    const result = await call(env, path, { ...options, method, body }); assert.equal(result.status, 409, path); assert.equal(result.data.code, 'ACCOUNT_CHANGED');
  }
  assert.equal((await call(env, `shared/${shared.token}`, options)).status, 200);
  assert.equal((await call(env, 'strategies', { user: 'bob' })).data.strategies.length, 0);
});
test('all mutations reject foreign origins, same-site siblings and non-JSON body types', async () => {
  const env = environment();
  for (const headers of [{ Origin: 'https://evil.example' }, { 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'same-site' }]) {
    assert.equal((await call(env, 'strategies', { method: 'POST', body: { name: 'x', parameters }, headers })).status, 403);
    assert.equal((await call(env, 'runner/pair', { method: 'POST', body: { pairingCode: '12345678' }, headers })).status, 403);
  }
  assert.equal((await call(env, 'strategies', { method: 'POST', body: { name: 'x', parameters }, headers: { 'Content-Type': 'application/jsonx' } })).status, 415);
});
test('private responses are never cacheable and error responses do not leak account state', async () => {
  const env = environment(), s = await strategy(env);
  for (const path of ['session', 'strategies', `strategies/${s.id}`, 'connections']) {
    const result = await call(env, path); assert(result.response.headers.get('cache-control').includes('no-store')); assert(result.response.headers.get('vary').includes('oai-authenticated-user-id'));
  }
  const error = await call(env, `strategies/${s.id}`, { user: 'bob' }); assert(!JSON.stringify(error.data).includes('PRIVATE'));
});
test('paper execution persists real computed results and own list omits bulky private detail', async () => {
  const env = environment(), s = await strategy(env), r = await run(env, s);
  assert.equal(r.type, 'paper'); assert(r.curve.length === prices.length); assert(r.trades.length > 0); assert.equal(r.methodology.privateQuantImported, false);
  const stored = await call(env, `runs/${r.id}`); assert.deepEqual(stored.data.run, r);
  const list = await call(env, 'runs'); assert.equal(list.data.runs[0].id, r.id); assert.equal(Object.hasOwn(list.data.runs[0], 'curve'), false);
  const deleted = await call(env, `strategies/${s.id}`, { method: 'DELETE' }); assert.equal(deleted.status, 200); assert.equal((await call(env, `runs/${r.id}`)).status, 200);
});
test('public sharing requires explicit confirmation and server-generates a secret-free projection', async () => {
  const env = environment(), s = await strategy(env), r = await run(env, s);
  assert.equal((await call(env, `runs/${r.id}/share`, { method: 'POST', body: { confirm: false, days: 7 } })).status, 422);
  const shared = await share(env, r), publicRead = await call(env, `shared/${shared.token}`, { user: null });
  assert.equal(publicRead.status, 200); assert.equal(publicRead.data.payload.type, 'paper');
  for (const value of [s.id, r.id, 'PRIVATE', '87654321', 'DO_NOT_SHARE', 'parameters', 'quantity', 'equity', 'owner_key']) assert(!JSON.stringify(publicRead.data).includes(value), value);
  const list = await call(env, 'shares'); assert.equal(list.data.shares[0].id, shared.id); assert(!JSON.stringify(list.data).includes(shared.token));
  assert.equal((await call(env, 'shares', { user: 'bob' })).data.shares.length, 0);
});
test('share revocation is owner-only, immediate and expired links fail closed', async () => {
  const env = environment(), s = await strategy(env), r = await run(env, s), shared = await share(env, r);
  assert.equal((await call(env, `shares/${shared.id}/revoke`, { user: 'bob', method: 'POST', body: {} })).status, 404);
  assert.equal((await call(env, `shares/${shared.id}/revoke`, { method: 'POST', body: {} })).status, 200);
  assert.equal((await call(env, `shared/${shared.token}`, { user: null })).status, 404);
  const second = await share(env, r); env.sql.prepare('UPDATE finance_shares SET expires_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z', second.id);
  assert.equal((await call(env, `shared/${second.token}`, { user: null })).status, 404);
});
test('connection storage is encrypted, never readable as plaintext, isolated and removable', async () => {
  const env = environment(), c = await connection(env);
  const stored = env.sql.prepare('SELECT credentials_json FROM finance_connections WHERE id=?').get(c.id);
  assert(!stored.credentials_json.includes('PRIVATE_'));
  const list = await call(env, 'connections'); assert.equal(list.data.connections[0].status, 'stored_unverified'); assert(!JSON.stringify(list.data).includes('KEY'));
  assert.equal((await call(env, `connections/${c.id}`, { user: 'bob', method: 'DELETE' })).status, 404);
  assert.equal((await call(env, `connections/${c.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await call(env, 'connections')).data.connections.length, 0);
});
test('absent vault configuration fails closed without storing any credential material', async () => {
  const env = environment({ FINANCE_CREDENTIAL_KEY: undefined });
  const r = await call(env, 'connections', { method: 'POST', body: { provider: 'upbit', credentials: { accessKey: 'PRIVATE_ACCESS', secretKey: 'PRIVATE_SECRET' } } });
  assert.equal(r.status, 503); assert.equal(env.sql.prepare('SELECT COUNT(*) n FROM finance_connections').get().n, 0);
});
test('live execution defaults closed and never calls any broker even with saved account/paper run', async () => {
  let calls = 0;
  const env = environment({ FINANCE_FETCH: async () => { calls++; throw new Error('not allowed'); } }), s = await strategy(env), c = await connection(env); await run(env, s);
  const r = await call(env, `strategies/${s.id}/live-order`, { method: 'POST', body: { connectionId: c.id, symbol: 'KRW-BTC', side: 'buy', quantity: .001, limitPrice: 100000000, confirm: true, idempotencyKey: 'request-unique-key-12345' } });
  assert.equal(r.status, 503); assert.equal(r.data.code, 'LIVE_DISABLED'); assert.equal(calls, 0); assert.equal(env.sql.prepare('SELECT COUNT(*) n FROM finance_orders').get().n, 0);
});
function liveEnvironment(fetcher) { return environment({ FINANCE_LIVE_TRADING_ENABLED: 'true', FINANCE_BROKER_LIVE_VERIFIED: 'true', FINANCE_MAX_ORDER_KRW: '100000', FINANCE_FETCH: fetcher }); }
test('enabled adapter still requires own connection, explicit confirmation and current-version uploaded-data paper run', async () => {
  let calls = 0;
  const env = liveEnvironment(async () => { calls++; return Response.json({ uuid: 'ORDER', state: 'wait' }); }), s = await strategy(env), c = await connection(env);
  const input = { connectionId: c.id, symbol: 'KRW-BTC', side: 'buy', quantity: .001, limitPrice: 100000000, confirm: true, idempotencyKey: 'request-unique-key-12345' };
  assert.equal((await call(env, `strategies/${s.id}/live-order`, { method: 'POST', body: input })).status, 422);
  await run(env, s, 'alice', 'sample'); assert.equal((await call(env, `strategies/${s.id}/live-order`, { method: 'POST', body: input })).status, 422);
  await run(env, s); assert.equal((await call(env, `strategies/${s.id}/live-order`, { method: 'POST', body: { ...input, confirm: false } })).status, 422);
  const bob = await strategy(env, 'bob'); await run(env, bob, 'bob'); assert.equal((await call(env, `strategies/${bob.id}/live-order`, { user: 'bob', method: 'POST', body: input })).status, 404);
  assert.equal(calls, 0);
});
test('explicit limit order dispatch is idempotent and never marks broker acceptance as fill', async () => {
  let calls = 0;
  const env = liveEnvironment(async () => { calls++; return Response.json({ uuid: 'ORDER', state: 'wait', secret: 'PRIVATE_BROKER_DATA' }); }), s = await strategy(env), c = await connection(env); await run(env, s);
  const input = { connectionId: c.id, symbol: 'KRW-BTC', side: 'buy', quantity: .001, limitPrice: 100000000, confirm: true, idempotencyKey: 'request-unique-key-12345' };
  const first = await call(env, `strategies/${s.id}/live-order`, { method: 'POST', body: input }); assert.equal(first.status, 201); assert.equal(first.data.order.status, 'submitted'); assert.equal(first.data.order.filled, false);
  const second = await call(env, `strategies/${s.id}/live-order`, { method: 'POST', body: input }); assert.equal(second.data.duplicate, true); assert.equal(calls, 1);
  assert.equal((await call(env, `strategies/${s.id}/live-order`, { method: 'POST', body: { ...input, quantity: .0005 } })).status, 409);
  assert(!JSON.stringify((await call(env, 'orders')).data).includes('PRIVATE_BROKER_DATA')); assert.equal((await call(env, 'orders', { user: 'bob' })).data.orders.length, 0);
});
test('broker timeout leaves unknown outcome and identical retries cannot duplicate an order', async () => {
  let calls = 0;
  const env = liveEnvironment(async () => { calls++; throw new Error('timeout with PRIVATE_SECRET'); }), s = await strategy(env), c = await connection(env); await run(env, s);
  const input = { connectionId: c.id, symbol: 'KRW-BTC', side: 'buy', quantity: .001, limitPrice: 100000000, confirm: true, idempotencyKey: 'request-unique-key-12345' };
  const first = await call(env, `strategies/${s.id}/live-order`, { method: 'POST', body: input }); assert.equal(first.status, 502); assert.equal(first.data.order.status, 'unknown'); assert(!JSON.stringify(first.data).includes('PRIVATE'));
  const retry = await call(env, `strategies/${s.id}/live-order`, { method: 'POST', body: input }); assert.equal(retry.data.order.status, 'unknown'); assert.equal(calls, 1);
});
test('tampered or transplanted encrypted credentials stop execution before network calls', async () => {
  let calls = 0;
  const env = liveEnvironment(async () => { calls++; return Response.json({ uuid: 'ORDER' }); }), s = await strategy(env), c = await connection(env); await run(env, s);
  const row = env.sql.prepare('SELECT credentials_json FROM finance_connections WHERE id=?').get(c.id), envelope = JSON.parse(row.credentials_json); envelope.ciphertext = envelope.ciphertext.slice(1) + 'A';
  env.sql.prepare('UPDATE finance_connections SET credentials_json=? WHERE id=?').run(JSON.stringify(envelope), c.id);
  const r = await call(env, `strategies/${s.id}/live-order`, { method: 'POST', body: { connectionId: c.id, symbol: 'KRW-BTC', side: 'buy', quantity: .001, limitPrice: 100000000, confirm: true, idempotencyKey: 'request-unique-key-12345' } });
  assert.equal(r.status, 503); assert.equal(calls, 0);
});
