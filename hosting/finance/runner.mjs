// Optional read-only bridge to the owner's pre-existing, single-device Quant server.
// No private strategy source, execution controls, or browser-selected origins are exposed.
import { encryptCredentials, decryptCredentials } from './brokers.mjs';

const MAX_REPLY = 500_000;
const json = (body, status = 200) => Response.json(body, { status, headers: {
  'Cache-Control': 'private, no-store', Vary: 'oai-authenticated-user-id',
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
} });
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const number = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e18 ? value : null;
const timestamp = value => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)) ? value : null;
const boolean = value => typeof value === 'boolean' ? value : null;

export function runnerConfiguration(env) {
  if (!env.FINANCE_QUANT_RUNNER_URL || !env.FINANCE_QUANT_RUNNER_OWNER) return null;
  let url;
  try { url = new URL(env.FINANCE_QUANT_RUNNER_URL); } catch { return null; }
  // The operator supplies one public HTTPS origin. Paths, redirects, IP literals,
  // local names and credentials are rejected; request JSON can never select it.
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      !['', '/'].includes(url.pathname) || url.port || !/^[a-z0-9.-]+$/i.test(url.hostname) ||
      url.hostname.endsWith('.') || url.hostname.split('.').some(label=>!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)) ||
      !url.hostname.includes('.') || /(?:^|\.)(?:localhost|local|internal|test|invalid|example|home|lan)$/i.test(url.hostname) ||
      /^\d+(?:\.\d+){3}$/.test(url.hostname) || !/^[a-f0-9]{64}$/.test(env.FINANCE_QUANT_RUNNER_OWNER)) return null;
  return { origin: url.origin, owner: env.FINANCE_QUANT_RUNNER_OWNER };
}

async function boundedJson(response) {
  if (Number(response.headers.get('content-length')) > MAX_REPLY) fail(502, 'Quant 서버 응답이 너무 큽니다.');
  const reader = response.body?.getReader();
  if (!reader) fail(502, 'Quant 서버 응답을 읽지 못했습니다.');
  const parts = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length;
      if (size > MAX_REPLY) { await reader.cancel(); fail(502, 'Quant 서버 응답이 너무 큽니다.'); }
      parts.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!object(value)) fail(502, 'Quant 서버 응답 형식이 다릅니다.');
    return value;
  } catch (error) {
    if (error.status) throw error;
    fail(502, 'Quant 서버 응답을 읽지 못했습니다.');
  }
}

async function upstream(config, endpoint, { fetcher, method = 'GET', body, token } = {}) {
  // Internal callers choose only these four endpoints. No arbitrary URL proxy.
  if (!['/api/v1/auth/pair', '/api/v1/auth/refresh', '/api/v1/dashboard', '/api/v1/bot/status'].includes(endpoint)) fail(404, '지원하지 않는 Quant 요청입니다.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetcher(config.origin + endpoint, {
      method, redirect: 'error', signal: controller.signal,
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      await response.body?.cancel();
      if ([400, 401, 403].includes(response.status)) fail(409, 'Quant 인증이 만료되었거나 연결 코드를 확인할 수 없습니다. 다시 연결해 주세요.');
      if (response.status === 429) fail(429, 'Quant 서버 요청이 많습니다. 잠시 후 다시 시도해 주세요.');
      fail(502, 'Quant 서버에 연결하지 못했습니다.');
    }
    return await boundedJson(response);
  } catch (error) {
    if (error.status) throw error;
    fail(502, 'Quant 서버 연결 시간이 초과되었거나 연결을 확인할 수 없습니다.');
  } finally { clearTimeout(timer); }
}

function tokenBundle(payload) {
  const validToken = value => typeof value === 'string' && /^[\x21-\x7e]{20,8192}$/.test(value);
  if (!validToken(payload.access_token) || !validToken(payload.refresh_token) ||
      !Number.isInteger(payload.expires_in) || payload.expires_in < 1 || payload.expires_in > 86400 ||
      (payload.token_type && payload.token_type !== 'bearer')) fail(502, 'Quant 인증 응답 형식이 다릅니다.');
  return { accessToken: payload.access_token, refreshToken: payload.refresh_token,
    expiresAt: Date.now() + payload.expires_in * 1000 };
}

