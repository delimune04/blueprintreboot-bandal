// Provider documentation checked 2026-10-24. Never send credentials to caller-supplied URLs.
// https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/order_cash/order_cash.py
// https://docs.upbit.com/kr/reference/auth
// https://docs.upbit.com/kr/reference/new-order
const encoder = new TextEncoder();
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const b64 = bytes => btoa(String.fromCharCode(...bytes));
const unb64 = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const url64 = bytes => b64(bytes).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const json64 = value => url64(encoder.encode(JSON.stringify(value)));
function keyBytes(secret) {
  if (typeof secret !== 'string') fail(503, '계좌 연결 보안 키를 아직 설정하지 않았어요.');
  let bytes;
  try {
    bytes = /^[a-fA-F0-9]{64}$/.test(secret)
      ? Uint8Array.from(secret.match(/../g), part => parseInt(part, 16)) : unb64(secret);
  } catch { fail(503, '계좌 연결 보안 설정을 확인해 주세요.'); }
  if (bytes.length !== 32) fail(503, '계좌 연결 보안 설정을 확인해 주세요.');
  return bytes;
}
export function credentialStorageEnabled(env) { try { keyBytes(env.FINANCE_CREDENTIAL_KEY); return true; } catch { return false; } }
export function liveEnabled(env) {
  return env.FINANCE_LIVE_TRADING_ENABLED === 'true' && env.FINANCE_BROKER_LIVE_VERIFIED === 'true' &&
    credentialStorageEnabled(env) && Number.isFinite(Number(env.FINANCE_MAX_ORDER_KRW)) && Number(env.FINANCE_MAX_ORDER_KRW) > 0;
}
const aadFor = ({ owner, id, provider }) => encoder.encode(`bandal-finance:v1:${owner}:${id}:${provider}`);
export async function encryptCredentials(credentials, secret, context) {
  const key = await crypto.subtle.importKey('raw', keyBytes(secret), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aadFor(context), tagLength: 128 }, key, encoder.encode(JSON.stringify(credentials))));
  return JSON.stringify({ version: 1, iv: b64(iv), ciphertext: b64(ciphertext) });
}
export async function decryptCredentials(envelope, secret, context) {
  const key = await crypto.subtle.importKey('raw', keyBytes(secret), 'AES-GCM', false, ['decrypt']);
  try {
    const data = typeof envelope === 'string' ? JSON.parse(envelope) : envelope;
    if (data.version !== 1) throw new Error('unsupported');
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(data.iv), additionalData: aadFor(context), tagLength: 128 }, key, unb64(data.ciphertext));
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch { fail(503, '저장된 계좌 연결을 안전하게 열 수 없어요. 연결을 다시 등록해 주세요.'); }
}
const field = (value, name, pattern, max = 256) => {
  if (typeof value !== 'string' || !value || value.length > max || !pattern.test(value)) fail(422, `${name} 형식을 확인해 주세요.`);
  return value;
};
export function validateCredentials(provider, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(422, '계좌 연결 입력을 확인해 주세요.');
  const keyPattern = /^[A-Za-z0-9_+/=.-]+$/;
  if (provider === 'kis') return {
    appKey: field(value.appKey, '앱 키', keyPattern), appSecret: field(value.appSecret, '앱 시크릿', keyPattern, 512),
    accountNumber: field(value.accountNumber, '계좌번호(8자리)', /^\d{8}$/),
    accountProductCode: field(value.accountProductCode, '계좌상품코드(2자리)', /^\d{2}$/),
  };
  if (provider === 'upbit') return { accessKey: field(value.accessKey, 'Access Key', keyPattern), secretKey: field(value.secretKey, 'Secret Key', keyPattern) };
  fail(422, '지원하는 연결은 한국투자증권과 업비트예요.');
}
// Expand the shortest decimal representation instead of multiplying by 1e8;
// valid amounts such as 0.29 have a non-integer binary product with 1e8.
function decimalPlaces(value) {
  const [coefficient, exponent = '0'] = value.toString().toLowerCase().split('e');
  return Math.max(0, (coefficient.split('.')[1] || '').length - Number(exponent));
}
function decimalString(value) {
  const [coefficient, exponent] = value.toString().toLowerCase().split('e');
  if (exponent === undefined) return coefficient;
  const digits = coefficient.replace('.', ''), point = coefficient.split('.')[0].length + Number(exponent);
  if (point <= 0) return '0.' + '0'.repeat(-point) + digits;
  if (point >= digits.length) return digits + '0'.repeat(point - digits.length);
  return digits.slice(0, point) + '.' + digits.slice(point);
}
export function validateLiveOrder(provider, input, maxOrder) {
  if (input.confirm !== true || !/^[A-Za-z0-9_-]{16,64}$/.test(input.idempotencyKey || '')) fail(422, '주문 확인과 중복 방지 키가 필요해요.');
  const side = input.side;
  if (!['buy', 'sell'].includes(side)) fail(422, '매수 또는 매도를 선택해 주세요.');
  const symbolPattern = provider === 'kis' ? /^\d{6}$/ : /^KRW-[A-Z0-9]{2,12}$/;
  if (typeof input.symbol !== 'string' || !symbolPattern.test(input.symbol)) fail(422, '지원하는 종목 코드를 확인해 주세요.');
  const quantity = input.quantity, limitPrice = input.limitPrice;
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1e8 ||
      typeof limitPrice !== 'number' || !Number.isFinite(limitPrice) || limitPrice <= 0 || limitPrice > 1e12 ||
      (provider === 'kis' && (!Number.isInteger(quantity) || !Number.isInteger(limitPrice)))) fail(422, '주문 수량과 지정가를 확인해 주세요.');
  if (provider === 'upbit' && (quantity < 1e-8 || decimalPlaces(quantity) > 8)) fail(422, '코인 수량은 소수점 여덟 자리까지 입력해 주세요.');
  if (!Number.isFinite(maxOrder) || maxOrder <= 0 || quantity * limitPrice > maxOrder) fail(422, '서버에 설정한 1회 주문 금액 한도를 넘었어요.');
  return { symbol: input.symbol, side, quantity, limitPrice, idempotencyKey: input.idempotencyKey, notional: quantity * limitPrice };
}
async function providerJson(fetcher, url, init) {
  let response;
  try { response = await fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(12000) }); }
  catch { fail(502, '브로커 응답을 확인하지 못했어요. 중복 주문하지 말고 브로커 주문 내역을 확인해 주세요.'); }
  let body; try { body = await response.json(); } catch { fail(502, '브로커 응답을 확인하지 못했어요. 주문 내역을 확인해 주세요.'); }
  if (!response.ok) fail(502, '브로커가 요청을 처리하지 못했어요. 브로커에서 주문 내역과 권한을 확인해 주세요.');
  return body;
}
async function upbitJwt(credentials, parameters) {
  const query = Object.entries(parameters).map(([key, value]) => `${key}=${value}`).join('&');
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-512', encoder.encode(query)))].map(n => n.toString(16).padStart(2, '0')).join('');
  const message = `${json64({ alg: 'HS512', typ: 'JWT' })}.${json64({ access_key: credentials.accessKey, nonce: crypto.randomUUID(), query_hash: hash, query_hash_alg: 'SHA512' })}`;
  const key = await crypto.subtle.importKey('raw', encoder.encode(credentials.secretKey), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  return `${message}.${url64(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message))))}`;
}
export async function executeLimitOrder(provider, credentials, order, fetcher = globalThis.fetch) {
  if (provider === 'upbit') {
    const body = { market: order.symbol, side: order.side === 'buy' ? 'bid' : 'ask', volume: decimalString(order.quantity), price: decimalString(order.limitPrice), ord_type: 'limit', identifier: order.idempotencyKey };
    const token = await upbitJwt(credentials, body);
    const result = await providerJson(fetcher, 'https://api.upbit.com/v1/orders', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (typeof result.uuid !== 'string') fail(502, '브로커 주문 접수를 확인하지 못했어요. 주문 내역을 확인해 주세요.');
    return { providerOrderId: result.uuid, status: result.state === 'done' ? 'filled' : 'submitted', provider: 'upbit', filled: result.state === 'done' };
  }
  if (provider !== 'kis') fail(422, '지원하지 않는 브로커예요.');
  const origin = 'https://openapi.koreainvestment.com:9443';
  const token = await providerJson(fetcher, origin + '/oauth2/tokenP', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grant_type: 'client_credentials', appkey: credentials.appKey, appsecret: credentials.appSecret }) });
  if (typeof token.access_token !== 'string') fail(502, '브로커 인증을 확인하지 못했어요.');
  const body = { CANO: credentials.accountNumber, ACNT_PRDT_CD: credentials.accountProductCode, PDNO: order.symbol, ORD_DVSN: '00', ORD_QTY: String(order.quantity), ORD_UNPR: String(order.limitPrice), EXCG_ID_DVSN_CD: 'KRX', SLL_TYPE: order.side === 'sell' ? '01' : '', CNDT_PRIC: '' };
  const hash = await providerJson(fetcher, origin + '/uapi/hashkey', { method: 'POST', headers: { 'Content-Type': 'application/json', appkey: credentials.appKey, appsecret: credentials.appSecret }, body: JSON.stringify(body) });
  if (typeof hash.HASH !== 'string') fail(502, '브로커 주문 서명을 확인하지 못했어요.');
  const result = await providerJson(fetcher, origin + '/uapi/domestic-stock/v1/trading/order-cash', { method: 'POST', headers: { 'Content-Type': 'application/json', authorization: `Bearer ${token.access_token}`, appkey: credentials.appKey, appsecret: credentials.appSecret, tr_id: order.side === 'buy' ? 'TTTC0012U' : 'TTTC0011U', custtype: 'P', hashkey: hash.HASH }, body: JSON.stringify(body) });
  if (result.rt_cd !== '0' || typeof result.output?.ODNO !== 'string') fail(502, '브로커 주문 접수를 확인하지 못했어요. 브로커 주문 내역을 확인해 주세요.');
  return { providerOrderId: result.output.ODNO, status: 'submitted', provider: 'kis', filled: false };
}
