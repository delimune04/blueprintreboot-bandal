import { DEFAULT_PARAMETERS, validateParameters, simulatePaper, publicPerformance } from './quant.mjs';
import { credentialStorageEnabled, liveEnabled, encryptCredentials, decryptCredentials, validateCredentials, validateLiveOrder, executeLimitOrder } from './brokers.mjs';
import { handleResearchRequest } from './research.mjs';
import { handleRunnerRequest } from './runner.mjs';
const PREFIX = '/finance/api';
const LIMIT = 900000;
const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie, oai-authenticated-user-id', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } });
const fail = (status, message, code) => { throw Object.assign(new Error(message), { status, code }); };
const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(n => n.toString(16).padStart(2, '0')).join('');
const now = () => new Date().toISOString();
function displayName(request) {
  let value = request.headers.get('oai-authenticated-user-full-name') || '';
  try { if (request.headers.get('oai-authenticated-user-full-name-encoding') === 'percent-encoded-utf-8') value = decodeURIComponent(value); } catch { value = ''; }
  return value.slice(0, 80) || '나의 계정';
}
function checkOrigin(request) {
  const origin = request.headers.get('origin'), site = request.headers.get('sec-fetch-site');
  if ((origin && origin !== new URL(request.url).origin) || site === 'cross-site' || site === 'same-site') fail(403, '이 사이트에서 다시 시도해 주세요.');
}
async function readBody(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) fail(415, 'JSON 입력이 필요해요.');
  if (Number(request.headers.get('content-length')) > LIMIT) fail(413, '입력 데이터가 너무 커요.');
  const reader = request.body?.getReader(); if (!reader) fail(422, '입력 내용이 없어요.');
  const chunks = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.length; if (size > LIMIT) { await reader.cancel(); fail(413, '입력 데이터가 너무 커요.'); } chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let data; try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { fail(422, 'JSON을 읽을 수 없어요.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail(422, '입력 형식을 확인해 주세요.');
  return data;
}
function title(value, fallback) {
  if (value === undefined && fallback) return fallback;
  if (typeof value !== 'string' || !value.trim() || value.length > 80 || /[\u0000-\u001f]/.test(value)) fail(422, '이름은 1~80자로 입력해 주세요.');
  return value.trim();
}
const strategyView = row => ({ id: row.id, name: row.name, parameters: JSON.parse(row.parameters_json), revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at });
async function ownedStrategy(db, owner, id) {
  const row = await db.prepare('SELECT id,name,parameters_json,revision,created_at,updated_at FROM finance_strategies WHERE id=? AND owner_key=?').bind(id, owner).first();
  if (!row) fail(404, '전략을 찾을 수 없어요.'); return row;
}
async function ownedRun(db, owner, id) {
  const row = await db.prepare('SELECT id,strategy_id,result_json,created_at FROM finance_runs WHERE id=? AND owner_key=?').bind(id, owner).first();
  if (!row) fail(404, '모의투자 결과를 찾을 수 없어요.'); return JSON.parse(row.result_json);
}
const connectionView = row => ({ id: row.id, provider: row.provider, label: row.label, createdAt: row.created_at, status: 'stored_unverified' });
export async function handleFinanceApi(request, env) {
  try {
    const url = new URL(request.url), path = url.pathname.slice(PREFIX.length).replace(/^\//, ''), method = request.method;
    const rawUser = request.headers.get('oai-authenticated-user-id');
    const owner = rawUser ? await digest('finance:' + rawUser) : null;
    const account = owner?.slice(0, 24);
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: { Allow: 'GET,POST,PUT,DELETE,OPTIONS', 'Cache-Control': 'no-store' } });
    if (!['GET', 'HEAD'].includes(method)) { checkOrigin(request); if (!owner) fail(401, '로그인한 계정에서만 사용할 수 있어요.'); }
    if (path === 'session' && method === 'GET') return json({ authenticated: !!owner, user: owner ? { key: account, name: displayName(request) } : null,
      signInUrl: '/signin-with-chatgpt?return_to=%2Ffinance%2F', signOutUrl: '/signout-with-chatgpt?return_to=%2Ffinance%2F',
      liveEnabled: liveEnabled(env), credentialStorageEnabled: credentialStorageEnabled(env), defaultParameters: DEFAULT_PARAMETERS,
      privateQuantImported: false });
    if (/^companies\//.test(path)) {
      const response = await handleResearchRequest(request, env, path); if (response) return response;
    }
    const shared = /^shared\/([A-Za-z0-9_-]{32})$/.exec(path);
    if (!shared && path !== 'health') {
      // Authentication comes only from Sites dispatch. The extra key prevents a
      // stale Alice tab from writing Alice's loaded data into Bob's new session.
      if (!owner) fail(401, '전략과 계좌는 로그인한 본인만 열 수 있어요.');
      if (request.headers.get('x-finance-account') !== account) fail(409, '로그인 계정이 바뀌었어요. 페이지를 새로 열어 주세요.', 'ACCOUNT_CHANGED');
    }
    if (!env.LABVIUM_DB?.prepare) fail(503, '계정 저장 공간을 준비하고 있어요.');
    const db = env.LABVIUM_DB;
    if (path === 'health' && method === 'GET') {
      await db.prepare('SELECT 1 FROM finance_strategies LIMIT 1').first();
      return json({ ok: true, version: 1, liveEnabled: liveEnabled(env) });
    }
    if (shared && method === 'GET') {
      const row = await db.prepare('SELECT payload_json,expires_at,revoked_at FROM finance_shares WHERE token_hash=?').bind(await digest(shared[1])).first();
      if (!row || row.revoked_at || row.expires_at <= now()) fail(404, '종료되었거나 만료된 공유 링크예요.');
      return json({ payload: JSON.parse(row.payload_json), expiresAt: row.expires_at });
    }
    if (path === 'runner' || path.startsWith('runner/')) {
      const response = await handleRunnerRequest(request, env, path, { owner, account, db, readBody });
      if (response) return response;
    }
    if (path === 'strategies') {
      if (method === 'GET') {
        const rows = await db.prepare('SELECT id,name,parameters_json,revision,created_at,updated_at FROM finance_strategies WHERE owner_key=? ORDER BY updated_at DESC LIMIT 30').bind(owner).all();
        return json({ strategies: rows.results.map(strategyView) });
      }
      if (method === 'POST') {
        const b = await readBody(request), name = title(b.name), parameters = validateParameters(b.parameters), id = crypto.randomUUID(), created = now();
        const result = await db.prepare('INSERT INTO finance_strategies(id,owner_key,name,parameters_json,revision,created_at,updated_at) SELECT ?,?,?,?,1,?,? WHERE (SELECT COUNT(*) FROM finance_strategies WHERE owner_key=?)<30').bind(id, owner, name, JSON.stringify(parameters), created, created, owner).run();
        if (!result.meta?.changes) fail(429, '전략은 계정당 30개까지 저장할 수 있어요.');
        return json({ strategy: { id, name, parameters, revision: 1, createdAt: created, updatedAt: created } }, 201);
      }
    }
    const strategy = /^strategies\/([A-Za-z0-9_-]+)$/.exec(path);
    if (strategy) {
      const row = await ownedStrategy(db, owner, strategy[1]);
      if (method === 'GET') return json({ strategy: strategyView(row) });
      if (method === 'PUT') {
        const b = await readBody(request); if (!Number.isInteger(b.revision) || b.revision < 1) fail(422, '저장 버전을 확인해 주세요.');
        const name = title(b.name), parameters = validateParameters(b.parameters), updated = now();
        const result = await db.prepare('UPDATE finance_strategies SET name=?,parameters_json=?,revision=revision+1,updated_at=? WHERE id=? AND owner_key=? AND revision=?').bind(name, JSON.stringify(parameters), updated, row.id, owner, b.revision).run();
        if (!result.meta?.changes) fail(409, '다른 기기에서 수정했어요. 최신 전략을 다시 불러와 주세요.');
        return json({ strategy: { id: row.id, name, parameters, revision: b.revision + 1, createdAt: row.created_at, updatedAt: updated } });
      }
      if (method === 'DELETE') {
        await db.prepare('DELETE FROM finance_strategies WHERE id=? AND owner_key=?').bind(row.id, owner).run();
        return json({ deleted: true, preservedRunHistory: true });
      }
    }
    const paper = /^strategies\/([A-Za-z0-9_-]+)\/paper$/.exec(path);
    if (paper && method === 'POST') {
      const row = await ownedStrategy(db, owner, paper[1]), input = await readBody(request);
      const result = simulatePaper(JSON.parse(row.parameters_json), input);
      const id = crypto.randomUUID(), created = now(), run = { ...result, id, strategyId: row.id, strategyRevision: row.revision, createdAt: created };
      const inserted = await db.prepare('INSERT INTO finance_runs(id,owner_key,strategy_id,result_json,created_at) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM finance_runs WHERE owner_key=? AND created_at>?)<50').bind(id, owner, row.id, JSON.stringify(run), created, owner, new Date(Date.now() - 86400000).toISOString()).run();
      if (!inserted.meta?.changes) fail(429, '모의투자는 하루 50회까지 실행할 수 있어요.');
      return json({ run }, 201);
    }
    if (path === 'runs' && method === 'GET') {
      const rows = await db.prepare('SELECT result_json FROM finance_runs WHERE owner_key=? ORDER BY created_at DESC LIMIT 30').bind(owner).all();
      return json({ runs: rows.results.map(row => { const { curve, trades, parametersSnapshot, ...summary } = JSON.parse(row.result_json); return { ...summary, startDate: curve[0].date, endDate: curve.at(-1).date }; }) });
    }
    const run = /^runs\/([A-Za-z0-9_-]+)$/.exec(path);
    if (run && method === 'GET') return json({ run: await ownedRun(db, owner, run[1]) });
    const share = /^runs\/([A-Za-z0-9_-]+)\/share$/.exec(path);
    if (share && method === 'POST') {
      const run = await ownedRun(db, owner, share[1]), b = await readBody(request);
      if (b.confirm !== true || ![1, 7, 30].includes(b.days)) fail(422, '공개할 수익률 요약과 기간을 확인해 주세요.');
      const payload = publicPerformance(run), id = crypto.randomUUID(), created = now(), expires = new Date(Date.now() + b.days * 86400000).toISOString();
      const token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24)))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
      const result = await db.prepare('INSERT INTO finance_shares(id,owner_key,run_id,token_hash,payload_json,created_at,expires_at) SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM finance_shares WHERE owner_key=? AND revoked_at IS NULL AND expires_at>?)<30').bind(id, owner, run.id, await digest(token), JSON.stringify(payload), created, expires, owner, created).run();
      if (!result.meta?.changes) fail(429, '사용 중인 공유 링크가 30개예요. 이전 공유를 종료해 주세요.');
      return json({ id, url: `${url.origin}/finance/?share=${token}`, payload, expiresAt: expires }, 201);
    }
    if (path === 'shares' && method === 'GET') {
      const rows = await db.prepare('SELECT id,created_at,expires_at,revoked_at FROM finance_shares WHERE owner_key=? ORDER BY CASE WHEN revoked_at IS NULL AND expires_at>? THEN 0 ELSE 1 END,created_at DESC LIMIT 50').bind(owner, now()).all();
      return json({ shares: rows.results.map(row => ({ id: row.id, createdAt: row.created_at, expiresAt: row.expires_at, revokedAt: row.revoked_at })) });
    }
    const revoke = /^shares\/([A-Za-z0-9_-]+)\/revoke$/.exec(path);
    if (revoke && method === 'POST') {
      const result = await db.prepare('UPDATE finance_shares SET revoked_at=? WHERE id=? AND owner_key=? AND revoked_at IS NULL').bind(now(), revoke[1], owner).run();
      if (!result.meta?.changes) fail(404, '공유 링크를 찾을 수 없어요.'); return json({ revoked: true });
    }
    if (path === 'connections') {
      if (method === 'GET') {
        const rows = await db.prepare("SELECT id,provider,label,created_at FROM finance_connections WHERE owner_key=? AND provider IN ('kis','upbit') ORDER BY created_at DESC LIMIT 10").bind(owner).all();
        return json({ connections: rows.results.map(connectionView) });
      }
      if (method === 'POST') {
        if (!credentialStorageEnabled(env)) fail(503, '계좌 연결 보안 키가 설정되면 연결할 수 있어요.');
        const b = await readBody(request), credentials = validateCredentials(b.provider, b.credentials), label = title(b.label, b.provider === 'kis' ? '한국투자증권' : '업비트');
        const id = crypto.randomUUID(), created = now();
        const encrypted = await encryptCredentials(credentials, env.FINANCE_CREDENTIAL_KEY, { owner, id, provider: b.provider });
        const result = await db.prepare('INSERT INTO finance_connections(id,owner_key,provider,label,credentials_json,created_at) SELECT ?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM finance_connections WHERE owner_key=?)<10').bind(id, owner, b.provider, label, encrypted, created, owner).run();
        if (!result.meta?.changes) fail(429, '계좌 연결은 계정당 10개까지 저장할 수 있어요.');
        return json({ connection: { id, provider: b.provider, label, createdAt: created, status: 'stored_unverified' } }, 201);
      }
    }
    const connection = /^connections\/([A-Za-z0-9_-]+)$/.exec(path);
    if (connection && method === 'DELETE') {
      const result = await db.prepare('DELETE FROM finance_connections WHERE id=? AND owner_key=?').bind(connection[1], owner).run();
      if (!result.meta?.changes) fail(404, '계좌 연결을 찾을 수 없어요.'); return json({ deleted: true });
    }
    if (path === 'orders' && method === 'GET') {
      const rows = await db.prepare('SELECT id,strategy_id,status,result_json,created_at FROM finance_orders WHERE owner_key=? ORDER BY created_at DESC LIMIT 50').bind(owner).all();
      return json({ orders: rows.results.map(row => ({ id: row.id, strategyId: row.strategy_id, status: row.status, result: JSON.parse(row.result_json), createdAt: row.created_at })) });
    }
    const live = /^strategies\/([A-Za-z0-9_-]+)\/live-order$/.exec(path);
    if (live && method === 'POST') {
      const strategy = await ownedStrategy(db, owner, live[1]);
      if (!liveEnabled(env)) fail(503, '실매매는 운영 검증 전까지 잠겨 있어요. 모의투자를 먼저 이용해 주세요.', 'LIVE_DISABLED');
      const b = await readBody(request);
      const connection = await db.prepare('SELECT id,provider,credentials_json FROM finance_connections WHERE id=? AND owner_key=?').bind(b.connectionId, owner).first();
      if (!connection || !['kis', 'upbit'].includes(connection.provider)) fail(404, '계좌 연결을 찾을 수 없어요.');
      const order = validateLiveOrder(connection.provider, b, Number(env.FINANCE_MAX_ORDER_KRW));
      const previous = await db.prepare('SELECT id,strategy_id,connection_id,status,result_json FROM finance_orders WHERE owner_key=? AND idempotency_key=?').bind(owner, order.idempotencyKey).first();
      if (previous) {
        const prior = JSON.parse(previous.result_json);
        if (previous.strategy_id !== strategy.id || previous.connection_id !== connection.id || JSON.stringify(prior.order) !== JSON.stringify(order)) fail(409, '이미 다른 주문에 사용한 중복 방지 키예요.');
        return json({ order: { id: previous.id, status: previous.status, ...prior }, duplicate: true });
      }
      const tested = await db.prepare('SELECT result_json FROM finance_runs WHERE owner_key=? AND strategy_id=? AND created_at>? ORDER BY created_at DESC LIMIT 1').bind(owner, strategy.id, new Date(Date.now() - 30 * 86400000).toISOString()).first();
      if (!tested || JSON.parse(tested.result_json).strategyRevision !== strategy.revision || JSON.parse(tested.result_json).dataLabel !== 'uploaded') fail(422, '현재 전략 버전으로 본인 가격 자료의 모의투자를 먼저 실행해 주세요.');
      const credentials = await decryptCredentials(connection.credentials_json, env.FINANCE_CREDENTIAL_KEY, { owner, id: connection.id, provider: connection.provider });
      const id = crypto.randomUUID(), created = now(), initial = { order, provider: connection.provider };
      const inserted = await db.prepare("INSERT OR IGNORE INTO finance_orders(id,owner_key,strategy_id,connection_id,idempotency_key,status,result_json,created_at) SELECT ?,?,?,?,?, 'dispatching',?,? WHERE (SELECT COUNT(*) FROM finance_orders WHERE owner_key=? AND created_at>?)<10").bind(id, owner, strategy.id, connection.id, order.idempotencyKey, JSON.stringify(initial), created, owner, new Date(Date.now() - 3600000).toISOString()).run();
      if (!inserted.meta?.changes) fail(409, '이미 처리 중인 주문이거나 시간당 주문 한도에 도달했어요. 주문 내역을 확인해 주세요.');
      let result;
      try {
        result = await executeLimitOrder(connection.provider, credentials, order, env.FINANCE_FETCH || globalThis.fetch);
        await db.prepare('UPDATE finance_orders SET status=?,result_json=? WHERE id=? AND owner_key=?').bind(result.status, JSON.stringify({ ...initial, ...result }), id, owner).run();
      } catch {
        // An HTTP timeout cannot prove the broker rejected the order. Never retry it.
        await db.prepare("UPDATE finance_orders SET status='unknown',result_json=? WHERE id=? AND owner_key=?").bind(JSON.stringify({ ...initial, status: 'unknown', message: '브로커에서 주문 접수·체결 여부를 확인해 주세요. 이 요청은 자동 재시도하지 않습니다.' }), id, owner).run();
        return json({ order: { id, status: 'unknown' }, error: '브로커에서 주문 접수·체결 여부를 확인해 주세요. 자동 재시도하지 않습니다.' }, 502);
      }
      return json({ order: { id, ...result } }, 201);
    }
    fail(404, '요청한 기능을 찾을 수 없어요.');
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 500;
    return json({ error: status === 500 ? '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.' : error.message, ...(error.code ? { code: error.code } : {}) }, status);
  }
}