async function rowFor(db, owner) {
  return db.prepare("SELECT id,credentials_json,created_at FROM finance_connections WHERE owner_key=? AND provider='quant' ORDER BY created_at DESC LIMIT 1").bind(owner).first();
}

function scope(owner, id) { return { owner, id, provider: 'quant' }; }
async function storeBundle(db, env, owner, config, bundle, { row } = {}) {
  const id = row?.id || `quant-${owner.slice(0,48)}`;
  const encrypted = await encryptCredentials({ ...bundle, origin: config.origin }, env.FINANCE_CREDENTIAL_KEY, scope(owner,id));
  if (row) {
    const result = await db.prepare("UPDATE finance_connections SET credentials_json=? WHERE id=? AND owner_key=? AND provider='quant' AND credentials_json=?")
      .bind(encrypted, id, owner, row.credentials_json).run();
    if (!result.meta?.changes) fail(409, '다른 창에서 Quant 연결이 변경되었습니다. 다시 시도해 주세요.');
  } else {
    await db.prepare('INSERT INTO finance_connections(id,owner_key,provider,label,credentials_json,created_at) VALUES(?,?,?,?,?,?)')
      .bind(id,owner,'quant','기존 Quant 서버',encrypted,new Date().toISOString()).run();
  }
  return { id, encrypted };
}

export function sanitizeRunnerDashboard(dashboard, status) {
  if (!object(dashboard) || !object(status)) fail(502, 'Quant 조회 응답 형식이 다릅니다.');
  // Explicit allowlists prevent upstream debug, credentials, raw parameters,
  // personal names, and algorithm details from entering a browser response.
  return {
    dashboard: {
      asOf: timestamp(dashboard.as_of), mode: dashboard.mode === 'PAPER_LOCAL' ? 'PAPER_LOCAL' : 'UNKNOWN',
      totalAssetKrw: number(dashboard.total_asset_krw), initialAssetKrw: number(dashboard.initial_asset_krw),
      cumulativeReturnPct: number(dashboard.cumulative_return_pct), dayReturnPct: number(dashboard.day_return_pct),
      history: (Array.isArray(dashboard.history) ? dashboard.history : []).slice(-180).map(row => ({ date: timestamp(row?.date), totalKrw: number(row?.total_krw) })).filter(row=>row.date && row.totalKrw !== null),
      sleeves: (Array.isArray(dashboard.sleeves) ? dashboard.sleeves : []).slice(0,10).map((row,index)=>({
        label: ['momentum','scalp','crypto','reserve','adaptive'].includes(row?.key) ? ({momentum:'모멘텀',scalp:'단타',crypto:'크립토',reserve:'현금 예비',adaptive:'ETF 실험'})[row.key] : `운용 구분 ${index+1}`,
        valueKrw: number(row?.value_krw), weightPct: number(row?.weight_pct),
      })),
    },
    status: {
      asOf: timestamp(status.as_of), paperEnabled: boolean(status.paper_enabled), emergencyHalted: boolean(status.emergency_halted),
      rawLiveSwitchArmed: boolean(status.raw_live_switch_armed), liveControlAvailable: false,
      tracks: (Array.isArray(status.tracks) ? status.tracks : []).slice(0,10).map((row,index)=>({
        label: ['T1-KR','T1-US','T2','T3'].includes(row?.key) ? ({'T1-KR':'국내 모멘텀','T1-US':'미국 모멘텀',T2:'국내 단타',T3:'크립토'})[row.key] : `트랙 ${index+1}`,
        enabled: boolean(row?.enabled),
      })),
      safety: { dryRun: boolean(status.safety?.dry_run), reportPaperMode: boolean(status.safety?.report_paper_mode) },
    },
  };
}

export async function handleRunnerRequest(request, env, path, context) {
  if (!/^runner(?:\/|$)/.test(path)) return null;
  const { owner, db, readBody, fetcher = globalThis.fetch } = context;
  const config = runnerConfiguration(env), allowed = !!config && owner === config.owner;
  // Identity must come from the caller's trusted Sites authentication boundary.
  if (!owner) fail(401, '로그인 후 기존 Quant 연결을 확인해 주세요.');
  if (path === 'runner/config' && request.method === 'GET') {
    const row = allowed && db ? await rowFor(db,owner) : null;
    return json({ configured: allowed, connected: !!row, readOnly: true, replacesExistingDevice: true });
  }
  if (!allowed) fail(404, '연결 가능한 기존 Quant 서버가 없습니다.');
  if (!db?.prepare || !env.FINANCE_CREDENTIAL_KEY) fail(503, 'Quant 연결 저장 설정을 준비하고 있습니다.');
  if (path === 'runner/pair' && request.method === 'POST') {
    const body = await readBody(request);
    if (!object(body) || Object.keys(body).some(key=>!['pairingCode','confirmReplaceDevice'].includes(key)) ||
        !/^\d{8}$/.test(body.pairingCode || '') || body.confirmReplaceDevice !== true) fail(422, '8자리 연결 코드와 기존 기기 연결 변경 동의를 확인해 주세요.');
    // Validate encryption before consuming a single-use upstream code.
    await encryptCredentials({},env.FINANCE_CREDENTIAL_KEY,scope(owner,'validation'));
    const row = await rowFor(db,owner);
    const payload = await upstream(config,'/api/v1/auth/pair',{fetcher,method:'POST',body:{
      pairing_code:body.pairingCode, device_id:`bandal-finance-${owner.slice(0,48)}`, device_name:'BANDAL Finance 읽기 전용 연결',
    }});
    await storeBundle(db,env,owner,config,tokenBundle(payload),{row});
    return json({ connected:true, readOnly:true, message:'기존 Quant 서버를 연결했습니다. 조회만 제공됩니다.' },201);
  }
  if (path === 'runner/disconnect' && request.method === 'DELETE') {
    await db.prepare("DELETE FROM finance_connections WHERE owner_key=? AND provider='quant'").bind(owner).run();
    return json({connected:false,readOnly:true,message:'Finance에 저장된 Quant 연결을 제거했습니다. 서버의 기기 해제는 Quant 관리 화면에서 확인해 주세요.'});
  }
  if (path === 'runner/dashboard' && request.method === 'GET') {
    let row = await rowFor(db,owner);
    if (!row) return json({connected:false,readOnly:true,dashboard:null,status:null});
    let bundle;
    try { bundle = await decryptCredentials(row.credentials_json,env.FINANCE_CREDENTIAL_KEY,scope(owner,row.id)); }
    catch { fail(409,'Quant 연결 정보를 확인할 수 없습니다. 연결을 다시 설정해 주세요.'); }
    if (!object(bundle) || typeof bundle.accessToken !== 'string' || typeof bundle.refreshToken !== 'string' ||
        !Number.isFinite(bundle.expiresAt)) fail(409,'Quant 연결 정보를 확인할 수 없습니다. 연결을 다시 설정해 주세요.');
    if (bundle.origin !== config.origin) fail(409,'Quant 서버 설정이 변경되었습니다. 연결을 다시 설정해 주세요.');
    if (bundle.expiresAt <= Date.now()+30_000) {
      const payload = await upstream(config,'/api/v1/auth/refresh',{fetcher,method:'POST',body:{refresh_token:bundle.refreshToken}});
      bundle = { ...tokenBundle(payload), origin:config.origin };
      await storeBundle(db,env,owner,config,bundle,{row});
    }
    const [dashboard,status] = await Promise.all([
      upstream(config,'/api/v1/dashboard',{fetcher,token:bundle.accessToken}),
      upstream(config,'/api/v1/bot/status',{fetcher,token:bundle.accessToken}),
    ]);
    return json({connected:true,readOnly:true,...sanitizeRunnerDashboard(dashboard,status)});
  }
  fail(404,'지원하지 않는 Quant 연결 기능입니다.');
}
